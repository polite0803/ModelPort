import { isChannelCredentialFailure, isChannelRiskControlFailure } from './failover.ts'
import type { UpstreamErrorDetails } from './types.ts'

export type ErrorProtocol = 'openai' | 'anthropic'

/**
 * 错误体里的标准类型。只有上游给出的 type 落在这一组里才原样透传；
 * 其余（例如 Gemini 的 `INVALID_ARGUMENT`、Claude 信封的 `error`）按状态码兜底，
 * 避免把上游的私有枚举塞进客户端不认识的字段。
 */
const STANDARD_ERROR_TYPES = new Set([
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'not_found_error',
  'rate_limit_error',
  'api_error',
  'overloaded_error',
  'timeout_error',
  'request_too_large',
  'server_error',
])

/**
 * 渠道包（`vendor/channel-pack`）自己的机读码 → 客户端认识的那一套。
 *
 * 包里 `QUOTA_EXCEEDED` 同时表示「模型当天额度用完」与「可用账号都在限流中」，
 * 对客户端是同一件事：这一档现在用不了，要么等解禁，要么换一条。旧路径只把
 * 中文散文塞进 5xx `api_error`，客户端读成服务端故障，对同一个模型反复重试。
 * 这些情况没有上游 HTTP 事实，`status` 是包自己兜的 502 —— 按 429 交出去。
 */
const CHANNEL_PACK_ERROR_CODES: Record<string, { code: string; status?: number }> = {
  QUOTA_EXCEEDED: { code: 'insufficient_quota', status: 429 },
  RATE_LIMIT: { code: 'rate_limit_exceeded', status: 429 },
}

export interface MappedUpstreamError {
  status: number
  type: string
  message: string
  param: string | null
  code: string | number | null
  metadata?: unknown
  retryAfter?: string
}

/** 旧的二元映射保留给只拿得到 status/message 的调用点。 */
export interface UpstreamErrorShape {
  status: number
  type: string
  code: string | null
}

function normalizeStatus(status?: number): number {
  if (status === undefined || !Number.isFinite(status)) return 500
  const value = Math.trunc(status)
  if (value >= 400 && value <= 599) return value
  // 上游给 2xx/3xx 说明问题不在 HTTP 层（例如流已经坏了），按网关错误收口。
  return value >= 200 && value < 400 ? 502 : 500
}

function fallbackType(status: number, protocol: ErrorProtocol): string {
  if (status === 401) return 'authentication_error'
  if (status === 403) return 'permission_error'
  if (status === 404) return 'not_found_error'
  if (status === 413) return protocol === 'anthropic' ? 'request_too_large' : 'invalid_request_error'
  if (status === 408 || status === 504) return protocol === 'anthropic' ? 'timeout_error' : 'api_error'
  if (status === 429) return 'rate_limit_error'
  if (status === 529) return protocol === 'anthropic' ? 'overloaded_error' : 'api_error'
  if (status >= 500) return 'api_error'
  return 'invalid_request_error'
}

/**
 * 把一次转发失败映射成客户端可见的错误。
 *
 * 三条纪律：
 * 1. **不重写上游状态码**（除了明显不是 HTTP 错误的 2xx/3xx）：403 就是 403，
 *    客户端据此区分「没权限」与「凭据不对」；旧实现把两者都改成 401，会让客户端
 *    去轮换自己的 Key。
 * 2. 上游给了标准 `type` 就透传；`code/param/metadata` 同理。只有上游没给时才
 *    按状态码兜底。
 * 3. 本仓自己的两条机读信号优先：风控与渠道凭据失效要能稳定匹配，即使上游换了
 *    状态码或文案。
 */
export function mapForwardFailure(
  input: {
    status?: number
    message?: string
    details?: UpstreamErrorDetails
    retryAfter?: string
  },
  protocol: ErrorProtocol = 'openai',
): MappedUpstreamError {
  const status = normalizeStatus(input.status)
  const message =
    (input.details?.message ?? input.message ?? '').trim() || `HTTP ${status}`
  const upstreamType = input.details?.type?.trim().toLowerCase()

  const rawCode = input.details?.code ?? null
  const channelCode = typeof rawCode === 'string' ? CHANNEL_PACK_ERROR_CODES[rawCode] : undefined
  // 只上调「包自己合成的 5xx」：上游真给了 4xx 就保留它的状态码与语义。
  const effectiveStatus =
    channelCode?.status !== undefined && status >= 500 ? channelCode.status : status

  let code: string | number | null = channelCode ? channelCode.code : rawCode
  if (isChannelRiskControlFailure(message)) {
    code = 'channel_risk_control'
  } else if (effectiveStatus >= 500 && isChannelCredentialFailure(message)) {
    code = 'channel_relogin_required'
  } else if (code === null && (effectiveStatus === 401 || effectiveStatus === 403)) {
    // 上游没给机读 code 时，至少让客户端能区分这是「上游凭据」而不是它自己的 Key。
    code = 'upstream_unauthorized'
  } else if (code === null && effectiveStatus === 429) {
    code = 'rate_limit_exceeded'
  }

  return {
    status: effectiveStatus,
    type:
      upstreamType !== undefined && STANDARD_ERROR_TYPES.has(upstreamType)
        ? upstreamType
        : fallbackType(effectiveStatus, protocol),
    message,
    param: input.details?.param ?? null,
    code,
    ...(input.details?.metadata === undefined ? {} : { metadata: input.details.metadata }),
    ...(input.retryAfter === undefined ? {} : { retryAfter: input.retryAfter }),
  }
}

/** 兼容旧调用点：只有 status/message，没有结构化错误体。 */
export function mapUpstreamError(status?: number, message?: string): UpstreamErrorShape {
  const mapped = mapForwardFailure({ status, message })
  return { status: mapped.status, type: mapped.type, code: typeof mapped.code === 'string' ? mapped.code : null }
}

/**
 * 让客户端贴给用户的错误文案里带请求 id。
 *
 * new-api 的同类做法：错误 message 末尾统一带 request id。否则客户端只把 body
 * 贴出来时，服务端日志里根本对不上是哪一笔。
 */
export function withRequestId(message: string, requestId: string): string {
  if (!requestId || message.includes(requestId)) return message
  return `${message} [request_id: ${requestId}]`
}

export function buildStreamErrorFrame(
  message: string,
  extra?: { type?: string; code?: string | number | null; param?: string | null },
): string {
  return `data: ${JSON.stringify({
    error: {
      message,
      type: extra?.type ?? 'api_error',
      param: extra?.param ?? null,
      code: extra?.code ?? null,
    },
  })}\n\n`
}

export function retryAfterHeader(headers?: Record<string, unknown>): string | undefined {
  if (!headers) return undefined
  const value = headers['retry-after'] ?? headers['Retry-After']
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  return text || undefined
}
