import { currentLocalDay, recentLocalDays } from './localDay.ts'
import type { DayTokenBucket } from './tokenAccounting.ts'

/**
 * One local day of per-provider counters, in the shape `dailyStats` is stored
 * under. Structural on purpose: the writer lives in the main process and the
 * reader in the renderer, and neither type declaration is importable from the
 * other side.
 */
export interface DailyProviderUsage {
  /** Requests served, success or not. */
  providerUsage?: Record<string, number>
  /** Successful requests. Absent on buckets written before outcomes were recorded. */
  providerSuccess?: Record<string, number>
  /** Summed latency of the successful requests. Same absence rule. */
  providerLatency?: Record<string, number>
}

export type ProviderStatsWindow =
  | { kind: 'today' }
  | { kind: 'days'; days: number }
  | { kind: 'all' }
  /** Both day keys inclusive, `YYYY-MM-DD`. */
  | { kind: 'range'; start: string; end: string }

export const DEFAULT_PROVIDER_WINDOW: ProviderStatsWindow = { kind: 'today' }

export interface ProviderWindowUsage {
  requests: number
  /**
   * `undefined` when nothing in the window recorded outcomes for this provider -
   * which is a fact about the buckets, not a 0% success rate.
   */
  successRate?: number
  /** `undefined` when unrecorded, or when no successful request was measured. */
  avgLatencyMs?: number
  /**
   * Earliest day in the window that has outcome data. Lets the UI say "自 … 起"
   * rather than imply the rate covers the whole window.
   */
  coveredFrom?: string
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Whether a hand-typed or imported value can be compared as a day key. */
export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && DAY_KEY_PATTERN.test(value)
}

function compareDayKeys(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * The stored day keys the window can speak for, oldest first.
 *
 * A window asks for days; a bucket only exists where traffic happened. Keys
 * outside the stored set are therefore not "a day with 0 requests", they are
 * days this record says nothing about - which is why `all` reads the keys back
 * instead of spanning from the oldest requested day.
 */
export function windowDayKeys(
  days: Record<string, unknown>,
  window: ProviderStatsWindow,
  now: number = Date.now()
): string[] {
  const stored = Object.keys(days).filter(isDayKey).sort(compareDayKeys)

  if (window.kind === 'all') return stored

  if (window.kind === 'range') {
    if (!isDayKey(window.start) || !isDayKey(window.end)) return []
    return stored.filter(
      (key) => compareDayKeys(key, window.start) >= 0 && compareDayKeys(key, window.end) <= 0
    )
  }

  const wanted =
    window.kind === 'today'
      ? [currentLocalDay(now).key]
      : recentLocalDays(window.days, now).map((day) => day.key)

  return stored.filter((key) => wanted.includes(key))
}

interface Accumulator {
  requests: number
  /** Requests in covered days: the only honest denominator for the rate. */
  coveredRequests: number
  successes: number
  latencySum: number
  coveredFrom?: string
}

/**
 * Sum the window's day buckets per provider.
 *
 * A day counts as covered when it carries both outcome maps, because the writer
 * emits them together. The success rate is then successes over *covered*
 * requests only: dividing by all requests in a partly-covered window would
 * charge the unrecorded days as failures.
 */
export function aggregateProviderUsage(
  days: Record<string, DailyProviderUsage>,
  window: ProviderStatsWindow,
  now: number = Date.now()
): Record<string, ProviderWindowUsage> {
  const totals: Record<string, Accumulator> = {}

  for (const key of windowDayKeys(days, window, now)) {
    const bucket = days[key]
    const covered = bucket?.providerSuccess !== undefined && bucket?.providerLatency !== undefined

    for (const [providerId, requests] of Object.entries(bucket?.providerUsage ?? {})) {
      if (!(requests > 0)) continue

      const total = totals[providerId] ?? { requests: 0, coveredRequests: 0, successes: 0, latencySum: 0 }
      total.requests += requests

      if (covered) {
        const successes = bucket?.providerSuccess?.[providerId] ?? 0
        total.coveredRequests += requests
        total.successes += successes
        total.latencySum += bucket?.providerLatency?.[providerId] ?? 0
        if (total.coveredFrom === undefined || compareDayKeys(key, total.coveredFrom) < 0) {
          total.coveredFrom = key
        }
      }

      totals[providerId] = total
    }
  }

  const result: Record<string, ProviderWindowUsage> = {}

  for (const [providerId, total] of Object.entries(totals)) {
    const usage: ProviderWindowUsage = { requests: total.requests }

    if (total.coveredRequests > 0) {
      usage.successRate = Math.round((total.successes / total.coveredRequests) * 100)
    }
    if (total.successes > 0) {
      usage.avgLatencyMs = Math.round(total.latencySum / total.successes)
    }
    if (total.coveredFrom !== undefined) {
      usage.coveredFrom = total.coveredFrom
    }

    result[providerId] = usage
  }

  return result
}

/**
 * Per-provider token and cash totals over the same window.
 *
 * A separate record from `aggregateProviderUsage` because it comes out of a
 * different store key (`tokenUsage`, not `statistics.dailyStats`) with its own
 * retention: a provider can be covered in one and absent in the other, which is
 * why the card reads `-` per column instead of hiding the whole row.
 */
export interface ProviderWindowTokenUsage {
  /** Tokens the upstream reported. The only pool that could match a bill. */
  upstreamTokens: number
  /**
   * `chars/4` estimates, shown **beside** the upstream figure and never added
   * to it - see the module docblock of `shared/tokenAccounting`.
   */
  estimatedTokens: number
  requests: number
  upstreamRequests: number
  /**
   * USD estimate over upstream-reported usage of models that have price
   * evidence. `undefined` means "no request in this window could be priced",
   * which the card renders as `-`, never as `$0.00` - the first is a fact about
   * our evidence, the second is a claim about the user's bill.
   */
  costUsd?: number
  /** Requests `costUsd` was computable for; the denominator that makes it readable. */
  costedRequests: number
  /** Earliest day in the window carrying a per-provider split. */
  coveredFrom?: string
}

interface TokenAccumulator {
  upstreamTokens: number
  estimatedTokens: number
  requests: number
  upstreamRequests: number
  costUsd: number
  costedRequests: number
  coveredFrom?: string
}

export function aggregateProviderTokenUsage(
  days: Record<string, DayTokenBucket>,
  window: ProviderStatsWindow,
  now: number = Date.now()
): Record<string, ProviderWindowTokenUsage> {
  const totals: Record<string, TokenAccumulator> = {}

  for (const key of windowDayKeys(days, window, now)) {
    const byProvider = days[key]?.byProvider
    if (byProvider === undefined) continue

    for (const [providerId, usage] of Object.entries(byProvider)) {
      const total = totals[providerId] ?? {
        upstreamTokens: 0,
        estimatedTokens: 0,
        requests: 0,
        upstreamRequests: 0,
        costUsd: 0,
        costedRequests: 0,
      }

      total.upstreamTokens += usage.upstreamPrompt + usage.upstreamCompletion
      total.estimatedTokens += usage.estimatedPrompt + usage.estimatedCompletion
      total.requests += usage.requests
      total.upstreamRequests += usage.upstreamRequests
      total.costUsd += usage.costUsd
      total.costedRequests += usage.costedRequests
      if (total.coveredFrom === undefined || compareDayKeys(key, total.coveredFrom) < 0) {
        total.coveredFrom = key
      }

      totals[providerId] = total
    }
  }

  const result: Record<string, ProviderWindowTokenUsage> = {}

  for (const [providerId, total] of Object.entries(totals)) {
    const usage: ProviderWindowTokenUsage = {
      upstreamTokens: total.upstreamTokens,
      estimatedTokens: total.estimatedTokens,
      requests: total.requests,
      upstreamRequests: total.upstreamRequests,
      costedRequests: total.costedRequests,
    }

    // A window that only held unpriced requests has no money figure at all,
    // rather than a 0 that would read as "this endpoint is free".
    if (total.costedRequests > 0) usage.costUsd = total.costUsd
    if (total.coveredFrom !== undefined) usage.coveredFrom = total.coveredFrom

    result[providerId] = usage
  }

  return result
}

/**
 * Per-`(provider, model)` cache counters over the same window.
 *
 * The key is the pair, not the model name: the same model served by two
 * endpoints has two cache domains, and a merged hit rate would reconcile with
 * neither. Only upstream-reported numbers are summed — estimated requests still
 * count in `requests`, so coverage stays readable, but they never enter
 * `promptTokens` / `cacheReadTokens`.
 */
export interface ModelWindowTokenUsage {
  providerId: string
  model: string
  /** Every request, estimated or upstream-reported. */
  requests: number
  /** Requests whose usage came from the upstream — the coverage denominator. */
  upstreamRequests: number
  /** Upstream-reported input tokens; cache reads are a subset. */
  promptTokens: number
  /** Upstream-reported cache-read input tokens. */
  cacheReadTokens: number
  /** Upstream requests carrying a cache figure (an explicit 0 counts). */
  cacheReportedRequests: number
  /**
   * Prompt tokens of the cache-reporting requests only. This is the hit-rate
   * denominator: dividing by every upstream prompt would charge providers that
   * never report caching as 0% hits.
   */
  promptWithCache: number
  /** Earliest day in the window carrying this model's split. */
  coveredFrom?: string
}

export function aggregateModelTokenUsage(
  days: Record<string, DayTokenBucket>,
  window: ProviderStatsWindow,
  now: number = Date.now()
): Record<string, ModelWindowTokenUsage> {
  const totals: Record<string, ModelWindowTokenUsage> = {}

  for (const key of windowDayKeys(days, window, now)) {
    const byModel = days[key]?.byModel
    if (byModel === undefined) continue

    for (const [modelKey, usage] of Object.entries(byModel)) {
      const total = totals[modelKey] ?? {
        providerId: usage.providerId,
        model: usage.model,
        requests: 0,
        upstreamRequests: 0,
        promptTokens: 0,
        cacheReadTokens: 0,
        cacheReportedRequests: 0,
        promptWithCache: 0,
      }

      total.requests += usage.requests
      total.upstreamRequests += usage.upstreamRequests
      total.promptTokens += usage.upstreamPrompt
      total.cacheReadTokens += usage.upstreamCacheRead
      total.cacheReportedRequests += usage.cacheReportedRequests
      total.promptWithCache += usage.upstreamPromptWithCache
      if (total.coveredFrom === undefined || compareDayKeys(key, total.coveredFrom) < 0) {
        total.coveredFrom = key
      }

      totals[modelKey] = total
    }
  }

  return totals
}
