/**
 * 备份件的**落库前**形状清洗。
 *
 * 为什么必须有这一层：`data.json` 的读取侧只在少数几处做了归一（`config` 有
 * `normalizeConfig`，标记表有 `getUserModelMarks`），而供应商/账号是直接 `store.get()`
 * 拿去用的 —— 界面会立刻读 `p.headers`、`p.type`、`a.credentials`。一份手改过、或被
 * 别的版本写过的备份文件若缺这些字段，导入就把 `undefined` 铺进运行时，下一次点开
 * 供应商页就是整页崩，而不是「有一行数据不对」。
 *
 * 所以：**结构不合法的条目整条丢弃并计数**，合法的条目把必填标量补成安全缺省。
 * 计数回给 UI，用户能看到「导入了 12 个供应商，跳过 1 个」。
 */

import type { Account, AccountStatus, AuthType, Provider, ProviderType } from '../store/types'

const PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set(['builtin', 'custom', 'aggregate', 'account'])
const ACCOUNT_STATUSES: ReadonlySet<AccountStatus> = new Set(['active', 'inactive', 'expired', 'error'])

export interface SanitizeResult<T> {
  items: T[]
  /** 因结构不合法（缺 id / 不是对象 / 类型错误）被丢弃的条数。 */
  dropped: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {}
  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') record[key] = entry
  }
  return record
}

function asUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? { ...value } : undefined
}

export function sanitizeProviders(input: unknown): SanitizeResult<Provider> {
  const items: Provider[] = []
  let dropped = 0
  const list = Array.isArray(input) ? input : []

  for (const entry of list) {
    if (!isPlainObject(entry)) {
      dropped += 1
      continue
    }
    const id = asString(entry.id)
    if (id === '') {
      dropped += 1
      continue
    }
    const now = Date.now()
    const type = PROVIDER_TYPES.has(entry.type as ProviderType) ? (entry.type as ProviderType) : 'custom'
    items.push({
      ...entry,
      id,
      name: asString(entry.name, id),
      type,
      authType: asString(entry.authType, 'token') as AuthType,
      apiEndpoint: asString(entry.apiEndpoint),
      headers: asStringRecord(entry.headers),
      enabled: asBoolean(entry.enabled, true),
      createdAt: asNumber(entry.createdAt, now),
      updatedAt: asNumber(entry.updatedAt, now),
    } as Provider)
  }

  return { items, dropped }
}

/**
 * 账号清洗。`credentials` 必须在这里保留成**明文对象**：加密由调用方（备份服务）在
 * 落库前逐字段调用 `encryptCredentials` 完成 —— 放进本函数会让这个纯模块依赖
 * `safeStorage`，也就没法单测了。
 */
export function sanitizeAccounts(input: unknown): SanitizeResult<Account> {
  const items: Account[] = []
  let dropped = 0
  const list = Array.isArray(input) ? input : []

  for (const entry of list) {
    if (!isPlainObject(entry)) {
      dropped += 1
      continue
    }
    const id = asString(entry.id)
    const providerId = asString(entry.providerId)
    if (id === '' || providerId === '') {
      dropped += 1
      continue
    }
    const now = Date.now()
    items.push({
      ...entry,
      id,
      providerId,
      name: asString(entry.name, id),
      credentials: asStringRecord(entry.credentials),
      status: ACCOUNT_STATUSES.has(entry.status as AccountStatus)
        ? (entry.status as AccountStatus)
        : 'active',
      createdAt: asNumber(entry.createdAt, now),
      updatedAt: asNumber(entry.updatedAt, now),
    } as Account)
  }

  return { items, dropped }
}

/** 逐条保留 `plain object`（标记表、overrides、统计块等），非对象一律换成空表。 */
export function sanitizeRecord(input: unknown): Record<string, unknown> {
  return asUnknownRecord(input) ?? {}
}

/** 数组里只留 `plain object` 条目；用于 adopted 台账、日志等只被回读、不被逐字段读取的表。 */
export function sanitizeObjectArray(input: unknown): Record<string, unknown>[] {
  const list = Array.isArray(input) ? input : []
  return list.filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
}

/** 请求日志的最小外形：`id` 与 `timestamp` 齐了才可能在列表里被渲染与排序。 */
export function sanitizeRequestLogRows(input: unknown): Record<string, unknown>[] {
  return sanitizeObjectArray(input).filter(
    (entry) => typeof entry.id === 'string' && typeof entry.timestamp === 'number',
  )
}

/** 应用日志同理：`level` / `message` / `timestamp` 是列表渲染的三个必读字段。 */
export function sanitizeAppLogRows(input: unknown): Record<string, unknown>[] {
  return sanitizeObjectArray(input).filter(
    (entry) =>
      typeof entry.timestamp === 'number' &&
      typeof entry.message === 'string' &&
      typeof entry.level === 'string',
  )
}
