/**
 * 管理 API 速率限制中间件
 *
 * 只作用于 `/v1/management` 前缀。存在的理由不是「本地可信所以不用管」，而是本机
 * 任意进程都能直连回环端口：没有这层限制，一段 `while true` 的脚本就能把管理面
 * （含 `/config` PUT）打到主进程忙不过来，而这台机器上同时还在跑用户真正的推理流量。
 *
 * ## 为什么按「逻辑调用」分桶，而不是按 IP 一个桶
 *
 * 2026-11-06 把预算从 60 提到 240（见 git 历史）；2026-11-09 又复发了 —— 一次
 * Channels 页刷新会带 list + 每渠道 credits + autoCheckin + identity 十几个调用，
 * 单个桶按「一次 HTTP 请求」记，页面按「一次刷新」花，于是 UI 自己把自己限流，
 * 而且被拒之后**所有**管理面调用（配置写入、SSE 事件流、备份导入）一起死。
 *
 * 所以桶键是 `(IP, 逻辑调用)`：RPC 用 `<channel, args 摘要>`，其余路径用
 * `方法 + 路径`。一个页面的扇出分散到十几个桶，彼此不互相拖累；同一 IP 仍有一个
 * 全局上限（{@link MANAGEMENT_RATE_LIMIT_GLOBAL_MAX}）兜底，防的是「换个 args 就
 * 换一个桶」的脚本，所以分桶不等于放宽总量。
 *
 * 计数放在实例级共享 Map 里：`koa-ratelimit` 的 memory 驱动每个请求都会
 * `new MemoryLimiter({ ...opts, id })`，桶只存在于 `opts.db`；不传共享 Map 就
 * 等于每笔请求一个新桶，`remaining` 永远是初始值，限流一次也不会触发。
 */
import type { Context, Next } from 'koa'
import rateLimit from 'koa-ratelimit'

/** 管理面路径前缀。 */
export const MANAGEMENT_RATE_LIMIT_PATH_PREFIX = '/v1/management'
/** 单个逻辑调用在窗口内允许的请求数。 */
export const MANAGEMENT_RATE_LIMIT_MAX = 240
/** 同一 IP 在窗口内的总请求数上限（跨所有桶）。 */
export const MANAGEMENT_RATE_LIMIT_GLOBAL_MAX = 1200
/** 默认窗口长度（毫秒）。 */
export const MANAGEMENT_RATE_LIMIT_WINDOW_MS = 60_000

export interface ManagementRateLimiterOptions {
  /** 单桶窗口内允许的请求数，默认 {@link MANAGEMENT_RATE_LIMIT_MAX}。 */
  max?: number
  /** 每 IP 总请求数上限，默认 {@link MANAGEMENT_RATE_LIMIT_GLOBAL_MAX}。 */
  globalMax?: number
  /** 窗口长度（毫秒），默认 {@link MANAGEMENT_RATE_LIMIT_WINDOW_MS}。 */
  windowMs?: number
  /** 生效的路径前缀，默认 {@link MANAGEMENT_RATE_LIMIT_PATH_PREFIX}。 */
  pathPrefix?: string
  /** 计数归属，默认 {@link managementBucketKey}。测试可注入固定键。 */
  keyOf?: (ctx: Context) => string
}

interface RpcCall {
  channel: string
  args: readonly unknown[]
}

/**
 * 从已解析的请求体里取出 RPC 身份；不是 RPC 请求（或体还没解析）时返回 `null`。
 *
 * 限流跑在 `koa-bodyparser` 之后（`server.ts` 的挂载顺序保证），所以这里读到的就是
 * 路由随后要用的同一份 body —— 不额外解析、也不信任客户端自报的头部。
 */
function rpcCallOf(ctx: Context): RpcCall | null {
  const body = (ctx as Context & { request?: { body?: unknown } }).request?.body
  if (typeof body !== 'object' || body === null) return null
  const record = body as { channel?: unknown; args?: unknown }
  if (typeof record.channel !== 'string' || record.channel.length === 0) return null
  return { channel: record.channel, args: Array.isArray(record.args) ? record.args : [] }
}

/**
 * 参数摘要（FNV-1a，只为把任意形状的参数折叠成定长键，不做安全用途）。
 *
 * 同一次刷新里的 `channels:models(trae)` 与 `channels:models(qoder)` 是两个桶：
 * 某一家慢到把预算花光时，不该连累其余渠道。`channels:rpc(usage.autoCheckin)`
 * 与 `channels:rpc(identity.snapshot)` 同理各自成桶。
 */
function digestOf(value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? ''
  } catch {
    return 'unserializable'
  }
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${text.length.toString(36)}:${hash.toString(36)}`
}

/** 某次请求归属的计数桶。导出给测试与调用方核对分桶口径。 */
export function managementBucketKey(ctx: Context): string {
  const ip = typeof ctx.ip === 'string' ? ctx.ip : ''
  const path = typeof ctx.path === 'string' ? ctx.path : ''
  const rpcPath = `${MANAGEMENT_RATE_LIMIT_PATH_PREFIX}/rpc`
  if (path === rpcPath || path.startsWith(`${rpcPath}/`)) {
    const call = rpcCallOf(ctx)
    if (call !== null) return `${ip}\u0000rpc:${call.channel}:${digestOf(call.args)}`
  }
  const method = typeof ctx.method === 'string' ? ctx.method : ''
  return `${ip}\u0000${method} ${path}`
}

interface BucketState {
  reset: number
}

/** 清掉已过窗口的桶：桶键里有参数摘要，长期运行不能只增不减。 */
function sweepExpired(buckets: Map<string, unknown>, lastSweep: { at: number }): void {
  const now = Date.now()
  if (now - lastSweep.at < 60_000) return
  lastSweep.at = now
  for (const [key, value] of buckets) {
    const reset = (value as BucketState | undefined)?.reset
    if (typeof reset === 'number' && reset * 1000 <= now) buckets.delete(key)
  }
}

/**
 * 创建管理 API 限流中间件。每个实例持有自己的计数桶，便于测试与重置。
 */
export function managementRateLimiter(
  options: ManagementRateLimiterOptions = {},
): (ctx: Context, next: Next) => Promise<void> {
  const max = options.max ?? MANAGEMENT_RATE_LIMIT_MAX
  const globalMax = options.globalMax ?? MANAGEMENT_RATE_LIMIT_GLOBAL_MAX
  const windowMs = options.windowMs ?? MANAGEMENT_RATE_LIMIT_WINDOW_MS
  const pathPrefix = options.pathPrefix ?? MANAGEMENT_RATE_LIMIT_PATH_PREFIX
  const keyOf = options.keyOf ?? managementBucketKey

  const buckets = new Map<string, unknown>()
  const globalBuckets = new Map<string, unknown>()
  const bucketSweep = { at: 0 }
  const globalSweep = { at: 0 }

  // 默认 429 体是 `ctx.body = 'Rate limit exceeded, retry in ...'` 纯文本，
  // 与其它管理接口的 `{ success, error }` 信封不一致；这里改写成同一形状。
  const onLimited = (ctx: Context): void => {
    const after = (ctx.state.rateLimit as { after?: number } | undefined)?.after
    const channel = typeof ctx.state.managementRpcChannel === 'string'
      ? ctx.state.managementRpcChannel
      : undefined
    ctx.status = 429
    ctx.body = {
      success: false,
      error: {
        code: 'management_rate_limited',
        message:
          after !== undefined && after > 0
            ? `Too many management API requests, retry in ${after}s`
            : 'Too many management API requests',
        // 机器可读的等待时长：远程 UI 的传输层要在 429 后自动重试一次，
        // 从 `after` 秒换出来比解析上面的英文句子可靠。
        ...(after !== undefined && after > 0 ? { retryAfterMs: after * 1000 } : {}),
        // 被限的是哪个逻辑调用：`/v1/management/rpc` 是单一不透明路径，没有这个
        // 字段，日志里 1542 条 429 就一条 channel 都指不出来（2026-11-09）。
        ...(channel === undefined ? {} : { channel }),
      },
    }
  }

  const headers = {
    remaining: 'X-RateLimit-Remaining',
    reset: 'X-RateLimit-Reset',
    total: 'X-RateLimit-Limit',
  }

  const perKey = rateLimit({
    driver: 'memory',
    db: buckets,
    max,
    duration: windowMs,
    id: keyOf,
    headers,
    onLimited,
  })

  const perIp = rateLimit({
    driver: 'memory',
    db: globalBuckets,
    max: globalMax,
    duration: windowMs,
    id: (ctx: Context) => (typeof ctx.ip === 'string' ? ctx.ip : ''),
    headers,
    onLimited,
  })

  return async function managementRateLimiterMiddleware(
    ctx: Context,
    next: Next,
  ): Promise<void> {
    const path = typeof ctx.path === 'string' ? ctx.path : ''
    if (path !== pathPrefix && !path.startsWith(`${pathPrefix}/`)) {
      await next()
      return
    }
    // 先把可能被限的调用名挂到 state 上：RPC 路由在 429 时根本跑不到，访问日志
    // 与 429 信封只能从这里拿到 channel。
    const call = rpcCallOf(ctx)
    if (call !== null) ctx.state.managementRpcChannel = call.channel

    sweepExpired(buckets, bucketSweep)
    sweepExpired(globalBuckets, globalSweep)
    // 先查每 IP 总上限，再查单桶：后者最后写响应头，客户端拿到的是更紧的那个额度。
    await perIp(ctx, async () => {
      await perKey(ctx, next)
    })
  }
}