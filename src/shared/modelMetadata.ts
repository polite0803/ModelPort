/**
 * 模型元数据的分层解析链（设计见 docs/design/2026-11-04-model-metadata-resolution.md）。
 *
 * 这一层只做「证据 → 带来源/置信度/时间的字段」的折算，不做 I/O、不读 store：
 * 主进程把目录、手工标注、旁表与探测 sidecar 折成 `MetadataLayer[]` 交给
 * `mergeModelMetadata`，界面与路由拿到的就是同一份优先级结果。
 *
 * 不变量：
 * - 缺席字段一律表达为 `{ state: 'unclassified' }`，不写默认值（0 / false / ['text'] 都是猜测）。
 * - `source` 只有六层 + `unclassified`；更细的出处写 `evidence`。
 * - `asOf` 只在证据本身带时间时透传，从不补齐。
 */
import type { InputModality, ModelCapabilityHint, ProviderType } from './types.ts'

/** 一次解析覆盖的属性；顺序即界面上的展示顺序。 */
export const METADATA_ATTRIBUTES = [
  'modelType',
  'vision',
  'tools',
  'reasoning',
  'modalities',
  'contextTokens',
  'maxOutputTokens',
  'weight',
  'free',
] as const

export type MetadataAttribute = (typeof METADATA_ATTRIBUTES)[number]

/**
 * 「关键属性」：路由**真的**据此做判断的六项。
 *
 * 判据来自 `proxy/autoRouting.ts`，不是按「哪个字段好看」挑的：
 * - `vision` / `tools` / `reasoning`：`hardFilterFailure`（`:1027-1030`）在请求带图/带工具/
 *   要思考时按这三个值筛候选；
 * - `modalities`：`supportsVision`（`:163-167`）优先于 `vision` 判定装不装得下图；
 * - `contextTokens`：容量硬过滤与 `advertisedContextFloorOf` 的输入；
 * - `maxOutputTokens`：`requestedMaxOutput > cap` 的裁剪判断（`:1198-1199`）。
 *
 * `modelType` 不在这里：它由 `modalities`/`vision` 派生，没有独立生产者，把它算进
 * 完整度只会把同一份证据数两遍。`weight`/`free` 也不在：那是计费展示与「免费优先」
 * 排序的输入，缺了不影响一次请求能不能成。
 *
 * 「关键」讲的是**判断会不会出错**，不是「批量必须把它填上」：`reasoning` 是关键属性，
 * 标准库两个方向都能批量采用、`no` 只写空槽
 * （`modelCatalogBatch.ts::CATALOG_BATCH_AUTO_FIELDS`），
 * 所以它留在缺口里是诚实的「上游没有证据」，不是一个待办。
 */
export const ROUTING_METADATA_ATTRIBUTES = [
  'vision',
  'tools',
  'reasoning',
  'modalities',
  'contextTokens',
  'maxOutputTokens',
] as const satisfies readonly MetadataAttribute[]

/** 参考属性：面板展示与排序用，缺失不阻塞路由。与 {@link ROUTING_METADATA_ATTRIBUTES} 互补。 */
export const REFERENCE_METADATA_ATTRIBUTES = [
  'modelType',
  'weight',
  'free',
] as const satisfies readonly MetadataAttribute[]

/**
 * 属性对某类 provider 是否**有意义**。不适用 ≠ 未标注：把「这条渠道没有倍率这个概念」
 * 记成缺失，覆盖率就永远钉死在 0，而它其实是一个真答案。
 *
 * - `weight` 是渠道包的积分倍率（`· x4.0` 标签），只有 `account` provider 存在这个概念；
 *   聚合与自定义供应商没有倍率这回事。
 * - `free` 对 `account`（免费标签）和 `aggregate`（`docs/data` 成本票据）都有出处；
 *   `custom`/`builtin` 没有任何生产者，写进分母就是永久缺失。
 * - 其余六项对所有 provider 都适用。
 */
export function isAttributeApplicable(
  attribute: MetadataAttribute,
  providerType: ProviderType,
  metadata?: Pick<ModelMetadata, 'modalities'>
): boolean {
  if (attribute === 'weight') return providerType === 'account'
  if (attribute === 'free') return providerType === 'account' || providerType === 'aggregate'
  // 已知输入模态里没有文本 ⇒ 这条模型不接 chat completions（ASR / TTS / 图像生成 / 向量）。
  // 语音翻译、omni、realtime 这类仍以文本为输入之一，`modalities` 含 `text`，照常计缺口。
  if (metadata !== undefined && isChatInapplicable(metadata)) {
    return !(ROUTING_METADATA_ATTRIBUTES as readonly string[]).includes(attribute)
  }
  return true
}

/**
 * 输入模态**已知**且不含 `text` —— 聊天能力对它不适用。
 *
 * 只认已解析出来的 `modalities`，不猜名字：名字推断是 `isNonChatModel` 的窄口径正则干的活，
 * 这里回答的是「这份证据已经证明它不接文本」这一更硬的判断。未知（`unclassified`）不算，
 * 因为「不知道」不等于「不适用」。
 */
export function isChatInapplicable(metadata: Pick<ModelMetadata, 'modalities'>): boolean {
  const fact = metadata.modalities
  return fact.state === 'known' && !fact.value.includes('text')
}

/**
 * 六层来源（高 → 低）+ 「谁都不知道」。
 *
 * 2026-11-04 的裁定把标准库层插在「上游声明」与「实测探测」之间：
 * 人工标记 > 上游声明 > 标准库（含已采用的 adoption）> 实测探测 > 家族规则 > 成本账本。
 * 标准库本身是第三方数据（置信度 `inferred`），采用是用户逐字段的显式动作，
 * 但**永远不能**盖住人工标记或上游声明。
 */
export const METADATA_SOURCE_PRIORITY = [
  'manual',
  'upstream',
  'catalog',
  'probe',
  'family-rule',
  'cost-ledger',
] as const

export type MetadataSource = (typeof METADATA_SOURCE_PRIORITY)[number] | 'unclassified'
export type KnownMetadataSource = Exclude<MetadataSource, 'unclassified'>

export type MetadataConfidence = 'declared' | 'inferred' | 'measured'

export interface KnownFact<T> {
  state: 'known'
  value: T
  source: KnownMetadataSource
  confidence: MetadataConfidence
  /** 证据自带的时间；没有就不写。 */
  asOf?: string
  /** 人类可读出处，不参与优先级判定。 */
  evidence?: string
}

export interface UnclassifiedFact {
  state: 'unclassified'
}

export type Fact<T> = KnownFact<T> | UnclassifiedFact

export type ResolvedModelType = 'multimodal' | 'text' | 'unknown'

/** 一条模型的完整解析结果。派生字段见 `deriveModelType`。 */
export interface ModelMetadata {
  providerId: string
  displayName: string
  actualModelId: string
  /** 决定哪些属性对这一行有意义（见 {@link isAttributeApplicable}）。 */
  providerType: ProviderType
  modelType: Fact<ResolvedModelType>
  vision: Fact<Exclude<ModelCapabilityHint['vision'], undefined>>
  tools: Fact<Exclude<ModelCapabilityHint['tools'], undefined>>
  reasoning: Fact<Exclude<ModelCapabilityHint['reasoning'], undefined>>
  modalities: Fact<InputModality[]>
  contextTokens: Fact<number>
  maxOutputTokens: Fact<number>
  weight: Fact<number>
  free: Fact<boolean>
}

/** 一层证据：来源 + 置信度 + 时间 + 该层声明的字段。 */
export interface MetadataLayer {
  source: KnownMetadataSource
  confidence: MetadataConfidence
  asOf?: string
  evidence?: string
  hint: ModelCapabilityHint
}

const ATTRIBUTE_TO_HINT_KEY = {
  vision: 'vision',
  tools: 'tools',
  reasoning: 'reasoning',
  modalities: 'modalities',
  contextTokens: 'contextTokens',
  maxOutputTokens: 'maxOutputTokens',
  weight: 'weight',
  free: 'free',
} as const satisfies Record<Exclude<MetadataAttribute, 'modelType'>, keyof ModelCapabilityHint>

/** 优先级排名越小越先被采用；未知来源排在最后。 */
export function metadataSourceRank(source: MetadataSource): number {
  if (source === 'unclassified') return METADATA_SOURCE_PRIORITY.length
  return METADATA_SOURCE_PRIORITY.indexOf(source)
}

function isKnown<T>(fact: Fact<T>): fact is KnownFact<T> {
  return fact.state === 'known'
}

function pickFact<T>(
  attribute: Exclude<MetadataAttribute, 'modelType'>,
  layers: readonly MetadataLayer[]
): Fact<T> {
  const key = ATTRIBUTE_TO_HINT_KEY[attribute]
  for (const layer of layers) {
    const value = layer.hint[key]
    if (value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    return {
      state: 'known',
      value: value as T,
      source: layer.source,
      confidence: layer.confidence,
      ...(layer.asOf ? { asOf: layer.asOf } : {}),
      ...(layer.evidence ? { evidence: layer.evidence } : {}),
    }
  }
  return { state: 'unclassified' }
}

/** 派生模型类型：模态优先，其次 vision；两者都未知时保持 unknown。 */
export function deriveModelType(
  modalities: Fact<InputModality[]>,
  vision: Fact<'yes' | 'no'>
): Fact<ResolvedModelType> {
  if (isKnown(modalities)) {
    const multimodal = modalities.value.includes('image')
    return { ...modalities, value: multimodal ? 'multimodal' : 'text' }
  }
  if (isKnown(vision)) {
    return {
      ...vision,
      value: vision.value === 'yes' ? 'multimodal' : 'text',
    }
  }
  return { state: 'unclassified' }
}

/**
 * 按 `METADATA_SOURCE_PRIORITY` 合并多层证据。
 *
 * `layers` 的顺序不重要：同来源的层按数组先后取第一个有值的（调用方负责把更强的
 * 同源证据放前面，例如供应商记录先于第三方旁表）。
 */
export function mergeModelMetadata(input: {
  providerId: string
  displayName: string
  actualModelId: string
  providerType: ProviderType
  layers: readonly MetadataLayer[]
}): ModelMetadata {
  const sorted = [...input.layers].sort(
    (left, right) => metadataSourceRank(left.source) - metadataSourceRank(right.source),
  )

  const vision = pickFact<'yes' | 'no'>('vision', sorted)
  const tools = pickFact<'yes' | 'no'>('tools', sorted)
  const reasoning = pickFact<'yes' | 'no'>('reasoning', sorted)
  const modalities = pickFact<InputModality[]>('modalities', sorted)
  const contextTokens = pickFact<number>('contextTokens', sorted)
  const maxOutputTokens = pickFact<number>('maxOutputTokens', sorted)
  const weight = pickFact<number>('weight', sorted)
  const free = pickFact<boolean>('free', sorted)

  return {
    providerId: input.providerId,
    displayName: input.displayName,
    actualModelId: input.actualModelId,
    providerType: input.providerType,
    modelType: deriveModelType(modalities, vision),
    vision,
    tools,
    reasoning,
    modalities,
    contextTokens,
    maxOutputTokens,
    weight,
    free,
  }
}

/**
 * 某条记录里仍为 `unclassified` 的**适用**属性。
 *
 * 不适用的属性不参与：聚合 provider 的 `weight` 没有倍率这个概念，把它算成缺失，
 * 「仍有缺失」就会永远等于目录行数（1.7.2 前就是这样：1000 行里 998 行「缺失」，
 * 而其中 570 行的缺口是 `weight` 一项按构造补不上的）。
 */
export function unclassifiedAttributes(metadata: ModelMetadata): MetadataAttribute[] {
  return METADATA_ATTRIBUTES.filter((attribute) => {
    if (!isAttributeApplicable(attribute, metadata.providerType, metadata)) return false
    const fact: Fact<unknown> = metadata[attribute]
    return fact.state === 'unclassified'
  })
}

/** 关键属性里仍缺失的部分；空数组即「这一行路由用得上了」。 */
export function routingGapsOf(metadata: ModelMetadata): MetadataAttribute[] {
  // 证据已证明它不接文本（ASR / 合成 / 图像生成），聊天能力对它不适用：
  // 把 `vision`/`tools` 记成缺口就是给一个永远补不完的任务计数。
  if (isChatInapplicable(metadata)) return []
  return ROUTING_METADATA_ATTRIBUTES.filter(
    (attribute) => (metadata[attribute] as Fact<unknown>).state === 'unclassified'
  )
}

/** 六项关键属性全部有来源。 */
export function isRoutingComplete(metadata: ModelMetadata): boolean {
  return routingGapsOf(metadata).length === 0
}

/**
 * 「关键属性待补」的分桶。一个数字混了四种完全不同的东西：
 * - `adoptable`：标准库有可用的 exact/alias 候选，跑一次批量就能补上；
 * - `missing-field`：标准库有这条模型，但缺的那一项台账里也没有；
 * - `no-candidate`：标准库里根本没有这条模型（`Qoder / Ultimate` 这类渠道内部档位）；
 * - `not-chat`：不是对话模型（图像生成 / 向量 / 重排 / 语音合成），聊天能力对它不适用。
 *
 * 2026-11-04 实测：一个 980 行的目录里 137 行待补，只有 0 行 `adoptable`，
 * 101 行 `no-candidate`、27 行 `not-chat`。把它们并成一个数会让人以为还能补。
 */
export type ModelGapKind = 'adoptable' | 'missing-field' | 'no-candidate' | 'not-chat'

/**
 * 明显的非对话模型。**窄口径**：只认图像生成 / 向量 / 重排 / 语音合成这几类，
 * 宁可漏判成对话模型也不误判——音频对话（`omni` / `realtime` / `audio`）与翻译模型
 * 仍按对话模型计，它们缺的能力是真的缺。
 */
const NON_CHAT_MODEL_PATTERN =
  /(embedding|rerank|(^|[_/.-])image([_/.-]|$)|flux|stable-diffusion|(^|[_/.-])tts([_/.-]|$))/i

export function isNonChatModel(modelId: string): boolean {
  return NON_CHAT_MODEL_PATTERN.test(modelId)
}

/** 分桶的优先级：先判不适用，再判能不能补。 */
export function classifyModelGap(input: {
  modelId: string
  hasAutoMatch: boolean
  canFillAny: boolean
  /** 证据已证明它不接文本（见 {@link isChatInapplicable}）；未知时按对话模型算。 */
  chatApplicable?: boolean
}): ModelGapKind {
  if (input.chatApplicable === false) return 'not-chat'
  if (isNonChatModel(input.modelId)) return 'not-chat'
  if (input.canFillAny) return 'adoptable'
  return input.hasAutoMatch ? 'missing-field' : 'no-candidate'
}

export interface AttributeCoverage {
  known: number
  /** 目录总行数，含对这一行没有意义的行。 */
  total: number
  /** 分母：这一项对该 provider 类型有意义的行数（= total - notApplicable）。 */
  applicable: number
  /** 按构造不可能有出处的行数（聚合/自定义行的 `weight` 等），界面要能说「不适用」而不是「未标注」。 */
  notApplicable: number
  /** `known / applicable`；`applicable === 0` 时记 0。 */
  rate: number
}

export type MetadataCoverage = Record<MetadataAttribute, AttributeCoverage>

/**
 * 每项属性的已知行数 / **适用**行数。分母与「待标注队列」同源（同一批 records、同一套
 * {@link isAttributeApplicable} 判据），所以界面上的覆盖条和队列不会各算一套。
 */
export function computeMetadataCoverage(
  records: readonly ModelMetadata[],
): MetadataCoverage {
  const total = records.length
  const coverage = {} as MetadataCoverage
  for (const attribute of METADATA_ATTRIBUTES) {
    let known = 0
    let applicable = 0
    for (const record of records) {
      if (!isAttributeApplicable(attribute, record.providerType, record)) continue
      applicable += 1
      if (record[attribute].state === 'known') known += 1
    }
    coverage[attribute] = {
      known,
      total,
      applicable,
      notApplicable: total - applicable,
      rate: applicable === 0 ? 0 : known / applicable,
    }
  }
  return coverage
}

/** 调用量索引：键为模型展示名；值为调用次数（允许 `{ calls }` 形态）。 */
export type ModelCallVolume = Record<string, number | { calls?: number }>

function callVolumeOf(volume: ModelCallVolume, displayName: string): number {
  const entry = volume[displayName]
  if (typeof entry === 'number' && Number.isFinite(entry)) return entry
  if (entry && typeof entry === 'object' && typeof entry.calls === 'number') return entry.calls
  return 0
}

export interface UnclassifiedQueueRow {
  metadata: ModelMetadata
  missing: MetadataAttribute[]
  calls: number
  /** 缺的是不是关键属性：`false` = 六项关键属性已齐，只剩参考项。 */
  critical: boolean
}

/**
 * 「待标注」队列：只保留仍有未分类**适用**属性的模型，按调用量降序；调用量相同再按
 * providerId + 展示名排序，保证界面稳定。
 */
export function buildUnclassifiedQueue(
  records: readonly ModelMetadata[],
  callVolume: ModelCallVolume = {},
): UnclassifiedQueueRow[] {
  return records
    .map((metadata) => ({
      metadata,
      missing: unclassifiedAttributes(metadata),
      calls: callVolumeOf(callVolume, metadata.displayName),
      critical: !isRoutingComplete(metadata),
    }))
    .filter((row) => row.missing.length > 0)
    .sort(
      (left, right) =>
        right.calls - left.calls ||
        left.metadata.providerId.localeCompare(right.metadata.providerId) ||
        left.metadata.displayName.localeCompare(right.metadata.displayName),
    )
}

/** 把已解析事实折回 `ModelCapabilityHint`（只保留已知字段）。 */
export function metadataToHint(metadata: ModelMetadata): ModelCapabilityHint {
  const hint: ModelCapabilityHint = {}
  const assign = <K extends keyof ModelCapabilityHint>(
    key: K,
    fact: Fact<ModelCapabilityHint[K]>,
  ): void => {
    if (fact.state === 'known') hint[key] = fact.value
  }
  assign('vision', metadata.vision)
  assign('tools', metadata.tools)
  assign('reasoning', metadata.reasoning)
  assign('modalities', metadata.modalities)
  assign('contextTokens', metadata.contextTokens)
  assign('maxOutputTokens', metadata.maxOutputTokens)
  assign('weight', metadata.weight)
  assign('free', metadata.free)
  return hint
}

/** 界面/覆盖率报告的一行：解析结果 + 调用量 + 仍缺失的适用属性。 */
export interface ModelMetadataRow extends ModelMetadata {
  calls: number
  missing: MetadataAttribute[]
  /** 见 {@link UnclassifiedQueueRow.critical}：`false` 时这一行只剩参考项。 */
  critical: boolean
  /** 「关键属性待补」的四分类，见 {@link ModelGapKind}。由主进程按目录候选计算。 */
  gapKind: ModelGapKind
}

export interface ModelMetadataReport {
  generatedAt: string
  totals: {
    models: number
    /** 六项关键属性全部有来源的行数（{@link isRoutingComplete}）。 */
    routingComplete: number
    /** 关键属性仍有缺口，且这一行在待标注队列里。 */
    routingIncomplete: number
    /** `routingIncomplete` 的分桶；四项之和等于 `routingIncomplete`。 */
    routingIncompleteByKind: Record<ModelGapKind, number>
    /** 全部**适用**属性都有来源的行数（聚合行没有 `weight` 这一项，所以是 8 而不是 9）；
     *  只作为「上限还有多远」的次要读数。 */
    fullyAnnotated: number
  }
  coverage: MetadataCoverage
  queue: ModelMetadataRow[]
  /** 每项属性仍有缺失的模型数：适用行数减去已知数（不适用的行不计入缺口）。 */
  coverageGaps: Record<MetadataAttribute, number>
}
