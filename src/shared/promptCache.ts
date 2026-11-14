/**
 * Prompt-cache capability and configuration.
 *
 * `mode` is the only field that decides behaviour:
 *
 * - `explicit-breakpoints` — the upstream only caches at `cache_control`
 *   markers (Anthropic Messages). The adapter must place them.
 * - `implicit-prefix` — the upstream caches the longest matching prefix by
 *   itself (DeepSeek, OpenAI-compatible endpoints). The gateway's only job is
 *   not to mutate the prefix.
 * - `unknown` — nothing was verified. Do nothing: no markers, no key, no
 *   policy change. A provider name is not evidence.
 *
 * Numeric fields are optional on purpose. Where the upstream documents a price
 * or a TTL, the value goes here; where it does not, the field stays absent and
 * the consumer keeps its conservative default instead of inventing a number.
 */

export type PromptCacheMode = 'explicit-breakpoints' | 'implicit-prefix' | 'unknown'

export interface PromptCacheCapability {
  mode: PromptCacheMode
  /** Maximum explicit breakpoints the upstream accepts (Anthropic: 4). */
  maxBreakpoints?: number
  /** Relative price of a cached input token (1 = an uncached input token). */
  readDiscount?: number
  /** Extra multiplier charged when writing the cache (Anthropic 5m: 0.25). */
  writeMultiplier?: number
  /** Below this estimated prompt length no breakpoint is worth placing. */
  minCacheableTokens?: number
  /** Whether the upstream accepts a top-level `prompt_cache_key`. */
  acceptsPromptCacheKey?: boolean
  /** How long a prefix stays cached. Absent when the provider does not say. */
  ttlMinutes?: number
  evidence?: { docUrl: string; asOf: string }
}

export const UNKNOWN_PROMPT_CACHE: PromptCacheCapability = { mode: 'unknown' }

export function promptCacheOf(
  entry: { promptCache?: PromptCacheCapability } | undefined
): PromptCacheCapability {
  return entry?.promptCache ?? UNKNOWN_PROMPT_CACHE
}

/**
 * Whether live-zone compression is likely to cost more cache than it saves.
 *
 * The two-round account in `docs/plan/PLAN-prompt-cache.md` (P3): a compressed
 * block is written this turn, but the client resends the original next turn, so
 * the old cached bytes are discarded. Compression only wins when
 * `R'(1+w) < cR`. A 0.2 discount already needs ~83% savings; below that the
 * default should be "do not compress unless the user asks".
 */
export function isCacheSensitive(capability: PromptCacheCapability | undefined): boolean {
  if (capability === undefined || capability.mode === 'unknown') return false
  return typeof capability.readDiscount === 'number' && capability.readDiscount <= 0.2
}

export interface CacheEconomics {
  /** Relative price of a cached input token (1 = fresh input). */
  readDiscount: number
  /** Extra multiplier charged when writing the cache. */
  writeMultiplier: number
}

/**
 * Turn a capability into the economics the compression gate needs.
 *
 * Anthropic's 1-hour tier doubles the write price (an extra 1.0 on top of the
 * normal input price); the 5-minute tier carries the documented 0.25. Every
 * other provider either charges no write premium or does not document one, so
 * the extra is 0 rather than a guess.
 */
export function cacheEconomicsOf(
  capability: PromptCacheCapability | undefined,
  anthropicTtl?: '5m' | '1h'
): CacheEconomics | undefined {
  if (!capability || capability.mode === 'unknown') return undefined
  if (typeof capability.readDiscount !== 'number') return undefined

  const writeMultiplier = capability.mode === 'explicit-breakpoints' && anthropicTtl === '1h'
    ? 1
    : (capability.writeMultiplier ?? 0)

  return { readDiscount: capability.readDiscount, writeMultiplier }
}

/**
 * How long a conversation may stay pinned for cache reasons, in minutes.
 *
 * The configured window is an upper bound, never a promise: pinning for an hour
 * to a provider whose documented prefix cache lives five minutes keeps a switch
 * that no longer pays. `anthropicTtl: '1h'` raises the documented floor to the
 * tier the adapter actually writes; an unknown TTL leaves the configured value
 * alone rather than inventing one.
 */
export function effectiveAffinityMinutes(
  configuredMinutes: number,
  capability: PromptCacheCapability | undefined,
  anthropicTtl?: '5m' | '1h'
): number {
  if (!Number.isFinite(configuredMinutes) || configuredMinutes <= 0) return 0
  const documented = capability?.mode === 'explicit-breakpoints' && anthropicTtl === '1h'
    ? 60
    : capability?.ttlMinutes
  if (documented === undefined || !Number.isFinite(documented) || documented <= 0) return configuredMinutes
  return Math.min(configuredMinutes, documented)
}

/** Stored switch; the adapter reads it on every request. */
export interface PromptCachingConfig {
  enabled: boolean
  anthropicTtl: '5m' | '1h'
}

export const DEFAULT_PROMPT_CACHING_CONFIG: PromptCachingConfig = {
  enabled: true,
  anthropicTtl: '5m',
}

/**
 * Fold a stored (possibly older or hand-edited) value onto the shipped default.
 *
 * Only an explicit `false` turns it off; a missing or malformed value inherits
 * the default. An unknown TTL falls back to 5m rather than being sent upstream.
 */
export function normalizePromptCachingConfig(
  input?: Partial<PromptCachingConfig> | null
): PromptCachingConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_PROMPT_CACHING_CONFIG }
  return {
    enabled: input.enabled === undefined
      ? DEFAULT_PROMPT_CACHING_CONFIG.enabled
      : input.enabled === true,
    anthropicTtl: input.anthropicTtl === '1h' ? '1h' : '5m',
  }
}
