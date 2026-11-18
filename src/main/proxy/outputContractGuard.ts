/**
 * Circuit breaker for the output contract.
 *
 * The contract asks the model to say less. That is a token argument, not a
 * quality argument, and the gateway cannot run a counterfactual: there is no
 * "same turn without the block" to compare against. So the only honest gate is
 * a local one - if the target is *already* producing degraded turns, withdraw
 * the contract instead of piling a style instruction on top of a model that is
 * looping, going silent, or announcing work it never does.
 *
 * The window is read from the request log, which is the only place those three
 * readings are written (`streamTrace.repetition`, `.emptyTurn.empty`,
 * `.announcedStop`). Consequence worth stating: the breaker reacts only to
 * streamed turns, because non-streaming responses are deliberately not judged
 * (`shared/streamRepetition.ts`).
 *
 * Two properties keep it from flapping:
 * - it needs two degraded rows inside the newest eight for that
 *   `(provider, model)`, so a single bad turn does not withdraw the block;
 * - it clears by ageing out, not by a timer, so the block comes back only after
 *   the degraded rows left the window.
 */

import type {
  RequestLogEntry,
  StreamEmptyTurnReading,
  StreamRepetitionReading,
} from '../../shared/types'

export const DEGRADATION_WINDOW = 8
export const DEGRADATION_LIMIT = 2

export interface DegradationWindow {
  /** Rows considered for this target inside the window. */
  sample: number
  /** Rows among them that were degraded. */
  degraded: number
  /** True when the contract must not be injected for this target. */
  suspended: boolean
}

/**
 * Degraded = the three "200 but did not deliver" classes from
 * `shared/streamRepetition.ts`. Mirrors `autoBandit.isDegradedSuccess` including
 * its two-shape read: production rows nest the readings under `streamTrace`,
 * hand-made samples have historically written them at the top level.
 */
function isDegradedSuccess(entry: RequestLogEntry): boolean {
  if (entry.status !== 'success') return false
  const loose = entry as RequestLogEntry & {
    repetition?: StreamRepetitionReading
    emptyTurn?: StreamEmptyTurnReading
  }
  const repetition = loose.repetition ?? entry.streamTrace?.repetition
  if (repetition?.degraded === true) return true
  const emptyTurn = loose.emptyTurn ?? entry.streamTrace?.emptyTurn
  return emptyTurn?.empty === true || emptyTurn?.announcedStop === true
}

/**
 * Read the degradation window for one target from a newest-first log list.
 *
 * `model` matches `actualModel` when present, because that is what the serving
 * candidate was; the requested name may be a route alias shared by several
 * models.
 */
export function readDegradationWindow(input: {
  entries: readonly RequestLogEntry[]
  providerId: string
  model: string
  windowSize?: number
  limit?: number
}): DegradationWindow {
  const windowSize = input.windowSize ?? DEGRADATION_WINDOW
  const limit = input.limit ?? DEGRADATION_LIMIT
  let sample = 0
  let degraded = 0

  for (const entry of input.entries) {
    if (entry.providerId !== input.providerId) continue
    const servedModel = entry.actualModel ?? entry.model
    if (servedModel !== input.model) continue
    if (!entry.streamTrace) continue

    sample += 1
    if (isDegradedSuccess(entry)) degraded += 1
    if (sample >= windowSize) break
  }

  return { sample, degraded, suspended: degraded >= limit }
}