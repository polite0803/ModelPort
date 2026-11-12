import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dailyTrendPoints,
  dayCountsOf,
  differenceInPoints,
  isolatedIndices,
  percentChange,
  successRateOf,
  type DailyBucket,
} from '../../src/shared/trendMath.ts'

test('a comparison with an unknown side is null, never 0%', () => {
  assert.equal(percentChange(null, 10), null)
  assert.equal(percentChange(10, null), null)
  assert.equal(percentChange(null, null), null)
  assert.equal(percentChange(15, 10), 50)
  assert.equal(percentChange(5, 10), -50)
})

test('a genuine zero base still reads as new traffic', () => {
  assert.equal(percentChange(4, 0), 100)
  assert.equal(percentChange(0, 0), 0)
})

test('a success-rate difference needs both days measured', () => {
  assert.equal(differenceInPoints(90, 80), 10)
  assert.equal(differenceInPoints(90, null), null)
  assert.equal(differenceInPoints(null, 80), null)
})

test('a day carries requests, successes and latency, or nothing', () => {
  assert.deepEqual(
    dayCountsOf({ date: '2026-10-29', total: 10, success: 8, error: 2, avgLatency: 300 }),
    { requests: 10, success: 8, avgLatency: 300 },
  )
  assert.deepEqual(dayCountsOf(undefined), { requests: null, success: null, avgLatency: null })
  assert.deepEqual(
    dayCountsOf({ date: '2026-10-22', total: null, success: null, error: null, avgLatency: null }),
    { requests: null, success: null, avgLatency: null },
  )
})

test('a day with no requests has no success rate', () => {
  assert.equal(successRateOf({ requests: 0, success: 0, avgLatency: 0 }), null)
  assert.equal(successRateOf({ requests: null, success: null, avgLatency: null }), null)
  assert.equal(successRateOf({ requests: 3, success: 2, avgLatency: 100 }), 67)
})

test('a lone retained day is a marker, not an invisible path', () => {
  // The whole window survives on one day: a path of one point paints nothing.
  assert.deepEqual(isolatedIndices([null, null, null, null, null, null, 200]), [6])
  assert.deepEqual(isolatedIndices([7]), [0])
  assert.deepEqual(isolatedIndices([5, null, 7, null, 9]), [0, 2, 4])
})

test('neighbouring days keep the line and need no marker', () => {
  assert.deepEqual(isolatedIndices([1, 2, 3]), [])
  assert.deepEqual(isolatedIndices([null, 2, 3, null]), [])
  assert.deepEqual(isolatedIndices([null, null, null]), [])
  assert.deepEqual(isolatedIndices([]), [])
})

test('the trend reads the daily rollup, day by day', () => {
  const now = Date.parse('2026-10-30T12:00:00')
  const rollup = {
    '2026-10-28': { totalRequests: 10, successRequests: 9, failedRequests: 1, totalLatency: 900 },
    '2026-10-29': { totalRequests: 4, successRequests: 4, failedRequests: 0, totalLatency: 400 },
    '2026-10-30': { totalRequests: 6, successRequests: 3, failedRequests: 3, totalLatency: 301 },
  }

  const points = dailyTrendPoints(rollup, 7, now)

  assert.deepEqual(points.map((point) => point.date), [
    '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30',
  ])
  assert.deepEqual(points[4], { date: '2026-10-28', total: 10, success: 9, error: 1, avgLatency: 100 })
  assert.deepEqual(points[6], { date: '2026-10-30', total: 6, success: 3, error: 3, avgLatency: 100 })
  for (const point of points.slice(0, 4)) {
    assert.equal(point.total, null, `${point.date} predates the oldest recorded day`)
  }
})

test('重建天画得出请求数与成败，画不出平均延迟', () => {
  const now = Date.parse('2026-10-30T12:00:00')
  const rollup: Record<string, DailyBucket> = {
    '2026-10-29': {
      totalRequests: 5031,
      successRequests: 4906,
      failedRequests: 125,
      totalLatency: 2999467,
      totalRequestsSource: 'tokenLedger',
    },
  }

  const point = dailyTrendPoints(rollup, 2, now).find((item) => item.date === '2026-10-29')
  assert.equal(point?.total, 5031)
  assert.equal(point?.success, 4906)
  assert.equal(point?.error, 125)
  assert.equal(point?.avgLatency, null, '延迟只有已记段，除以抬高后的成功数会读出一个凭空的低值')
})

test('a day inside the rollup that served nothing is a real zero', () => {
  const now = Date.parse('2026-10-30T12:00:00')
  const rollup = {
    '2026-10-28': { totalRequests: 2, successRequests: 2, failedRequests: 0, totalLatency: 20 },
    '2026-10-30': { totalRequests: 1, successRequests: 0, failedRequests: 1, totalLatency: 0 },
  }

  const points = dailyTrendPoints(rollup, 3, now)

  assert.deepEqual(points[1], { date: '2026-10-29', total: 0, success: 0, error: 0, avgLatency: 0 })
  assert.deepEqual(points[2], { date: '2026-10-30', total: 1, success: 0, error: 1, avgLatency: 0 },
    'a day with no successful request has no average latency to report')
})

test('an empty rollup says nothing about any day', () => {
  const points = dailyTrendPoints({}, 7, Date.parse('2026-10-30T12:00:00'))

  assert.equal(points.length, 7)
  assert.ok(points.every((point) => point.total === null))
})
