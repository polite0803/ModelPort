/**
 * 通用脱敏工具——用于日志、审计、HTTP 响应体
 *
 * SENSITIVE_KEYS 定义了哪些字段/键会被脱敏为 "***"。
 * 所有嵌套对象/数组会递归应用同一规则。
 *
 * 使用约定：
 * - 顶层 key 在 SENSITIVE_KEYS 中 → value 变 "***"
 * - key === "apiKeys" 时 → 数组项的 "key" 属性被脱敏
 * - managementApi.managementApiSecret 被脱敏
 * - 任意其它深层键遵循同一模式
 */
export const SENSITIVE_KEYS = new Set([
  'managementApiSecret',
  'apiKey',
  'apiKeysSecret',
  'accessToken',
  'refreshToken',
  'token',
  'password',
  'secret',
  'credentials',
])

/**
 * 脱敏单个值——`SENSITIVE_KEYS` 里的键整值替换为 `"***"`；其余值按
 * {@link maskNode} 递归下钻。
 *
 * 递归这一步不是可选的：`GET /v1/management/config/:key` 就靠它读单格
 * （`managementApi` 这一格里躺着 `managementApiSecret`）。只对字符串判键名
 * 会把整格原样吐回去 —— 密钥从单键出口泄露，而列表出口是干净的。
 */
export function maskSensitiveValue(value: unknown, key?: PropertyKey): unknown {
  if (typeof key === 'string' && SENSITIVE_KEYS.has(key)) {
    return '***'
  }
  return maskNode(value)
}

function maskNode(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(item => maskNode(item))
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      // 整个值替换为 "***" 且不再向下递归：`credentials` 的内层键是用户自定义
      // 字段名，逐层递归会把内层值当普通字符串原样吐出来。
      result[key] = '***'
      continue
    }
    if (key === 'apiKeys' && Array.isArray(value)) {
      // 结构特例：只脱敏 key，保留 id/name，日志仍然可读。
      result[key] = value.map(item =>
        item !== null && typeof item === 'object'
          ? { ...(item as Record<string, unknown>), key: '***' }
          : item,
      )
      continue
    }
    result[key] = maskNode(value)
  }
  return result
}

/**
 * 脱敏对象——递归遍历所有可枚举键，敏感键替换为 `"***"`。
 * 数组按元素逐个处理，结构保持不变。
 */
export function maskSensitiveObject(obj: Record<string, unknown>): Record<string, unknown> {
  return maskNode(obj) as Record<string, unknown>
}

/**
 * 脱敏配置对象——等价于 `maskSensitiveObject`，为调用点提供语义化命名。
 */
export function maskConfig(config: unknown): unknown {
  return maskNode(config)
}