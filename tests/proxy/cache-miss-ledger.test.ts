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
  key: string | undefined = 'sess-1'
) {
  return cacheMissLedger.classify({
    key,
    promptTokens,
    cacheReadTokens,
    cacheReported: cacheReadTokens !== undefined,
    now: at,
  })
}

test('首轮没有上轮读数 ⇒ cold，不回填 prevPromptTokens', () => {
  assert.deepEqual(classify(100_000, 98_000), { class: 'cold' })
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
  assert.deepEqual(classify(100_000, 99_000, NOW + SIX_HOURS + 1), { class: 'cold' })
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