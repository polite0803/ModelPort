import test from 'node:test'
import assert from 'node:assert/strict'

import {
  inclusiveDayCount,
  previousWindow,
  shiftDayKey,
  windowDayTotals,
  windowTokenSummary,
} from '../../src/shared/statsWindow.ts'
import type { DayTokenBucket } from '../../src/shared/tokenAccounting.ts'
import type { DailyBucket } from '../../src/shared/trendMath.ts'

/** Local noon of 2026-11-10, so "today" is unambiguous in every timezone. */
const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime()

function bucket(total: number, success: number, latency: number): DailyBucket {
  return {
    totalRequests: total,
    successRequests: success,
    failedRequests: total - success,
    totalLatency: latency,
  }
}

function tokenBucket(patch: Partial<DayTokenBucket> = {}): DayTokenBucket {
  return {
    upstreamPrompt: 0,
    upstreamCompletion: 0,
    estimatedPrompt: 0,
    estimatedCompletion: 0,
    savedTokens: 0,
    upstreamCacheRead: 0,
    requests: 0,
    upstreamRequests: 0,
    ...patch,
  }
}

test('a day key steps by whole local days and survives month boundaries', () => {
  assert.equal(shiftDayKey('2026-11-10', -1), '2026-11-09')
  assert.equal(shiftDayKey('2026-11-01', -1), '2026-10-31')
  assert.equal(shiftDayKey('2026-12-31', 1), '2027-01-01')
  // Malformed keys are returned untouched: stepping an unknown date would invent one.
  assert.equal(shiftDayKey('not-a-day', 1), 'not-a-day')
})

test('an inclusive span counts both ends, and a reversed one counts nothing', () => {
  assert.equal(inclusiveDayCount('2026-11-01', '2026-11-07'), 7)
  assert.equal(inclusiveDayCount('2026-11-07', '2026-11-07'), 1)
  assert.equal(inclusiveDayCount('2026-11-07', '2026-11-01'), 0)
  assert.equal(inclusiveDayCount('bad', '2026-11-01'), 0)
})

test('the previous period has the same length, and "all" has none', () => {
  assert.deepEqual(previousWindow({ kind: 'today' }, NOW), {
    kind: 'range',
    start: '2026-11-09',
    end: '2026-11-09',
  })
  assert.deepEqual(previousWindow({ kind: 'days', days: 7 }, NOW), {
    kind: 'range',
    start: '2026-10-28',
    end: '2026-11-03',
  })
  assert.deepEqual(previousWindow({ kind: 'range', start: '2026-11-08', end: '2026-11-10' }, NOW), {
    kind: 'range',
    start: '2026-11-05',
    end: '2026-11-07',
  })
  assert.equal(previousWindow({ kind: 'all' }, NOW), null)
  assert.equal(previousWindow({ kind: 'range', start: '2026-11-10', end: '2026-11-01' }, NOW), null)
})

test('an empty window reports unknown figures, not zeroes', () => {
  assert.deepEqual(windowDayTotals({}, { kind: 'range', start: '2026-11-01', end: '2026-11-07' }, NOW), {
    requests: null,
    successRate: null,
    avgLatencyMs: null,
    days: 0,
  })
  assert.equal(windowTokenSummary({}, { kind: 'all' }, NOW), null)
})

test('重建天（tokenLedger）不进平均延迟，但照常进请求数', () => {
  const rebuilt: DailyBucket = {
    totalRequests: 6860,
    successRequests: 6860,
    failedRequests: 0,
    // 清空事故后按用量桶重建：总数与成功数被抬高，而 totalLatency 只剩已记段。
    totalLatency: 795669,
    totalRequestsSource: 'tokenLedger',
  }
  const buckets: Record<string, DailyBucket> = {
    '2026-11-08': bucket(10, 8, 3000),
    '2026-11-09': rebuilt,
  }

  const totals = windowDayTotals(buckets, { kind: 'range', start: '2026-11-08', end: '2026-11-09' }, NOW)
  assert.equal(totals.requests, 6870, '请求数照常进窗口')
  assert.equal(totals.avgLatencyMs, Math.round(3000 / 8), '平均延迟只能由带已记延迟的那几天算出')

  const onlyRebuilt = windowDayTotals({ '2026-11-09': rebuilt }, { kind: 'all' }, NOW)
  // 拿抬高后的成功数去除半截延迟，实测会读出 116ms —— 那比"未记录"更假。
  assert.equal(onlyRebuilt.avgLatencyMs, null, '窗口里只剩重建天时读未记录，不是 0ms')
  assert.equal(onlyRebuilt.requests, 6860)
})

test('a window sums its days into one comparable period', () => {
  const buckets: Record<string, DailyBucket> = {
    '2026-11-08': bucket(10, 8, 3000),
    '2026-11-09': bucket(5, 5, 1000),
    '2026-11-10': bucket(1, 1, 500),
  }
  const totals = windowDayTotals(buckets, { kind: 'range', start: '2026-11-08', end: '2026-11-09' }, NOW)
  assert.deepEqual(totals, {
    requests: 15,
    successRate: 87,
    avgLatencyMs: 308,
    coveredFrom: '2026-11-08',
    days: 2,
  })
})

test('measured zero and not-measured are different results', () => {
  // 5 requests all failed: the rate is a real 0%, the latency was never measured.
  const failed = windowDayTotals(
    { '2026-11-10': bucket(5, 0, 0) },
    { kind: 'today' },
    NOW,
  )
  assert.equal(failed.requests, 5)
  assert.equal(failed.successRate, 0)
  assert.equal(failed.avgLatencyMs, null)

  // A bucket present but counters absent: nothing recorded, so nothing claimed.
  const empty = windowDayTotals(
    { '2026-11-10': { totalRequests: 0, successRequests: 0, failedRequests: 0, totalLatency: 0 } },
    { kind: 'today' },
    NOW,
  )
  assert.equal(empty.requests, 0)
  assert.equal(empty.successRate, null)
  assert.equal(empty.avgLatencyMs, null)
})

test('token totals merge across the window and keep no per-split halves', () => {
  const days: Record<string, DayTokenBucket> = {
    '2026-11-08': tokenBucket({
      upstreamPrompt: 100,
      upstreamCompletion: 10,
      estimatedPrompt: 5,
      estimatedCompletion: 1,
      savedTokens: 2,
      upstreamCacheRead: 60,
      requests: 4,
      upstreamRequests: 3,
    }),
    '2026-11-09': tokenBucket({
      upstreamPrompt: 200,
      upstreamCompletion: 20,
      estimatedPrompt: 7,
      estimatedCompletion: 3,
      savedTokens: 4,
      upstreamCacheRead: 120,
      requests: 6,
      upstreamRequests: 6,
    }),
  }

  const summary = windowTokenSummary(days, { kind: 'all' }, NOW)
  assert.ok(summary)
  assert.equal(summary.day, '2026-11-09')
  assert.equal(summary.upstreamPrompt, 300)
  assert.equal(summary.upstreamCompletion, 30)
  assert.equal(summary.estimatedPrompt, 12)
  assert.equal(summary.estimatedCompletion, 4)
  assert.equal(summary.savedTokens, 6)
  assert.equal(summary.upstreamCacheRead, 180)
  assert.equal(summary.requests, 10)
  assert.equal(summary.upstreamRequests, 9)
  assert.equal(summary.upstreamCoverage, 0.9)
  // A merged window is not a day: it must not pretend to carry provider/model splits.
  assert.equal(summary.byProvider, undefined)
  assert.equal(summary.byModel, undefined)
  // "Compression is off" describes the live switch, not a historical window.
  assert.equal(summary.compressionEnabled, undefined)
})