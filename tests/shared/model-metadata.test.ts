import test from 'node:test'
import assert from 'node:assert/strict'

const {
  METADATA_ATTRIBUTES,
  METADATA_SOURCE_PRIORITY,
  buildUnclassifiedQueue,
  computeMetadataCoverage,
  deriveModelType,
  mergeModelMetadata,
  metadataSourceRank,
  metadataToHint,
  unclassifiedAttributes,
} = await import('../../src/shared/modelMetadata.ts')
const {
  MODEL_FAMILY_RULES,
  familyRuleLayer,
  matchFamilyRules,
  normalizeFamilyModelName,
} = await import('../../src/shared/modelFamilyRules.ts')
const {
  MODEL_PROBE_TTL_DAYS,
  probeFreshness,
  probeRowToLayer,
  sanitizeProbeSidecar,
  upsertProbeRow,
} = await import('../../src/shared/modelProbe.ts')

type Layer = import('../../src/shared/modelMetadata.ts').MetadataLayer

const base = (overrides: Partial<Layer> = {}): Layer => ({
  source: 'upstream',
  confidence: 'declared',
  hint: {},
  ...overrides,
})

const resolve = (layers: Layer[]) =>
  mergeModelMetadata({
    providerId: 'provider-a',
    displayName: 'model-x',
    actualModelId: 'model-x',
    layers,
  })

test('优先级表固定为 manual > upstream > catalog > probe > family-rule > cost-ledger', () => {
  const ranks = METADATA_SOURCE_PRIORITY.map((source) => metadataSourceRank(source))
  assert.deepEqual(ranks, [0, 1, 2, 3, 4, 5])
  assert.equal(metadataSourceRank('unclassified'), METADATA_SOURCE_PRIORITY.length)
  assert.equal(METADATA_SOURCE_PRIORITY[0], 'manual')
  assert.equal(METADATA_SOURCE_PRIORITY[2], 'catalog')
  assert.equal(METADATA_SOURCE_PRIORITY[METADATA_SOURCE_PRIORITY.length - 1], 'cost-ledger')
})

test('人工标记覆盖上游声明与家族规则，且来源落在 manual', () => {
  const metadata = resolve([
    base({ source: 'family-rule', confidence: 'inferred', hint: { contextTokens: 131072 } }),
    base({ source: 'upstream', hint: { contextTokens: 262144 } }),
    base({ source: 'manual', hint: { contextTokens: 32768 } }),
  ])
  assert.equal(metadata.contextTokens.state, 'known')
  assert.equal(metadata.contextTokens.value, 32768)
  assert.equal(metadata.contextTokens.source, 'manual')
  assert.equal(metadata.contextTokens.confidence, 'declared')
})

test('标准库采用值不得覆盖人工标记或上游声明，只在两者缺席时补位', () => {
  const manualWins = resolve([
    base({ source: 'manual', hint: { contextTokens: 32768 } }),
    base({ source: 'upstream', hint: { contextTokens: 262144 } }),
    base({ source: 'catalog', confidence: 'inferred', hint: { contextTokens: 200000 } }),
  ])
  assert.equal(manualWins.contextTokens.source, 'manual')
  assert.equal(manualWins.contextTokens.value, 32768)

  const upstreamWins = resolve([
    base({ source: 'upstream', hint: { contextTokens: 262144 } }),
    base({ source: 'catalog', confidence: 'inferred', hint: { contextTokens: 200000 } }),
  ])
  assert.equal(upstreamWins.contextTokens.source, 'upstream')
  assert.equal(upstreamWins.contextTokens.value, 262144)

  const catalogWins = resolve([
    base({ source: 'catalog', confidence: 'inferred', hint: { contextTokens: 200000 } }),
    base({ source: 'probe', confidence: 'measured', hint: { contextTokens: 180000 } }),
  ])
  assert.equal(catalogWins.contextTokens.source, 'catalog')
  assert.equal(catalogWins.contextTokens.value, 200000)
})

test('上游缺失时家族规则补位；全层缺席时保持 unclassified，绝不产出假值', () => {
  const withRule = resolve([
    base({ source: 'family-rule', confidence: 'inferred', hint: { tools: 'yes' } }),
  ])
  assert.equal(withRule.tools.state, 'known')
  assert.equal(withRule.tools.value, 'yes')
  assert.equal(withRule.tools.source, 'family-rule')

  const empty = resolve([])
  assert.deepEqual(
    unclassifiedAttributes(empty).sort(),
    [...METADATA_ATTRIBUTES].sort(),
  )
  for (const attribute of METADATA_ATTRIBUTES) {
    assert.equal(empty[attribute].state, 'unclassified', `${attribute} 必须是 unclassified`)
    assert.equal('value' in empty[attribute], false)
  }
})

test('probe 覆盖家族规则（按给定优先级），没有实测时规则补位；过期行不参与', () => {
  const probeWins = resolve([
    base({ source: 'probe', confidence: 'measured', hint: { tools: 'no' } }),
    base({ source: 'family-rule', confidence: 'inferred', hint: { tools: 'yes' } }),
  ])
  assert.equal(probeWins.tools.value, 'no')
  assert.equal(probeWins.tools.source, 'probe')

  const layer = probeRowToLayer({
    providerId: 'provider-a',
    displayName: 'model-x',
    actualModelId: 'model-x',
    asOf: new Date().toISOString(),
    tools: 'no',
  })
  assert.ok(layer)
  const probeOnly = resolve([base(layer)])
  assert.equal(probeOnly.tools.value, 'no')
  assert.equal(probeOnly.tools.source, 'probe')
  assert.equal(probeOnly.tools.confidence, 'measured')

  const expired = probeRowToLayer({
    providerId: 'provider-a',
    displayName: 'model-x',
    actualModelId: 'model-x',
    asOf: '2020-01-01T00:00:00.000Z',
    tools: 'no',
  })
  assert.equal(expired, undefined)
})

test('modelType 由 modalities/vision 派生，两者都未知时为 unclassified', () => {
  const viaModalities = resolve([base({ hint: { modalities: ['text', 'image'] } })])
  assert.equal(viaModalities.modelType.state, 'known')
  assert.equal(viaModalities.modelType.value, 'multimodal')

  const viaVisionNo = resolve([base({ hint: { vision: 'no' } })])
  assert.equal(viaVisionNo.modelType.value, 'text')

  const unknown = resolve([])
  assert.equal(unknown.modelType.state, 'unclassified')

  assert.deepEqual(
    deriveModelType({ state: 'unclassified' }, { state: 'unclassified' }),
    { state: 'unclassified' },
  )
})

test('coverage 分母同源，queue 只留缺失行并按调用量降序', () => {
  const full = resolve([
    base({
      hint: {
        tools: 'yes',
        vision: 'no',
        reasoning: 'no',
        modalities: ['text'],
        contextTokens: 131072,
        maxOutputTokens: 16384,
        weight: 1,
        free: false,
      },
    }),
  ])
  const sparse = mergeModelMetadata({
    providerId: 'provider-b',
    displayName: 'sparse-model',
    actualModelId: 'sparse-model',
    layers: [],
  })

  const coverage = computeMetadataCoverage([full, sparse])
  assert.equal(coverage.contextTokens.total, 2)
  assert.equal(coverage.contextTokens.known, 1)
  assert.equal(coverage.contextTokens.rate, 0.5)
  assert.equal(coverage.maxOutputTokens.known, 1)
  assert.deepEqual(coverage.modelType, {
    known: 1,
    total: 2,
    rate: 0.5,
  })

  const queue = buildUnclassifiedQueue([sparse, full], { 'sparse-model': 7, 'model-x': 99 })
  assert.equal(queue.length, 1)
  assert.equal(queue[0].metadata.displayName, 'sparse-model')
  assert.equal(queue[0].calls, 7)
  assert.ok(queue[0].missing.includes('contextTokens'))
})

test('手工保存输出上限后，该属性从 unclassified 变成已标注（来源 manual）', () => {
  const before = resolve([])
  assert.equal(before.maxOutputTokens.state, 'unclassified')

  const after = resolve([
    base({ source: 'manual', hint: { maxOutputTokens: 8192 } }),
  ])
  assert.equal(after.maxOutputTokens.state, 'known')
  assert.equal(after.maxOutputTokens.value, 8192)
  assert.equal(after.maxOutputTokens.source, 'manual')
  assert.equal(after.maxOutputTokens.confidence, 'declared')
  assert.equal(after.maxOutputTokens.evidence, undefined)
})

test('metadataToHint 只保留已知字段，不把 unclassified 变成默认值', () => {
  const metadata = resolve([base({ hint: { tools: 'yes', contextTokens: 1000 } })])
  const hint = metadataToHint(metadata)
  assert.deepEqual(hint, { tools: 'yes', contextTokens: 1000 })
})

test('探测 sidecar: TTL 30 天、坏数据丢弃、同键替换', () => {
  assert.equal(MODEL_PROBE_TTL_DAYS, 30)
  const now = Date.parse('2026-11-04T00:00:00.000Z')
  assert.equal(probeFreshness('2026-10-20T00:00:00.000Z', now), 'fresh')
  assert.equal(probeFreshness('2026-09-01T00:00:00.000Z', now), 'expired')
  assert.equal(probeFreshness('not-a-date', now), 'expired')

  const sanitized = sanitizeProbeSidecar({
    rows: [
      {
        providerId: 'p',
        displayName: 'ok',
        actualModelId: 'ok',
        asOf: '2026-11-01T00:00:00.000Z',
        tools: 'maybe',
        contextTokens: 0,
      },
      { providerId: 1, displayName: 'bad', actualModelId: 'bad', asOf: 'x' },
    ],
  })
  assert.equal(sanitized.rows.length, 1)
  assert.equal(sanitized.rows[0].tools, undefined)
  assert.equal(sanitized.rows[0].contextTokens, undefined)

  const replaced = upsertProbeRow(
    [{ providerId: 'p', displayName: 'm', actualModelId: 'm', asOf: 'old', tools: 'no' }],
    { providerId: 'p', displayName: 'm', actualModelId: 'm', asOf: 'new', tools: 'yes' },
  )
  assert.equal(replaced.length, 1)
  assert.equal(replaced[0].tools, 'yes')
})

test('家族规则：带 provider 前缀也能命中，未命中返回 undefined，每条都有依据', () => {
  assert.equal(normalizeFamilyModelName('openai/gpt-oss-120b'), 'gpt-oss-120b')
  assert.deepEqual(
    matchFamilyRules('openai/gpt-oss-120b').map((rule) => rule.id),
    ['openai-gpt-oss'],
  )
  assert.deepEqual(
    matchFamilyRules('moonshot/kimi-k2.6').map((rule) => rule.id),
    ['moonshot-kimi-k2'],
  )
  assert.equal(matchFamilyRules('totally-custom-model').length, 0)
  assert.equal(familyRuleLayer('totally-custom-model'), undefined)

  const layer = familyRuleLayer('openai/gpt-oss-120b')
  assert.ok(layer)
  assert.equal(layer?.source, 'family-rule')
  assert.equal(layer?.confidence, 'inferred')
  assert.equal(layer?.hint.contextTokens, 131072)
  assert.equal(layer?.hint.tools, 'yes')

  for (const rule of MODEL_FAMILY_RULES) {
    assert.ok(rule.evidence.length > 0, `${rule.id} 必须写明依据`)
  }
})
