/**
 * 聚合线出站的「客户端形状」头。
 *
 * ## 为什么需要（2026-11-13 排查）
 *
 * 聚合线出站此前从不带 User-Agent，Node fetch 的缺省值 `user-agent: node` +
 * `sec-fetch-mode: cors` + `accept-language: *` 是标准服务端指纹 —— 上游风控看到
 * 的形状与「客户端直连」完全不同（bailian_token_plan 659M tokens/天、deepseek
 * 41M/天都骑着这条线）。网关在入站已经识别了客户端（`shared/clientProfile`），
 * 这里把**客户端自己发来的 UA** 原样转发给出站，出站形状即与该客户端直连一致。
 *
 * ## 边界（与 `opencodeAffinity` 的「不冒充」同一条原则）
 *
 * - 只转发客户端真实发来的值，客户端没发就不发 —— 不伪造、不猜测；
 * - 客户端没发的头保持 undici 缺省（与 Node CLI 客户端直连一致），不额外覆写；
 * - provider 配置头（registry `headers`，如 kimchi 的 UA）优先级高于这里的转发
 *   （显式配置 > 自动转发），合并顺序由调用方保证。
 */

/** 转发前允许的最大长度：UA 超长的多为拼接污染，截断即可。 */
const MAX_HEADER_VALUE_LENGTH = 256

/** HTTP 头值不允许的控制字符（CRLF 注入面一并覆盖）。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

function sanitizeHeaderValue(raw: string | string[] | undefined): string | undefined {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  if (!value) return undefined
  const cleaned = value.replace(CONTROL_CHARS, '').trim()
  if (!cleaned) return undefined
  return cleaned.length > MAX_HEADER_VALUE_LENGTH
    ? cleaned.slice(0, MAX_HEADER_VALUE_LENGTH)
    : cleaned
}

/**
 * 从入站头取「客户端形状」出站头。客户端没发任何可用值时返回空对象，
 * 调用方按「没发就不发」处理（undici 缺省值保持原样）。
 */
export function clientShapeHeaders(userAgent?: string | string[]): Record<string, string> {
  const ua = sanitizeHeaderValue(userAgent)
  return ua === undefined ? {} : { 'user-agent': ua }
}
