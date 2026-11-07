/**
 * 官方 Trae 客户端缓存的模型目录（`model_list_map`）。
 *
 * ## 为什么需要它（2026-11-08 实测）
 *
 * 本插件走 HTTP `/api/ide/v1/batch_get_detail_param` 取目录，而官方客户端
 * 2026-11 起改走 RPC `service:model / method:model_list_by_function`。实测同一
 * 账号：batch 端点只回 22 个 function 的**空组** + 少量自定义模型
 * （`config_source: 3`），官方客户端缓存里却有 `solo_agent` 21 条真实模型
 * （`config_source: 1`）。于是「刷新模型清单」拿到的目录是空的，而聊天通道
 * 本身仍然可用 —— 典型的「网关看不见但上游能用」。
 *
 * 官方 RPC 走 Trae 自己的连接层（不是普通 HTTP），无法从网关直连。这里退一步：
 * **读官方客户端已经拉下来的缓存**（`state.vscdb` 的 `ItemTable`），它和
 * `product.json` 一样属于「本机安装」来源，且比代码里的静态表新。
 *
 * ## 边界
 *
 * - 只在 `node:sqlite` 可用时工作（Node ≥ 22.5；WSL 守护进程满足，Electron 33
 *   的 Node 20 不满足）—— 不可用时静默返回空，由适配器的静态兜底接管；
 * - **只读**：以 `readOnly` 打开，不写官方客户端的库；
 * - 只认 `config_source === 1`（官方预置）的条目；自定义模型（3）仍需用户
 *   在 IDE 内绑定供应商，本插件调不通，与 batch 解析器的 `isCustomModel` 同口径。
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mergeTraeModels, type TraeRemoteModel } from './trae.js'
import { TRAE_CHANNELS } from './trae-product.js'

const MODEL_MAP_KEY = 'AI.agent.model.model_list_map'
/** 缓存读取结果在内存里复用一小段时间：适配器本身也有 5 分钟目录缓存。 */
const CACHE_TTL_MS = 5 * 60_000

interface CachedRead {
  at: number
  models: TraeRemoteModel[]
}

const readCache = new Map<string, CachedRead>()

/** 官方客户端的 `state.vscdb` 候选路径（Windows / WSL 的 Windows 侧 / macOS）。 */
export function traeStateDbCandidates(): string[] {
  const out = new Set<string>()
  const override = process.env.MODELPORT_TRAE_STATE_DB?.trim()
  if (override !== undefined && override !== '') out.add(override)

  const appDataRoots = new Set<string>()
  const appData = process.env.APPDATA
  if (appData !== undefined && appData !== '') appDataRoots.add(appData)
  if (process.platform !== 'win32') {
    // WSL：官方客户端装在 Windows 侧，守护进程通过 /mnt/c 读它。
    const users = '/mnt/c/Users'
    try {
      for (const user of readdirSync(users)) {
        appDataRoots.add(join(users, user, 'AppData', 'Roaming'))
      }
    } catch {
      // 不是 WSL / 没挂 C:：只剩 macOS 路径。
    }
    appDataRoots.add(join(homedir(), 'Library', 'Application Support'))
  }
  for (const root of appDataRoots) {
    for (const product of ['Trae CN', 'Trae']) {
      out.add(join(root, product, 'User', 'globalStorage', 'state.vscdb'))
    }
  }
  return [...out]
}

interface SqliteRow {
  value?: unknown
}
interface SqliteStatement {
  get(...params: unknown[]): unknown
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  close(): void
}
interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase
}

/**
 * 动态取 `node:sqlite`：Electron 33（Node 20）没有该内置模块，不能静态 import。
 * 用变量拼模块名，避免打包器把它解析成构建期依赖。
 */
async function loadSqlite(): Promise<SqliteModule | undefined> {
  const name = 'node:sqlite'
  try {
    return await import(name) as unknown as SqliteModule
  } catch {
    return undefined
  }
}

function readRowText(row: unknown): string | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const value = (row as SqliteRow).value
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return undefined
}

function readMapForUid(db: SqliteDatabase, uid: string): unknown {
  for (const key of [`${uid}:${MODEL_MAP_KEY}`, `${uid}_${MODEL_MAP_KEY}`, MODEL_MAP_KEY]) {
    const text = readRowText(db.prepare('select value from ItemTable where key = ?').get(key))
    if (text === undefined) continue
    try {
      return JSON.parse(text) as unknown
    } catch {
      // 损坏/半写入：换下一个 key。
    }
  }
  return undefined
}

/**
 * 读取任一账号 UID 对应的官方缓存目录；读不到返回空数组（不抛错）。
 *
 * `uids` 来自账号池：不同账号的缓存新鲜度不同，按顺序取第一份非空目录。
 */
export async function readTraeCachedModels(
  uids: readonly string[],
  channelPriority: readonly string[] = TRAE_CHANNELS,
): Promise<TraeRemoteModel[]> {
  const wanted = uids.filter((uid) => typeof uid === 'string' && uid.length > 0)
  if (wanted.length === 0) return []
  const databases = traeStateDbCandidates().filter((file) => existsSync(file))
  if (databases.length === 0) return []

  const sqlite = await loadSqlite()
  if (sqlite === undefined) return []

  for (const file of databases) {
    let db: SqliteDatabase | undefined
    try {
      db = new sqlite.DatabaseSync(file, { readOnly: true })
      for (const uid of wanted) {
        const cacheKey = `${file}\u0000${uid}`
        const cached = readCache.get(cacheKey)
        if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
          if (cached.models.length > 0) return cached.models
          continue
        }
        let models: TraeRemoteModel[] = []
        try {
          models = parseTraeCachedModelMap(readMapForUid(db, uid), channelPriority)
        } catch {
          models = []
        }
        readCache.set(cacheKey, { at: Date.now(), models })
        if (models.length > 0) return models
      }
    } catch {
      // 库被客户端锁住 / 不是 SQLite / 权限不足：换下一个路径。
    } finally {
      try { db?.close() } catch { /* 关闭失败不影响结果 */ }
    }
  }
  return []
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveNumber(value: unknown): number | undefined {
  const number = finiteNumber(value)
  return number !== undefined && number > 0 ? number : undefined
}

function readContextWindow(entry: Record<string, unknown>): number | undefined {
  const tokens = entry.context_window_tokens
  if (typeof tokens === 'object' && tokens !== null) {
    const record = tokens as Record<string, unknown>
    // 与 batch 解析器同一口径：`dev` 才是本插件实际能用的窗口，`max` 需 Max 模式。
    return positiveNumber(record.dev) ?? positiveNumber(record.max)
  }
  const size = entry.context_window_size
  if (typeof size === 'object' && size !== null) {
    const record = size as Record<string, unknown>
    const direct = positiveNumber(record.default)
    if (direct !== undefined) return direct
    if (Array.isArray(record.max)) return positiveNumber(record.max[0])
  }
  return positiveNumber(size)
}

function readReasoningConfig(entry: Record<string, unknown>): TraeRemoteModel['reasoningConfig'] {
  const raw = entry.reasoning_effort_config
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const options = Array.isArray(record.options)
    ? record.options.filter((option): option is string => typeof option === 'string' && option.length > 0)
    : []
  const supportThinking = typeof record.support_thinking === 'boolean' ? record.support_thinking : undefined
  const defaultLevel = typeof record.default_level === 'string' ? record.default_level : undefined
  return {
    options,
    ...supportThinking === undefined ? {} : { supportThinking },
    ...defaultLevel === undefined ? {} : { defaultLevel },
  }
}

function readCreditsRate(entry: Record<string, unknown>): number | undefined {
  const features = entry.features
  if (typeof features !== 'object' || features === null) return undefined
  const rate = (features as Record<string, unknown>).consumption_rate
  if (typeof rate !== 'object' || rate === null) return undefined
  const record = rate as Record<string, unknown>
  if (record.enable === false) return undefined
  const data = record.data
  if (typeof data !== 'object' || data === null) return undefined
  return finiteNumber((data as Record<string, unknown>).rate)
}

function toRemoteModel(
  raw: unknown,
  channel: string,
): TraeRemoteModel | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const entry = raw as Record<string, unknown>
  const id = typeof entry.config_name === 'string'
    ? entry.config_name.trim()
    : typeof entry.name === 'string' ? entry.name.trim() : ''
  if (id.length === 0) return undefined
  const name = typeof entry.display_name === 'string' && entry.display_name.trim().length > 0
    ? entry.display_name.trim()
    : id
  // `config_source: 1` = 官方预置；3 = 用户自定义（需在 IDE 内绑定供应商）。
  // 缺该字段时用 `is_preset` / `provider` 兜底：拿不准就按可调用放行，与
  // `isTraeModelCallable` 的「未声明一律放行」同口径。
  const source = finiteNumber(entry.config_source)
  const provider = typeof entry.provider === 'string' ? entry.provider.trim() : ''
  const baseUrl = typeof entry.base_url === 'string' ? entry.base_url.trim() : ''
  const isCustomModel = source !== undefined
    ? source !== 1
    : entry.is_preset === false || provider !== '' || baseUrl !== ''
  const status = typeof entry.status === 'boolean' ? entry.status : undefined
  return {
    id,
    name,
    function: channel,
    ...isCustomModel ? { isCustomModel: true } : {},
    ...status === undefined ? {} : { isEnabled: status },
    usage: 'chat_completion',
    ...typeof entry.multimodal === 'boolean' ? { multimodal: entry.multimodal } : {},
    ...(() => {
      const contextWindow = readContextWindow(entry)
      return contextWindow === undefined ? {} : { contextWindow }
    })(),
    ...(() => {
      const maxOutputTokens = positiveNumber(entry.max_tokens)
      return maxOutputTokens === undefined ? {} : { maxOutputTokens }
    })(),
    ...(() => {
      const reasoningConfig = readReasoningConfig(entry)
      return reasoningConfig === undefined ? {} : { reasoningConfig }
    })(),
    ...(() => {
      const creditsRate = readCreditsRate(entry)
      return creditsRate === undefined ? {} : { creditsRate }
    })(),
  }
}

/**
 * 把缓存里的 `model_list_map` 归一成 {@link TraeRemoteModel}。
 *
 * 形状：`{ [function]: [entry, …] }`。只保留通道白名单内的组；自定义模型保留
 * 在结果里并打上 `isCustomModel`，由适配器的 `listAllModels` 统一剔除 ——
 * 与 batch 路径同一道闸门，不在解析层各写一份。
 */
export function parseTraeCachedModelMap(
  raw: unknown,
  channelPriority: readonly string[] = TRAE_CHANNELS,
): TraeRemoteModel[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const map = raw as Record<string, unknown>
  const candidates: TraeRemoteModel[] = []
  for (const [channel, list] of Object.entries(map)) {
    if (channelPriority.indexOf(channel) < 0 || !Array.isArray(list)) continue
    for (const entry of list) {
      const model = toRemoteModel(entry, channel)
      if (model === undefined) continue
      // 与 batch 解析器同口径：上游已停用 / 官方隐藏的条目不进候选。
      if (model.isEnabled === false) continue
      candidates.push(model)
    }
  }
  return mergeTraeModels(candidates, channelPriority)
}
