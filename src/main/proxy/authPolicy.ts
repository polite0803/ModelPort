import { createHash, timingSafeEqual } from 'crypto'

export interface ApiKeyRecord {
  key: string
  enabled: boolean
}

export const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'] as const

// `Anthropic-Version` / `Anthropic-Beta` 只服务于 `/v1/messages` 的浏览器侧预检，
// 对 OpenAI 客户端没有影响（多放行两个头不放宽任何鉴权）。
const LOOPBACK_HEADERS =
  'Content-Type, Authorization, X-Requested-With, X-API-Key, X-Management-Secret, Anthropic-Version, Anthropic-Beta'

export function isLoopbackHost(host?: string): boolean {
  if (!host) return false
  return (LOOPBACK_HOSTS as readonly string[]).includes(host)
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return isLoopbackHost(hostname) || hostname === '[::1]'
  } catch {
    return false
  }
}

export function safeKeyEquals(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

export function activeApiKeys(apiKeys?: ApiKeyRecord[]): ApiKeyRecord[] {
  return (apiKeys ?? []).filter((entry) => entry.enabled && typeof entry.key === 'string' && entry.key.length > 0)
}

export function requiresApiKey(apiKeys?: ApiKeyRecord[]): boolean {
  return activeApiKeys(apiKeys).length > 0
}

/**
 * Reads the key a client sent.
 *
 * The scheme name is case-insensitive (RFC 7235), and some desktop clients ship
 * the user's pasted value verbatim, quotes included, so both are normalised here
 * instead of failing an otherwise valid key.
 */
export function extractApiKey(input: { authorization?: string; xApiKey?: string }): string | null {
  const authorization = (input.authorization ?? '').trim()
  const bearer = /^bearer\s+(.+)$/i.exec(authorization)
  if (bearer) {
    const key = stripWrappingQuotes((bearer[1] ?? '').trim())
    return key === '' ? null : key
  }
  const headerKey = stripWrappingQuotes((input.xApiKey ?? '').trim())
  return headerKey === '' ? null : headerKey
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) return value
  const first = value.charAt(0)
  if ((first === '"' || first === "'") && value.charAt(value.length - 1) === first) {
    return value.slice(1, -1).trim()
  }
  return value
}

export type ApiKeyAuthOutcome = 'allow' | 'missing_key' | 'invalid_key'

export function evaluateApiKeyAuth(input: {
  apiKeys?: ApiKeyRecord[]
  providedKey?: string | null
}): ApiKeyAuthOutcome {
  const keys = activeApiKeys(input.apiKeys)
  if (keys.length === 0) return 'allow'
  if (!input.providedKey) return 'missing_key'
  return keys.some((entry) => safeKeyEquals(entry.key, input.providedKey as string)) ? 'allow' : 'invalid_key'
}

export function checkStartupSecurity(input: { apiKeys?: ApiKeyRecord[]; host: string }): { ok: boolean; reason?: string } {
  if (requiresApiKey(input.apiKeys)) return { ok: true }
  if (isLoopbackHost(input.host)) return { ok: true }
  return { ok: false, reason: 'api_key_required_for_non_loopback_listen' }
}

/**
 * 跨域可读的判定。
 *
 * 曾经有一条「没配 Key 就回 `*`」的分支：出厂默认就是没有 Key，于是用户浏览器里打开的
 * 任何网页都能 `fetch` 这台机器上的代理并**读走完整响应** —— 把用户的机器当免费 LLM 网关，
 * 顺带烧掉他的上游配额。现在只回显回环来源：本机起的 Web 客户端（`http://localhost:xxxx`、
 * `http://127.0.0.1:xxxx`）照常工作，公网页面拿不到 `Access-Control-Allow-Origin`，
 * 浏览器侧就读不到响应。
 */
export function resolveCorsOrigin(input: { origin?: string }): string | null {
  if (input.origin && isLoopbackOrigin(input.origin)) return input.origin
  return null
}

export function corsAllowHeaders(): string {
  return LOOPBACK_HEADERS
}
