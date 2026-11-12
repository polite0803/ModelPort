/**
 * Compression facade.
 *
 * One entry point, called once per request from `forwardChatCompletion`, before
 * the managed tool-call layer injects its markup. Ordering is load-bearing:
 *
 *   route decision -> compress -> context management -> tool prompt injection
 *
 * - after routing, because `conversationKey` is derived from message content and
 *   compressing first would make the sticky key drift between turns;
 * - before tool prompt injection, because the injected tool instructions are
 *   managed markup that must never be run through a content compressor;
 * - before history trimming (review decision 5), because shrinking content can
 *   make trimming unnecessary.
 *
 * The function is fail-open in every direction: no config, no live zone, an
 * unsupported content type, a thrown compressor or an unreachable CCR store all
 * resolve to "forward the original messages unchanged".
 *
 * Re-running it on already-compressed messages is harmless: every marker we emit
 * is recognised by `isAlreadyCompressed`, so a retried or chained attempt sees a
 * no-op instead of re-compressing compressed output.
 */

import type { ChatMessage } from '../types.ts'
import { acceptCompression } from './policy.ts'
import { detectContentType } from './detector.ts'
import { estimateTokens } from './estimator.ts'
import { getCcrStore } from './ccr/store.ts'
import { isAlreadyCompressed } from './ccr/markers.ts'
import { crushJsonArray, crushJsonDocument } from './compressors/smartCrusher.ts'
import { compressLog } from './compressors/logCompressor.ts'
import { compressSearch } from './compressors/searchCompressor.ts'
import { foldCrossTurnDuplicates } from './fold.ts'
import {
  pickLiveZone,
  readLiveZoneText,
  replaceLiveZoneText,
  type LiveZoneTarget,
} from './liveZone.ts'
import {
  AGGRESSIVENESS_BIAS,
  CONTENT_TYPE_MIN_BYTES,
  COMPRESSION_TIMEOUT_MS,
  DEFAULT_COMPRESSION_CONFIG,
  MAX_KEPT_ITEMS,
  MIN_MESSAGE_TOKENS,
  type CompressionCandidate,
  type CompressionConfig,
  type CompressionReport,
  type CompressionSkipReason,
  type ContentType,
} from './types.ts'

/** Persist an original and return the id to embed in a marker, or null. */
export type StashFunction = (original: string, idLength: number) => string | null

export interface ApplyCompressionInput {
  messages: ChatMessage[] | undefined
  /** Requested completion count; > 1 is never compressed. */
  n?: number
  config?: CompressionConfig
  /**
   * Cache economics of the serving provider. Present only when the provider
   * documents a prefix cache; the gate then requires the saving to beat the
   * cache discount the next turn would otherwise keep.
   */
  cachePolicy?: { readDiscount: number; writeMultiplier: number }
  /**
   * CCR sink override. Production omits it and the on-disk store is used; tests
   * inject an in-memory one so a locked-down home directory cannot turn every
   * assertion into "compression refused".
   */
  stash?: StashFunction
  /**
   * Fold history messages that repeat an earlier one (`fold.ts`). Callers pass
   * the gate's verdict, never the raw switch: enabling this rewrites bytes the
   * prompt cache already holds, so it is only worth it on multi-turn traffic
   * whose duplication was actually measured.
   */
  fold?: boolean
}

export interface ApplyCompressionOutcome {
  messages: ChatMessage[] | undefined
  /** Absent when compression is disabled, so the log row stays clean. */
  report?: CompressionReport
}

interface CompressedBlock {
  text: string
  ccrHash?: string
  strategy: string
  contentType: ContentType
}

type TargetOutcome =
  | { ok: true; block: CompressedBlock; before: string }
  | { ok: false; reason: CompressionSkipReason }

function skipReport(
  reason: CompressionSkipReason,
  messages: ChatMessage[] | undefined,
  candidates?: CompressionCandidate[]
): ApplyCompressionOutcome {
  return {
    messages,
    report: {
      applied: [],
      tokensBefore: 0,
      tokensAfter: 0,
      saved: 0,
      ratio: 0,
      skipped: reason,
      ...(candidates === undefined || candidates.length === 0 ? {} : { candidates }),
    },
  }
}

/**
 * Run the compressor appropriate for `contentType`, or `null` when this content
 * class has no compressor.
 *
 * JSON handles structured tool output; the log and search paths handle the two
 * large plain-text families most coding clients put behind tool calls.
 */
function compressForType(
  text: string,
  contentType: ContentType,
  config: CompressionConfig,
  stash: StashFunction
): CompressedBlock | null {
  const options = {
    maxKeptItems: MAX_KEPT_ITEMS,
    bias: AGGRESSIVENESS_BIAS[config.aggressiveness] ?? 1,
    stash,
  }

  if (contentType === 'json_array') {
    const result = crushJsonArray(text, options)
    if (!result.changed) return null
    return { text: result.text, ccrHash: result.ccrHash, strategy: 'json', contentType }
  }

  // A wrapped document (`{"results":[...]}`) is the shape most tool results
  // actually take, so it is compressed by rewriting its nested arrays.
  if (contentType === 'json_document') {
    const result = crushJsonDocument(text, options)
    if (!result.changed) return null
    return { text: result.text, ccrHash: result.ccrHash, strategy: 'json', contentType }
  }

  if (contentType === 'build_output') {
    const result = compressLog(text, options)
    if (!result.changed) return null
    return { text: result.text, ccrHash: result.ccrHash, strategy: 'log', contentType }
  }

  if (contentType === 'search_results') {
    const result = compressSearch(text, options)
    if (!result.changed) return null
    return { text: result.text, ccrHash: result.ccrHash, strategy: 'search', contentType }
  }

  return null
}

/** Read, classify and compress one live-zone slot. Never throws. */
function compressTarget(
  messages: ChatMessage[],
  target: LiveZoneTarget,
  config: CompressionConfig,
  stash: StashFunction
): TargetOutcome {
  try {
    const text = readLiveZoneText(messages, target)
    if (!text) return { ok: false, reason: 'no_live_zone' }

    if (isAlreadyCompressed(text)) return { ok: false, reason: 'already_compressed' }

    if (estimateTokens(text) < MIN_MESSAGE_TOKENS) return { ok: false, reason: 'below_min_tokens' }

    const detection = detectContentType(text)
    if (text.length < CONTENT_TYPE_MIN_BYTES[detection.type]) {
      return { ok: false, reason: 'below_threshold' }
    }

    const block = compressForType(text, detection.type, config, stash)
    if (!block) return { ok: false, reason: 'unsupported_type' }

    return { ok: true, block, before: text }
  } catch (error) {
    // A compressor bug must never fail a user's request.
    console.error('[Compression] compressor failed, forwarding verbatim:', error)
    return { ok: false, reason: 'error' }
  }
}

/** Index of the newest assistant turn, or -1. Messages before it are history. */
function lastAssistantIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') return index
  }
  return -1
}

/**
 * Compress the live zone of one request.
 *
 * Returns the original `messages` reference (not a copy) whenever nothing was
 * rewritten, so callers can rely on reference equality to detect a no-op.
 */
export function applyCompression(input: ApplyCompressionInput): ApplyCompressionOutcome {
  const config = input.config ?? DEFAULT_COMPRESSION_CONFIG
  const { messages } = input

  if (!config.enabled) return { messages }
  if (!Array.isArray(messages) || messages.length === 0) return skipReport('no_messages', messages)

  // Multiple completions share one prompt; compressing it would change what the
  // caller asked for on paths that assume a deterministic single answer.
  if (typeof input.n === 'number' && input.n > 1) {
    return skipReport('multiple_choices', messages)
  }

  // Production stashes into the on-disk CCR store; tests inject a fake so a
  // locked-down home directory cannot turn every case into "compression refused".
  const stash: StashFunction =
    input.stash ?? ((original, idLength) => getCcrStore().put(original, idLength))

  // History folding runs first and only before the newest assistant turn: the
  // messages after it are this turn's input, which live-zone compression owns.
  let nextMessages = messages
  let foldedMessages = 0
  let foldedChars = 0
  let foldedHashes: string[] = []

  if (input.fold) {
    const horizon = lastAssistantIndex(messages)
    if (horizon > 0) {
      const folded = foldCrossTurnDuplicates(messages, { stash, liveZoneFrom: horizon })
      nextMessages = folded.messages
      foldedMessages = folded.foldedMessages
      foldedChars = folded.foldedChars
      foldedHashes = folded.hashes
    }
  }

  const targets = pickLiveZone(nextMessages)
  if (targets.length === 0 && foldedMessages === 0) return skipReport('no_live_zone', messages)

  const deadline = Date.now() + COMPRESSION_TIMEOUT_MS
  const applied: string[] = []
  const hashes: string[] = []
  const candidates: CompressionCandidate[] = []
  let tokensBefore = 0
  let tokensAfter = 0
  let lastSkip: CompressionSkipReason | undefined

  for (const target of targets) {
    if (Date.now() > deadline) {
      lastSkip = 'timeout'
      break
    }

    const outcome = compressTarget(nextMessages, target, config, stash)
    if (!outcome.ok) {
      lastSkip = outcome.reason
      continue
    }

    const gate = acceptCompression({
      before: outcome.before,
      after: outcome.block.text,
      contentType: outcome.block.contentType,
      changed: true,
      ...(input.cachePolicy === undefined ? {} : { cachePolicy: input.cachePolicy }),
    })
    if (!gate.accept) {
      lastSkip = gate.reason ?? 'not_smaller'
      candidates.push({
        contentType: outcome.block.contentType,
        tokensBefore: gate.tokensBefore,
        tokensAfter: gate.tokensAfter,
        accepted: false,
        reason: lastSkip,
      })
      continue
    }

    candidates.push({
      contentType: outcome.block.contentType,
      tokensBefore: gate.tokensBefore,
      tokensAfter: gate.tokensAfter,
      accepted: true,
    })

    nextMessages = replaceLiveZoneText(nextMessages, target, outcome.block.text)
    applied.push(outcome.block.strategy)
    if (outcome.block.ccrHash) hashes.push(outcome.block.ccrHash)
    tokensBefore += gate.tokensBefore
    tokensAfter += gate.tokensAfter
  }

  if (applied.length === 0 && foldedMessages === 0) {
    return skipReport(lastSkip ?? 'no_live_zone', messages, candidates)
  }

  // Folding is a rewrite too, and its markers need the same explanation the
  // compressed ones get: a fold-only turn reports `applied: ['fold']` so the
  // forwarder injects the protocol block (the pointer would otherwise arrive
  // unannounced) and the response header names the change. Its size is in
  // `folded.chars`, not in the token ledger below.
  if (foldedMessages > 0) applied.unshift('fold')

  const saved = tokensBefore - tokensAfter
  return {
    messages: nextMessages,
    report: {
      applied,
      tokensBefore,
      tokensAfter,
      saved,
      ratio: tokensBefore > 0 ? saved / tokensBefore : 0,
      ...(hashes.length > 0 ? { ccrHashes: hashes } : {}),
      ...(candidates.length > 0 ? { candidates } : {}),
      ...(foldedMessages > 0
        ? { folded: { messages: foldedMessages, chars: foldedChars, hashes: foldedHashes } }
        : {}),
    },
  }
}

export { getCcrStore } from './ccr/store.ts'
export type { CompressionConfig, CompressionReport } from './types.ts'
export { DEFAULT_COMPRESSION_CONFIG } from './types.ts'

/**
 * Per-request report handoff.
 *
 * The forwarder runs the compression but the route owns the response headers and
 * the request-log row, and `ForwardResult` is shared by every forwarder — adding
 * a field there would ripple through all of them for one optional record. A
 * small keyed registry keeps the change local: the forwarder records, the route
 * takes once.
 *
 * Bounded so a request that never reaches the route (client disconnect) cannot
 * leak an entry forever; the oldest entry is evicted first.
 */
const reports = new Map<string, CompressionReport>()
const MAX_PENDING_REPORTS = 256

export function recordCompressionReport(requestId: string, report: CompressionReport): void {
  if (!requestId) return
  if (reports.size >= MAX_PENDING_REPORTS) {
    const oldest = reports.keys().next()
    if (!oldest.done) reports.delete(oldest.value)
  }
  reports.set(requestId, report)
}

/** Read and clear the report for `requestId`. */
export function takeCompressionReport(requestId: string): CompressionReport | undefined {
  const report = reports.get(requestId)
  if (report) reports.delete(requestId)
  return report
}
