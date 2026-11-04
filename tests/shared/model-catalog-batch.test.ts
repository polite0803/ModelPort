import test from 'node:test'
import assert from 'node:assert/strict'

const {
  CATALOG_BATCH_AUTO_FIELDS,
  catalogBatchBackoffDelayMs,
  classifyCatalogBatchRow,
  estimateCatalogBatchPlan,
  factNeedsProbe,
  isCatalogBatchActive,
  mergeCatalogBatchFailure,
  planCatalogBatchItem,
} = await import('../../src/shared/modelCatalogBatch.ts')

type Fact<T> = import('../../src/shared/modelMetadata.ts').Fact<T>
type ModelMetadataRow = import('../../src/shared/modelMetadata.ts').ModelMetadataRow
type ResolvedModelType = import('../../src/shared/modelMetadata.ts').ResolvedModelType
type InputModality = import('../../src/shared/types.ts').InputModality
type CatalogEntry = import('../../src/shared/modelCatalog.ts').CatalogEntry
type CatalogMatch = import('../../src/shared/modelCatalog.ts').CatalogMatch
type CatalogAdoption = import('../../src/shared/modelCatalog.ts').CatalogAdoption

const unknownFact = <T,>(): Fact<T> => ({ state: 'unclassified' })
const known = <T>(
  value: T,
  confidence: 'declared' | 'inferred' | 'measured' = 'inferred',
  source = 'catalog',
): Fact<T> => ({ state: 'known', value, source: source as never, confidence })

const row = (overrides: Partial<ModelMetadataRow> = {}): ModelMetadataRow => ({
  providerId: 'provider-a',
  displayName: 'gpt-4o',
  actualModelId: 'gpt-4o',
  modelType: unknownFact<ResolvedModelType>(),
  vision: unknownFact<'yes' | 'no' | 'unknown'>(),
  tools: unknownFact<'yes' | 'no' | 'unknown'>(),
  reasoning: unknownFact<'yes' | 'no' | 'unknown'>(),
  modalities: unknownFact<InputModality[]>(),
  contextTokens: unknownFact<number>(),
  maxOutputTokens: unknownFact<number>(),
  weight: unknownFact<number>(),
  free: unknownFact<boolean>(),
  calls: 3,
  missing: [],
  ...overrides,
})

const entry = (overrides: Partial<CatalogEntry> & { id: string }): CatalogEntry => ({
  catalogId: `litellm::${overrides.id}`,
  source: 'litellm',
  ...overrides,
})

test('exact/alias 自动采用字段，family 不采用；价格永不在自动采用范围', () => {
  const match: CatalogMatch = {
    confidence: 'exact',
    entry: entry({
      id: 'gpt-4o',
      contextTokens: 128000,
      maxOutputTokens: 16384,
      vision: 'yes',
      tools: 'yes',
      price: { inputPerMillion: 2.5, currency: 'USD' },
    }),
  }
  const plan = planCatalogBatchItem(row(), [match])
  assert.equal(plan.matchConfidence, 'exact')
  assert.equal(plan.matchCatalogId, 'litellm::gpt-4o')
  assert.deepEqual(plan.adoptFields, ['contextTokens', 'maxOutputTokens', 'vision', 'tools'])
  assert.ok(!CATALOG_BATCH_AUTO_FIELDS.includes('price' as never))
  // 已采用 context/output，不再重复探测这两个 scope。
  assert.deepEqual(plan.probeScopes, [])

  const alias = planCatalogBatchItem(row(), [{ ...match, confidence: 'alias' }])
  assert.equal(alias.matchConfidence, 'alias')
  assert.deepEqual(alias.adoptFields, plan.adoptFields)

  const family = planCatalogBatchItem(row(), [{ ...match, confidence: 'family' }])
  assert.equal(family.matchConfidence, undefined)
  assert.equal(family.familyCandidate, true)
  assert.deepEqual(family.adoptFields, [])
  // family 不采用，但仍可能按需探测未标注的 context/output。
  assert.deepEqual(family.probeScopes, ['context', 'output'])
})

test('人工/上游声明字段不进入采用与探测；inferred 才需要探测', () => {
  // 条目里只有 context：context 已被上游声明，不得覆盖；output 由 inferred 待实测。
  const match: CatalogMatch = {
    confidence: 'exact',
    entry: entry({ id: 'gpt-4o', contextTokens: 128000 }),
  }
  const plan = planCatalogBatchItem(
    row({
      contextTokens: known(200000, 'declared', 'upstream'),
      maxOutputTokens: known(8192, 'inferred', 'family-rule'),
    }),
    [match],
  )
  assert.deepEqual(plan.adoptFields, [])
  assert.deepEqual(plan.probeScopes, ['output'])
  assert.equal(plan.probeRequests, plan.probePlans[0].requestCount)
  assert.ok(plan.probeTokens > 0)

  assert.equal(factNeedsProbe(known(1, 'measured')), false)
  assert.equal(factNeedsProbe(known(1, 'declared')), false)
  assert.equal(factNeedsProbe(known(1, 'inferred')), true)
  assert.equal(factNeedsProbe(unknownFact<number>()), true)
})

test('预算合计：模型、字段、探测模型、请求数与 token 数', () => {
  const exact: CatalogMatch = {
    confidence: 'exact',
    entry: entry({ id: 'gpt-4o', contextTokens: 128000, maxOutputTokens: 16384 }),
  }
  const alias: CatalogMatch = {
    confidence: 'alias',
    entry: entry({ id: 'claude-sonnet-4', contextTokens: 200000 }),
  }
  const family: CatalogMatch = {
    confidence: 'family',
    entry: entry({ id: 'claude-other' }),
  }
  const items = [
    planCatalogBatchItem(row(), [exact]),
    planCatalogBatchItem(
      row({ displayName: 'claude-sonnet-4', actualModelId: 'claude-sonnet-4' }),
      [alias],
    ),
    planCatalogBatchItem(
      row({ displayName: 'claude-x', actualModelId: 'claude-x' }),
      [family],
    ),
  ]
  const estimate = estimateCatalogBatchPlan(items)
  assert.equal(estimate.models, 3)
  assert.equal(estimate.exactModels, 1)
  assert.equal(estimate.aliasModels, 1)
  assert.equal(estimate.familyCandidates, 1)
  assert.equal(estimate.fields, 3)
  assert.ok(estimate.probeModels >= 0)
  assert.equal(
    estimate.requests,
    items.reduce((sum, item) => sum + item.probeRequests, 0),
  )
  assert.equal(
    estimate.tokens,
    items.reduce((sum, item) => sum + item.probeTokens, 0),
  )
  // 停用/未被路由引用的模型计入独立计数，不影响“计划内模型”口径。
  assert.equal(estimateCatalogBatchPlan(items, 2).skippedDisabled, 2)
})

test('三态判定：一成功一 429 是 partial，不是 done', () => {
  // context 成功、output 429：旧实现只看到“有成功”就返回 done，
  // 丢掉 error/errorKind，退避与「仅重试失败项」都会失效。
  const partial = classifyCatalogBatchRow({
    adopted: 1,
    measuredFields: 1,
    adoptFields: 1,
    probeScopes: 2,
    errors: ['output: 429 rate limited'],
    errorKind: 'rate-limit',
    alias: false,
  })
  assert.equal(partial.status, 'partial')
  assert.equal(partial.error, 'output: 429 rate limited')
  assert.equal(partial.errorKind, 'rate-limit')
  assert.equal(partial.measuredFields, 1)

  const failed = classifyCatalogBatchRow({
    adopted: 0,
    measuredFields: 0,
    adoptFields: 2,
    probeScopes: 2,
    errors: ['output: 500 upstream error'],
    errorKind: 'upstream',
    alias: false,
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.errorKind, 'upstream')

  const done = classifyCatalogBatchRow({
    adopted: 2,
    measuredFields: 0,
    adoptFields: 2,
    probeScopes: 0,
    errors: [],
    alias: false,
  })
  assert.equal(done.status, 'done')

  // 没有可做的事（family 候选且字段都已声明）按声明级跳过，仍是 done。
  const noWork = classifyCatalogBatchRow({
    adopted: 0,
    measuredFields: 0,
    adoptFields: 0,
    probeScopes: 0,
    errors: [],
    alias: false,
  })
  assert.equal(noWork.status, 'done')

  const aborted = classifyCatalogBatchRow({
    adopted: 1,
    measuredFields: 1,
    adoptFields: 1,
    probeScopes: 2,
    errors: ['output: 429'],
    errorKind: 'rate-limit',
    alias: false,
    aborted: true,
  })
  assert.equal(aborted.status, 'skipped')
})

test('429 退避按 streak 指数递增并在 30s 封顶', () => {
  assert.equal(catalogBatchBackoffDelayMs(0), 2_000)
  assert.equal(catalogBatchBackoffDelayMs(1), 4_000)
  assert.equal(catalogBatchBackoffDelayMs(2), 8_000)
  assert.equal(catalogBatchBackoffDelayMs(3), 16_000)
  assert.equal(catalogBatchBackoffDelayMs(4), 30_000)
  assert.equal(catalogBatchBackoffDelayMs(9), 30_000)
})

test('失败清单按模型去重：重复 resume / 重跑不增长同一行', () => {
  const first = mergeCatalogBatchFailure([], {
    providerId: 'provider-a',
    displayName: 'gpt-4o',
    error: '429',
  })
  const again = mergeCatalogBatchFailure(first, {
    providerId: 'provider-a',
    displayName: 'gpt-4o',
    error: '429 rate limited',
  })
  assert.equal(again.length, 1)
  assert.equal(again[0].error, '429 rate limited')

  const second = mergeCatalogBatchFailure(again, {
    providerId: 'provider-b',
    displayName: 'claude-3',
    error: 'timeout',
  })
  assert.equal(second.length, 2)
})

test('并发 start：running/paused 拒绝；cancel/done/failed 允许重跑', () => {
  assert.equal(isCatalogBatchActive('running'), true)
  assert.equal(isCatalogBatchActive('paused'), true)
  // 取消后再次点「全部补齐」必须允许 —— 这正是「cancel 后 start」路径。
  assert.equal(isCatalogBatchActive('cancelled'), false)
  assert.equal(isCatalogBatchActive('done'), false)
  assert.equal(isCatalogBatchActive('failed'), false)
})

test('断点续跑：已有 adoption 的字段不再采用、也不再探测', () => {
  const match: CatalogMatch = {
    confidence: 'exact',
    entry: entry({
      id: 'gpt-4o',
      contextTokens: 128000,
      maxOutputTokens: 16384,
      vision: 'yes',
      tools: 'yes',
    }),
  }
  const adoptions: CatalogAdoption[] = [
    {
      providerId: 'provider-a',
      displayName: 'gpt-4o',
      catalogId: 'litellm::gpt-4o',
      field: 'contextTokens',
      value: 128000,
      source: 'litellm',
      evidenceId: 'litellm::gpt-4o',
      adoptedAt: '2026-11-04T00:00:00.000Z',
    },
    {
      providerId: 'provider-a',
      displayName: 'gpt-4o',
      catalogId: 'litellm::gpt-4o',
      field: 'maxOutputTokens',
      value: 16384,
      source: 'litellm',
      evidenceId: 'litellm::gpt-4o',
      adoptedAt: '2026-11-04T00:00:00.000Z',
    },
  ]
  const plan = planCatalogBatchItem(row(), [match], adoptions)
  // 去重键是 provider/model/field（`catalogAdoptionKey`），不按 catalogId：
  // 换一份匹配条目也不会重复写 adoption。
  assert.deepEqual(plan.adoptFields, ['vision', 'tools'])
  assert.deepEqual(plan.probeScopes, [])
  assert.equal(estimateCatalogBatchPlan([plan]).fields, 2)
})
