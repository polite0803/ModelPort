/**
 * 第三方「标准模型库」层（设计见 docs/design/2026-11-04-model-metadata-resolution.md §9）。
 *
 * 这一层只做纯函数：快照校验、三档匹配、adoption ledger 的增删与折算。
 * 网络抓取与磁盘读写在主进程（`main/providers/modelCatalogService.ts`），
 * 单测因此不需要任何真实请求。
 *
 * 硬口径：
 * - 快照是**第三方数据**，采用后来源固定为 `catalog`，置信度 `inferred`，
 *   与供应商声明（`upstream`）区分开；`/v1/models` 不广告它。
 * - 价格只作展示参考，`catalogAdoptionHint` **永远不**搬 `price`：
 *   USD / CNY / 本应用 token 账本三个计数域不可互换，价格不得折成权重。
 * - 采用记录存 adoption ledger，绝不写 `userModelMarks`（那是人工标注，优先级更高）。
 */
import type { CapabilityState, InputModality, ModelCapabilityHint } from './types.ts'
import {
  ROUTING_METADATA_ATTRIBUTES,
  type MetadataAttribute,
} from './modelMetadata.ts'

export const CATALOG_SOURCES = ['models.dev', 'litellm', 'openrouter'] as const
export type CatalogSourceId = (typeof CATALOG_SOURCES)[number]

/** 每个来源的许可与归属。刷新与界面都从这里取，避免两处各写一份。 */
export const CATALOG_SOURCE_META: Record<CatalogSourceId, {
  label: string
  homepage: string
  sourceUrl: string
  license: string
  attribution: string
}> = {
  'models.dev': {
    label: 'models.dev',
    homepage: 'https://models.dev',
    sourceUrl: 'https://models.dev/api.json',
    license: 'MIT',
    attribution: 'models.dev contributors',
  },
  litellm: {
    label: 'LiteLLM',
    homepage: 'https://github.com/BerriAI/litellm',
    sourceUrl:
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    license: 'MIT',
    attribution: 'BerriAI / LiteLLM',
  },
  openrouter: {
    label: 'OpenRouter',
    homepage: 'https://openrouter.ai',
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    license: 'OpenRouter API Terms',
    attribution: 'OpenRouter',
  },
}

/** 快照里可被采用的字段；`price` 只展示，不进入能力标注。 */
export const CATALOG_ADOPTION_FIELDS = [
  'contextTokens',
  'maxOutputTokens',
  'price',
  'modalities',
  'vision',
  'tools',
  'reasoning',
] as const
export type CatalogAdoptionField = (typeof CATALOG_ADOPTION_FIELDS)[number]

/** 价格统一以 USD / 1M tokens 展示；来源换算只在解析时做一次。 */
export interface CatalogPrice {
  inputPerMillion?: number
  outputPerMillion?: number
  currency: 'USD'
}

export interface CatalogEntry {
  /** 全局唯一：`${source}:${provider ?? ''}:${id}` */
  catalogId: string
  id: string
  provider?: string
  contextTokens?: number
  maxOutputTokens?: number
  modalities?: InputModality[]
  vision?: Exclude<CapabilityState, 'unknown'>
  tools?: Exclude<CapabilityState, 'unknown'>
  /**
   * 是否为推理（thinking）模型。models.dev 的 `reasoning` 是 schema 里的显式布尔，
   * `false` 是**声明**而不是「没填」，所以这一项和 `vision`/`tools` 同口径收 yes/no 两值；
   * openrouter 只在 `supported_parameters` 列出 `reasoning` 时写 `yes`（缺席不等于不支持）。
   */
  reasoning?: Exclude<CapabilityState, 'unknown'>
  price?: CatalogPrice
  source: CatalogSourceId
}

export interface CatalogSnapshot {
  source: CatalogSourceId
  sourceUrl: string
  /** ISO-8601，抓取成功时刻 */
  fetchedAt: string
  /** 原始响应体的 sha256，用于证据 id 与「这份数据变了吗」 */
  contentHash: string
  license: string
  attribution: string
  entries: CatalogEntry[]
}

export interface CatalogStore {
  version: 1
  snapshots: Partial<Record<CatalogSourceId, CatalogSnapshot>>
}

/** 给界面看的快照元数据；不含 entries，避免把整份台账塞进一次 IPC。 */
export interface CatalogSnapshotStatus {
  source: CatalogSourceId
  sourceUrl: string
  fetchedAt: string
  contentHash: string
  license: string
  attribution: string
  entryCount: number
  /** true = 用户从未成功刷新过，当前读的是随应用发布的内置快照。 */
  builtin?: boolean
}

export const EMPTY_CATALOG_STORE: CatalogStore = { version: 1, snapshots: {} }

/** 候选查询结果：元数据 + 三档候选 + 该模型已采用的字段。 */
export interface CatalogCandidatesResult {
  statuses: CatalogSnapshotStatus[]
  matches: CatalogMatch[]
  adoptions: CatalogAdoption[]
}

/** 刷新失败的分类：界面据此给出「网络不可达 / 超时 / HTTP / 解析 / 空响应」的人读提示。 */
export type CatalogRefreshErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'parse'
  | 'empty'
  | 'unknown'

/** 端点角色：主端点 / 公开 CDN 备用 / 用户自配镜像。 */
export type CatalogEndpointLabel = 'primary' | 'jsdelivr' | 'mirror'

/** 一次刷新里每个端点的实测结果；成功即停，失败继续下一个。 */
export interface CatalogRefreshEndpointAttempt {
  url: string
  label: CatalogEndpointLabel
  /** 拿到 HTTP 响应时的状态码；网络层失败没有该字段。 */
  status?: number
  errorKind?: CatalogRefreshErrorKind
  error?: string
  elapsedMs: number
  bytes?: number
}

/** 刷新结果：失败时 `statuses` 仍是磁盘上的旧快照。 */
export interface CatalogRefreshResult {
  success: boolean
  status?: CatalogSnapshotStatus
  statuses: CatalogSnapshotStatus[]
  /** 逐端点诊断：全部失败时界面据此说明是「全都不可达」还是某个端点挂了。 */
  attempts?: CatalogRefreshEndpointAttempt[]
  /** 本次实际成功的端点 URL。 */
  usedEndpoint?: string
  error?: string
  errorKind?: CatalogRefreshErrorKind
  /** 本次抓取耗时（毫秒）；失败时也返回，便于诊断是不是超时。 */
  elapsedMs?: number
}

/**
 * 公开只读备用端点。只收录与主端点内容完全相同的数据分发通道，
 * 不在代码里硬编码第三方镜像站；用户自己的镜像走 `catalogMirrorUrl`。
 */
export const CATALOG_ENDPOINT_FALLBACKS: Partial<
  Record<CatalogSourceId, readonly { label: CatalogEndpointLabel; url: string }[]>
> = {
  litellm: [
    {
      label: 'jsdelivr',
      url: 'https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json',
    },
  ],
}

/**
 * 自定义镜像地址校验：只接受 https；空字符串表示「不使用镜像」（合法）。
 * 非法输入返回 undefined，由调用方拒绝保存。
 */
export function sanitizeCatalogMirrorUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (value.length === 0) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** 端点尝试顺序：主端点 → 公开备用 → 用户镜像（若已配置）。 */
export function catalogEndpointPlan(
  source: CatalogSourceId,
  mirrorUrl?: string,
): { label: CatalogEndpointLabel; url: string }[] {
  const plan: { label: CatalogEndpointLabel; url: string }[] = [
    { label: 'primary', url: CATALOG_SOURCE_META[source].sourceUrl },
    ...(CATALOG_ENDPOINT_FALLBACKS[source] ?? []).map((entry) => ({ ...entry })),
  ]
  const mirror = sanitizeCatalogMirrorUrl(mirrorUrl)
  if (mirror) plan.push({ label: 'mirror', url: mirror })
  return plan
}

const MAX_CONTEXT_TOKENS = 100_000_000
const MAX_OUTPUT_TOKENS = 1_000_000
const MAX_PRICE_PER_MILLION = 10_000_000
const INPUT_MODALITIES: readonly InputModality[] = ['text', 'image', 'audio', 'video', 'pdf']

export type CatalogMatchConfidence = 'exact' | 'alias' | 'family' | 'fuzzy'

export interface CatalogMatch {
  entry: CatalogEntry
  confidence: CatalogMatchConfidence
}

export interface CatalogIndex {
  entries: CatalogEntry[]
  exact: Map<string, CatalogEntry[]>
  alias: Map<string, CatalogEntry[]>
  family: Map<string, CatalogEntry[]>
}

/** 采用的单字段。`value` 在写入前由 {@link sanitizeCatalogAdoptionValue} 校验。 */
export interface CatalogAdoption {
  providerId: string
  displayName: string
  catalogId: string
  field: CatalogAdoptionField
  value: unknown
  source: CatalogSourceId
  /** 快照 contentHash + 条目 id，便于追溯「用的是哪一份数据」 */
  evidenceId: string
  adoptedAt: string
}

export type CatalogAdoptionValue = number | InputModality[] | Exclude<CapabilityState, 'unknown'> | CatalogPrice

/** 正整数校验：外部数据一律走这里，取整后仍非法就丢弃。 */
function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (!Number.isInteger(value) || value <= 0) return undefined
  return value
}

function money(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  if (value > MAX_PRICE_PER_MILLION) return undefined
  return value
}

export function sanitizeCatalogPrice(value: unknown): CatalogPrice | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const inputPerMillion = money(raw.inputPerMillion)
  const outputPerMillion = money(raw.outputPerMillion)
  if (inputPerMillion === undefined && outputPerMillion === undefined) return undefined
  return {
    ...(inputPerMillion === undefined ? {} : { inputPerMillion }),
    ...(outputPerMillion === undefined ? {} : { outputPerMillion }),
    currency: 'USD',
  }
}

function sanitizeModalities(value: unknown): InputModality[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<InputModality>()
  for (const item of value) {
    if (typeof item === 'string' && (INPUT_MODALITIES as readonly string[]).includes(item)) {
      seen.add(item as InputModality)
    }
  }
  return seen.size === 0 ? undefined : [...seen]
}

/**
 * 布尔与 `'yes'/'no'` 两种写法都接受：解析器先折成字符串，adoption ledger 里存的
 * 也是字符串，校验不能只认原始布尔。
 */
function capabilityFlag(value: unknown): 'yes' | 'no' | undefined {
  if (value === true || value === 'yes') return 'yes'
  if (value === false || value === 'no') return 'no'
  return undefined
}

function catalogIdOf(source: CatalogSourceId, provider: string | undefined, id: string): string {
  return `${source}:${provider ?? ''}:${id}`
}

/**
 * 单条目录项校验。外部字段可能缺失、类型不对或数量级离谱；任何一项不合法就整项
 * 不进入快照 —— 宁可少一条候选，也不让脏数据变成「官方值」。
 */
export function sanitizeCatalogEntry(
  raw: unknown,
  source: CatalogSourceId,
): CatalogEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (id.length === 0) return undefined
  const provider = typeof value.provider === 'string' ? value.provider.trim() : undefined
  const contextTokens = positiveInt(value.contextTokens)
  const maxOutputTokens = positiveInt(value.maxOutputTokens)
  const modalities = sanitizeModalities(value.modalities)
  const vision = capabilityFlag(value.vision)
  const tools = capabilityFlag(value.tools)
  const reasoning = capabilityFlag(value.reasoning)
  const price = sanitizeCatalogPrice(value.price)

  const entry: CatalogEntry = {
    catalogId: catalogIdOf(source, provider, id),
    id,
    source,
  }
  if (provider !== undefined && provider.length > 0) entry.provider = provider
  if (contextTokens !== undefined && contextTokens <= MAX_CONTEXT_TOKENS) {
    entry.contextTokens = contextTokens
  }
  if (maxOutputTokens !== undefined && maxOutputTokens <= MAX_OUTPUT_TOKENS) {
    entry.maxOutputTokens = maxOutputTokens
  }
  if (modalities !== undefined) entry.modalities = modalities
  if (vision !== undefined) entry.vision = vision
  if (tools !== undefined) entry.tools = tools
  if (reasoning !== undefined) entry.reasoning = reasoning
  if (price !== undefined) entry.price = price

  // 一个字段都没有的条目没有采用价值，直接丢掉（它只会让匹配列表变长）。
  if (
    entry.contextTokens === undefined &&
    entry.maxOutputTokens === undefined &&
    entry.modalities === undefined &&
    entry.vision === undefined &&
    entry.tools === undefined &&
    entry.reasoning === undefined &&
    entry.price === undefined
  ) {
    return undefined
  }
  return entry
}

/** 快照校验：元数据字段缺一个就视为损坏，返回 undefined（调用方降级为空）。 */
export function sanitizeCatalogSnapshot(raw: unknown): CatalogSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.source !== 'string') return undefined
  if (!(CATALOG_SOURCES as readonly string[]).includes(value.source)) return undefined
  const source = value.source as CatalogSourceId
  const sourceUrl = typeof value.sourceUrl === 'string' ? value.sourceUrl.trim() : ''
  const fetchedAt = typeof value.fetchedAt === 'string' ? value.fetchedAt.trim() : ''
  const contentHash = typeof value.contentHash === 'string' ? value.contentHash.trim() : ''
  const license = typeof value.license === 'string' ? value.license.trim() : ''
  const attribution = typeof value.attribution === 'string' ? value.attribution.trim() : ''
  if (
    sourceUrl.length === 0 ||
    fetchedAt.length === 0 ||
    contentHash.length === 0 ||
    license.length === 0 ||
    attribution.length === 0
  ) {
    return undefined
  }
  if (Number.isNaN(Date.parse(fetchedAt))) return undefined
  if (!Array.isArray(value.entries)) return undefined

  const entries: CatalogEntry[] = []
  for (const item of value.entries) {
    const entry = sanitizeCatalogEntry(item, source)
    if (entry !== undefined) entries.push(entry)
  }
  return { source, sourceUrl, fetchedAt, contentHash, license, attribution, entries }
}

/** 整个 sidecar 的校验。文件缺失/损坏都退化成空台账，界面据此提示「尚未抓取」。 */
export function sanitizeCatalogStore(raw: unknown): CatalogStore {
  if (!raw || typeof raw !== 'object') return EMPTY_CATALOG_STORE
  const value = raw as Record<string, unknown>
  if (value.version !== 1) return EMPTY_CATALOG_STORE
  if (!value.snapshots || typeof value.snapshots !== 'object') return EMPTY_CATALOG_STORE
  const snapshots: Partial<Record<CatalogSourceId, CatalogSnapshot>> = {}
  for (const source of CATALOG_SOURCES) {
    const snapshot = sanitizeCatalogSnapshot(
      (value.snapshots as Record<string, unknown>)[source],
    )
    if (snapshot !== undefined) snapshots[source] = snapshot
  }
  return { version: 1, snapshots }
}

export function catalogSnapshotStatuses(store: CatalogStore): CatalogSnapshotStatus[] {
  return CATALOG_SOURCES.flatMap((source) => {
    const snapshot = store.snapshots[source]
    if (!snapshot) return []
    return [
      {
        source,
        sourceUrl: snapshot.sourceUrl,
        fetchedAt: snapshot.fetchedAt,
        contentHash: snapshot.contentHash,
        license: snapshot.license,
        attribution: snapshot.attribution,
        entryCount: snapshot.entries.length,
      },
    ]
  })
}

/**
 * 别名归一：去 provider 前缀、去日期后缀、去 `-latest`，大小写与连字符统一。
 * 这是三档匹配里的第二档；第一档是原文 id 完全相同。
 */
export function normalizeCatalogAlias(id: string): string {
  let key = id.trim().toLowerCase()
  const slash = key.lastIndexOf('/')
  if (slash >= 0) key = key.slice(slash + 1)
  key = key.replace(/-[0-9]{4}-[0-9]{2}-[0-9]{2}$/, '')
    key = key.replace(/-[0-9]{8}$/, '')
    key = key.replace(/-latest$/, '')
    key = key.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    return key
}

/** 家族键：别名键的第一段（`claude-sonnet-4` → `claude`）。只在第三档用。 */
export function catalogFamilyKey(id: string): string {
  const alias = normalizeCatalogAlias(id)
  const [head] = alias.split('-')
  return head.length >= 3 ? head : ''
}

function push(map: Map<string, CatalogEntry[]>, key: string, entry: CatalogEntry): void {
  if (key.length === 0) return
  const bucket = map.get(key)
  if (bucket === undefined) {
    map.set(key, [entry])
  } else if (!bucket.some((item) => item.catalogId === entry.catalogId)) {
    bucket.push(entry)
  }
}

/** 建一次索引，之后每个模型三次 Map 查找；不要对每条模型重扫全量快照。 */
export function buildCatalogIndex(entries: readonly CatalogEntry[]): CatalogIndex {
  const exact = new Map<string, CatalogEntry[]>()
  const alias = new Map<string, CatalogEntry[]>()
  const family = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    push(exact, entry.id.trim(), entry)
    push(alias, normalizeCatalogAlias(entry.id), entry)
    push(family, catalogFamilyKey(entry.id), entry)
  }
  return { entries: [...entries], exact, alias, family }
}

export function catalogIndexFromStore(store: CatalogStore): CatalogIndex {
  const entries: CatalogEntry[] = []
  for (const source of CATALOG_SOURCES) {
    const snapshot = store.snapshots[source]
    if (snapshot) entries.push(...snapshot.entries)
  }
  return buildCatalogIndex(entries)
}

/**
 * 网关的展示名 = `${供应商名} / ${上游给的名字}`（账号渠道在
 * `accountChannels/manager.ts::applyChannel` 里这样拼）。**匹配标准库必须用上游名**：
 * 拿拼好的展示名去匹配，exact 永远落空（catalog 里不会有条目叫 `TRAE (字节) / GLM-5.1`），
 * 只能掉到 alias 档，白丢一档置信度；模糊匹配的分词也会被供应商名前缀污染。
 *
 * 2026-11-04 远程网关实测：980 行里剥掉前缀后 exact 命中从 184 行升到 264 行。
 * 只剥 `${providerName} / ` 这一种由网关自己拼出的前缀；用户自定义名、上游名里自带的
 * `/` 都不动。
 */
export function upstreamModelName(providerName: string | undefined, displayName: string): string {
  const prefix = providerName ? `${providerName} / ` : ''
  return prefix.length > 0 && displayName.startsWith(prefix)
    ? displayName.slice(prefix.length)
    : displayName
}

/**
 * 条目带几条**路由真正会用的**能力（六项，价格不计）。
 *
 * 同一置信度里若只按 `catalogId` 字典序排，`litellm:` 会稳定压住 `models.dev:`
 * 与 `openrouter:`，而 LiteLLM 台账根本没有 `reasoning` 这一项：一个模型只要在
 * LiteLLM 里有 5 条以上同名条目，弹窗的 5 个候选名额就全是 LiteLLM，唯一能补上
 * 「推理」的那条候选连显示的机会都没有（2026-11-04 远程网关实测：980 行里 453 行如此）。
 * 所以同置信度先让信息量高的候选靠前，来源声明顺序再兜底。
 */
export function adoptableFieldCount(entry: CatalogEntry): number {
  return ROUTING_METADATA_ATTRIBUTES.filter(
    (attribute) => catalogFieldValue(entry, attribute as CatalogAdoptionField) !== undefined,
  ).length
}

/**
 * 报告层的廉价判据：只用 exact / alias 两张表，**不跑模糊匹配**。
 *
 * 模糊匹配对每条模型都要扫全库并算 bigram，一条 60ms 量级；标注页每次打开要对近千行
 * 判一次「标准库有没有这条」，用它会直接把报表拖成分钟级。而 family / fuzzy 本来
 * 就永远不自动采用（`CATALOG_BATCH_AUTO_FIELDS` 的闸门），把它们算进「可补」等于
 * 让界面承诺一件批量不会做的事。
 */
export interface CatalogCoverageCheck {
  /** 标准库里有没有 exact/alias 候选。 */
  hasAutoMatch: boolean
  /** 缺的这几项里，有没有一项能被某条 exact/alias 候选补上。 */
  canFillAny: boolean
}

export function checkCatalogCoverage(
  index: CatalogIndex,
  input: { modelId: string; displayName: string; missing: readonly MetadataAttribute[] },
): CatalogCoverageCheck {
  const candidates = new Map<string, CatalogEntry>()
  const collect = (bucket: Map<string, CatalogEntry[]> | undefined, key: string): void => {
    for (const entry of bucket?.get(key) ?? []) candidates.set(entry.catalogId, entry)
  }
  const rawId = input.modelId.trim()
  const display = input.displayName.trim()
  collect(index.exact, rawId)
  collect(index.alias, normalizeCatalogAlias(rawId))
  if (display.length > 0) {
    collect(index.exact, display)
    collect(index.alias, normalizeCatalogAlias(display))
  }
  if (candidates.size === 0) return { hasAutoMatch: false, canFillAny: false }

  const gaps = ROUTING_METADATA_ATTRIBUTES.filter(
    (attribute) => (input.missing as readonly MetadataAttribute[]).includes(attribute),
  )
  const canFillAny = [...candidates.values()].some((entry) =>
    gaps.some((attribute) => catalogFieldValue(entry, attribute as CatalogAdoptionField) !== undefined),
  )
  return { hasAutoMatch: true, canFillAny }
}

/**
 * 三档匹配：原文 id → 归一化别名 → 家族启发式。置信度只降不升，同一 entry
 * 出现多次时保留最高档。默认最多返回 `limit` 条，界面按顺序展示，不自动采用。
 */
export function matchCatalogEntries(
  index: CatalogIndex,
  input: { modelId: string; displayName?: string },
  limit = 5,
): CatalogMatch[] {
  const found = new Map<string, CatalogMatch>()
  const consider = (items: CatalogEntry[] | undefined, confidence: CatalogMatchConfidence): void => {
    for (const entry of items ?? []) {
      const key = `${entry.source}:${entry.catalogId}`
      const current = found.get(key)
      const rank = (value: CatalogMatchConfidence): number =>
        value === 'exact' ? 0 : value === 'alias' ? 1 : value === 'family' ? 2 : 3
      if (current === undefined || rank(confidence) < rank(current.confidence)) {
        found.set(key, { entry, confidence })
      }
    }
  }

  const rawId = input.modelId.trim()
  consider(index.exact.get(rawId), 'exact')
  consider(index.alias.get(normalizeCatalogAlias(rawId)), 'alias')
  if (input.displayName) {
    const display = input.displayName.trim()
    consider(index.exact.get(display), 'exact')
    consider(index.alias.get(normalizeCatalogAlias(display)), 'alias')
  }
  consider(index.family.get(catalogFamilyKey(rawId)), 'family')
  if (input.displayName) {
    consider(index.family.get(catalogFamilyKey(input.displayName)), 'family')
  }

  // 第五档：模糊匹配（仅候选建议，不自动采用）
  const fuzzy = fuzzyMatchEntries(index, input)
  for (const match of fuzzy) {
    const key = `${match.entry.source}:${match.entry.catalogId}`
    if (!found.has(key)) {
      found.set(key, match)
    }
  }

  const rank = (value: CatalogMatchConfidence): number =>
    value === 'exact' ? 0 : value === 'alias' ? 1 : value === 'family' ? 2 : 3
  return [...found.values()]
    .sort((a, b) => {
      if (rank(a.confidence) !== rank(b.confidence)) return rank(a.confidence) - rank(b.confidence)
      const informative = adoptableFieldCount(b.entry) - adoptableFieldCount(a.entry)
      if (informative !== 0) return informative
      const bySource = CATALOG_SOURCES.indexOf(a.entry.source) - CATALOG_SOURCES.indexOf(b.entry.source)
      if (bySource !== 0) return bySource
      return a.entry.catalogId.localeCompare(b.entry.catalogId)
    })
    .slice(0, Math.max(1, limit))
}

export function catalogFieldValue(
  entry: CatalogEntry,
  field: CatalogAdoptionField,
): CatalogAdoptionValue | undefined {
  switch (field) {
    case 'contextTokens':
      return entry.contextTokens
    case 'maxOutputTokens':
      return entry.maxOutputTokens
    case 'modalities':
      return entry.modalities
    case 'vision':
      return entry.vision
    case 'tools':
      return entry.tools
    case 'reasoning':
      return entry.reasoning
    case 'price':
      return entry.price
  }
}

/**
 * 字段值校验。`price` 以外的数值上限沿用标注口径（输出 ≤ 1,000,000），
 * 模态必须是已知集合的非空子集。
 */
export function sanitizeCatalogAdoptionValue(
  field: CatalogAdoptionField,
  value: unknown,
): CatalogAdoptionValue | undefined {
  switch (field) {
    case 'contextTokens': {
      const number = positiveInt(value)
      return number !== undefined && number <= MAX_CONTEXT_TOKENS ? number : undefined
    }
    case 'maxOutputTokens': {
      const number = positiveInt(value)
      return number !== undefined && number <= MAX_OUTPUT_TOKENS ? number : undefined
    }
    case 'modalities':
      return sanitizeModalities(value)
    case 'vision':
    case 'tools':
    case 'reasoning': {
      const flag = capabilityFlag(value)
      return flag
    }
    case 'price':
      return sanitizeCatalogPrice(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 单条 adoption 校验；字段/值/来源/证据缺一不可。 */
export function sanitizeCatalogAdoption(raw: unknown): CatalogAdoption | undefined {
  if (!isRecord(raw)) return undefined
  const providerId = typeof raw.providerId === 'string' ? raw.providerId.trim() : ''
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : ''
  const catalogId = typeof raw.catalogId === 'string' ? raw.catalogId.trim() : ''
  const evidenceId = typeof raw.evidenceId === 'string' ? raw.evidenceId.trim() : ''
  const adoptedAt = typeof raw.adoptedAt === 'string' ? raw.adoptedAt.trim() : ''
  if (
    providerId.length === 0 ||
    displayName.length === 0 ||
    catalogId.length === 0 ||
    evidenceId.length === 0 ||
    adoptedAt.length === 0 ||
    Number.isNaN(Date.parse(adoptedAt))
  ) {
    return undefined
  }
  if (typeof raw.source !== 'string') return undefined
  if (!(CATALOG_SOURCES as readonly string[]).includes(raw.source)) return undefined
  if (typeof raw.field !== 'string') return undefined
  if (!(CATALOG_ADOPTION_FIELDS as readonly string[]).includes(raw.field)) return undefined
  const field = raw.field as CatalogAdoptionField
  const value = sanitizeCatalogAdoptionValue(field, raw.value)
  if (value === undefined) return undefined
  return {
    providerId,
    displayName,
    catalogId,
    field,
    value,
    source: raw.source as CatalogSourceId,
    evidenceId,
    adoptedAt,
  }
}

export function catalogAdoptionKey(
  providerId: string,
  displayName: string,
  field: CatalogAdoptionField,
): string {
  return `${providerId}\u0000${displayName}\u0000${field}`
}

/** 校验并去重（同一 provider/model/field 只留最后一条）。非数组 → 空台账。 */
export function sanitizeCatalogAdoptionLedger(raw: unknown): CatalogAdoption[] {
  if (!Array.isArray(raw)) return []
  const deduped = new Map<string, CatalogAdoption>()
  for (const item of raw) {
    const adoption = sanitizeCatalogAdoption(item)
    if (adoption) deduped.set(catalogAdoptionKey(adoption.providerId, adoption.displayName, adoption.field), adoption)
  }
  return [...deduped.values()]
}

/** 不可变写入：同一字段覆盖，不同字段保留。 */
export function upsertCatalogAdoption(
  ledger: readonly CatalogAdoption[],
  adoption: CatalogAdoption,
): CatalogAdoption[] {
  const key = catalogAdoptionKey(adoption.providerId, adoption.displayName, adoption.field)
  return [
    ...ledger.filter(
      (item) => catalogAdoptionKey(item.providerId, item.displayName, item.field) !== key,
    ),
    adoption,
  ]
}

/** 撤销：不传 field 时撤销该模型的所有采用字段。 */
export function removeCatalogAdoptions(
  ledger: readonly CatalogAdoption[],
  providerId: string,
  displayName: string,
  field?: CatalogAdoptionField,
): CatalogAdoption[] {
  return ledger.filter((item) => {
    if (item.providerId !== providerId || item.displayName !== displayName) return true
    return field !== undefined && item.field !== field
  })
}

export function adoptionsForModel(
  ledger: readonly CatalogAdoption[],
  providerId: string,
  displayName: string,
): CatalogAdoption[] {
  return ledger.filter(
    (item) => item.providerId === providerId && item.displayName === displayName,
  )
}

/**
 * 把 adoption 折成能力标注。`price` 在这里被显式排除：价格只用于展示，
 * 不进入路由、额度或权重判定。
 */
export function catalogAdoptionHint(
  adoptions: readonly CatalogAdoption[],
): ModelCapabilityHint | undefined {
  const hint: ModelCapabilityHint = {}
  for (const adoption of adoptions) {
    switch (adoption.field) {
      case 'contextTokens':
        if (typeof adoption.value === 'number') hint.contextTokens = adoption.value
        break
      case 'maxOutputTokens':
        if (typeof adoption.value === 'number') hint.maxOutputTokens = adoption.value
        break
      case 'modalities':
        if (Array.isArray(adoption.value)) hint.modalities = [...adoption.value] as InputModality[]
        break
      case 'vision':
        if (adoption.value === 'yes' || adoption.value === 'no') hint.vision = adoption.value
        break
      case 'tools':
        if (adoption.value === 'yes' || adoption.value === 'no') hint.tools = adoption.value
        break
      case 'reasoning':
        if (adoption.value === 'yes' || adoption.value === 'no') hint.reasoning = adoption.value
        break
      case 'price':
        // 只展示，不换算。显式空分支让这条口径可被审阅。
        break
    }
  }
  return Object.keys(hint).length === 0 ? undefined : hint
}

/** 为模糊匹配做的归一化：比 normalizeCatalogAlias 更激进，只保留字母数字。 */
function normalizeFuzzyKey(input: string): string {
  let key = input.trim().toLowerCase()
  const slash = key.lastIndexOf('/')
  if (slash >= 0) key = key.slice(slash + 1)
  key = key.replace(/-[0-9]{4}-[0-9]{2}-[0-9]{2}$/, '')
  key = key.replace(/-[0-9]{8}$/, '')
  key = key.replace(/-latest$/, '')
  // 只保留字母数字，其他全部去掉
  key = key.replace(/[^a-z0-9]/g, '')
  return key
}

/** 计算两个字符串的 bigram 重叠相似度 (0-1)，值越大越相似。 */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bigramsA = new Set<string>()
  const bigramsB = new Set<string>()
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2))
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2))
  let intersection = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size)
}

/** Fuzzy 匹配阈值：0.55 以上视为潜在匹配。 */
const FUZZY_SIMILARITY_THRESHOLD = 0.55
const FUZZY_MAX_RESULTS = 5

/** 使用模糊匹配在目录索引中查找候选项。仅用于候选建议，不自动采用。 */
export function fuzzyMatchEntries(
  index: CatalogIndex,
  input: { modelId: string; displayName?: string },
): CatalogMatch[] {
  const candidates = new Map<string, CatalogMatch>()
  const seen = new Set<string>()

  const tryMatch = (raw: string) => {
    const key = normalizeFuzzyKey(raw)
    if (key.length < 2) return
    for (const entry of index.entries) {
      const entryKey = normalizeFuzzyKey(entry.id)
      if (entryKey.length < 2) continue
      const similarity = bigramSimilarity(key, entryKey)
      if (similarity >= FUZZY_SIMILARITY_THRESHOLD) {
        const catalogKey = `${entry.source}:${entry.catalogId}`
        if (!seen.has(catalogKey)) {
          seen.add(catalogKey)
          candidates.set(catalogKey, { entry, confidence: 'fuzzy' as const })
        }
      }
    }
  }

  // 先尝试 displayName（更可能包含真实模型名），再尝试 modelId
  if (input.displayName) {
    // 尝试分割后的基础名（去掉渠道前缀）
    const parts = input.displayName.split('/')
    const baseName = parts[parts.length - 1]?.trim()
    if (baseName && baseName !== input.displayName) tryMatch(baseName)
    tryMatch(input.displayName)
  }
  tryMatch(input.modelId)

  return [...candidates.values()]
    .sort((a, b) => {
      const keyA = normalizeFuzzyKey(input.displayName ?? input.modelId)
      return bigramSimilarity(keyA, normalizeFuzzyKey(b.entry.id)) - bigramSimilarity(keyA, normalizeFuzzyKey(a.entry.id))
    })
    .slice(0, FUZZY_MAX_RESULTS)
}

/** 三档匹配：原文 id → 归一化别名 → 家族启发式 → 模糊匹配。置信度只降不升，同一 entry
 * 出现多次时保留最高档。默认最多返回 `limit` 条，界面按顺序展示，不自动采用。
 */

/** 采用字段的证据文案，写进 MetadataLayer.evidence。 */
export function catalogAdoptionEvidence(adoptions: readonly CatalogAdoption[]): string {
  const sources = [...new Set(adoptions.map((item) => CATALOG_SOURCE_META[item.source].label))]
  const ids = [...new Set(adoptions.map((item) => item.catalogId))]
  const list = ids.slice(0, 2).join(', ')
  const suffix = ids.length > 2 ? ` 等 ${ids.length} 条` : ''
  return `标准模型库采用（${sources.join('/')}；${list}${suffix}）`

/** 获取标准模型库各来源的模型概览。用于 fuzzy 匹配无结果时的备选展示。 */}