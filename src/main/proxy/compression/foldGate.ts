/**
 * Gate for cross-turn duplicate folding.
 *
 * Config alone must not switch this on. Folding rewrites history, so the first
 * turn it happens costs one prompt-cache miss - the bytes that were cached are
 * no longer the bytes we send. It only pays when the folded region is re-read
 * enough times to amortise that miss, and both numbers exist in the app already:
 *
 * - `duplication.ratio` is how much of a request repeats itself;
 * - `survivorship.meanRemainingTurns` is how many more turns a conversation
 *   actually sees (`expected_reads` in the gain budget).
 *
 * The gain formula from the plan is
 *
 *     gain = expected_reads × foldable_chars × read_price
 *          − cached_suffix_chars × write_price_delta
 *
 * Prices are not available here (they are per provider and often unpublished),
 * so this gate does not pretend to compute money. It uses the two
 * price-independent terms as a *direction* test: enough duplication, and enough
 * remaining turns for the one miss to be paid back.
 *
 * Three refusals, each reported with its own reason:
 * - `inconclusive` - the log window proves nothing (all single-turn traffic, or
 *   a scan that hit a cap);
 * - `low_ratio` - repetition exists but is not worth a rewrite;
 * - `unknown_lifetime` - not enough finished conversations to know
 *   `expected_reads`. Null is "not yet known", never a zero.
 */

import {
  FOLD_WORTH_BUILDING_RATIO,
  interpretDuplication,
  type DuplicationSummary,
} from './duplicationSummary.ts'
import type { SurvivorshipStats } from './survivorship.ts'

/** Same threshold the management endpoint calls `foldWorthBuilding`. */
export const FOLD_MIN_RATIO = FOLD_WORTH_BUILDING_RATIO
/** Each folded byte must be sent at least this many more times to pay back. */
export const FOLD_MIN_EXPECTED_READS = 2
/** The decision is a property of the log window, not of one request. */
export const FOLD_DECISION_TTL_MS = 5 * 60 * 1000

export type FoldGateReason = 'off' | 'inconclusive' | 'low_ratio' | 'unknown_lifetime' | 'ok'

export interface FoldGateDecision {
  fold: boolean
  reason: FoldGateReason
  /** Measured duplication ratio of the window, or null when nothing was scanned. */
  ratio: number | null
  /** Learned `expected_reads`, or null when not enough conversations finished. */
  expectedReads: number | null
  /**
   * `expectedReads × ratio`: dimensionless "how many times each folded character
   * is avoided". Evidence for a later cost model, not a currency figure.
   */
  savingsHint: number | null
}

export interface FoldGateInput {
  /** The user switched it on for this install. */
  optIn: boolean
  summary: Pick<
    DuplicationSummary,
    'sampled' | 'multiBlockRequests' | 'truncatedRequests' | 'ratio'
  >
  survivorship: Pick<SurvivorshipStats, 'meanRemainingTurns' | 'finishedConversations'>
  minRatio?: number
  minExpectedReads?: number
}

export function decideDuplicateFold(input: FoldGateInput): FoldGateDecision {
  const ratio = input.summary.ratio
  const expectedReads = input.survivorship.meanRemainingTurns

  if (!input.optIn) {
    return { fold: false, reason: 'off', ratio, expectedReads, savingsHint: null }
  }

  // Same `conclusive` test the management endpoint publishes: a window where
  // every request was single-turn, or a scan that stopped early, proves nothing.
  const conclusive = interpretDuplication(input.summary, input.survivorship).conclusive
  if (!conclusive) {
    return { fold: false, reason: 'inconclusive', ratio, expectedReads, savingsHint: null }
  }

  const minRatio = input.minRatio ?? FOLD_MIN_RATIO
  if (ratio === null || ratio < minRatio) {
    return { fold: false, reason: 'low_ratio', ratio, expectedReads, savingsHint: null }
  }

  const minReads = input.minExpectedReads ?? FOLD_MIN_EXPECTED_READS
  if (expectedReads === null || expectedReads < minReads) {
    return { fold: false, reason: 'unknown_lifetime', ratio, expectedReads, savingsHint: null }
  }

  return {
    fold: true,
    reason: 'ok',
    ratio,
    expectedReads,
    savingsHint: expectedReads * ratio,
  }
}

let cached: { at: number; decision: FoldGateDecision } | undefined

/**
 * Same decision, computed at most once per TTL.
 *
 * Reading it per request would re-summarise the whole request-log window on the
 * hot path, and the inputs only change when a request is logged anyway.
 */
export function readFoldDecision(
  load: () => FoldGateInput,
  nowMs: number = Date.now(),
  ttlMs: number = FOLD_DECISION_TTL_MS
): FoldGateDecision {
  if (cached && nowMs - cached.at < ttlMs) return cached.decision
  const decision = decideDuplicateFold(load())
  cached = { at: nowMs, decision }
  return decision
}

/** Test seam: forget the memoised decision. */
export function resetFoldDecisionCache(): void {
  cached = undefined
}