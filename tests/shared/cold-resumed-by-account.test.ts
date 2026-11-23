import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  accumulateDayBucket,
  modelBucketKey,
  normalizeDayBucket,
  emptyCacheMissDetail,
  OTHER_MODEL_KEY,
  MAX_COLD_RESUMED_ACCOUNT_KEYS,
  type CacheMissDetail,
  type DayTokenBucket,
} from '../../src/shared/tokenAccounting.ts'

const KEY = modelBucketKey('opencode_go', 'deepseek-v4.1-flash')
const RESUMED: CacheMissDetail = { ...emptyCacheMissDetail(), coldResumed: 1 }
const FRESH: CacheMissDetail = { ...emptyCacheMissDetail(), coldFirst: 1 }

function input(accountId?: string, detail: CacheMissDetail = RESUMED, missTokens = 6000) {
  return {
    promptTokens: 7200,
    completionTokens: 100,
    source: 'upstream' as const,
    cacheReadTokens: 1200,
    cacheReadReported: true,
    providerId: 'opencode_go',
    modelId: 'deepseek-v4.1-flash',
    cacheMissClass: 'cold' as const,
    cacheMissDetail: detail,
    cacheMissTokens: missTokens,
    cacheMissIdleGap: 'under5m' as const,
    ...(accountId === undefined ? {} : { accountId }),
  }
}

function row(bucket: DayTokenBucket | undefined) {
  return bucket!.byModel![KEY]
}

test('带账号的 coldResumed 只写旁路字段，六项既有计数逐字不变', () => {
  let withoutAccount: DayTokenBucket | undefined
  let withAccount: DayTokenBucket | undefined
  withoutAccount = accumulateDayBucket(withoutAccount, input())
  withAccount = accumulateDayBucket(withAccount, input('acc-1'))

  const base = row(withoutAccount)
  const next = row(withAccount)
  assert.deepEqual(next.cacheMissColdResumedByAccount, { 'acc-1': { requests: 1, missTokens: 6000 } })
  for (const field of [
    'cacheMissClasses',
    'cacheMissDetail',
    'cacheMissTokens',
    'cacheMissTokenDetail',
    'cacheMissIdleGap',
    'cacheMissIdleGapTokens',
  ] as const) {
    assert.deepEqual(next[field], base[field], `${field} must not change`)
  }
  assert.equal(next.upstreamPrompt, base.upstreamPrompt)
  assert.equal(next.upstreamCacheRead, base.upstreamCacheRead)
})

test('无账号、非 coldResumed、估算请求都不写新字段', () => {
  assert.equal(row(accumulateDayBucket(undefined, input())).cacheMissColdResumedByAccount, undefined)
  assert.equal(row(accumulateDayBucket(undefined, input('acc-1', FRESH))).cacheMissColdResumedByAccount, undefined)
  const estimated = accumulateDayBucket(undefined, {
    ...input('acc-1'),
    source: 'estimated',
    cacheReadTokens: undefined,
  })
  assert.equal(row(estimated).cacheMissColdResumedByAccount, undefined)
})

test('17 个账号折进 16 + __other__，token 一条不丢', () => {
  let bucket: DayTokenBucket | undefined
  for (let i = 0; i < 20; i++) bucket = accumulateDayBucket(bucket, input(`acc-${i}`, RESUMED, 100 + i))
  const accounts = row(bucket).cacheMissColdResumedByAccount!
  assert.equal(Object.keys(accounts).filter(key => key !== OTHER_MODEL_KEY).length, MAX_COLD_RESUMED_ACCOUNT_KEYS)
  assert.deepEqual(accounts['acc-0'], { requests: 1, missTokens: 100 })
  assert.deepEqual(accounts[OTHER_MODEL_KEY], { requests: 4, missTokens: 100 + 16 + 100 + 17 + 100 + 18 + 100 + 19 })
  const total = Object.values(accounts).reduce((sum, value) => sum + value.missTokens, 0)
  assert.equal(total, Array.from({ length: 20 }, (_, i) => 100 + i).reduce((sum, value) => sum + value, 0))
})

test('账号键沿用 modelBucketKey 的 :: 转义，空白账号等同无账号', () => {
  let bucket: DayTokenBucket | undefined
  bucket = accumulateDayBucket(bucket, input('ns::acc'))
  const accounts = row(bucket).cacheMissColdResumedByAccount!
  assert.deepEqual(accounts['ns_acc'], { requests: 1, missTokens: 6000 })
  assert.equal(accounts[OTHER_MODEL_KEY], undefined)
  // 空白账号在 accumulateDayBucket 入口就被过滤，不会在明细里造一个假账号。
  bucket = accumulateDayBucket(bucket, input('   '))
  assert.deepEqual(row(bucket).cacheMissColdResumedByAccount, accounts)
  assert.equal(modelBucketKey('a::b', 'c::d'), 'a_b::c_d')
})

test('normalize 清洗旧桶与脏数据，20 键压到 16 + 1', () => {
  const bucket = accumulateDayBucket(undefined, input('acc-0'))
  const model = row(bucket)
  assert.equal(model.cacheMissColdResumedByAccount !== undefined, true)

  // 旧桶没有这个字段：不能凭空造一张空表。
  const legacy = structuredClone(bucket)
  delete row(legacy).cacheMissColdResumedByAccount
  assert.equal(row(normalizeDayBucket(legacy)).cacheMissColdResumedByAccount, undefined)

  // 脏数据：数组、负数、NaN、空键、无已知键都进不来。
  const dirty = structuredClone(bucket)
  Object.assign(row(dirty), {
    cacheMissColdResumedByAccount: {
      'good::one': { requests: 3, missTokens: 30 },
      '': { requests: 1, missTokens: 1 },
      bad: { requests: -5, missTokens: Number.NaN },
      junk: { other: 1 },
    },
  })
  assert.deepEqual(row(normalizeDayBucket(dirty)).cacheMissColdResumedByAccount, {
    good_one: { requests: 3, missTokens: 30 },
    bad: { requests: 0, missTokens: 0 },
  })

  const many = structuredClone(bucket)
  Object.assign(row(many), {
    cacheMissColdResumedByAccount: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`acc-${i}`, { requests: 1, missTokens: i }])
    ),
  })
  const normalized = row(normalizeDayBucket(many)).cacheMissColdResumedByAccount!
  assert.equal(Object.keys(normalized).filter(key => key !== OTHER_MODEL_KEY).length, MAX_COLD_RESUMED_ACCOUNT_KEYS)
  assert.deepEqual(normalized[OTHER_MODEL_KEY], { requests: 4, missTokens: 16 + 17 + 18 + 19 })
})

test('累加前二次限幅：手改的脏 map 不会突破 16 + 1', () => {
  let bucket = accumulateDayBucket(undefined, input('acc-0'))
  Object.assign(row(bucket), {
    cacheMissColdResumedByAccount: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`acc-${i}`, { requests: 1, missTokens: i }])
    ),
  })
  bucket = accumulateDayBucket(bucket, input('brand-new'))
  const accounts = row(normalizeDayBucket(bucket)).cacheMissColdResumedByAccount!
  assert.equal(Object.keys(accounts).filter(key => key !== OTHER_MODEL_KEY).length, MAX_COLD_RESUMED_ACCOUNT_KEYS)
  assert.equal(accounts[OTHER_MODEL_KEY].requests, 5)
})

test('逐账号求和与既有 coldResumed 计数/token 对账', () => {
  let bucket: DayTokenBucket | undefined
  const ids = ['acc-a', 'acc-b', 'acc-a', 'acc-c']
  for (const id of ids) bucket = accumulateDayBucket(bucket, input(id, RESUMED, 7000))
  const model = row(bucket)
  const totalRequests = Object.values(model.cacheMissColdResumedByAccount!).reduce((sum, v) => sum + v.requests, 0)
  const totalTokens = Object.values(model.cacheMissColdResumedByAccount!).reduce((sum, v) => sum + v.missTokens, 0)
  assert.equal(totalRequests, model.cacheMissDetail!.coldResumed)
  assert.equal(totalTokens, model.cacheMissTokenDetail!.coldResumed)
})
