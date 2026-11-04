/**
 * `koa-ratelimit` 6.x 自带的类型声明（该包本身不带 .d.ts，也没有 @types）。
 *
 * 只声明本项目用到的选项面。字段名以 `node_modules/koa-ratelimit/index.js`
 * 为准：这是 `duration`（毫秒窗口），不是 express-rate-limit 的 `windowMs`；
 * 计数桶是 `db`（memory 驱动要求 `Map` 实例），不是 `store`。
 */
declare module 'koa-ratelimit' {
  import type { Context, Next } from 'koa'

  export interface RateLimitHeaderNames {
    remaining?: string
    reset?: string
    total?: string
  }

  export interface RateLimitOptions {
    /** 默认 'redis'；本项目只用 'memory'。 */
    driver?: 'memory' | 'redis'
    /** 窗口长度，毫秒。默认 1 小时。 */
    duration?: number
    /** 每窗口允许的请求数。默认 2500。 */
    max?: number
    /** memory 驱动的计数器容器；不传则每次请求新建一个 Map（限流永不生效）。 */
    db?: Map<string, unknown>
    /** 计数器归属；返回 false 表示跳过限流。 */
    id?: (ctx: Context) => string | false
    headers?: RateLimitHeaderNames
    /** 触发限流后的回调，此时 ctx.status/ctx.body 已被设成 429/提示文本。 */
    onLimited?: (ctx: Context) => void
    errorMessage?: string
    status?: number
    disableHeader?: boolean
    throw?: boolean
    whitelist?: (ctx: Context) => boolean | Promise<boolean>
    blacklist?: (ctx: Context) => boolean | Promise<boolean>
    namespace?: string
  }

  export type RateLimitMiddleware = (ctx: Context, next: Next) => Promise<void>

  function rateLimit(options?: RateLimitOptions): RateLimitMiddleware
  export default rateLimit
}