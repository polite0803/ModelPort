import type { RequestAttemptTrace, RequestLogEntry, RequestStreamTrace } from '../../shared/types.ts'
import { DEFAULT_MAX_BODY_CHARS, type RequestLogConfig } from './types.ts'
import { redactAndTruncate, redactSensitiveText, truncateText } from '../../shared/logging/redaction.ts'

/** 栈只对错误行有用；16KB 足够看清调用链，又不至于让一行日志变成整份 bundle。 */
const MAX_ERROR_STACK_CHARS = 16_000
/** 一次请求最多留这么多尝试；正常候选链 ≤ 6，留余量只为异常循环。 */
const MAX_ATTEMPTS = 12
const MAX_ATTEMPT_MESSAGE_CHARS = 500
const MAX_UPSTREAM_REQUEST_ID_CHARS = 200
/** 错误行保底条数：普通成功行再多也不能把要查的那条错误挤掉。 */
export const REQUEST_ERROR_LOG_RETENTION = 100

export function sanitizeRequestLogEntry(
  entry: Omit<RequestLogEntry, 'id'>,
  config: RequestLogConfig,
): Omit<RequestLogEntry, 'id'> {
  const sanitized: Omit<RequestLogEntry, 'id'> = {
    ...entry,
    userInput: truncateText(redactText(entry.userInput, config), 500),
    errorStack: sanitizeErrorStack(entry.errorStack, config),
    attempts: sanitizeAttempts(entry.attempts, config),
    streamTrace: sanitizeStreamTrace(entry.streamTrace),
    ...(entry.upstreamRequestId === undefined
      ? {}
      : { upstreamRequestId: entry.upstreamRequestId.slice(0, MAX_UPSTREAM_REQUEST_ID_CHARS) }),
    ...(entry.userAgent === undefined
      ? {}
      : { userAgent: truncateText(redactText(entry.userAgent, config), 300) }),
  }

  if (!config.includeBodies && entry.captureBodies !== true) {
    sanitized.requestBody = undefined
    sanitized.responseBody = undefined
    sanitized.responsePreview = truncateText(redactText(entry.responsePreview, config), 1000)
    sanitized.errorMessage = truncateText(redactText(entry.errorMessage, config), 1000)
    return sanitized
  }

  const bodyConfig = entry.captureBodies === true && config.maxBodyChars <= 0
    ? { ...config, maxBodyChars: DEFAULT_MAX_BODY_CHARS }
    : config
  sanitized.requestBody = sanitizeRequestLogBody(entry.requestBody, bodyConfig)
  sanitized.responseBody = sanitizeRequestLogBody(entry.responseBody, bodyConfig)
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
  forceBodies = false,
): Partial<RequestLogEntry> {
  const sanitized: Partial<RequestLogEntry> = { ...updates }

  if ('userInput' in updates) {
    sanitized.userInput = truncateText(redactText(updates.userInput, config), 500)
  }

  if ('errorStack' in updates) {
    sanitized.errorStack = sanitizeErrorStack(updates.errorStack, config)
  }

  if ('attempts' in updates) {
    sanitized.attempts = sanitizeAttempts(updates.attempts, config)
  }

  if ('streamTrace' in updates) {
    sanitized.streamTrace = sanitizeStreamTrace(updates.streamTrace)
  }

  if ('upstreamRequestId' in updates) {
    sanitized.upstreamRequestId = updates.upstreamRequestId?.slice(0, MAX_UPSTREAM_REQUEST_ID_CHARS)
  }

  if ('userAgent' in updates) {
    sanitized.userAgent = truncateText(redactText(updates.userAgent, config), 300)
  }

  const bodyConfig = forceBodies && config.maxBodyChars <= 0
    ? { ...config, maxBodyChars: DEFAULT_MAX_BODY_CHARS }
    : config

  if ('requestBody' in updates) {
    sanitized.requestBody = config.includeBodies || forceBodies
      ? sanitizeRequestLogBody(updates.requestBody, bodyConfig)
      : undefined
  }

  if ('responseBody' in updates) {
    sanitized.responseBody = config.includeBodies || forceBodies
      ? sanitizeRequestLogBody(updates.responseBody, bodyConfig)
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

  // Recent rows plus an error floor: a burst of successful traffic must not
  // evict the one failure we need to diagnose.
  const keptIds = new Set(entries.slice(entries.length - maxEntries).map((entry) => entry.id))
  for (const entry of entries.filter((entry) => entry.status === 'error').slice(-REQUEST_ERROR_LOG_RETENTION)) {
    keptIds.add(entry.id)
  }
  return entries.filter((entry) => keptIds.has(entry.id))
}

function sanitizeErrorStack(
  stack: string | undefined,
  config: RequestLogConfig,
): string | undefined {
  return redactAndTruncate(stack, MAX_ERROR_STACK_CHARS, config.redactSensitiveData)
}

function sanitizeAttempts(
  attempts: RequestAttemptTrace[] | undefined,
  config: RequestLogConfig,
): RequestAttemptTrace[] | undefined {
  if (!Array.isArray(attempts) || attempts.length === 0) return undefined
  return attempts.slice(-MAX_ATTEMPTS).map((attempt) => ({
    ...attempt,
    errorMessage: redactAndTruncate(
      attempt.errorMessage,
      MAX_ATTEMPT_MESSAGE_CHARS,
      config.redactSensitiveData,
    ),
    ...(typeof attempt.errorCode === 'string'
      ? {
          errorCode: redactAndTruncate(
            attempt.errorCode,
            MAX_ATTEMPT_MESSAGE_CHARS,
            config.redactSensitiveData,
          ) ?? null,
        }
      : {}),
  }))
}

function sanitizeStreamTrace(trace: RequestStreamTrace | undefined): RequestStreamTrace | undefined {
  if (!trace) return undefined
  return {
    ...trace,
    ...(trace.upstreamRequestId === undefined
      ? {}
      : { upstreamRequestId: trace.upstreamRequestId.slice(0, MAX_UPSTREAM_REQUEST_ID_CHARS) }),
  }
}

function sanitizeRequestLogBody(value: string | undefined, config: RequestLogConfig): string | undefined {
  if (!value) return value

  const redacted = config.redactSensitiveData ? redactSensitiveText(value) : value
  return truncateText(redacted, config.maxBodyChars)
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
