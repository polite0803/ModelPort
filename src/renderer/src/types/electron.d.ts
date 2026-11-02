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
  LoadBalanceStrategy,
  ModelMapping,
  AppConfig,
  AutoRoutingConfig,
  AutoPreference,
  ModelRoute,
  AccountStatus,
  ProviderType,
  ProviderVendor,
  ProviderStatus,
  ApiKey,
  ToolCallingConfig,
  LegacyToolPromptConfig,
  CompressionConfig,
  CompressionAggressiveness,
  OutputSteeringConfig,
  AnthropicInboundConfig,
  EffectiveModel,
  CatalogueModel,
  RequestLogEntry,
  RequestDiagnosticBundle,
  RequestAttemptTrace,
  RequestStreamTrace,
  AppLogTrendPoint,
  ModelsFetchFailure,
  ModelCapabilityHint,
  RoutePreviewResult,
  RoutePreviewSample,
  TlsStatus,
  TlsTrustResult,
} from '../../../shared/types'
import type {
  AggregateDetail,
  AggregateListResult,
  AggregateModelTestResult,
  AggregateMutationResult,
  AggregateOperationResult,
  AggregateSaveInput,
} from '../../../shared/aggregate'
import type {
  ChannelAutoCheckinResult,
  ChannelCredits,
  ChannelModelsResult,
  ChannelModelUpdateResult,
  ChannelOperationResult,
  ChannelRefreshResult,
  ChannelRpcResult,
  ChannelView,
} from '../../../shared/channels'
import type {
  RouteListResult,
  RouteMutationResult,
  RouteRemovalResult,
  RoutePoolSizesResult,
} from '../../../shared/modelRouteName'
import type {
  AnthropicDiscoveryResult,
  AnthropicRouteApplyResult,
} from '../../../shared/anthropicDiscovery'
export type {
  AnthropicDiscoveryPlan,
  AnthropicDiscoveryRoute,
  AnthropicDiscoverySkipReason,
} from '../../../shared/anthropicDiscovery'
import type { DayTokenBucket, DayTokenSummary } from '../../../shared/tokenAccounting'

export type { 
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
  LoadBalanceStrategy,
  ModelMapping,
  AppConfig,
  AutoRoutingConfig,
  AutoPreference,
  ModelRoute,
  AccountStatus,
  ProviderType,
  ProviderVendor,
  ProviderStatus,
  ApiKey,
  ToolCallingConfig,
  LegacyToolPromptConfig,
  CompressionConfig,
  CompressionAggressiveness,
  OutputSteeringConfig,
  AnthropicInboundConfig,
  EffectiveModel,
  CatalogueModel,
  RequestLogEntry,
  ModelsFetchFailure,
  RouteListResult,
  RouteMutationResult,
  RouteRemovalResult,
}

export interface CustomProviderFormData {
  name: string
  authType: AuthType
  apiEndpoint: string
  headers: Record<string, string>
  description: string
  supportedModels: string[]
  credentialFields: CredentialField[]
}

export interface BuiltinProviderConfig extends Provider {
  credentialFields: CredentialField[]
  tokenCheckEndpoint?: string
  tokenCheckMethod?: 'GET' | 'POST'
}

interface ProxyAPI {
  start: (port?: number) => Promise<boolean>
  stop: () => Promise<boolean>
  getStatus: () => Promise<ProxyStatus>
  getStatistics: () => Promise<ProxyStatistics>
  onStatusChanged: (callback: (status: ProxyStatus) => void) => () => void
}

interface TlsAPI {
  getStatus: () => Promise<TlsStatus>
  installTrust: () => Promise<TlsTrustResult>
  uninstallTrust: () => Promise<TlsTrustResult>
}

interface StoreAPI {
  get: <T>(key: string) => Promise<T | undefined>
  clearAll: () => Promise<void>
  onInitError: (callback: (error: { message: string | null }) => void) => () => void
  retryInit: () => Promise<{ success: boolean; error?: string }>
}

interface ProvidersAPI {
  getAll: () => Promise<Provider[]>
  getBuiltin: () => Promise<BuiltinProviderConfig[]>
  add: (data: {
    id?: string
    name: string
    type?: 'builtin' | 'custom'
    authType: AuthType
    apiEndpoint: string
    headers?: Record<string, string>
    description?: string
    supportedModels?: string[]
    credentialFields?: CredentialField[]
  }) => Promise<Provider>
  update: (id: string, updates: Partial<Provider>) => Promise<Provider | null>
  delete: (id: string) => Promise<boolean>
  checkStatus: (providerId: string) => Promise<ProviderCheckResult>
  checkAllStatus: () => Promise<Record<string, ProviderCheckResult>>
  duplicate: (id: string) => Promise<Provider>
  export: (id: string) => Promise<string>
  import: (jsonData: string) => Promise<Provider>
  updateModels: (providerId: string) => Promise<{
    success: boolean
    reason?: ModelsFetchFailure
    detail?: string
    fetchedCount?: number
    addedCount?: number
    fetchedAt?: number
  }>
  getEffectiveModels: (providerId: string) => Promise<EffectiveModel[]>
  getModelCatalogue: (providerId: string) => Promise<CatalogueModel[]>
  setModelsServed: (providerId: string, names: string[], served: boolean) => Promise<{
    success: boolean
    catalogue: CatalogueModel[]
    error?: string
  }>
  addCustomModel: (providerId: string, model: { displayName: string; actualModelId: string }) => Promise<{
    success: boolean
    models: EffectiveModel[]
    error?: string
  }>
  removeModel: (providerId: string, modelName: string) => Promise<{
    success: boolean
    models: EffectiveModel[]
    error?: string
  }>
  resetModels: (providerId: string) => Promise<{
    success: boolean
    models: EffectiveModel[]
    error?: string
  }>
  /** 全部手动标注，`providerId -> displayName -> hint`。 */
  getModelMarks: () => Promise<Record<string, Record<string, ModelCapabilityHint>>>
  /** `mark: null` 清除该模型的手动标注（回到自动解析结果）。 */
  setModelMark: (providerId: string, displayName: string, mark: ModelCapabilityHint | null) => Promise<{
    success: boolean
    marks: Record<string, Record<string, ModelCapabilityHint>>
    error?: string
  }>
}

interface AccountsAPI {
  getAll: () => Promise<Account[]>
  add: (data: {
    providerId: string
    name: string
    email?: string
    credentials: Record<string, string>
    dailyLimit?: number
  }) => Promise<Account>
  update: (id: string, updates: Partial<Account>) => Promise<Account | null>
  delete: (id: string) => Promise<boolean>
  validate: (accountId: string) => Promise<boolean>
  validateToken: (providerId: string, credentials: Record<string, string>) => Promise<{
    valid: boolean
    error?: string
    userInfo?: {
      name?: string
      email?: string
      quota?: number
      used?: number
    }
  }>
  getById: (id: string, includeCredentials?: boolean) => Promise<Account | null>
  getByProvider: (providerId: string) => Promise<Account[]>
}

interface AggregateAPI {
  list: () => Promise<AggregateListResult>
  save: (input: AggregateSaveInput) => Promise<{
    success: boolean
    provider?: Provider
    reason?: string
  }>
  setEnabled: (id: string, enabled: boolean) => Promise<{
    success: boolean
    provider?: Provider
    reason?: string
  }>
  remove: (id: string) => Promise<{ success: boolean }>
  test: (id: string) => Promise<AggregateOperationResult>
  syncModels: (id: string) => Promise<AggregateOperationResult>
  detail: (id: string) => Promise<AggregateDetail | null>
  addKey: (id: string, apiKey: string) => Promise<AggregateMutationResult>
  removeKey: (accountId: string) => Promise<AggregateMutationResult>
  setKeyEnabled: (accountId: string, enabled: boolean) => Promise<AggregateMutationResult>
  validateKey: (id: string, accountId: string) => Promise<AggregateMutationResult>
  addModel: (id: string, modelId: string) => Promise<AggregateMutationResult>
  removeModel: (id: string, modelId: string) => Promise<AggregateMutationResult>
  setModelEnabled: (id: string, modelId: string, enabled: boolean) => Promise<AggregateMutationResult>
  setModelParams: (id: string, modelId: string, params: Record<string, unknown>) => Promise<AggregateMutationResult>
  testModel: (id: string, modelId: string) => Promise<AggregateModelTestResult>
}

interface OAuthAPI {
  startLogin: (providerId: string, providerType: ProviderVendor) => Promise<OAuthResult>
  cancelLogin: () => Promise<void>
  loginWithToken: (providerId: string, providerType: ProviderVendor, token: string) => Promise<OAuthResult>
  validateToken: (providerId: string, providerType: ProviderVendor, credentials: Record<string, string>) => Promise<{
    valid: boolean
    tokenType?: string
    expiresAt?: number
    accountInfo?: {
      userId?: string
      email?: string
      name?: string
    }
    error?: string
  }>
  refreshToken: (providerId: string, providerType: ProviderVendor, credentials: Record<string, string>) => Promise<{
    type: string
    value: string
    expiresAt?: number
    refreshToken?: string
  } | null>
  getStatus: () => Promise<string>
  onCallback: (callback: (result: OAuthResult) => void) => () => void
  onProgress: (callback: (event: {
    status: 'idle' | 'pending' | 'success' | 'error' | 'cancelled'
    message: string
    progress?: number
    data?: Record<string, unknown>
  }) => void) => () => void
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

interface LogsAPI {
  get: (filter?: LogFilter) => Promise<LogEntry[]>
  getStats: () => Promise<LogStats>
  getTrend: (days?: number) => Promise<AppLogTrendPoint[]>
  getAccountTrend: (accountId: string, days?: number) => Promise<AppLogTrendPoint[]>
  clear: () => Promise<void>
  export: (format?: 'json' | 'txt') => Promise<string>
  getById: (id: string) => Promise<LogEntry | undefined>
}

interface UpdateProgressInfo {
  percent: number
  bytesPerSecond: number
  total: number
  transferred: number
}

interface UpdateDownloadedInfo {
  version: string
  releaseDate: string
  releaseNotes?: string
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

interface AppAPI {
  getVersion: () => Promise<string>
  checkUpdate: () => Promise<UpdateStatus>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  getUpdateStatus: () => Promise<UpdateStatus>
  onUpdateChecking: (callback: () => void) => () => void
  onUpdateAvailable: (callback: (info: UpdateDownloadedInfo) => void) => () => void
  onUpdateNotAvailable: (callback: (info: UpdateDownloadedInfo) => void) => () => void
  onUpdateProgress: (callback: (progress: UpdateProgressInfo) => void) => () => void
  onUpdateDownloaded: (callback: (info: UpdateDownloadedInfo) => void) => () => void
  onUpdateError: (callback: (error: { message?: string } | string) => void) => () => void
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  showWindow: () => Promise<void>
  hideWindow: () => Promise<void>
  setTitleBarTheme: (theme: 'dark' | 'light') => Promise<void>
  platform: string
  openExternal: (url: string) => Promise<void>
}

interface ConfigAPI {
  get: () => Promise<AppConfig>
  update: (updates: Partial<AppConfig>) => Promise<boolean>
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
}

/**
 * 多路由 CRUD（`AppConfig.routes`）。与主进程 `routes:list|create|update|delete`
 * 一一对应；返回形状与 `ChannelsAPI` 同风格 —— 错误以可读文本到达界面，
 * 永不 reject 成协议异常。
 *
 * 三个写方法成功时都带回**归一后的整表**（`routes`），所以写完不必再 `list()`；
 * 主进程随后广播 `CONFIG_CHANGED`（载荷是带 `routes` 的完整 `AppConfig`），
 * 订阅了 `config.onConfigChanged` 的页面会自动拿到同一份新表。
 *
 * 名字规则（`[a-z0-9_-]{1,64}`、大小写不敏感唯一、不与在服模型/别名冲突）与
 * 池策略 id 都在主进程校验；UI 只做提示，不要把校验逻辑复制一份。
 * `error.code` 是 i18n 取文案的键（`invalid_name` / `duplicate_name` /
 * `conflicts_model` / `conflicts_alias` / `unknown_pool_strategy` / `not_found` /
 * `invalid_input` / `storage_unavailable`），`message` 只是英文兜底。
 */
interface RoutesAPI {
  /** 全部路由（含停用的），按名字排序。 */
  list: () => Promise<RouteListResult>
  create: (input: Partial<ModelRoute> & { name: string }) => Promise<RouteMutationResult>
  /** `currentName` 是盘上的现名；`patch.name` 才是改名。 */
  update: (currentName: string, patch: Partial<ModelRoute>) => Promise<RouteMutationResult>
  /** 命名跟随 `providers.delete` / `accounts.delete`（通道是 `routes:delete`）。 */
  delete: (name: string) => Promise<RouteRemovalResult>
  /**
   * 只算不写：按当前配置预览这条路由的候选池，逐模型给出最终状态
   * （`kept` / `included` / `excluded` / `filtered` / `unavailable`）与能力来源。
   * `sample` 是请求画像样本，缺省为纯文本、无工具、短请求。
   */
  preview: (route: ModelRoute, sample?: RoutePreviewSample) => Promise<RoutePreviewResult>
  /**
   * 每条路由当前的候选模型数（按供应商分组后数名字）。`sizes` 的键是路由名；
   * 缺席代表「没数」，界面要显示省略而不是 0 —— 取不到与池是空的不是同一件事。
   */
  poolSizes: () => Promise<RoutePoolSizesResult>
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

interface SessionAPI {
  getConfig: () => Promise<SessionConfig>
  updateConfig: (config: Partial<SessionConfig>) => Promise<void>
  getAll: () => Promise<SessionRecord[]>
  getActive: () => Promise<SessionRecord[]>
  getById: (id: string) => Promise<SessionRecord | undefined>
  getByAccount: (accountId: string) => Promise<SessionRecord[]>
  getByProvider: (providerId: string) => Promise<SessionRecord[]>
  delete: (id: string) => Promise<boolean>
  clearAll: () => Promise<void>
  cleanExpired: () => Promise<number>
}

interface RequestLogEntry {
  id: string
  timestamp: number
  status: 'success' | 'error'
  statusCode: number
  method: string
  url: string
  model: string
  actualModel?: string
  providerId?: string
  providerName?: string
  accountId?: string
  accountName?: string
  requestBody?: string
  userInput?: string
  /** Web search enabled */
  webSearch?: boolean
  /** Reasoning effort level */
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** Output cap the client asked for; absent when it sent neither max_tokens field */
  maxTokens?: number
  responseStatus: number
  responsePreview?: string
  /** Response body JSON string */
  responseBody?: string
  /** Finish reason the client actually received */
  finishReason?: string
  /** Streaming only: upstream ended without a finish reason */
  streamTruncated?: boolean
  latency: number
  isStream: boolean
  errorMessage?: string
  errorStack?: string
  requestId?: string
  errorType?: string
  errorCode?: string | number | null
  errorParam?: string | null
  upstreamStatus?: number
  upstreamRequestId?: string
  attempts?: RequestAttemptTrace[]
  streamTrace?: RequestStreamTrace
  captureBodies?: boolean
  /** Caller identified from User-Agent by the proxy; `other` keeps the raw product name */
  client?: { id: string; label: string; version?: string }
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

interface RequestLogsAPI {
  get: (filter?: RequestLogFilter) => Promise<RequestLogEntry[]>
  getById: (id: string) => Promise<RequestLogEntry | undefined>
  getStats: () => Promise<RequestLogStats>
  clear: () => Promise<void>
  bundle: (key: string) => Promise<RequestDiagnosticBundle>
  saveBundle: (key: string) => Promise<{ saved: boolean; path?: string }>
  /** Live push of one already-persisted row; subscribe for as long as the list is mounted. */
  onNewLog: (callback: (log: RequestLogEntry) => void) => () => void
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

/**
 * One local day of token counters — **re-exported from the single source of
 * truth**, not copied here. The two pools stay separate fields: `upstream*` is
 * what providers actually reported (bill-reconcilable), `estimated*` is the
 * `chars/4` fallback. A hand-written copy of this shape drifted within one
 * release (it fell behind `upstreamCacheRead`), which is the whole reason the
 * renderer reads the shared interface instead.
 */
export type { DayTokenSummary }

interface DailyStatistics {
  date: string
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalLatency: number
  modelUsage: Record<string, number>
  providerUsage: Record<string, number>
  /**
   * Per-provider successes and latency sums for the day. Absent when the bucket
   * was written by a build that recorded neither - not a zero, so a per-provider
   * rate must skip the day instead of charging its requests as failures.
   */
  providerSuccess?: Record<string, number>
  providerLatency?: Record<string, number>
}

interface StatisticsAPI {
  get: () => Promise<PersistentStatistics>
  getToday: () => Promise<DailyStatistics>
  /** Today's token counters, upstream-reported and estimated kept apart. */
  getTokenUsage: () => Promise<DayTokenSummary>
  /** The newest `days` local days of token counters, oldest first. */
  getTokenUsageHistory: (days?: number) => Promise<DayTokenSummary[]>
  /**
   * Every retained day of token counters keyed by local day, carrying the
   * per-provider split (`byProvider`) the statistics card sums over the period
   * the user picked.
   */
  getTokenUsageDays: () => Promise<Record<string, DayTokenBucket>>
}

interface TrayAPI {
  openDashboard: () => void
  setHeight: (height: number) => void
  quitApp: () => void
}

interface ManagementApiConfig {
  enableManagementApi: boolean
  managementApiSecret: string
  managementApiPort?: number
}

interface ManagementApiAPI {
  getConfig: () => Promise<ManagementApiConfig>
  updateConfig: (updates: Partial<ManagementApiConfig>) => Promise<boolean>
  generateSecret: () => Promise<string>
}

interface StrategyConfig {
  slidingWindow: {
    enabled: boolean
    maxMessages: number
  }
  tokenLimit: {
    enabled: boolean
    maxTokens: number
  }
  summary: {
    enabled: boolean
    keepRecentMessages: number
    summaryPrompt?: string
  }
}

interface ContextManagementConfig {
  enabled: boolean
  strategies: StrategyConfig
  executionOrder: ('slidingWindow' | 'tokenLimit' | 'summary')[]
}

interface ContextManagementAPI {
  getConfig: () => Promise<ContextManagementConfig>
  updateConfig: (updates: Partial<ContextManagementConfig>) => Promise<ContextManagementConfig>
}

export interface ToolCallingSmokeFixture {
  model: string
  stream: boolean
  messages: Array<{ role: string; content: string }>
  tools: Array<{
    type: string
    function: { name: string; description?: string; parameters?: Record<string, unknown> }
  }>
  tool_choice: unknown
}

interface ToolCallingAPI {
  runSmoke: (input: { clientAdapterId: string }) => Promise<{
    success: boolean
    data?: { result?: { message?: string }; fixture?: ToolCallingSmokeFixture }
    error?: { message?: string }
  }>
}

interface ChannelsAPI {
  list: () => Promise<{ success: boolean; reason?: string; channels: ChannelView[] }>
  accountCounts: () => Promise<Record<string, { total: number; enabled: number }>>
  rpc: (method: string, payload?: unknown) => Promise<ChannelRpcResult>
  credits: (id: string) => Promise<ChannelCredits>
  setEnabled: (id: string, enabled: boolean) => Promise<ChannelOperationResult>
  remove: (id: string) => Promise<ChannelOperationResult>
  autoCheckin: (enabled?: boolean) => Promise<ChannelAutoCheckinResult>
  models: (id: string) => Promise<ChannelModelsResult>
  refreshModels: (id: string) => Promise<ChannelRefreshResult>
  setModelDisabled: (id: string, modelId: string, disabled: boolean) => Promise<ChannelModelUpdateResult>
  clearDeadModels: (id: string, modelId?: string) => Promise<ChannelModelUpdateResult>
  onChanged: (callback: () => void) => () => void
}

/**
 * Anthropic 客户端可发现名：`plan` 只读预览，`apply` 写进 `config.modelMappings`。
 * 返回形状与主进程共用 `shared/anthropicDiscovery.ts` 那一份，UI 不另写判据。
 */
interface AnthropicDiscoveryAPI {
  plan: () => Promise<AnthropicDiscoveryResult>
  apply: () => Promise<AnthropicRouteApplyResult>
}

interface ElectronAPI {
  proxy: ProxyAPI
  tls: TlsAPI
  store: StoreAPI
  providers: ProvidersAPI
  aggregate: AggregateAPI
  channels: ChannelsAPI
  accounts: AccountsAPI
  oauth: OAuthAPI
  logs: LogsAPI
  requestLogs: RequestLogsAPI
  statistics: StatisticsAPI
  app: AppAPI
  config: ConfigAPI
  anthropicDiscovery: AnthropicDiscoveryAPI
  routes: RoutesAPI
  session: SessionAPI
  managementApi: ManagementApiAPI
  contextManagement: ContextManagementAPI
  toolCalling: ToolCallingAPI
  tray: TrayAPI
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
