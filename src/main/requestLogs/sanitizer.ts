import type { RequestLogEntry } from '../store/types.ts'
import type { RequestLogConfig } from './types.ts'

export function sanitizeRequestLogEntry(
  entry: Omit<RequestLogEntry, 'id'>,
  config: RequestLogConfig,
): Omit<RequestLogEntry, 'id'> {
  const sanitized: Omit<RequestLogEntry, 'id'> = {
    ...entry,
    userInput: truncateText(redactText(entry.userInput, config), 500),
    errorStack: undefined,
  }

  if (!config.includeBodies) {
    sanitized.requestBody = undefined
    sanitized.responseBody = undefined
    sanitized.responsePreview = truncateText(redactText(entry.responsePreview, config), 1000)
    sanitized.errorMessage = truncateText(redactText(entry.errorMessage, config), 1000)
    return sanitized
  }

  sanitized.requestBody = sanitizeRequestLogBody(entry.requestBody, config)
  sanitized.responseBody = sanitizeRequestLogBody(entry.responseBody, config)
  sanitized.responsePreview = truncateText(redactText(entry.responsePreview, config), 1000)
  sanitized.errorMessage = truncateText(redactText(entry.errorMessage, config), 1000)

  return sanitized
}

/**
 * An update is a partial patch, so only the keys it actually carries may be
 * re-sanitized. Deriving every field from `updates` (as this used to) writes
 * `undefined` over fields the patch never mentioned - a stream-end update that
 * only has the response body would erase the user input recorded at insert.
 */
export function sanitizeRequestLogUpdates(
  updates: Partial<RequestLogEntry>,
  config: RequestLogConfig,
): Partial<RequestLogEntry> {
  const sanitized: Partial<RequestLogEntry> = { ...updates }

  if ('userInput' in updates) {
    sanitized.userInput = truncateText(redactText(updates.userInput, config), 500)
  }

  if ('errorStack' in updates) {
    sanitized.errorStack = undefined
  }

  if ('requestBody' in updates) {
    sanitized.requestBody = config.includeBodies
      ? sanitizeRequestLogBody(updates.requestBody, config)
      : undefined
  }

  if ('responseBody' in updates) {
    sanitized.responseBody = config.includeBodies
      ? sanitizeRequestLogBody(updates.responseBody, config)
      : undefined
  }

  if ('responsePreview' in updates) {
    sanitized.responsePreview = truncateText(redactText(updates.responsePreview, config), 1000)
  }

  if ('errorMessage' in updates) {
    sanitized.errorMessage = truncateText(redactText(updates.errorMessage, config), 1000)
  }

  return sanitized
}

export function trimRequestLogsToMaxEntries(
  entries: RequestLogEntry[],
  config: RequestLogConfig,
): RequestLogEntry[] {
  const maxEntries = Math.max(0, config.maxEntries)
  if (maxEntries === 0) {
    return []
  }

  if (entries.length <= maxEntries) {
    return entries
  }

  return entries.slice(entries.length - maxEntries)
}

function sanitizeRequestLogBody(value: string | undefined, config: RequestLogConfig): string | undefined {
  if (!value) return value

  const redacted = config.redactSensitiveData ? redactSensitiveText(value) : value
  return truncateText(redacted, config.maxBodyChars)
}

function truncateText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return value
  if (maxChars <= 0) return undefined
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...[truncated ${value.length - maxChars} chars]`
}

/**
 * 日志文本一律「先脱敏、再截断」。先截断会把凭据从中间切断，剩下的片段既不成字段名
 * 形态也不成完整 token，正则就放过去了 —— 而 `errorMessage` 恰恰是最常见的泄密面：
 * 上游 401 的响应体通常直接带上用户那把 Key 的片段。
 *
 * 开关沿用 `redactSensitiveData`（出厂为 `true`）：关掉它是用户明确的自选，不是默认。
 */
function redactText(value: string | undefined, config: RequestLogConfig): string | undefined {
  if (value === undefined) return value
  return config.redactSensitiveData ? redactSensitiveText(value) : value
}

function redactSensitiveText(value: string): string {
  return (
    value
      // 1. 「字段名 + 分隔符 + 值」：含带 X- 前缀的会话/凭据头名。
      .replace(
        /(\"?(?:authorization|x-[a-z0-9-]*(?:key|token|secret)|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?key|cookie|set-cookie|password|secret|token)\"?\s*[:=]\s*)\"?[^\",}\]\s]+\"?/gi,
        '$1"[REDACTED]"',
      )
      // 2. 独立的 `Bearer <token>`，句子中间出现的那种。
      .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]{8,}=*/gi, 'Bearer [REDACTED]')
      // 3. 裸 key 形态（sk- / sk-proj- / sk-ant- …），不依赖任何字段名。
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
      // 4. URL 查询串里的凭据。
      .replace(/([?&](?:key|token|api_key|access_token|secret)=)[^&\s\"']+[^&\s\"']*/gi, '$1[REDACTED]')
  )
}
