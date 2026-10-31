/**
 * Endpoint 校验策略
 *
 * 供应商的 endpoint 必须是 http(s)。「走本机运行时、endpoint 只是占位 scheme」那一档
 * 已于 2026-11-01 随 OpenCode 内置供应商一起退役，所以这里不再有任何例外。
 */

export interface EndpointValidation {
  valid: boolean
  errors: string[]
}

export function validateApiEndpoint(endpoint: string): EndpointValidation {
  const errors: string[] = []
  const value = (endpoint ?? '').trim()

  if (!value) {
    errors.push('API endpoint cannot be empty')
    return { valid: false, errors }
  }

  try {
    new URL(value)
  } catch {
    errors.push('Invalid API endpoint format')
  }

  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    errors.push('API endpoint must start with http:// or https://')
  }

  return { valid: errors.length === 0, errors }
}
