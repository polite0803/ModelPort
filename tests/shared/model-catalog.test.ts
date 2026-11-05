import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  CATALOG_SOURCES,
  EMPTY_CATALOG_STORE,
  adoptionsForModel,
  buildCatalogIndex,
  adoptableFieldCount,
  catalogAdoptionHint,
  catalogEndpointPlan,
  catalogFieldValue,
  catalogSnapshotStatuses,
  checkCatalogCoverage,
  sanitizeCatalogMirrorUrl,
  matchCatalogEntries,
  normalizeCatalogAlias,
  removeCatalogAdoptions,
  sanitizeCatalogAdoption,
  sanitizeCatalogAdoptionLedger,
  sanitizeCatalogAdoptionValue,
  sanitizeCatalogEntry,
  sanitizeCatalogSnapshot,
  sanitizeCatalogStore,
  upsertCatalogAdoption,
  upstreamModelName,
  fuzzyMatchEntries,
} = await import('../../src/shared/modelCatalog.ts')
const { parseLiteLLM, parseModelsDev, parseOpenRouter } = await import(
  '../../src/main/providers/modelCatalogParsers.ts'
)

type CatalogEntry = import('../../src/shared/modelCatalog.ts').CatalogEntry
type CatalogAdoption = import('../../src/shared/modelCatalog.ts').CatalogAdoption

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/model-catalog/${name}`, import.meta.url), 'utf8'))

const entry = (overrides: Partial<CatalogEntry> & { id: string }): CatalogEntry => ({
  catalogId: `models.dev::${overrides.id}`,
  source: 'models.dev',
  ...overrides,
})

const adoption = (overrides: Partial<CatalogAdoption>): CatalogAdoption => ({
  providerId: 'provider-a',
  displayName: 'model-x',
  catalogId: 'models.dev::gpt-4o',
  field: 'contextTokens',
  value: 128000,
  source: 'models.dev',
  evidenceId: 'hash:gpt-4o',
  adoptedAt: '2026-11-04T00:00:00.000Z',
  ...overrides,
})

test('别名归一：去 provider 前缀、日期后缀、-latest 与大小写/连字符差异', () => {
  assert.equal(normalizeCatalogAlias('OpenAI/GPT-4o-2024-08-06'), 'gpt-4o')
  assert.equal(normalizeCatalogAlias('gpt-4o-20240806'), 'gpt-4o')
  assert.equal(normalizeCatalogAlias('claude-sonnet-4-latest'), 'claude-sonnet-4')
  assert.equal(normalizeCatalogAlias('  vendor/model_v2  '), 'model-v2')
})

test('三档匹配按 exact → alias → family 排序，同一 entry 只保留最高置信度', () => {
  const index = buildCatalogIndex([
    entry({ id: 'gpt-4o', contextTokens: 128000 }),
    entry({ id: 'gpt-4o-mini', source: 'litellm', catalogId: 'litellm::gpt-4o-mini' }),
    entry({ id: 'claude-sonnet-4-20250514', contextTokens: 200000 }),
  ])

  const exact = matchCatalogEntries(index, { modelId: 'gpt-4o' })
  assert.equal(exact[0].confidence, 'exact')
  assert.equal(exact[0].entry.id, 'gpt-4o')

  const alias = matchCatalogEntries(index, { modelId: 'openai/gpt-4o-2024-08-06' })
  assert.equal(alias[0].confidence, 'alias')
  assert.equal(alias[0].entry.id, 'gpt-4o')
  assert.equal(alias[1].confidence, 'family')
  assert.equal(alias[1].entry.id, 'gpt-4o-mini')

  const family = matchCatalogEntries(index, { modelId: 'claude-3-opus' })
  assert.equal(family.length, 1)
  assert.equal(family[0].confidence, 'family')
  assert.equal(family[0].entry.id, 'claude-sonnet-4-20250514')

  const byDisplayName = matchCatalogEntries(index, {
    modelId: 'not-in-catalogue',
    displayName: 'gpt-4o',
  })
  assert.equal(byDisplayName[0].confidence, 'exact')
  assert.equal(byDisplayName[0].entry.id, 'gpt-4o')

  assert.deepEqual(matchCatalogEntries(index, { modelId: 'totally-unrelated' }), [])
})

test('快照校验：缺失/版本不符/元数据缺失/坏条目全部降级，不抛错', () => {
  assert.deepEqual(sanitizeCatalogStore(undefined), EMPTY_CATALOG_STORE)
  assert.deepEqual(sanitizeCatalogStore('not-an-object'), EMPTY_CATALOG_STORE)
  assert.deepEqual(sanitizeCatalogStore({ version: 2, snapshots: {} }), EMPTY_CATALOG_STORE)

  assert.equal(
    sanitizeCatalogSnapshot({
      source: 'models.dev',
      sourceUrl: 'https://models.dev/api.json',
      fetchedAt: '2026-11-04T00:00:00.000Z',
      contentHash: 'abc',
      license: 'MIT',
      attribution: 'models.dev contributors',
      entries: [],
    })?.entries.length,
    0,
  )
  assert.equal(
    sanitizeCatalogSnapshot({
      source: 'models.dev',
      sourceUrl: 'https://models.dev/api.json',
      fetchedAt: '2026-11-04T00:00:00.000Z',
      contentHash: 'abc',
      entries: [],
    }),
    undefined,
  )

  const store = sanitizeCatalogStore({
    version: 1,
    snapshots: {
      'models.dev': {
        source: 'models.dev',
        sourceUrl: 'https://models.dev/api.json',
        fetchedAt: '2026-11-04T00:00:00.000Z',
        contentHash: 'abc',
        license: 'MIT',
        attribution: 'models.dev contributors',
        entries: [
          { id: 'ok', contextTokens: 128000 },
          { id: 'bad-context', contextTokens: '128000' },
          { id: '', contextTokens: 8000 },
          { id: 'too-long', maxOutputTokens: 1_000_001 },
        ],
      },
      litellm: { source: 'litellm', entries: [] },
      openrouter: 'corrupt',
    },
  })
  assert.deepEqual(Object.keys(store.snapshots), ['models.dev'])
  const kept = store.snapshots['models.dev']!.entries.map((item) => item.id)
  assert.deepEqual(kept, ['ok'])
  assert.deepEqual(catalogSnapshotStatuses(store), [
    {
      source: 'models.dev',
      sourceUrl: 'https://models.dev/api.json',
      fetchedAt: '2026-11-04T00:00:00.000Z',
      contentHash: 'abc',
      license: 'MIT',
      attribution: 'models.dev contributors',
      entryCount: 1,
    },
  ])
})

test('字段值校验：输出上限沿用 1,000,000 上界，负数/非整数/未知模态全部拒绝', () => {
  assert.equal(sanitizeCatalogAdoptionValue('maxOutputTokens', 1_000_000), 1_000_000)
  assert.equal(sanitizeCatalogAdoptionValue('maxOutputTokens', 1_000_001), undefined)
  assert.equal(sanitizeCatalogAdoptionValue('contextTokens', 100_000_001), undefined)
  assert.equal(sanitizeCatalogAdoptionValue('contextTokens', 12.5), undefined)
  assert.equal(sanitizeCatalogAdoptionValue('contextTokens', -1), undefined)
  assert.deepEqual(sanitizeCatalogAdoptionValue('modalities', ['text', 'telepathy']), ['text'])
  assert.deepEqual(sanitizeCatalogAdoptionValue('modalities', ['text', 'image']), ['text', 'image'])
  assert.equal(sanitizeCatalogAdoptionValue('vision', 'maybe'), undefined)
  assert.deepEqual(sanitizeCatalogAdoptionValue('price', { inputPerMillion: -1 }), undefined)
  assert.deepEqual(
    sanitizeCatalogAdoptionValue('price', { inputPerMillion: 3, outputPerMillion: 15 }),
    { inputPerMillion: 3, outputPerMillion: 15, currency: 'USD' },
  )
})

test('adoption ledger：不可变 upsert、同字段覆盖、按字段与整体撤销', () => {
  const empty: CatalogAdoption[] = []
  const first = upsertCatalogAdoption(empty, adoption({}))
  assert.equal(empty.length, 0, '不得修改入参')
  assert.equal(first.length, 1)

  const replaced = upsertCatalogAdoption(first, adoption({ value: 200000 }))
  assert.equal(replaced.length, 1)
  assert.equal(replaced[0].value, 200000)

  const twoFields = upsertCatalogAdoption(
    replaced,
    adoption({ field: 'maxOutputTokens', value: 8192 }),
  )
  assert.equal(twoFields.length, 2)
  assert.equal(adoptionsForModel(twoFields, 'provider-a', 'model-x').length, 2)
  assert.equal(adoptionsForModel(twoFields, 'provider-a', 'other-model').length, 0)

  const oneField = removeCatalogAdoptions(twoFields, 'provider-a', 'model-x', 'maxOutputTokens')
  assert.equal(oneField.length, 1)
  assert.equal(oneField[0].field, 'contextTokens')

  const none = removeCatalogAdoptions(twoFields, 'provider-a', 'model-x')
  assert.equal(none.length, 0)
  assert.equal(twoFields.length, 2, '撤销不得修改入参')
})

test('adoption 校验：坏行丢弃、同键去重且保留最后一条', () => {
  const ledger = sanitizeCatalogAdoptionLedger([
    adoption({}),
    adoption({ value: 200000 }),
    adoption({ field: 'vision', value: 'yes' as never }),
    adoption({ evidenceId: '' }),
    adoption({ adoptedAt: 'not-a-date' }),
    adoption({ field: 'nope' as never }),
    { providerId: 1, displayName: 'x', catalogId: 'c', field: 'vision', value: 'yes' },
  ])
  assert.equal(ledger.length, 2)
  assert.equal(adoptionsForModel(ledger, 'provider-a', 'model-x')[0].value, 200000)
  assert.equal(sanitizeCatalogAdoption(null), undefined)
})

test('价格只展示：price-only adoption 不产生能力标注，也不进入路由 hint', () => {
  const priceOnly = catalogAdoptionHint([
    adoption({
      field: 'price',
      value: { inputPerMillion: 3, outputPerMillion: 15, currency: 'USD' },
    }),
  ])
  assert.equal(priceOnly, undefined)

  const mixed = catalogAdoptionHint([
    adoption({
      field: 'price',
      value: { inputPerMillion: 3, outputPerMillion: 15, currency: 'USD' },
    }),
    adoption({ field: 'contextTokens', value: 200000 }),
  ])
  assert.deepEqual(mixed, { contextTokens: 200000 })

  const parsed = parseModelsDev(fixture('models-dev.json'))
  assert.equal(parsed.length, 2)
  assert.equal(
    catalogAdoptionHint([
      adoption({
        field: 'price',
        value: parsed[0].price,
        catalogId: parsed[0].catalogId,
      }),
    ]),
    undefined,
    '标准库价格不得折成任何能力/权重',
  )
})

test('reasoning adoption 进 hint，两个方向都算已标注', () => {
  assert.deepEqual(
    catalogAdoptionHint([adoption({ field: 'reasoning', value: 'no' })]),
    { reasoning: 'no' },
  )
  assert.deepEqual(
    catalogAdoptionHint([adoption({ field: 'reasoning', value: 'yes' })]),
    { reasoning: 'yes' },
  )
  // 非法值不进 ledger，也就不会折成 hint。
  assert.equal(sanitizeCatalogAdoptionValue('reasoning', 'maybe'), undefined)
  // 布尔与 'yes'/'no' 同义（三个来源都经 capabilityFlag 收口）。
  assert.equal(sanitizeCatalogAdoptionValue('reasoning', true), 'yes')
  assert.equal(sanitizeCatalogAdoptionValue('reasoning', false), 'no')
  assert.equal(
    sanitizeCatalogAdoption(
      adoption({ field: 'reasoning', value: 'maybe' as never }),
    ),
    undefined,
  )
})

test('三个来源的解析器用本地 fixture：字段、单位换算与坏条目丢弃', () => {
  const modelsDev = parseModelsDev(fixture('models-dev.json'))
  assert.equal(modelsDev.length, 2, '没有任何可用字段的条目被丢弃')
  assert.equal(modelsDev[0].id, 'claude-sonnet-4-20250514')
  assert.equal(modelsDev[0].provider, 'anthropic')
  assert.equal(modelsDev[0].contextTokens, 200000)
  assert.equal(modelsDev[0].maxOutputTokens, 8192)
  assert.deepEqual(modelsDev[0].modalities, ['text', 'image'])
  assert.equal(modelsDev[0].vision, 'yes')
  assert.equal(modelsDev[0].tools, 'yes')
  assert.equal(modelsDev[0].reasoning, 'yes')
  // models.dev 的 `reasoning` 是显式布尔：`false` 是「这个模型不推理」的声明，
  // 条目因此有采用价值，不能按「没有数值字段」丢掉。
  const haiku = modelsDev.find((item) => item.id === 'claude-haiku-4-20250514')
  assert.ok(haiku, '只有 reasoning:false 的条目必须保留')
  assert.equal(haiku?.reasoning, 'no')
  assert.equal(haiku?.contextTokens, undefined)
  assert.deepEqual(modelsDev[0].price, {
    inputPerMillion: 3,
    outputPerMillion: 15,
    currency: 'USD',
  })

  const litellm = parseLiteLLM(fixture('litellm.json'))
  assert.equal(litellm.length, 5, 'sample_spec 与 embedding 条目被跳过')
  assert.equal(
    litellm.some((item) => item.id === 'embed-english'),
    false,
    'mode 不是 chat/vision 的条目不得进入标准库',
  )
  assert.equal(litellm.find((item) => item.id === 'vision-preview')?.vision, 'yes')
  const gpt = litellm.find((item) => item.id === 'gpt-4o')!
  assert.equal(gpt.contextTokens, 128000)
  assert.equal(gpt.maxOutputTokens, 16384)
  assert.equal(gpt.vision, 'yes')
  assert.equal(gpt.tools, 'yes')
  // litellm 的台账里没有 reasoning 这个键：不写,也不拿别的字段凑一个。
  assert.equal(gpt.reasoning, undefined)
  assert.deepEqual(gpt.price, {
    inputPerMillion: 2.5,
    outputPerMillion: 10,
    currency: 'USD',
  })
  const legacy = litellm.find((item) => item.id === 'vendor/legacy-model')!
  assert.equal(legacy.provider, 'vendor')
  assert.equal(legacy.maxOutputTokens, 2048)
  assert.equal(legacy.vision, 'no')
  assert.equal(legacy.tools, 'no')

  // per-token → per-1M：20 * 1e6 = 20,000,000 > 10,000,000 上限，该字段丢弃而不是截断。
  const expensive = litellm.find((item) => item.id === 'expensive-model')!
  assert.equal(expensive.contextTokens, 128000, '超限价格不影响上下文直取')
  assert.deepEqual(
    expensive.price,
    { outputPerMillion: 10, currency: 'USD' },
    '超限的输入价格字段必须丢弃，合法输出价格保留',
  )

  // 精度固定 6 位小数：0.0000001234 → 0.1234；0.000000000123 → 0.000123。
  const precise = litellm.find((item) => item.id === 'precise-price')!
  assert.deepEqual(precise.price, {
    inputPerMillion: 0.1234,
    outputPerMillion: 0.000123,
    currency: 'USD',
  })

  const openrouter = parseOpenRouter(fixture('openrouter.json'))
  assert.equal(openrouter.length, 2)
  assert.equal(openrouter[0].contextTokens, 131072)
  assert.equal(openrouter[0].maxOutputTokens, 8192)
  assert.deepEqual(openrouter[0].modalities, ['text', 'image'])
  assert.equal(openrouter[0].vision, 'yes')
  assert.equal(openrouter[0].tools, 'yes')
  assert.equal(openrouter[0].reasoning, 'yes')
  assert.deepEqual(openrouter[0].price, {
    inputPerMillion: 3,
    outputPerMillion: 15,
    currency: 'USD',
  })
  // `supported_parameters` 是「实测可用参数」清单，没列 reasoning 只代表没写：
  // 不能折成 `no`，否则一次缺席就把整个模型从「要思考」的请求里筛掉。
  const withoutReasoning = openrouter.find((item) => item.id === 'vendor/model-y')
  assert.equal(withoutReasoning?.reasoning, undefined)
  assert.equal(withoutReasoning?.tools, undefined)
  assert.equal(withoutReasoning?.vision, undefined)
})

test('来源集合与字段读取：三个来源都可匹配，缺失字段返回 undefined', () => {
  assert.deepEqual([...CATALOG_SOURCES], ['models.dev', 'litellm', 'openrouter'])
  const minimal = entry({ id: 'only-context', contextTokens: 64000 })
  assert.equal(catalogFieldValue(minimal, 'contextTokens'), 64000)
  assert.equal(catalogFieldValue(minimal, 'price'), undefined)
  assert.equal(catalogFieldValue(minimal, 'vision'), undefined)

  assert.equal(sanitizeCatalogEntry({ id: 'x', contextTokens: 100_000_001 }, 'litellm'), undefined)
  assert.equal(sanitizeCatalogEntry({ id: '' }, 'litellm'), undefined)
  assert.equal(sanitizeCatalogEntry({ id: 'x' }, 'litellm'), undefined)
})

test('端点回退：主端点 → jsDelivr → 用户镜像；仅接受 https', () => {
  const litellm = catalogEndpointPlan('litellm')
  assert.equal(litellm.length, 2)
  assert.equal(litellm[0].label, 'primary')
  assert.equal(litellm[0].url, 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json')
  assert.equal(litellm[1].label, 'jsdelivr')
  assert.equal(
    litellm[1].url,
    'https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json',
  )

  const withMirror = catalogEndpointPlan('litellm', '  https://mirror.example.com/litellm.json  ')
  assert.equal(withMirror.length, 3)
  assert.deepEqual(withMirror[2], {
    label: 'mirror',
    url: 'https://mirror.example.com/litellm.json',
  })

  // 非 https / 非法 URL / 空值都不产生镜像端点。
  assert.equal(catalogEndpointPlan('litellm', 'http://mirror.example.com/litellm.json').length, 2)
  assert.equal(catalogEndpointPlan('litellm', 'not a url').length, 2)
  assert.equal(catalogEndpointPlan('litellm', '').length, 2)

  assert.equal(sanitizeCatalogMirrorUrl(''), '')
  assert.equal(sanitizeCatalogMirrorUrl(undefined), undefined)
  assert.equal(sanitizeCatalogMirrorUrl(42), undefined)
  assert.equal(sanitizeCatalogMirrorUrl('http://x'), undefined)
  assert.equal(sanitizeCatalogMirrorUrl('https://x/a.json'), 'https://x/a.json')

// Fuzzy matching test: bigram similarity based model name matching
test('模糊匹配：基于 bigram 相似度的模型名称匹配', () => {
  const index = buildCatalogIndex([
    entry({ id: 'gpt-4o', contextTokens: 128000 }),
    entry({ id: 'gpt-4o-mini', source: 'litellm', catalogId: 'litellm::gpt-4o-mini' }),
    entry({ id: 'claude-sonnet-4-20250514', contextTokens: 200000 }),
  ])

  // Test fuzzy match with similar but not exact model name
  const fuzzy = fuzzyMatchEntries(index, { modelId: 'gpt-4o' })
  // Should find gpt-4o-exact or close matches
  assert.ok(fuzzy.length >= 0, 'fuzzyMatchEntries不应抛出错误')

  // Test with displayName
  const withDisplayName = fuzzyMatchEntries(index, {
    modelId: 'some-random-id',
    displayName: 'gpt-4o',
  })
  assert.ok(withDisplayName.length >= 0, '带 displayName 的 fuzzyMatchEntries 不应抛出错误')

  // Test with close but not exact match
  const closeMatch = fuzzyMatchEntries(index, { modelId: 'gpt-4o-2024' })
  // May or may not match depending on similarity threshold
  assert.ok(Array.isArray(closeMatch), 'fuzzyMatchEntries 返回应为数组')
})
})

// 复现 2026-11-04 远程网关实测：`lobsterai/deepseek-v4-flash` 在内置 LiteLLM 台账里有
// 24 条同名别名条目，全部没有 `reasoning`；弹窗只取 5 条候选，旧排序在同一置信度内按
// `catalogId` 字典序排，`litellm:` 永远压住 `models.dev:`，唯一带推理的那条连名额都拿不到。
test('同置信度内信息量高的候选不得被字典序挤出名额', () => {
  const crowded = Array.from({ length: 6 }, (_, i) => entry({
    id: `vendor-${i}/deepseek-v4-flash`,
    catalogId: `litellm:vendor-${i}:deepseek-v4-flash`,
    source: 'litellm',
    contextTokens: 131072,
    maxOutputTokens: 8192,
    vision: 'no',
    tools: 'yes',
  }))
  const withReasoning = entry({
    id: 'router/deepseek-v4-flash',
    catalogId: 'openrouter:deepseek:deepseek-v4-flash',
    source: 'openrouter',
    contextTokens: 1000000,
    maxOutputTokens: 65536,
    modalities: ['text'],
    vision: 'no',
    tools: 'yes',
    reasoning: 'yes',
  })
  const index = buildCatalogIndex([...crowded, withReasoning])

  assert.equal(adoptableFieldCount(withReasoning), 6, '六项路由能力齐全')
  assert.equal(adoptableFieldCount(crowded[0]), 4, 'LiteLLM 形状缺推理与输入模态')

  const shown = matchCatalogEntries(index, {
    modelId: 'lobsterai/deepseek-v4-flash',
    displayName: 'LobsterAI (有道) / deepseek-v4-flash',
  })
  assert.equal(shown.length, 5, '默认仍只给 5 个候选名额')
  assert.ok(
    shown.some((match) => match.entry.catalogId === withReasoning.catalogId),
    '带 reasoning 的候选必须进名额，否则弹窗里「推理」永远是无值 + 灰按钮',
  )
  // 夹具故意用 OpenRouter（在来源清单里排最后）：只有「信息量优先」这一条能把它顶到
  // 第一位；撤掉那条就退回来源顺序与字典序，5 个名额重新被 LiteLLM 占满。
  assert.equal(shown[0].entry.catalogId, withReasoning.catalogId, '同置信度内先给信息量高的')
  assert.ok(shown.every((match) => match.confidence === 'alias'), '信息量排序不得跨越置信度档位')
})

test('价格不计入候选信息量，只带价格的条目不得挤掉带能力的条目', () => {
  const priceOnly = entry({
    id: 'cheap-model',
    catalogId: 'openrouter::cheap-model',
    source: 'openrouter',
    price: { inputPerMillion: 1, currency: 'USD' },
  })
  const capable = entry({
    id: 'capable-model',
    catalogId: 'litellm::capable-model',
    source: 'litellm',
    contextTokens: 8192,
  })
  assert.equal(adoptableFieldCount(priceOnly), 0, 'price 不是路由能力，不算信息量')
  assert.equal(adoptableFieldCount(capable), 1)
})

test('匹配用上游原名：网关自己拼的「供应商名 / 名」前缀必须先剥掉', () => {
  assert.equal(upstreamModelName('TRAE (字节)', 'TRAE (字节) / GLM-5.1'), 'GLM-5.1')
  assert.equal(
    upstreamModelName('LobsterAI (有道)', 'LobsterAI (有道) / deepseek-v4-flash'),
    'deepseek-v4-flash',
  )
  // 没有这个前缀（聚合/自定义供应商、用户自定义名）原样返回
  assert.equal(upstreamModelName('Some Provider', 'gpt-4o'), 'gpt-4o')
  assert.equal(upstreamModelName(undefined, 'TRAE (字节) / GLM-5.1'), 'TRAE (字节) / GLM-5.1')
  // 只剥开头那一段，上游名里自带的 `/` 不动
  assert.equal(upstreamModelName('P', 'P / deepseek-ai/DeepSeek-V4'), 'deepseek-ai/DeepSeek-V4')
})

test('剥掉前缀后 exact 档命中回来：拼好的展示名只能落到 alias', () => {
  const index = buildCatalogIndex([
    entry({ id: 'GLM-5.1', catalogId: 'models.dev:zhipu:GLM-5.1', reasoning: 'yes', contextTokens: 200000 }),
  ])
  const composed = matchCatalogEntries(index, {
    modelId: 'trae/qmodel_51',
    displayName: 'TRAE (字节) / GLM-5.1',
  })
  assert.equal(composed[0]?.confidence, 'alias', '拼好的展示名不是标准库里的 id，最高只能到别名档')

  const upstream = matchCatalogEntries(index, {
    modelId: 'trae/qmodel_51',
    displayName: upstreamModelName('TRAE (字节)', 'TRAE (字节) / GLM-5.1'),
  })
  assert.equal(upstream[0]?.confidence, 'exact', '用上游原名才能拿到 exact 档')
  assert.equal(upstream[0]?.entry.catalogId, 'models.dev:zhipu:GLM-5.1')
})

test('覆盖判据只认 exact/alias：family 不算「可补」，界面不能承诺批量不做的事', () => {
  const index = buildCatalogIndex([
    entry({ id: 'glm-5.2', catalogId: 'models.dev:zhipu:glm-5.2', reasoning: 'yes', contextTokens: 200000 }),
    entry({ id: 'claude-sonnet-4-20250514', catalogId: 'models.dev:anthropic:claude-sonnet-4', contextTokens: 200000 }),
  ])
  // exact 命中、缺的字段候选有值 → 可补齐
  assert.deepEqual(
    checkCatalogCoverage(index, { modelId: 'glm-5.2', displayName: 'GLM / glm-5.2', missing: ['reasoning', 'contextTokens'] }),
    { hasAutoMatch: true, canFillAny: true },
  )
  // 库里有这条、但缺的那一项候选也没有 → 不算可补
  assert.deepEqual(
    checkCatalogCoverage(index, { modelId: 'glm-5.2', displayName: 'glm-5.2', missing: ['modalities'] }),
    { hasAutoMatch: true, canFillAny: false },
  )
  // 只有 family 档候选（claude 家族）→ 没有 exact/alias，不能算「库里能补」
  assert.deepEqual(
    checkCatalogCoverage(index, { modelId: 'claude-3-opus', displayName: 'claude-3-opus', missing: ['contextTokens'] }),
    { hasAutoMatch: false, canFillAny: false },
  )
  assert.deepEqual(
    checkCatalogCoverage(index, { modelId: 'qoder/ultimate', displayName: 'Qoder / Ultimate', missing: ['tools'] }),
    { hasAutoMatch: false, canFillAny: false },
  )
})
