import type { DailyTrendPoint } from './types.ts'
import { recentLocalDays } from './localDay.ts'

/**
 * The dashboard compares today with yesterday. Both sides can be unknown -
 * a day outside the retained log window, or a day with no successful request to
 * average - and an unknown is not a 0% change.
 */
export interface DayCounts {
  requests: number | null
  success: number | null
  avgLatency: number | null
}

/**
 * The dashboard's per-day numbers all come from the persistent daily rollup:
 * it counts every request the proxy handled (refusals included) and is not
 * capped by row count, unlike the request log.
 */
export function dayCountsOf(point: DailyTrendPoint | undefined): DayCounts {
  if (!point) return { requests: null, success: null, avgLatency: null }
  return { requests: point.total, success: point.success, avgLatency: point.avgLatency }
}

export interface DailyBucket {
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalLatency: number
  /**
   * `tokenLedger` = 这一天的总数与成功数不是逐笔记出来的（清空事故后按用量桶重建）。
   * `totalLatency` 只有已记段，除以抬高后的成功数会读出一个凭空的低延迟，所以带这个
   * 标记的天**不参与**平均延迟：图上断线、窗口聚合跳过它。
   */
  totalRequestsSource?: 'tokenLedger'
}

/**
 * A day before the oldest recorded bucket has nothing behind it (the app was not
 * counting yet); a day inside that range without a bucket really did serve
 * nothing. Never the other way round.
 */
export function dailyTrendPoints(
  buckets: Record<string, DailyBucket>,
  days: number,
  now: number = Date.now(),
): DailyTrendPoint[] {
  const oldestKey = Object.keys(buckets).sort()[0]

  return recentLocalDays(days, now).map((window) => {
    if (!oldestKey || oldestKey > window.key) {
      return { date: window.key, total: null, success: null, error: null, avgLatency: null }
    }

    const bucket = buckets[window.key]
    const success = bucket?.successRequests ?? 0
    // 重建天的 `totalLatency` 只是已记段，除以抬高后的成功数会得到一个凭空的低延迟
    // （现网实测 11-12 因此从 2.6s 掉到 116ms）。延迟这一格对它取 `null` = 未记录。
    const latencyRecorded = bucket?.totalRequestsSource !== 'tokenLedger'
    return {
      date: window.key,
      total: bucket?.totalRequests ?? 0,
      success,
      error: bucket?.failedRequests ?? 0,
      avgLatency: !latencyRecorded
        ? null
        : bucket && success > 0 ? Math.round(bucket.totalLatency / success) : 0,
    }
  })
}

export function successRateOf(counts: DayCounts): number | null {
  if (counts.requests === null || counts.success === null || counts.requests === 0) return null
  return Math.round((counts.success / counts.requests) * 100)
}

/** `null` when either side is unknown; a real zero base still reads as +100%. */
export function percentChange(current: number | null, base: number | null): number | null {
  if (current === null || base === null) return null
  if (base === 0) return current > 0 ? 100 : 0
  return Math.round(((current - base) / base) * 100)
}

export function differenceInPoints(current: number | null, base: number | null): number | null {
  if (current === null || base === null) return null
  return current - base
}

/**
 * Indices of non-null values with no non-null neighbour. A series that survives
 * on a single day has to be drawn as a marker: one point is a `moveto`, and a
 * path with no segment paints nothing, which reads exactly like "no data".
 */
export function isolatedIndices(values: Array<number | null>): number[] {
  const indices: number[] = []
  values.forEach((value, index) => {
    if (value === null) return
    const previous = index > 0 ? values[index - 1] : null
    const next = index < values.length - 1 ? values[index + 1] : null
    if (previous === null && next === null) indices.push(index)
  })
  return indices
}
