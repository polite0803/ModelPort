import { contextBridge, ipcRenderer } from 'electron'
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
} from '../shared/types'
import type {
  RouteListResult,
  RouteMutationResult,
  RouteRemovalResult,
  RoutePoolSizesResult,
} from '../shared/modelRouteName'
import type {
  AnthropicDiscoveryResult,
  AnthropicRouteApplyResult,
} from '../shared/anthropicDiscovery'
import type { AggregateCreditQueryResult } from '../shared/aggregateCredit'
import type { ModelMetadataReport } from '../shared/modelMetadata'
import type {
  ModelProbeRunResult,
  ProbeJobSnapshot,
  ProbeProgressEvent,
  ProbeScope,
} from '../shared/modelProbe'
import type {
  CatalogAdoption,
  CatalogAdoptionField,
  CatalogCandidatesResult,
  CatalogRefreshResult,
  CatalogSnapshotStatus,
  CatalogSourceId,
} from '../shared/modelCatalog.ts'
import type {
  AggregateDetail,
  AggregateListResult,
  AggregateModelTestResult,
  AggregateMutationResult,
  AggregateOperationResult,
  AggregateSaveInput,
} from '../shared/aggregate'
import type {
  ChannelAutoCheckinResult,
  ChannelCredits,
  ChannelModelsResult,
  ChannelModelUpdateResult,
  ChannelOperationResult,
  ChannelRefreshResult,
  ChannelRpcResult,
  ChannelView,
} from '../shared/channels'
import type { DayTokenBucket, DayTokenSummary } from '../shared/tokenAccounting'

const proxyAPI = {
  start: (port?: number): Promise<boolean> => 
    ipcRenderer.invoke(IpcChannels.PROXY_START, port),
  
  stop: (): Promise<boolean> => 
    ipcRenderer.invoke(IpcChannels.PROXY_STOP),
  
  getStatus: (): Promise<ProxyStatus> => 
    ipcRenderer.invoke(IpcChannels.PROXY_GET_STATUS),

  getStatistics: (): Promise<ProxyStatistics> =>
    ipcRenderer.invoke(IpcChannels.PROXY_GET_STATISTICS),
  
  onStatusChanged: (callback: (status: ProxyStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ProxyStatus) => callback(status)
    ipcRenderer.on(IpcChannels.PROXY_STATUS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.PROXY_STATUS_CHANGED, handler)
  },
}

const tlsAPI = {
  getStatus: (): Promise<TlsStatus> =>
    ipcRenderer.invoke(IpcChannels.TLS_STATUS),

  installTrust: (): Promise<TlsTrustResult> =>
    ipcRenderer.invoke(IpcChannels.TLS_INSTALL_TRUST),

  uninstallTrust: (): Promise<TlsTrustResult> =>
    ipcRenderer.invoke(IpcChannels.TLS_UNINSTALL_TRUST),
}

const storeAPI = {
  get: <T>(key: string): Promise<T | undefined> => 
    ipcRenderer.invoke(IpcChannels.STORE_GET, key),

  // 没有 `set` / `delete`：整份配置走 `config:update`（主进程深合并），厂商/账号/路由
  // 各有专用通道。通用写通道曾让渲染层能绕过 `encryptCredentials` 把明文凭据写进
  // data.json，现在主进程对未登记键直接拒绝，这层也一并撤掉，不留「调用必失败」的面。
  
  clearAll: (): Promise<void> => 
    ipcRenderer.invoke(IpcChannels.STORE_CLEAR_ALL),
  
  onInitError: (callback: (error: { message: string | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: { message: string | null }) => callback(error)
    ipcRenderer.on(IpcChannels.STORE_INIT_ERROR, handler)
    return () => ipcRenderer.removeListener(IpcChannels.STORE_INIT_ERROR, handler)
  },
  
  retryInit: (): Promise<{ success: boolean; error?: string }> => 
    ipcRenderer.invoke(IpcChannels.STORE_RETRY_INIT),
}

const providersAPI = {
  getAll: (): Promise<Provider[]> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_GET_ALL),
  
  getBuiltin: (): Promise<any[]> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_GET_BUILTIN),
  
  add: (data: {
    name: string
    authType: AuthType
    apiEndpoint: string
    headers?: Record<string, string>
    description?: string
    supportedModels?: string[]
    credentialFields?: CredentialField[]
  }): Promise<Provider> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_ADD, data),
  
  update: (id: string, updates: Partial<Provider>): Promise<Provider | null> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_UPDATE, id, updates),
  
  delete: (id: string): Promise<boolean> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_DELETE, id),
  
  checkStatus: (providerId: string): Promise<ProviderCheckResult> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_CHECK_STATUS, providerId),
  
  checkAllStatus: (): Promise<Record<string, ProviderCheckResult>> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_CHECK_ALL_STATUS),
  
  duplicate: (id: string): Promise<Provider> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_DUPLICATE, id),
  
  export: (id: string): Promise<string> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_EXPORT, id),
  
  import: (jsonData: string): Promise<Provider> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_IMPORT, jsonData),
  
  updateModels: (providerId: string): Promise<{
    success: boolean
    reason?: ModelsFetchFailure
    detail?: string
    fetchedCount?: number
    addedCount?: number
    fetchedAt?: number
  }> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_UPDATE_MODELS, providerId),
  
  getEffectiveModels: (providerId: string): Promise<EffectiveModel[]> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_GET_EFFECTIVE_MODELS, providerId),
  
  getModelCatalogue: (providerId: string): Promise<CatalogueModel[]> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_GET_MODEL_CATALOGUE, providerId),
  
  setModelsServed: (providerId: string, names: string[], served: boolean): Promise<{
    success: boolean
    catalogue: CatalogueModel[]
    error?: string
  }> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_SET_MODELS_SERVED, providerId, names, served),
  
  addCustomModel: (providerId: string, model: { displayName: string; actualModelId: string }): Promise<{
    success: boolean
    models: EffectiveModel[]
    error?: string
  }> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_ADD_CUSTOM_MODEL, providerId, model),
  
  removeModel: (providerId: string, modelName: string): Promise<{
    success: boolean
    models: EffectiveModel[]
    error?: string
  }> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_REMOVE_MODEL, providerId, modelName),
  
  resetModels: (providerId: string): Promise<{
    success: boolean
    models: EffectiveModel[]
    error?: string
  }> => 
    ipcRenderer.invoke(IpcChannels.PROVIDERS_RESET_MODELS, providerId),

  getModelMarks: (): Promise<Record<string, Record<string, ModelCapabilityHint>>> =>
    ipcRenderer.invoke(IpcChannels.PROVIDERS_GET_MODEL_MARKS),

  setModelMark: (providerId: string, displayName: string, mark: ModelCapabilityHint | null): Promise<{
    success: boolean
    marks: Record<string, Record<string, ModelCapabilityHint>>
    error?: string
  }> =>
    ipcRenderer.invoke(IpcChannels.PROVIDERS_SET_MODEL_MARK, providerId, displayName, mark),

  getModelMetadata: (): Promise<ModelMetadataReport | { success: false; error: string }> =>
    ipcRenderer.invoke(IpcChannels.PROVIDERS_GET_MODEL_METADATA),

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
    ipcRenderer.invoke(IpcChannels.PROVIDERS_PROBE_MODEL, providerId, displayName, scope, force),

  /** 取消一条进行中的探测：立即停止后续档位，已完成档位结论保留。 */
  cancelProbe: (jobId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IpcChannels.PROVIDERS_CANCEL_PROBE, jobId),

  /** 关闭弹窗后回读后台任务：进行中 + 最近完成。 */
  getProbeJobs: (): Promise<ProbeJobSnapshot[]> =>
    ipcRenderer.invoke(IpcChannels.PROVIDERS_GET_PROBE_JOBS),

  /** 探测进度事件；返回取消订阅函数。 */
  onProbeProgress: (listener: (event: ProbeProgressEvent) => void): (() => void) => {
    const handler = (_event: unknown, payload: ProbeProgressEvent): void => listener(payload)
    ipcRenderer.on(IpcChannels.PROVIDERS_PROBE_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IpcChannels.PROVIDERS_PROBE_PROGRESS, handler)
  },

  /** 标准模型库：快照元数据（不联网、不含 entries） */
  getCatalogStatuses: (): Promise<CatalogSnapshotStatus[]> =>
    ipcRenderer.invoke(IpcChannels.PROVIDERS_GET_CATALOG_STATUSES),

  /** 用户显式刷新；失败时返回 success:false 且旧快照保留 */
  refreshCatalog: (source: CatalogSourceId): Promise<CatalogRefreshResult> =>
    ipcRenderer.invoke(IpcChannels.PROVIDERS_REFRESH_CATALOG, source),

  getCatalogCandidates: (
    providerId: string,
    displayName: string,
  ): Promise<CatalogCandidatesResult> =>
    ipcRenderer.invoke(IpcChannels.PROVIDERS_GET_CATALOG_CANDIDATES, providerId, displayName),

  adoptCatalogField: (
    providerId: string,
    displayName: string,
    catalogId: string,
    field: CatalogAdoptionField,
  ): Promise<{ success: boolean; adoptions?: CatalogAdoption[]; error?: string }> =>
    ipcRenderer.invoke(
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
    ipcRenderer.invoke(
      IpcChannels.PROVIDERS_REVOKE_CATALOG_ADOPTION,
      providerId,
      displayName,
      field,
    ),
}

const accountsAPI = {
  // `getAll` 没有 `includeCredentials`：列表页拿不到凭据。`getById` 还留着，
  // 账号编辑框用它预填已存的 Key，去掉它会让界面在编辑时把凭据清空。
  getAll: (): Promise<Account[]> =>
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_GET_ALL),

  getById: (id: string, includeCredentials?: boolean): Promise<Account | null> =>
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_GET_BY_ID, id, includeCredentials),
  
  getByProvider: (providerId: string): Promise<Account[]> => 
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_GET_BY_PROVIDER, providerId),
  
  add: (data: {
    providerId: string
    name: string
    email?: string
    credentials: Record<string, string>
    dailyLimit?: number
  }): Promise<Account> => 
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_ADD, data),
  
  update: (id: string, updates: Partial<Account>): Promise<Account | null> => 
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_UPDATE, id, updates),
  
  delete: (id: string): Promise<boolean> => 
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_DELETE, id),
  
  validate: (accountId: string): Promise<boolean> => 
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_VALIDATE, accountId),
  
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
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_VALIDATE_TOKEN, providerId, credentials),


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
    ipcRenderer.invoke(IpcChannels.OAUTH_START_LOGIN, providerId, providerType),
  
  cancelLogin: (): Promise<void> => 
    ipcRenderer.invoke(IpcChannels.OAUTH_CANCEL_LOGIN),
  
  loginWithToken: (providerId: string, providerType: ProviderType, token: string): Promise<OAuthResult> =>
    ipcRenderer.invoke(IpcChannels.OAUTH_LOGIN_WITH_TOKEN, { providerId, providerType, token }),
  
  validateToken: (providerId: string, providerType: ProviderType, credentials: Record<string, string>): Promise<TokenValidationResult> =>
    ipcRenderer.invoke(IpcChannels.OAUTH_VALIDATE_TOKEN, { providerId, providerType, credentials }),
  
  refreshToken: (providerId: string, providerType: ProviderType, credentials: Record<string, string>): Promise<CredentialInfo | null> =>
    ipcRenderer.invoke(IpcChannels.OAUTH_REFRESH_TOKEN, { providerId, providerType, credentials }),
  
  getStatus: (): Promise<string> =>
    ipcRenderer.invoke(IpcChannels.OAUTH_GET_STATUS),
  
  onCallback: (callback: (result: OAuthResult) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: OAuthResult) => callback(result)
    ipcRenderer.on(IpcChannels.OAUTH_CALLBACK, handler)
    return () => ipcRenderer.removeListener(IpcChannels.OAUTH_CALLBACK, handler)
  },
  
  onProgress: (callback: (event: OAuthProgressEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: OAuthProgressEvent) => callback(event)
    ipcRenderer.on(IpcChannels.OAUTH_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IpcChannels.OAUTH_PROGRESS, handler)
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
    ipcRenderer.invoke(IpcChannels.LOGS_GET, filter),
  
  getStats: (): Promise<LogStats> => 
    ipcRenderer.invoke(IpcChannels.LOGS_GET_STATS),
  
  getTrend: (days?: number): Promise<AppLogTrendPoint[]> => 
    ipcRenderer.invoke(IpcChannels.LOGS_GET_TREND, days),
  
  getAccountTrend: (accountId: string, days?: number): Promise<AppLogTrendPoint[]> => 
    ipcRenderer.invoke(IpcChannels.LOGS_GET_ACCOUNT_TREND, accountId, days),
  
  clear: (): Promise<void> => 
    ipcRenderer.invoke(IpcChannels.LOGS_CLEAR),
  
  export: (format?: 'json' | 'txt'): Promise<string> => 
    ipcRenderer.invoke(IpcChannels.LOGS_EXPORT, format),
  
  getById: (id: string): Promise<LogEntry | undefined> => 
    ipcRenderer.invoke(IpcChannels.LOGS_GET_BY_ID, id),
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
    ipcRenderer.invoke(IpcChannels.REQUEST_LOGS_GET, filter),
  
  getById: (id: string): Promise<RequestLogEntry | undefined> => 
    ipcRenderer.invoke(IpcChannels.REQUEST_LOGS_GET_BY_ID, id),
  
  getStats: (): Promise<RequestLogStats> => 
    ipcRenderer.invoke(IpcChannels.REQUEST_LOGS_GET_STATS),
  
  clear: (): Promise<void> => 
    ipcRenderer.invoke(IpcChannels.REQUEST_LOGS_CLEAR),

  bundle: (key: string): Promise<RequestDiagnosticBundle> =>
    ipcRenderer.invoke(IpcChannels.REQUEST_LOGS_BUNDLE, key),

  saveBundle: (key: string): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke(IpcChannels.REQUEST_LOGS_BUNDLE_SAVE, key),
  
  onNewLog: (callback: (log: RequestLogEntry) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, log: RequestLogEntry) => callback(log)
    ipcRenderer.on(IpcChannels.REQUEST_LOGS_NEW, handler)
    return () => ipcRenderer.removeListener(IpcChannels.REQUEST_LOGS_NEW, handler)
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
    ipcRenderer.invoke(IpcChannels.STATISTICS_GET),
  
  getToday: (): Promise<DailyStatistics> => 
    ipcRenderer.invoke(IpcChannels.STATISTICS_GET_TODAY),

  /**
   * Today's token counters, with the upstream-reported and `chars/4`-estimated
   * pools kept apart — see `shared/tokenAccounting`.
   */
  getTokenUsage: (): Promise<DayTokenSummary> =>
    ipcRenderer.invoke(IpcChannels.STATISTICS_GET_TOKEN_USAGE),

  /** The newest `days` local days of token counters, oldest first. */
  getTokenUsageHistory: (days?: number): Promise<DayTokenSummary[]> =>
    ipcRenderer.invoke(IpcChannels.STATISTICS_GET_TOKEN_USAGE_HISTORY, days),

  /**
   * Every retained day of token counters, keyed by local day, including the
   * per-provider split. Handed over whole because the period the card sums over
   * is the user's choice, made after this call.
   */
  getTokenUsageDays: (): Promise<Record<string, DayTokenBucket>> =>
    ipcRenderer.invoke(IpcChannels.STATISTICS_GET_TOKEN_USAGE_DAYS),
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
    ipcRenderer.invoke(IpcChannels.APP_GET_VERSION),
  
  minimize: (): Promise<void> => 
    ipcRenderer.invoke(IpcChannels.APP_MINIMIZE),
  
  maximize: (): Promise<void> => 
    ipcRenderer.invoke(IpcChannels.APP_MAXIMIZE),
  
  close: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.APP_CLOSE),

  showWindow: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.APP_SHOW_WINDOW),

  hideWindow: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.APP_HIDE_WINDOW),

  setTitleBarTheme: (theme: 'dark' | 'light'): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.APP_SET_TITLE_BAR_THEME, theme),

  platform: process.platform,

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.APP_OPEN_EXTERNAL, url),

  checkUpdate: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke(IpcChannels.APP_CHECK_UPDATE),

  downloadUpdate: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.APP_DOWNLOAD_UPDATE),

  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.APP_INSTALL_UPDATE),

  getUpdateStatus: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke(IpcChannels.APP_GET_UPDATE_STATUS),

  onUpdateChecking: (callback: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => callback()
    ipcRenderer.on(IpcChannels.APP_UPDATE_CHECKING, listener)
    return () => ipcRenderer.removeListener(IpcChannels.APP_UPDATE_CHECKING, listener)
  },

  onUpdateAvailable: (callback: (info: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: any) => callback(info)
    ipcRenderer.on(IpcChannels.APP_UPDATE_AVAILABLE, listener)
    return () => ipcRenderer.removeListener(IpcChannels.APP_UPDATE_AVAILABLE, listener)
  },

  onUpdateNotAvailable: (callback: (info: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: any) => callback(info)
    ipcRenderer.on(IpcChannels.APP_UPDATE_NOT_AVAILABLE, listener)
    return () => ipcRenderer.removeListener(IpcChannels.APP_UPDATE_NOT_AVAILABLE, listener)
  },

  onUpdateProgress: (callback: (progress: UpdateProgressInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: UpdateProgressInfo) => callback(progress)
    ipcRenderer.on(IpcChannels.APP_UPDATE_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IpcChannels.APP_UPDATE_PROGRESS, listener)
  },

  onUpdateDownloaded: (callback: (info: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: any) => callback(info)
    ipcRenderer.on(IpcChannels.APP_UPDATE_DOWNLOADED, listener)
    return () => ipcRenderer.removeListener(IpcChannels.APP_UPDATE_DOWNLOADED, listener)
  },

  onUpdateError: (callback: (error: { message?: string } | string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: { message?: string } | string) => callback(error)
    ipcRenderer.on(IpcChannels.APP_UPDATE_ERROR, listener)
    return () => ipcRenderer.removeListener(IpcChannels.APP_UPDATE_ERROR, listener)
  },
}

const configAPI = {
  get: (): Promise<AppConfig> => 
    ipcRenderer.invoke(IpcChannels.CONFIG_GET),
  
  update: (updates: Partial<AppConfig>): Promise<boolean> => 
    ipcRenderer.invoke(IpcChannels.CONFIG_UPDATE, updates),
  
  onConfigChanged: (callback: (config: AppConfig) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, config: AppConfig) => callback(config)
    ipcRenderer.on(IpcChannels.CONFIG_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CONFIG_CHANGED, handler)
  },
}

/**
 * Anthropic 客户端的可发现名（`config.modelMappings` 里那些 `claude*` / `anthropic*` 入口）。
 * 两条通道与 `anthropic:discovery-plan|apply` 一一对应：`plan` 只读，`apply` 落库。
 */
const anthropicDiscoveryAPI = {
  plan: (): Promise<AnthropicDiscoveryResult> =>
    ipcRenderer.invoke(IpcChannels.ANTHROPIC_DISCOVERY_PLAN),

  apply: (): Promise<AnthropicRouteApplyResult> =>
    ipcRenderer.invoke(IpcChannels.ANTHROPIC_DISCOVERY_APPLY),
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
    ipcRenderer.invoke(IpcChannels.ROUTES_LIST),

  create: (input: Partial<ModelRoute> & { name: string }): Promise<RouteMutationResult> =>
    ipcRenderer.invoke(IpcChannels.ROUTES_CREATE, input),

  // `currentName` 是现在盘上的规范名；`patch.name` 才是改名。
  update: (currentName: string, patch: Partial<ModelRoute>): Promise<RouteMutationResult> =>
    ipcRenderer.invoke(IpcChannels.ROUTES_UPDATE, currentName, patch),

  // 命名跟随 `providers:delete` / `accounts:delete` → `delete()`，与通道名一一对应。
  delete: (name: string): Promise<RouteRemovalResult> =>
    ipcRenderer.invoke(IpcChannels.ROUTES_DELETE, name),

  // 只算不写：用和生产请求同一条采集/策略/手动增删管线，返回逐模型状态。
  preview: (route: ModelRoute, sample?: RoutePreviewSample): Promise<RoutePreviewResult> =>
    ipcRenderer.invoke(IpcChannels.ROUTES_PREVIEW, route, sample),

  // 只算不写：一次采集折全表，返回每条路由的候选模型数（列表页要的是数字，不是明细）。
  poolSizes: (): Promise<RoutePoolSizesResult> =>
    ipcRenderer.invoke(IpcChannels.ROUTES_POOL_SIZES),
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
    ipcRenderer.invoke(IpcChannels.SESSION_GET_CONFIG),
  
  updateConfig: (config: Partial<SessionConfig>): Promise<void> => 
    ipcRenderer.invoke(IpcChannels.SESSION_UPDATE_CONFIG, config),
  
  getAll: (): Promise<SessionRecord[]> => 
    ipcRenderer.invoke(IpcChannels.SESSION_GET_ALL),
  
  getActive: (): Promise<SessionRecord[]> => 
    ipcRenderer.invoke(IpcChannels.SESSION_GET_ACTIVE),
  
  getById: (id: string): Promise<SessionRecord | undefined> => 
    ipcRenderer.invoke(IpcChannels.SESSION_GET_BY_ID, id),
  
  getByAccount: (accountId: string): Promise<SessionRecord[]> => 
    ipcRenderer.invoke(IpcChannels.SESSION_GET_BY_ACCOUNT, accountId),
  
  getByProvider: (providerId: string): Promise<SessionRecord[]> => 
    ipcRenderer.invoke(IpcChannels.SESSION_GET_BY_PROVIDER, providerId),
  
  delete: (id: string): Promise<boolean> => 
    ipcRenderer.invoke(IpcChannels.SESSION_DELETE, id),
  
  clearAll: (): Promise<void> => 
    ipcRenderer.invoke(IpcChannels.SESSION_CLEAR_ALL),
  
  cleanExpired: (): Promise<number> => 
    ipcRenderer.invoke(IpcChannels.SESSION_CLEAN_EXPIRED),
}

interface ManagementApiConfig {
  enableManagementApi: boolean
  managementApiSecret: string
  managementApiPort?: number
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
}

const managementApiAPI = {
  getConfig: (): Promise<ManagementApiConfig> => 
    ipcRenderer.invoke(IpcChannels.MANAGEMENT_API_GET_CONFIG),
  
  updateConfig: (updates: Partial<ManagementApiConfig>): Promise<ManagementApiConfig> => 
    ipcRenderer.invoke(IpcChannels.MANAGEMENT_API_UPDATE_CONFIG, updates),
  
  generateSecret: (): Promise<string> => 
    ipcRenderer.invoke(IpcChannels.MANAGEMENT_API_GENERATE_SECRET),
}

const contextManagementAPI = {
  getConfig: (): Promise<ContextManagementConfig> => 
    ipcRenderer.invoke(IpcChannels.CONTEXT_MANAGEMENT_GET_CONFIG),
  
  updateConfig: (updates: Partial<ContextManagementConfig>): Promise<ContextManagementConfig> => 
    ipcRenderer.invoke(IpcChannels.CONTEXT_MANAGEMENT_UPDATE_CONFIG, updates),
}

const trayAPI = {
  openDashboard: (): void => 
    ipcRenderer.send('tray:open-dashboard'),
  
  setHeight: (height: number): void => 
    ipcRenderer.send('tray:set-height', height),

  quitApp: (): void =>
    ipcRenderer.send('tray:quit-app'),
}

const modelRefreshAPI = {
  getStatus: (): Promise<{ config: unknown; tasks: unknown[] }> =>
    ipcRenderer.invoke(IpcChannels.MODEL_REFRESH_GET_STATUS),

  triggerNow: (): Promise<{ ok: boolean; reason?: string; tasks: unknown[] }> =>
    ipcRenderer.invoke(IpcChannels.MODEL_REFRESH_TRIGGER_NOW),
}

const aggregateAPI = {
  list: (): Promise<AggregateListResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_LIST),

  save: (input: AggregateSaveInput): Promise<{
    success: boolean
    provider?: Provider
    reason?: string
  }> => ipcRenderer.invoke(IpcChannels.AGGREGATE_SAVE, input),

  setEnabled: (id: string, enabled: boolean): Promise<{
    success: boolean
    provider?: Provider
    reason?: string
  }> => ipcRenderer.invoke(IpcChannels.AGGREGATE_SET_ENABLED, id, enabled),

  remove: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_REMOVE, id),

  test: (id: string): Promise<AggregateOperationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_TEST, id),

  // 在线同步模型清单：多把 Key 轮换探测，把上游新模型并入条目清单。
  syncModels: (id: string): Promise<AggregateOperationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_SYNC_MODELS, id),

  detail: (id: string): Promise<AggregateDetail | null> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_DETAIL, id),

  addKey: (id: string, apiKey: string): Promise<AggregateMutationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_ADD_KEY, id, apiKey),

  removeKey: (accountId: string): Promise<AggregateMutationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_REMOVE_KEY, accountId),

  setKeyEnabled: (accountId: string, enabled: boolean): Promise<AggregateMutationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_SET_KEY_ENABLED, accountId, enabled),

  validateKey: (id: string, accountId: string): Promise<AggregateMutationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_VALIDATE_KEY, id, accountId),

  addModel: (id: string, modelId: string): Promise<AggregateMutationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_ADD_MODEL, id, modelId),

  removeModel: (id: string, modelId: string): Promise<AggregateMutationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_REMOVE_MODEL, id, modelId),

  setModelEnabled: (id: string, modelId: string, enabled: boolean): Promise<AggregateMutationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_SET_MODEL_ENABLED, id, modelId, enabled),

  setModelParams: (id: string, modelId: string, params: Record<string, unknown>): Promise<AggregateMutationResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_SET_MODEL_PARAMS, id, modelId, params),

  testModel: (id: string, modelId: string): Promise<AggregateModelTestResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_TEST_MODEL, id, modelId),

  // 账号级实时额度：点一次问一次。没有轮询通道，也没有开页自动发。
  queryCredits: (id: string): Promise<AggregateCreditQueryResult> =>
    ipcRenderer.invoke(IpcChannels.AGGREGATE_QUERY_CREDITS, id),
}

const channelsAPI = {
  list: (): Promise<{ success: boolean; reason?: string; channels: ChannelView[] }> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_LIST),

  // 每家渠道账号池的计数（不含账号列表，也不读模型目录）：供应商卡片上的
  // 「已启用 / 全部」用这一份，而不是本地账号表里那一条占位账号。
  accountCounts: (): Promise<Record<string, { total: number; enabled: number }>> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_ACCOUNT_COUNTS),

  rpc: (method: string, payload?: unknown): Promise<ChannelRpcResult> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_RPC, method, payload),

  credits: (id: string): Promise<ChannelCredits> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_CREDITS, id),

  setEnabled: (id: string, enabled: boolean): Promise<ChannelOperationResult> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_SET_ENABLED, id, enabled),

  remove: (id: string): Promise<ChannelOperationResult> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_REMOVE, id),

  // 省略参数 = 读；给出布尔 = 改写「每日自动领取签到积分」开关。
  autoCheckin: (enabled?: boolean): Promise<ChannelAutoCheckinResult> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_AUTO_CHECKIN, enabled),

  // 在线模型目录（含积分权重与免费标记），以及强制重拉这一个渠道。
  models: (id: string): Promise<ChannelModelsResult> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_MODELS, id),

  refreshModels: (id: string): Promise<ChannelRefreshResult> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_REFRESH_MODELS, id),

  // 模型开关与失效恢复：返回结果里带最新目录，界面不必再单独拉一次。
  setModelDisabled: (id: string, modelId: string, disabled: boolean): Promise<ChannelModelUpdateResult> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_SET_MODEL_DISABLED, id, modelId, disabled),

  clearDeadModels: (id: string, modelId?: string): Promise<ChannelModelUpdateResult> =>
    ipcRenderer.invoke(IpcChannels.CHANNELS_CLEAR_DEAD_MODELS, id, modelId),

  onChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IpcChannels.CHANNELS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IpcChannels.CHANNELS_CHANGED, handler)
  },
}

const electronAPI = {
  proxy: proxyAPI,
  tls: tlsAPI,
  store: storeAPI,
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

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
