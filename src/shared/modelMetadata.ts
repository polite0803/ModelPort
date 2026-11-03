/**
 * 模型元数据的分层解析链（设计见 docs/design/2026-11-04-model-metadata-resolution.md）。
 *
 * 这一层只做「证据 → 带来源/置信度/时间的字段」的折算，不做 I/O、不读 store：
 * 主进程把目录、手工标注、旁表与探测 sidecar 折成 `MetadataLayer[]` 交给
 * `mergeModelMetadata`，界面与路由拿到的就是同一份优先级结果。
 *
 * 不变量：
 * - 缺席字段一律表达为 `{ state: 'unclassified' }`，不写默认值（0 / false / ['text'] 都是猜测）。
 * - `source` 只有五层 + `unclassified`；更细的出处写 `evidence`。
 * - `asOf` 只在证据本身带时间时透传，从不补齐。
 */
import type { InputModality, ModelCapabilityHint } from './types.ts'

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

/** 五层来源（高 → 低）+ 「谁都不知道」。 */
export const METADATA_SOURCE_PRIORITY = [
  'manual',
  'upstream',
  'family-rule',
  'probe',
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

/** 某条记录里仍为 `unclassified` 的属性列表。 */
export function unclassifiedAttributes(metadata: ModelMetadata): MetadataAttribute[] {
  return METADATA_ATTRIBUTES.filter((attribute) => {
    const fact: Fact<unknown> = metadata[attribute]
    return fact.state === 'unclassified'
  })
}

export interface AttributeCoverage {
  known: number
  total: number
  /** 0–1；`total === 0` 时记 0。 */
  rate: number
}

export type MetadataCoverage = Record<MetadataAttribute, AttributeCoverage>

/** 每项属性的已知行数 / 目录总行数。分母与「待标注队列」同源。 */
export function computeMetadataCoverage(
  records: readonly ModelMetadata[],
): MetadataCoverage {
  const total = records.length
  const coverage = {} as MetadataCoverage
  for (const attribute of METADATA_ATTRIBUTES) {
    const known = records.reduce(
      (count, record) => (record[attribute].state === 'known' ? count + 1 : count),
      0,
    )
    coverage[attribute] = {
      known,
      total,
      rate: total === 0 ? 0 : known / total,
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
}

/**
 * 「待标注」队列：只保留仍有未分类属性的模型，按调用量降序；调用量相同再按
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

/** 界面/覆盖率报告的一行：解析结果 + 调用量 + 仍缺失的属性。 */
export interface ModelMetadataRow extends ModelMetadata {
  calls: number
  missing: MetadataAttribute[]
}

export interface ModelMetadataReport {
  generatedAt: string
  totals: {
    models: number
    annotated: number
    unclassified: number
  }
  coverage: MetadataCoverage
  queue: ModelMetadataRow[]
  /** 每项属性仍有缺失的模型数，等同覆盖率分母减去已知数。 */
  coverageGaps: Record<MetadataAttribute, number>
}
