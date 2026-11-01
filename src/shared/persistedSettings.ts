/**
 * 渲染层持久化与导出件的唯一权威定义。
 *
 * 为什么要抽到这里：`config`（含 `apiKeys[].key`、`managementApi.managementApiSecret`）
 * 曾经被 zustand 整体写进 `localStorage['modelport-settings']`，而「导出配置」又把这一串
 * 原样打进一个 JSON 文件交付给用户。主进程那份 `data.json` 是整文件加密的，浏览器存储这一份
 * 没有任何保护层 —— 同一个键被三处代码用字面量各写一次，改名还会让导出/导入静默错位。
 *
 * 所以白名单里只放与凭据无关的界面偏好，其余键（`config` 及任何未登记的新键）不落盘、
 * 不出门、不导入。
 */

export const SETTINGS_STORAGE_KEY = 'modelport-settings'
export const LEGACY_SETTINGS_STORAGE_KEY = 'chat2api-settings'

/** 允许进 localStorage / 导出件的界面偏好。 */
export const PERSISTED_PREFERENCE_KEYS = [
  'theme',
  'sidebarCollapsed',
  'proxyEnabled',
  'oauthProxyMode',
  'language',
  'autoStart',
  'autoStartProxy',
  'minimizeToTray',
  'closeBehavior',
  'enableNotifications',
  'logLevel',
  'logRetentionDays',
  'maxLogs',
] as const

export type PersistedPreferenceKey = (typeof PERSISTED_PREFERENCE_KEYS)[number]

export type PersistedPreferences = Partial<Record<PersistedPreferenceKey, string | number | boolean>>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 只挑出白名单里的键。函数、`config` 和任何未登记的键都会被丢掉 —— 新增偏好时必须先在
 * `PERSISTED_PREFERENCE_KEYS` 里登记，否则它不会被持久化（而不是被顺带持久化）。
 */
export function pickPersistedPreferences(state: unknown): PersistedPreferences {
  if (!isPlainObject(state)) return {}
  const picked: PersistedPreferences = {}
  for (const key of PERSISTED_PREFERENCE_KEYS) {
    const value = state[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      picked[key] = value
    }
  }
  return picked
}

/**
 * zustand persist 的落盘形状是 `{ state, version }`。这里同时接受裸偏好对象，是为了让
 * 历史版本留下的、以及用户手工编辑过的串都能被安全收敛，而不是原样灌回运行时。
 * 既不是信封也不是普通对象（数组、`null`、数字、字符串）的一律判为不可用。
 */
function unwrapPersistedBlob(parsed: unknown): { state: unknown; version: number } | null {
  if (!isPlainObject(parsed)) return null
  if ('state' in parsed) {
    return { state: parsed.state, version: typeof parsed.version === 'number' ? parsed.version : 0 }
  }
  return { state: parsed, version: 0 }
}

/**
 * 把一串持久化文本收敛成「只剩界面偏好」的 zustand 落盘形状。
 * 解析不了或形状不对就返回 `null`，让调用方明确失败而不是写回半份数据。
 */
export function sanitizePersistedSettings(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const unwrapped = unwrapPersistedBlob(parsed)
  if (unwrapped === null) return null
  return JSON.stringify({ state: pickPersistedPreferences(unwrapped.state), version: unwrapped.version })
}

/** 判断一串持久化文本里是否带着不该出现的高危键，供导入侧显式拒绝而不是静默清洗。 */
export function containsPersistedSecrets(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string' || raw.trim() === '') return false
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  const unwrapped = unwrapPersistedBlob(parsed)
  if (unwrapped === null || !isPlainObject(unwrapped.state)) return false
  const state = unwrapped.state
  if ('config' in state) return true
  return Object.keys(state).some((key) => !PERSISTED_PREFERENCE_KEYS.includes(key as PersistedPreferenceKey))
}

export interface ExportEnvelope {
  version: string
  exportedAt: string
  settings: string
}

/**
 * 导出件的结构：`{ version, exportedAt, settings }`，其中 `settings` 是已清洗过的偏好串。
 * 解析失败或结构不符返回 `null`，由调用方给出具体错误而不是 `undefined` 兜底。
 */
export function parseExportEnvelope(text: string): ExportEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  if (typeof parsed.exportedAt !== 'string' || typeof parsed.version !== 'string') return null
  const settings = parsed.settings
  if (typeof settings === 'string') {
    // 交回的是清洗后的那份，不是文件里的原始串 —— 老导出件的 settings 里带着整个
    // `config`（含上游 Key），原样写回 localStorage 就是把缺陷又搬回运行时。
    const cleaned = sanitizePersistedSettings(settings)
    return cleaned === null ? null : { version: parsed.version, exportedAt: parsed.exportedAt, settings: cleaned }
  }
  // 兼容「settings 直接写成对象」的手工编辑件：收敛成同一份清洗结果再交回。
  const cleaned = sanitizePersistedSettings(JSON.stringify(settings))
  return cleaned === null ? null : { version: parsed.version, exportedAt: parsed.exportedAt, settings: cleaned }
}

export function buildExportEnvelope(version: string, settings: string): ExportEnvelope {
  return { version, exportedAt: new Date().toISOString(), settings }
}
