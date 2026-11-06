/**
 * 管理 API 速率限制中间件
 *
 * 只作用于 `/v1/management` 前缀，按客户端 IP 计一个固定窗口（默认 240 次 / 60 秒）。
 * 存在的理由不是「本地可信所以不用管」，而是本机任意进程都能直连回环端口：
 * 没有这层限制，一段 `while true` 的脚本就能把管理面（含 `/config` PUT）打到
 * 主进程忙不过来，而这台机器上同时还在跑用户真正的推理流量。
 *
 * 240 而不是更低的数值：这套 RPC 同时是远程 UI 的传输层，一次 Channels 页
 * 刷新会带 list + 每渠道 credits + autoCheckin + identity 十几个调用，叠加
 * 5s 状态轮询后，60/分钟会让 UI 自己把自己限流（2026-11-06 WSL 日志里
 * 09:01 一分钟 50 条 429，全部来自 127.0.0.1）。240 仍然能拦住死循环脚本。
 *
 * 计数放在实例级共享 Map 里：`koa-ratelimit` 的 memory 驱动每个请求都会
 * `new MemoryLimiter({ ...opts, id })`，桶只存在于 `opts.db`；不传共享 Map 就
 * 等于每笔请求一个新桶，`remaining` 永远是初始值，限流一次也不会触发。
 */
import type { Context, Next } from 'koa'
import rateLimit from 'koa-ratelimit'

/** 管理面路径前缀。 */
export const MANAGEMENT_RATE_LIMIT_PATH_PREFIX = '/v1/management'
/** 默认窗口内允许的请求数。 */
export const MANAGEMENT_RATE_LIMIT_MAX = 240
/** 默认窗口长度（毫秒）。 */
export const MANAGEMENT_RATE_LIMIT_WINDOW_MS = 60_000

export interface ManagementRateLimiterOptions {
  /** 窗口内允许的请求数，默认 {@link MANAGEMENT_RATE_LIMIT_MAX}。 */
  max?: number
  /** 窗口长度（毫秒），默认 {@link MANAGEMENT_RATE_LIMIT_WINDOW_MS}。 */
  windowMs?: number
  /** 生效的路径前缀，默认 {@link MANAGEMENT_RATE_LIMIT_PATH_PREFIX}。 */
  pathPrefix?: string
  /** 计数归属，默认 `ctx.ip`。测试可注入固定键。 */
  keyOf?: (ctx: Context) => string
}

/**
 * 创建管理 API 限流中间件。每个实例持有自己的计数桶，便于测试与重置。
 */
export function managementRateLimiter(
  options: ManagementRateLimiterOptions = {},
): (ctx: Context, next: Next) => Promise<void> {
  const max = options.max ?? MANAGEMENT_RATE_LIMIT_MAX
  const windowMs = options.windowMs ?? MANAGEMENT_RATE_LIMIT_WINDOW_MS
  const pathPrefix = options.pathPrefix ?? MANAGEMENT_RATE_LIMIT_PATH_PREFIX
  const keyOf = options.keyOf ?? ((ctx: Context) => ctx.ip)

  const buckets = new Map<string, unknown>()

  const limiter = rateLimit({
    driver: 'memory',
    db: buckets,
    max,
    duration: windowMs,
    id: (ctx: Context) => keyOf(ctx),
    headers: {
      remaining: 'X-RateLimit-Remaining',
      reset: 'X-RateLimit-Reset',
      total: 'X-RateLimit-Limit',
    },
    // 默认 429 体是 `ctx.body = 'Rate limit exceeded, retry in ...'` 纯文本，
    // 与其它管理接口的 `{ success, error }` 信封不一致；这里改写成同一形状。
    onLimited: (ctx: Context) => {
      const after = (ctx.state.rateLimit as { after?: number } | undefined)?.after
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
        },
      }
    },
  })

  return async function managementRateLimiterMiddleware(
    ctx: Context,
    next: Next,
  ): Promise<void> {
    const path = ctx.path
    if (path !== pathPrefix && !path.startsWith(`${pathPrefix}/`)) {
      await next()
      return
    }
    await limiter(ctx, next)
  }
}