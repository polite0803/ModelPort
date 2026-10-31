import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  AGGREGATE_PLAN_ENTRIES,
  aggregateCostCounts,
  aggregateCostOf,
  aggregateCostUsdOf,
  costBucketOfAggregateClass,
  isPlanEntry,
} from '../../src/shared/aggregateCost.ts'
import {
  AGGREGATE_PRICE,
  AGGREGATE_OFFICIAL_FREE,
  aggregatePriceOf,
  isZeroPrice,
  officialFreeEvidenceOf,
} from '../../src/shared/aggregatePricing.ts'
import { AGGREGATE_REGISTRY, getAggregateEntry } from '../../src/main/providers/aggregate/registry.ts'

/** 旁表里出现、且属于订阅制端点的条目（零价 = 含在套餐里，不是免费）。 */
test('a subscription endpoint never reports its zero marginal price as free', () => {
  for (const entryId of Object.keys(AGGREGATE_PLAN_ENTRIES)) {
    const entry = getAggregateEntry(entryId)
    assert.ok(entry, `${entryId} 在订阅清单里但不在目录`)

    // 该家所有模型都必须是 included，且理由不能是"免费"
    for (const model of entry.models) {
      const signal = aggregateCostOf({
        entryId,
        modelId: model.id,
        ...(entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}),
      })
      assert.notEqual(signal.class, 'free', `${entryId}/${model.id} 被当成免费了`)
      assert.equal(signal.class, 'included', `${entryId}/${model.id} 应为套餐内`)
    }
  }
})

test('a zero price alone is never enough to call a model free on a plan endpoint', () => {
  // zai 的 coding-plan 在 models.dev 上整家零价：老实现会把它当免费池
  const entry = getAggregateEntry('zai')!
  assert.ok(AGGREGATE_PRICE.zai, 'zai 应有零价标价（这是负控的前提）')
  const allZero = Object.values(AGGREGATE_PRICE.zai.models).every(price => isZeroPrice(price))
  assert.equal(allZero, true, 'zai 的标价应全为零，否则这条负控没有意义')

  for (const model of entry.models) {
    const signal = aggregateCostOf({ entryId: 'zai', modelId: model.id })
    assert.equal(signal.class, 'included')
    assert.equal(signal.evidence, 'plan')
    assert.notEqual(costBucketOfAggregateClass(signal.class), 'above-base')
  }
})

test('the pay-as-you-go endpoint of the same vendor keeps its metered prices', () => {
  // zai_api 与 zai 是同一批模型 id，但按量端点必须仍被标成按量 ——
  // 这正是"对齐只认 baseUrl"的意义：不能按品牌名合并。
  const signal = aggregateCostOf({ entryId: 'zai_api', modelId: 'glm-5.2' })
  assert.equal(signal.class, 'priced', 'glm-5.2 在按量端点上不是免费的')
  assert.equal(costBucketOfAggregateClass(signal.class), 'above-base')
  assert.ok(signal.price, '按量分类必须带出标价')
  assert.ok(signal.price!.input > 0)
})

test('official free evidence outranks a catalogue hint and a third-party price', () => {
  // cloudflare 的免费清单来自官方回执
  const modelId = AGGREGATE_OFFICIAL_FREE.cloudflare.models[0]
  const signal = aggregateCostOf({ entryId: 'cloudflare', modelId })
  assert.equal(signal.class, 'free')
  assert.equal(signal.evidence, 'official')
  assert.ok(signal.docUrl && signal.docUrl.startsWith('https://'), '官方证据必须带出处页')
})

test('a catalogue hint without an official source is still free but labelled differently', () => {
  // kilo 的免费清单来自 registry，回执里也有条目，但这里用不在官方表的模型验证回落顺序
  const entry = getAggregateEntry('kilo')!
  const hinted = (entry.freeModelsHint ?? []).find(
    id => officialFreeEvidenceOf('kilo', id) === undefined
  )
  if (hinted === undefined) return // 全部都有官方出处时这条无从验证

  const signal = aggregateCostOf({
    entryId: 'kilo',
    modelId: hinted,
    freeModelsHint: entry.freeModelsHint,
  })
  assert.equal(signal.class, 'free')
  assert.equal(signal.evidence, 'catalogue')
})

test('a model with no evidence at all is unknown, never free', () => {
  // llamacpp 没有任何标价也没有免费清单
  const entry = getAggregateEntry('llamacpp')
  if (entry && entry.models.length > 0) {
    const signal = aggregateCostOf({ entryId: 'llamacpp', modelId: entry.models[0].id })
    assert.equal(signal.class, 'unknown')
  }

  // 任意编造的模型也必须落在 unknown
  const madeUp = aggregateCostOf({ entryId: 'zai_api', modelId: 'not-a-real-model' })
  assert.equal(madeUp.class, 'unknown')
  assert.equal(madeUp.evidence, 'none')
  assert.equal(costBucketOfAggregateClass(madeUp.class), 'unknown')
})

test('unknown stays neutral in scoring instead of being folded into a paid bucket', () => {
  // 未知必须映射到 unknown 档（打分里取中性），而不是 above-base
  assert.equal(costBucketOfAggregateClass('unknown'), 'unknown')
  assert.equal(costBucketOfAggregateClass('free'), 'free')
  assert.equal(costBucketOfAggregateClass('included'), 'free')
  assert.equal(costBucketOfAggregateClass('priced'), 'above-base')
})

test('every entry in the pricing table points at a real catalogue entry', () => {
  const ids = new Set(AGGREGATE_REGISTRY.map(entry => entry.id))
  for (const entryId of Object.keys(AGGREGATE_PRICE)) {
    assert.ok(ids.has(entryId), `${entryId} 有标价但不在目录里`)
  }
  for (const entryId of Object.keys(AGGREGATE_OFFICIAL_FREE)) {
    assert.ok(ids.has(entryId), `${entryId} 有官方免费清单但不在目录里`)
  }
})

test('the official free list only claims models the catalogue actually ships', () => {
  // 给一个目录里不存在的 id 打免费标，等于给一个发不出去的模型做宣传
  for (const [entryId, row] of Object.entries(AGGREGATE_OFFICIAL_FREE)) {
    const entry = getAggregateEntry(entryId)
    const shipped = new Set(entry!.models.map(model => model.id))
    for (const modelId of row.models) {
      assert.ok(shipped.has(modelId), `${entryId}/${modelId} 免费清单里有，但目录没有这个模型`)
    }
  }
})

test('prices are captured verbatim with both sides, never half-filled', () => {
  for (const [entryId, entry] of Object.entries(AGGREGATE_PRICE)) {
    for (const [modelId, price] of Object.entries(entry.models)) {
      assert.equal(typeof price.input, 'number', `${entryId}/${modelId} 缺输入价`)
      assert.equal(typeof price.output, 'number', `${entryId}/${modelId} 缺输出价`)
      assert.ok(price.input >= 0 && price.output >= 0, `${entryId}/${modelId} 出现负价`)
    }
  }
  // 查不存在的条目/模型一律 undefined，不编造
  assert.equal(aggregatePriceOf('absent_entry', 'x'), undefined)
  assert.equal(aggregatePriceOf('zai_api', 'absent_model'), undefined)
  assert.equal(isZeroPrice(undefined), false)
})

test('classification counts add up to the model list length', () => {
  const entry = getAggregateEntry('zai_api')!
  const signals = entry.models.map(model =>
    aggregateCostOf({
      entryId: entry.id,
      modelId: model.id,
      ...(entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}),
    })
  )
  const counts = aggregateCostCounts(signals)
  const total = counts.free + counts.included + counts.priced + counts.unknown
  assert.equal(total, entry.models.length)
})

test('the plan list is hand-written with a reason for every entry', () => {
  for (const [entryId, reason] of Object.entries(AGGREGATE_PLAN_ENTRIES)) {
    assert.ok(reason.trim().length > 8, `${entryId} 的订阅理由太短，等于没写`)
    assert.ok(getAggregateEntry(entryId), `${entryId} 不在目录里`)
  }
  assert.equal(isPlanEntry('zai_api'), false, '按量端点不能进订阅清单')
})

test('the sidecar carries its source and date so nobody reads it as vendor-official', () => {
  const sidecar = readFileSync('src/shared/aggregatePricing.ts', 'utf-8')
  // 只看文件头的注释块，避免断言被数据行意外满足
  const header = sidecar.slice(0, sidecar.indexOf('export interface'))
  assert.match(sidecar, /AGGREGATE_PRICE_SOURCE/)
  assert.match(sidecar, /currency: 'USD'/)
  assert.match(sidecar, /unit: 'per-million-tokens'/)
  assert.match(header, /第三方/, '来源必须写清是第三方，不能读成厂商官方口径')
  assert.match(header, /零价 ≠ 免费/, '零价与免费的区别必须写在文件头')
  assert.match(header, /倍率/, '必须写明它和倍率的区别')
})

test('the model list page and the aggregate page agree on what counts as free', () => {
  // 两个页面必须走同一个分类器，否则同一个模型在两处拿到不同说法。
  const modelList = readFileSync('src/renderer/src/components/models/ModelList.tsx', 'utf-8')
  const detail = readFileSync('src/renderer/src/components/aggregate/AggregateDetail.tsx', 'utf-8')

  for (const file of [modelList, detail]) {
    assert.match(file, /aggregateCostOf\(/, '两处都必须调用共享分类器')
  }
  // 模型页只认 free，不能把套餐内标成免费（那一页没有"套餐内"这个说法）
  assert.doesNotMatch(
    modelList,
    /signal\.class === 'free' \|\| signal\.class === 'included'/,
    '没有"套餐内"档的页面不得把套餐内当成免费'
  )
})

test('the aggregate panel renders four separate cost classes, not a free/paid binary', () => {
  const detail = readFileSync('src/renderer/src/components/aggregate/AggregateDetail.tsx', 'utf-8')
  for (const key of ['costFreeOfficial', 'costFreeCatalogue', 'costFreeThirdParty', 'costIncluded', 'costPriced', 'costUnknown']) {
    assert.ok(detail.includes(`aggregate.manage.models.${key}`), `面板缺 ${key} 的文案`)
  }
  assert.match(detail, /aggregateCostCounts\(/, '汇总必须按分类计数')
  // 四类分别计数，界面拿到的槽位一个都不能少
  assert.match(detail, /costSummary[\s\S]{0,200}included:[\s\S]{0,80}priced:[\s\S]{0,80}unknown:/,
    'costSummary 必须把四类都传进去')
})

test('a missing cost field from an older main process degrades instead of crashing', () => {
  // dev 模式下 HMR 只重载渲染进程，主进程可能还在送没有 `cost` 的模型行；
  // 直接读 model.cost.class 会让整页崩掉。
  const detail = readFileSync('src/renderer/src/components/aggregate/AggregateDetail.tsx', 'utf-8')
  assert.match(detail, /model\.cost\s*\?\?/, '必须对缺失的 cost 字段就地补算')
  assert.doesNotMatch(detail, /costBadgeOf\(model\.cost/, '不能把可能为 undefined 的字段直接传给徽标')
})

/**
 * 下面的都是 `aggregateCostUsdOf`：把分类变成金额。四个用例对应四条口径，
 * 数字取自旁表里真实存在的条目，这样改了标价这些用例就会红，而不是跟着错。
 */

test('a model with no evidence has no money figure - and that is not $0', () => {
  const cost = aggregateCostUsdOf({
    entryId: 'entry_that_does_not_exist',
    modelId: 'some-model',
    usage: { promptTokens: 100_000, completionTokens: 20_000 },
  })

  assert.equal(cost, undefined, '没有证据必须是 undefined，渲染成 "-"；$0 是一个关于账单的断言')
})

test('free and in-plan models cost nothing in cash and are still counted as priced', () => {
  // 官方点名免费 / 第三方零价 / 订阅套餐内：三者的请求时刻现金都是 0，
  // 而 `costedRequests` 由调用方统计，所以界面能说出"$0，且这 12 条我确实算过"。
  const official = aggregateCostUsdOf({
    entryId: 'zai_api',
    modelId: 'glm-4.7-flash',
    usage: { promptTokens: 100_000, completionTokens: 20_000 },
  })
  const thirdParty = aggregateCostUsdOf({
    entryId: 'zenmux',
    modelId: 'deepseek/deepseek-v4-flash-free',
    usage: { promptTokens: 100_000, completionTokens: 20_000 },
  })
  const inPlan = aggregateCostUsdOf({
    entryId: 'glm-cn',
    modelId: 'glm-5.3',
    usage: { promptTokens: 100_000, completionTokens: 20_000 },
  })

  assert.equal(aggregateCostOf({ entryId: 'zai_api', modelId: 'glm-4.7-flash' }).class, 'free')
  assert.equal(aggregateCostOf({ entryId: 'glm-cn', modelId: 'glm-5.3' }).class, 'included')
  assert.equal(official, 0)
  assert.equal(thirdParty, 0)
  assert.equal(inPlan, 0, '套餐内的边际现金是 0，但这条不是"免费"——分类才是它的答案')
})

test('a priced model is billed input plus output, with cache reads at their own rate', () => {
  // deepseek-v4-pro: input 0.66 / output 1.98 / cacheRead 0.022 (USD per 1M)。
  const withoutCache = aggregateCostUsdOf({
    entryId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    usage: { promptTokens: 100_000, completionTokens: 20_000 },
  })
  const withCache = aggregateCostUsdOf({
    entryId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    usage: { promptTokens: 100_000, completionTokens: 20_000, cacheReadTokens: 40_000 },
  })

  // 上游没报命中 → 全部按 input 单价，这是没有证据时的保守读法。
  assert.equal(withoutCache, (100_000 * 0.66 + 20_000 * 1.98) / 1e6)
  // 报了的 40k 从 input 里挪到 cacheRead 档：`prompt_tokens` 含命中，
  // 两边都算就是把这 40k 收两次费。
  assert.equal(withCache, (60_000 * 0.66 + 40_000 * 0.022 + 20_000 * 1.98) / 1e6)
  assert.ok((withCache ?? 0) < (withoutCache ?? 0), '命中必须让这一笔变便宜，不是变贵')
})

test('a cache-read claim above the reported input is clamped, not credited', () => {
  // 上游自相矛盾（命中 > 输入）时按"全部输入都命中"处理：这是能把金额算小
  // 的最接近事实的读法。负的 `billableInput` 会凭空造出一笔退款。
  const clamped = aggregateCostUsdOf({
    entryId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    usage: { promptTokens: 100_000, completionTokens: 20_000, cacheReadTokens: 200_000 },
  })

  assert.equal(clamped, (100_000 * 0.022 + 20_000 * 1.98) / 1e6)
  assert.ok(clamped !== undefined && clamped > 0)
})

test('garbage usage numbers never become a negative bill', () => {
  const cost = aggregateCostUsdOf({
    entryId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    usage: { promptTokens: Number.NaN, completionTokens: -5 },
  })

  assert.equal(cost, 0, 'NaN 与负数都读作 0 个 token，金额不能是 NaN 更不能是负数')
})
