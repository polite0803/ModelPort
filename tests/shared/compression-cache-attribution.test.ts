import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  accumulateDayBucket,
  addCompressionArms,
  normalizeDayBucket,
  normalizeProviderCompression,
  summarizeCompressionCache,
  type CompressionArmPair,
  type DayTokenBucket,
} from '../../src/shared/tokenAccounting.ts'

function dayWithBothArms(): DayTokenBucket {
  let bucket: DayTokenBucket | undefined
  // Applied: the upstream saw 1,000 prompt tokens, 400 of them cached, after
  // compression removed an estimated 250 tokens.
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 1000,
    completionTokens: 10,
    source: 'upstream',
    savedTokens: 250,
    cacheReadTokens: 400,
    cacheReadReported: true,
    providerId: 'deepseek',
    compression: { applied: ['json'], candidates: [] },
  })
  // Refused: 2,000 prompt tokens, 1,500 cached.
  bucket = accumulateDayBucket(bucket, {
    promptTokens: 2000,
    completionTokens: 20,
    source: 'upstream',
    cacheReadTokens: 1500,
    cacheReadReported: true,
    providerId: 'deepseek',
    compression: { applied: [], skipped: 'insufficient_savings', candidates: [] },
  })
  return bucket
}

test('the two compression arms are accounted separately per provider', () => {
  const bucket = dayWithBothArms()
  const arms = bucket.byProvider?.deepseek?.compression
  assert.ok(arms !== undefined)

  assert.deepEqual(arms.applied, {
    requests: 1,
    promptTokens: 1000,
    cacheReportedRequests: 1,
    promptTokensWithCache: 1000,
    cacheReadTokens: 400,
    savedTokens: 250,
  })
  assert.deepEqual(arms.refused, {
    requests: 1,
    promptTokens: 2000,
    cacheReportedRequests: 1,
    promptTokensWithCache: 2000,
    cacheReadTokens: 1500,
    savedTokens: 0,
  })
  // The day's global pools are untouched by the split.
  assert.equal(bucket.upstreamPrompt, 3000)
  assert.equal(bucket.upstreamCacheRead, 1900)
})

test('an estimated request cannot enter either arm', () => {
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: 5000,
    completionTokens: 10,
    source: 'estimated',
    providerId: 'deepseek',
    compression: { applied: [], skipped: 'below_min_tokens', candidates: [] },
  })

  assert.equal(bucket.byProvider?.deepseek?.compression, undefined)
})

test('requests without a compression verdict do not create the instrument', () => {
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: 100,
    completionTokens: 10,
    source: 'upstream',
    providerId: 'deepseek',
  })

  assert.equal(bucket.byProvider?.deepseek?.compression, undefined)
})

test('an upstream without a cache figure keeps the share null, not zero', () => {
  const bucket = accumulateDayBucket(undefined, {
    promptTokens: 100,
    completionTokens: 10,
    source: 'upstream',
    providerId: 'some-custom',
    compression: { applied: ['log'], candidates: [] },
  })

  const arms = bucket.byProvider?.['some-custom']?.compression
  assert.equal(arms?.applied.cacheReportedRequests, 0)
  assert.equal(arms?.applied.promptTokensWithCache, 0)
  const summary = summarizeCompressionCache(arms)
  assert.equal(summary.appliedCacheShare, null, '未报缓存 ≠ 0% 命中')
})

test('a hand-edited arm pair is sanitized and an absent one stays absent', () => {
  assert.equal(normalizeProviderCompression(undefined), undefined)
  assert.equal(normalizeProviderCompression({}), undefined)

  const cleaned = normalizeProviderCompression({
    applied: { requests: -1, promptTokens: 'abc', cacheReadTokens: Number.POSITIVE_INFINITY },
    refused: null,
  })
  assert.deepEqual(cleaned, {
    applied: {
      requests: 0,
      promptTokens: 0,
      cacheReportedRequests: 0,
      promptTokensWithCache: 0,
      cacheReadTokens: 0,
      savedTokens: 0,
    },
    refused: {
      requests: 0,
      promptTokens: 0,
      cacheReportedRequests: 0,
      promptTokensWithCache: 0,
      cacheReadTokens: 0,
      savedTokens: 0,
    },
  })

  // A bucket written before this field existed must not read as "measured zero".
  const old = normalizeDayBucket({ byProvider: { deepseek: { upstreamPrompt: 10, requests: 1 } } })
  assert.equal(old.byProvider?.deepseek?.compression, undefined)
})

test('several days fold into one window by addition', () => {
  const a: CompressionArmPair = {
    applied: {
      requests: 1,
      promptTokens: 100,
      cacheReportedRequests: 1,
      promptTokensWithCache: 100,
      cacheReadTokens: 10,
      savedTokens: 20,
    },
    refused: {
      requests: 2,
      promptTokens: 200,
      cacheReportedRequests: 2,
      promptTokensWithCache: 200,
      cacheReadTokens: 120,
      savedTokens: 0,
    },
  }

  const summed = addCompressionArms(a, a)
  assert.equal(summed.applied.requests, 2)
  assert.equal(summed.applied.promptTokens, 200)
  assert.equal(summed.applied.savedTokens, 40)
  assert.equal(summed.refused.cacheReadTokens, 240)
  // Summing with nothing returns the same numbers, so a first day needs no special case.
  assert.deepEqual(addCompressionArms(undefined, a), a)
})

test('the two-round account compares the realized saving against the cache break-even', () => {
  const arms: CompressionArmPair = {
    applied: {
      requests: 3,
      promptTokens: 1000,
      cacheReportedRequests: 3,
      promptTokensWithCache: 1000,
      cacheReadTokens: 400,
      savedTokens: 250,
    },
    refused: {
      requests: 3,
      promptTokens: 2000,
      cacheReportedRequests: 3,
      promptTokensWithCache: 2000,
      cacheReadTokens: 1500,
      savedTokens: 0,
    },
  }

  const deepseek = summarizeCompressionCache(arms, { readDiscount: 0.02, writeMultiplier: 0 })
  // realized = 250 / (1000 + 250) = 0.2; break-even = 1 - 0.02 = 0.98
  assert.ok(Math.abs((deepseek.realizedSavingRatio ?? 0) - 0.2) < 1e-9)
  assert.ok(Math.abs((deepseek.breakEvenSavingRatio ?? 0) - 0.98) < 1e-9)
  assert.equal(deepseek.clearsBreakEven, false)
  assert.equal(deepseek.appliedCacheShare, 0.4)
  assert.equal(deepseek.refusedCacheShare, 0.75)

  const noCacheEvidence = summarizeCompressionCache(arms)
  assert.equal(noCacheEvidence.breakEvenSavingRatio, null)
  assert.equal(noCacheEvidence.clearsBreakEven, null)
})

test('nothing applied reports null, never a zero saving', () => {
  const summary = summarizeCompressionCache(undefined, { readDiscount: 0.1, writeMultiplier: 0.25 })
  assert.equal(summary.realizedSavingRatio, null)
  assert.equal(summary.appliedCacheShare, null)
  assert.equal(summary.clearsBreakEven, null)
  assert.ok(Math.abs((summary.breakEvenSavingRatio ?? 0) - 0.92) < 1e-9)
})