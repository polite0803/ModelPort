/**
 * Credential Storage Module - Type Definitions
 * Defines core data structures for accounts, providers, and configuration
 */

import type {
  ProviderStatus,
  RequestLogEntry,
  EffectiveModel,
  CatalogueModel,
  ModelsFetchConfig,
  ModelsFetchReader,
  FetchedModel,
  ModelsFetchFailure,
  ModelsFetchResult,
  AutoRoutingConfig,
  ModelRoute,
  AggregateWire,
  ModelCapabilityHint,
  CompressionConfig,
  AnthropicInboundConfig,
  ModelListRefreshConfig,
  PromptCachingConfig,
} from '../../shared/types.ts'
import type { ChannelLoginKind } from '../../shared/channels.ts'
import {
  DEFAULT_AUTO_ROUTING_CONFIG,
  DEFAULT_COMPRESSION_CONFIG,
  DEFAULT_PROMPT_CACHING_CONFIG,
} from '../../shared/types.ts'
import { isRetiredProviderId } from '../providers/providerRetirement.ts'
import type { DayTokenBucket } from '../../shared/tokenAccounting.ts'
import type { CatalogAdoption } from '../../shared/modelCatalog.ts'
import type { AggregateCreditSnapshot, AggregateCreditSnapshots } from '../../shared/aggregateCredit.ts'
import type { RepetitionGuardSettings } from '../../shared/streamRepetition.ts'

/**
 * 实时额度快照的落盘键。类型只在 `shared/aggregateCredit.ts` 声明一次，这里同步
 * `StoreSchema` 需要的表形态（本仓 `LoadBalanceStrategy` 那类"两处声明"的先例，
 * 只在两边都得自己写一遍时才成立；这里走 re-export，避免出现第二个定义）。
 */
export type { AggregateCreditSnapshot, AggregateCreditSnapshots }

/** Request names the retired DeepSeek integration used; stored mappings using them are dropped. */
const DEEPSEEK_LEGACY_MODEL_MAPPING_NAMES = [
  'deepseek-chat',
  'deepseek-reasoner',
  'DeepSeek-V3.2',
  'DeepSeek-Search',
  'DeepSeek-R1',
  'DeepSeek-R1-Search',
  'deepseek-default',
  'deepseek-expert',
  'deepseek-vision',
  'deepseek-default-think',
  'deepseek-default-search',
  'deepseek-default-think-search',
  'deepseek-expert-think',
  'deepseek-expert-search',
  'deepseek-expert-think-search',
  'deepseek-vision-think',
  'deepseek-vision-search',
  'deepseek-vision-think-search',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-think',
  'deepseek-v4-flash-search',
  'deepseek-v4-flash-think-search',
  'deepseek-v4-pro-think',
  'deepseek-v4-pro-search',
  'deepseek-v4-pro-think-search',
]

/**
 * Account Status Enum
 */
export type AccountStatus = 'active' | 'inactive' | 'expired' | 'error'

/**
 * Provider Type Enum
 */
export type ProviderType = 'builtin' | 'custom' | 'aggregate' | 'account'

/**
 * Authentication Type Enum
 * - oauth: OAuth authentication
 * - token: Simple Token authentication
 * - cookie: Cookie authentication
 * - userToken: User Token authentication (DeepSeek)
 * - refresh_token: Refresh token authentication (GLM)
 * - jwt: JWT/Refresh token authentication (Kimi)
 * - realUserID_token: realUserID+JWT authentication (MiniMax)
 * - tongyi_sso_ticket: Tongyi SSO ticket authentication (Qwen)
 */
export type AuthType = 
  | 'oauth' 
  | 'token' 
  | 'cookie' 
  | 'userToken' 
  | 'refresh_token' 
  | 'jwt' 
  | 'realUserID_token' 
  | 'tongyi_sso_ticket'

/**
 * Credential Field Configuration Interface
 * Defines credential fields required by provider
 */
export interface CredentialField {
  /** Field name */
  name: string
  /** Field label (display name) */
  label: string
  /** Field type */
  type: 'text' | 'password' | 'textarea'
  /** Whether required */
  required: boolean
  /** Placeholder text */
  placeholder?: string
  /** Help text */
  helpText?: string
}

/**
 * Built-in Provider Configuration Interface
 * Extends Provider interface, adds credential field configuration
 */
export interface BuiltinProviderConfig extends Omit<Provider, 'createdAt' | 'updatedAt'> {
  /** Credential field configuration */
  credentialFields: CredentialField[]
  /** Token check endpoint */
  tokenCheckEndpoint?: string
  /** Token check method */
  tokenCheckMethod?: 'GET' | 'POST'
  /**
   * Online model list source. Absent means the provider has no online update entry,
   * and the UI must not offer it.
   */
  modelsFetch?: ModelsFetchConfig
}

export type { ModelsFetchReader, ModelsFetchConfig, FetchedModel, ModelsFetchFailure, ModelsFetchResult }

/**
 * Load Balance Strategy Enum
 *
 * `smart` / `pace` 由 `shared/quotaPacing.ts` 的重置推算驱动；推算不出重置时刻时
 * 它们不改可用性，只退回既有顺序。
 */
export type LoadBalanceStrategy = 'round-robin' | 'fill-first' | 'failover' | 'smart' | 'pace'

/**
 * Theme Enum
 */
export type Theme = 'light' | 'dark' | 'system'

/**
 * Account Interface
 * Represents account configuration under a provider
 */
export interface Account {
  /** Account unique identifier */
  id: string
  /** Provider ID */
  providerId: string
  /** Account name */
  name: string
  /** Account email (optional) */
  email?: string
  /** Credential data (encrypted storage) */
  credentials: Record<string, string>
  /** Account status */
  status: AccountStatus
  /** Last used time (timestamp) */
  lastUsed?: number
  /** Last credential/status check time (timestamp) */
  lastStatusCheck?: number
  /** Created time (timestamp) */
  createdAt: number
  /** Updated time (timestamp) */
  updatedAt: number
  /** Error message (when status is error) */
  errorMessage?: string
  /** Request count */
  requestCount?: number
  /** Daily request limit */
  dailyLimit?: number
  /** Today used count */
  todayUsed?: number
}

/**
 * Provider Interface
 * Represents an API provider configuration
 */
export interface Provider {
  /** Provider unique identifier */
  id: string
  /** Provider name */
  name: string
  /** Provider type */
  type: ProviderType
  /** Authentication type */
  authType: AuthType
  /** API endpoint address */
  apiEndpoint: string
  /** Chat API path */
  chatPath?: string
  /** Default request headers */
  headers: Record<string, string>
  /** Whether enabled */
  enabled: boolean
  /** Created time (timestamp) */
  createdAt: number
  /** Updated time (timestamp) */
  updatedAt: number
  /** Provider description */
  description?: string
  /** Icon URL */
  icon?: string
  /** Supported model list */
  supportedModels?: string[]
  /** Model name mapping */
  modelMappings?: Record<string, string>
  /** Credential fields the account form renders */
  credentialFields?: CredentialField[]
  /** Catalogue entry this record came from, for `type: 'aggregate'` records */
  aggregateId?: string
  /** Wire protocol of an aggregate endpoint; builtin/custom leave it unset */
  wire?: AggregateWire
  /** Header that carries the API key; defaults to Authorization */
  authHeader?: string
  /** Prefix placed before the key inside authHeader; defaults to "Bearer " */
  authPrefix?: string
  /** Set at startup from the shipped provider config: this provider has an online model list source */
  supportsModelFetch?: boolean
  /**
   * Per-model request parameter overrides keyed by upstream model id (for
   * aggregate entries, the id after `<entryId>/`). Values are merged into the
   * upstream request and win over the client's same-named fields.
   */
  modelParameters?: Record<string, Record<string, unknown>>
  /**
   * Per-model routing annotations keyed by display name, for `auto`.
   * Written by the builtin sync and by the account-channel sync; an unlisted
   * model is unknown, not defaulted.
   */
  modelCapabilities?: Record<string, ModelCapabilityHint>
  /**
   * How the user proves ownership of this provider's accounts, for
   * `type: 'account'` records only. See `shared/types.ts` for why `authType`
   * cannot carry it (the enum has no browser/device-code member, so a channel
   * record said `token` and the card rendered "API Key").
   */
  loginKind?: ChannelLoginKind
  /** Provider status */
  status?: ProviderStatus
  /** Last status check time */
  lastStatusCheck?: number
}

/**
 * Model Mapping Configuration
 * Maps request model to actual used model
 */
export interface ModelMapping {
  /** Request model name */
  requestModel: string
  /** Actual used model name */
  actualModel: string
  /** Preferred provider ID */
  preferredProviderId?: string
  /** Preferred account ID */
  preferredAccountId?: string
  /**
   * true = 这条别名已停用：不再参与任何名字解析（具名请求、anthropic 入站、
   * 通配匹配都看不见它）。缺席即启用，所以老配置零迁移。
   * 停用位落在映射表自身而不是 `excludedModels`，因为别名行不属于任何目录。
   */
  disabled?: boolean
}

/**
 * Application Configuration Interface
 */
export interface AppConfig {
  /** Proxy service port */
  proxyPort: number
  /** Proxy service bind address */
  proxyHost: string
  /**
   * Extra TLS listener. HTTP keeps listening on `proxyPort`; this only adds
   * `httpsPort` for clients that refuse plain HTTP (Claude Desktop's gateway).
   */
  httpsEnabled: boolean
  /** TLS listener port; must differ from `proxyPort` while enabled. */
  httpsPort: number
  /** Custom PEM certificate; absent means the app-managed self-signed cert. */
  httpsCertPath?: string
  /** Custom PEM private key; must be set together with `httpsCertPath`. */
  httpsKeyPath?: string
  /**
   * Extra IPs/hostnames the managed certificate must carry. A remote client
   * connects by address, and TLS fails on a name mismatch no matter whether the
   * certificate is trusted - so the address actually used has to be in the SAN.
   */
  httpsSanHosts: string[]
  /** Load balance strategy */
  loadBalanceStrategy: LoadBalanceStrategy
  /**
   * 流内重复退化判据（Bandit 的第二类 degraded 信号）。与
   * `shared/types.ts::AppConfig` 同一字段，缺省即出厂阈值。
   */
  streamRepetitionGuard?: RepetitionGuardSettings
  /** Model mapping configuration */
  modelMappings: Record<string, ModelMapping>
  /** 标准库（LiteLLM）的自定义镜像地址，仅 https；空/缺省表示不使用。 */
  catalogMirrorUrl?: string
  /** UI theme */
  theme: Theme
  /** Auto start on boot */
  autoStart: boolean
  /** Auto start proxy on launch */
  autoStartProxy: boolean
  /** Minimize to tray */
  minimizeToTray: boolean
  /** UI language */
  language: 'zh-CN' | 'en-US'
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  /** Log retention days */
  logRetentionDays: number
  /** Request log persistence configuration */
  requestLogConfig: RequestLogConfig
  /** Request timeout (milliseconds) */
  requestTimeout: number
  /** Retry count */
  retryCount: number
  /**
   * Output cap the anthropic wire sends when neither the client (under either
   * spelling) nor a per-model parameter supplied one. Absent means
   * `DEFAULT_MAX_OUTPUT_TOKENS`; declared twice with `shared/types.ts` (no wiring
   * between them), so both copies must carry it.
   */
  defaultMaxOutputTokens?: number
  /** API Key list */
  apiKeys: ApiKey[]
  /** Whether to enable API Key authentication */
  enableApiKey: boolean
  /** OAuth proxy mode: 'system' uses system proxy, 'none' disables proxy */
  oauthProxyMode: 'system' | 'none'
  /** Management API configuration */
  managementApi: ManagementApiConfig
  /** Context management configuration */
  contextManagement: ContextManagementConfig
  /**
   * Legacy single-`auto` routing configuration. Retired from the UI but kept as
   * the migration source and as the fallback for callers that have no route in
   * hand (`autoRouter.select()` without a route, and the aggregate bare-name chain
   * never reads it - see `forwarder.ts`).
   */
  autoRouting: AutoRoutingConfig
  /**
   * Named routes, keyed by canonical name.
   *
   * Optional **in the type because `DEFAULT_CONFIG` deliberately omits the key**:
   * `normalizeConfig()` judges "legacy data" by `hasOwnProperty('routes')` on the
   * *raw stored object*, and a `DEFAULT_CONFIG` that carried `routes: {}` would
   * make that gate read "already migrated" for every fresh install and every
   * `|| DEFAULT_CONFIG` fallback (there are four). A read always returns the field
   * filled - see `normalizeConfig()` in `store.ts` for the migration itself.
   */
  routes?: Record<string, ModelRoute>
  /**
   * 已被「协议路由」播种处理过的名字记档（一次性判据，见
   * `shared/types.ts::AppConfig.seededPresetRoutes`）。`DEFAULT_CONFIG` 不预置这个键。
   */
  seededPresetRoutes?: string[]
  /** Live-zone context compression (shipped default: on — see DEFAULT_COMPRESSION_CONFIG) */
  compression: CompressionConfig
  /**
   * Prompt-cache behaviour: Anthropic breakpoint injection and its TTL tier.
   * Implicit-prefix providers read their capability table instead.
   */
  promptCaching: PromptCachingConfig
  /**
   * `/v1/messages` 入向的模型解析与清单申报规则。缺席即默认行为
   * （请求名能解析就原样用，否则落 `auto`）。
   *
   * 与 `src/shared/types.ts` 同一份声明、两处都要写 —— 少这一处，主进程侧
   * `storeManager.updateConfig({ anthropicInbound })` 直接编译不过（UI 写路径就是它）。
   */
  anthropicInbound?: AnthropicInboundConfig
  /**
   * 供应商模型清单定时刷新。缺席即默认行为（见 `DEFAULT_MODEL_REFRESH`）。
   *
   * 与 `src/shared/types.ts` 同一份声明、两处都要写 —— 少这一处，主进程侧
   * `storeManager.updateConfig({ modelListRefresh })` 直接编译不过（UI 写路径就是它）。
   */
  modelListRefresh?: ModelListRefreshConfig
  /**
   * 按渠道的「走系统代理」开关（`shared/types.ts` 同一字段，两处都要写）。
   *
   * 开 = 沿用应用已探到的系统代理链；关 = 该渠道直连。缺省条目按「开」读 ——
   * 升级前所有渠道都走自动出口，缺省读成「关」等于静默改掉出网路径。
   */
  channelSystemProxy?: Record<string, boolean>
  /**
   * 免验证（keyless）聚合条目的自动开通黑名单：用户显式删除过的条目 id 记在这里，
   * 启动期自动开通不再复活它们。
   */
  dismissedAutoProviders?: string[]
}

/**
 * Log Level Enum
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Sliding Window Configuration Interface
 * Controls message count-based context trimming
 */
export interface SlidingWindowConfig {
  /** Whether sliding window strategy is enabled */
  enabled: boolean
  /** Maximum number of messages to keep */
  maxMessages: number
}

/**
 * Token Limit Configuration Interface
 * Controls token count-based context trimming
 */
export interface TokenLimitConfig {
  /** Whether token limit strategy is enabled */
  enabled: boolean
  /** Maximum number of tokens to keep */
  maxTokens: number
}

/**
 * Context Management Configuration Interface
 * Controls how conversation context is managed and trimmed
 *
 * `summary` was retired on 2026-11-03 together with the gateway-authored-text ruling; trimming is
 * deletion-only. The runtime authority for the shape is `proxy/services/contextManagementService.ts`.
 */
export interface ContextManagementConfig {
  /** Whether context management is enabled */
  enabled: boolean
  /** Strategy configurations */
  strategies: {
    slidingWindow: SlidingWindowConfig
    tokenLimit: TokenLimitConfig
  }
  /** Execution order of strategies */
  executionOrder: ('slidingWindow' | 'tokenLimit')[]
  /**
   * Providers whose traffic may be trimmed. Absent or empty = trim nothing.
   *
   * A head cut rewrites the oldest context bytes, which invalidates the upstream
   * prefix cache for every later turn — cheap for a channel that does not cache
   * (trae), expensive for one that does (measured 60–98% hits on
   * bailian/loomy/raccoon before the 2026-11-10 regression, PLAN-prompt-cache
   * §9.12). Naming the channel is the honest gate: a capability table cannot
   * see account channels, only aggregate entries.
   */
  channelIds?: string[]
}

/**
 * Chat Message Interface
 * Represents a single message in a conversation
 */
export interface ChatMessage {
  /** Message role */
  role: 'user' | 'assistant' | 'system' | 'tool'
  /** Message content */
  content: string | any[]
  /** Timestamp */
  timestamp: number
  /** Provider-specific message ID */
  providerMessageId?: string
  /** Tool call ID (for tool messages) */
  toolCallId?: string
}

/**
 * Management API Configuration Interface
 * Controls the management API server settings
 */
export interface ManagementApiConfig {
  /** Whether to enable the management API */
  enableManagementApi: boolean
  /** Secret key for management API authentication */
  managementApiSecret: string
}

/**
 * API Key Interface
 */
export interface ApiKey {
  /** API Key ID */
  id: string
  /** API Key name */
  name: string
  /** API Key value */
  key: string
  /** Whether enabled */
  enabled: boolean
  /** Created time */
  createdAt: number
  /** Last used time */
  lastUsedAt?: number
  /** Usage count */
  usageCount: number
  /** Description */
  description?: string
}

/**
 * Log Entry Interface
 */
export interface LogEntry {
  /** Log ID */
  id: string
  /** Timestamp */
  timestamp: number
  /** Log level */
  level: LogLevel
  /** Log message */
  message: string
  /** Related account ID */
  accountId?: string
  /** Related provider ID */
  providerId?: string
  /** Request ID */
  requestId?: string
  /** Extra data */
  data?: Record<string, unknown>
}

/**
 * Request Log Entry Interface
 * Defined once in shared/types so main, preload and renderer read the same shape
 */
export type { RequestLogEntry }

export interface RequestLogConfig {
  /** Whether detailed request logs are persisted */
  enabled: boolean
  /** Maximum persisted request log entries */
  maxEntries: number
  /** Whether request and response bodies are stored */
  includeBodies: boolean
  /** Maximum characters persisted for each body field */
  maxBodyChars: number
  /** Whether obvious sensitive values are redacted */
  redactSensitiveData: boolean
}

/**
 * Daily Statistics Interface
 * Statistics for a single day
 */
export interface DailyStatistics {
  /** Date string (YYYY-MM-DD) */
  date: string
  /** Total requests */
  totalRequests: number
  /** Successful requests */
  successRequests: number
  /** Failed requests */
  failedRequests: number
  /** Total latency (for average calculation) */
  totalLatency: number
  /** Model usage count */
  modelUsage: Record<string, number>
  /** Provider usage count */
  providerUsage: Record<string, number>
  /**
   * Successful requests per provider, written alongside `providerUsage`. Absent
   * on buckets from a build that counted requests only - which is "not
   * recorded", never 0, so a per-provider success rate must skip the day rather
   * than charge it as failures.
   */
  providerSuccess?: Record<string, number>
  /** Summed latency of this day's successful requests per provider. Same absence rule. */
  providerLatency?: Record<string, number>
}

/**
 * Persistent Statistics Interface
 * Statistics that persist across app restarts
 */
export interface PersistentStatistics {
  /** Total requests (all time) */
  totalRequests: number
  /** Successful requests (all time) */
  successRequests: number
  /** Failed requests (all time) */
  failedRequests: number
  /** Total latency for average calculation */
  totalLatency: number
  /** Last updated timestamp */
  lastUpdated: number
  /** Model usage count */
  modelUsage: Record<string, number>
  /** Provider usage count */
  providerUsage: Record<string, number>
  /** Account usage count */
  accountUsage: Record<string, number>
  /** Daily statistics (keyed by date string) */
  dailyStats: Record<string, DailyStatistics>
}

/**
 * Credential Validation Result Interface
 */
export interface ValidationResult {
  /** Whether valid */
  valid: boolean
  /** Error message */
  error?: string
  /** Validation time */
  validatedAt: number
  /** Account info (returned when validation succeeds) */
  accountInfo?: {
    name?: string
    email?: string
    quota?: number
    used?: number
    expiresAt?: number
  }
}

/**
 * Custom Model Configuration
 * User-defined model with display name and actual API model ID
 */
export interface CustomModel {
  /** Model display name (used in AI client) */
  displayName: string
  /** Actual model ID (used in API call) */
  actualModelId: string
}

/**
 * User Model Overrides for a Provider
 * Stores user customizations to built-in provider models
 */
export interface ProviderModelOverrides {
  /** User added custom models */
  addedModels: CustomModel[]
  /** Excluded default model display names */
  excludedModels: string[]
  /**
   * Models last pulled from the provider's online list. Kept here rather than in
   * provider.supportedModels because the startup sync rewrites that field from code.
   */
  fetchedModels?: CustomModel[]
  /** Epoch ms of the last successful online sync */
  fetchedAt?: number
}

/**
 * User Model Overrides
 * Maps provider IDs to their model customizations
 */
export type UserModelOverrides = Record<string, ProviderModelOverrides>

/**
 * Manual capability marks: `providerId -> displayName -> hint`.
 *
 * Deliberately NOT part of {@link UserModelOverrides}: the model-list sync
 * (`resetModels`, online refresh, channel catalogue refresh) rewrites overrides,
 * while a manual correction to a wrong or missing capability mark must survive
 * that. Routing merges these on top of every automatic source.
 *
 * Absent means "no manual correction" — never "everything unknown" — so a mark
 * that only sets `vision` leaves tools/context on the automatic path.
 */
export type UserModelMarks = Record<string, Record<string, ModelCapabilityHint>>

export const DEFAULT_USER_MODEL_MARKS: UserModelMarks = {}

/** 标准模型库 adoption 出厂为空：未采用任何第三方字段。 */
export const DEFAULT_CATALOG_ADOPTIONS: CatalogAdoption[] = []

/**
 * Effective Model Information
 * Defined once in shared/types, shared with preload and the renderer
 */
export type { EffectiveModel, CatalogueModel }

/**
 * Storage Data Structure Interface
 */
export interface StoreSchema {
  /** Provider list */
  providers: Provider[]
  /** Account list */
  accounts: Account[]
  /** Application configuration */
  config: AppConfig
  /** Log entries */
  logs: LogEntry[]
  /** Request log entries */
  requestLogs: RequestLogEntry[]
  /** Persistent statistics */
  statistics: PersistentStatistics
  /**
   * Per-local-day token counters, keyed `YYYY-MM-DD`.
   *
   * Separate from `statistics` because it is bounded by DAYS rather than by a
   * single running total, and because it must keep the upstream-reported and
   * `chars/4`-estimated pools apart (see `shared/tokenAccounting.ts`).
   */
  tokenUsage: Record<string, DayTokenBucket>
  /** User model overrides for built-in providers */
  userModelOverrides: UserModelOverrides
  /** Manual capability corrections; merged on top of every automatic mark */
  userModelMarks: UserModelMarks
  /**
   * 标准模型库的逐字段采用记录。
   *
   * 与 `userModelMarks` 分开：人工标注是用户自己的判断（优先级最高），adoption
   * 是「从第三方台账抄了这一格」，来源固定为 `catalog`，撤销即回到自动解析。
   * 两者混存会让界面无法回答「这个值是用户写的还是抄来的」，也会让撤销误删人工值。
   */
  catalogAdoptions: CatalogAdoption[]
  /**
   * 账号级实时额度快照，一个聚合条目一行（`entryId -> 那一次问回来的余额`）。
   *
   * 与 `userModelMarks` 同理，它**不进** `aggregateQuota.ts`（那是脚本从取证回执生成的
   * 静态帽）也不进额度账本（那是本应用自己计量的 token）：单位是钱、来源是上游，
   * 混进任何一边都会把两个计数域折成一个数。
   */
  aggregateCreditSnapshots: AggregateCreditSnapshots
}

/**
 * Default Persistent Statistics
 */
export const DEFAULT_STATISTICS: PersistentStatistics = {
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  totalLatency: 0,
  lastUpdated: Date.now(),
  modelUsage: {},
  providerUsage: {},
  accountUsage: {},
  dailyStats: {},
}

/**
 * Default User Model Overrides
 */
export const DEFAULT_USER_MODEL_OVERRIDES: UserModelOverrides = {}

/**
 * Default Management API Configuration
 */
export const DEFAULT_MANAGEMENT_API_CONFIG: ManagementApiConfig = {
  enableManagementApi: false,
  managementApiSecret: '',
}

/**
 * Default Context Management Configuration
 */
export const DEFAULT_CONTEXT_MANAGEMENT_CONFIG: ContextManagementConfig = {
  enabled: false,
  strategies: {
    slidingWindow: { enabled: true, maxMessages: 20 },
    tokenLimit: { enabled: false, maxTokens: 4000 },
  },
  executionOrder: ['slidingWindow', 'tokenLimit'],
}

export const DEFAULT_REQUEST_LOG_CONFIG: RequestLogConfig = {
  enabled: true,
  maxEntries: 200,
  includeBodies: false,
  // 与 requestLogs/types.ts 的 DEFAULT_MAX_BODY_CHARS 同值（避免反向 import
  // 成环）；存量配置里停留在旧值 8000 的由 normalizeRequestLogConfig 迁移。
  maxBodyChars: 200_000,
  redactSensitiveData: true,
}

export function createDefaultModelMappings(): Record<string, ModelMapping> {
  return {}
}

/**
 * Keep only entries the user owns.
 *
 * Three kinds of row are dropped:
 *
 * 1. retired request names, and owners that are retired in the sense of
 *    `providers/providerRetirement::isRetiredProviderId` (a retired name that a
 *    live catalogue entry or channel still claims is not retired - it is the
 *    old integration's name reused, and dropping it would delete user data);
 * 2. an owner provider that no longer exists — such a pin can never select a
 *    candidate, so it is a zombie left behind by `deleteProvider`;
 * 3. **machine wiring**: every aggregate and account-channel sync used to also
 *    write one row per catalogue model into this table (`<entry>/<model>` →
 *    `<model>`, `渠道名 / 展示名` → `<channel>/<内部 id>`). That row duplicates
 *    the provider's own `modelMappings` ledger — which is what translation,
 *    routability and "does the gateway know this name" actually read — and
 *    every sync rewrote the whole table, wiping any user alias it did not know
 *    about. A row is machine wiring exactly when the owning provider's ledger
 *    maps the same request name to the same target, or when it is the
 *    derivable `<providerId>/<modelId>` form of an aggregate entry.
 *
 * `providers` omitted or empty = the caller cannot judge ownership (early boot,
 * partial store); only the retired checks apply, never a mass drop.
 */
export function normalizeModelMappingsWithDefaults(
  mappings?: Record<string, ModelMapping>,
  providers?: ReadonlyArray<Pick<Provider, 'id' | 'modelMappings'>>
): Record<string, ModelMapping> {
  const legacyModelNames = new Set(DEEPSEEK_LEGACY_MODEL_MAPPING_NAMES)
  const ledgers = new Map((providers ?? []).map(provider => [provider.id, provider.modelMappings ?? {}]))
  const knowOwners = ledgers.size > 0

  return Object.fromEntries(
    Object.entries(mappings || {}).filter(([requestModel, mapping]) => {
      if (legacyModelNames.has(requestModel)) return false
      const ownerId = mapping.preferredProviderId
      if (ownerId === undefined) return true
      if (isRetiredProviderId(ownerId)) return false
      if (!knowOwners) return true
      const ledger = ledgers.get(ownerId)
      if (ledger === undefined) return false
      if (ledger[requestModel] === mapping.actualModel) return false
      if (requestModel === `${ownerId}/${mapping.actualModel}`) return false
      return true
    }),
  )
}

/**
 * Default Application Configuration
 */
export const DEFAULT_CONFIG: AppConfig = {
  proxyPort: 8080,
  proxyHost: '127.0.0.1',
  httpsEnabled: false,
  httpsPort: 8443,
  httpsSanHosts: [],
  loadBalanceStrategy: 'round-robin',
  modelMappings: {},
  theme: 'system',
  autoStart: false,
  autoStartProxy: false,
  minimizeToTray: true,
  language: 'en-US',
  logLevel: 'info',
  logRetentionDays: 7,
  requestLogConfig: DEFAULT_REQUEST_LOG_CONFIG,
  requestTimeout: 60000,
  retryCount: 3,
  apiKeys: [],
  enableApiKey: false,
  oauthProxyMode: 'system',
  managementApi: DEFAULT_MANAGEMENT_API_CONFIG,
  contextManagement: DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
  autoRouting: DEFAULT_AUTO_ROUTING_CONFIG,
  // ⚠️ 这里**不能**写 `routes: {}`。`normalizeConfig()` 用「原始存储对象上有没有
  // routes 这个键」判断是不是旧数据（一次性迁移的判据），键存在（哪怕是 `{}`）就
  // 永不迁移 —— 这条判据正是「用户删光路由后 `auto` 不会在下次读取时复活」的前提。
  // 而 `DEFAULT_CONFIG` 是四处 `|| DEFAULT_CONFIG` 兜底与 `resetConfig()` 落盘的对象，
  // 一旦它预置了这个键，全新安装与重置都会被判成「已迁移」，谁也不会再建 auto 路由。
  // 于是新装/重置走「键不存在」分支：用 legacy `autoRouting` 生成一条名为 `auto` 的路由。
  compression: DEFAULT_COMPRESSION_CONFIG,
  promptCaching: DEFAULT_PROMPT_CACHING_CONFIG,
  dismissedAutoProviders: [],
}

/**
 * Built-in Provider Configuration
 * Re-exported from providers/builtin/index.ts to avoid duplication
 */
export { builtinProviders as BUILTIN_PROVIDERS } from '../providers/builtin/index.ts'
