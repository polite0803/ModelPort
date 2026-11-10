/**
 * The renderer-facing API surface, as a plain object built over an injected wire.
 *
 * This file used to live in `src/preload/index.ts` and call `ipcRenderer` directly.
 * It is now electron-free so the *same* object can be built over HTTP when the UI runs
 * in a browser against a headless daemon (WSL). Two consequences that matter:
 *
 * - There is exactly one method -> channel table. A second bridge written for the web
 *   would drift, and the drift shows up as "the switch is in the screen but nothing
 *   reads it" - the failure this repository keeps having to un-record.
 * - The rule stated at the bottom of this file still holds: no generic
 *   `invoke` / `send` / `on` is exposed. New channels must be registered here, with
 *   types, in `shared/types` and in `renderer/src/types/electron.d.ts`.
 */
import { IpcChannels } from '../main/ipc/channels'
import type { 
  Provider, 
  Account, 
  ProxyStatus, 
  ProxyStatistics, 
  ProviderCheckResult, 
  OAuthResult,
  AuthType,
  CredentialField,
  LogLevel,
  LogEntry,
  ProviderVendor,
  AppConfig,
  EffectiveModel,
  CatalogueModel,
  RequestLogEntry,
  RequestDiagnosticBundle,
  AppLogTrendPoint,
  ModelsFetchFailure,
  ModelRoute,
  ModelCapabilityHint,
  RoutePreviewResult,
  RoutePreviewSample,
  TlsStatus,
  TlsTrustResult,
} from './types'
import type {
  BackupApplyResult,
  BackupExportOptions,
  BackupExportResult,
  BackupMode,
  BackupPickResult,
  BackupUnlockResult,
} from './backup'
import type {
  RouteListResult,
  RouteMutationResult,
  RouteRemovalResult,
  RoutePoolSizesResult,
} from './modelRouteName'
import type {
  AnthropicDiscoveryResult,
  AnthropicRouteApplyResult,
} from './anthropicDiscovery'
import type { AggregateCreditQueryResult } from './aggregateCredit'
import type { ModelMetadata, ModelMetadataReport } from './modelMetadata'
import type {
  ModelProbeRunResult,
  ProbeJobSnapshot,
  ProbeProgressEvent,
  ProbeScope,
} from './modelProbe'
import type {
  CatalogAdoption,
  CatalogAdoptionField,
  CatalogCandidatesResult,
  CatalogRefreshResult,
  CatalogSnapshotStatus,
  CatalogSourceId,
} from './modelCatalog.ts'
import type {
  CatalogBatchEstimate,
  CatalogBatchSnapshot,
  CatalogBatchStartResult,
} from './modelCatalogBatch'
import type {
  AggregateDetail,
  AggregateListResult,
  AggregateModelTestResult,
  AggregateMutationResult,
  AggregateOperationResult,
  AggregateSaveInput,
} from './aggregate'
import type {
  ChannelAutoCheckinResult,
  ChannelCredits,
  ChannelModelsResult,
  ChannelModelUpdateResult,
  ChannelOperationResult,
  ChannelRefreshResult,
  ChannelRpcResult,
  ChannelView,
} from './channels'
import type { DayTokenBucket, DayTokenSummary } from './tokenAccounting'


/** How this object reaches the main process: IPC in the shell, HTTP against a daemon. */
export interface ApiWire {
  invoke(channel: string, ...args: unknown[]): Promise<any>
  /** Returns nothing; `off` is the unsubscribe half, mirroring `ipcRenderer`. */
  on(channel: string, handler: (event: unknown, payload: any) => void): void
  off(channel: string, handler: (event: unknown, payload: any) => void): void
  /** Fire-and-forget, used only by the tray window - a headless host has no tray. */
  send(channel: string, ...args: unknown[]): void
  /**
   * Host-local override for "choose a backup file". A desktop wire opens a native dialog via
   * IPC; a page served by the headless daemon has the file on the operator's machine, so its
   * transport uses the browser's own picker and uploads the bytes. Optional: without it the
   * method table falls back to the IPC channel, which is the only sane desktop behaviour.
   */
  uploadBackup?: () => Promise<BackupPickResult>
}

export function createElectronAPI(wire: ApiWire) {
const proxyAPI = {
  start: (port?: number): Promise<boolean> => 
    wire.invoke(IpcChannels.PROXY_START, port),
  
  stop: (): Promise<boolean> => 
    wire.invoke(IpcChannels.PROXY_STOP),
  
  getStatus: (): Promise<ProxyStatus> => 
    wire.invoke(IpcChannels.PROXY_GET_STATUS),

  getStatistics: (): Promise<ProxyStatistics> =>
    wire.invoke(IpcChannels.PROXY_GET_STATISTICS),
  
  onStatusChanged: (callback: (status: ProxyStatus) => void) => {
    const handler = (_event: unknown, status: ProxyStatus) => callback(status)
    wire.on(IpcChannels.PROXY_STATUS_CHANGED, handler)
    return () => wire.off(IpcChannels.PROXY_STATUS_CHANGED, handler)
  },
}

const tlsAPI = {
  getStatus: (): Promise<TlsStatus> =>
    wire.invoke(IpcChannels.TLS_STATUS),

  installTrust: (): Promise<TlsTrustResult> =>
    wire.invoke(IpcChannels.TLS_INSTALL_TRUST),

  uninstallTrust: (): Promise<TlsTrustResult> =>
    wire.invoke(IpcChannels.TLS_UNINSTALL_TRUST),
}

const storeAPI = {
  get: <T>(key: string): Promise<T | undefined> => 
    wire.invoke(IpcChannels.STORE_GET, key),

  // 没有 `set` / `delete`：整份配置走 `config:update`（主进程深合并），厂商/账号/路由
  // 各有专用通道。通用写通道曾让渲染层能绕过 `encryptCredentials` 把明文凭据写进
  // data.json，现在主进程对未登记键直接拒绝，这层也一并撤掉，不留「调用必失败」的面。
  
  clearAll: (): Promise<void> => 
    wire.invoke(IpcChannels.STORE_CLEAR_ALL),
  
  onInitError: (callback: (error: { message: string | null }) => void) => {
    const handler = (_event: unknown, error: { message: string | null }) => callback(error)
    wire.on(IpcChannels.STORE_INIT_ERROR, handler)
    return () => wire.off(IpcChannels.STORE_INIT_ERROR, handler)
  },
  
  retryInit: (): Promise<{ success: boolean; error?: string }> => 
    wire.invoke(IpcChannels.STORE_RETRY_INIT),
}

/**
 * 完整备份（全部数据与配置）。
 *
 * 这里刻意**没有**「把一段 JSON 直接导入」的方法：`pick` 由主进程自己读文件并缓存，
 * 返回的 token 是唯一凭据。渲染层能做的只有「选文件 / 解口令 / 确认应用」，构造不出
 * 一份内容自定的备份去改账号表。
 */
const backupAPI = {
  export: (options: BackupExportOptions): Promise<BackupExportResult> =>
    wire.invoke(IpcChannels.BACKUP_EXPORT, options),

  pick: (): Promise<BackupPickResult> =>
    wire.uploadBackup ? wire.uploadBackup() : wire.invoke(IpcChannels.BACKUP_PICK),

  unlock: (token: string, password: string): Promise<BackupUnlockResult> =>
    wire.invoke(IpcChannels.BACKUP_UNLOCK, token, password),

  apply: (token: string, mode: BackupMode): Promise<BackupApplyResult> =>
    wire.invoke(IpcChannels.BACKUP_APPLY, token, mode),

  cancel: (token: string): Promise<void> =>
    wire.invoke(IpcChannels.BACKUP_CANCEL, token),

  restart: (): Promise<void> =>
    wire.invoke(IpcChannels.BACKUP_RESTART),
}

const providersAPI = {
  getAll: (): Promise<Provider[]> => 
    wire.invoke(IpcChannels.PROVIDERS_GET_ALL),
  
  getBuiltin: (): Promise<any[]> => 
    wire.invoke(IpcChannels.PROVIDERS_GET_BUILTIN),
  
  add: (data: {
    name: string
    authType: AuthType
    apiEndpoint: string
    headers?: Record<string, string>
    description?: string
    supportedModels?: string[]
    credentialFields?: CredentialField[]
  }): Promise<Provider> => 
    wire.invoke(IpcChannels.PROVIDERS_ADD, data),
  
  update: (id: string, updates: Partial<Provider>): Promise<Provider | null> => 
    wire.invoke(IpcChannels.PROVIDERS_UPDATE, id, updates),
  
  delete: (id: string): Promise<boolean> => 
    wire.invoke(IpcChannels.PROVIDERS_DELETE, id),
  
  checkStatus: (providerId: string): Promise<ProviderCheckResult> => 
    wire.invoke(IpcChannels.PROVIDERS_CHECK_STATUS, providerId),
  
  checkAllStatus: (): Promise<Record<string, ProviderCheckResult>> => 
    wire.invoke(IpcChannels.PROVIDERS_CHECK_ALL_STATUS),
  
  duplicate: (id: string): Promise<Provider> => 
    wire.invoke(IpcChannels.PROVIDERS_DUPLICATE, id),
  
  export: (id: string): Promise<string> => 
    wire.invoke(IpcChannels.PROVIDERS_EXPORT, id),
  
  import: (jsonData: string): Promise<Provider> => 
    wire.invoke(IpcChannels.PROVIDERS_IMPORT, jsonData),
  
  updateModels: (providerId: string): Promise<{
    success: boolean
    reason?: ModelsFetchFailure
    detail?: string
    fetchedCount?: number
    addedCount?: number
    fetchedAt?: number
  }> => 
    wire.invoke(IpcChannels.PROVIDERS_UPDATE_MODELS, providerId),
  
  getEffectiveModels: (providerId: string): Promise<EffectiveModel[]> => 
    wire.invoke(IpcChannels.PROVIDERS_GET_EFFECTIVE_MODELS, providerId),
  
  getModelCatalogue: (providerId: string): Promise<CatalogueModel[]> => 
    wire.invoke(IpcChannels.PROVIDERS_GET_MODEL_CATALOGUE, providerId),
  
  setModelsServed: (providerId: string, names: string[], served: boolean): Promise<{
    success: boolean
    catalogue: CatalogueModel[]
    error?: string
  }> => 
    wire.invoke(IpcChannels.PROVIDERS_SET_MODELS_SERVED, providerId, names, served),
  
  addCustomModel: (providerId: string, model: { displayName: string; actualModelId: string }): Promise<{
    success: boolean
    models: EffectiveModel[]
    error?: string
  }> => 
    wire.invoke(IpcChannels.PROVIDERS_ADD_CUSTOM_MODEL, providerId, model),
  
  removeModel: (providerId: string, modelName: string): Promise<{
    success: boolean
    models: EffectiveModel[]
    error?: string
  }> => 
    wire.invoke(IpcChannels.PROVIDERS_REMOVE_MODEL, providerId, modelName),
  
  resetModels: (providerId: string): Promise<{
    success: boolean
    models: EffectiveModel[]
    error?: string
  }> => 
    wire.invoke(IpcChannels.PROVIDERS_RESET_MODELS, providerId),

  getModelMarks: (): Promise<Record<string, Record<string, ModelCapabilityHint>>> =>
    wire.invoke(IpcChannels.PROVIDERS_GET_MODEL_MARKS),

  setModelMark: (providerId: string, displayName: string, mark: ModelCapabilityHint | null): Promise<{
    success: boolean
    marks: Record<string, Record<string, ModelCapabilityHint>>
    error?: string
  }> =>
    wire.invoke(IpcChannels.PROVIDERS_SET_MODEL_MARK, providerId, displayName, mark),

  getModelMetadata: (): Promise<ModelMetadataReport | { success: false; error: string }> =>
    wire.invoke(IpcChannels.PROVIDERS_GET_MODEL_METADATA),

  /** 单个模型的元数据解析结果（逐模型标注入口用，不重算整张报表）。 */
  getModelMetadataOne: (
    providerId: string,
    displayName: string,
  ): Promise<{ success: true; metadata: ModelMetadata } | { success: false; error: string }> =>
    wire.invoke(IpcChannels.PROVIDERS_GET_MODEL_METADATA_ONE, providerId, displayName),

  probeModel: (
    providerId: string,
    displayName: string,
    scope?: ProbeScope,
    force?: boolean,
  ): Promise<{
    success: boolean
    jobId?: string
    result?: ModelProbeRunResult
    error?: string
  }> =>
    wire.invoke(IpcChannels.PROVIDERS_PROBE_MODEL, providerId, displayName, scope, force),

  /** 取消一条进行中的探测：立即停止后续档位，已完成档位结论保留。 */
  cancelProbe: (jobId: string): Promise<{ success: boolean; error?: string }> =>
    wire.invoke(IpcChannels.PROVIDERS_CANCEL_PROBE, jobId),

  /** 关闭弹窗后回读后台任务：进行中 + 最近完成。 */
  getProbeJobs: (): Promise<ProbeJobSnapshot[]> =>
    wire.invoke(IpcChannels.PROVIDERS_GET_PROBE_JOBS),

  /** 探测进度事件；返回取消订阅函数。 */
  onProbeProgress: (listener: (event: ProbeProgressEvent) => void): (() => void) => {
    const handler = (_event: unknown, payload: ProbeProgressEvent): void => listener(payload)
    wire.on(IpcChannels.PROVIDERS_PROBE_PROGRESS, handler)
    return () => wire.off(IpcChannels.PROVIDERS_PROBE_PROGRESS, handler)
  },

  /** 标准模型库：快照元数据（不联网、不含 entries） */
  getCatalogStatuses: (): Promise<CatalogSnapshotStatus[]> =>
    wire.invoke(IpcChannels.PROVIDERS_GET_CATALOG_STATUSES),

  /** 用户显式刷新；失败时返回 success:false 且旧快照保留 */
  refreshCatalog: (source: CatalogSourceId): Promise<CatalogRefreshResult> =>
    wire.invoke(IpcChannels.PROVIDERS_REFRESH_CATALOG, source),

  getCatalogCandidates: (
    providerId: string,
    displayName: string,
  ): Promise<CatalogCandidatesResult> =>
    wire.invoke(IpcChannels.PROVIDERS_GET_CATALOG_CANDIDATES, providerId, displayName),

  adoptCatalogField: (
    providerId: string,
    displayName: string,
    catalogId: string,
    field: CatalogAdoptionField,
  ): Promise<{ success: boolean; adoptions?: CatalogAdoption[]; error?: string }> =>
    wire.invoke(
      IpcChannels.PROVIDERS_ADOPT_CATALOG_FIELD,
      providerId,
      displayName,
      catalogId,
      field,
    ),

  revokeCatalogAdoption: (
    providerId: string,
    displayName: string,
    field?: CatalogAdoptionField,
  ): Promise<{ success: boolean; adoptions?: CatalogAdoption[]; error?: string }> =>
    wire.invoke(
      IpcChannels.PROVIDERS_REVOKE_CATALOG_ADOPTION,
      providerId,
      displayName,
      field,
    ),

  /** 「全部补齐」预演：只读本地快照，不联网。 */
  /** 预演合计（只读本地快照，不联网）。`providerId` 给定时范围收到这一家。 */
  estimateCatalogBatch: (providerId?: string): Promise<CatalogBatchEstimate> =>
    wire.invoke(IpcChannels.PROVIDERS_ESTIMATE_CATALOG_BATCH, providerId),

  /** 启动主进程批量任务；`probe` 是一次性开关，`retryFailedOf` 只重试失败项，`providerId` 收口范围。 */
  startCatalogBatch: (input: {
    probe: boolean
    retryFailedOf?: string
    providerId?: string
  }): Promise<CatalogBatchStartResult> =>
    wire.invoke(IpcChannels.PROVIDERS_START_CATALOG_BATCH, input),

  pauseCatalogBatch: (jobId: string): Promise<boolean> =>
    wire.invoke(IpcChannels.PROVIDERS_PAUSE_CATALOG_BATCH, jobId),

  resumeCatalogBatch: (jobId: string): Promise<boolean> =>
    wire.invoke(IpcChannels.PROVIDERS_RESUME_CATALOG_BATCH, jobId),

  cancelCatalogBatch: (jobId: string): Promise<boolean> =>
    wire.invoke(IpcChannels.PROVIDERS_CANCEL_CATALOG_BATCH, jobId),

  getCatalogBatchJobs: (): Promise<CatalogBatchSnapshot[]> =>
    wire.invoke(IpcChannels.PROVIDERS_GET_CATALOG_BATCH_JOBS),

  onCatalogBatchProgress: (
    listener: (snapshot: CatalogBatchSnapshot) => void,
  ): (() => void) => {
    const handler = (_event: unknown, payload: CatalogBatchSnapshot): void => listener(payload)
    wire.on(IpcChannels.PROVIDERS_CATALOG_BATCH_PROGRESS, handler)
    return () => wire.off(IpcChannels.PROVIDERS_CATALOG_BATCH_PROGRESS, handler)
  },
}

const accountsAPI = {
  // `getAll` 没有 `includeCredentials`：列表页拿不到凭据。`getById` 还留着，
  // 账号编辑框用它预填已存的 Key，去掉它会让界面在编辑时把凭据清空。
  getAll: (): Promise<Account[]> =>
    wire.invoke(IpcChannels.ACCOUNTS_GET_ALL),

  getById: (id: string, includeCredentials?: boolean): Promise<Account | null> =>
    wire.invoke(IpcChannels.ACCOUNTS_GET_BY_ID, id, includeCredentials),
  
  getByProvider: (providerId: string): Promise<Account[]> => 
    wire.invoke(IpcChannels.ACCOUNTS_GET_BY_PROVIDER, providerId),
  
  add: (data: {
    providerId: string
    name: string
    email?: string
    credentials: Record<string, string>
    dailyLimit?: number
  }): Promise<Account> => 
    wire.invoke(IpcChannels.ACCOUNTS_ADD, data),
  
  update: (id: string, updates: Partial<Account>): Promise<Account | null> => 
    wire.invoke(IpcChannels.ACCOUNTS_UPDATE, id, updates),
  
  delete: (id: string): Promise<boolean> => 
    wire.invoke(IpcChannels.ACCOUNTS_DELETE, id),
  
  validate: (accountId: string): Promise<boolean> => 
    wire.invoke(IpcChannels.ACCOUNTS_VALIDATE, accountId),
  
  validateToken: (providerId: string, credentials: Record<string, string>): Promise<{
    valid: boolean
    error?: string
    userInfo?: {
      name?: string
      email?: string
      quota?: number
      used?: number
    }
  }> => 
    wire.invoke(IpcChannels.ACCOUNTS_VALIDATE_TOKEN, providerId, credentials),


}

type ProviderType = ProviderVendor

interface TokenValidationResult {
  valid: boolean
  tokenType?: string
  expiresAt?: number
  accountInfo?: {
    userId?: string
    email?: string
    name?: string
  }
  error?: string
}

interface CredentialInfo {
  type: string
  value: string
  expiresAt?: number
  refreshToken?: string
}

interface OAuthProgressEvent {
  status: 'idle' | 'pending' | 'success' | 'error' | 'cancelled'
  message: string
  progress?: number
  data?: Record<string, unknown>
}

const oauthAPI = {
  startLogin: (providerId: string, providerType: ProviderType): Promise<OAuthResult> => 
    wire.invoke(IpcChannels.OAUTH_START_LOGIN, providerId, providerType),
  
  cancelLogin: (): Promise<void> => 
    wire.invoke(IpcChannels.OAUTH_CANCEL_LOGIN),
  
  loginWithToken: (providerId: string, providerType: ProviderType, token: string): Promise<OAuthResult> =>
    wire.invoke(IpcChannels.OAUTH_LOGIN_WITH_TOKEN, { providerId, providerType, token }),
  
  validateToken: (providerId: string, providerType: ProviderType, credentials: Record<string, string>): Promise<TokenValidationResult> =>
    wire.invoke(IpcChannels.OAUTH_VALIDATE_TOKEN, { providerId, providerType, credentials }),
  
  refreshToken: (providerId: string, providerType: ProviderType, credentials: Record<string, string>): Promise<CredentialInfo | null> =>
    wire.invoke(IpcChannels.OAUTH_REFRESH_TOKEN, { providerId, providerType, credentials }),
  
  getStatus: (): Promise<string> =>
    wire.invoke(IpcChannels.OAUTH_GET_STATUS),
  
  onCallback: (callback: (result: OAuthResult) => void) => {
    const handler = (_event: unknown, result: OAuthResult) => callback(result)
    wire.on(IpcChannels.OAUTH_CALLBACK, handler)
    return () => wire.off(IpcChannels.OAUTH_CALLBACK, handler)
  },
  
  onProgress: (callback: (event: OAuthProgressEvent) => void) => {
    const handler = (_event: unknown, event: OAuthProgressEvent) => callback(event)
    wire.on(IpcChannels.OAUTH_PROGRESS, handler)
    return () => wire.off(IpcChannels.OAUTH_PROGRESS, handler)
  },
}

interface LogFilter {
  level?: LogLevel | 'all'
  keyword?: string
  startTime?: number
  endTime?: number
  limit?: number
  offset?: number
}

interface LogStats {
  total: number
  info: number
  warn: number
  error: number
  debug: number
}

const logsAPI = {
  get: (filter?: LogFilter): Promise<LogEntry[]> => 
    wire.invoke(IpcChannels.LOGS_GET, filter),
  
  getStats: (): Promise<LogStats> => 
    wire.invoke(IpcChannels.LOGS_GET_STATS),
  
  getTrend: (days?: number): Promise<AppLogTrendPoint[]> => 
    wire.invoke(IpcChannels.LOGS_GET_TREND, days),
  
  getAccountTrend: (accountId: string, days?: number): Promise<AppLogTrendPoint[]> => 
    wire.invoke(IpcChannels.LOGS_GET_ACCOUNT_TREND, accountId, days),
  
  clear: (): Promise<void> => 
    wire.invoke(IpcChannels.LOGS_CLEAR),
  
  export: (format?: 'json' | 'txt'): Promise<string> => 
    wire.invoke(IpcChannels.LOGS_EXPORT, format),
  
  getById: (id: string): Promise<LogEntry | undefined> => 
    wire.invoke(IpcChannels.LOGS_GET_BY_ID, id),
}

interface RequestLogFilter {
  status?: 'success' | 'error'
  providerId?: string
  limit?: number
}

interface RequestLogStats {
  total: number
  success: number
  error: number
  todayTotal: number
  todaySuccess: number
  todayError: number
}

const requestLogsAPI = {
  get: (filter?: RequestLogFilter): Promise<RequestLogEntry[]> => 
    wire.invoke(IpcChannels.REQUEST_LOGS_GET, filter),
  
  getById: (id: string): Promise<RequestLogEntry | undefined> => 
    wire.invoke(IpcChannels.REQUEST_LOGS_GET_BY_ID, id),
  
  getStats: (): Promise<RequestLogStats> => 
    wire.invoke(IpcChannels.REQUEST_LOGS_GET_STATS),
  
  clear: (): Promise<void> => 
    wire.invoke(IpcChannels.REQUEST_LOGS_CLEAR),

  bundle: (key: string): Promise<RequestDiagnosticBundle> =>
    wire.invoke(IpcChannels.REQUEST_LOGS_BUNDLE, key),

  saveBundle: (key: string): Promise<{ saved: boolean; path?: string }> =>
    wire.invoke(IpcChannels.REQUEST_LOGS_BUNDLE_SAVE, key),
  
  onNewLog: (callback: (log: RequestLogEntry) => void) => {
    const handler = (_event: unknown, log: RequestLogEntry) => callback(log)
    wire.on(IpcChannels.REQUEST_LOGS_NEW, handler)
    return () => wire.off(IpcChannels.REQUEST_LOGS_NEW, handler)
  },
}

interface PersistentStatistics {
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalLatency: number
  lastUpdated: number
  modelUsage: Record<string, number>
  providerUsage: Record<string, number>
  accountUsage: Record<string, number>
  dailyStats: Record<string, DailyStatistics>
}

interface DailyStatistics {
  date: string
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalLatency: number
  modelUsage: Record<string, number>
  providerUsage: Record<string, number>
  /** Absent on buckets written before outcomes were recorded; never read as 0. */
  providerSuccess?: Record<string, number>
  providerLatency?: Record<string, number>
}

const statisticsAPI = {
  get: (): Promise<PersistentStatistics> => 
    wire.invoke(IpcChannels.STATISTICS_GET),
  
  getToday: (): Promise<DailyStatistics> => 
    wire.invoke(IpcChannels.STATISTICS_GET_TODAY),

  /**
   * Today's token counters, with the upstream-reported and `chars/4`-estimated
   * pools kept apart — see `shared/tokenAccounting`.
   */
  getTokenUsage: (): Promise<DayTokenSummary> =>
    wire.invoke(IpcChannels.STATISTICS_GET_TOKEN_USAGE),

  /** The newest `days` local days of token counters, oldest first. */
  getTokenUsageHistory: (days?: number): Promise<DayTokenSummary[]> =>
    wire.invoke(IpcChannels.STATISTICS_GET_TOKEN_USAGE_HISTORY, days),

  /**
   * Every retained day of token counters, keyed by local day, including the
   * per-provider split. Handed over whole because the period the card sums over
   * is the user's choice, made after this call.
   */
  getTokenUsageDays: (): Promise<Record<string, DayTokenBucket>> =>
    wire.invoke(IpcChannels.STATISTICS_GET_TOKEN_USAGE_DAYS),
}

interface UpdateProgressInfo {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

interface UpdateStatus {
  checking: boolean
  available: boolean
  downloading: boolean
  downloaded: boolean
  error: string | null
  progress: UpdateProgressInfo | null
  version: string | null
  releaseDate: string | null
  releaseNotes: string | null
}

const appAPI = {
  getVersion: (): Promise<string> => 
    wire.invoke(IpcChannels.APP_GET_VERSION),
  
  minimize: (): Promise<void> => 
    wire.invoke(IpcChannels.APP_MINIMIZE),
  
  maximize: (): Promise<void> => 
    wire.invoke(IpcChannels.APP_MAXIMIZE),
  
  close: (): Promise<void> =>
    wire.invoke(IpcChannels.APP_CLOSE),

  showWindow: (): Promise<void> =>
    wire.invoke(IpcChannels.APP_SHOW_WINDOW),

  hideWindow: (): Promise<void> =>
    wire.invoke(IpcChannels.APP_HIDE_WINDOW),

  setTitleBarTheme: (theme: 'dark' | 'light'): Promise<void> =>
    wire.invoke(IpcChannels.APP_SET_TITLE_BAR_THEME, theme),

  /**
   * `process` exists in the preload context, but not in a page the headless daemon serves:
   * a browser tab or the Windows shell loading `/ui/` died at module scope with
   * "process is not defined" and left the window black. This field only says where the
   * system caption buttons sit, so off the desktop the honest answer is "none here".
   */
  platform: typeof process === 'undefined' ? 'browser' : process.platform,

  openExternal: (url: string): Promise<void> =>
    wire.invoke(IpcChannels.APP_OPEN_EXTERNAL, url),

  checkUpdate: (): Promise<UpdateStatus> =>
    wire.invoke(IpcChannels.APP_CHECK_UPDATE),

  downloadUpdate: (): Promise<void> =>
    wire.invoke(IpcChannels.APP_DOWNLOAD_UPDATE),

  installUpdate: (): Promise<void> =>
    wire.invoke(IpcChannels.APP_INSTALL_UPDATE),

  getUpdateStatus: (): Promise<UpdateStatus> =>
    wire.invoke(IpcChannels.APP_GET_UPDATE_STATUS),

  onUpdateChecking: (callback: () => void) => {
    const listener = (_event: unknown) => callback()
    wire.on(IpcChannels.APP_UPDATE_CHECKING, listener)
    return () => wire.off(IpcChannels.APP_UPDATE_CHECKING, listener)
  },

  onUpdateAvailable: (callback: (info: any) => void) => {
    const listener = (_event: unknown, info: any) => callback(info)
    wire.on(IpcChannels.APP_UPDATE_AVAILABLE, listener)
    return () => wire.off(IpcChannels.APP_UPDATE_AVAILABLE, listener)
  },

  onUpdateNotAvailable: (callback: (info: any) => void) => {
    const listener = (_event: unknown, info: any) => callback(info)
    wire.on(IpcChannels.APP_UPDATE_NOT_AVAILABLE, listener)
    return () => wire.off(IpcChannels.APP_UPDATE_NOT_AVAILABLE, listener)
  },

  onUpdateProgress: (callback: (progress: UpdateProgressInfo) => void) => {
    const listener = (_event: unknown, progress: UpdateProgressInfo) => callback(progress)
    wire.on(IpcChannels.APP_UPDATE_PROGRESS, listener)
    return () => wire.off(IpcChannels.APP_UPDATE_PROGRESS, listener)
  },

  onUpdateDownloaded: (callback: (info: any) => void) => {
    const listener = (_event: unknown, info: any) => callback(info)
    wire.on(IpcChannels.APP_UPDATE_DOWNLOADED, listener)
    return () => wire.off(IpcChannels.APP_UPDATE_DOWNLOADED, listener)
  },

  onUpdateError: (callback: (error: { message?: string } | string) => void) => {
    const listener = (_event: unknown, error: { message?: string } | string) => callback(error)
    wire.on(IpcChannels.APP_UPDATE_ERROR, listener)
    return () => wire.off(IpcChannels.APP_UPDATE_ERROR, listener)
  },
}

const configAPI = {
  get: (): Promise<AppConfig> => 
    wire.invoke(IpcChannels.CONFIG_GET),
  
  update: (updates: Partial<AppConfig>): Promise<boolean> => 
    wire.invoke(IpcChannels.CONFIG_UPDATE, updates),
  
  onConfigChanged: (callback: (config: AppConfig) => void) => {
    const handler = (_event: unknown, config: AppConfig) => callback(config)
    wire.on(IpcChannels.CONFIG_CHANGED, handler)
    return () => wire.off(IpcChannels.CONFIG_CHANGED, handler)
  },
}

/**
 * Anthropic 客户端的可发现名（`config.modelMappings` 里那些 `claude*` / `anthropic*` 入口）。
 * 两条通道与 `anthropic:discovery-plan|apply` 一一对应：`plan` 只读，`apply` 落库。
 */
const anthropicDiscoveryAPI = {
  plan: (): Promise<AnthropicDiscoveryResult> =>
    wire.invoke(IpcChannels.ANTHROPIC_DISCOVERY_PLAN),

  apply: (): Promise<AnthropicRouteApplyResult> =>
    wire.invoke(IpcChannels.ANTHROPIC_DISCOVERY_APPLY),
}

/**
 * 多路由 CRUD（`AppConfig.routes`）。四条方法与 `routes:list|create|update|delete`
 * 一一对应，返回形状与 `channels:*` 同风格：`{ok:true,…} | {ok:false,error:{code,message}}`，
 * 错误以可读文本到达界面（不在 IPC 层变成 undefined 或异常）。
 *
 * 三个写方法成功时都带回归一后的整表，界面不需要再拉一次 `list`；随后主进程广播
 * `CONFIG_CHANGED`（载荷同样是带 `routes` 的完整配置），所以订阅了 `config.onConfigChanged`
 * 的页面也会一起刷新。
 */
const routesAPI = {
  list: (): Promise<RouteListResult> =>
    wire.invoke(IpcChannels.ROUTES_LIST),

  create: (input: Partial<ModelRoute> & { name: string }): Promise<RouteMutationResult> =>
    wire.invoke(IpcChannels.ROUTES_CREATE, input),

  // `currentName` 是现在盘上的规范名；`patch.name` 才是改名。
  update: (currentName: string, patch: Partial<ModelRoute>): Promise<RouteMutationResult> =>
    wire.invoke(IpcChannels.ROUTES_UPDATE, currentName, patch),

  // 命名跟随 `providers:delete` / `accounts:delete` → `delete()`，与通道名一一对应。
  delete: (name: string): Promise<RouteRemovalResult> =>
    wire.invoke(IpcChannels.ROUTES_DELETE, name),

  // 只算不写：用和生产请求同一条采集/策略/手动增删管线，返回逐模型状态。
  preview: (route: ModelRoute, sample?: RoutePreviewSample): Promise<RoutePreviewResult> =>
    wire.invoke(IpcChannels.ROUTES_PREVIEW, route, sample),

  // 只算不写：一次采集折全表，返回每条路由的候选模型数（列表页要的是数字，不是明细）。
  poolSizes: (): Promise<RoutePoolSizesResult> =>
    wire.invoke(IpcChannels.ROUTES_POOL_SIZES),
}

interface SessionConfig {
  mode: 'single'
  sessionTimeout: number
  maxMessagesPerSession: number
  deleteAfterTimeout: boolean
  maxSessionsPerAccount: number
}

interface SessionRecord {
  id: string
  providerId: string
  accountId: string
  providerSessionId: string
  parentMessageId?: string
  sessionType: 'chat' | 'agent'
  messages: any[]
  createdAt: number
  lastActiveAt: number
  status: 'active' | 'expired' | 'deleted'
  model?: string
}

const sessionAPI = {
  getConfig: (): Promise<SessionConfig> => 
    wire.invoke(IpcChannels.SESSION_GET_CONFIG),
  
  updateConfig: (config: Partial<SessionConfig>): Promise<void> => 
    wire.invoke(IpcChannels.SESSION_UPDATE_CONFIG, config),
  
  getAll: (): Promise<SessionRecord[]> => 
    wire.invoke(IpcChannels.SESSION_GET_ALL),
  
  getActive: (): Promise<SessionRecord[]> => 
    wire.invoke(IpcChannels.SESSION_GET_ACTIVE),
  
  getById: (id: string): Promise<SessionRecord | undefined> => 
    wire.invoke(IpcChannels.SESSION_GET_BY_ID, id),
  
  getByAccount: (accountId: string): Promise<SessionRecord[]> => 
    wire.invoke(IpcChannels.SESSION_GET_BY_ACCOUNT, accountId),
  
  getByProvider: (providerId: string): Promise<SessionRecord[]> => 
    wire.invoke(IpcChannels.SESSION_GET_BY_PROVIDER, providerId),
  
  delete: (id: string): Promise<boolean> => 
    wire.invoke(IpcChannels.SESSION_DELETE, id),
  
  clearAll: (): Promise<void> => 
    wire.invoke(IpcChannels.SESSION_CLEAR_ALL),
  
  cleanExpired: (): Promise<number> => 
    wire.invoke(IpcChannels.SESSION_CLEAN_EXPIRED),
}

interface ManagementApiConfig {
  enableManagementApi: boolean
  managementApiSecret: string
}

interface ContextManagementConfig {
  enabled: boolean
  strategies: {
    slidingWindow: {
      enabled: boolean
      maxMessages: number
    }
    tokenLimit: {
      enabled: boolean
      maxTokens: number
    }
  }
  executionOrder: ('slidingWindow' | 'tokenLimit')[]
  /** 仅这些渠道的流量会被裁剪；缺省/空 = 不裁剪任何渠道（头切会打碎上游前缀缓存）。 */
  channelIds?: string[]
}

const managementApiAPI = {
  getConfig: (): Promise<ManagementApiConfig> => 
    wire.invoke(IpcChannels.MANAGEMENT_API_GET_CONFIG),
  
  updateConfig: (updates: Partial<ManagementApiConfig>): Promise<ManagementApiConfig> => 
    wire.invoke(IpcChannels.MANAGEMENT_API_UPDATE_CONFIG, updates),
  
  generateSecret: (): Promise<string> => 
    wire.invoke(IpcChannels.MANAGEMENT_API_GENERATE_SECRET),
}

const contextManagementAPI = {
  getConfig: (): Promise<ContextManagementConfig> => 
    wire.invoke(IpcChannels.CONTEXT_MANAGEMENT_GET_CONFIG),
  
  updateConfig: (updates: Partial<ContextManagementConfig>): Promise<ContextManagementConfig> => 
    wire.invoke(IpcChannels.CONTEXT_MANAGEMENT_UPDATE_CONFIG, updates),
}

const trayAPI = {
  openDashboard: (): void => 
    wire.send('tray:open-dashboard'),
  
  setHeight: (height: number): void => 
    wire.send('tray:set-height', height),

  quitApp: (): void =>
    wire.send('tray:quit-app'),
}

const modelRefreshAPI = {
  getStatus: (): Promise<{ config: unknown; tasks: unknown[] }> =>
    wire.invoke(IpcChannels.MODEL_REFRESH_GET_STATUS),

  triggerNow: (): Promise<{ ok: boolean; reason?: string; tasks: unknown[] }> =>
    wire.invoke(IpcChannels.MODEL_REFRESH_TRIGGER_NOW),
}

const aggregateAPI = {
  list: (): Promise<AggregateListResult> =>
    wire.invoke(IpcChannels.AGGREGATE_LIST),

  save: (input: AggregateSaveInput): Promise<{
    success: boolean
    provider?: Provider
    reason?: string
  }> => wire.invoke(IpcChannels.AGGREGATE_SAVE, input),

  setEnabled: (id: string, enabled: boolean): Promise<{
    success: boolean
    provider?: Provider
    reason?: string
  }> => wire.invoke(IpcChannels.AGGREGATE_SET_ENABLED, id, enabled),

  remove: (id: string): Promise<{ success: boolean }> =>
    wire.invoke(IpcChannels.AGGREGATE_REMOVE, id),

  test: (id: string): Promise<AggregateOperationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_TEST, id),

  // 在线同步模型清单：多把 Key 轮换探测，把上游新模型并入条目清单。
  syncModels: (id: string): Promise<AggregateOperationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_SYNC_MODELS, id),

  detail: (id: string): Promise<AggregateDetail | null> =>
    wire.invoke(IpcChannels.AGGREGATE_DETAIL, id),

  addKey: (id: string, apiKey: string): Promise<AggregateMutationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_ADD_KEY, id, apiKey),

  removeKey: (accountId: string): Promise<AggregateMutationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_REMOVE_KEY, accountId),

  setKeyEnabled: (accountId: string, enabled: boolean): Promise<AggregateMutationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_SET_KEY_ENABLED, accountId, enabled),

  validateKey: (id: string, accountId: string): Promise<AggregateMutationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_VALIDATE_KEY, id, accountId),

  addModel: (id: string, modelId: string): Promise<AggregateMutationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_ADD_MODEL, id, modelId),

  removeModel: (id: string, modelId: string): Promise<AggregateMutationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_REMOVE_MODEL, id, modelId),

  setModelEnabled: (id: string, modelId: string, enabled: boolean): Promise<AggregateMutationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_SET_MODEL_ENABLED, id, modelId, enabled),

  setModelParams: (id: string, modelId: string, params: Record<string, unknown>): Promise<AggregateMutationResult> =>
    wire.invoke(IpcChannels.AGGREGATE_SET_MODEL_PARAMS, id, modelId, params),

  testModel: (id: string, modelId: string): Promise<AggregateModelTestResult> =>
    wire.invoke(IpcChannels.AGGREGATE_TEST_MODEL, id, modelId),

  // 账号级实时额度：点一次问一次。没有轮询通道，也没有开页自动发。
  queryCredits: (id: string): Promise<AggregateCreditQueryResult> =>
    wire.invoke(IpcChannels.AGGREGATE_QUERY_CREDITS, id),
}

const channelsAPI = {
  list: (): Promise<{ success: boolean; reason?: string; channels: ChannelView[] }> =>
    wire.invoke(IpcChannels.CHANNELS_LIST),

  // 每家渠道账号池的计数（不含账号列表，也不读模型目录）：供应商卡片上的
  // 「已启用 / 全部」用这一份，而不是本地账号表里那一条占位账号。
  accountCounts: (): Promise<Record<string, { total: number; enabled: number }>> =>
    wire.invoke(IpcChannels.CHANNELS_ACCOUNT_COUNTS),

  rpc: (method: string, payload?: unknown): Promise<ChannelRpcResult> =>
    wire.invoke(IpcChannels.CHANNELS_RPC, method, payload),

  credits: (id: string): Promise<ChannelCredits> =>
    wire.invoke(IpcChannels.CHANNELS_CREDITS, id),

  // 一次问完多家渠道的积分：远程 UI 上这是 1 笔管理面请求，而不是每家 1 笔。
  // 单家的失败在 results 里是 `error` 字段，不会让整页一起失败。
  creditsAll: (ids: string[]): Promise<Record<string, ChannelCredits>> =>
    wire.invoke(IpcChannels.CHANNELS_CREDITS_ALL, ids),

  setEnabled: (id: string, enabled: boolean): Promise<ChannelOperationResult> =>
    wire.invoke(IpcChannels.CHANNELS_SET_ENABLED, id, enabled),

  remove: (id: string): Promise<ChannelOperationResult> =>
    wire.invoke(IpcChannels.CHANNELS_REMOVE, id),

  // 省略参数 = 读；给出布尔 = 改写「每日自动领取签到积分」开关。
  autoCheckin: (enabled?: boolean): Promise<ChannelAutoCheckinResult> =>
    wire.invoke(IpcChannels.CHANNELS_AUTO_CHECKIN, enabled),

  // 在线模型目录（含积分权重与免费标记），以及强制重拉这一个渠道。
  models: (id: string): Promise<ChannelModelsResult> =>
    wire.invoke(IpcChannels.CHANNELS_MODELS, id),

  refreshModels: (id: string): Promise<ChannelRefreshResult> =>
    wire.invoke(IpcChannels.CHANNELS_REFRESH_MODELS, id),

  // 模型开关与失效恢复：返回结果里带最新目录，界面不必再单独拉一次。
  setModelDisabled: (id: string, modelId: string, disabled: boolean): Promise<ChannelModelUpdateResult> =>
    wire.invoke(IpcChannels.CHANNELS_SET_MODEL_DISABLED, id, modelId, disabled),

  clearDeadModels: (id: string, modelId?: string): Promise<ChannelModelUpdateResult> =>
    wire.invoke(IpcChannels.CHANNELS_CLEAR_DEAD_MODELS, id, modelId),

  onChanged: (callback: () => void) => {
    const handler = () => callback()
    wire.on(IpcChannels.CHANNELS_CHANGED, handler)
    return () => wire.off(IpcChannels.CHANNELS_CHANGED, handler)
  },
}

const electronAPI = {
  proxy: proxyAPI,
  tls: tlsAPI,
  store: storeAPI,
  backup: backupAPI,
  providers: providersAPI,
  aggregate: aggregateAPI,
  channels: channelsAPI,
  accounts: accountsAPI,
  oauth: oauthAPI,
  logs: logsAPI,
  requestLogs: requestLogsAPI,
  statistics: statisticsAPI,
  app: appAPI,
  config: configAPI,
  anthropicDiscovery: anthropicDiscoveryAPI,
  routes: routesAPI,
  session: sessionAPI,
  managementApi: managementApiAPI,
  contextManagement: contextManagementAPI,
  tray: trayAPI,
  modelRefresh: modelRefreshAPI,

  // 这里刻意**没有**通用的 `invoke` / `send` / `on`。曾经有，等于把整个 `ipcRenderer`
  // 原样交给渲染进程：任何在渲染层执行的 JS 都能调用全部通道，包括
  // `accounts:get-all(true)`（拿解密后的凭据）与 `store:set('accounts', …)`（绕过加密写盘），
  // `contextIsolation` 的收益被抵消大半。现在渲染层只能走上面这些具名方法，
  // 要新增通道就必须在 preload 显式登记 + 在 `shared/types` / `electron.d.ts` 里带上类型。
}

  return electronAPI
}
