import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  CATALOG_SOURCES,
  EMPTY_CATALOG_STORE,
  adoptionsForModel,
  buildCatalogIndex,
  catalogAdoptionHint,
  catalogFieldValue,
  catalogSnapshotStatuses,
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
  assert.equal(parsed.length, 1)
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

test('三个来源的解析器用本地 fixture：字段、单位换算与坏条目丢弃', () => {
  const modelsDev = parseModelsDev(fixture('models-dev.json'))
  assert.equal(modelsDev.length, 1, '没有任何可用字段的条目被丢弃')
  assert.equal(modelsDev[0].id, 'claude-sonnet-4-20250514')
  assert.equal(modelsDev[0].provider, 'anthropic')
  assert.equal(modelsDev[0].contextTokens, 200000)
  assert.equal(modelsDev[0].maxOutputTokens, 8192)
  assert.deepEqual(modelsDev[0].modalities, ['text', 'image'])
  assert.equal(modelsDev[0].vision, 'yes')
  assert.equal(modelsDev[0].tools, 'yes')
  assert.deepEqual(modelsDev[0].price, {
    inputPerMillion: 3,
    outputPerMillion: 15,
    currency: 'USD',
  })

  const litellm = parseLiteLLM(fixture('litellm.json'))
  assert.equal(litellm.length, 2, 'sample_spec 被跳过')
  const gpt = litellm.find((item) => item.id === 'gpt-4o')!
  assert.equal(gpt.contextTokens, 128000)
  assert.equal(gpt.maxOutputTokens, 16384)
  assert.equal(gpt.vision, 'yes')
  assert.equal(gpt.tools, 'yes')
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

  const openrouter = parseOpenRouter(fixture('openrouter.json'))
  assert.equal(openrouter.length, 1)
  assert.equal(openrouter[0].contextTokens, 131072)
  assert.equal(openrouter[0].maxOutputTokens, 8192)
  assert.deepEqual(openrouter[0].modalities, ['text', 'image'])
  assert.equal(openrouter[0].vision, 'yes')
  assert.equal(openrouter[0].tools, 'yes')
  assert.deepEqual(openrouter[0].price, {
    inputPerMillion: 3,
    outputPerMillion: 15,
    currency: 'USD',
  })
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
