/**
 * 完整备份服务：采集全量数据、写盘/读盘、落库。
 *
 * 三条纪律，都来自「换机迁移」这个场景本身：
 *
 * 1. **导出必须先解密**。`data.json` 由 `store.key` 经本机密钥库封装的密钥加密，账号
 *    凭据又逐字段走一次 safeStorage。同一台机器拷目录能用，换台机器就全是解不开的
 *    密文（`decryptData` 返回 `null`，请求一路 401）。所以备份件里放的是**明文**，
 *    由导出侧负责解密、导入侧负责用**本机**密钥重新加密。
 * 2. **导入只认主进程读过的文件**。渲染层拿到的是 `token`，不是数据本身；`apply` 只
 *    接受 token 对应的那份 bundle。否则任何能在渲染层执行 JS 的东西都能构造一份
 *    「备份」直接改供应商与账号表，绕过所有专用通道的校验。
 * 3. **落库前先留副本**。`data.json` 整份 copy 到 `data.pre-restore.<时间戳>.json`，
 *    导入是覆盖式操作，出错时用户至少还有一份可以人工换回的文件。
 *
 * 本文件不含 electron：文件对话框走 `runtime/host` 的 `desktop` 能力袋，版本走宿主。
 * 于是无头宿主（WSL 守护进程）能调同一套采集/封装/落库引擎，只有「弹一个保存框」
 * 这件事在它那侧不存在——那条路径由命令行显式给路径。
 */

import { getHost, requireSystem } from '../runtime/host'
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { storeManager } from '../store/store.ts'
import { accountChannelManager } from '../providers/accountChannels/manager.ts'
import type {
  Account,
  LogEntry,
  Provider,
  RequestLogEntry,
  UserModelMarks,
} from '../store/types.ts'
import { DEFAULT_STATISTICS } from '../store/types.ts'
import type { AppConfig } from '../store/types.ts'
import { normalizeModelMark } from '../store/modelMarks.ts'
import {
  mergeById,
  mergeNamedTables,
  parseBackupDocument,
  summarizeBackup,
  type BackupAccountRecord,
  type BackupApplyResult,
  type BackupBundle,
  type BackupChannelSnapshot,
  type BackupData,
  type BackupExportOptions,
  type BackupExportResult,
  type BackupMode,
  type BackupPickResult,
  type BackupPreview,
  type BackupScope,
  type BackupSkippedBlock,
  type BackupUnlockResult,
  type SealedBackupFile,
  BACKUP_FORMAT,
  BACKUP_VERSION,
} from '../../shared/backup.ts'
import { openSealedBackup, sealBackup } from './crypto.ts'
import {
  sanitizeAccounts,
  sanitizeAppLogRows,
  sanitizeObjectArray,
  sanitizeProviders,
  sanitizeRecord,
  sanitizeRequestLogRows,
} from './sanitize.ts'

/** 备份件上限。超过它的多半不是备份（日志导出、完整的请求体转储），直接拒绝读取。 */
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024
/** 待导入件的存活时间：读进来却放着不管的文件不该无限期占内存。 */
const PENDING_TTL_MS = 10 * 60 * 1000
const MAX_PENDING = 4

interface PendingRestore {
  bundle?: BackupBundle
  sealed?: SealedBackupFile
  createdAt: number
}

const pendingRestores = new Map<string, PendingRestore>()

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function previewOf(bundle: BackupBundle): BackupPreview {
  return summarizeBackup(bundle, { platform: process.platform, appVersion: getHost().getVersion() })
}

function prunePending(now = Date.now()): void {
  for (const [token, entry] of pendingRestores) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingRestores.delete(token)
  }
  // 只留最近几份：这个缓存的意义是「用户刚刚选了哪份文件」，不是历史归档。
  while (pendingRestores.size > MAX_PENDING) {
    const oldest = pendingRestores.keys().next().value
    if (oldest === undefined) break
    pendingRestores.delete(oldest)
  }
}

function fileStamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 采集本机渠道登录态（账号池 + 凭据 + 模型黑名单 + 永久积分锁定）。
 *
 * 走渠道包自己的 `backup.export` 而不是拷 `channel-pack/*.json`：那份目录里有同机多
 * profile 共享的文档与整体替换语义的 `state.json`，按文件搬运会把别人的行一起带走，
 * 也会绕过渠道包的字段迁移。包不在（未构建/未启动）时返回 `null`，导出继续。
 */
async function collectChannelSnapshot(): Promise<BackupChannelSnapshot | null> {
  try {
    const result = await accountChannelManager.rpc('backup.export', {})
    if (!result.ok) {
      console.warn('[Backup] channel export failed:', result.error?.code)
      return null
    }
    const value = result.value as { payload?: unknown } | undefined
    return isPlainObject(value?.payload) ? (value.payload as BackupChannelSnapshot) : null
  } catch (error) {
    console.warn('[Backup] channel export threw:', error)
    return null
  }
}

async function collectBundle(options: BackupExportOptions): Promise<BackupBundle> {
  const store = storeManager.getStore()
  if (!store) throw new Error('storage-not-ready')

  const scope: BackupScope = {
    includeStatistics: options.includeStatistics !== false,
    includeLogs: options.includeLogs === true,
  }

  const rawAccounts = asArray(store.get('accounts'))
  const accounts = storeManager.getAccounts(true)
  const data: BackupData = {
    providers: asArray(store.get('providers')),
    accounts: accounts as unknown as BackupAccountRecord[],
    config: storeManager.getConfig() as unknown as Record<string, unknown>,
    userModelOverrides: sanitizeRecord(store.get('userModelOverrides')),
    userModelMarks: sanitizeRecord(store.get('userModelMarks')),
    catalogAdoptions: sanitizeObjectArray(store.get('catalogAdoptions')),
    aggregateCreditSnapshots: sanitizeRecord(store.get('aggregateCreditSnapshots')),
  }

  if (scope.includeStatistics) {
    data.statistics = sanitizeRecord(store.get('statistics'))
    data.tokenUsage = sanitizeRecord(store.get('tokenUsage'))
  }
  if (scope.includeLogs) {
    data.requestLogs = storeManager.getRequestLogs()
    data.appLogs = storeManager.getLogs()
  }

  const channels = await collectChannelSnapshot()
  data.channels = channels

  const warnings: BackupBundle['warnings'] = []
  if (channels === null) warnings.push('channel-unavailable')
  // 解密是逐字段跳过式的：解不开的字段不会进 `getAccounts(true)` 的结果。数量对不上
  // 就说明有凭据已经损坏（密钥库换过、store.key 丢过），这份备份带不走它们。
  const credentialsDamaged = rawAccounts.some((raw) => {
    if (!isPlainObject(raw)) return false
    const id = typeof raw.id === 'string' ? raw.id : ''
    const decrypted = accounts.find((account) => account.id === id)
    if (!decrypted) return true
    const before = Object.keys(sanitizeRecord(raw.credentials)).length
    const after = Object.keys(decrypted.credentials ?? {}).length
    return before !== after
  })
  if (credentialsDamaged) warnings.push('credentials-unreadable')

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: getHost().getVersion(),
    createdAt: new Date().toISOString(),
    platform: process.platform,
    scope,
    data,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

/** 导出：采集 → 选保存位置 → 写盘（可选口令封装）。 */
export async function exportBackup(options: BackupExportOptions): Promise<BackupExportResult> {
  let bundle: BackupBundle
  try {
    bundle = await collectBundle(options)
  } catch (error) {
    console.error('[Backup] collect failed:', error)
    return { canceled: false, error: 'storage-not-ready' }
  }

  // 默认落点（下载目录，拿不到时回家目录）由宿主决定，见 electronHost 的 pickSavePath。
  const target = await requireSystem('export-backup').pickSavePath(
    `modelport-backup-${fileStamp()}.json`,
  )
  if (target === null) return { canceled: true }

  const password = typeof options.password === 'string' ? options.password : ''
  const plaintext = JSON.stringify(bundle, null, 2)
  const payload = password === '' ? plaintext : JSON.stringify(sealBackup(plaintext, password), null, 2)

  try {
    writeFileSync(target, payload, { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    console.error('[Backup] write failed:', error)
    return { canceled: false, error: 'write-failed' }
  }

  const preview = previewOf(bundle)
  storeManager.addLog('info', `备份已导出（${password === '' ? '明文' : '口令封装'}）`, {
    data: {
      providers: preview.counts.providers,
      accounts: preview.counts.accounts,
      channelAccounts: preview.counts.channelAccounts,
      includeStatistics: bundle.scope.includeStatistics,
      includeLogs: bundle.scope.includeLogs,
    },
  })
  return {
    canceled: false,
    filePath: target,
    bytes: Buffer.byteLength(payload, 'utf8'),
    preview,
    encrypted: password !== '',
  }
}

/**
 * Reads a backup file from an explicit path and stages it for import.
 *
 * This is the half of `pickBackupFile()` that has nothing to do with choosing a
 * file, so a host with no dialog - the headless daemon - can drive the same engine
 * instead of growing a second import implementation.
 */
export function stageBackupFile(filePath: string): BackupPickResult {
  let text: string
  try {
    if (statSync(filePath).size > MAX_BACKUP_BYTES) {
      console.error('[Backup] file too large:', filePath)
      return { canceled: false, error: 'read-failed' }
    }
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    console.error('[Backup] read failed:', error)
    return { canceled: false, error: 'read-failed' }
  }

  const parsed = parseBackupDocument(text)
  if (parsed.kind === 'error') return { canceled: false, error: parsed.reason }

  prunePending()
  const token = randomUUID()
  if (parsed.kind === 'sealed') {
    pendingRestores.set(token, { sealed: parsed.file, createdAt: Date.now() })
    return { canceled: false, token, encrypted: true }
  }

  pendingRestores.set(token, { bundle: parsed.bundle, createdAt: Date.now() })
  return { canceled: false, token, encrypted: false, preview: previewOf(parsed.bundle) }
}

/** 选文件并读进主进程内存，返回一次性的导入句柄。 */
export async function pickBackupFile(): Promise<BackupPickResult> {
  const filePath = await requireSystem('pick-backup-file').pickOpenPath()
  if (filePath === null) return { canceled: true }

  return stageBackupFile(filePath)
}

/** 解开口令件；解出来的仍是同一份明文备份，走同一个解析器。 */
export function unlockBackup(token: string, password: string): BackupUnlockResult {
  const entry = pendingRestores.get(token)
  if (!entry || Date.now() - entry.createdAt > PENDING_TTL_MS) {
    pendingRestores.delete(token)
    return { ok: false, error: 'expired' }
  }
  if (!entry.sealed) return { ok: false, error: 'wrong-format' }

  let plaintext: string | null
  try {
    plaintext = openSealedBackup(entry.sealed, password)
  } catch (error) {
    console.error('[Backup] sealed file malformed:', error)
    return { ok: false, error: 'wrong-format' }
  }
  if (plaintext === null) return { ok: false, error: 'bad-password' }

  const parsed = parseBackupDocument(plaintext)
  if (parsed.kind === 'error') return { ok: false, error: parsed.reason }
  if (parsed.kind === 'sealed') return { ok: false, error: 'wrong-format' }

  entry.bundle = parsed.bundle
  delete entry.sealed
  return { ok: true, preview: previewOf(parsed.bundle) }
}

/** 用户取消导入：把待导入件丢掉，不留内存里的明文。 */
export function discardBackup(token: string): void {
  pendingRestores.delete(token)
}

function copyCurrentDataFile(): string | undefined {
  const dataPath = join(storeManager.getStoragePath(), 'data.json')
  if (!existsSync(dataPath)) return undefined
  const target = join(storeManager.getStoragePath(), `data.pre-restore.${Date.now()}.json`)
  try {
    copyFileSync(dataPath, target)
    return target
  } catch (error) {
    console.error('[Backup] could not copy data.json before restore:', error)
    return undefined
  }
}

/** 标注表：逐条过 `normalizeModelMark`，丢弃没有有效字段的空壳。 */
function normalizeMarksTable(raw: Record<string, unknown>): UserModelMarks {
  const result: UserModelMarks = {}
  for (const [providerId, table] of Object.entries(raw)) {
    if (!isPlainObject(table)) continue
    const marks: UserModelMarks[string] = {}
    for (const [name, mark] of Object.entries(table)) {
      const normalized = normalizeModelMark(mark)
      if (normalized !== undefined) marks[name] = normalized
    }
    if (Object.keys(marks).length > 0) result[providerId] = marks
  }
  return result
}

function applyReplace(data: BackupData): void {
  const store = storeManager.getStore()
  if (!store) throw new Error('storage-not-ready')

  const providers = sanitizeProviders(data.providers)
  const accounts = sanitizeAccounts(data.accounts)

  // `clear()` 回到构造时的 defaults（`getDefaultData()`），后面逐键覆盖。这样备份里
  // 没有的可选块（统计数据等）落在出厂值上，而不是残留导入前的旧值。
  store.clear()
  store.set('providers', providers.items)
  store.set(
    'accounts',
    accounts.items.map((account) => ({
      ...account,
      credentials: storeManager.encryptCredentials(account.credentials ?? {}),
    })),
  )
  // 配置走 restoreConfig 而不是 setConfig：恢复的定义是「把备份的配置装回来」，
  // 路由表必须跟着回来（setConfig 会刻意保住盘上现表）。
  storeManager.restoreConfig(data.config)
  store.set('userModelOverrides', sanitizeRecord(data.userModelOverrides))
  store.set('userModelMarks', normalizeMarksTable(sanitizeRecord(data.userModelMarks)))
  store.set('catalogAdoptions', sanitizeObjectArray(data.catalogAdoptions))
  store.set('aggregateCreditSnapshots', sanitizeRecord(data.aggregateCreditSnapshots))

  // 统计块是逐字段直读的（`getStatistics()` 原样返回盘上对象），缺字段会让仪表盘
  // 出现 `undefined`。补齐出厂值而不是整份丢弃：备份里的真实计数仍然有效。
  if (isPlainObject(data.statistics)) {
    store.set('statistics', { ...DEFAULT_STATISTICS, ...data.statistics })
  }
  if (isPlainObject(data.tokenUsage)) store.set('tokenUsage', data.tokenUsage)

  if (Array.isArray(data.appLogs)) {
    storeManager.replaceLogs(sanitizeAppLogRows(data.appLogs) as unknown as LogEntry[])
  }
  if (Array.isArray(data.requestLogs)) {
    storeManager.replaceRequestLogs(
      sanitizeRequestLogRows(data.requestLogs) as unknown as RequestLogEntry[],
    )
  }
}

/**
 * 合并模式：只补本地没有的条目，本地一律优先。
 *
 * 不落库的块（统计、日志、渠道包）不是「忘了」，而是**不该合并**：统计数据相加会
 * 变成两份机器用量之和（同一批请求被记两遍），渠道包是整份替换语义（半份合并会让
 * 账号池与凭据表错位）。需要合它们就用覆盖模式。
 */
function applyMerge(data: BackupData): BackupSkippedBlock[] {
  const store = storeManager.getStore()
  if (!store) throw new Error('storage-not-ready')

  const localProviders = asArray(store.get('providers')) as Provider[]
  const incomingProviders = sanitizeProviders(data.providers).items
  const providers = mergeById(localProviders, incomingProviders, (provider) => provider.id)
  if (providers.added > 0) store.set('providers', providers.next)

  const localAccounts = asArray(store.get('accounts')) as Account[]
  const incomingAccounts = sanitizeAccounts(data.accounts).items
  const accounts = mergeById(localAccounts, incomingAccounts, (account) => account.id)
  if (accounts.added > 0) {
    const additions = accounts.next.slice(localAccounts.length).map((account) => ({
      ...account,
      credentials: storeManager.encryptCredentials(account.credentials ?? {}),
    }))
    store.set('accounts', [...localAccounts, ...additions])
  }

  // 配置：本机设置（端口/绑定/鉴权/管理密钥）不覆盖，只补路由与别名这两张
  // 「知识表」里本地没有的名字 —— 缺了它们，备份里的模型名解析不到任何候选。
  const localConfig = storeManager.getConfig()
  const incomingConfig = sanitizeRecord(data.config)
  const mappings = mergeNamedTables(
    localConfig.modelMappings as unknown as Record<string, unknown>,
    sanitizeRecord(incomingConfig.modelMappings),
  )
  const routes = mergeNamedTables(
    localConfig.routes as unknown as Record<string, unknown>,
    sanitizeRecord(incomingConfig.routes),
  )
  if (mappings.added > 0 || routes.added > 0) {
    storeManager.updateConfig({
      modelMappings: mappings.next as unknown as AppConfig['modelMappings'],
      routes: routes.next as unknown as AppConfig['routes'],
    })
  }

  const incomingMarks = normalizeMarksTable(sanitizeRecord(data.userModelMarks))
  if (Object.keys(incomingMarks).length > 0) {
    store.set('userModelMarks', { ...incomingMarks, ...storeManager.getUserModelMarks() })
  }
  const incomingOverrides = sanitizeRecord(data.userModelOverrides)
  if (Object.keys(incomingOverrides).length > 0) {
    store.set('userModelOverrides', { ...incomingOverrides, ...sanitizeRecord(store.get('userModelOverrides')) })
  }

  const skipped: BackupSkippedBlock[] = []
  if (data.statistics !== undefined || data.tokenUsage !== undefined) skipped.push('statistics')
  if (data.requestLogs !== undefined || data.appLogs !== undefined) skipped.push('logs')
  if (data.channels) skipped.push('channels')
  return skipped
}

async function importChannelSnapshot(snapshot: BackupChannelSnapshot): Promise<boolean> {
  try {
    const result = await accountChannelManager.rpc('backup.import', { payload: snapshot })
    if (!result.ok) {
      console.warn('[Backup] channel import failed:', result.error?.code)
      return false
    }
    return true
  } catch (error) {
    console.warn('[Backup] channel import threw:', error)
    return false
  }
}

/** 落库。`mode: 'replace'` 整份覆盖，`'merge'` 只补缺。 */
export async function applyBackup(token: string, mode: BackupMode): Promise<BackupApplyResult> {
  const entry = pendingRestores.get(token)
  if (!entry || !entry.bundle || Date.now() - entry.createdAt > PENDING_TTL_MS) {
    pendingRestores.delete(token)
    return { ok: false, error: 'expired' }
  }
  // 单次使用：同一份件被点两次「导入」时，第二次会把第一次刚写好的结果再覆盖一遍，
  // 而用户以为自己只是重试了一次失败的点击。
  pendingRestores.delete(token)

  const bundle = entry.bundle
  const data = bundle.data
  if (mode === 'replace' && (!Array.isArray(data.providers) || !isPlainObject(data.config))) {
    return { ok: false, error: 'wrong-format' }
  }

  const safetyCopy = copyCurrentDataFile()
  let skipped: BackupSkippedBlock[] = []
  try {
    if (mode === 'replace') {
      applyReplace(data)
      if (data.channels) {
        const imported = await importChannelSnapshot(data.channels)
        if (!imported) skipped = ['channels']
      }
    } else {
      skipped = applyMerge(data)
    }
  } catch (error) {
    console.error('[Backup] apply failed:', error)
    return { ok: false, error: 'apply-failed', safetyCopy }
  }

  const preview = previewOf(bundle)
  storeManager.addLog('info', `备份已导入（${mode === 'replace' ? '覆盖' : '合并'}）`, {
    data: {
      mode,
      providers: preview.counts.providers,
      accounts: preview.counts.accounts,
      routes: preview.counts.routes,
      skipped,
    },
  })

  return { ok: true, mode, counts: preview.counts, skipped, safetyCopy }
}

/** 导入后必须重启：供应商/账号是在启动时播种并镜像进运行时的，热替换等于让两套状态并存。 */
export function restartApplication(): void {
  requireSystem('restart-application').restart()
}
