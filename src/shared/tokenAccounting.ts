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
  /**
   * Compression/cache arms of this provider on this day. Optional: a bucket
   * written before this instrument existed says nothing about compression, and
   * reading that as "both arms measured zero" would render a false comparison.
   */
  compression?: CompressionArmPair
}

export type ProviderDayUsageMap = Record<string, ProviderDayUsage>

/**
 * One local day's counters for one `(provider, model)` pair.
 *
 * The pair is the key on purpose: a model served by two endpoints has two cache
 * domains, and merging by model name would produce a hit rate that reconciles
 * with neither bill.
 */
export interface ModelDayUsage {
  providerId: string
  model: string
  /** Every request, estimated or upstream-reported. */
  requests: number
  /** Requests whose usage came from the upstream — the coverage denominator. */
  upstreamRequests: number
  /** Upstream-reported input tokens; cache reads are a subset. */
  upstreamPrompt: number
  /** Upstream-reported cache-read input tokens. */
  upstreamCacheRead: number
  /**
   * Upstream requests that carried a cache figure, including an explicit 0.
   * Only these can enter a hit-rate denominator — a provider that never reports
   * caching must render "-", not 0%.
   */
  cacheReportedRequests: number
  /** Upstream prompt tokens of the cache-reporting requests. */
  upstreamPromptWithCache: number
}

export type ModelDayUsageMap = Record<string, ModelDayUsage>

/** Cap on model rows per day; overflow folds into {@link OTHER_MODEL_KEY}. */
export const MAX_MODEL_KEYS_PER_DAY = 200

/** Aggregation bucket for models beyond the per-day cap. */
export const OTHER_MODEL_KEY = '__other__'

/**
 * Compression verdict of one request, as the accounting layer needs it.
 *
 * Structural on purpose: the producer is the proxy's `CompressionReport`, which
 * the renderer cannot import, and the writer must not reshape it by hand (a
 * dropped `candidates` array silently turns every "would have won" into "no
 * candidate").
 */
export interface CompressionVerdict {
  /** Compressors that actually rewrote something. Empty means refused. */
  applied: readonly string[]
  /** Why nothing was applied. Only read when `applied` is empty. */
  skipped?: string
  candidates?: readonly CompressionCandidateReading[]
}

/** One candidate as the accept gate saw it. */
export interface CompressionCandidateReading {
  contentType: string
  tokensBefore: number
  tokensAfter: number
  accepted: boolean
}

/**
 * Upstream-measured requests of one compression arm (applied or refused).
 *
 * The two arms are the A/B the two-round account needs: "compression on" versus
 * "compression refused" on the same provider, both with real prompt tokens, so
 * the realized cache share and the realized saving can be compared instead of
 * assumed. Only upstream-reported requests enter — an estimate cannot say
 * whether a prefix was cached.
 */
export interface CompressionCacheArm {
  /** Upstream-measured requests in this arm. */
  requests: number
  /** Prompt tokens the upstream reported for those requests (already compressed on the applied arm). */
  promptTokens: number
  /** Requests that carried a cache figure; an explicit 0 counts as reported. */
  cacheReportedRequests: number
  /** Prompt tokens of the cache-reporting requests — the only honest hit-rate denominator. */
  promptTokensWithCache: number
  /** Cache-read input tokens (subset of `promptTokensWithCache`). */
  cacheReadTokens: number
  /** ESTIMATED tokens compression removed; always 0 on the refused arm. */
  savedTokens: number
}

export interface CompressionArmPair {
  applied: CompressionCacheArm
  refused: CompressionCacheArm
}

/**
 * Fixed buckets for a candidate's projected `tokensAfter / tokensBefore`.
 *
 * The edges are not decoration: 2% is what DeepSeek's cache read discount asks
 * for, 8% is `c / (1 + w)` for Anthropic (0.1 / 1.25). A single "below 10%"
 * bucket could not tell the two apart, and the P3 question is exactly which
 * side of those edges real traffic falls on.
 */
export const COMPRESSION_RATIO_BUCKETS = ['lt1', 'lt2', 'lt5', 'lt8', 'lt10', 'lt25', 'gte25'] as const

export type CompressionRatioBucket = (typeof COMPRESSION_RATIO_BUCKETS)[number]

/** Project a candidate's after/before ratio into its bucket, or null when unusable. */
export function compressionRatioBucket(tokensBefore: number, tokensAfter: number): CompressionRatioBucket | null {
  if (!Number.isFinite(tokensBefore) || !Number.isFinite(tokensAfter)) return null
  if (tokensBefore <= 0 || tokensAfter < 0) return null
  const pct = (tokensAfter / tokensBefore) * 100
  if (pct < 1) return 'lt1'
  if (pct < 2) return 'lt2'
  if (pct < 5) return 'lt5'
  if (pct < 8) return 'lt8'
  if (pct < 10) return 'lt10'
  if (pct < 25) return 'lt25'
  return 'gte25'
}

/** Candidates of one content type, with their projected ratio distribution. */
export interface CompressionContentCounters {
  candidates: number
  /** How many of them the accept gate let through. */
  accepted: number
  tokensBefore: number
  tokensAfter: number
  ratioBuckets: Record<CompressionRatioBucket, number>
}

/**
 * One day of compression verdicts.
 *
 * Exists because the request log keeps ~1–2 days (`maxEntries` + the error
 * floor), which cannot answer a 7-day question. Optional on the bucket: a day
 * written before this field existed says nothing about compression, and reading
 * that as "nothing was compressed" is the distinction the whole file protects.
 */
export interface CompressionDayCounters {
  /** Requests that carried a verdict — applied or refused. */
  analyzed: number
  /** Requests where at least one compressor rewrote content. */
  applied: number
  /** Refused requests, by reason. */
  skipped: Record<string, number>
  byContentType: Record<string, CompressionContentCounters>
}

/** Content-type rows kept per day; overflow folds into this key. */
const MAX_COMPRESSION_CONTENT_TYPES = 16
/** Bucket for a content-type row beyond {@link MAX_COMPRESSION_CONTENT_TYPES}. */
const OTHER_CONTENT_TYPE_KEY = '__other__'
/** Distinct skip reasons kept per day; a hand-edited file cannot grow this. */
const MAX_COMPRESSION_SKIP_REASONS = 16

function emptyRatioBuckets(): Record<CompressionRatioBucket, number> {
  return { lt1: 0, lt2: 0, lt5: 0, lt8: 0, lt10: 0, lt25: 0, gte25: 0 }
}

function emptyContentCounters(): CompressionContentCounters {
  return { candidates: 0, accepted: 0, tokensBefore: 0, tokensAfter: 0, ratioBuckets: emptyRatioBuckets() }
}

function emptyCompressionCounters(): CompressionDayCounters {
  return { analyzed: 0, applied: 0, skipped: {}, byContentType: {} }
}

/**
 * Fold one request's verdict into the day's counters. Pure, like the rest.
 *
 * `analyzed` counts verdicts, not candidates, so a request with three tool
 * results is one observation — that is the unit the P3 question is asked in.
 */
export function accumulateCompressionCounters(
  base: CompressionDayCounters | undefined,
  verdict: CompressionVerdict
): CompressionDayCounters {
  const previous = base ?? emptyCompressionCounters()
  const skipped = { ...previous.skipped }

  if (verdict.applied.length === 0) {
    const reason = (verdict.skipped ?? '').trim() || 'unknown'
    const known = skipped[reason] !== undefined
    if (!known && Object.keys(skipped).length >= MAX_COMPRESSION_SKIP_REASONS) {
      skipped.unknown = (skipped.unknown ?? 0) + 1
    } else {
      skipped[reason] = (skipped[reason] ?? 0) + 1
    }
  }

  let byContentType = previous.byContentType
  for (const candidate of verdict.candidates ?? []) {
    const contentType = candidate.contentType.trim()
    if (contentType.length === 0) continue
    const key = byContentType[contentType] !== undefined
      || Object.keys(byContentType).length < MAX_COMPRESSION_CONTENT_TYPES
      ? contentType
      : OTHER_CONTENT_TYPE_KEY
    const prior = byContentType[key] ?? emptyContentCounters()
    const bucket = compressionRatioBucket(candidate.tokensBefore, candidate.tokensAfter)
    byContentType = {
      ...byContentType,
      [key]: {
        candidates: prior.candidates + 1,
        accepted: prior.accepted + (candidate.accepted ? 1 : 0),
        tokensBefore: prior.tokensBefore + nonNegative(candidate.tokensBefore),
        tokensAfter: prior.tokensAfter + nonNegative(candidate.tokensAfter),
        ratioBuckets: bucket === null
          ? prior.ratioBuckets
          : { ...prior.ratioBuckets, [bucket]: prior.ratioBuckets[bucket] + 1 },
      },
    }
  }

  return {
    analyzed: previous.analyzed + 1,
    applied: previous.applied + (verdict.applied.length > 0 ? 1 : 0),
    skipped,
    byContentType,
  }
}

/** Normalize one persisted compression counter block; null when absent. */
export function normalizeCompressionCounters(input: unknown): CompressionDayCounters | undefined {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Record<string, unknown>
  const next = emptyCompressionCounters()
  next.analyzed = nonNegative(raw.analyzed as number)
  next.applied = nonNegative(raw.applied as number)

  const rawSkipped = raw.skipped
  if (rawSkipped !== null && typeof rawSkipped === 'object' && !Array.isArray(rawSkipped)) {
    for (const [reason, count] of Object.entries(rawSkipped as Record<string, unknown>)) {
      const key = reason.trim()
      if (key.length === 0) continue
      if (next.skipped[key] === undefined && Object.keys(next.skipped).length >= MAX_COMPRESSION_SKIP_REASONS) continue
      next.skipped[key] = nonNegative(count as number)
    }
  }

  const rawByType = raw.byContentType
  if (rawByType !== null && typeof rawByType === 'object' && !Array.isArray(rawByType)) {
    for (const [contentType, counters] of Object.entries(rawByType as Record<string, unknown>)) {
      const key = contentType.trim()
      if (key.length === 0) continue
      if (Object.keys(next.byContentType).length >= MAX_COMPRESSION_CONTENT_TYPES) break
      if (counters === null || typeof counters !== 'object' || Array.isArray(counters)) continue
      const row = counters as Record<string, unknown>
      const ratioBuckets = emptyRatioBuckets()
      const rawBuckets = row.ratioBuckets
      if (rawBuckets !== null && typeof rawBuckets === 'object' && !Array.isArray(rawBuckets)) {
        for (const bucket of COMPRESSION_RATIO_BUCKETS) {
          ratioBuckets[bucket] = nonNegative((rawBuckets as Record<string, unknown>)[bucket] as number)
        }
      }
      next.byContentType[key] = {
        candidates: nonNegative(row.candidates as number),
        accepted: nonNegative(row.accepted as number),
        tokensBefore: nonNegative(row.tokensBefore as number),
        tokensAfter: nonNegative(row.tokensAfter as number),
        ratioBuckets,
      }
    }
  }

  return next
}

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
  /**
   * Same counters split by `provider::model`. Optional for the same reason as
   * `byProvider`: a bucket written before this field existed says nothing about
   * per-model traffic, and reading that as zero would render a false 0% hit rate.
   */
  byModel?: ModelDayUsageMap
  /**
   * Compression verdicts of this day. Optional for the same reason as the two
   * splits above, and one more: it exists so a 7-day question outlives a log
   * retention of ~2 days (`docs/plan/PLAN-prompt-cache.md` §P3). A bucket
   * without it predates the instrument, which is not "nothing was compressed".
   */
  compression?: CompressionDayCounters
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

function emptyCacheArm(): CompressionCacheArm {
  return {
    requests: 0,
    promptTokens: 0,
    cacheReportedRequests: 0,
    promptTokensWithCache: 0,
    cacheReadTokens: 0,
    savedTokens: 0,
  }
}

function normalizeCacheArm(input: unknown): CompressionCacheArm {
  const raw = (input ?? {}) as Record<string, unknown>
  const arm = emptyCacheArm()
  for (const key of Object.keys(arm) as (keyof CompressionCacheArm)[]) {
    arm[key] = nonNegative(raw[key] as number)
  }
  return arm
}

/** Clean one persisted arm pair; undefined when the field was never written. */
export function normalizeProviderCompression(input: unknown): CompressionArmPair | undefined {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Record<string, unknown>
  const hasArm = (raw.applied !== null && typeof raw.applied === 'object')
    || (raw.refused !== null && typeof raw.refused === 'object')
  if (!hasArm) return undefined
  return { applied: normalizeCacheArm(raw.applied), refused: normalizeCacheArm(raw.refused) }
}

/** Sum two arm pairs; used to fold several days into one window. */
export function addCompressionArms(
  left: CompressionArmPair | undefined,
  right: CompressionArmPair | undefined
): CompressionArmPair {
  const a = left ?? { applied: emptyCacheArm(), refused: emptyCacheArm() }
  const b = right ?? { applied: emptyCacheArm(), refused: emptyCacheArm() }
  const sum = (x: CompressionCacheArm, y: CompressionCacheArm): CompressionCacheArm => ({
    requests: x.requests + y.requests,
    promptTokens: x.promptTokens + y.promptTokens,
    cacheReportedRequests: x.cacheReportedRequests + y.cacheReportedRequests,
    promptTokensWithCache: x.promptTokensWithCache + y.promptTokensWithCache,
    cacheReadTokens: x.cacheReadTokens + y.cacheReadTokens,
    savedTokens: x.savedTokens + y.savedTokens,
  })
  return { applied: sum(a.applied, b.applied), refused: sum(a.refused, b.refused) }
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
      if (key === 'compression') continue
      usage[key] = key === 'costUsd'
        ? nonNegativeAmount(item[key] as number)
        : nonNegative(item[key] as number)
    }
    const compression = normalizeProviderCompression(item.compression)
    if (compression !== undefined) usage.compression = compression
    next[providerId] = usage
  }

  return next
}

/** Key for the per-model split; `::` inside either part is flattened first. */
export function modelBucketKey(providerId: string, model: string): string {
  return `${providerId.replace(/::/g, '_')}::${model.replace(/::/g, '_')}`
}

function emptyModelUsage(providerId: string, model: string): ModelDayUsage {
  return {
    providerId,
    model,
    requests: 0,
    upstreamRequests: 0,
    upstreamPrompt: 0,
    upstreamCacheRead: 0,
    cacheReportedRequests: 0,
    upstreamPromptWithCache: 0,
  }
}

export function normalizeModelUsage(input: unknown): ModelDayUsageMap | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const next: ModelDayUsageMap = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const raw = value as Record<string, unknown>
    const providerId = typeof raw.providerId === 'string' ? raw.providerId.trim() : ''
    const model = typeof raw.model === 'string' ? raw.model.trim() : ''
    if (providerId.length === 0 || model.length === 0) continue
    next[key] = {
      providerId,
      model,
      requests: nonNegative(raw.requests as number),
      upstreamRequests: nonNegative(raw.upstreamRequests as number),
      upstreamPrompt: nonNegative(raw.upstreamPrompt as number),
      upstreamCacheRead: nonNegative(raw.upstreamCacheRead as number),
      cacheReportedRequests: nonNegative(raw.cacheReportedRequests as number),
      upstreamPromptWithCache: nonNegative(raw.upstreamPromptWithCache as number),
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function accumulateModelUsage(
  base: ModelDayUsageMap | undefined,
  providerId: string,
  model: string,
  isUpstream: boolean,
  prompt: number,
  cacheRead: number,
  cacheReported: boolean
): ModelDayUsageMap {
  const known = base ?? {}
  const key = modelBucketKey(providerId, model)
  const existing = known[key]
  // Cap the map so a pathological model list cannot grow one day's bucket
  // forever. `__other__` keeps the totals reconcilable with the top-level pools.
  const target = existing === undefined
    && Object.keys(known).filter(candidate => candidate !== OTHER_MODEL_KEY).length >= MAX_MODEL_KEYS_PER_DAY
    ? OTHER_MODEL_KEY
    : key
  const previous = target === OTHER_MODEL_KEY
    ? (known[OTHER_MODEL_KEY] ?? emptyModelUsage(OTHER_MODEL_KEY, OTHER_MODEL_KEY))
    : (existing ?? emptyModelUsage(providerId, model))

  return {
    ...known,
    [target]: {
      ...previous,
      requests: previous.requests + 1,
      upstreamRequests: previous.upstreamRequests + (isUpstream ? 1 : 0),
      upstreamPrompt: previous.upstreamPrompt + (isUpstream ? prompt : 0),
      upstreamCacheRead: previous.upstreamCacheRead + (isUpstream ? cacheRead : 0),
      cacheReportedRequests: previous.cacheReportedRequests + (cacheReported ? 1 : 0),
      upstreamPromptWithCache: previous.upstreamPromptWithCache + (cacheReported ? prompt : 0),
    },
  }
}

/**
 * Fold one request into this provider's compression arms.
 *
 * Estimates never enter: a `chars/4` prompt multiplied by a cache hit rate is a
 * claim nobody measured. `saved` is the estimator's figure, so the realized
 * saving ratio keeps an "estimate" label wherever it is rendered.
 */
function accumulateProviderCompression(
  base: CompressionArmPair | undefined,
  verdict: CompressionVerdict,
  isUpstream: boolean,
  prompt: number,
  cacheRead: number,
  cacheReported: boolean,
  saved: number
): CompressionArmPair | undefined {
  if (!isUpstream) return base
  const previous = base ?? { applied: emptyCacheArm(), refused: emptyCacheArm() }
  const arm = verdict.applied.length > 0 ? previous.applied : previous.refused
  const next: CompressionCacheArm = {
    requests: arm.requests + 1,
    promptTokens: arm.promptTokens + prompt,
    cacheReportedRequests: arm.cacheReportedRequests + (cacheReported ? 1 : 0),
    promptTokensWithCache: arm.promptTokensWithCache + (cacheReported ? prompt : 0),
    cacheReadTokens: arm.cacheReadTokens + (cacheReported ? cacheRead : 0),
    savedTokens: arm.savedTokens + (verdict.applied.length > 0 ? saved : 0),
  }
  return verdict.applied.length > 0
    ? { applied: next, refused: previous.refused }
    : { applied: previous.applied, refused: next }
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
    /** Whether the upstream supplied a cache figure at all (0 counts as supplied). */
    cacheReadReported?: boolean
    /**
     * The provider that served this request. Blank or absent means the per
     * provider split is not written — the global pools still accrue, because
     * "we did not record which endpoint" is not "no endpoint served it".
     */
    providerId?: string
    /**
     * Upstream model id that served this request. Both `providerId` and
     * `modelId` are required for the per-model split; a missing one only means
     * that split is not written, never that traffic did not happen.
     */
    modelId?: string
    /**
     * USD for this request, or `undefined` when there is no price evidence.
     * `0` is a claim ("this cost nothing"); absence is the fact ("unpriced"),
     * and only a defined value increments `costedRequests`.
     */
    costUsd?: number
    /**
     * This request's compression verdict. Absent means "not asked", which is
     * not "compression was off" — the day counters keep no row in that case.
     */
    compression?: CompressionVerdict
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
  const cacheRead = isUpstream ? nonNegative(input.cacheReadTokens) : 0
  const cacheReported = isUpstream && input.cacheReadReported === true

  const next: DayTokenBucket = {
    upstreamPrompt: base.upstreamPrompt + (isUpstream ? prompt : 0),
    upstreamCompletion: base.upstreamCompletion + (isUpstream ? completion : 0),
    estimatedPrompt: base.estimatedPrompt + (isUpstream ? 0 : prompt),
    estimatedCompletion: base.estimatedCompletion + (isUpstream ? 0 : completion),
    savedTokens: base.savedTokens + saved,
    // 估算请求**不可能**带来缓存命中：写了就是把"没测到"伪装成"测到了"。
    upstreamCacheRead: base.upstreamCacheRead + cacheRead,
    requests: base.requests + 1,
    upstreamRequests: base.upstreamRequests + (isUpstream ? 1 : 0),
    ...(base.compression === undefined ? {} : { compression: base.compression }),
  }

  if (input.compression !== undefined) {
    next.compression = accumulateCompressionCounters(base.compression, input.compression)
  }

  const providerId = (input.providerId ?? '').trim()
  if (providerId.length === 0) return next

  const previous = base.byProvider?.[providerId] ?? emptyProviderUsage()
  // 与 `upstreamCacheRead` 同一条理由：估算的 token 数乘上标价不是"估算的费用"，
  // 而是一张谁也核对不了的账单。估算请求只进 token 池，永远不进 `costUsd`。
  const cost = isUpstream && typeof input.costUsd === 'number' && Number.isFinite(input.costUsd) && input.costUsd >= 0
    ? input.costUsd
    : null

  const providerUsage: ProviderDayUsage = {
    upstreamPrompt: previous.upstreamPrompt + (isUpstream ? prompt : 0),
    upstreamCompletion: previous.upstreamCompletion + (isUpstream ? completion : 0),
    estimatedPrompt: previous.estimatedPrompt + (isUpstream ? 0 : prompt),
    estimatedCompletion: previous.estimatedCompletion + (isUpstream ? 0 : completion),
    requests: previous.requests + 1,
    upstreamRequests: previous.upstreamRequests + (isUpstream ? 1 : 0),
    costUsd: previous.costUsd + (cost ?? 0),
    costedRequests: previous.costedRequests + (cost === null ? 0 : 1),
  }
  if (input.compression !== undefined) {
    const arms = accumulateProviderCompression(
      previous.compression,
      input.compression,
      isUpstream,
      prompt,
      cacheRead,
      cacheReported,
      saved
    )
    if (arms !== undefined) providerUsage.compression = arms
  }

  next.byProvider = { ...base.byProvider, [providerId]: providerUsage }

  const modelId = (input.modelId ?? '').trim()
  if (modelId.length > 0) {
    next.byModel = accumulateModelUsage(base.byModel, providerId, modelId, isUpstream, prompt, cacheRead, cacheReported)
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

/** The provider's cache economics, as `promptCache.ts` resolves them. */
export interface CompressionCacheEconomics {
  /** Relative price of a cached input token (1 = fresh input). */
  readDiscount: number
  /** Extra multiplier charged when writing the cache. */
  writeMultiplier: number
}

/**
 * The two-round account, measured instead of assumed.
 *
 * `realizedSavingRatio` is the compression's own estimate; `breakEvenSavingRatio`
 * is `1 - c/(1+w)` — the saving compression must reach just to pay for the cache
 * bytes the client's next request re-sends. When the first is below the second,
 * that provider's applied arm was a net loss in tokens, whatever the header says.
 *
 * Every term is `null` when its input is absent, never 0 — "no cache figure"
 * must not render as "a 0% hit rate".
 */
export interface CompressionCacheSummary {
  applied: CompressionCacheArm
  refused: CompressionCacheArm
  /** `cacheReadTokens / promptTokensWithCache` on the compressed arm. */
  appliedCacheShare: number | null
  /** Same share on the refused arm — the counterfactual. */
  refusedCacheShare: number | null
  /** `saved / (promptTokens + saved)` on the applied arm (mixed estimate). */
  realizedSavingRatio: number | null
  /** `1 - c/(1+w)`; null when the cache is unknown or costs at least fresh input. */
  breakEvenSavingRatio: number | null
  /** Whether the realized saving clears the break-even; null when either is unknown. */
  clearsBreakEven: boolean | null
}

function cacheShareOf(arm: CompressionCacheArm): number | null {
  return arm.promptTokensWithCache > 0 ? arm.cacheReadTokens / arm.promptTokensWithCache : null
}

export function summarizeCompressionCache(
  pair: CompressionArmPair | undefined,
  economics?: CompressionCacheEconomics
): CompressionCacheSummary {
  const applied = pair?.applied ?? emptyCacheArm()
  const refused = pair?.refused ?? emptyCacheArm()
  // On the applied arm `promptTokens` is what the upstream saw (R'), so the
  // original is R' + saved. On the refused arm the two are the same.
  const realizedBase = applied.promptTokens + applied.savedTokens
  const realizedSavingRatio = applied.savedTokens > 0 && realizedBase > 0
    ? applied.savedTokens / realizedBase
    : null
  const breakEvenSavingRatio = economics !== undefined
    && Number.isFinite(economics.readDiscount)
    && economics.readDiscount < 1
    ? Math.max(0, 1 - economics.readDiscount / (1 + Math.max(0, economics.writeMultiplier)))
    : null

  return {
    applied,
    refused,
    appliedCacheShare: cacheShareOf(applied),
    refusedCacheShare: cacheShareOf(refused),
    realizedSavingRatio,
    breakEvenSavingRatio,
    clearsBreakEven: realizedSavingRatio === null || breakEvenSavingRatio === null
      ? null
      : realizedSavingRatio >= breakEvenSavingRatio,
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
  // `emptyBucket()` 因此只放**数字**计数器：`byProvider` / `byModel` 是这层清洗
  // 唯一的两个例外，它们按自己的形状逐个洗（下面），因为对 map 做一次
  // `Number()` 会把整张分表抹成 0 —— 而抹掉它同样是丢数据，
  // `accumulateDayBucket` 每一步都过这里。
  const next: DayTokenBucket = emptyBucket()
  // `Exclude<…, 'byProvider' | 'byModel' | 'compression'>` is not a convenience: it is what keeps
  // this loop assignable. Those fields are maps, so the `nonNegative()` write
  // below would type them as numbers.
  const numericKeys = Object.keys(next) as Exclude<keyof DayTokenBucket, 'byProvider' | 'byModel' | 'compression'>[]
  for (const key of numericKeys) {
    next[key] = nonNegative(raw[key] as number)
  }
  next.byProvider = normalizeProviderUsage(raw.byProvider)
  const byModel = normalizeModelUsage(raw.byModel)
  if (byModel !== undefined) next.byModel = byModel
  const compression = normalizeCompressionCounters(raw.compression)
  if (compression !== undefined) next.compression = compression
  return next
}

/** The local day key for a timestamp, re-exported so callers need one import. */
export function tokenDayKey(timestamp: number = Date.now()): string {
  return localDayKey(timestamp)
}
