/**
 * 入站协议入口共用的回环机制。
 *
 * `/v1/messages`（anthropic）与 `/v1/responses`（Responses API）都不是本应用的
 * 内部规范形：两者把客户端请求翻成 chat 请求体后，再以本机 HTTP 打回同一进程的
 * `/v1/chat/completions`，好让路由选择、故障转移、账号池、配额计量、上下文压缩、
 * 请求日志只有一份实现。这两段「打回去」的机械动作与协议无关，所以放这里 ——
 * 各写一份迟早会分叉，而分叉的方向通常是新入口忘了抄旧入口的某个细节。
 */

import type { AppConfig } from '../../../shared/types'
import { toHeaderValue } from './headerValue'

/**
 * 网关可能被配置成监听 `0.0.0.0`（对外提供服务），此时回环必须显式走
 * `127.0.0.1`，不能拿 `0.0.0.0` 当目标地址（那不是可连接的地址）。
 */
export function loopbackHostOf(config: AppConfig): string {
  const host = (config.proxyHost || '127.0.0.1').trim()
  if (host === '' || host === '0.0.0.0' || host === '*') return '127.0.0.1'
  if (host === '::' || host === '[::]') return '[::1]'
  return host.includes(':') ? `[${host}]` : host
}

/**
 * 转给回环请求的头部：凭据原样带走（鉴权由 chat 路径上的中间件统一判定，这里自己
 * 判一次就会出现「入口放行、内部拒绝」或反之），`User-Agent` 也带走 —— 请求日志的
 * `client` 与响应头 `X-ModelPort-Client` 都只按 UA 归类（`shared/clientProfile.ts`），
 * 不透这一格的话，凡是走回环的入口在面板上都会显示成网关自己（undici），「这是谁
 * 发来的」这条排障线索就断了。UA 是客户端提供的文本，必须过 `toHeaderValue`：
 * 非 ASCII 直接进头会 `ERR_INVALID_CHAR`，把一个成功请求变成 500。
 */
export function loopbackRequestHeaders(input: {
  authorization?: string
  xApiKey?: string
  userAgent?: string
}): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const authorization = (input.authorization ?? '').trim()
  if (authorization !== '') headers.Authorization = authorization
  const xApiKey = (input.xApiKey ?? '').trim()
  if (xApiKey !== '') headers['X-API-Key'] = xApiKey
  const userAgent = toHeaderValue(input.userAgent ?? '').trim()
  if (userAgent !== '') headers['User-Agent'] = userAgent
  return headers
}

export interface HeaderSetter {
  set(key: string, value: string): void
}

export function setSseHeaders(ctx: HeaderSetter): void {
  ctx.set('Content-Type', 'text/event-stream')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.set('X-Accel-Buffering', 'no')
}

/** 从上游错误响应里抠出人话；非 JSON（网关自己的纯文本错误）就原样用。 */
export async function upstreamErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (text.trim() === '') return `Upstream responded with ${response.status}`
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const error = parsed?.error as Record<string, unknown> | undefined
    const message = typeof error?.message === 'string' ? error.message : parsed?.message
    if (typeof message === 'string' && message.trim() !== '') return message
  } catch {
    // 非 JSON：当成文本
  }
  return text.slice(0, 2000)
}

/**
 * 回环那笔 chat 请求才是日志行的归属（它的 `X-Request-Id` 与请求日志同一条），
 * 拿到就把外层响应头换成它 —— 对不上就等于客户端报错时查不到现场。
 * 拿不到时保留调用方自己先挂上的 id，保证「任何一条 `/v1/*` 出口都有 id」。
 */
export function adoptInnerRequestId(ctx: HeaderSetter, response: Response): void {
  const innerRequestId = response.headers.get('x-request-id')
  if (innerRequestId) ctx.set('X-Request-Id', innerRequestId)
}

/**
 * 把网关自己的诊断头透出去（`X-ModelPort-Route-Name` / `-Auto-Skipped` /
 * `-Degraded` 等）。不透的话，走入站协议的客户端看不到「这次实际走了哪条路由、
 * 哪个渠道被为什么剔除」——而 chat 那条链已经算出来了。
 */
export function copyModelPortHeaders(ctx: HeaderSetter, response: Response): void {
  response.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('x-modelport-')) ctx.set(key, value)
  })
}
