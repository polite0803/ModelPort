/**
 * 模型元数据汇总：把五层证据折成一份可解释的解析结果。
 *
 * 只读：不写 `userModelMarks`、不改目录、不改旁表。探测结果是唯一的外部输入，
 * 从 sidecar 读取，过期行由 `probeRowToLayer` 丢弃。
 */
import { storeManager } from '../store/store.ts'
import type { Provider } from '../store/types.ts'
import { aggregateThirdPartyHint } from '../../shared/aggregateCapabilities.ts'
import { getAggregateEntry } from './aggregate/registry.ts'
import { getAggregateQuota } from '../../shared/aggregateQuota.ts'
import { aggregateContextWindow } from '../proxy/modelCapabilities.ts'
import { aggregateCostOf } from '../../shared/aggregateCost.ts'
import { familyRuleLayer } from '../../shared/modelFamilyRules.ts'
import {
  buildUnclassifiedQueue,
  classifyModelGap,
  computeMetadataCoverage,
  isChatInapplicable,
  isRoutingComplete,
  mergeModelMetadata,
  routingGapsOf,
  unclassifiedAttributes,
  type MetadataAttribute,
  type MetadataCoverage,
  type MetadataLayer,
  type ModelGapKind,
  type ModelMetadata,
  type ModelMetadataReport,
  type ModelMetadataRow,
} from '../../shared/modelMetadata.ts'
import { probeRowKey, probeRowToLayer, type ModelProbeSidecar } from '../../shared/modelProbe.ts'
import {
  adoptionsForModel,
  catalogAdoptionEvidence,
  catalogAdoptionHint,
  catalogIndexFromStore,
  checkCatalogCoverage,
  upstreamModelName,
  type CatalogAdoption,
} from '../../shared/modelCatalog.ts'
import { readModelProbeSidecar } from './modelProbeStore.ts'
import { readEffectiveCatalogStore } from './modelCatalogStore.ts'

function costLedgerLayer(provider: Provider, actualModelId: string): MetadataLayer | undefined {
  if (provider.type !== 'aggregate') return undefined
  const entry = getAggregateEntry(provider.aggregateId ?? provider.id)
  if (!entry) return undefined
  const signal = aggregateCostOf({
    entryId: entry.id,
    modelId: actualModelId,
    ...(entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}),
  })
  if (signal.class === 'unknown') return undefined
  return {
    source: 'cost-ledger',
    confidence: 'declared',
    evidence: `消耗分类：${signal.class}（证据：${signal.evidence}）`,
    hint: { free: signal.class === 'free' },
  }
}

function upstreamLayers(provider: Provider, displayName: string, actualModelId: string): MetadataLayer[] {
  const layers: MetadataLayer[] = []
  const record = provider.modelCapabilities?.[displayName]
  if (record) {
    layers.push({
      source: 'upstream',
      confidence: 'declared',
      evidence: '供应商同步的能力标注',
      hint: record,
    })
  }

  if (provider.type === 'aggregate') {
    const entryId = provider.aggregateId ?? provider.id
    const quota = getAggregateQuota(entryId)
    const contextTokens = aggregateContextWindow(entryId, actualModelId)
    if (contextTokens !== undefined) {
      layers.push({
        source: 'upstream',
        confidence: 'declared',
        ...(quota?.asOf ? { asOf: quota.asOf } : {}),
        evidence: quota?.docUrl
          ? `官方额度旁表（${quota.docUrl}）`
          : '官方额度旁表',
        hint: { contextTokens },
      })
    }

    const thirdParty = aggregateThirdPartyHint(entryId, actualModelId)
    if (thirdParty) {
      layers.push({
        source: 'upstream',
        confidence: 'inferred',
        evidence: 'models.dev 第三方旁表（aggregateCapabilities）',
        hint: thirdParty,
      })
    }
  }

  return layers
}

/**
 * 标准库层：只认用户已采用的字段。未采用的候选即使匹配到也不会进入解析链，
 * 所以「打开页面 / 刷新快照」本身不会改变任何模型的可路由能力。
 *
 * 价格 adoption 不进 hint（`catalogAdoptionHint` 显式跳过），因此这一层不会
 * 影响权重/免费位/额度判定。
 */
function catalogLayer(
  adoptions: readonly CatalogAdoption[],
  providerId: string,
  displayName: string,
): MetadataLayer | undefined {
  const mine = adoptionsForModel(adoptions, providerId, displayName)
  const hint = catalogAdoptionHint(mine)
  if (!hint) return undefined
  const asOf = mine
    .map((item) => item.adoptedAt)
    .sort()
    .at(-1)
  return {
    source: 'catalog',
    confidence: 'inferred',
    ...(asOf === undefined ? {} : { asOf }),
    evidence: catalogAdoptionEvidence(mine),
    hint,
  }
}

function layersForModel(input: {
  provider: Provider
  displayName: string
  actualModelId: string
  marks: ReturnType<typeof storeManager.getUserModelMarks>
  adoptions: readonly CatalogAdoption[]
  probes: ModelProbeSidecar
  nowMs: number
}): MetadataLayer[] {
  const layers: MetadataLayer[] = []

  const manual = input.marks[input.provider.id]?.[input.displayName]
  if (manual) {
    layers.push({
      source: 'manual',
      confidence: 'declared',
      evidence: '用户手工标注（userModelMarks）',
      hint: manual,
    })
  }

  layers.push(...upstreamLayers(input.provider, input.displayName, input.actualModelId))

  const catalog = catalogLayer(input.adoptions, input.provider.id, input.displayName)
  if (catalog) layers.push(catalog)

  const family = familyRuleLayer(input.actualModelId)
  if (family) layers.push(family)

  const probeRow = input.probes.rows.find(
    (row) =>
      probeRowKey(row) ===
      probeRowKey({ providerId: input.provider.id, displayName: input.displayName }),
  )
  if (probeRow) {
    const probeLayer = probeRowToLayer(probeRow, input.nowMs)
    if (probeLayer) layers.push(probeLayer)
  }

  const cost = costLedgerLayer(input.provider, input.actualModelId)
  if (cost) layers.push(cost)

  return layers
}

/** 解析单个模型；探测前用它判断是否已有声明级证据（默认跳过）。 */
export async function getResolvedModelMetadata(input: {
  providerId: string
  displayName: string
  nowMs?: number
}): Promise<ModelMetadata | undefined> {
  const provider = storeManager.getProviders().find((item) => item.id === input.providerId)
  if (!provider) return undefined
  const model = storeManager
    .getModelCatalogue(provider.id)
    .find((item) => item.displayName === input.displayName)
  if (!model) return undefined

  return mergeModelMetadata({
    providerId: provider.id,
    displayName: model.displayName,
    actualModelId: model.actualModelId,
    providerType: provider.type,
    layers: layersForModel({
      provider,
      displayName: model.displayName,
      actualModelId: model.actualModelId,
      marks: storeManager.getUserModelMarks(),
      adoptions: storeManager.getCatalogAdoptions(),
      probes: await readModelProbeSidecar(),
      nowMs: input.nowMs ?? Date.now(),
    }),
  })
}

function coverageGapsOf(coverage: MetadataCoverage): Record<MetadataAttribute, number> {
  const gaps = {} as Record<MetadataAttribute, number>
  for (const [attribute, row] of Object.entries(coverage)) {
    // 分母是**适用**行数：聚合行的 `weight` 没有出处，把它算成缺口就等于宣布一个
    // 永远补不完的任务（见 shared/modelMetadata.ts::isAttributeApplicable）。
    gaps[attribute as MetadataAttribute] = Math.max(0, row.applicable - row.known)
  }
  return gaps
}

/**
 * 汇总当前目录的元数据解析与覆盖率。纯读，可随时重算。
 *
 * `providerId` 给定时只遍历这一家：逐模型/逐渠道的批量补全只要本范围的队列，
 * 不该为一次点击遍历 89 条目 × 568 模型并重建整张目录索引
 * （store 每次读取还带整份解密，见 `AGENTS.md` §Data Storage）。
 * 范围版的 `totals` / `coverage` 只描述这一家，界面不得拿它当全局覆盖率显示。
 */
export async function getModelMetadataReport(
  nowMs: number = Date.now(),
  providerId?: string,
): Promise<ModelMetadataReport> {
  const probes = await readModelProbeSidecar()
  const marks = storeManager.getUserModelMarks()
  const adoptions = storeManager.getCatalogAdoptions()
  const modelUsage = storeManager.getStatistics().modelUsage

  // 目录候选只建一次索引；`checkCatalogCoverage` 只查 exact / alias，不为每行跑模糊匹配。
  const { store: catalogStore } = await readEffectiveCatalogStore()
  const catalogIndex = catalogIndexFromStore(catalogStore)

  const records: ModelMetadata[] = []
  const gapKindByKey = new Map<string, ModelGapKind>()
  const incompleteByKind: Record<ModelGapKind, number> = {
    adoptable: 0,
    'missing-field': 0,
    'no-candidate': 0,
    'not-chat': 0,
  }
  for (const provider of storeManager.getProviders()) {
    if (providerId !== undefined && provider.id !== providerId) continue
    for (const model of storeManager.getModelCatalogue(provider.id)) {
      const metadata = mergeModelMetadata({
        providerId: provider.id,
        displayName: model.displayName,
        actualModelId: model.actualModelId,
        providerType: provider.type,
        layers: layersForModel({
          provider,
          displayName: model.displayName,
          actualModelId: model.actualModelId,
          marks,
          adoptions,
          probes,
          nowMs,
        }),
      })
      records.push(metadata)

      // 分桶只回答「剩下的缺口能不能补」，不改任何标注：`adoptable` 才值得再跑一次批量。
      const routingGaps = routingGapsOf(metadata)
      const check = checkCatalogCoverage(catalogIndex, {
        modelId: metadata.actualModelId,
        displayName: upstreamModelName(provider.name, metadata.displayName),
        missing: routingGaps.length > 0 ? routingGaps : unclassifiedAttributes(metadata),
      })
      const kind = classifyModelGap({
        modelId: metadata.actualModelId,
        hasAutoMatch: check.hasAutoMatch,
        canFillAny: check.canFillAny,
        chatApplicable: !isChatInapplicable(metadata),
      })
      gapKindByKey.set(`${provider.id}\u0000${metadata.displayName}`, kind)
      if (routingGaps.length > 0) incompleteByKind[kind] += 1
    }
  }

  const coverage = computeMetadataCoverage(records)
  const fullyAnnotated = records.filter(
    (record) => unclassifiedAttributes(record).length === 0,
  ).length
  const rows = buildUnclassifiedQueue(records, modelUsage)
  const routingComplete = records.filter(isRoutingComplete).length
  const queue: ModelMetadataRow[] = rows.map((row) => ({
    ...row.metadata,
    calls: row.calls,
    missing: row.missing,
    critical: row.critical,
    gapKind:
      gapKindByKey.get(`${row.metadata.providerId}\u0000${row.metadata.displayName}`)
      ?? 'missing-field',
  }))

  return {
    generatedAt: new Date(nowMs).toISOString(),
    totals: {
      models: records.length,
      routingComplete,
      routingIncomplete: records.length - routingComplete,
      routingIncompleteByKind: incompleteByKind,
      fullyAnnotated,
    },
    coverage,
    queue,
    coverageGaps: coverageGapsOf(coverage),
  }
}
