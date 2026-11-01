/**
 * Proxy Service Module - Proxy Server Core
 * Implements proxy server based on Koa
 */

import Koa, { type Context, type Next } from 'koa'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'
import { Server as HttpServer } from 'http'
import routes from './routes'
import managementRoutes from './routes/management'
import { proxyStatusManager } from './status'
import { storeManager } from '../store/store'
import { sessionManager } from './sessionManager'
import {
  checkStartupSecurity,
  corsAllowHeaders,
  evaluateApiKeyAuth,
  extractApiKey,
  requiresApiKey,
  resolveCorsOrigin,
  safeKeyEquals,
} from './authPolicy'
import { autoRouter } from './autoRouter'
import { buildRouteError, isModelApiPath } from './routeErrorPolicy'
import { buildRejectionLogEntry, requestedModelOf } from './rejectionLog'
import { anthropicErrorBody } from '../../shared/anthropicWire'

const SLOW_REQUEST_THRESHOLD_MS = 1500

function extractProvidedKey(ctx: Context): string | null {
  return extractApiKey({
    authorization: ctx.get('Authorization'),
    xApiKey: ctx.get('X-API-Key'),
  })
}

function recordKeyUsage(providedKey: string): void {
  const config = storeManager.getConfig()
  const matched = (config.apiKeys || []).find((entry) => safeKeyEquals(entry.key, providedKey))
  if (!matched) return
  const updatedKeys = config.apiKeys.map((entry) =>
    entry.id === matched.id
      ? { ...entry, lastUsedAt: Date.now(), usageCount: entry.usageCount + 1 }
      : entry
  )
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
  private port: number = 8080
  private host: string = '127.0.0.1'

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
      const config = storeManager.getConfig()
      const allowedOrigin = resolveCorsOrigin({
        origin: ctx.get('Origin') || undefined,
        requiresKey: requiresApiKey(config.apiKeys),
        host: this.host,
      })
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
      const publicPaths = ['/', '/health', '/stats']
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
        version: '1.1.2',
        description: 'OpenAI + Anthropic API compatible proxy service',
        endpoints: [
          'POST /v1/chat/completions',
          'GET /v1/models',
          'GET /v1/models/:model',
          'POST /v1/completions',
          'POST /v1/messages',
          'POST /v1/messages/count_tokens',
        ],
      }
    })

    this.router.get('/health', async (ctx) => {
      const status = proxyStatusManager.getRunningStatus()
      const statistics = proxyStatusManager.getStatistics()

      ctx.body = {
        status: status.isRunning ? 'running' : 'stopped',
        uptime: status.uptime,
        statistics: {
          totalRequests: statistics.totalRequests,
          successRequests: statistics.successRequests,
          failedRequests: statistics.failedRequests,
          activeConnections: statistics.activeConnections,
        },
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

    return new Promise((resolve) => {
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
  }

  /**
   * Stop server
   */
  async stop(): Promise<boolean> {
    if (!this.server) {
      return false
    }
    
    sessionManager.destroy()
    autoRouter.reset()

    const server = this.server
    return new Promise((resolve) => {
      let settled = false
      const forceTimer = setTimeout(() => {
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
      }, 5000)

      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(forceTimer)
        resolve(value)
      }

      ;(server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.()

      server.close((err) => {
        if (err) {
          storeManager.addLog('error', `Failed to stop server: ${err.message}`)
          finish(false)
          return
        }

        this.server = null
        proxyStatusManager.stop()

        storeManager.addLog('info', 'Proxy server stopped')

        finish(true)
      })
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
