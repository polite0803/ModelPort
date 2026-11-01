import { isChannelCredentialFailure } from './failover.ts'

export interface UpstreamErrorShape {
  status: number
  type: string
  code: string | null
}

export function mapUpstreamError(status?: number, message?: string): UpstreamErrorShape {
  if (status === 401 || status === 403) {
    return { status: 401, type: 'authentication_error', code: 'upstream_unauthorized' }
  }
  if (status === 429) {
    return { status: 429, type: 'rate_limit_error', code: 'rate_limit_exceeded' }
  }
  // 渠道凭据失效单独给一个 `code`，但**状态仍是 502、type 仍是 `api_error`**：
  // 401/403 在本代理里说的是「调用方的 API Key 不对」，把「得有人去应用里重新登录」
  // 报成 401 会让客户端去轮换它自己的 Key —— 那正好是这条错误最不该触发的动作。
  // 文案保留渠道原文（可 grep），可机读的处置放在 `code` 里。
  if (status !== undefined && status >= 500 && isChannelCredentialFailure(message)) {
    return { status, type: 'api_error', code: 'channel_relogin_required' }
  }
  if (status && status >= 400 && status < 500) {
    return { status, type: 'invalid_request_error', code: null }
  }
  if (status && status >= 500) {
    return { status, type: 'api_error', code: null }
  }
  return { status: 500, type: 'api_error', code: null }
}

export function buildStreamErrorFrame(message: string): string {
  return `data: ${JSON.stringify({
    error: {
      message,
      type: 'api_error',
      code: null,
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
