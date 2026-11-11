import type { AggregateWire } from './aggregate'
import { DEFAULT_PROMPT_CACHING_CONFIG, type PromptCachingConfig } from './promptCache.ts'
import type { ChannelLoginKind, CostBucket } from './channels'
import type { AggregateCostClass } from './aggregateCost'
import type { ClientIdentity } from './clientProfile'
import { DEFAULT_REPETITION_GUARD, type RepetitionGuardSettings, type StreamRepetitionReading } from './streamRepetition.ts'

export type { AggregateWire }
export type { PromptCachingConfig }
export { DEFAULT_PROMPT_CACHING_CONFIG }
export type { RepetitionGuardSettings, StreamRepetitionReading }
export { DEFAULT_REPETITION_GUARD }

export type AccountStatus = 'active' | 'inactive' | 'expired' | 'error'

export type ProviderStatus = 'online' | 'offline' | 'unknown'


export type ProviderType = 'builtin' | 'custom' | 'aggregate' | 'account'

// Provider vendor type (for OAuth adapters)
export type ProviderVendor = 'opencode' | 'custom'

/**
 * The web-page integrations that were retired in 1.5. Startup purges their
 * providers, accounts and model mappings from stored data, so this list is the
 * single place that names them.
 */
export const RETIRED_PROVIDER_IDS = [
  'deepseek',
  'glm',
  'kimi',
  'mimo',
  'minimax',
  'qwen',
  'qwen-ai',
  'zai',
] as const

export type RetiredProviderId = (typeof RETIRED_PROVIDER_IDS)[number]

export type AuthType = 
  | 'oauth' 
  | 'token' 
  | 'cookie' 
  | 'userToken' 
  | 'refresh_token' 
  | 'jwt' 
  | 'realUserID_token' 
  | 'tongyi_sso_ticket'

export interface CredentialField {
  name: string
  label: string
  type: 'text' | 'password' | 'textarea'
  required: boolean
  placeholder?: string
  helpText?: string
}

/**
 * 选号策略。
 * - `round-robin` / `fill-first` / `failover`：只看账号池顺序与失败历史；
 * - `smart`：在可用候选里挑**最早解封**的那个，把快重置的额度先用掉；
 * - `pace`：挑"每小时剩余额度最多"的那个，把额度平摊到重置前。
 *
 * 后两者依赖额度账本（`shared/quotaPacing.ts` 推算重置时刻）。推不出来时它们
 * **不改可用性**，只是退回原有顺序 —— 没有上限的家不该因为"算不出来"被踢出候选。
 */
export type LoadBalanceStrategy = 'round-robin' | 'fill-first' | 'failover' | 'smart' | 'pace'

/** 三态能力：`unknown` 是真实状态，既不等于能用也不等于不能用 */
export type CapabilityState = 'yes' | 'no' | 'unknown'

export type AutoModelTier = 'fast' | 'balanced' | 'strong'

/** 模型声明的输入模态；模型没有声明时整个字段缺失（不是空数组）。 */
export type InputModality = 'text' | 'image' | 'audio' | 'video' | 'pdf'

/**
 * One model's routing annotation, keyed by display name inside
 * `Provider.modelCapabilities`.
 *
 * Every field is optional and *absent means unknown* - never a default value.
 * `weight` / `free` come from the account-channel catalogue (the multiplier
 * that upstream prints in the display name); builtin and aggregate providers
 * leave them unset because neither publishes a per-model cost.
 *
 * The same shape stores the user's manual corrections (`userModelMarks`).
 * Manual values are merged *on top of* whatever the source sync wrote, so a
 * wrong or missing automatic mark is always fixable without touching code.
 */
export interface ModelCapabilityHint {
  tier?: AutoModelTier
  vision?: Exclude<CapabilityState, 'unknown'>
  tools?: Exclude<CapabilityState, 'unknown'>
  /** Evidence-based reasoning flag; absent means unknown (not "no"). */
  reasoning?: Exclude<CapabilityState, 'unknown'>
  /** Declared input modalities; absent means unknown (not text-only). */
  modalities?: InputModality[]
  contextTokens?: number
  /** Declared maximum output length; absent means unknown (not a default cap) */
  maxOutputTokens?: number
  /** Credit multiplier reported by the channel pack; absent means unreported */
  weight?: number
  free?: boolean
}

/** Where one resolved capability field came from, highest evidence first. */
export type CapabilitySource =
  | 'manual'
  | 'provider-record'
  | 'aggregate-official'
  | 'catalog'
  | 'probe'
  | 'static'
  | 'provider-default'
  | 'third-party'
  | 'heuristic'
  | 'unknown'

/**
 * A resolved capability plus the provenance of each field.
 *
 * Provenance exists because the routing strategies are only as honest as their
 * marks: the route editor shows "vision = yes (provider default)" so a user can
 * tell an assumption from evidence and correct it manually.
 */
export interface ModelCapability {
  tier: AutoModelTier
  /** true when the tier came from a mark, false when it was guessed from the name */
  tierEvidenced: boolean
  vision: CapabilityState
  tools: CapabilityState
  reasoning: CapabilityState
  /** Declared input modalities; absent means the source said nothing. */
  modalities?: InputModality[]
  /** 上下文窗口；`undefined` 表示未知（不是 0） */
  contextTokens?: number
  /** 输出上限；`undefined` 表示未知（不是默认 4096） */
  maxOutputTokens?: number
  sources: {
    tier: CapabilitySource
    vision: CapabilitySource
    tools: CapabilitySource
    reasoning: CapabilitySource
    modalities: CapabilitySource
    contextTokens: CapabilitySource
    maxOutputTokens: CapabilitySource
  }
}

/**
 * One manual include/exclude entry on a route.
 *
 * Provider-qualified on purpose: two providers can expose the same display
 * name, and removing "one model" must not silently remove the other one.
 */
export interface RouteModelRef {
  providerId: string
  displayName: string
}

/** 空池原因。前四个是请求画像缺能力，后两个是路由配置把池筛光。 */
export type RoutePoolMissingReason =
  | 'vision'
  | 'tools'
  | 'reasoning'
  | 'context'
  | 'pool_strategy'
  | 'manual_filter'

/** 路由编辑器里「预览」用的请求画像；只影响能力硬过滤与上下文判定。 */
export interface RoutePreviewSample {
  needsVision?: boolean
  needsTools?: boolean
  needsReasoning?: boolean
  estimatedTokens?: number
}

/**
 * 预览里一个模型（不是账号）的最终状态：
 * - `kept` 策略筛完仍在池里；`included` 手动加回；`excluded` 手动移除；
 * - `filtered` 被某条池策略筛掉；`unavailable` 当前画像会把它硬过滤掉。
 */
export type RoutePreviewStatus = 'kept' | 'included' | 'excluded' | 'filtered' | 'unavailable' | 'not-pinned'

export interface RoutePreviewModel {
  providerId: string
  providerName: string
  displayName: string
  accountCount: number
  status: RoutePreviewStatus
  /** status='filtered'：第一条把它筛掉的池策略 */
  filteredBy?: AutoPoolStrategyId
  /** status='unavailable'：请求画像会把它硬过滤掉的原因 */
  unavailableReason?: 'vision' | 'tools' | 'reasoning' | 'context'
  capability: ModelCapability
  costBucket?: CostBucket
  costClass?: AggregateCostClass
  /**
   * 渠道目录报的消耗权重（倍率，`1` 为基准价）。
   *
   * 只有账号渠道会在模型名里带这个数（`Kimi-K3 · x0.2`），所以它缺失**不代表免费**，
   * 只代表上游没报价；聚合/内置/自定义供应商没有倍率概念，永远是 `undefined`。
   * 展示用（路由编辑里直接看到这条要花多少钱），不参与打分——打分读 `costBucket`。
   */
  weight?: number
}

/**
 * 一条 `or` **跨类别**地把排在它前面的策略作废的位置。
 *
 * 池策略从左到右做集合运算：`and` 交集、`or` 并集。同类别的并集是预设的本意
 * （`low-cost`＝免费∪低权重，`vision-first`＝视觉∪多模态），不报；只有
 * **成本/档位/渠道类的「或」把能力筛选作废**时才是会咬人的坑：勾了「工具能力」，
 * 池里却又冒出不会调工具的免费模型。判定口径不改，这条后果必须能读出来。
 */
export interface RoutePoolStrategyConflict {
  /** 造成并集的那条策略 */
  id: AutoPoolStrategyId
  /** 它新纳入了多少个候选 */
  adds: number
  /** 这些候选各自不满足的、排在它前面的策略，以及人数 */
  breaks: { strategy: AutoPoolStrategyId; count: number }[]
}

export interface RoutePreviewResult {
  routeName: string
  profile: {
    needsVision: boolean
    needsTools: boolean
    needsReasoning: boolean
    estimatedTokens: number
    complexity: 'simple' | 'standard' | 'complex'
    stream: boolean
  }
  /** 每条策略执行后的保留数（按配置顺序） */
  strategies: { id: AutoPoolStrategyId; kept: number }[]
  /** 「或」把排在它前面的筛选作废的地方；空数组＝这条序列自洽 */
  conflicts: RoutePoolStrategyConflict[]
  models: RoutePreviewModel[]
  counts: {
    /** 经过前置剔除后仍在候选里的模型数 */
    candidates: number
    afterStrategies: number
    afterManual: number
    /** 会被请求画像硬过滤掉的模型数 */
    unavailable: number
  }
  manual: {
    included: number
    excluded: number
    /** 引用了不存在/已停用模型的 include 条目 */
    unresolved: RouteModelRef[]
  }
  /** 空池原因；非空时 `models` 里全部不是 `kept`/`included` */
  missing: RoutePoolMissingReason[]
  /** 前置剔除（额度打满/渠道工具上限），原样透出 */
  skipped: string[]
}

/**
 * What the caller wants `auto` to optimise for. Overrides the target tier and
 * the weight the cost factor carries in scoring.
 */
export type AutoPreference = 'balanced' | 'fast' | 'strong' | 'cheap'

export const AUTO_PREFERENCES: readonly AutoPreference[] = ['balanced', 'fast', 'strong', 'cheap']

export interface AutoRoutingConfig {
  /** Enables the virtual `auto` model. When off, `auto` is hidden from /v1/models and rejected. */
  enabled: boolean
  /** Maximum number of candidates tried before giving up on one request. */
  maxAttempts: number
  /** How long a conversation stays pinned to the model it first succeeded on. 0 disables stickiness. */
  stickyMinutes: number
  /**
   * How long a conversation stays on the same `(provider, account, model)` for
   * cache reasons, independent of `stickyMinutes`. 0 = follow stickiness only.
   * Only providers with a known prompt-cache capability are pinned here; an
   * unknown provider must not receive a policy just because its name looks
   * cache-friendly.
   */
  cacheAffinityMinutes: number
  /** Default optimisation target; `X-Auto-Prefer` overrides it per request. */
  prefer: AutoPreference
  /**
   * Static model-pool filters the user pre-chooses. Evaluated left-to-right with
   * the per-entry operator; an empty array means no filtering at all (the pool
   * is exactly what the user kept served, as before). An unknown id is dropped
   * on normalisation, never a request failure.
   */
  poolStrategies: AutoPoolStrategy[]
}

export const DEFAULT_AUTO_ROUTING_CONFIG: AutoRoutingConfig = {
  enabled: true,
  maxAttempts: 3,
  stickyMinutes: 30,
  // DeepSeek documents "a few hours to a few days" before its cache clears, so
  // one hour is inside the documented lower bound and never outlives the cache.
  // Longer values wait for a measured TTL rather than a guess.
  cacheAffinityMinutes: 60,
  prefer: 'balanced',
  poolStrategies: [],
}

/**
 * Fallback for `ModelRoute.fairnessLead` when a route does not carry the field.
 *
 * Why not 0: 0 is strict rotation - a model never serves twice in a row, which
 * repays the upstream prompt cache on every turn for clients whose stickiness did not
 * already pin the conversation. Why not larger: every +1 doubles the number of
 * requests needed to walk the whole pool once, so "every model in the pool gets
 * routed" drifts further away. 2 lets one model serve three consecutive dispatches
 * before the rotation moves on, which still completes a full round of a several-hundred
 * model pool in a few hundred requests.
 */
export const DEFAULT_FAIRNESS_LEAD = 2

/** Upper bound for `fairnessLead`: past this the rotation is weak enough to be off. */
export const FAIRNESS_LEAD_MAX = 20

/**
 * One named route the caller can ask for instead of a model.
 *
 * A route is a *request-time pool decision*, not a membership list: the pool is
 * recomputed from the models that are served right now, then filtered by
 * `poolStrategies` (an empty sequence is a no-op, so the pool is exactly what the
 * user kept served). That is why adding a model needs no route edit, and why
 * stopping one takes effect on the next request.
 *
 * `includeModels` / `excludeModels` are manual *overrides* on top of that
 * decision, not membership: they exist so a wrong or missing model mark can be
 * corrected by hand, and they never resurrect a model that is not served.
 *
 * Every per-route field reuses the normalisation the legacy `autoRouting` config
 * already had (`store/autoRoutingConfig.ts`): `maxAttempts` clamped to 1-5,
 * `stickyMinutes` to 0-1440, an unknown `prefer` falls back to `balanced`, unknown
 * pool-strategy ids are dropped. Absent means "take the shipped default", never
 * "treat as 0".
 *
 * `strategy` is the scoring profile - the same five values as
 * `LoadBalanceStrategy` and `proxy/autoRouting.ts`'s `AutoRoutingStrategy` (the
 * three unions are deliberately separate declarations; a shared type cannot import
 * from `main/proxy`). It selects the scoring weights only; the account pick inside
 * the chosen provider still follows the server-wide `loadBalanceStrategy`.
 */
export interface ModelRoute {
  /** Canonical name (trim + lowercase, `[a-z0-9_-]{1,64}`); also the `routes` key. */
  name: string
  /** Disabled routes are neither advertised on `/v1/models` nor routable. */
  enabled: boolean
  /** Scoring profile used when ranking this route's pool. */
  strategy: LoadBalanceStrategy
  /** Optimisation target; `X-Auto-Prefer` still overrides it per request. */
  prefer: AutoPreference
  /** Candidate cap for one request through this route. */
  maxAttempts: number
  /** How long a conversation stays pinned; 0 disables stickiness for this route. */
  stickyMinutes: number
  /**
   * Stickiness is a **hard priority** on this route: the model the conversation last
   * succeeded on is moved to the head of the ranked list, whatever its score.
   *
   * Absent means enabled, because records written before this field existed must keep
   * the behaviour they were observed to need - an agent session that changes model
   * mid-conversation pays for context, tool protocol and cache all over again. Set it
   * to `false` to let the sticky bonus (+0.12 / +0.06 in the score) be the only
   * mechanism, which is what the routing v2 plan originally specified.
   */
  stickyHardPin?: boolean
  /**
   * Fairness lead, in dispatches: a model may run this many times ahead of the
   * **least-dispatched model in this route's own pool** before the share rotation
   * moves it behind every candidate that has served less. Within each group the score
   * still decides the order, so the score did not stop mattering - it stopped deciding
   * *who gets to represent the pool at all*.
   *
   * Why this exists: the ranking is deterministic, so with the whole catalogue in the
   * pool the same top scorer answers every request forever. `0` is strict rotation
   * (serve one, move on), `1` allows two in a row, `2` (the shipped default) allows
   * three - the compromise for agent clients, where a model change mid-conversation
   * repays the upstream prompt cache even though stickiness already covers the
   * same-session case. A large value (upper bound 20) is effectively "no rotation".
   */
  fairnessLead?: number
  /** Static pool filters, evaluated left to right; empty means no filtering. */
  poolStrategies: AutoPoolStrategy[]
  /**
   * Hard name pin: the route's candidate base pool is **only** these models.
   *
   * Empty means no pin (the pool stays the whole catalogue), which is what the 17
   * capability/cost/tier/channel strategies cannot express - none of them selects by
   * model name. Ordering is fixed: pin restricts the base pool, then `poolStrategies`
   * filter inside it, then `excludeModels` removes and `includeModels` may only
   * recover candidates that survived the pin. Same ref shape as those two fields, so
   * normalization, write-side validation and the preview's `unresolved` report all
   * reuse one vocabulary instead of a second name-matching dialect.
   *
   * This is what makes an Anthropic-facing route name honest: a route called
   * `claude-opus-5` must not be free to answer with any model in the catalogue.
   *
   * The other honest shape is `basedOnRoute`: an entry name that borrows a route the
   * user actually configured is honest because the pool is that route's deliberate
   * decision, not because it is pinned to one model.
   */
  pinModels: RouteModelRef[]
  /**
   * Pool reference: this route's **whole selection behaviour** comes from the
   * referenced route (strategies, pin, manual include/exclude, scoring profile,
   * attempt cap, stickiness). Only the name stays ours - `X-ModelPort-Route-Name`,
   * the sticky key and the request log all still say which name the client asked for.
   *
   * Why a reference instead of a copy: a second client-facing name (an Anthropic
   * tier, a per-app lane) must not carry its own copy of the pool config, or editing
   * `auto` would leave that copy silently stale. Write-side validation allows one
   * hop only, so a chain cannot form and cannot cycle.
   */
  basedOnRoute?: string
  /**
   * Models force-added to this route's pool **after** `poolStrategies` ran.
   *
   * The manual correction for a wrong/missing mark: if a filter dropped a model
   * that can actually serve, adding it here puts it back. It never bypasses the
   * request-time hard filters (image → vision, context size) or the contract
   * filter, because those protect correctness rather than convenience.
   */
  includeModels: RouteModelRef[]
  /**
   * Models always removed from this route's pool. Wins over `includeModels`, so
   * a hand-broken config can never reintroduce a model the user removed.
   */
  excludeModels: RouteModelRef[]
}

/** How two adjacent pool strategies combine: intersect (`and`) or union (`or`). */
export type AutoPoolStrategyOperator = 'and' | 'or'

/**
 * The 17 pool-strategy ids, in the order the settings UI lists them. The union is
 * derived from this const array (not from a type that references AutoPoolStrategy,
 * which would be circular); the metadata table below is the runtime source of
 * truth and is filtered through this list.
 */
export const AUTO_POOL_STRATEGY_IDS = [
  // 能力类（5）
  'vision-capable',
  'tools-capable',
  'multimodal',
  'reasoning',
  'annotated-only',
  // 成本类（4）
  'free-only',
  'low-weight',
  'included-plan',
  'cost-known',
  // 上下文类（2）
  'long-context',
  'standard-context',
  // 档位类（3）
  'fast-tier',
  'strong-tier',
  'balanced-tier',
  // 渠道类（3）
  'aggregate-only',
  'channel-only',
  'builtin-only',
] as const

/** Every valid pool strategy id. */
export type AutoPoolStrategyId = (typeof AUTO_POOL_STRATEGY_IDS)[number]

/**
 * One user-chosen pool filter. `operator` is how this entry combines with the
 * result so far; the first entry's operator is ignored (nothing to combine with).
 */
export interface AutoPoolStrategy {
  id: AutoPoolStrategyId
  operator: AutoPoolStrategyOperator
}

/** Which family a pool strategy belongs to, for grouping in the settings UI. */
export type AutoPoolStrategyCategory = 'capability' | 'cost' | 'context' | 'tier' | 'channel'

/**
 * Metadata for one pool strategy. The label/help live in the i18n catalogues
 * (`proxy.autoRoutingPoolStrategy.<id>` / `.desc`); this table is the single
 * list of what exists, so the settings UI and the normalisation filter both
 * read it and a new strategy cannot silently render as `undefined`.
 */
export interface AutoPoolStrategyMeta {
  id: AutoPoolStrategyId
  category: AutoPoolStrategyCategory
  /** The default combiner shown in the UI for this entry */
  operator: AutoPoolStrategyOperator
}

/**
 * The 17 pool strategies, in display order. Order is load-bearing only inside a
 * preset (the sequence is written verbatim into `poolStrategies`); the display
 * list is simply grouped by category.
 */
export const AUTO_POOL_STRATEGIES: readonly AutoPoolStrategyMeta[] = [
  // 能力类（5）
  { id: 'vision-capable', category: 'capability', operator: 'and' },
  { id: 'tools-capable', category: 'capability', operator: 'and' },
  { id: 'multimodal', category: 'capability', operator: 'and' },
  { id: 'reasoning', category: 'capability', operator: 'and' },
  { id: 'annotated-only', category: 'capability', operator: 'and' },
  // 成本类（4）
  { id: 'free-only', category: 'cost', operator: 'and' },
  { id: 'low-weight', category: 'cost', operator: 'and' },
  { id: 'included-plan', category: 'cost', operator: 'and' },
  { id: 'cost-known', category: 'cost', operator: 'and' },
  // 上下文类（2）
  { id: 'long-context', category: 'context', operator: 'and' },
  { id: 'standard-context', category: 'context', operator: 'and' },
  // 档位类（3）
  { id: 'fast-tier', category: 'tier', operator: 'and' },
  { id: 'strong-tier', category: 'tier', operator: 'and' },
  { id: 'balanced-tier', category: 'tier', operator: 'and' },
  // 渠道类（3）
  { id: 'aggregate-only', category: 'channel', operator: 'and' },
  { id: 'channel-only', category: 'channel', operator: 'and' },
  { id: 'builtin-only', category: 'channel', operator: 'and' },
]

export function isAutoPoolStrategyId(value: unknown): value is AutoPoolStrategyId {
  return AUTO_POOL_STRATEGY_IDS.includes(value as AutoPoolStrategyId)
}

/**
 * The five one-click presets. Clicking one writes its strategy sequence verbatim
 * into `poolStrategies` (replacing whatever was selected). The first entry's
 * operator is ignored by the evaluator, so it is written as `and` throughout.
 */
export interface AutoPoolPresetMeta {
  id: AutoPoolPresetId
  strategies: AutoPoolStrategy[]
}

export type AutoPoolPresetId =
  | 'daily-free'
  | 'vision-first'
  | 'long-context'
  | 'low-cost'
  | 'strong-reasoning'

export const AUTO_POOL_PRESETS: readonly AutoPoolPresetMeta[] = [
  // 日常免费：免费（无运算符）＋ 已标注（且）→ 免费交集已标注
  {
    id: 'daily-free',
    strategies: [
      { id: 'free-only', operator: 'and' },
      { id: 'annotated-only', operator: 'and' },
    ],
  },
  // 视觉优先：视觉（无）＋ 多模态（或）→ 视觉并多模态
  {
    id: 'vision-first',
    strategies: [
      { id: 'vision-capable', operator: 'and' },
      { id: 'multimodal', operator: 'or' },
    ],
  },
  // 长上下文：仅长上下文一条
  {
    id: 'long-context',
    strategies: [{ id: 'long-context', operator: 'and' }],
  },
  // 低成本：免费（无）＋ 低权重（或）→ 免费并低权重
  {
    id: 'low-cost',
    strategies: [
      { id: 'free-only', operator: 'and' },
      { id: 'low-weight', operator: 'or' },
    ],
  },
  // 强推理：推理（无）＋ 强档（且）→ 推理交集强档
  {
    id: 'strong-reasoning',
    strategies: [
      { id: 'reasoning', operator: 'and' },
      { id: 'strong-tier', operator: 'and' },
    ],
  },
]

export type Theme = 'light' | 'dark' | 'system'

export interface Account {
  id: string
  providerId: string
  name: string
  email?: string
  credentials: Record<string, string>
  status: AccountStatus
  lastUsed?: number
  lastStatusCheck?: number
  createdAt: number
  updatedAt: number
  errorMessage?: string
  requestCount?: number
  dailyLimit?: number
  todayUsed?: number
}

export interface Provider {
  id: string
  name: string
  type: ProviderType
  authType: AuthType
  apiEndpoint: string
  chatPath?: string
  headers: Record<string, string>
  enabled: boolean
  createdAt: number
  updatedAt: number
  description?: string
  icon?: string
  supportedModels?: string[]
  modelMappings?: Record<string, string>
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
   * How the user proves ownership of this provider's accounts, for
   * `type: 'account'` records only.
   *
   * `authType` cannot express this: the enum has no browser/device-code member,
   * so a channel record stored `authType: 'token'` and the card rendered
   * "API Key" for a channel whose accounts are obtained by browser login. The
   * authoritative value lives in the channel catalogue (`loginKind`); this field
   * carries it across the IPC boundary because the renderer cannot import
   * `src/main/**` without dragging electron into the bundle.
   */
  loginKind?: ChannelLoginKind
  status?: ProviderStatus
  lastStatusCheck?: number
}

export interface ModelMapping {
  requestModel: string
  actualModel: string
  preferredProviderId?: string
  preferredAccountId?: string
  /**
   * true = 已停用：这个名字不再被任何解析路径认识。缺席即启用。
   * 与 `src/main/store/types.ts` 同一份声明（两处都要写），启用位只有这一处落库，
   * 因为别名不归任何供应商目录管，`excludedModels` 记不到它。
   */
  disabled?: boolean
}

export interface ApiKey {
  id: string
  name: string
  key: string
  enabled: boolean
  createdAt: number
  lastUsedAt?: number
  usageCount: number
  description?: string
}

/**
 * Anthropic 入站（`/v1/messages`）的模型解析规则。
 *
 * anthropic 客户端只说 `claude-*`，网关没有这些模型，所以必须有一条落点规则：
 * 先查 `modelMap`（精确键优先，其次按最长前缀匹配，`claude-*` 这种通配就写前缀），
 * 再落 `defaultModel`（缺省 `auto` 路由）。
 *
 * 两个字段都可选：缺席时行为固定为「请求名能在网关解析就原样用，否则落 auto」，
 * 所以一份老配置不需要迁移也能工作。
 */
/**
 * Anthropic 家族档位。值域不是我们编的：Claude Desktop 4.4212 的清单解析里那张合法表
 * 是 `["sonnet","opus","haiku","fable","mythos"]`（取自本机 `app.asar`），而它保留一行的
 * 判据是「`id` 是它认识的 Anthropic 名 **或** 这一格是合法档位」。
 */
export const ANTHROPIC_FAMILY_TIERS = ['sonnet', 'opus', 'haiku', 'fable', 'mythos'] as const

export type AnthropicFamilyTier = (typeof ANTHROPIC_FAMILY_TIERS)[number]

export interface AnthropicInboundConfig {
  /** 请求名解析不出来时落到哪个网关模型/路由。缺省 `auto`。 */
  defaultModel?: string
  /**
   * `客户端里的名字（或前缀）-> 网关路由名`。
   *
   * 这是「Claude 里叫什么」唯一的一格：清单行的 id 与 `display_name` 都用这个键，客户端
   * 筛的是它，下一轮发回来的也是它。曾经另有一个 `routeDisplayNames`（只改显示文字、
   * 不影响客户端筛名），两条名字列并排就是让人填错的地方，已退役。
   */
  modelMap?: Record<string, string>
  /**
   * `路由名 -> 档位`：发清单时给这一行带 `anthropic_family_tier`，于是客户端按档位保留
   * 它，网关里的名字不必长得像 Anthropic。键大小写不敏感；值不在合法档位表里时
   * 这一格不发（判据只在 `modelsToAnthropicList` 一处实现）。
   */
  routeTiers?: Record<string, AnthropicFamilyTier>
  /**
   * `document` 附件块要不要翻成 chat 的 `file` 块真的发给上游。
   *
   * 可选且**默认开**（只有显式 `false` 才关）：客户端
   * 只在用户真挂了文件时才发这个块，不像 `temperature` 那样每请求都带，所以「上游不吃
   * file 块而报错」是可接受的诚实结果，胜过「模型答非所问而没人知道附件没送出去」。
   * 关掉后回到丢弃但记入 `X-ModelPort-Anthropic-Dropped` 的行为。
   */
  documentPassThrough?: boolean
}

export interface AppConfig {
  proxyPort: number
  proxyHost: string
  /** Adds a TLS listener; the HTTP listener on `proxyPort` stays as-is. */
  httpsEnabled: boolean
  httpsPort: number
  /** Custom PEM certificate; absent means the app-managed self-signed cert. */
  httpsCertPath?: string
  /** Custom PEM private key; required together with `httpsCertPath`. */
  httpsKeyPath?: string
  /** Extra IPs/hostnames the managed certificate must include in its SAN. */
  httpsSanHosts: string[]
  loadBalanceStrategy: LoadBalanceStrategy
  /**
   * 流内重复退化判据（Bandit 的第二类 degraded 信号）。
   *
   * Absent means the shipped defaults, so a config file written before this field
   * existed neither disables the guard nor silently changes the thresholds it was
   * tuned against.
   */
  streamRepetitionGuard?: RepetitionGuardSettings
  modelMappings: Record<string, ModelMapping>
  /**
   * 标准库（LiteLLM）的自定义镜像地址，仅接受 https；空/缺省表示不使用。
   * 可达性与可信度由用户自行承担，主端点与 jsDelivr 仍会先试。
   */
  catalogMirrorUrl?: string
  theme: Theme
  autoStart: boolean
  autoStartProxy: boolean
  minimizeToTray: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  logRetentionDays: number
  requestLogConfig: RequestLogConfig
  requestTimeout: number
  retryCount: number
  /**
   * Output cap the anthropic wire sends when neither the client (under either
   * spelling) nor a per-model parameter supplied one. Absent means the shipped
   * default (`DEFAULT_MAX_OUTPUT_TOKENS`) - never a silent 4096 baked into code.
   */
  defaultMaxOutputTokens?: number
  apiKeys: ApiKey[]
  enableApiKey: boolean
  oauthProxyMode: 'system' | 'none'
  managementApi: ManagementApiConfig
  contextManagement?: unknown
  /**
   * Legacy single-`auto` routing config. Kept as the migration source and as the
   * fallback for in-flight callers; the UI no longer exposes it once `routes` exists.
   */
  autoRouting: AutoRoutingConfig
  /**
   * Named routes (`name -> route`). Optional **in the type on purpose**: the
   * absence of the key on the *raw stored object* is the one-time migration gate
   * (see `main/store/store.ts::normalizeConfig`), so `DEFAULT_CONFIG` must not
   * preset it. Every read returns it filled - `getConfig().routes` is only
   * `undefined` for a hand-built object that never went through the store.
   */
  routes?: Record<string, ModelRoute>
  /**
   * Names already handled by the protocol-route seeding
   * (`main/store/modelRoutes.ts::PRESET_ROUTE_SEEDS`). One-time marker: a name
   * the user deleted must never be re-created on the next read, so the gate is
   * "is this name recorded", never "is the table empty". `DEFAULT_CONFIG` does not
   * preset it - absence means "not seeded yet".
   */
  seededPresetRoutes?: string[]
  /**
   * Anthropic 入站（`/v1/messages`）的模型解析规则。缺席即默认行为
   * （见 `AnthropicInboundConfig`），所以老配置无需迁移。
   */
  anthropicInbound?: AnthropicInboundConfig
  compression: CompressionConfig
  /**
   * Prompt-cache behaviour. `enabled` gates the Anthropic breakpoint injection;
   * `anthropicTtl` chooses the 5-minute or 1-hour write tier. Implicit-prefix
   * providers need no marker, so they read only the capability table.
   */
  promptCaching: PromptCachingConfig
  language: 'zh-CN' | 'en-US'
  /**
   * 供应商模型清单定时刷新。缺席即默认行为（见 `DEFAULT_MODEL_REFRESH`），
   * 所以老配置无需迁移——和 `routes` / `seededPresetRoutes` 同款的"缺席即默认"门禁。
   */
  modelListRefresh?: ModelListRefreshConfig
}

/**
 * 模型清单定时刷新配置。
 *
 * `enabled` 关掉则调度器完全不挂任务；三个开关分别控制哪一类纳入预热。
 *
 * ## 为什么是**两档**周期而非一档
 *
 * 三类来源的取数成本天差地别：
 * - 账号渠道走渠道包**本地** `model.list` RPC（进程内调用，零网络、零凭据解析），
 *   成本极低；
 * - 聚合目录 `syncModels` 与内置供应商 `fetchProviderModels` 都是**真·HTTP 打上游**，
 *   频繁触发会被限流/风控。
 *
 * 而更重要的事实是：**模型清单本身是周/月级事件**（上游增删模型、倍率/免费标记
 * 调整都是低频的），分钟级轮询纯属浪费还增加上游压力。所以拆成两档且都用天/周/月
 * 单位：`accountIntervalMs`（本地 RPC，默认 1 周）与 `aggregateIntervalMs`
 * （真·HTTP，默认 1 月）；`builtin` 与聚合同档（同样是 HTTP）。UI 只暴露天/周/月档位。
 */
export interface ModelListRefreshConfig {
  enabled: boolean
  /** 账号渠道刷新周期（毫秒），默认 1 周。本地 RPC 零成本，但清单变化本就低频。 */
  accountIntervalMs: number
  /** 聚合目录 + 内置供应商刷新周期（毫秒），默认 1 月。真·HTTP 打上游，宜稀疏。 */
  aggregateIntervalMs: number
  /** 账号渠道（13 个：本地 model.list RPC 预热）。 */
  accountChannels: boolean
  /** 聚合目录（遍历已配置 aggregate 条目跑 syncModels）。 */
  aggregate: boolean
  /** 内置供应商（有 modelsFetch 的 builtin 真·HTTP 重拉；当前为空集合）。 */
  builtin: boolean
}

/**
 * 调度任务的状态快照（供 UI 展示）。
 *
 * 纯数据类型，无运行时依赖，主进程 `Scheduler` 与渲染端类型定义共用同一份，
 * 避免渲染端 import 主进程文件（会带进 electron）。
 */
export interface SchedulerTaskStatus {
  name: string
  intervalMs: number
  running: boolean
  lastRunAt: number | null
  nextRunAt: number | null
  lastError: string | null
  lastSuccessAt: number | null
}

/** Compression strength; multiplies the adaptive retention budget. */
export type CompressionAggressiveness = 'conservative' | 'moderate' | 'aggressive'

/**
 * Live-zone context compression: the only two knobs the UI exposes.
 *
 * Off by default. A rewrite is only free when it cannot disturb the provider's
 * prompt cache, so this ships gated and is enabled deliberately.
 */
export interface CompressionConfig {
  enabled: boolean
  aggressiveness: CompressionAggressiveness
  /**
   * Cache-first policy: a provider whose prefix cache is documented and whose
   * cached input is much cheaper than fresh input skips live-zone compression
   * unless the user overrides it. Absent = shipped default (on).
   */
  cacheFirst?: boolean
  /** Per-provider explicit override; `true`/`false` wins over `cacheFirst`. */
  providerOverrides?: Record<string, boolean>
}

export const COMPRESSION_AGGRESSIVENESS: CompressionAggressiveness[] = [
  'conservative',
  'moderate',
  'aggressive',
]

/**
 * Ships enabled: the dashboard's "saved" figure is only non-zero when this is
 * on, and the pipeline is verified correct end-to-end (forwarder → report →
 * meterQuota → recordTokenUsage → store → IPC → dashboard). A user who
 * explicitly turned it off keeps that off via `normalizeCompressionConfig`
 * (only `enabled === true` enables; an absent key falls back to this default).
 */
export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  enabled: true,
  aggressiveness: 'moderate',
  cacheFirst: true,
}

/**
 * 模型清单定时刷新出厂默认值。
 *
 * 模型清单（上游增删模型、倍率/免费标记调整）本质是**周/月级**事件，不是分钟级。
 * 所以周期用的是天/周/月单位，而不是小时：账号渠道默认 **1 周**（本地 RPC 零成本，
 * 但仍没必要天天刷），聚合/内置默认 **1 月**（真·HTTP 打上游，稀疏为宜）。
 *
 * 三类默认全开（内置当前为空集合，开启无害）。UI 改的是复写的真值，这里只是
 * 老配置/缺省时的回落。注意 `DEFAULT_CONFIG` 不预置 `modelListRefresh` 字段，
 * 由 `normalizeModelListRefresh` 在读取侧补，保持与 `routes` 同款"缺省即默认"纪律。
 */
export const DAY_MS = 24 * 60 * 60 * 1000
export const WEEK_MS = 7 * DAY_MS
export const MONTH_MS = 30 * DAY_MS

export const DEFAULT_MODEL_REFRESH: ModelListRefreshConfig = {
  enabled: true,
  accountIntervalMs: WEEK_MS,
  aggregateIntervalMs: 2 * WEEK_MS,
  accountChannels: true,
  aggregate: true,
  builtin: true,
}

/**
 * 把任意（含 undefined / 畸形）输入归一成合法的 `ModelListRefreshConfig`。
 * 两档周期各自下限 60s 防呆（UI 只暴露天/周/月档位，不会让人误设成分钟级）。
 */
export function normalizeModelListRefresh(input: unknown): ModelListRefreshConfig {
  if (input === undefined || input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ...DEFAULT_MODEL_REFRESH }
  }
  const raw = input as Partial<ModelListRefreshConfig>
  const accountIntervalMs =
    typeof raw.accountIntervalMs === 'number' &&
    Number.isFinite(raw.accountIntervalMs) &&
    raw.accountIntervalMs >= 60_000
      ? raw.accountIntervalMs
      : DEFAULT_MODEL_REFRESH.accountIntervalMs
  const aggregateIntervalMs =
    typeof raw.aggregateIntervalMs === 'number' &&
    Number.isFinite(raw.aggregateIntervalMs) &&
    raw.aggregateIntervalMs >= 60_000
      ? raw.aggregateIntervalMs
      : DEFAULT_MODEL_REFRESH.aggregateIntervalMs
  return {
    enabled: raw.enabled === true,
    accountIntervalMs,
    aggregateIntervalMs,
    accountChannels: raw.accountChannels !== false,
    aggregate: raw.aggregate !== false,
    builtin: raw.builtin !== false,
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: number
  level: LogLevel
  message: string
  accountId?: string
  providerId?: string
  requestId?: string
  data?: Record<string, unknown>
}

/**
 * One request plus the surrounding evidence, for copying out of a user's
 * machine. Contains no credentials or request bodies unless the row was
 * captured with an explicit trace.
 */
export interface RequestDiagnosticBundle {
  generatedAt: string
  app: {
    version: string
    electron: string
    node: string
    platform: string
    arch: string
  }
  request: RequestLogEntry | null
  relatedLogs: LogEntry[]
  config: Record<string, unknown>
}

export interface ProxyStatus {
  isRunning: boolean
  port: number
  host: string
  uptime: number
  connections: number
}

/** Certificate the HTTPS listener presents. Never carries the private key. */
export interface TlsCertificateInfo {
  source: 'managed' | 'custom'
  certPath: string
  keyPath: string
  subject: string
  issuer: string
  fingerprint256: string
  validFrom: string
  validTo: string
  subjectAltName: string | null
  selfSigned: boolean
}

/** One TLS handshake failure family, counted since the listener started. */
export interface TlsHandshakeRejectionStat {
  code: string
  count: number
  /** True when the code means "the client rejected our certificate", not a protocol error. */
  certificate: boolean
}

export interface TlsHandshakeStats {
  /** Epoch ms of the moment counting began (the listener start). */
  sinceAt: number
  total: number
  lastAt: number | null
  byCode: TlsHandshakeRejectionStat[]
}

export interface TlsStatus {
  enabled: boolean
  /** Whether the HTTPS listener is actually accepting connections. */
  running: boolean
  host: string
  port: number
  /** Base URL to paste into a client (no `/v1`); null when disabled or not running. */
  url: string | null
  certificate: TlsCertificateInfo | null
  /** null = this platform has no cheap trust-store probe. */
  trusted: boolean | null
  /**
   * Handshakes the client aborted before any HTTP was exchanged. Those requests
   * never reach the request log, so this counter is the only evidence that a
   * client tried and was refused by its own certificate check.
   */
  handshakeRejections: TlsHandshakeStats | null
  /** Why the listener is enabled but not running. */
  error: string | null
}

/** The certificate a client needs in order to trust this listener. */
export interface TlsCertificateBundle {
  certPath: string
  /** PEM of the certificate only; never the private key. */
  pem: string
  source: TlsCertificateInfo['source']
  subject: string
  issuer: string
  fingerprint256: string
  validTo: string
  subjectAltName: string | null
  selfSigned: boolean
}

export interface TlsTrustResult {
  ok: boolean
  message: string
  trusted: boolean | null
}

export interface ProxyStatistics {
  totalRequests: number
  successRequests: number
  failedRequests: number
  avgLatency: number
  requestsPerMinute: number
  activeConnections: number
  modelUsage: Record<string, number>
  providerUsage: Record<string, number>
  accountUsage: Record<string, number>
}

export interface ProviderCheckResult {
  providerId: string
  status: ProviderStatus
  latency?: number
  error?: string
  /** Machine-readable cause; the UI turns it into its own wording */
  reason?: string
}

export interface OAuthResult {
  success: boolean
  providerId?: string
  providerType?: ProviderVendor
  credentials?: Record<string, string>
  account?: Account
  accountInfo?: {
    userId?: string
    email?: string
    name?: string
  }
  error?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
  validatedAt: number
  accountInfo?: {
    name?: string
    email?: string
    quota?: number
    used?: number
    expiresAt?: number
  }
}

/**
 * One candidate the route tried and switched past.
 *
 * `kind` is the same classification the failover loop itself branches on, so the
 * log answers "was this home broken, or just wrong for this request" without
 * reading upstream wording:
 * - `capability` - the request died before generation (tools overflow, history
 *   missing `reasoning_content`, this channel's catalogue does not serve the
 *   model). The account is healthy: no cooldown, no failure count.
 * - `failover` - 429 / 5xx / no status code; the next home may answer.
 * - `fatal` - any other status; the chain stopped right here, so this row is also
 *   what the client got.
 */
export interface AutoAttemptFailure {
  /** Candidate display name, e.g. `workbuddy/hy3`. */
  candidate: string
  kind: 'capability' | 'failover' | 'fatal'
  /** Absent when upstream never answered (network error, timeout). */
  status?: number
  /** Upstream wording, capped by `describeAttemptFailure`. */
  reason: string
}

/**
 * One upstream attempt inside a request.
 *
 * A request can try several providers/accounts (failover) and several times
 * against one target (5xx retry). The final row used to keep only the winner,
 * so `attempts: 4` could not explain what the first three answered.
 */
export interface RequestAttemptTrace {
  providerId: string
  providerName?: string
  accountId?: string
  accountName?: string
  /** Display name sent upstream (route/aggregate chains keep the provider prefix). */
  model: string
  status?: number
  errorType?: string
  errorCode?: string | number | null
  errorMessage?: string
  latencyMs?: number
  /** `success` is the winning attempt; the rest say why it was skipped. */
  outcome: 'success' | 'failover' | 'fatal' | 'capability' | 'client_abort'
  /** 0 = first attempt against this target, 1 = same-target retry. */
  retryIndex?: number
}

/** Transport-level facts for a streaming response. */
export interface RequestStreamTrace {
  /** Time from request start to the first upstream data chunk. */
  firstTokenMs?: number
  /** Time from request start to the end of the client stream. */
  totalMs?: number
  /** Bytes forwarded to the client (SSE text). */
  bytesOut?: number
  /** Why the stream ended. `client_gone` is a client cancel, not an upstream fault. */
  endReason?: 'done' | 'eof' | 'timeout' | 'client_gone' | 'error'
  /** Whether a `[DONE]` sentinel was observed (including one appended by the proxy). */
  sawDone?: boolean
  /** Number of `: PING` comments written while waiting for upstream data. */
  pingCount?: number
  /** Upstream request id when the provider exposes one (support ticket evidence). */
  upstreamRequestId?: string
  /**
   * 流内重复退化读数；只在流式且守卫开启时有值。
   * Non-streaming requests carry nothing here by design - see `shared/streamRepetition.ts`.
   */
  repetition?: StreamRepetitionReading
}

export interface RequestLogEntry {
  /** Log ID */
  id: string
  /** Timestamp */
  timestamp: number
  /**
   * 行类型：客户端真实流量，还是网关自己的探测请求。
   * 探测行照常有 `requestId`（`X-Request-Id` 口径），但**不计入**请求统计、
   * 不参与 Bandit 评分、不触发账号冷却（见 `providers/modelProbeRunner.ts`）。
   */
  kind?: 'client' | 'probe'
  /** Request status */
  status: 'success' | 'error'
  /** HTTP status code */
  statusCode: number

  /** Correlation id shared with app logs and the X-Request-Id response header. */
  requestId?: string
  /** HTTP method */
  method: string
  /** Request URL path */
  url: string
  /**
   * Client User-Agent. Refused requests never reach a route, so without this a
   * `401 missing_api_key` row names neither the client nor the caller - the
   * 2026-11-06 WSL probes (`GET /v1/models` + `/v1/props` for 23 minutes) could
   * not be attributed to any installed tool.
   */
  userAgent?: string
  /** Requested model name */
  model: string
  /** Actual model used (after mapping) */
  actualModel?: string

  /** Provider ID */
  providerId?: string
  /** Provider name */
  providerName?: string
  /** Account ID */
  accountId?: string
  /** Account name */
  accountName?: string

  /** Request body JSON string */
  requestBody?: string
  /** User input extracted from messages (truncated to 200 chars) */
  userInput?: string

  /** Web search enabled */
  webSearch?: boolean
  /** Reasoning effort level */
  reasoningEffort?: 'low' | 'medium' | 'high'

  /**
   * Output cap the client asked for, after the route entry folded `max_completion_tokens`
   * into `max_tokens` (`normalizeOutputCap`).
   * Absent when the client sent neither - never defaulted here, since the upstream default is unknown.
   */
  maxTokens?: number

  /** Response status code */
  responseStatus: number
  /** Response preview (truncated) */
  responsePreview?: string
  /** Response body JSON string */
  responseBody?: string
  /** Finish reason the client actually received; absent when the upstream never announced an ending */
  finishReason?: string
  /** Streaming only: the upstream ended without a finish reason, so the turn the client got is incomplete */
  streamTruncated?: boolean

  /** Request latency in milliseconds */
  latency: number
  /** Whether streaming request */
  isStream: boolean

  /** Error message */
  errorMessage?: string
  /** Error stack trace (redacted and truncated before persistence) */
  errorStack?: string
  /** Machine-readable error fields preserved from the upstream envelope. */
  errorType?: string
  errorCode?: string | number | null
  errorParam?: string | null
  /** HTTP status the upstream actually returned (before any client-facing mapping). */
  upstreamStatus?: number
  /** Upstream request id (support ticket evidence); also mirrored inside streamTrace. */
  upstreamRequestId?: string
  /** Every attempt, in order, including the winning one. */
  attempts?: RequestAttemptTrace[]
  /**
   * 「这一轮的请求体量 vs 这一家的窗口」的读数（口径见 `requestContextFit.ts`）。
   * `inputTokensEstimate` 是估算值，绝不写进 `usage`，也不参与计费。
   * 没有公布窗口的候选只写估算值与 `contextFit:"unknown"`，不写猜测窗口。
   */
  inputTokensEstimate?: number
  modelContextWindow?: number
  contextFit?: 'fits' | 'overflow' | 'unknown'
  /** 该 overflow 来自上游实测报错（而不是判定）时才有 */
  contextFitSource?: 'measured'
  /** Streaming-only transport facts. */
  streamTrace?: RequestStreamTrace
  /**
   * Upstream-reported usage for this request.
   *
   * Absent when the upstream reported nothing — never filled from the local
   * estimator. `cacheReadTokens` is a subset of `promptTokens` and is also
   * absent when the upstream did not report a cache figure; a `0` there would
   * claim "this turn missed the cache", which is not what was measured.
   */
  usage?: {
    promptTokens: number
    completionTokens: number
    cacheReadTokens?: number
    source: 'upstream'
  }
  /**
   * Explicit per-request trace: capture bodies even when global body logging is
   * off. Set by the `X-ModelPort-Trace: 1` header; persisted so stream-end
   * updates keep using the same decision.
   */
  captureBodies?: boolean

  /**
   * Decision record for a request that asked for a route (`auto` and any route the
   * user created). Absent for every other request; candidates are ranked display
   * names, capped.
   */
  auto?: {
    prefer: AutoPreference
    reason: 'only' | 'sticky' | 'cache-affinity' | 'score'
    attempts: number
    candidates: string[]
    /**
     * 这条路由本次给出的**整条候选链**有多长（`candidates` 只列前面几个）。
     * 没有这一格，日志里的 10 个名字会被读成「池子就这么大」—— 而池子现在
     * 是整池展开的，可能是几百个模型。老行没有它，界面上显示为未知而不是 0。
     */
    chainLength?: number
    /**
     * 前置剔除的候选（`provider/model:原因`）最前面几条。
     *
     * 「为什么没走某家」的两种答案分别落在 `chainLength`（它压根没进链）与这里（它进了
     * 但被额度/限流/工具数闸门筛掉）。整渠道限流时这个清单能到几十条，所以只留前面这些，
     * 余下的条数写在 `skippedMore`。
     */
    skipped?: string[]
    /** `skipped` 之外还有几条没写进来；没有截尾时这一格不出现 */
    skippedMore?: number
    /** Contracts that could not be met but the request was routed anyway */
    degraded?: string[]
    /**
     * Which route made this decision. Written only on the way in (`chat.ts`'s
     * `autoLogRecord`); the sanitizer spreads the record verbatim, so a new
     * sub-field cannot break a persisted row, and an old row simply has none.
     */
    route?: string
    /**
     * 粘性键的来源：客户端给的会话标识（`prompt_cache_key` / `user` / `session_id`）
     * 还是内容指纹。会话中途换家的两种解释靠这一格分开 —— `content-hash` 时很可能
     * 是客户端改了历史（自动摘要改写首条用户消息），不是打分把候选换了顺序。
     */
    sessionKeySource?: 'client-session' | 'content-hash'
    /**
     * Why each skipped candidate was skipped, in attempt order. The chain logs the
     * winner only, so without this a candidate that fails every time (a dead
     * channel, a catalogue that rejects the model) is invisible: `attempts: 4` says
     * four homes were tried, nothing says what the first three answered.
     * Absent when the first candidate succeeded.
     */
    failures?: AutoAttemptFailure[]
  }

  /**
   * Context-compression record. Absent when the feature is disabled, so a log
   * row only carries this field when a decision was actually made.
   * Token figures are ESTIMATES and never the upstream-reported usage.
   */
  compression?: {
    /** Compressors that rewrote something, e.g. ['json']. */
    applied: string[]
    tokensBefore: number
    tokensAfter: number
    saved: number
    ratio: number
    /** CCR ids the model could retrieve through the management API. */
    ccrHashes?: string[]
    /** Why the request was forwarded unchanged. */
    skipped?: string
  }
  /**
   * Cross-turn duplication measurement. OBSERVATION ONLY — nothing was rewritten.
   *
   * Recorded even when compression is disabled, because its whole purpose is to
   * decide whether folding repeated content is worth building at all. All
   * character counts are raw bytes of message text, not tokens.
   */
  duplication?: {
    /** Message blocks large enough to compare. */
    blocks: number
    /** Characters examined, after the per-request caps. */
    scannedChars: number
    /** Characters that could be folded if every verbatim repeat collapsed. */
    duplicatedChars: number
    /** Number of qualifying contiguous runs. */
    runs: number
    /** Longest contiguous duplicated run, in lines. */
    longestRunLines: number
    /** True when a cap stopped the scan before the whole prompt. */
    truncated: boolean
  }
  /**
   * Which turn of its conversation this request was, as attributed by the
   * survivorship tracker (1 = the first turn we observed).
   *
   * OBSERVATION ONLY. Kept on the log so `expected_reads` — the number a
   * cross-turn deduplication budget needs and cannot know at request time — can
   * be estimated afterwards. Absent when the conversation key could not be
   * derived (no system prompt and no user message, or malformed content).
   */
  conversationTurn?: number
  /**
   * 调用方客户端（按 `User-Agent` 归类）。
   *
   * 只用于排障：同一路由下 Trae / WorkBuddy / Qoder / dsh 的失败形态不同，
   * 看日志时先知道「谁发来的」比看模型名更省事。不参与路由决策。
   * 老日志没有这个键照旧渲染。
   */
  client?: ClientIdentity
}

export interface RequestLogConfig {
  enabled: boolean
  maxEntries: number
  includeBodies: boolean
  maxBodyChars: number
  redactSensitiveData: boolean
}

/**
 * One day of a per-day aggregate. Counts are `null` when nothing recorded that
 * day can be trusted to speak for it: a `0` there would read as "that day had no
 * traffic" while the real answer is "that day is not in the retained window".
 */
export interface DailyTrendPoint {
  date: string
  total: number | null
  success: number | null
  error: number | null
  avgLatency: number | null
}

export interface AppLogTrendPoint {
  date: string
  total: number | null
  info: number | null
  warn: number | null
  error: number | null
}

export interface ManagementApiConfig {
  enableManagementApi: boolean
  managementApiSecret: string
}

export interface ManagementApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: ManagementApiError
}

export interface ManagementApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface ManagementApiPaginationParams {
  page?: number
  limit?: number
}

export interface ManagementApiPaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface CreateProviderRequest {
  name: string
  type: ProviderType
  authType: AuthType
  apiEndpoint: string
  chatPath?: string
  headers?: Record<string, string>
  enabled?: boolean
  description?: string
  icon?: string
  supportedModels?: string[]
  modelMappings?: Record<string, string>
}

export interface UpdateProviderRequest {
  name?: string
  apiEndpoint?: string
  chatPath?: string
  headers?: Record<string, string>
  enabled?: boolean
  description?: string
  icon?: string
  supportedModels?: string[]
  modelMappings?: Record<string, string>
}

export interface ProviderStatusRequest {
  enabled: boolean
}

export interface CreateAccountRequest {
  providerId: string
  name: string
  email?: string
  credentials: Record<string, string>
  dailyLimit?: number
}

export interface UpdateAccountRequest {
  name?: string
  email?: string
  credentials?: Record<string, string>
  dailyLimit?: number
}

export interface CreateApiKeyRequest {
  name: string
  description?: string
}

export interface UpdateApiKeyRequest {
  name?: string
  description?: string
  enabled?: boolean
}

export interface CreateModelMappingRequest {
  requestModel: string
  actualModel: string
  preferredProviderId?: string
  preferredAccountId?: string
  disabled?: boolean
}

export interface UpdateModelMappingRequest {
  actualModel?: string
  preferredProviderId?: string
  preferredAccountId?: string
  /** PATCH 语义：省略即沿用现值，不是「清掉停用」。 */
  disabled?: boolean
}

export interface ProxyStatusResponse {
  isRunning: boolean
  port: number
  host: string
  uptime: number
  connections: number
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded'
  version: string
  uptime: number
  timestamp: number
  components?: {
    proxy: 'up' | 'down'
    database: 'up' | 'down'
    managementApi: 'up' | 'down'
  }
}

export interface StatisticsResponse {
  totalRequests: number
  successRequests: number
  failedRequests: number
  avgLatency: number
  requestsPerMinute: number
  activeConnections: number
  modelUsage: Record<string, number>
  providerUsage: Record<string, number>
  accountUsage: Record<string, number>
  dailyStats?: Record<string, {
    totalRequests: number
    successRequests: number
    failedRequests: number
  }>
}

export interface ConfigUpdateRequest {
  proxyPort?: number
  proxyHost?: string
  httpsEnabled?: boolean
  httpsPort?: number
  httpsCertPath?: string
  httpsKeyPath?: string
  httpsSanHosts?: string[]
  loadBalanceStrategy?: LoadBalanceStrategy
  theme?: Theme
  autoStart?: boolean
  autoStartProxy?: boolean
  minimizeToTray?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  logRetentionDays?: number
  requestLogConfig?: Partial<RequestLogConfig>
  requestTimeout?: number
  retryCount?: number
  enableApiKey?: boolean
  oauthProxyMode?: 'system' | 'none'
  managementApi?: ManagementApiConfig
  autoRouting?: Partial<AutoRoutingConfig>
  /** Route table written as a whole through `PUT /v1/management/config/routes`. */
  routes?: Record<string, ModelRoute>
}

export interface EffectiveModel {
  displayName: string
  actualModelId: string
  isCustom: boolean
  /** Where this entry came from, so the UI can label it truthfully */
  source: 'builtin' | 'fetched' | 'custom'
}

/**
 * One catalogue row, served or not. The model management page lists the whole
 * catalogue so a stopped model can be started again from the same place.
 */
export interface CatalogueModel extends EffectiveModel {
  /**
   * false = stopped: not in any route's candidate pool and not routable by name,
   * but still listed so it can be started again. `/v1/models` never advertised
   * individual models, so this says nothing about what a client can list.
   */
  served: boolean
}

/** How an upstream payload is read into display-name / actual-id pairs */
export type ModelsFetchReader =
  | 'openai-list'
  /** OpenAI-shaped `data[]` where only entries with `isFree: true` are kept (Kilo pool) */
  | 'openai-free-list'
  | 'auto'

/** Where one credential field goes when calling a provider's model list */
export interface ModelsFetchAuthRule {
  /** Key in account.credentials */
  from: string
  into: 'header' | 'cookie'
  /** Header name, for into = header */
  header?: string
  /** Prefix placed before the value inside the header, e.g. "Bearer " */
  prefix?: string
  /** Cookie name, for into = cookie */
  cookie?: string
}

/**
 * Declarative description of a provider's online model list source.
 * Lives in shared/types because the fetch outcome crosses the IPC boundary.
 */
export interface ModelsFetchConfig {
  url: string
  method?: 'GET' | 'POST'
  /** JSON body, for the gateways that need POST with an empty object */
  body?: Record<string, unknown>
  /** Payload reader; 'auto' tries every known reader and fails loudly when none match */
  reader?: ModelsFetchReader
  /**
   * How the active account's credentials reach this request. Declaring any rule means
   * an active account is required; an empty list means the endpoint answers anonymously.
   */
  auth?: ModelsFetchAuthRule[]
  /** Headers merged over the provider's own headers for this request */
  headers?: Record<string, string>
}

export interface FetchedModel {
  displayName: string
  actualModelId: string
}

export type ModelsFetchFailure =
  | 'unsupported'
  | 'no_active_account'
  | 'missing_credential_field'
  | 'http_status'
  | 'empty'
  | 'unrecognized_shape'
  | 'network_error'
  /** Aggregate sync: every stored key was rejected by the list endpoint. */
  | 'invalid_api_key'

export type ModelsFetchResult =
  | { ok: true; models: FetchedModel[]; detail?: string }
  | { ok: false; reason: ModelsFetchFailure; detail?: string }
