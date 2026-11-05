import test from 'node:test'
import assert from 'node:assert/strict'

const {
  METADATA_ATTRIBUTES,
  METADATA_SOURCE_PRIORITY,
  REFERENCE_METADATA_ATTRIBUTES,
  ROUTING_METADATA_ATTRIBUTES,
  buildUnclassifiedQueue,
  classifyModelGap,
  computeMetadataCoverage,
  deriveModelType,
  isAttributeApplicable,
  isNonChatModel,
  isRoutingComplete,
  mergeModelMetadata,
  metadataSourceRank,
  metadataToHint,
  routingGapsOf,
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
type ProviderTypeArg = import('../../src/shared/types.ts').ProviderType

const base = (overrides: Partial<Layer> = {}): Layer => ({
  source: 'upstream',
  confidence: 'declared',
  hint: {},
  ...overrides,
})

/** 缺省按 `account`：九项属性全适用，测试里想验证「不适用」要显式换类型。 */
const resolve = (layers: Layer[], providerType: ProviderTypeArg = 'account') =>
  mergeModelMetadata({
    providerId: 'provider-a',
    displayName: 'model-x',
    actualModelId: 'model-x',
    providerType,
    layers,
  })

test('属性分组：六项关键 + 三项参考，互不重叠且并起来就是全表', () => {
  assert.deepEqual(
    [...ROUTING_METADATA_ATTRIBUTES, ...REFERENCE_METADATA_ATTRIBUTES].sort(),
    [...METADATA_ATTRIBUTES].sort(),
  )
  // modelType 由 modalities/vision 派生，算进完整度就是同一份证据数两遍；
  // weight/free 是计费展示，缺了不影响一次请求能不能成。
  assert.deepEqual([...ROUTING_METADATA_ATTRIBUTES], [
    'vision',
    'tools',
    'reasoning',
    'modalities',
    'contextTokens',
    'maxOutputTokens',
  ])
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

test('coverage 分母是适用行：聚合行的 weight 不算缺口；queue 只留缺失行并按调用量降序', () => {
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
  // 聚合 provider 没有倍率这个概念：它的 weight 行既不进分母也不算缺口。
  const sparse = mergeModelMetadata({
    providerId: 'provider-b',
    displayName: 'sparse-model',
    actualModelId: 'sparse-model',
    providerType: 'aggregate',
    layers: [],
  })
  // 关键属性齐、只差参考项（free 无出处）：留在队列里，但不再算「待补」。
  const referenceOnly = mergeModelMetadata({
    providerId: 'provider-a',
    displayName: 'reference-model',
    actualModelId: 'reference-model',
    providerType: 'account',
    layers: [base({
      hint: {
        tools: 'yes',
        vision: 'no',
        reasoning: 'no',
        modalities: ['text'],
        contextTokens: 131072,
        maxOutputTokens: 16384,
        weight: 2,
      },
    })],
  })

  const coverage = computeMetadataCoverage([full, sparse])
  assert.equal(coverage.contextTokens.total, 2)
  assert.equal(coverage.contextTokens.applicable, 2)
  assert.equal(coverage.contextTokens.known, 1)
  assert.equal(coverage.contextTokens.rate, 0.5)
  assert.equal(coverage.maxOutputTokens.known, 1)
  assert.equal(coverage.weight.total, 2)
  assert.equal(coverage.weight.applicable, 1)
  assert.equal(coverage.weight.notApplicable, 1)
  assert.equal(coverage.weight.known, 1)
  assert.equal(coverage.weight.rate, 1)
  assert.deepEqual(coverage.modelType, {
    known: 1,
    total: 2,
    applicable: 2,
    notApplicable: 0,
    rate: 0.5,
  })

  const queue = buildUnclassifiedQueue([sparse, full, referenceOnly], {
    'sparse-model': 7,
    'reference-model': 50,
  })
  // `full` 九项全齐，出队；`referenceOnly` 与 `sparse` 仍有适用缺口，留在队里，
  // 按调用量降序：reference-model(50) 在 sparse-model(7) 之前。
  assert.equal(queue.length, 2)
  assert.equal(queue[0].metadata.displayName, 'reference-model')
  assert.equal(queue[0].critical, false)
  assert.deepEqual(queue[0].missing, ['free'])
  assert.equal(queue[1].metadata.displayName, 'sparse-model')
  assert.equal(queue[1].calls, 7)
  assert.equal(queue[1].critical, true)
  assert.ok(queue[1].missing.includes('contextTokens'))
  // weight 不适用于聚合行：缺它不构成缺口。
  assert.ok(!queue[1].missing.includes('weight'))
  assert.equal(isRoutingComplete(referenceOnly), true)
  assert.deepEqual(routingGapsOf(referenceOnly), [])
})

test('不适用只限 weight/free：关键六项对任何 provider 都算缺口', () => {
  for (const providerType of ['account', 'aggregate', 'custom', 'builtin'] as const) {
    for (const attribute of ROUTING_METADATA_ATTRIBUTES) {
      assert.equal(
        isAttributeApplicable(attribute, providerType),
        true,
        `${attribute} 在 ${providerType} 上必须适用`,
      )
    }
    assert.equal(isAttributeApplicable('weight', providerType), providerType === 'account')
    assert.equal(
      isAttributeApplicable('free', providerType),
      providerType === 'account' || providerType === 'aggregate'
    )
    const empty = resolve([], providerType)
    assert.equal(isRoutingComplete(empty), false)
    assert.equal(unclassifiedAttributes(empty).includes('weight'), providerType === 'account')
  }
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

test('非对话模型是窄口径：图像/向量/重排/TTS 才算，音频对话与翻译仍算对话模型', () => {
  for (const id of [
    'qwen3.7-text-embedding-flash',
    'qwen3.7-text-rerank',
    'qwen-image-2.1-pro',
    'black-forest-labs/FLUX.1-schnell',
    'stable-diffusion-xl-base-v10',
    'nvr-tts-it-it',
  ]) {
    assert.equal(isNonChatModel(id), true, `${id} 应判为非对话模型`)
  }
  // 宁可漏判也不误判：音频对话、实时语音、翻译、omni 都仍按对话模型计。
  for (const id of [
    'qwen-audio-3.1-realtime-flash',
    'qwen3.8-omni-flash-realtime',
    'qwen3.8-livetranslate-flash-realtime',
    'qwen-mt-uni',
    'glm-5.2',
    'DeepSeek-V4.1-Flash',
    'gpt-4o',
  ]) {
    assert.equal(isNonChatModel(id), false, `${id} 不应被判成非对话模型`)
  }
})

test('缺口分桶优先级：不适用 > 能补 > 库里有但缺项 > 库里没有', () => {
  assert.equal(
    classifyModelGap({ modelId: 'qwen-image-2.1-pro', hasAutoMatch: true, canFillAny: true }),
    'not-chat',
    '不适用优先于一切：给图像模型算「关键属性」没有意义',
  )
  assert.equal(
    classifyModelGap({ modelId: 'glm-5.2', hasAutoMatch: true, canFillAny: true }),
    'adoptable',
  )
  assert.equal(
    classifyModelGap({ modelId: 'glm-5.2', hasAutoMatch: true, canFillAny: false }),
    'missing-field',
  )
  assert.equal(
    classifyModelGap({ modelId: 'Qoder / Ultimate', hasAutoMatch: false, canFillAny: false }),
    'no-candidate',
  )
})
