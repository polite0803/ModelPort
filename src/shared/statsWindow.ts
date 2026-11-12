/**
 * Day-window arithmetic for the dashboard's headline cards.
 *
 * The cards have to speak about ONE scope. Reading total requests off the whole
 * rollup while averaging latency over today is not a period, it is two figures
 * that cannot be compared - and neither one answers "what happened on the 3rd".
 * So every headline number is summed here over an explicit window of the day
 * buckets, the same store key `ProviderStatusCard` sums.
 *
 * Absence stays absence: a window with no stored bucket returns `null`, never
 * `0`. A day before the app was installed served nothing, but nothing recorded
 * it, and those are different statements.
 */

import { currentLocalDay, localDayKey } from './localDay.ts'
import { isDayKey, windowDayKeys } from './providerUsage.ts'
import type { ProviderStatsWindow } from './providerUsage.ts'
import type { DayTokenBucket, DayTokenSummary } from './tokenAccounting.ts'
import type { DailyBucket } from './trendMath.ts'

const MS_PER_DAY = 86_400_000

/** Local midnight of a `YYYY-MM-DD` key; `null` for a malformed key. */
function dayKeyToDate(key: string): Date | null {
  if (!isDayKey(key)) return null
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Step a day key by whole local days, keeping DST from shifting the date. */
export function shiftDayKey(key: string, delta: number): string {
  const date = dayKeyToDate(key)
  if (date === null) return key
  date.setDate(date.getDate() + delta)
  return localDayKey(date.getTime())
}

/** How many local days `start..end` spans, both inclusive; `0` when reversed. */
export function inclusiveDayCount(start: string, end: string): number {
  const from = dayKeyToDate(start)
  const to = dayKeyToDate(end)
  if (from === null || to === null || to < from) return 0
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1
}

/**
 * The window immediately before `window`, of the same length.
 *
 * `all` has no predecessor, and a window of unknown length has none either:
 * both return `null`, which the cards render as "no comparison" rather than
 * comparing against an empty set and calling it a change.
 */
export function previousWindow(
  window: ProviderStatsWindow,
  now: number = Date.now(),
): ProviderStatsWindow | null {
  if (window.kind === 'all') return null

  const today = currentLocalDay(now).key

  if (window.kind === 'today') {
    const yesterday = shiftDayKey(today, -1)
    return { kind: 'range', start: yesterday, end: yesterday }
  }

  if (window.kind === 'days') {
    const count = Math.max(1, Math.floor(window.days))
    return {
      kind: 'range',
      start: shiftDayKey(today, -2 * count + 1),
      end: shiftDayKey(today, -count),
    }
  }

  const length = inclusiveDayCount(window.start, window.end)
  if (length <= 0) return null
  return { kind: 'range', start: shiftDayKey(window.start, -length), end: shiftDayKey(window.start, -1) }
}

export interface WindowDayTotals {
  /** `null` when the window holds no stored bucket - unknown, not zero. */
  requests: number | null
  /** Successes over the window's requests, in percent; `null` when nothing served. */
  successRate: number | null
  /** Mean latency of the successful requests; `null` when none was measured. */
  avgLatencyMs: number | null
  /** Earliest contributing day, for the "自 … 起" hint. */
  coveredFrom?: string
  /** How many stored days contributed. */
  days: number
}

const EMPTY_TOTALS: WindowDayTotals = {
  requests: null,
  successRate: null,
  avgLatencyMs: null,
  days: 0,
}

/**
 * Sum the window's day buckets into the three headline figures.
 *
 * The success rate divides by the window's requests and the average latency by
 * its successful requests, so a window where the outcome maps are missing
 * reports `null` instead of a 0% rate or a 0ms average.
 */
export function windowDayTotals(
  buckets: Record<string, DailyBucket>,
  window: ProviderStatsWindow,
  now: number = Date.now(),
): WindowDayTotals {
  const keys = windowDayKeys(buckets, window, now)
  if (keys.length === 0) return EMPTY_TOTALS

  let requests = 0
  let success = 0
  let latency = 0
  let latencySuccess = 0

  for (const key of keys) {
    const bucket = buckets[key]
    if (bucket === undefined) continue
    requests += bucket.totalRequests ?? 0
    success += bucket.successRequests ?? 0
    // 重建天（`tokenLedger`）的 `totalLatency` 只有已记段，而它的成功数已按构造抬高，
    // 一起平均会把整窗口的平均延迟拉成一个凭空的低值（现网实测 116ms）。这类天不进
    // 延迟分子分母；窗口里只剩这类天时读 `null`（未记录），不是 0ms。
    if (bucket.totalRequestsSource !== 'tokenLedger') {
      latency += bucket.totalLatency ?? 0
      latencySuccess += bucket.successRequests ?? 0
    }
  }

  return {
    requests,
    successRate: requests > 0 ? Math.round((success / requests) * 100) : null,
    avgLatencyMs: latencySuccess > 0 ? Math.round(latency / latencySuccess) : null,
    coveredFrom: keys[0],
    days: keys.length,
  }
}

/**
 * The window's token counters, in the shape the card already renders.
 *
 * Only the totals are merged: the per-provider and per-model splits answer a
 * different question (and the cache card sums them on its own window), so a
 * merged summary carries no splits rather than a half-merged map that would
 * read as a complete one.
 *
 * `compressionEnabled` is deliberately not derived here. It describes the
 * current switch position, not a historical day, so a past window leaves it
 * `undefined` and the card shows the measured savings without the "switched
 * off" verdict.
 */
export function windowTokenSummary(
  days: Record<string, DayTokenBucket>,
  window: ProviderStatsWindow,
  now: number = Date.now(),
): DayTokenSummary | null {
  const keys = windowDayKeys(days, window, now)
  if (keys.length === 0) return null

  let upstreamPrompt = 0
  let upstreamCompletion = 0
  let estimatedPrompt = 0
  let estimatedCompletion = 0
  let savedTokens = 0
  let upstreamCacheRead = 0
  let requests = 0
  let upstreamRequests = 0

  for (const key of keys) {
    const bucket = days[key]
    if (bucket === undefined) continue
    upstreamPrompt += bucket.upstreamPrompt
    upstreamCompletion += bucket.upstreamCompletion
    estimatedPrompt += bucket.estimatedPrompt
    estimatedCompletion += bucket.estimatedCompletion
    savedTokens += bucket.savedTokens
    upstreamCacheRead += bucket.upstreamCacheRead
    requests += bucket.requests
    upstreamRequests += bucket.upstreamRequests
  }

  return {
    // A window is not a day; the last key is the closest thing to "as of".
    day: keys[keys.length - 1],
    upstreamPrompt,
    upstreamCompletion,
    estimatedPrompt,
    estimatedCompletion,
    savedTokens,
    upstreamCacheRead,
    requests,
    upstreamRequests,
    upstreamCoverage: requests > 0 ? upstreamRequests / requests : null,
  }
}