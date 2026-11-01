/**
 * 自定义厂商配置的导出/导入策略（纯函数，供主进程与测试共用）。
 *
 * `credentials` 从来不在导出件里，但用户把 Key 写进自定义头（`x-api-key: sk-...` 是最自然
 * 的一种写法）时，`headers` 会把同一把凭据原样带出去 —— 而导出件的设计用途就是发给别人或
 * 贴进 issue。所以导出按头名与值形态两处替换成占位串，导入时把占位串丢了：它不代表任何真实
 * 凭据，接进去只会让每个请求带着一把注定 401 的「Key」。
 */
export const REDACTED_HEADER_VALUE = '<REDACTED>'

const SECRET_HEADER_NAME = /(^|[-_])(key|token|secret|authorization|cookie|password)([-_]|$)/i
const SECRET_HEADER_VALUE = /\b(?:sk|mgmt)-[A-Za-z0-9_-]{8,}\b/i

export function redactSecretHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers
  const sanitized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    sanitized[name] =
      SECRET_HEADER_NAME.test(name) || SECRET_HEADER_VALUE.test(value) ? REDACTED_HEADER_VALUE : value
  }
  return sanitized
}

export function stripRedactedHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === REDACTED_HEADER_VALUE) continue
    kept[name] = value
  }
  return kept
}
