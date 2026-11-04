/**
 * 完整备份（全部数据与配置）的格式定义与只读解析。
 *
 * 与 `persistedSettings.ts` 的「界面偏好导出件」是两件事，别合并：
 * - 那份只带 13 个 UI 偏好，明确剔除 `config`（含代理 Key、管理密钥），因为它要经
 *   localStorage 与浏览器下载通道出门；
 * - 这份是**换机迁移**件：供应商、账号凭据、路由、模型标注、渠道登录态全在里头。
 *   凭据在 `data.json` 里是 safeStorage 逐字段加密的，换一台机器就解不开（`store.key`
 *   绑定本机密钥库），所以导出时必须先解密成明文再落盘，导入时用**本机**密钥重新
 *   加密。这就是「同一台电脑」与「不同电脑」都必须走加解密而不是拷目录的原因。
 *
 * 明文凭据一旦落盘，安全性就只剩文件权限与用户自己的处置。因此导出侧提供可选的
 * 口令封装（见 `main/backup/crypto.ts`，scrypt + AES-256-GCM），UI 默认推荐用它。
 *
 * 这里是纯逻辑（无 electron / node 依赖）：主进程用它校验与统计，渲染层用它渲染
 * 导入预览，两边看到的「这份备份包含什么」是同一个数。
 */

/** 明文备份的标志。缺了它就是别人的 JSON，不许当备份导入。 */
export const BACKUP_FORMAT = 'modelport-backup'
/** 口令封装后的外层标志：解开之前看不到任何数据。 */
export const BACKUP_SEALED_FORMAT = 'modelport-backup-sealed'
/** 格式版本。加字段不用升版本（读取侧全部按缺省容忍），改语义才升。 */
export const BACKUP_VERSION = 1

/** 导入语义：整份覆盖，或只补齐本地缺的条目。 */
export type BackupMode = 'replace' | 'merge'

export type BackupErrorCode =
  | 'not-json'
  | 'not-object'
  | 'wrong-format'
  | 'unsupported-version'

export type BackupWarningCode =
  | 'no-credentials'
  | 'credentials-unreadable'
  | 'channel-unavailable'
  | 'different-platform'
  | 'newer-app-version'

/** 导出范围。核心数据（供应商/账号/配置/路由/标注）永远在内，这两项是可选的大块。 */
export interface BackupScope {
  /** 统计与 Token 账本（`statistics` / `tokenUsage`）。 */
  includeStatistics: boolean
  /** 请求日志与应用日志（体量最大，且含用户输入片段）。 */
  includeLogs: boolean
}

export interface BackupExportOptions extends BackupScope {
  /** 非空即用口令封装整份备份；空串/缺省 = 明文 JSON。 */
  password?: string
}

/**
 * 账号记录。`credentials` 在这里是**明文**（导出时已解密），导入时按本机密钥重封。
 * 保留索引签名，让上游 `Account` 直传而不必逐字段改写 —— 但读取侧只认下面这几项。
 */
export interface BackupAccountRecord {
  id: string
  providerId?: string
  name?: string
  credentials?: Record<string, string>
  [key: string]: unknown
}

/**
 * 渠道包（`backup.export` RPC）的原样载荷。
 *
 * 不在这里重新定义账号/凭据形状：那份契约的权威在 `vendor/channel-pack/src/types.ts`
 * 的 `BackupPayload`，本应用只是搬运。重新声明一份等于给它加第二个真值源，渠道包
 * 升版本时两边必然漂移。
 */
export interface BackupChannelSnapshot {
  format?: string
  version?: number
  exportedAt?: string
  accounts?: unknown[]
  credentials?: Record<string, string>
  disabledModels?: Record<string, Record<string, boolean>>
  permanentLocks?: Record<string, boolean>
  [key: string]: unknown
}

export interface BackupData {
  providers?: unknown[]
  accounts?: BackupAccountRecord[]
  /** 完整 `AppConfig`，含 `routes` / `modelMappings` / `apiKeys` / `managementApi`。 */
  config?: Record<string, unknown>
  userModelOverrides?: Record<string, unknown>
  userModelMarks?: Record<string, unknown>
  catalogAdoptions?: unknown[]
  aggregateCreditSnapshots?: Record<string, unknown>
  statistics?: Record<string, unknown>
  tokenUsage?: Record<string, unknown>
  channels?: BackupChannelSnapshot | null
  requestLogs?: unknown[]
  appLogs?: unknown[]
}

export interface BackupBundle {
  format: typeof BACKUP_FORMAT
  version: number
  /** 导出时的应用版本，用来提示「备份比当前版本新」。 */
  appVersion: string
  /** ISO 8601。 */
  createdAt: string
  platform: string
  scope: BackupScope
  data: BackupData
  /** 导出侧遇到的非致命问题（凭据读不出来、渠道包不可用）。 */
  warnings?: BackupWarningCode[]
}

/** scrypt + AES-256-GCM 的参数与密文。字段齐全才认，缺一不可。 */
export interface SealedBackupPayload {
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  n: number
  r: number
  p: number
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export interface SealedBackupFile {
  format: typeof BACKUP_SEALED_FORMAT
  version: number
  createdAt?: string
  sealed: SealedBackupPayload
}

export interface BackupPreviewCounts {
  providers: number
  accounts: number
  /** 带凭据的账号数：0 意味着这份备份导入后每个账号都要重新填 Key。 */
  accountsWithCredentials: number
  routes: number
  modelMappings: number
  apiKeys: number
  userModelMarks: number
  channelAccounts: number
  requestLogs: number
  appLogs: number
}

export interface BackupPreview {
  appVersion: string
  createdAt: string
  platform: string
  scope: BackupScope
  counts: BackupPreviewCounts
  warnings: BackupWarningCode[]
}

export type BackupDocumentResult =
  | { kind: 'bundle'; bundle: BackupBundle }
  | { kind: 'sealed'; file: SealedBackupFile }
  | { kind: 'error'; reason: BackupErrorCode }

/** 导入/导出操作层面的失败原因（区别于「文件格式不对」）。 */
export type BackupOperationError =
  | BackupErrorCode
  | 'expired'
  | 'storage-not-ready'
  | 'read-failed'
  | 'write-failed'
  | 'bad-password'
  | 'apply-failed'

/** 合并模式下刻意不落库的数据块：它们要么是本机自身的设置，要么是派生统计。 */
export type BackupSkippedBlock = 'statistics' | 'logs' | 'channels'

export interface BackupExportResult {
  canceled: boolean
  filePath?: string
  bytes?: number
  /** 写盘成功时回一份摘要，UI 用它告诉用户「这份备份里有多少东西」。 */
  preview?: BackupPreview
  encrypted?: boolean
  error?: BackupOperationError
}

export interface BackupPickResult {
  canceled: boolean
  /** 已读入主进程内存的待导入件句柄；`apply` / `unlock` 只认它，不认渲染层送来的数据。 */
  token?: string
  encrypted?: boolean
  /** 明文备份直接带摘要；封装件要等 `unlock` 之后才有。 */
  preview?: BackupPreview
  error?: BackupOperationError
}

export interface BackupUnlockResult {
  ok: boolean
  preview?: BackupPreview
  error?: BackupOperationError
}

export interface BackupApplyResult {
  ok: boolean
  mode?: BackupMode
  counts?: BackupPreviewCounts
  /** 合并模式下没有应用的数据块。 */
  skipped?: BackupSkippedBlock[]
  /** 落库前的 `data.json` 副本；导入出问题时可人工换回。 */
  safetyCopy?: string
  error?: BackupOperationError
}


function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function countCredentials(accounts: unknown): number {
  return asArray(accounts).filter((account) => {
    if (!isPlainObject(account)) return false
    return Object.keys(asObject(account.credentials)).length > 0
  }).length
}

function isSealedPayload(value: unknown): value is SealedBackupPayload {
  if (!isPlainObject(value)) return false
  return (
    value.algorithm === 'aes-256-gcm' &&
    value.kdf === 'scrypt' &&
    typeof value.salt === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.ciphertext === 'string'
  )
}

export function isSealedBackupFile(value: unknown): value is SealedBackupFile {
  return (
    isPlainObject(value) &&
    value.format === BACKUP_SEALED_FORMAT &&
    isSealedPayload(value.sealed)
  )
}

/**
 * 校验明文备份的外形。
 *
 * 只判定「这是不是本应用的备份、版本能不能读」，不逐个字段挑刺：字段级清洗在落库前
 * （`main/backup/sanitize.ts`）做，那里才知道 store 需要什么形状。这里放行的未知字段
 * 会被原样带过 —— 老版本读新备份时，读不懂的部分不该让整份备份失败。
 */
export function isBackupBundle(value: unknown): value is BackupBundle {
  return (
    isPlainObject(value) &&
    value.format === BACKUP_FORMAT &&
    typeof value.version === 'number' &&
    isPlainObject(value.data)
  )
}

/**
 * 解析一份备份文件：明文备份、口令封装、或明确的失败原因。
 *
 * 封装件在**解开之后**再喂一次本函数即可拿到 `bundle`（解出来的就是同一份 JSON），
 * 所以调用方不需要第二套校验。
 */
export function parseBackupDocument(text: string): BackupDocumentResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'error', reason: 'not-json' }
  }
  if (!isPlainObject(parsed)) return { kind: 'error', reason: 'not-object' }
  if (isSealedBackupFile(parsed)) return { kind: 'sealed', file: parsed }
  if (!isBackupBundle(parsed)) return { kind: 'error', reason: 'wrong-format' }
  if (parsed.version > BACKUP_VERSION) return { kind: 'error', reason: 'unsupported-version' }
  return { kind: 'bundle', bundle: parsed }
}

/**
 * 给导入确认框用的摘要。
 *
 * `currentPlatform` / `currentVersion` 由调用方传入（主进程知道，渲染层也拿得到），
 * 这样「跨平台」「备份比当前版本新」这两条提示不依赖备份文件自己说了算。
 */
export function summarizeBackup(
  bundle: BackupBundle,
  context: { platform: string; appVersion: string },
): BackupPreview {
  const data = bundle.data
  const config = asObject(data.config)
  const accounts = asArray(data.accounts)
  const warnings: BackupWarningCode[] = []

  if (accounts.length > 0 && countCredentials(accounts) === 0) warnings.push('no-credentials')
  if (bundle.warnings?.includes('credentials-unreadable')) warnings.push('credentials-unreadable')
  if (bundle.warnings?.includes('channel-unavailable')) warnings.push('channel-unavailable')
  if (bundle.platform && bundle.platform !== context.platform) warnings.push('different-platform')
  if (isVersionNewer(bundle.appVersion, context.appVersion)) warnings.push('newer-app-version')

  return {
    appVersion: bundle.appVersion,
    createdAt: bundle.createdAt,
    platform: bundle.platform,
    scope: bundle.scope,
    counts: {
      providers: asArray(data.providers).length,
      accounts: accounts.length,
      accountsWithCredentials: countCredentials(accounts),
      routes: Object.keys(asObject(config.routes)).length,
      modelMappings: Object.keys(asObject(config.modelMappings)).length,
      apiKeys: asArray(config.apiKeys).length,
      userModelMarks: Object.keys(asObject(data.userModelMarks)).length,
      channelAccounts: asArray(asObject(data.channels).accounts).length,
      requestLogs: asArray(data.requestLogs).length,
      appLogs: asArray(data.appLogs).length,
    },
    warnings,
  }
}

/** 只比较 `major.minor.patch` 数字段；带后缀（`-beta.1`）时按前缀算，不比预发布序号。 */
function isVersionNewer(candidate: string, current: string): boolean {
  const parse = (value: string): number[] =>
    value
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0))
  const left = parse(candidate)
  const right = parse(current)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }
  return false
}

/**
 * 合并模式的核心规则：**按 id 取并集，本地优先**。
 *
 * 覆盖模式是「把备份放回来」，合并模式是「把备份里我没有的补上」。后者不能反过来让
 * 备份覆盖本地 —— 用户导入一份旧备份时，本地刚改过的 Key、刚建的账号必须留住。
 */
export function mergeById<T>(
  local: readonly T[],
  incoming: readonly T[],
  idOf: (item: T) => string | undefined,
): { next: T[]; added: number } {
  const seen = new Set<string>()
  for (const item of local) {
    const id = idOf(item)
    if (id) seen.add(id)
  }
  const additions: T[] = []
  for (const item of incoming) {
    const id = idOf(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    additions.push(item)
  }
  return { next: additions.length > 0 ? [...local, ...additions] : [...local], added: additions.length }
}

/**
 * 合并模式的配置规则：本地整份保留，只往 `modelMappings` / `routes` 里补本地没有的
 * 名字。
 *
 * 端口、绑定地址、代理鉴权、管理密钥这些是**这台机器**的设置，拿备份去覆盖等于换机
 * 迁移时把本机配置冲掉；而路由与别名是「知识」，缺了它们备份里的模型名就解析不到
 * 任何候选。这条边界就是合并模式与覆盖模式的全部差别。
 */
export function mergeNamedTables(
  local: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): { next: Record<string, unknown>; added: number } {
  const next: Record<string, unknown> = { ...asObject(local) }
  let added = 0
  for (const [name, value] of Object.entries(asObject(incoming))) {
    if (name in next) continue
    next[name] = value
    added += 1
  }
  return { next, added }
}
