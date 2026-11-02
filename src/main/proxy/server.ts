/**
 * Proxy Service Module - Proxy Server Core
 * Implements proxy server based on Koa
 */

import Koa, { type Context, type Next } from 'koa'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'
import { app } from 'electron'
import { Server as HttpServer } from 'http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'https'
import routes from './routes'
import managementRoutes from './routes/management'
import { proxyStatusManager } from './status'
import { storeManager } from '../store/store'
import { sessionManager } from './sessionManager'
import { loadTlsMaterial, type TlsMaterial, type TlsRuntimeStatus } from './tls'
import { isClientDisconnectError } from './clientAbort'
import {
  checkStartupSecurity,
  corsAllowHeaders,
  evaluateApiKeyAuth,
  extractApiKey,
  resolveCorsOrigin,
  safeKeyEquals,
} from './authPolicy'
import { autoRouter } from './autoRouter'
import { buildRouteError, isModelApiPath } from './routeErrorPolicy'
import { buildRejectionLogEntry, requestedModelOf } from './rejectionLog'
import { anthropicErrorBody } from '../../shared/anthropicWire'

const SLOW_REQUEST_THRESHOLD_MS = 1500

/**
 * 同时在途请求的上限。`status.ts` 里那个 `maxConnections: 100` 从来没被任何代码读过，
 * 一个没人消费的字段比不写更糟，所以这里把它变成真实行为。
 */
const MAX_IN_FLIGHT_REQUESTS = 100
let inFlightRequests = 0

function extractProvidedKey(ctx: Context): string | null {
  return extractApiKey({
    authorization: ctx.get('Authorization'),
    xApiKey: ctx.get('X-API-Key'),
  })
}

/**
 * Key 用量先在内存里累加，再按固定间隔合并落盘。
 *
 * 原来每一个通过鉴权的请求都把整份 `apiKeys` 读回来、改一条、再整份写回（`updateConfig`
 * 顺带做一遍全量归一）——磁盘写与序列化跟着请求数线性走，流式并发时主进程会抖。语义不变：
 * 计数只在鉴权成功后累加，只是落盘被合并了。
 */
const KEY_USAGE_FLUSH_INTERVAL_MS = 30_000

const pendingKeyUsage = new Map<string, { lastUsedAt: number; count: number }>()
let keyUsageFlushTimer: NodeJS.Timeout | null = null

function recordKeyUsage(providedKey: string): void {
  const config = storeManager.getConfig()
  const matched = (config.apiKeys || []).find((entry) => safeKeyEquals(entry.key, providedKey))
  if (!matched) return
  const previous = pendingKeyUsage.get(matched.id)
  pendingKeyUsage.set(matched.id, {
    lastUsedAt: Date.now(),
    count: (previous?.count ?? 0) + 1,
  })
  if (keyUsageFlushTimer === null) {
    keyUsageFlushTimer = setTimeout(flushKeyUsage, KEY_USAGE_FLUSH_INTERVAL_MS)
    keyUsageFlushTimer.unref?.()
  }
}

/**
 * 把攒下的用量写回配置。停服与运行时安全复核前都要调它，否则最后一次 flush 前的计数会丢。
 */
export function flushKeyUsage(): void {
  if (keyUsageFlushTimer !== null) {
    clearTimeout(keyUsageFlushTimer)
    keyUsageFlushTimer = null
  }
  if (pendingKeyUsage.size === 0) return

  const settled = new Map(pendingKeyUsage)
  pendingKeyUsage.clear()

  const config = storeManager.getConfig()
  const updatedKeys = (config.apiKeys || []).map((entry) => {
    const usage = settled.get(entry.id)
    if (!usage) return entry
    return { ...entry, lastUsedAt: usage.lastUsedAt, usageCount: entry.usageCount + usage.count }
  })
  storeManager.updateConfig({ apiKeys: updatedKeys })
}

/**
 * A request the proxy refused never reaches a provider, so no route records it.
 * Without these rows a client hammering a wrong path or a stale key reads as
 * "no traffic" on the same dashboard that reports the refusals as errors.
 */
function recordRejectedRequest(ctx: Context, statusCode: number, code: string, message: string): void {
  if (!isModelApiPath(ctx.path)) {
    return
  }

  const startedAt = typeof ctx.state.startedAt === 'number' ? ctx.state.startedAt : Date.now()
  const entry = buildRejectionLogEntry({
    method: ctx.method,
    path: ctx.path,
    statusCode,
    code,
    message,
    startedAt,
    now: Date.now(),
    model: requestedModelOf(ctx.request.body),
  })

  storeManager.addRequestLog(entry)
  storeManager.recordRequestInStats(false, entry.latency, entry.model || undefined)
}

/**
 * Proxy Server Class
 */
export class ProxyServer {
  private app: Koa
  private router: Router
  private server: HttpServer | null = null
  private httpsServer: HttpsServer | null = null
  private port: number = 8080
  private host: string = '127.0.0.1'
  private httpsPort: number = 8443
  private httpsHost: string = '127.0.0.1'
  private httpsError: string | null = null
  private httpsMaterial: TlsMaterial | null = null

  constructor() {
    this.app = new Koa()
    this.router = new Router()

    this.setupMiddleware()
    this.setupRoutes()
    this.setupErrorHandler()
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    this.app.use(async (ctx, next) => {
      ctx.state.startedAt = Date.now()
      // 跨域可读只按 Origin 判（`authPolicy.resolveCorsOrigin`：只回显回环来源）。
      // 这里以前还要读整份配置算 `requiresKey`，因为有一条「无 Key 就回 `*`」的分支；
      // 那条分支撤了，配置读取跟着去掉 —— 不留下没人消费的输入。
      const allowedOrigin = resolveCorsOrigin({ origin: ctx.get('Origin') || undefined })
      if (allowedOrigin) {
        ctx.set('Access-Control-Allow-Origin', allowedOrigin)
        ctx.set('Vary', 'Origin')
      }
      ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      ctx.set('Access-Control-Allow-Headers', corsAllowHeaders())
      ctx.set('Access-Control-Max-Age', '86400')

      if (ctx.method === 'OPTIONS') {
        ctx.status = 204
        return
      }

      await next()
    })

    // API Key validation middleware - runs before body parsing so unauthenticated payloads are never read
    this.app.use(async (ctx, next) => {
      // Skip paths that don't require authentication
      // `/stats` 不再免鉴权：它把 modelUsage / providerUsage / accountUsage 整份端出来，
      // 等于「这台机器接了哪些厂商、几个账号、谁用得多」的清单。界面走的是 IPC，
      // 不受这一条影响。
      const publicPaths = ['/', '/health']
      if (publicPaths.includes(ctx.path)) {
        await next()
        return
      }

      // Skip management API paths - they have their own authentication
      if (ctx.path.startsWith('/v1/management')) {
        await next()
        return
      }

      const config = storeManager.getConfig()
      const providedKey = extractProvidedKey(ctx)
      const outcome = evaluateApiKeyAuth({ apiKeys: config.apiKeys, providedKey })

      // Anthropic 客户端只认 Anthropic 的错误信封。回 OpenAI 信封会让它把 401
      // 当成"响应解析失败"，用户看到的是莫名其妙的 JSON 报错而不是"密钥不对"。
      const isAnthropicInbound =
        ctx.path === '/v1/messages' || ctx.path.startsWith('/v1/messages/')

      if (outcome === 'missing_key') {
        ctx.status = 401
        ctx.body = isAnthropicInbound
          ? anthropicErrorBody('API key is required', 'authentication_error')
          : {
              error: {
                message: 'API key is required',
                type: 'invalid_request_error',
                code: 'missing_api_key',
              },
            }
        recordRejectedRequest(ctx, 401, 'missing_api_key', 'API key is required')
        return
      }

      if (outcome === 'invalid_key') {
        ctx.status = 401
        ctx.body = isAnthropicInbound
          ? anthropicErrorBody('Invalid API key', 'authentication_error')
          : {
              error: {
                message: 'Invalid API key',
                type: 'invalid_request_error',
                code: 'invalid_api_key',
              },
            }
        recordRejectedRequest(ctx, 401, 'invalid_api_key', 'Invalid API key')
        return
      }

      if (providedKey) {
        recordKeyUsage(providedKey)
      }

      await next()
    })

    // 并发闸。这条服务原本对同时在途的请求数没有上限：本机任意进程（或在无 Key 时
    // 跨域读得到的网页）可以一次打进来几百条，把内存、连接和上游配额一起耗尽 ——
    // bodyparser 的 50MB 是单条上限，不是总量。计数在自己的 finally 里配对，故意不复用
    // `activeConnections`：那个在异常路径上只增不减，拿它当闸会变成「越用越拒绝」。
    this.app.use(async (ctx, next) => {
      if (inFlightRequests >= MAX_IN_FLIGHT_REQUESTS) {
        ctx.status = 429
        ctx.set('Retry-After', '2')
        ctx.body = {
          error: {
            message: 'Too many concurrent requests to this local proxy',
            type: 'rate_limit_error',
            code: 'concurrency_limit',
          },
        }
        recordRejectedRequest(ctx, 429, 'concurrency_limit', 'Too many concurrent requests to this local proxy')
        return
      }
      inFlightRequests++
      try {
        await next()
      } finally {
        inFlightRequests--
      }
    })

    this.app.use(bodyParser({
      jsonLimit: '50mb',
      formLimit: '50mb',
      textLimit: '50mb',
    }))

    this.app.use(async (ctx, next) => {
      const startTime = Date.now()

      await next()

      const latency = Date.now() - startTime
      // The model list is polled by every client, so only its reads stay silent;
      // anything else on that path is a client misconfiguration worth a trace.
      const isModelListRead = ctx.method === 'GET' && ctx.path.startsWith('/v1/models')
      const shouldRecordAccessLog =
        !isModelListRead &&
        (ctx.status >= 400 || latency >= SLOW_REQUEST_THRESHOLD_MS)

      if (shouldRecordAccessLog) {
        storeManager.addLog('warn', `${ctx.method} ${ctx.path} ${ctx.status} ${latency}ms`, {
          data: {
            method: ctx.method,
            path: ctx.path,
            status: ctx.status,
            latency,
            clientIP: ctx.ip,
            slowRequest: latency >= SLOW_REQUEST_THRESHOLD_MS,
          },
        })
      }
    })
  }

  /**
   * Setup routes
   */
  private setupRoutes(): void {
    // Register OpenAI API routes
    for (const route of routes) {
      this.router.use(route.routes())
      this.router.use(route.allowedMethods())
    }

    this.router.get('/', async (ctx) => {
      ctx.body = {
        name: 'ModelPort Proxy',
        // 运行期取版本：这里原来硬编码 `1.1.2`，与 package.json 的 1.4.x 已经差了一个
        // 大版本，排查时按这个数去对文档会直接对错。
        version: app.getVersion(),
        description: 'OpenAI (chat / completions / responses) + Anthropic API compatible proxy service',
        endpoints: [
          'POST /v1/chat/completions',
          'GET /v1/models',
          'GET /v1/models/:model',
          'POST /v1/completions',
          'POST /v1/responses',
          'POST /v1/messages',
          'POST /v1/messages/count_tokens',
        ],
      }
    })

    // 这是唯一免鉴权的端点，只回答「活着没有」。原来还带 uptime 与四个计数，等于给
    // 本机任意进程（以及任何能直连回环的脚本）一份运行情报；完整统计在鉴权后的
    // `/stats` 里，这里不需要重复一遍。
    this.router.get('/health', async (ctx) => {
      ctx.body = {
        ok: true,
        status: proxyStatusManager.getRunningStatus().isRunning ? 'running' : 'stopped',
      }
    })

    this.router.get('/stats', async (ctx) => {
      const statistics = proxyStatusManager.getStatistics()
      ctx.body = statistics
    })

    // Management API enable check middleware
    // This must be registered before management routes
    const managementEnableCheck = async (ctx: Context, next: Next) => {
      if (!ctx.path.startsWith('/v1/management')) {
        await next()
        return
      }

      try {
        const config = storeManager.getConfig()
        if (!config.managementApi?.enableManagementApi) {
          ctx.status = 404
          ctx.body = {
            success: false,
            error: {
              code: 'management_api_disabled',
              message: 'Management API is not enabled',
            },
          }
          return
        }
        await next()
      } catch {
        ctx.status = 503
        ctx.body = {
          success: false,
          error: {
            code: 'service_unavailable',
            message: 'Service is initializing',
          },
        }
      }
    }

    this.app.use(managementEnableCheck)

    // Register all management routes (they already have /v1/management prefix)
    for (const route of managementRoutes) {
      this.app.use(route.routes())
      this.app.use(route.allowedMethods())
    }

    this.app.use(this.router.routes())
    this.app.use(this.router.allowedMethods())

    this.app.use(async (ctx) => {
      const routeError = buildRouteError({
        method: ctx.method,
        path: ctx.path,
        matched: (ctx as { matched?: Array<{ methods?: string[] }> }).matched,
      })
      // Answering the 405 here keeps koa-router's allowedMethods() from later
      // overwriting the status while this body still says "route not found".
      ctx.status = routeError.status
      if (routeError.allow) {
        ctx.set('Allow', routeError.allow)
      }
      ctx.body = routeError.body
      recordRejectedRequest(ctx, routeError.status, routeError.body.error.code, routeError.body.error.message)
    })
  }

  /**
   * Setup error handler
   */
  private setupErrorHandler(): void {
    this.app.on('error', (err, ctx) => {
      const status = err.status || 500
      const message = err.message || 'Internal Server Error'

      // 客户端先断开：响应写侧抛 ECONNRESET/EPIPE 是用户取消，不是网关故障。
      if (isClientDisconnectError(err) && !ctx?.res.writableEnded) {
        storeManager.addLog('debug', `Client disconnected: ${message}`, {
          data: {
            path: ctx?.path,
            method: ctx?.method,
            code: (err as NodeJS.ErrnoException).code,
          },
        })
        return
      }

      storeManager.addLog('error', `Server error: ${message}`, {
        data: {
          status,
          path: ctx.path,
          method: ctx.method,
          stack: err.stack,
        },
      })
    })
  }

  /**
   * Start server
   */
  async start(port?: number, host?: string): Promise<boolean> {
    if (this.server) {
      return false
    }

    this.port = port || proxyStatusManager.getPort()
    this.host = host || proxyStatusManager.getHost()

    const security = checkStartupSecurity({
      apiKeys: storeManager.getConfig().apiKeys,
      host: this.host,
    })
    if (!security.ok) {
      storeManager.addLog(
        'error',
        `Refusing to listen on ${this.host} without an API key; configure an API key or bind to 127.0.0.1`
      )
      return false
    }

    const started = await new Promise<boolean>((resolve) => {
      try {
        this.server = this.app.listen(this.port, this.host, () => {
          proxyStatusManager.start()
          proxyStatusManager.setPort(this.port)
          proxyStatusManager.setHost(this.host)

          storeManager.addLog('info', `Proxy server started successfully, listening on ${this.host}:${this.port}`)

          resolve(true)
        })

        this.server.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            storeManager.addLog('error', `Port ${this.port} is already in use`)
          } else {
            storeManager.addLog('error', `Server error: ${err.message}`)
          }
          this.server = null
          resolve(false)
        })

        this.server.on('close', () => {
          this.server = null
        })
      } catch (error) {
        storeManager.addLog('error', `Failed to start server: ${error instanceof Error ? error.message : 'Unknown error'}`)
        resolve(false)
      }
    })

    if (!started) {
      return false
    }

    const config = storeManager.getConfig()
    if (config.httpsEnabled) {
      await this.startHttps(config.httpsPort || 8443)
    }

    return true
  }

  /**
   * Adds the TLS listener. A certificate failure is recorded on the status
   * instead of failing the whole start: the HTTP listener is already serving,
   * and the settings page can show exactly which part went wrong.
   */
  private async startHttps(port: number): Promise<void> {
    this.httpsHost = this.host
    this.httpsPort = port
    this.httpsError = null

    let material: TlsMaterial
    try {
      material = loadTlsMaterial(storeManager.getConfig())
    } catch (error) {
      this.httpsError = error instanceof Error ? error.message : 'Failed to load the HTTPS certificate'
      storeManager.addLog('error', `HTTPS listener not started: ${this.httpsError}`)
      return
    }
    this.httpsMaterial = material

    await new Promise<void>((resolve) => {
      try {
        const httpsServer = createHttpsServer(
          { key: material.key, cert: material.cert },
          this.app.callback(),
        )
        this.httpsServer = httpsServer

        httpsServer.once('error', (err: NodeJS.ErrnoException) => {
          this.httpsServer = null
          this.httpsError =
            err.code === 'EADDRINUSE'
              ? `HTTPS port ${this.httpsPort} is already in use`
              : err.message
          storeManager.addLog('error', `HTTPS listener failed: ${this.httpsError}`)
          resolve()
        })

        httpsServer.listen(this.httpsPort, this.httpsHost, () => {
          storeManager.addLog(
            'info',
            `HTTPS listener started on ${this.httpsHost}:${this.httpsPort} (${material.source} certificate)`,
          )
          resolve()
        })

        httpsServer.on('close', () => {
          this.httpsServer = null
        })
      } catch (error) {
        this.httpsServer = null
        this.httpsError = error instanceof Error ? error.message : 'Failed to start the HTTPS listener'
        storeManager.addLog('error', `HTTPS listener failed: ${this.httpsError}`)
        resolve()
      }
    })
  }

  /**
   * Stop server
   */
  /**
   * 配置变更后重新核对监听安全。
   *
   * 启动检查只跑一次的话，「带 Key 绑 `0.0.0.0` 启动 → 再把 Key 全清空」会让服务继续以
   * 无鉴权状态对外监听。这里每次配置落盘后被调一次：判定不过就停服。选停服而不是悄悄换
   * 回 `127.0.0.1`，是因为那要求重开 socket 并改端口号，客户端看到的「突然连不上」比
   * 状态栏里明明白白的「已停止」更难解释。
   */
  revalidateSecurity(): { ok: boolean; reason?: string } {
    flushKeyUsage()
    const config = storeManager.getConfig()
    const security = checkStartupSecurity({ apiKeys: config.apiKeys, host: this.host })
    if (!security.ok) {
      storeManager.addLog('error', `Proxy stopped: listening on ${this.host} without any API key is not allowed`)
      void this.stop()
    }
    return security
  }

  async stop(): Promise<boolean> {
    // 停服前把攒着的 Key 用量落盘，否则最后一个 flush 间隔内的计数会丢。
    flushKeyUsage()
    if (!this.server && !this.httpsServer) {
      return false
    }

    sessionManager.destroy()
    autoRouter.reset()

    const servers = [this.server, this.httpsServer].filter(
      (server): server is HttpServer | HttpsServer => server !== null,
    )
    this.server = null
    this.httpsServer = null
    this.httpsError = null

    return new Promise((resolve) => {
      let remaining = servers.length
      let failed = false
      const forceTimer = setTimeout(() => {
        for (const server of servers) {
          (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
        }
      }, 5000)

      const finishOne = (ok: boolean) => {
        if (!ok) failed = true
        remaining -= 1
        if (remaining > 0) return

        clearTimeout(forceTimer)
        if (failed) {
          resolve(false)
          return
        }

        proxyStatusManager.stop()
        storeManager.addLog('info', 'Proxy server stopped')
        resolve(true)
      }

      for (const server of servers) {
        ;(server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.()

        server.close((err) => {
          if (err) {
            storeManager.addLog('error', `Failed to stop server: ${err.message}`)
            finishOne(false)
            return
          }
          finishOne(true)
        })
      }
    })
  }

  /**
   * Restart server
   */
  async restart(port?: number, host?: string): Promise<boolean> {
    await this.stop()
    return this.start(port, host)
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null && proxyStatusManager.getRunningStatus().isRunning
  }

  /**
   * Get server port
   */
  getPort(): number {
    return this.port
  }

  /** Snapshot for the settings page: whether TLS is listening and why not. */
  getHttpsRuntimeStatus(): TlsRuntimeStatus {
    return {
      running: this.httpsServer !== null,
      host: this.httpsHost,
      port: this.httpsPort,
      error: this.httpsError,
    }
  }

  /** Certificate already loaded by a start; null before the first HTTPS start. */
  getHttpsMaterial(): TlsMaterial | null {
    return this.httpsMaterial
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return proxyStatusManager.getStatistics()
  }

  /**
   * Get running status
   */
  getStatus() {
    return proxyStatusManager.getRunningStatus()
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    proxyStatusManager.resetStatistics()
  }
}

export const proxyServer = new ProxyServer()
export default proxyServer
