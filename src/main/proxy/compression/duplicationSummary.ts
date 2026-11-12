/**
 * Aggregation for the cross-turn duplication measurements recorded on request
 * logs.
 *
 * Pure so it can be tested without a store or an HTTP context, and so the
 * endpoint stays a thin projection.
 *
 * The honest shape of this report matters more than the numbers in it: the
 * request log keeps only the newest `maxEntries` rows, so this is a WINDOW, not
 * a lifetime total. Every response therefore carries `sampled` and
 * `logRetention`, and ratios are computed over the sample only. Reporting a
 * window as a lifetime figure would make a five-request sample look like
 * evidence about the deployment.
 */

import type { RequestLogEntry } from '../../../shared/types.ts'

export interface DuplicationSummary {
  /** Requests in the window that carried a measurement. */
  sampled: number
  /** Requests in the window with no measurement (single-turn or too small). */
  unmeasured: number
  /** Sum of duplicated characters across the sample. */
  duplicatedChars: number
  /** Sum of examined characters across the sample. */
  scannedChars: number
  /**
   * `duplicatedChars / scannedChars` over the sample, or null when nothing was
   * scanned. Null is an answer ("no evidence"), not a zero.
   */
  ratio: number | null
  /** Requests where at least one qualifying run was found. */
  requestsWithDuplication: number
  /** Requests whose scan hit a cap, so their numbers are a lower bound. */
  truncatedRequests: number
  /** Largest single-request duplicated character count. */
  maxDuplicatedChars: number
  /** Largest contiguous run seen, in lines. */
  longestRunLines: number
  /** Requests in the window that were multi-block (the only measurable shape). */
  multiBlockRequests: number
}

/**
 * Summarize the window of request-log entries.
 *
 * Entries without a `duplication` field are counted as `unmeasured` rather than
 * as zeros: "we did not look" and "we looked and found nothing" are different
 * facts, and mixing them would understate the ratio.
 */
export function summarizeDuplication(entries: readonly RequestLogEntry[]): DuplicationSummary {
  let sampled = 0
  let unmeasured = 0
  let duplicatedChars = 0
  let scannedChars = 0
  let requestsWithDuplication = 0
  let truncatedRequests = 0
  let maxDuplicatedChars = 0
  let longestRunLines = 0
  let multiBlockRequests = 0

  for (const entry of entries) {
    const stats = entry.duplication
    if (!stats) {
      unmeasured += 1
      continue
    }

    sampled += 1
    duplicatedChars += stats.duplicatedChars
    scannedChars += stats.scannedChars
    if (stats.duplicatedChars > 0) requestsWithDuplication += 1
    if (stats.truncated) truncatedRequests += 1
    if (stats.duplicatedChars > maxDuplicatedChars) maxDuplicatedChars = stats.duplicatedChars
    if (stats.longestRunLines > longestRunLines) longestRunLines = stats.longestRunLines
    if (stats.blocks >= 2) multiBlockRequests += 1
  }

  return {
    sampled,
    unmeasured,
    duplicatedChars,
    scannedChars,
    ratio: scannedChars > 0 ? duplicatedChars / scannedChars : null,
    requestsWithDuplication,
    truncatedRequests,
    maxDuplicatedChars,
    longestRunLines,
    multiBlockRequests,
  }
}

/**
 * Share of duplicated characters at which folding repays its cost.
 *
 * From the plan's real-traffic verdict (§P4): under ~5% the rewrite cost
 * dominates; at 20% the repeated bytes are large enough that the prompt-cache
 * miss the first rewrite causes is paid back by the saves.
 */
export const FOLD_WORTH_BUILDING_RATIO = 0.2
/** Under this share the measurement is not even worth discussing. */
export const FOLD_NEGLIGIBLE_RATIO = 0.05

export interface DuplicationInterpretation {
  foldWorthBuilding: boolean
  negligible: boolean
  /** The window actually says something about multi-turn traffic. */
  conclusive: boolean
  /** `meanRemainingTurns` is usable as a budget input yet. */
  lifetimeKnown: boolean
}

/**
 * The judgement over a window, in one place.
 *
 * Both the management endpoint and the folding gate consume this, so "does the
 * window prove anything" cannot drift between the number a user reads and the
 * switch the forwarder obeys.
 */
export function interpretDuplication(
  summary: Pick<
    DuplicationSummary,
    'sampled' | 'multiBlockRequests' | 'truncatedRequests' | 'ratio'
  >,
  survivorship: { meanRemainingTurns: number | null }
): DuplicationInterpretation {
  return {
    foldWorthBuilding: summary.ratio !== null && summary.ratio >= FOLD_WORTH_BUILDING_RATIO,
    negligible: summary.ratio !== null && summary.ratio < FOLD_NEGLIGIBLE_RATIO,
    // A window where every request was single-turn proves nothing about
    // multi-turn traffic, so "no evidence" must not read as "no benefit".
    conclusive: summary.sampled > 0 && summary.multiBlockRequests > 0 && summary.truncatedRequests === 0,
    lifetimeKnown: survivorship.meanRemainingTurns !== null,
  }
}
