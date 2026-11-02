/**
 * Log text redaction shared by request logs, crash reports and attempt traces.
 *
 * Order matters: redact first, truncate second. Truncating first can cut a
 * credential in half, leaving a fragment that no longer matches any pattern.
 */

export function redactSensitiveText(value: string): string {
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

export function truncateText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return value
  if (maxChars <= 0) return undefined
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...[truncated ${value.length - maxChars} chars]`
}

/** Redact first, then truncate. `redact=false` is an explicit user opt-out. */
export function redactAndTruncate(
  value: string | undefined,
  maxChars: number,
  redact = true,
): string | undefined {
  if (value === undefined) return undefined
  return truncateText(redact ? redactSensitiveText(value) : value, maxChars)
}
