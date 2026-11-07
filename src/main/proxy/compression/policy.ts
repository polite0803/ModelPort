/**
 * Acceptance gates.
 *
 * Every rewrite must clear all of these before it is allowed into the request.
 * The ordering matters: cheap structural checks run before token accounting, and
 * a rewrite that shrinks the byte count but not the estimated token count is
 * rejected — the two can disagree on JSON because structure characters price
 * differently from payload characters.
 */

import { estimateTokens } from './estimator.ts'
import { MIN_SAVINGS_RATIO, type CompressionSkipReason, type ContentType } from './types.ts'

export interface GateInput {
  before: string
  after: string
  contentType: ContentType
  /** Whether the compressor claims it changed anything. */
  changed: boolean
  /**
   * Cache economics of the serving provider. When present, the saving must also
   * beat the cache discount lost on the next turn:
   *
   *   compressed wins over two turns iff  R'(1+w) < cR
   *
   * so the required saving ratio is `1 - c/(1+w)`. A 0.02 read discount needs
   * ~98%; a 0.1 discount with a 0.25 write premium needs ~92%. This is applied
   * only when the caller passes the policy — unknown providers keep the
   * original 10% floor.
   */
  cachePolicy?: { readDiscount: number; writeMultiplier: number }
}

export interface GateOutcome {
  accept: boolean
  reason?: CompressionSkipReason
  tokensBefore: number
  tokensAfter: number
  ratio: number
}

/**
 * Decide whether `after` may replace `before`.
 *
 * `ratio` is the fraction of tokens saved (0..1) and is only meaningful when
 * `accept` is true; callers report it as an estimate, never as a real usage
 * figure.
 */
export function acceptCompression(input: GateInput): GateOutcome {
  const tokensBefore = estimateTokens(input.before, input.contentType)
  const tokensAfter = estimateTokens(input.after, input.contentType)

  if (!input.changed) {
    return { accept: false, reason: 'not_smaller', tokensBefore, tokensAfter, ratio: 0 }
  }

  // Byte count first: a rewrite that is not literally shorter cannot help.
  if (input.after.length >= input.before.length) {
    return { accept: false, reason: 'not_smaller', tokensBefore, tokensAfter, ratio: 0 }
  }

  if (tokensAfter >= tokensBefore) {
    return { accept: false, reason: 'not_smaller', tokensBefore, tokensAfter, ratio: 0 }
  }

  const ratio = (tokensBefore - tokensAfter) / tokensBefore
  const threshold = input.cachePolicy === undefined || input.cachePolicy.readDiscount >= 1
    ? MIN_SAVINGS_RATIO
    : Math.max(
        MIN_SAVINGS_RATIO,
        1 - input.cachePolicy.readDiscount / (1 + Math.max(0, input.cachePolicy.writeMultiplier))
      )
  if (ratio < threshold) {
    return { accept: false, reason: 'insufficient_savings', tokensBefore, tokensAfter, ratio }
  }

  return { accept: true, tokensBefore, tokensAfter, ratio }
}
