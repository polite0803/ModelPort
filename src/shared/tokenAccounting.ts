/**
 * Per-day token accounting, persisted separately from the request log.
 *
 * The request log is a bounded window (200 rows by default), so it cannot answer
 * "how many tokens today" — a busy proxy rotates it away within hours. These
 * counters are the durable answer, one bucket per local day.
 *
 * ## The two pools are never merged
 *
 * `usage` is `null` unless the upstream reported real numbers (see the public API
 * contract), and `UsageReading` already carries `source: 'upstream' | 'estimated'`.
 * That distinction is preserved all the way to the UI, in two separate fields:
 *
 * - `upstream` — what providers actually reported. This is the only figure that
 *   could ever be reconciled against a bill.
 * - `estimated` — `chars/4` fallback, used when no upstream usage came back.
 *   Enough for local cap metering, never a billing figure.
 *
 * Adding them into one "tokens today" number would be the easy mistake: most
 * shipped channels do not report usage at all, so the sum would be almost
 * entirely estimate while reading as fact.
 *
 * ## Savings are only what actually happened
 *
 * `savedTokens` counts compression that really took effect on a forwarded
 * request. Potential savings on skipped or disabled requests are deliberately not
 * counted — those are counterfactuals, and a dashboard must not present them as
 * measured.
 */

import { localDayKey } from './localDay.ts'

/**
 * One local day's counters **for one provider**.
 *
 * The global bucket answers "how many tokens today"; this answers the same
 * question per endpoint, which is what the provider statistics card needs. The
 * two pools stay separate here for the same reason they do globally.
 *
 * `costUsd` obeys three rules that the accumulator enforces rather than
 * convention: it folds **only** from upstream-reported usage (a `chars/4`
 * estimate times a price is an invoice nobody could reconcile); a request with
 * no price evidence contributes nothing, which is why `costedRequests` exists —
 * "$0.00 over 3 of 40 requests" is a different fact from "$0.00 over 40 of 40";
 * and a model inside a subscription counts as `$0` **cash at request time**,
 * which is not the same claim as "the plan allowance is unlimited".
 */
export interface ProviderDayUsage {
  upstreamPrompt: number
  upstreamCompletion: number
  estimatedPrompt: number
  estimatedCompletion: number
  requests: number
  upstreamRequests: number
  /** USD estimate; the sum of the priced requests of this day. */
  costUsd: number
  /** Requests whose cost was computable at all — the denominator for `costUsd`. */
  costedRequests: number
}

export type ProviderDayUsageMap = Record<string, ProviderDayUsage>

/** One day's counters. */
export interface DayTokenBucket {
  /** Tokens the upstream itself reported. */
  upstreamPrompt: number
  upstreamCompletion: number
  /** `chars/4` estimates for requests where upstream reported nothing. */
  estimatedPrompt: number
  estimatedCompletion: number
  /** Tokens compression actually removed (estimate of the saved text). */
  savedTokens: number
  /**
   * Input tokens the upstream said were **cache reads** (subset of
   * `upstreamPrompt`). Only ever accumulated from an upstream-reported usage,
   * so an estimated request contributes nothing — "we did not measure it" is
   * not "it did not happen".
   *
   * This is the field that answers "does the replayed prefix actually get
   * charged": a day with a high `upstreamPrompt` and `upstreamCacheRead` close
   * to it is paying for the same bytes again and again.
   */
  upstreamCacheRead: number
  /** Requests that contributed to this day. */
  requests: number
  /** Requests whose usage came from the upstream rather than the estimator. */
  upstreamRequests: number
  /**
   * Same counters split by provider. Optional because a bucket written before
   * this field existed simply has no split — reading it as "every provider had
   * zero traffic" would erase the distinction between "not recorded" and
   * "nothing served", which the card renders as "-" for exactly that reason.
   */
  byProvider?: ProviderDayUsageMap
}

export interface DayTokenSummary extends DayTokenBucket {
  /** Local `YYYY-MM-DD`. */
  day: string
  /**
   * `upstreamRequests / requests`, or null when nothing was recorded.
   *
   * The dashboard shows this next to the numbers so a mostly-estimated day is
   * never read as a mostly-measured one.
   */
  upstreamCoverage: number | null
  /**
   * Whether live-zone compression is switched on, attached by the store when it
   * builds today's summary. `false` means `savedTokens` **cannot** be a
   * measurement — nothing was allowed to compress, so the day's 0 is the absence
   * of a source rather than a result. The card renders "-" for exactly that case.
   *
   * Absent means the producer never asked, which is not "off".
   */
  compressionEnabled?: boolean
}

/** Newest-first retention. 400 days is a bit over a year of history. */
const MAX_DAYS = 400

function emptyBucket(): DayTokenBucket {
  return {
    upstreamPrompt: 0,
    upstreamCompletion: 0,
    estimatedPrompt: 0,
    estimatedCompletion: 0,
    savedTokens: 0,
    upstreamCacheRead: 0,
    requests: 0,
    upstreamRequests: 0,
  }
}

function nonNegative(value: number | undefined): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0
}

/**
 * Money is floored like nothing else here: a request can genuinely cost a
 * fraction of a cent, and `nonNegative()` would turn the whole day's spend into
 * 0 the moment every request was cheap.
 */
function nonNegativeAmount(value: number | undefined): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function emptyProviderUsage(): ProviderDayUsage {
  return {
    upstreamPrompt: 0,
    upstreamCompletion: 0,
    estimatedPrompt: 0,
    estimatedCompletion: 0,
    requests: 0,
    upstreamRequests: 0,
    costUsd: 0,
    costedRequests: 0,
  }
}

/** Clean one persisted per-provider map, key by key, so a hand-edited file cannot poison totals. */
function normalizeProviderUsage(input: unknown): ProviderDayUsageMap {
  const raw = (input ?? {}) as Record<string, unknown>
  const next: ProviderDayUsageMap = {}

  for (const [providerId, value] of Object.entries(raw)) {
    if (!providerId.trim()) continue
    const item = (value ?? {}) as Record<string, unknown>
    const usage = emptyProviderUsage()
    // Same rule as the day bucket: the field list lives in `emptyProviderUsage()`
    // alone, so a counter added later is cleaned without anyone remembering.
    for (const key of Object.keys(usage) as (keyof ProviderDayUsage)[]) {
      usage[key] = key === 'costUsd'
        ? nonNegativeAmount(item[key] as number)
        : nonNegative(item[key] as number)
    }
    next[providerId] = usage
  }

  return next
}

/**
 * Fold one request into a day bucket. Pure: returns a new bucket, never mutates.
 *
 * Kept pure so the accumulation rule can be tested without a store, and so the
 * caller can persist the result however it needs to.
 */
export function accumulateDayBucket(
  bucket: DayTokenBucket | undefined,
  input: {
    promptTokens: number
    completionTokens: number
    source: 'upstream' | 'estimated'
    savedTokens?: number
    /** Cache-read input tokens, only meaningful when `source` is `upstream`. */
    cacheReadTokens?: number
    /**
     * The provider that served this request. Blank or absent means the per
     * provider split is not written — the global pools still accrue, because
     * "we did not record which endpoint" is not "no endpoint served it".
     */
    providerId?: string
    /**
     * USD for this request, or `undefined` when there is no price evidence.
     * `0` is a claim ("this cost nothing"); absence is the fact ("unpriced"),
     * and only a defined value increments `costedRequests`.
     */
    costUsd?: number
  }
): DayTokenBucket {
  // ⚠️ 走 `normalizeDayBucket` 而不是直接信任入参：调用方喂的是**磁盘上读出来**
  // 的对象。老文件没有 `upstreamCacheRead`（这个字段是后加的），直接相加会算出
  // `NaN` 并一路写回存储，把这一天的全部计数污染成不可显示。`normalizeDayBucket`
  // 本来就是"手改的文件不能毒化总量"的守卫，这里过去没用它才是漏的那一半。
  const base = normalizeDayBucket(bucket)
  const prompt = nonNegative(input.promptTokens)
  const completion = nonNegative(input.completionTokens)
  const saved = nonNegative(input.savedTokens)
  const isUpstream = input.source === 'upstream'

  const next: DayTokenBucket = {
    upstreamPrompt: base.upstreamPrompt + (isUpstream ? prompt : 0),
    upstreamCompletion: base.upstreamCompletion + (isUpstream ? completion : 0),
    estimatedPrompt: base.estimatedPrompt + (isUpstream ? 0 : prompt),
    estimatedCompletion: base.estimatedCompletion + (isUpstream ? 0 : completion),
    savedTokens: base.savedTokens + saved,
    // 估算请求**不可能**带来缓存命中：写了就是把"没测到"伪装成"测到了"。
    upstreamCacheRead: base.upstreamCacheRead + (isUpstream ? nonNegative(input.cacheReadTokens) : 0),
    requests: base.requests + 1,
    upstreamRequests: base.upstreamRequests + (isUpstream ? 1 : 0),
  }

  const providerId = (input.providerId ?? '').trim()
  if (providerId.length === 0) return next

  const previous = base.byProvider?.[providerId] ?? emptyProviderUsage()
  // 与 `upstreamCacheRead` 同一条理由：估算的 token 数乘上标价不是"估算的费用"，
  // 而是一张谁也核对不了的账单。估算请求只进 token 池，永远不进 `costUsd`。
  const cost = isUpstream && typeof input.costUsd === 'number' && Number.isFinite(input.costUsd) && input.costUsd >= 0
    ? input.costUsd
    : null

  next.byProvider = {
    ...base.byProvider,
    [providerId]: {
      upstreamPrompt: previous.upstreamPrompt + (isUpstream ? prompt : 0),
      upstreamCompletion: previous.upstreamCompletion + (isUpstream ? completion : 0),
      estimatedPrompt: previous.estimatedPrompt + (isUpstream ? 0 : prompt),
      estimatedCompletion: previous.estimatedCompletion + (isUpstream ? 0 : completion),
      requests: previous.requests + 1,
      upstreamRequests: previous.upstreamRequests + (isUpstream ? 1 : 0),
      costUsd: previous.costUsd + (cost ?? 0),
      costedRequests: previous.costedRequests + (cost === null ? 0 : 1),
    },
  }

  return next
}

/** Project a stored bucket into the report shape, adding the day key and coverage. */
export function summarizeDay(day: string, bucket: DayTokenBucket): DayTokenSummary {
  const requests = bucket.requests
  return {
    ...bucket,
    day,
    upstreamCoverage: requests > 0 ? bucket.upstreamRequests / requests : null,
  }
}

/**
 * Trim the map to the newest `MAX_DAYS` keys by calendar day.
 *
 * Keys are `YYYY-MM-DD`, so a plain string sort is chronological — no timestamp
 * parsing and no timezone dependency.
 */
export function trimDays(
  buckets: Record<string, DayTokenBucket>,
  maxDays: number = MAX_DAYS
): Record<string, DayTokenBucket> {
  const keys = Object.keys(buckets)
  if (keys.length <= maxDays) return buckets

  const keep = new Set(keys.sort().slice(-maxDays))
  const trimmed: Record<string, DayTokenBucket> = {}
  for (const key of keys) {
    if (keep.has(key)) trimmed[key] = buckets[key]
  }
  return trimmed
}

/** Normalize one persisted bucket, so a hand-edited file cannot poison totals. */
export function normalizeDayBucket(input: unknown): DayTokenBucket {
  const raw = (input ?? {}) as Record<string, unknown>
  // 字段清单只有 `emptyBucket()` 一处：逐键清洗，而不是逐个字段手写一遍。
  // 这条不是偷懒 —— 本次给接口加 `upstreamCacheRead` 时，如果这里仍是手抄清单，
  // 忘记加它就会让**旧文件读出来的桶**缺这个键，然后 `accumulateDayBucket`
  // 拿它去相加，把这一整天全部计数写成 `NaN`。
  //
  // `emptyBucket()` 因此只放**数字**计数器：`byProvider` 是这层清洗唯一的例外，
  // 它按自己的形状逐个供应商洗（下面），因为对它做一次 `Number()` 会把整张
  // 分表抹成 0 —— 而抹掉它同样是丢数据，`accumulateDayBucket` 每一步都过这里。
  const next: DayTokenBucket = emptyBucket()
  // `Exclude<…, 'byProvider'>` is not a convenience: it is what keeps this loop
  // assignable. `byProvider` is the one field whose clean-up is a map, so the
  // `nonNegative()` write below would type it as a number.
  const numericKeys = Object.keys(next) as Exclude<keyof DayTokenBucket, 'byProvider'>[]
  for (const key of numericKeys) {
    next[key] = nonNegative(raw[key] as number)
  }
  next.byProvider = normalizeProviderUsage(raw.byProvider)
  return next
}

/** The local day key for a timestamp, re-exported so callers need one import. */
export function tokenDayKey(timestamp: number = Date.now()): string {
  return localDayKey(timestamp)
}
