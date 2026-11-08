import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  accumulateDayBucket,
  compressionRatioBucket,
  summarizeDay,
  trimDays,
  normalizeDayBucket,
  tokenDayKey,
  MAX_MODEL_KEYS_PER_DAY,
  OTHER_MODEL_KEY,
  type DayTokenBucket,
} from '../../src/shared/tokenAccounting.ts'

test('an empty bucket reports a null coverage, not zero', () => {
  const summary = summarizeDay('2026-10-29', normalizeDayBucket(undefined))

  assert.equal(summary.upstreamCoverage, null)
  assert.equal(summary.requests, 0)
  assert.equal(summary.savedTokens, 0)
})

test('upstream and estimated tokens never pollute each other', () => {
  // This is the rule the dashboard depends on: the two pools must stay separate,
  // because only the upstream pool could ever match a bill.
  let bucket: DayTokenBucket | undefined

  bucket = accumulateDayBucket(bucket, {
    promptTokens: 1000,
    completionTokens: 500,
    source: 'upstream',
  })
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 800,
    completionTokens: 200,
    source: 'estimated',
  })

  const summary = summarizeDay('2026-10-29', bucket)

  assert.equal(summary.upstreamPrompt, 1000)
  assert.equal(summary.upstreamCompletion, 500)
  assert.equal(summary.estimatedPrompt, 800)
  assert.equal(summary.estimatedCompletion, 200)
  assert.equal(summary.requests, 2)
  assert.equal(summary.upstreamRequests, 1)
  assert.equal(summary.upstreamCoverage, 0.5)
})

test('a day where every request reported usage has full coverage', () => {
  let bucket: DayTokenBucket | undefined
  bucket = accumulateDayBucket(bucket, { promptTokens: 10, completionTokens: 5, source: 'upstream' })
  bucket = accumulateDayBucket(bucket, { promptTokens: 20, completionTokens: 8, source: 'upstream' })

  const summary = summarizeDay('2026-10-29', bucket)
  assert.equal(summary.upstreamCoverage, 1)
  assert.equal(summary.estimatedPrompt, 0)
  assert.equal(summary.estimatedCompletion, 0)
})

test('a day where nothing reported usage has zero coverage, not null', () => {
  // Two requests WERE recorded, so the ratio is known: 0%. Null would mean
  // "nothing recorded at all", which is a different fact.
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: 100,
    completionTokens: 40,
    source: 'estimated',
  })

  const summary = summarizeDay('2026-10-29', bucket)
  assert.equal(summary.upstreamCoverage, 0)
  assert.equal(summary.upstreamPrompt, 0)
})

test('savings accumulate only from requests that supply them', () => {
  let bucket: DayTokenBucket | undefined
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 100,
    completionTokens: 50,
    source: 'upstream',
    savedTokens: 900,
  })
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 100,
    completionTokens: 50,
    source: 'upstream',
  })

  assert.equal(summaryOf(bucket).savedTokens, 900)
})

test('negative and non-finite input is floored to zero', () => {
  // A upstream that reports garbage must not corrupt the day's totals.
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: -5,
    completionTokens: Number.NaN,
    source: 'upstream',
    savedTokens: -1,
  })

  assert.equal(bucket.upstreamPrompt, 0)
  assert.equal(bucket.upstreamCompletion, 0)
  assert.equal(bucket.savedTokens, 0)
  assert.equal(bucket.requests, 1)
})

test('accumulation never mutates the bucket it is given', () => {
  const original: DayTokenBucket = normalizeDayBucket({ upstreamPrompt: 500, requests: 1 })
  const before = JSON.stringify(original)

  const next = accumulateDayBucket(original, {
    promptTokens: 100,
    completionTokens: 10,
    source: 'upstream',
  })

  assert.equal(JSON.stringify(original), before)
  assert.notEqual(next, original)
  assert.equal(next.upstreamPrompt, 600)
})

test('trimming keeps the newest days and drops the rest', () => {
  const buckets: Record<string, DayTokenBucket> = {}
  for (let day = 1; day <= 30; day += 1) {
    const key = `2026-10-${String(day).padStart(2, '0')}`
    buckets[key] = normalizeDayBucket({ requests: day })
  }

  const trimmed = trimDays(buckets, 10)
  const keys = Object.keys(trimmed).sort()

  assert.equal(keys.length, 10)
  assert.equal(keys[0], '2026-10-21')
  assert.equal(keys[9], '2026-10-30')
})

test('trimming a small map returns it unchanged', () => {
  const buckets = { '2026-10-29': normalizeDayBucket({ requests: 1 }) }
  assert.deepEqual(trimDays(buckets, 10), buckets)
})

test('a hand-edited persisted bucket is sanitized', () => {
  const poisoned = normalizeDayBucket({
    upstreamPrompt: -1,
    upstreamCompletion: 'abc',
    estimatedPrompt: Number.POSITIVE_INFINITY,
    savedTokens: 1e999,
    requests: 2.7,
    upstreamRequests: null,
  })

  assert.equal(poisoned.upstreamPrompt, 0)
  assert.equal(poisoned.upstreamCompletion, 0)
  assert.equal(poisoned.estimatedPrompt, 0)
  assert.equal(poisoned.savedTokens, 0)
  assert.equal(poisoned.requests, 2)
  assert.equal(poisoned.upstreamRequests, 0)
  assert.equal(poisoned.upstreamCacheRead, 0, 'a field added later must sanitize to 0, not stay undefined')
})

test('cache reads enter the day only from upstream-reported usage', () => {
  // 估算请求不可能"带来"缓存命中：写了就是把"没测到"伪装成"测到了"。
  let bucket: DayTokenBucket | undefined
  bucket = accumulateDayBucket(bucket, { promptTokens: 1000, completionTokens: 10, source: 'upstream', cacheReadTokens: 900 })
  bucket = accumulateDayBucket(bucket, { promptTokens: 800, completionTokens: 10, source: 'estimated', cacheReadTokens: 500 })

  const summary = summaryOf(bucket)
  assert.equal(summary.upstreamCacheRead, 900)
  assert.equal(summary.upstreamPrompt, 1000, 'cache reads are a subset of the reported input, never an extra pool')
})

test('a bucket persisted before the cache field existed cannot poison the day', () => {
  // ⚠️ 真正的回归围栏：调用方喂给 `accumulateDayBucket` 的是**磁盘上读出来**的
  // 对象。旧 `data.json` 里没有 `upstreamCacheRead`，过去直接 `base.field + x`
  // 会算出 `NaN` 并写回存储，从此这一天所有计数都不可显示。
  const legacy = {
    upstreamPrompt: 500,
    upstreamCompletion: 10,
    estimatedPrompt: 0,
    estimatedCompletion: 0,
    savedTokens: 0,
    requests: 1,
    upstreamRequests: 1,
  } as unknown as DayTokenBucket

  const next = accumulateDayBucket(legacy, { promptTokens: 100, completionTokens: 5, source: 'upstream' })

  assert.equal(next.upstreamCacheRead, 0)
  assert.equal(next.upstreamPrompt, 600)
  assert.ok(Number.isFinite(next.upstreamPrompt) && Number.isFinite(next.upstreamCacheRead))
})

test('the day key is the local calendar day', () => {
  // 23:30 local on the 29th is still the 29th, never the 30th.
  const lateEvening = new Date(2026, 9, 29, 23, 30, 0).getTime()
  const earlyMorning = new Date(2026, 9, 29, 0, 30, 0).getTime()

  assert.equal(tokenDayKey(lateEvening), '2026-10-29')
  assert.equal(tokenDayKey(earlyMorning), '2026-10-29')
})

test('the per-provider split mirrors the global pools, pool by pool', () => {
  let bucket: DayTokenBucket | undefined
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 1000,
    completionTokens: 500,
    source: 'upstream',
    providerId: 'deepseek',
  })
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 800,
    completionTokens: 200,
    source: 'estimated',
    providerId: 'deepseek',
  })
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 10,
    completionTokens: 5,
    source: 'upstream',
    providerId: 'kilo',
  })

  assert.deepEqual(bucket.byProvider?.deepseek, {
    upstreamPrompt: 1000,
    upstreamCompletion: 500,
    estimatedPrompt: 800,
    estimatedCompletion: 200,
    requests: 2,
    upstreamRequests: 1,
    costUsd: 0,
    costedRequests: 0,
  })
  assert.equal(bucket.byProvider?.kilo.upstreamPrompt, 10)
  // The provider rows are a split of the same traffic, so both must add up.
  assert.equal(bucket.upstreamPrompt, 1010)
  assert.equal(bucket.requests, 3)
})

test('a request with no provider id accrues globally only', () => {
  // 记不出是谁服务的，就不能编一个键出来 —— 全局池是事实，分表是"我们没记"。
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: 100,
    completionTokens: 10,
    source: 'upstream',
    providerId: '   ',
  })

  assert.equal(bucket.requests, 1)
  assert.equal(bucket.upstreamPrompt, 100)
  assert.equal(bucket.byProvider?.deepseek, undefined)
  assert.deepEqual(Object.keys(bucket.byProvider ?? {}), [])
})

test('money only comes from upstream-reported usage', () => {
  // 估算 token 乘标价不是"估算的费用"，而是一张核对不了的账单。
  let bucket: DayTokenBucket | undefined
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 100_000,
    completionTokens: 20_000,
    source: 'estimated',
    providerId: 'deepseek',
    costUsd: 0.1056,
  })

  assert.equal(bucket.byProvider?.deepseek.costUsd, 0)
  assert.equal(bucket.byProvider?.deepseek.costedRequests, 0)
  assert.equal(bucket.byProvider?.deepseek.estimatedPrompt, 100_000, 'token 照旧进估算池')

  bucket = accumulateDayBucket(bucket, {
    promptTokens: 100_000,
    completionTokens: 20_000,
    source: 'upstream',
    providerId: 'deepseek',
    costUsd: 0.1056,
  })

  assert.equal(bucket.byProvider?.deepseek.costUsd, 0.1056)
  assert.equal(bucket.byProvider?.deepseek.costedRequests, 1)
})

test('an unpriced request costs nothing here and is not counted as priced', () => {
  // `costUsd: undefined` = 没有价格证据；`0` = 有证据且不花钱。两者都必须让
  // `costedRequests` 说出真话，否则界面无法区分 "$0" 和 "-"。
  let bucket: DayTokenBucket | undefined
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 10, completionTokens: 5, source: 'upstream', providerId: 'opencode_zen',
  })
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 10, completionTokens: 5, source: 'upstream', providerId: 'opencode_zen', costUsd: 0,
  })

  assert.equal(bucket.byProvider?.opencode_zen.costUsd, 0)
  assert.equal(bucket.byProvider?.opencode_zen.costedRequests, 1, '只有真的算过的才进分母')
  assert.equal(bucket.byProvider?.opencode_zen.requests, 2)
})

test('a sub-cent day of cheap requests is not floored to zero', () => {
  // 计数全部 `Math.floor`，金额不能：把 $0.004 抹成 0 就是把"花过钱"抹成"免费"。
  let bucket: DayTokenBucket | undefined
  for (let i = 0; i < 3; i += 1) {
    bucket = accumulateDayBucket(bucket, {
      promptTokens: 100, completionTokens: 50, source: 'upstream', providerId: 'deepseek', costUsd: 0.0013,
    })
  }

  assert.ok(Math.abs((bucket.byProvider?.deepseek.costUsd ?? 0) - 0.0039) < 1e-12)
})

test('a legacy bucket cannot poison the provider split', () => {
  // 磁盘上的老桶既没有 `byProvider` 也没有 `upstreamCacheRead`。清洗必须补出
  // 一个可用的空分表，而不是让下一笔请求把这一天写成 NaN。
  const legacy = {
    upstreamPrompt: 500,
    upstreamCompletion: 10,
    estimatedPrompt: 0,
    estimatedCompletion: 0,
    savedTokens: 0,
    requests: 1,
    upstreamRequests: 1,
  } as unknown as DayTokenBucket

  const next = accumulateDayBucket(legacy, {
    promptTokens: 100,
    completionTokens: 5,
    source: 'upstream',
    providerId: 'deepseek',
    costUsd: 0.2,
  })

  assert.equal(next.upstreamPrompt, 600)
  assert.equal(next.byProvider?.deepseek.upstreamPrompt, 100, '老日子已发生的流量不能被算成这个供应商的')
  assert.ok(Number.isFinite(next.savedTokens))
})

test('a hand-edited provider map is sanitized like the day totals are', () => {
  const cleaned = normalizeDayBucket({
    requests: 2,
    byProvider: {
      deepseek: { upstreamPrompt: -9, upstreamRequests: 'abc', costUsd: -1, costedRequests: 4.7 },
      '': { upstreamPrompt: 5 },
      kilo: null,
    },
  })

  assert.equal(cleaned.byProvider?.deepseek.upstreamPrompt, 0)
  assert.equal(cleaned.byProvider?.deepseek.upstreamRequests, 0)
  assert.equal(cleaned.byProvider?.deepseek.costUsd, 0, '一笔负的账单不是账单')
  assert.equal(cleaned.byProvider?.deepseek.costedRequests, 4)
  assert.equal(cleaned.byProvider?.[''], undefined, '空供应商名不能进表')
  assert.equal(cleaned.byProvider?.kilo.upstreamPrompt, 0, 'null 条目要展开成零桶而不是崩掉')
})

test('provider split accrual never mutates the bucket it was given', () => {
  const original = accumulateDayBucket(undefined, {
    promptTokens: 10, completionTokens: 5, source: 'upstream', providerId: 'deepseek', costUsd: 0.1,
  })
  const before = JSON.stringify(original)

  const next = accumulateDayBucket(original, {
    promptTokens: 10, completionTokens: 5, source: 'upstream', providerId: 'deepseek', costUsd: 0.1,
  })

  assert.equal(JSON.stringify(original), before)
  assert.notEqual(next.byProvider, original.byProvider)
  assert.equal(next.byProvider?.deepseek.costUsd, 0.2)
})

/** Local helper so the savings test reads at a glance. */
function summaryOf(bucket: DayTokenBucket) {
  return summarizeDay('2026-10-29', bucket)
}

test('the per-model split keeps estimated requests out of the cache pools', () => {
  let bucket: DayTokenBucket | undefined
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 1000,
    completionTokens: 50,
    source: 'upstream',
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    cacheReadTokens: 800,
    cacheReadReported: true,
  })
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 100,
    completionTokens: 5,
    source: 'estimated',
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
  })

  const row = bucket.byModel?.['deepseek::deepseek-chat']
  assert.equal(row?.requests, 2)
  assert.equal(row?.upstreamRequests, 1)
  assert.equal(row?.upstreamPrompt, 1000)
  assert.equal(row?.upstreamCacheRead, 800)
  assert.equal(row?.cacheReportedRequests, 1)
  assert.equal(row?.upstreamPromptWithCache, 1000)
})

test('a reported zero keeps a real hit-rate denominator', () => {
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: 500,
    completionTokens: 20,
    source: 'upstream',
    providerId: 'deepseek',
    modelId: 'deepseek-reasoner',
    cacheReadTokens: undefined,
    cacheReadReported: true,
  })

  const row = bucket.byModel?.['deepseek::deepseek-reasoner']
  assert.equal(row?.upstreamCacheRead, 0)
  assert.equal(row?.cacheReportedRequests, 1, '上游明确报了 0，就有分母')
  assert.equal(row?.upstreamPromptWithCache, 500)
})

test('a provider that never reports caching has no hit-rate denominator', () => {
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: 500,
    completionTokens: 20,
    source: 'upstream',
    providerId: 'some-relay',
    modelId: 'm',
  })

  const row = bucket.byModel?.['some-relay::m']
  assert.equal(row?.upstreamPrompt, 500)
  assert.equal(row?.cacheReportedRequests, 0)
  assert.equal(row?.upstreamPromptWithCache, 0, '没报缓存不是 0% 命中')
})

test('the model split caps its row count and folds the overflow into __other__', () => {
  let bucket: DayTokenBucket | undefined
  const total = MAX_MODEL_KEYS_PER_DAY + 5

  for (let index = 0; index < total; index += 1) {
    bucket = accumulateDayBucket(bucket, {
      promptTokens: 10,
      completionTokens: 1,
      source: 'upstream',
      providerId: 'p',
      modelId: `m${index}`,
    })
  }

  const rows = Object.keys(bucket?.byModel ?? {})
  assert.equal(rows.length, MAX_MODEL_KEYS_PER_DAY + 1)
  assert.equal(bucket?.byModel?.[OTHER_MODEL_KEY]?.requests, total - MAX_MODEL_KEYS_PER_DAY)
})

test('a hand-edited model split is sanitized, and old buckets have none', () => {
  const cleaned = normalizeDayBucket({
    requests: 2,
    byModel: {
      'a::b': { providerId: 'a', model: 'b', upstreamPrompt: -9, requests: 'x' },
      '': { providerId: '', model: 'x' },
      broken: null,
    },
  })

  assert.equal(cleaned.byModel?.['a::b'].upstreamPrompt, 0)
  assert.equal(cleaned.byModel?.['a::b'].requests, 0)
  assert.equal(cleaned.byModel?.['a::b'].cacheReportedRequests, 0)
  assert.deepEqual(Object.keys(cleaned.byModel ?? {}), ['a::b'])
  assert.equal(normalizeDayBucket({ requests: 1 }).byModel, undefined)
})

test('a compression verdict counts one analyzed request, applied or not', () => {
  let bucket: DayTokenBucket | undefined
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 100,
    completionTokens: 10,
    source: 'upstream',
    compression: {
      applied: ['json'],
      candidates: [{ contentType: 'json_array', tokensBefore: 1000, tokensAfter: 5, accepted: true }],
    },
  })
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 100,
    completionTokens: 10,
    source: 'upstream',
    compression: {
      applied: [],
      skipped: 'insufficient_savings',
      candidates: [{ contentType: 'json_array', tokensBefore: 1000, tokensAfter: 220, accepted: false }],
    },
  })

  const counters = bucket.compression
  assert.equal(counters?.analyzed, 2)
  assert.equal(counters?.applied, 1)
  assert.deepEqual(counters?.skipped, { insufficient_savings: 1 })
  assert.equal(counters?.byContentType.json_array.candidates, 2)
  assert.equal(counters?.byContentType.json_array.accepted, 1)
  assert.equal(counters?.byContentType.json_array.tokensBefore, 2000)
  assert.equal(counters?.byContentType.json_array.tokensAfter, 225)
  assert.equal(counters?.byContentType.json_array.ratioBuckets.lt1, 1)
  assert.equal(counters?.byContentType.json_array.ratioBuckets.lt25, 1)
  // The token pools are untouched by the verdict: compression is not usage.
  assert.equal(bucket.requests, 2)
  assert.equal(bucket.upstreamPrompt, 200)
})

test('a request that never reached compression leaves no counter row', () => {
  const legacy = accumulateDayBucket(undefined, { promptTokens: 10, completionTokens: 1, source: 'upstream' })
  assert.equal(legacy.compression, undefined)
  assert.equal(normalizeDayBucket({ requests: 1, upstreamPrompt: 10 }).compression, undefined)
})

test('ratio buckets sit either side of the two cache thresholds', () => {
  // 2% is DeepSeek's c, 8% is Anthropic's c/(1+w). A bucket edge that moves
  // across either value silently rewrites the P3 answer.
  const cases: Array<[number, number, string]> = [
    [1000, 9, 'lt1'],
    [1000, 10, 'lt2'],
    [1000, 19, 'lt2'],
    [1000, 20, 'lt5'],
    [1000, 79, 'lt8'],
    [1000, 80, 'lt10'],
    [1000, 99, 'lt10'],
    [1000, 100, 'lt25'],
    [1000, 249, 'lt25'],
    [1000, 250, 'gte25'],
  ]
  for (const [before, after, expected] of cases) {
    assert.equal(compressionRatioBucket(before, after), expected, `${after}/${before}`)
  }
  assert.equal(compressionRatioBucket(0, 10), null)
  assert.equal(compressionRatioBucket(Number.NaN, 10), null)
})

test('persisted compression counters survive normalization and clamp junk', () => {
  const cleaned = normalizeDayBucket({
    requests: 3,
    compression: {
      analyzed: 3,
      applied: 'x',
      skipped: { insufficient_savings: 2, '': 5, yes: -1 },
      byContentType: {
        json_array: {
          candidates: 2,
          accepted: 1,
          tokensBefore: 2000,
          tokensAfter: -5,
          ratioBuckets: { lt1: 1, lt2: 1, bogus: 9 },
        },
        broken: null,
        '': { candidates: 1 },
      },
    },
  })

  const counters = cleaned.compression
  assert.equal(counters?.analyzed, 3)
  assert.equal(counters?.applied, 0)
  assert.deepEqual(counters?.skipped, { insufficient_savings: 2, yes: 0 })
  const row = counters?.byContentType.json_array
  assert.equal(row?.candidates, 2)
  assert.equal(row?.accepted, 1)
  assert.equal(row?.tokensBefore, 2000)
  assert.equal(row?.tokensAfter, 0)
  assert.equal(row?.ratioBuckets.lt1, 1)
  assert.equal(row?.ratioBuckets.lt2, 1)
  assert.equal(row?.ratioBuckets.gte25, 0)
  assert.deepEqual(Object.keys(counters?.byContentType ?? {}), ['json_array'])
})
