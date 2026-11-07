import test from 'node:test'
import assert from 'node:assert/strict'

// Same pin as `local-day.test.ts`: the window boundaries below are local days, so
// they must not depend on the runner's timezone.
process.env.TZ = 'Asia/Shanghai'
const tzApplied = new Date('2026-06-01T00:00:00').getTimezoneOffset() === -480

const {
  aggregateProviderUsage,
  aggregateProviderTokenUsage,
  aggregateModelTokenUsage,
  isDayKey,
  windowDayKeys,
} = await import('../../src/shared/providerUsage.ts')
const { localDayKey, recentLocalDays } = await import('../../src/shared/localDay.ts')

type Days = Record<string, import('../../src/shared/providerUsage.ts').DailyProviderUsage>

/** A day that recorded outcomes, the way `recordRequestInStats` now writes them. */
const coveredDay = (
  counts: Record<string, [requests: number, successes: number, latencySum: number]>
): import('../../src/shared/providerUsage.ts').DailyProviderUsage => {
  const providerUsage: Record<string, number> = {}
  const providerSuccess: Record<string, number> = {}
  const providerLatency: Record<string, number> = {}

  for (const [providerId, [requests, successes, latencySum]] of Object.entries(counts)) {
    providerUsage[providerId] = requests
    providerSuccess[providerId] = successes
    providerLatency[providerId] = latencySum
  }

  return { providerUsage, providerSuccess, providerLatency }
}

/** A bucket from a build that only ever counted requests. */
const legacyDay = (counts: Record<string, number>): Days[string] => ({
  providerUsage: { ...counts },
})

const NOW = Date.parse('2026-10-29T10:00:00+08:00')
const TODAY = localDayKey(NOW)
const YESTERDAY = recentLocalDays(2, NOW)[0].key

test('a window reads only stored days, so a quiet day is never a bucket', () => {
  const days: Days = { [YESTERDAY]: legacyDay({ glm: 3 }), [TODAY]: legacyDay({ glm: 1 }) }

  assert.deepEqual(windowDayKeys(days, { kind: 'days', days: 30 }, NOW), [YESTERDAY, TODAY])
  // A day with no traffic has no key at all; asking for it must not invent one.
  assert.deepEqual(windowDayKeys({}, { kind: 'today' }, NOW), [])
})

test('today counts only today', () => {
  const days: Days = {
    [YESTERDAY]: legacyDay({ glm: 9 }),
    [TODAY]: legacyDay({ glm: 2 }),
  }

  assert.equal(aggregateProviderUsage(days, { kind: 'today' }, NOW).glm?.requests, 2)
})

test('the day window ends with today and does not reach into tomorrow', () => {
  const tomorrow = recentLocalDays(2, NOW + 24 * 60 * 60 * 1000)[1].key
  const days: Days = {
    [YESTERDAY]: legacyDay({ glm: 1 }),
    [TODAY]: legacyDay({ glm: 1 }),
    [tomorrow]: legacyDay({ glm: 500 }),
  }

  assert.equal(aggregateProviderUsage(days, { kind: 'days', days: 2 }, NOW).glm?.requests, 2)
})

test('all spans every stored day, including ones older than any preset', () => {
  const days: Days = {
    '2020-01-01': legacyDay({ glm: 7 }),
    [TODAY]: legacyDay({ glm: 1 }),
  }

  assert.equal(aggregateProviderUsage(days, { kind: 'all' }, NOW).glm?.requests, 8)
})

test('a custom range is inclusive at both ends', () => {
  const days: Days = {
    '2026-10-01': legacyDay({ glm: 1 }),
    '2026-10-02': legacyDay({ glm: 2 }),
    '2026-10-03': legacyDay({ glm: 3 }),
    '2026-10-04': legacyDay({ glm: 4 }),
  }

  assert.deepEqual(windowDayKeys(days, { kind: 'range', start: '2026-10-02', end: '2026-10-03' }, NOW), [
    '2026-10-02',
    '2026-10-03',
  ])
  assert.equal(aggregateProviderUsage(days, { kind: 'range', start: '2026-10-02', end: '2026-10-03' }, NOW).glm?.requests, 5)
})

test('an inverted or malformed range answers nothing instead of guessing', () => {
  const days: Days = { '2026-10-02': legacyDay({ glm: 2 }) }

  assert.deepEqual(windowDayKeys(days, { kind: 'range', start: '2026-10-05', end: '2026-10-01' }, NOW), [])
  assert.deepEqual(windowDayKeys(days, { kind: 'range', start: '2026-10-2', end: '2026-10-03' }, NOW), [])
  assert.deepEqual(aggregateProviderUsage(days, { kind: 'range', start: 'x', end: '2026-10-03' }, NOW), {})
})

test('unrecorded outcomes stay unrecorded, never 0%', () => {
  // The request came from an older build: it counted the request but no outcome,
  // so any rate here would be invented.
  const usage = aggregateProviderUsage({ [TODAY]: legacyDay({ glm: 4 }) }, { kind: 'today' }, NOW).glm

  assert.equal(usage?.requests, 4)
  assert.equal(usage?.successRate, undefined)
  assert.equal(usage?.avgLatencyMs, undefined)
  assert.equal(usage?.coveredFrom, undefined)
})

test('a partly covered window rates only the requests it can account for', () => {
  const days: Days = {
    [YESTERDAY]: legacyDay({ glm: 100 }),
    [TODAY]: coveredDay({ glm: [10, 9, 9000] }),
  }
  const usage = aggregateProviderUsage(days, { kind: 'days', days: 2 }, NOW).glm

  // 9/10, not 9/110: dividing by every request would charge the unrecorded day as failures.
  assert.equal(usage?.requests, 110)
  assert.equal(usage?.successRate, 90)
  assert.equal(usage?.coveredFrom, TODAY)
  assert.equal(usage?.avgLatencyMs, 1000)
})

test('coveredFrom names the earliest covered day, not the earliest day', () => {
  const days: Days = {
    '2026-10-01': legacyDay({ glm: 5 }),
    '2026-10-02': coveredDay({ glm: [1, 1, 10] }),
    '2026-10-03': coveredDay({ glm: [1, 1, 20] }),
  }

  assert.equal(aggregateProviderUsage(days, { kind: 'all' }, NOW).glm?.coveredFrom, '2026-10-02')
})

test('a covered day with no success is a real 0%, and no average latency', () => {
  const days: Days = { [TODAY]: coveredDay({ glm: [3, 0, 0] }) }
  const usage = aggregateProviderUsage(days, { kind: 'today' }, NOW).glm

  assert.equal(usage?.successRate, 0)
  // An average over zero successes is "not measured", not "0ms".
  assert.equal(usage?.avgLatencyMs, undefined)
})

test('providers are kept apart and an empty window answers nothing', () => {
  const days: Days = { [TODAY]: coveredDay({ glm: [2, 2, 200], qoder: [1, 0, 0] }) }

  assert.deepEqual(Object.keys(aggregateProviderUsage(days, { kind: 'today' }, NOW)).sort(), ['glm', 'qoder'])
  assert.deepEqual(aggregateProviderUsage(days, { kind: 'days', days: 7 }, Date.parse('2020-01-01T00:00:00+08:00')), {})
})

test('a zero-request entry in a bucket contributes nothing', () => {
  const days: Days = { [TODAY]: legacyDay({ glm: 0, qoder: 3 }) }
  const usage = aggregateProviderUsage(days, { kind: 'today' }, NOW)

  assert.equal(usage.glm, undefined)
  assert.equal(usage.qoder?.requests, 3)
})

test('day keys must be zero-padded ISO dates', () => {
  assert.equal(isDayKey('2026-10-03'), true)
  assert.equal(isDayKey('2026-10-3'), false)
  assert.equal(isDayKey(undefined), false)
  assert.equal(isDayKey('2026/10/03'), false)
})

/**
 * The token half of the card. Built through the real accumulator rather than by
 * hand, so these tests break if the writer and the reader ever disagree about
 * the shape.
 */
const { accumulateDayBucket } = await import('../../src/shared/tokenAccounting.ts')
type TokenDays = Record<string, import('../../src/shared/tokenAccounting.ts').DayTokenBucket>

const tokenDay = (
  entries: Record<string, { prompt: number; completion: number; upstream: boolean; costUsd?: number }>
): TokenDays[string] => {
  let bucket: TokenDays[string] | undefined

  for (const [providerId, entry] of Object.entries(entries)) {
    bucket = accumulateDayBucket(bucket, {
      promptTokens: entry.prompt,
      completionTokens: entry.completion,
      source: entry.upstream ? 'upstream' : 'estimated',
      providerId,
      ...(entry.costUsd === undefined ? {} : { costUsd: entry.costUsd }),
    })
  }

  return bucket
}

test('a day without a provider split contributes no tokens rather than zero tokens', () => {
  // `statistics.tokenUsage` predates the split; those days must stay silent so
  // the card can show "-" instead of claiming the endpoint served nothing.
  const legacy = accumulateDayBucket(undefined, {
    promptTokens: 5000,
    completionTokens: 900,
    source: 'upstream',
  })
  assert.equal(legacy.byProvider, undefined)

  const days: TokenDays = { [TODAY]: legacy }
  assert.deepEqual(aggregateProviderTokenUsage(days, { kind: 'today' }, NOW), {})
})

test('the two token pools stay two numbers across the window', () => {
  const days: TokenDays = {
    [YESTERDAY]: tokenDay({ deepseek: { prompt: 1000, completion: 500, upstream: true } }),
    [TODAY]: tokenDay({ deepseek: { prompt: 800, completion: 200, upstream: false } }),
  }

  // Today holds only the estimated request, so the measured pool is honestly 0 -
  // not 1500 borrowed from yesterday.
  const today = aggregateProviderTokenUsage(days, { kind: 'today' }, NOW).deepseek
  assert.equal(today?.upstreamTokens, 0)
  assert.equal(today?.estimatedTokens, 1000)
  assert.equal(today?.requests, 1)
  assert.equal(today?.upstreamRequests, 0)

  const both = aggregateProviderTokenUsage(days, { kind: 'days', days: 7 }, NOW).deepseek
  assert.equal(both?.upstreamTokens, 1500, 'summing pools would read as fact while being mostly arithmetic')
  assert.equal(both?.estimatedTokens, 1000)
  assert.equal(both?.requests, 2)
  assert.equal(both?.upstreamRequests, 1)
})

test('no price evidence is an absent money figure, not a zero', () => {
  const unpriced: TokenDays = { [TODAY]: tokenDay({ opencode_zen: { prompt: 100, completion: 5, upstream: true } }) }
  const usage = aggregateProviderTokenUsage(unpriced, { kind: 'today' }, NOW).opencode_zen
  assert.equal(usage?.costUsd, undefined)
  assert.equal(usage?.costedRequests, 0)

  // An estimated request carries no money either: the accumulator drops it, so
  // a window can never invent a bill out of `chars/4`.
  const estimated: TokenDays = {
    [TODAY]: tokenDay({ deepseek: { prompt: 100_000, completion: 20, upstream: false, costUsd: 0.5 } }),
  }
  assert.equal(aggregateProviderTokenUsage(estimated, { kind: 'today' }, NOW).deepseek?.costUsd, undefined)

  // "free" is a real answer: priced, and $0.
  const free: TokenDays = { [TODAY]: tokenDay({ zenmux: { prompt: 100, completion: 5, upstream: true, costUsd: 0 } }) }
  const freeUsage = aggregateProviderTokenUsage(free, { kind: 'today' }, NOW).zenmux
  assert.equal(freeUsage?.costUsd, 0)
  assert.equal(freeUsage?.costedRequests, 1)
})

test('money and coverage add up across days, provider by provider', () => {
  const days: TokenDays = {
    [YESTERDAY]: tokenDay({
      deepseek: { prompt: 100_000, completion: 20_000, upstream: true, costUsd: 0.1056 },
      glm: { prompt: 50, completion: 5, upstream: true },
    }),
    [TODAY]: tokenDay({
      deepseek: { prompt: 10_000, completion: 2_000, upstream: true, costUsd: 0.0106 },
      glm: { prompt: 50, completion: 5, upstream: true, costUsd: 0 },
    }),
  }
  const week = aggregateProviderTokenUsage(days, { kind: 'days', days: 7 }, NOW)

  assert.ok(Math.abs((week.deepseek?.costUsd ?? 0) - 0.1162) < 1e-12)
  assert.equal(week.deepseek?.costedRequests, 2)
  assert.equal(week.deepseek?.coveredFrom, YESTERDAY)

  // glm is priceable only today, and its money figure is a real 0 because the
  // priced request happened to be free.
  assert.equal(week.glm?.costedRequests, 1)
  assert.equal(week.glm?.costUsd, 0)
  assert.equal(week.glm?.coveredFrom, YESTERDAY)
})

test('a custom range keeps the token window honest', () => {
  const days: TokenDays = {
    '2026-10-01': tokenDay({ glm: { prompt: 100, completion: 10, upstream: true, costUsd: 0.01 } }),
    '2026-10-09': tokenDay({ glm: { prompt: 100, completion: 10, upstream: true, costUsd: 0.02 } }),
    '2026-10-31': tokenDay({ glm: { prompt: 100, completion: 10, upstream: true, costUsd: 0.03 } }),
  }

  const ranged = aggregateProviderTokenUsage(days, { kind: 'range', start: '2026-10-02', end: '2026-10-30' }, NOW)
  assert.equal(ranged.glm?.costUsd, 0.02)
  assert.equal(ranged.glm?.coveredFrom, '2026-10-09')

  const all = aggregateProviderTokenUsage(days, { kind: 'all' }, NOW)
  assert.equal(all.glm?.requests, 3)
  assert.equal(all.glm?.coveredFrom, '2026-10-01')
})

test('per-model cache stats key the pair and keep the reported-cache denominator', () => {
  let bucket = accumulateDayBucket(undefined, {
    promptTokens: 1000,
    completionTokens: 10,
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
  // Same model name on another endpoint: two cache domains, two rows.
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 500,
    completionTokens: 5,
    source: 'upstream',
    providerId: 'baidu',
    modelId: 'deepseek-chat',
  })

  const stats = aggregateModelTokenUsage({ [TODAY]: bucket }, { kind: 'today' }, NOW)

  const own = stats['deepseek::deepseek-chat']
  assert.equal(own.providerId, 'deepseek')
  assert.equal(own.model, 'deepseek-chat')
  assert.equal(own.requests, 2)
  assert.equal(own.upstreamRequests, 1)
  assert.equal(own.promptTokens, 1000)
  assert.equal(own.cacheReadTokens, 800)
  assert.equal(own.cacheReportedRequests, 1)
  assert.equal(own.promptWithCache, 1000)

  const other = stats['baidu::deepseek-chat']
  assert.equal(other.promptTokens, 500)
  assert.equal(other.cacheReportedRequests, 0)
  assert.equal(other.promptWithCache, 0, '没报缓存的家没有命中率分母')
})

test('a day without a model split contributes no model rows', () => {
  const legacy = accumulateDayBucket(undefined, {
    promptTokens: 5000,
    completionTokens: 900,
    source: 'upstream',
    providerId: 'deepseek',
  })
  assert.equal(legacy.byModel, undefined)
  assert.deepEqual(aggregateModelTokenUsage({ [TODAY]: legacy }, { kind: 'today' }, NOW), {})
})
