import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { cacheMissLedger } from '../../src/main/proxy/cacheMissLedger.ts'
import { accumulateDayBucket, modelBucketKey } from '../../src/shared/tokenAccounting.ts'
import { aggregateModelTokenUsage } from '../../src/shared/providerUsage.ts'

const NOW = 1_800_000_000_000
const SIX_HOURS = 6 * 60 * 60 * 1000

beforeEach(() => {
  cacheMissLedger.reset()
})

function classify(
  promptTokens: number,
  cacheReadTokens: number | undefined,
  at = NOW,
  key: string | undefined = 'sess-1',
  processStartedAt = NOW - 3_600_000
) {
  return cacheMissLedger.classify({
    key,
    promptTokens,
    cacheReadTokens,
    cacheReported: cacheReadTokens !== undefined,
    now: at,
    processStartedAt,
  })
}

/** 只写非零项，读起来才像「这一次是哪一格 +1」。 */
function detail(patch: Partial<Record<'coldFirst' | 'coldResumed' | 'breakAppend' | 'breakDiverged' | 'afterRestart', number>>) {
  return {
    coldFirst: 0,
    coldResumed: 0,
    breakAppend: 0,
    breakDiverged: 0,
    afterRestart: 0,
    ...patch,
  }
}

test('首轮没有上轮读数 ⇒ cold，不回填 prevPromptTokens', () => {
  assert.deepEqual(classify(100_000, 98_000), { class: 'cold', detail: detail({ coldFirst: 1 }) })
})

test('正常新增尾部（未命中 1%）⇒ tail，并带上轮大小', () => {
  classify(100_000, 99_000)
  const second = classify(110_000, 109_000)
  assert.equal(second?.class, 'tail')
  assert.equal(second?.prevPromptTokens, 100_000)
})

test('锚点还在却从中间断开（未命中 30%）⇒ break', () => {
  classify(100_000, 99_000)
  assert.equal(classify(120_000, 84_000)?.class, 'break')
})

test('break 且未命中不超过本轮新增 ⇒ append（结构上限，不是故障）', () => {
  classify(100_000, 99_000)
  const reading = classify(120_000, 105_000) // 未命中 15k，本轮新增 20k
  assert.equal(reading?.class, 'break')
  assert.deepEqual(reading?.detail, detail({ breakAppend: 1 }))
})

test('break 且未命中明显大于新增 ⇒ diverged（已有前缀被改写）', () => {
  classify(100_000, 99_000)
  const reading = classify(120_000, 90_000) // 未命中 30k，新增 20k（余量 2k）
  assert.equal(reading?.class, 'break')
  assert.deepEqual(reading?.detail, detail({ breakDiverged: 1 }))
})

test('cold 但会话有上轮读数 ⇒ resumed：锚点丢了，不是首轮', () => {
  classify(100_000, 99_000)
  const reading = classify(120_000, 30_000) // 75% 未命中
  assert.equal(reading?.class, 'cold')
  assert.deepEqual(reading?.detail, detail({ coldResumed: 1 }))
})

test('续轮丢锚按间隔分档：5 分钟 / 30 分钟两个边界', () => {
  // 每个边界用独立的会话键：classify 会把「上一次读数」推到本次时刻，
  // 共用键会让后一个断言量到下下轮的间隔。
  const gapAfter = (gapMs: number, key: string) => {
    classify(100_000, 99_000, NOW, key)
    return classify(120_000, 30_000, NOW + gapMs, key)?.idleGap
  }
  assert.equal(gapAfter(60_000, 'g1'), 'under5m')
  // 边界：恰好 5 分钟算「<5m」，恰好 30 分钟算「5–30m」。
  assert.equal(gapAfter(5 * 60_000, 'g2'), 'under5m')
  assert.equal(gapAfter(10 * 60_000, 'g3'), 'from5mTo30m')
  assert.equal(gapAfter(30 * 60_000, 'g4'), 'from5mTo30m')
  assert.equal(gapAfter(60 * 60_000, 'g5'), 'over30m')
})

test('长流式必须用入站时刻算空档，不能用落账时刻', () => {
  const key = 'sess-long-stream'
  classify(100_000, 99_000, NOW, key)
  // 上一轮 09:00 入站，本轮 09:04:59 入站，但流读到 09:10 才落账。
  const arrivedAt = NOW + 4 * 60_000 + 59_000
  const settledAt = NOW + 10 * 60_000
  assert.equal(classify(120_000, 30_000, arrivedAt, key)?.idleGap, 'under5m')
  assert.equal(
    classify(120_000, 30_000, settledAt, 'sess-long-stream-late')?.idleGap,
    undefined,
    '独立对照：首轮本就没有 idleGap',
  )
  assert.equal(classify(120_000, 30_000, settledAt, key)?.idleGap, 'from5mTo30m',
    '若拿落账时刻当 now，5 分钟边界会被系统性记错')
})

test('进程启动 10 分钟内的首轮 ⇒ afterRestart；超过窗口就不打', () => {
  const early = classify(100_000, 98_000, NOW, 'sess-restart', NOW - 60_000)
  assert.deepEqual(early?.detail, detail({ coldFirst: 1, afterRestart: 1 }))
  const late = classify(100_000, 98_000, NOW, 'sess-later', NOW - 11 * 60_000)
  assert.deepEqual(late?.detail, detail({ coldFirst: 1 }))
})

test('客户端把历史改小 ⇒ rewrite，哪怕本轮命中率很高', () => {
  classify(200_000, 198_000)
  const second = classify(120_000, 118_000)
  assert.equal(second?.class, 'rewrite')
  assert.equal(second?.prevPromptTokens, 200_000)
})

test('未命中超过一半又不能归因于收缩 ⇒ 仍是 cold（等同于锚点失效）', () => {
  classify(100_000, 99_000)
  assert.equal(classify(130_000, 40_000)?.class, 'cold')
})

test('超过 6 小时没有读数 ⇒ 不拿旧大小比，判 cold', () => {
  classify(100_000, 99_000, NOW)
  assert.deepEqual(
    classify(100_000, 99_000, NOW + SIX_HOURS + 1),
    { class: 'cold', detail: detail({ coldFirst: 1 }) },
  )
})

test('没有会话键或上游没报缓存 ⇒ 不分类，绝不充成 cold', () => {
  assert.equal(
    cacheMissLedger.classify({
      key: undefined,
      promptTokens: 1_000,
      cacheReadTokens: 990,
      cacheReported: true,
      now: NOW,
    }),
    undefined
  )
  assert.equal(classify(1_000, undefined), undefined)
})

function upstreamTurn(missClass?: 'cold' | 'rewrite' | 'break' | 'tail') {
  return accumulateDayBucket(undefined, {
    promptTokens: 1_000,
    completionTokens: 10,
    source: 'upstream',
    cacheReadTokens: 990,
    cacheReadReported: true,
    providerId: 'bailian',
    modelId: 'deepseek-v4.1-flash',
    ...(missClass === undefined ? {} : { cacheMissClass: missClass }),
  })
}

const MODEL_KEY = modelBucketKey('bailian', 'deepseek-v4.1-flash')

test('缺口成因只落在分模型表，缺省不写四零', () => {
  assert.deepEqual(upstreamTurn('tail').byModel?.[MODEL_KEY].cacheMissClasses, {
    cold: 0,
    rewrite: 0,
    break: 0,
    tail: 1,
  })
  assert.equal(upstreamTurn(undefined).byModel?.[MODEL_KEY].cacheMissClasses, undefined)
})

test('再切分与四类同批落库：只进分模型表，估算请求不入账', () => {
  const missDetail = { coldFirst: 0, coldResumed: 0, breakAppend: 1, breakDiverged: 0, afterRestart: 0 }
  const upstream = accumulateDayBucket(undefined, {
    promptTokens: 1_000,
    completionTokens: 10,
    source: 'upstream',
    cacheReadTokens: 990,
    cacheReadReported: true,
    providerId: 'bailian',
    modelId: 'deepseek-v4.1-flash',
    cacheMissClass: 'break',
    cacheMissDetail: missDetail,
    cacheMissTokens: 3_000,
  })
  assert.deepEqual(upstream.byModel?.[MODEL_KEY].cacheMissDetail, missDetail)
  assert.deepEqual(upstream.byModel?.[MODEL_KEY].cacheMissTokens, { cold: 0, rewrite: 0, break: 3_000, tail: 0 })
  assert.deepEqual(upstream.byModel?.[MODEL_KEY].cacheMissTokenDetail, {
    coldFirst: 0,
    coldResumed: 0,
    breakAppend: 3_000,
    breakDiverged: 0,
    afterRestart: 0,
  })

  const estimated = accumulateDayBucket(undefined, {
    promptTokens: 1_000,
    completionTokens: 10,
    source: 'estimated',
    providerId: 'bailian',
    modelId: 'deepseek-v4.1-flash',
    cacheMissClass: 'break',
    cacheMissDetail: missDetail,
    cacheMissTokens: 3_000,
  })
  assert.equal(estimated.byModel?.[MODEL_KEY].cacheMissDetail, undefined, '估算请求没有可归因的缺口')
  assert.equal(estimated.byModel?.[MODEL_KEY].cacheMissTokens, undefined)
})

test('afterRestart 是子集标记：同一笔未命中在 coldFirst 与它各记一次，四类里只记一次', () => {
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: 5_000,
    completionTokens: 0,
    source: 'upstream',
    cacheReadTokens: 0,
    cacheReadReported: true,
    providerId: 'bailian',
    modelId: 'deepseek-v4.1-flash',
    cacheMissClass: 'cold',
    cacheMissDetail: { coldFirst: 1, coldResumed: 0, breakAppend: 0, breakDiverged: 0, afterRestart: 1 },
    cacheMissTokens: 5_000,
  })
  assert.deepEqual(bucket.byModel?.[MODEL_KEY].cacheMissTokens, { cold: 5_000, rewrite: 0, break: 0, tail: 0 })
  assert.deepEqual(bucket.byModel?.[MODEL_KEY].cacheMissTokenDetail, {
    coldFirst: 5_000,
    coldResumed: 0,
    breakAppend: 0,
    breakDiverged: 0,
    afterRestart: 5_000,
  })
})

test('续轮间隔档与未命中 token 同批落库', () => {
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: 7_000,
    completionTokens: 0,
    source: 'upstream',
    cacheReadTokens: 1_000,
    cacheReadReported: true,
    providerId: 'bailian',
    modelId: 'deepseek-v4.1-flash',
    cacheMissClass: 'cold',
    cacheMissDetail: { coldFirst: 0, coldResumed: 1, breakAppend: 0, breakDiverged: 0, afterRestart: 0 },
    cacheMissTokens: 6_000,
    cacheMissIdleGap: 'over30m',
  })
  assert.deepEqual(bucket.byModel?.[MODEL_KEY].cacheMissIdleGap, { under5m: 0, from5mTo30m: 0, over30m: 1 })
  assert.deepEqual(bucket.byModel?.[MODEL_KEY].cacheMissIdleGapTokens, { under5m: 0, from5mTo30m: 0, over30m: 6_000 })
})

test('估算请求即使带了分类也不计缺口：没有上游读数就没有可归因的缺口', () => {
  const estimated = accumulateDayBucket(undefined, {
    promptTokens: 1_000,
    completionTokens: 10,
    source: 'estimated',
    providerId: 'bailian',
    modelId: 'deepseek-v4.1-flash',
    cacheMissClass: 'break',
  })
  assert.equal(estimated.byModel?.[MODEL_KEY].cacheMissClasses, undefined)
})

test('窗口聚合跨日相加四类计数，缺键的天不造零', () => {
  const day1 = upstreamTurn('cold')
  const day2 = accumulateDayBucket(day1, {
    promptTokens: 1_000,
    completionTokens: 10,
    source: 'upstream',
    cacheReadTokens: 990,
    cacheReadReported: true,
    providerId: 'bailian',
    modelId: 'deepseek-v4.1-flash',
    cacheMissClass: 'tail',
  })
  const stats = aggregateModelTokenUsage({ '2026-11-19': day2 }, { kind: 'all' }, NOW)
  assert.deepEqual(stats[MODEL_KEY].cacheMissClasses, { cold: 1, rewrite: 0, break: 0, tail: 1 })
})

test('窗口聚合把再切分跨日相加；没带再切分的天不造零', () => {
  const day1 = accumulateDayBucket(undefined, {
    promptTokens: 1_000,
    completionTokens: 10,
    source: 'upstream',
    cacheReadTokens: 900,
    cacheReadReported: true,
    providerId: 'bailian',
    modelId: 'deepseek-v4.1-flash',
    cacheMissClass: 'break',
    cacheMissDetail: { coldFirst: 0, coldResumed: 0, breakAppend: 1, breakDiverged: 0, afterRestart: 0 },
    cacheMissTokens: 3_000,
  })
  const day2 = accumulateDayBucket(day1, {
    promptTokens: 1_000,
    completionTokens: 10,
    source: 'upstream',
    cacheReadTokens: 900,
    cacheReadReported: true,
    providerId: 'bailian',
    modelId: 'deepseek-v4.1-flash',
    cacheMissClass: 'break',
    cacheMissDetail: { coldFirst: 0, coldResumed: 0, breakAppend: 0, breakDiverged: 1, afterRestart: 0 },
    cacheMissTokens: 1_000,
  })
  const stats = aggregateModelTokenUsage({ '2026-11-19': day2 }, { kind: 'all' }, NOW)
  assert.deepEqual(stats[MODEL_KEY].cacheMissDetail, {
    coldFirst: 0,
    coldResumed: 0,
    breakAppend: 1,
    breakDiverged: 1,
    afterRestart: 0,
  })
  assert.deepEqual(stats[MODEL_KEY].cacheMissTokens, { cold: 0, rewrite: 0, break: 4_000, tail: 0 })
  assert.deepEqual(stats[MODEL_KEY].cacheMissTokenDetail, {
    coldFirst: 0,
    coldResumed: 0,
    breakAppend: 3_000,
    breakDiverged: 1_000,
    afterRestart: 0,
  })
  assert.equal(stats[MODEL_KEY].cacheMissTokenDetail?.afterRestart, 0, 'afterRestart 只做子集标记，不在这里重复造数')
})