/**
 * Types for the aggregated provider catalogue.
 *
 * The catalogue holds only standard, key-based (or key-less) HTTP endpoints.
 * Browser-login account channels and the responses-only relays are not listed:
 * their availability depends on other people's accounts or on a gate this app
 * cannot satisfy, which is exactly the class of integration that was retired.
 */

import type { AggregateCostSignal } from './aggregateCost.ts'
import type { AggregateCreditSnapshot } from './aggregateCredit.ts'
import type {
  AggregateQuotaExhaustionRecord,
  AggregateQuotaExhaustionSummary,
} from './aggregateQuotaExhaustion.ts'
import type { PromptCacheCapability } from './promptCache.ts'

export type AggregateCategory = 'apikey' | 'free-tier' | 'local'

/**
 * Wire protocol of an aggregate endpoint.
 *
 * - `openai-chat` - POST `<baseUrl>/chat/completions`
 * - `anthropic-messages` - POST `<baseUrl>/messages`, translated by `adapters/anthropic.ts`
 * - `openai-responses` - POST `<baseUrl>/responses`, translated **出向** by
 *   `shared/responsesWire.ts`: the app still speaks chat internally, and this wire
 *   exists for endpoints that only expose the Responses API.
 *
 * `openai-responses` names the **outbound** half only. The inbound client entry
 * (`POST /v1/responses`, translated by `shared/responsesInbound.ts` into the chat
 * shape) is a different surface: a wire is a provider's protocol, not a client
 * endpoint, and the two never call each other.
 */
export type AggregateWire = 'openai-chat' | 'anthropic-messages' | 'openai-responses'

/**
 * How an endpoint is authenticated.
 * - apiKey: the user supplies a key, sent in the provider's auth header
 * - none: anonymous (local runtimes, free pools)
 * - unsupported: auth cannot be produced here (ADC / OAuth); the row is visible
 *   so the list is faithful, but it cannot be saved
 */
export type AggregateAuthKind = 'apiKey' | 'none' | 'unsupported'

export interface AggregateModelEntry {
  id: string
  name: string
}

/**
 * 这个条目有没有一个「能问出账号级额度」的上游端点。
 *
 * 目录事实，和 `modelsUrl` 同类：它回答的是"上游有这么一个接口"，不是"我们算得出余额"。
 * 声明进目录而不是进 `aggregateQuota.ts`，因为那份是脚本从取证回执生成的产物（明令不得手改），
 * 把一个 URL 掺进数值生成器里会让两边都对不上账。
 *
 * 路径是**相对**的：抓取时以用户记录里的 `apiEndpoint` 为基址拼接，所以聊天流量去哪个 host、
 * 额度查询就去哪个 host，用户改了 baseUrl 时两件事不会分家。
 */
export interface AggregateQuotaProbe {
  /** 相对条目 baseUrl 的路径，以 `/` 开头，如 `/key` */
  path: string
  /** 用哪个解析器读这份报文；只有目录里真实存在过的两种 */
  reader: 'openrouter-key' | 'siliconflow-user-info'
  /** 这个端点是从哪份官方文档记下的 */
  docUrl: string
  /** 核对日期 */
  asOf: string
}

/**
 * 端点路径里的账号级占位符。
 *
 * 有些上游把账号写进 URL 本身（Cloudflare Workers AI 的
 * `.../accounts/{account_id}/ai/v1`，Vertex 的 `{project_id}/{location}`），
 * 目录没法凭空填。声明成 `pathVars` 之后，值随**每把 Key**存在
 * `account.credentials[<name>]`，请求时展开 —— 换账号换 Key 时地址自然跟着换。
 */
export interface AggregatePathVar {
  /** 与 baseUrl 里的 `{name}` 同名，也是 credentials 里的键 */
  name: string
  label: string
  helpText?: string
}

export interface AggregateEntry {
  id: string
  name: string
  category: AggregateCategory
  authKind: AggregateAuthKind
  /** Where the user obtains the key */
  authUrl?: string
  /** Environment variable the upstream registry uses for the key */
  envVar?: string
  /** Default endpoint; null means the user has to supply one */
  baseUrl: string | null
  /** `{name}` placeholders this baseUrl needs; each value is stored per account. */
  pathVars?: readonly AggregatePathVar[]
  /** Documents which baseUrl variable the user may override */
  baseUrlOverrideEnv?: string
  wire: AggregateWire
  models: AggregateModelEntry[]
  /** Endpoint that lists models; absent means discovery is unavailable */
  modelsUrl?: string
  /**
   * 账号级实时额度的查询端点；缺席 = 这家问不到，界面上的按钮也不会出现。
   * 目录里目前只有两家真实存在（`open_router` / `siliconflow`）。
   */
  quotaProbe?: AggregateQuotaProbe
  headers?: Record<string, string>
  notes?: string
  website?: string
  /** Ids the upstream project marks as free on a shared pool */
  freeModelsHint?: string[]
  /**
   * 免验证条目的自动开通标记。为 true 且 authKind 为 'none' 的条目在启动期
   * 自动创建聚合记录并启用（免 key 本就无凭据可填），随后并入上游模型清单；
   * 用户在界面上删过的条目记入 `dismissedAutoProviders`，不再复活。
   */
  autoProvision?: boolean
  /**
   * 请求体字段剥离规则，供 schema 比 OpenAI 更严的上游使用。
   *
   * 形态只有三种：
   * - `key`：删除该顶层字段；
   * - `key=value`：仅当该字段的值相等时删除（如 `tool_choice=auto`，auto 是默认值，删掉不改变语义）；
   * - `tools[].function.strict`：删除每个 tool 的 `function.strict`（它不是顶层字段）。
   *
   * 规则在转发前、每模型参数合并之后执行，因此用户覆盖也挡不住剥离 ——
   * 被剥离的字段对上游就是非法字段，留着只会换回一个 400。
   */
  dropParams?: readonly string[]
  /**
   * Prompt-cache behaviour, only where the vendor documents it. Absent means
   * `unknown` — the gateway will not place markers, synthesise a cache key, or
   * apply a cache-first compression policy for this entry.
   */
  promptCache?: PromptCacheCapability
}

/** Per-entry state merged from the stored provider record, for the catalogue UI. */
export interface AggregateEntryState {
  configured: boolean
  enabled: boolean
  hasApiKey: boolean
  /** Number of stored keyed accounts; more than one means requests rotate over them. */
  apiKeyCount: number
  baseUrl: string | null
  modelCount: number
  /**
   * Upstream model ids the record currently exposes. The config dialog seeds
   * its list from this, so a dialog save never reverts a synced list back to
   * the shipped catalogue.
   */
  modelIds?: string[]
  /** Per-model request parameter overrides keyed by upstream model id. */
  modelParameters?: Record<string, AggregateModelParams>
}

/** 一把已存 Key 的展示信息；密钥本身只以掩码出现。 */
export interface AggregateKeyInfo {
  id: string
  name: string
  /** `sk-ab••••wxyz` 形式的预览，永远不是完整密钥 */
  maskedKey: string
  status: 'active' | 'inactive' | 'expired' | 'error'
  createdAt: number
  lastUsed?: number
  errorMessage?: string
  /**
   * 这把 Key 携带的端点路径变量（Cloudflare 的 Account ID）。它们决定请求发去
   * 谁的账号，所以在 Key 行上如实显示：只有占位符、看不到值的界面没法让人核对。
   */
  pathVars?: Record<string, string>
}

/**
 * 聚合条目的一条模型目录行（按上游模型 id 索引，也是每模型参数的键）。
 *
 * `cost` 是这一行的消耗分类（免费 / 套餐内 / 按量 / 未知）。它由
 * `shared/aggregateCost.ts` 按三种证据算出，**界面不得自己从价格判**：
 * 订阅端点上的零价是"含在套餐里"，不是免费。
 */
export interface AggregateModelInfo {
  /** 上游模型 id，也是每模型参数的键 */
  id: string
  /** 对外暴露的名字，`<entryId>/<id>` */
  displayName: string
  served: boolean
  source: 'builtin' | 'fetched' | 'custom'
  params?: AggregateModelParams
  cost: AggregateCostSignal
}

/** 详情面板所需的全部数据：条目状态、Key、模型目录、本应用计量，与上一次实时额度快照。 */
export interface AggregateDetail {
  entryId: string
  state: AggregateEntryState
  keys: AggregateKeyInfo[]
  models: AggregateModelInfo[]
  quotaUsage?: AggregateQuotaUsage
  /**
   * 用户手点出来的那一次余额读数（可能已经过期，过期时界面标出来）。
   * 它与五态徽章无关，也绝不参与 `quotaViewOf` 的判定。
   */
  credit?: AggregateCreditSnapshot
  /**
   * 「上游亲口说没额度」的现场记录，逐 `(账号, 模型)` 一行，已剔除过期行。
   * 与 `credit` 并列不合并：那条是钱的余额，这条是一次真实调用被拒的证词。
   */
  quotaExhaustions?: AggregateQuotaExhaustionRecord[]
}

/** Key / 模型变更的结果；`detail` 是变更后重新读取的面板数据。 */
export interface AggregateMutationResult {
  success: boolean
  reason?: string
  message?: string
  detail?: AggregateDetail
}

/** 单模型真实请求测试的结果。 */
export interface AggregateModelTestResult {
  success: boolean
  latencyMs?: number
  detail?: string
  reason?: string
}

/** 本应用账本计量（不是上游账单）里的一家用量，按窗口。 */
export interface AggregateQuotaUsage {
  rpm: number
  rpd: number
  tpm: number
  tpd: number
  monthlyTokens: number
}

export interface AggregateListResult {
  entries: AggregateEntry[]
  states: Record<string, AggregateEntryState>
  /**
   * 各家的本应用用量。同一聚合条目可以配多把 Key（按账号轮询），出现多把时取用量最高的那把，
   * 因此它回答的是"至少有一把 Key 到了这个数"，不是"所有 Key 合计"。
   */
  quotaUsage?: Record<string, AggregateQuotaUsage>
  /**
   * 各家的「上游说没额度」折叠（条数 + 最近一条），只含还活着的记录。
   * 与 `quotaUsage` 并列不合并：那个是我们自己数的量，这个是上游亲口拒的原话。
   */
  quotaExhaustions?: Record<string, AggregateQuotaExhaustionSummary>
}

/**
 * 用户为某个模型配置的请求参数覆盖，按上游模型 id 索引。
 * 这些值在转发前并入上游请求体，并覆盖客户端传来的同名字段。
 */
export type AggregateModelParams = Record<string, unknown>

/**
 * 每模型参数不允许覆盖的请求骨架字段：改写它们会把请求本身改坏
 * （model 由映射决定、messages 是对话本体、stream 决定响应形状）。
 */
export const AGGREGATE_RESERVED_PARAM_KEYS: readonly string[] = ['model', 'messages', 'stream']

/**
 * 归一化每模型参数：丢弃保留字段与空值，空的模型条目整条去掉；
 * 给出 `allowedModelIds` 时只保留其中的模型（模型清单变化后清掉孤儿参数）。
 */
export function normalizeAggregateModelParams(
  input: Record<string, AggregateModelParams> | undefined,
  allowedModelIds?: ReadonlySet<string>
): Record<string, AggregateModelParams> {
  const result: Record<string, AggregateModelParams> = {}
  for (const [modelId, rawParams] of Object.entries(input ?? {})) {
    if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) continue
    if (allowedModelIds && !allowedModelIds.has(modelId)) continue
    const params: AggregateModelParams = {}
    for (const [key, value] of Object.entries(rawParams)) {
      if (AGGREGATE_RESERVED_PARAM_KEYS.includes(key)) continue
      if (value === null || value === undefined || value === '') continue
      params[key] = value
    }
    if (Object.keys(params).length > 0) result[modelId] = params
  }
  return result
}

/**
 * 归一化一次保存携带的 Key 列表：去空白、去重、丢空行。
 * 两个字段都没给时返回 undefined（= 沿用已存的 Key，不做任何改动）。
 */
export function normalizeAggregateKeys(
  input: { apiKeys?: string[]; apiKey?: string } | undefined
): string[] | undefined {
  if (!input || (input.apiKeys === undefined && !input.apiKey)) return undefined
  const seen = new Set<string>()
  const keys: string[] = []
  for (const value of [...(input.apiKeys ?? []), ...(input.apiKey ? [input.apiKey] : [])]) {
    const key = (value ?? '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

export interface AggregateSaveInput {
  id: string
  /** New keys; each line becomes one rotating account. Omitted keeps the stored ones. */
  apiKeys?: string[]
  /** Legacy single-key field, merged into `apiKeys` when both are given */
  apiKey?: string
  /** Overrides the registry baseUrl (required when the registry has none or a placeholder) */
  baseUrl?: string
  /**
   * 端点模板里 `{name}` 的值，随这批 Key 一起落库到 `account.credentials[name]`。
   * 只为 `pathVars` 声明的条目使用；有 Key 却没给全时整个保存被拒。
   */
  pathVars?: Record<string, string>
  /** Overrides which registry model ids are exposed, as raw upstream ids */
  models?: string[]
  enabled?: boolean
  /**
   * Per-model request parameter overrides keyed by upstream model id. Provided
   * (even empty) replaces the stored map, pruned to the models being saved;
   * omitted keeps the stored one.
   */
  modelParams?: Record<string, AggregateModelParams>
}

/**
 * 在线同步的模型清单对账：当前清单保持自己的顺序，上游新报告的 id 追加在后面，
 * 全程去空白、去重。
 *
 * `removeMissing: true` 是**上游自己答了清单**时的真同步：当前清单里上游没再报告的
 * id 被移除（下架/改名留下的作废项），上游新报的照常追加。顺序仍以现有清单为准，
 * 一次同步不打乱用户看到的排列。
 *
 * 默认只增不减是给第三方目录（models.dev）用的：它只能证明"上游还有哪些"，
 * 证明不了"哪些已下架"，拿它删模型等于按别人的滞后快照猜上游。
 */
export function mergeAggregateModelIds(
  currentIds: readonly string[],
  fetchedIds: readonly string[],
  options: { removeMissing?: boolean } = {}
): string[] {
  const fetched: string[] = []
  const fetchedSet = new Set<string>()
  for (const value of fetchedIds) {
    const id = (value ?? '').trim()
    if (!id || fetchedSet.has(id)) continue
    fetchedSet.add(id)
    fetched.push(id)
  }

  const merged: string[] = []
  const seen = new Set<string>()
  for (const value of currentIds) {
    const id = (value ?? '').trim()
    if (!id || seen.has(id)) continue
    if (options.removeMissing === true && !fetchedSet.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  for (const id of fetched) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  return merged
}

export interface AggregateOperationResult {
  success: boolean
  reason?: string
  detail?: string
  /** Models the provider record exposes after the operation. */
  modelCount?: number
  /** Models the upstream list endpoint answered (sync only). */
  fetchedCount?: number
  /** Models newly added by this sync (sync only). */
  addedCount?: number
  /**
   * Models removed by this sync because the **upstream's own** list no longer
   * reports them (sync only). The models.dev fallback never removes: a missing
   * row in a third-party catalogue is not evidence that the upstream dropped it.
   */
  removedCount?: number
  /**
   * Where the synced list came from (sync only): the vendor's own list endpoint,
   * or the models.dev catalogue used as a fallback. The panel says which one,
   * so "上游没答" never looks like a successful upstream sync.
   */
  modelSource?: 'upstream' | 'models.dev'
}

const AGGREGATE_PATH_VAR = /\{([a-zA-Z0-9_]+)\}/g

/** 端点地址里出现的占位符名（去重，按出现顺序）。 */
export function aggregatePathVarNames(baseUrl: string | null | undefined): string[] {
  if (!baseUrl) return []
  const names: string[] = []
  for (const match of baseUrl.matchAll(AGGREGATE_PATH_VAR)) {
    if (!names.includes(match[1])) names.push(match[1])
  }
  return names
}

/** 按记录里的凭据展开端点地址；没有值的占位符原样保留，由调用方判定缺失。 */
export function expandAggregatePathVars(
  baseUrl: string,
  values: Record<string, string | undefined>
): string {
  return baseUrl.replace(AGGREGATE_PATH_VAR, (whole, name: string) => {
    const value = (values[name] ?? '').trim()
    return value ? encodeURIComponent(value) : whole
  })
}

/** 展开之后仍然缺值的占位符名；空数组 = 地址可以直接发出去。 */
export function missingAggregatePathVars(
  baseUrl: string,
  values: Record<string, string | undefined>
): string[] {
  return aggregatePathVarNames(baseUrl).filter(name => !(values[name] ?? '').trim())
}
