/**
 * Corpus capture and fidelity readout for compression changes — the measurement
 * half of the D prerequisite.
 *
 * D means changes that rewrite **meaning** (a second model writing summaries,
 * tool schemas reshaped before they reach the upstream). Those cannot be judged
 * by a unit test on a fixture: "still correct" is a property of a real
 * conversation. What they can be judged by, without spending a token, is this
 * module's three numbers:
 *
 * 1. **markers resolvable** — every pointer the pipeline emits must be found by
 *    the same lookup `/v1/ccr/:hash` performs.
 * 2. **unrecoverable bytes** — bytes in minus bytes still in the prompt minus
 *    bytes stored behind markers. Zero means the rewrite is lossless in
 *    principle: everything is either visible or one HTTP call away.
 * 3. **tool pairing** — every `tool_calls[].id` still has its `tool` result and
 *    vice versa. A reshape that breaks this yields a request the upstream
 *    rejects, which is how the freeform-tool regression reached production.
 *
 * The CLI (`scripts/compression-eval.mjs`) owns the file I/O; everything that
 * is a judgement lives here so the gate can type-check it and the tests can
 * feed it a wrong sample.
 */

import type { ChatMessage } from '../types'
import type { CompressionConfig, ContentType } from './types.ts'
import { detectContentType } from './detector.ts'
import { applyCompression } from './index.ts'

/** One captured request, with the client's pre-compression messages. */
export interface CorpusRow {
  id: string | null
  model: string | null
  capturedAt: number | null
  messages: ChatMessage[]
  tools?: unknown[]
}

export interface CaptureStats {
  /** Rows handed in. */
  scanned: number
  /** Rows carrying a non-empty `requestBody`. */
  withBody: number
  /** Bodies that were not JSON. */
  unparsable: number
  /** Bodies with fewer than two messages — nothing to fold, nothing to protect. */
  tooShort: number
}

export interface CaptureResult {
  rows: CorpusRow[]
  stats: CaptureStats
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Pull reusable conversations out of request-log rows.
 *
 * Every rejection is counted, never silently dropped: a corpus that quietly
 * lost 80% of its rows would make the replay numbers look like deployment
 * facts when they are facts about the filter.
 */
export function captureFromLogRows(rawRows: readonly unknown[]): CaptureResult {
  const rows: CorpusRow[] = []
  const stats: CaptureStats = { scanned: rawRows.length, withBody: 0, unparsable: 0, tooShort: 0 }

  for (const raw of rawRows) {
    if (!isRecord(raw) || typeof raw.requestBody !== 'string' || raw.requestBody.length === 0) continue
    stats.withBody += 1

    let body: unknown
    try {
      body = JSON.parse(raw.requestBody)
    } catch {
      stats.unparsable += 1
      continue
    }

    const messages = isRecord(body) ? body.messages : undefined
    if (!Array.isArray(messages) || messages.length < 2) {
      stats.tooShort += 1
      continue
    }

    rows.push({
      id: typeof raw.id === 'string' ? raw.id : null,
      model: typeof raw.model === 'string' ? raw.model : null,
      capturedAt: typeof raw.timestamp === 'number' ? raw.timestamp : null,
      messages: messages as ChatMessage[],
      ...(isRecord(body) && Array.isArray(body.tools) ? { tools: body.tools } : {}),
    })
  }

  return { rows, stats }
}

/** Message text, whichever shape the content takes. */
export function messageText(message: ChatMessage): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part?.text === 'string' ? part.text : JSON.stringify(part)))
      .join('\n')
  }
  return ''
}

/** Sum of UTF-8 bytes of every message's text. */
export function contentBytes(messages: readonly ChatMessage[]): number {
  let total = 0
  for (const message of messages) total += Buffer.byteLength(messageText(message), 'utf8')
  return total
}

export interface CorpusDescription {
  /** Content class of each row's largest message — what the corpus can judge. */
  mix: Array<{ type: ContentType | 'empty'; rows: number }>
  withTools: number
  /** Text bytes per row, ascending. */
  sizes: number[]
}

export function describeCorpus(rows: readonly CorpusRow[]): CorpusDescription {
  const counts = new Map<ContentType | 'empty', number>()
  let withTools = 0
  const sizes: number[] = []

  for (const row of rows) {
    let largest = ''
    for (const message of row.messages) {
      const text = messageText(message)
      if (text.length > largest.length) largest = text
    }
    const type = largest.length === 0 ? 'empty' : detectContentType(largest).type
    counts.set(type, (counts.get(type) ?? 0) + 1)
    if (row.tools !== undefined) withTools += 1
    sizes.push(contentBytes(row.messages))
  }

  return {
    mix: [...counts.entries()]
      .map(([type, count]) => ({ type, rows: count }))
      .sort((a, b) => b.rows - a.rows),
    withTools,
    sizes: sizes.sort((a, b) => a - b),
  }
}

/** Ids declared by an assistant turn but never answered, and the reverse. */
export function pairingBreaks(messages: readonly ChatMessage[]): number {
  const declared = new Set<string>()
  const answered = new Set<string>()
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      if (call?.id) declared.add(call.id)
    }
    if (message.role === 'tool' && message.tool_call_id) answered.add(message.tool_call_id)
  }
  let broken = 0
  for (const id of declared) if (!answered.has(id)) broken += 1
  for (const id of answered) if (!declared.has(id)) broken += 1
  return broken
}

/** Markers visible in the text, of either syntax. */
export function countMarkers(messages: readonly ChatMessage[]): number {
  let count = 0
  for (const message of messages) {
    const text = messageText(message)
    count += text.split('<<ccr:').length - 1
    count += text.split('Retrieve original: hash=').length - 1
  }
  return count
}

export interface EvaluateOptions {
  config: CompressionConfig
  /** Run history folding (`fold.ts`) in the same pass. */
  fold?: boolean
  /** Persist an original and return its id, or `null` to refuse. */
  stash: (original: string, idLength: number) => string | null
  /** Same lookup `/v1/ccr/:hash` performs. */
  resolve: (hash: string) => string | undefined
}

export interface EvaluationRowResult {
  id: string | null
  applied: string[]
  /** Message text bytes before and after (not the JSON envelope). */
  bytesIn: number
  bytesOut: number
  tokensBefore: number
  tokensAfter: number
  markers: number
  resolvable: number
  /** Bytes that are neither in the prompt nor behind a resolvable marker. */
  unrecoverable: number
  /** Tool-pairing breaks this rewrite introduced (0 = pairing preserved). */
  pairingBreaks: number
  foldedMessages: number
  foldedChars: number
}

export interface EvaluationTotals extends Omit<EvaluationRowResult, 'id' | 'applied'> {
  rows: number
  rewritten: number
}

export interface EvaluationReport {
  rows: EvaluationRowResult[]
  totals: EvaluationTotals
  byType: Array<{ type: ContentType; rows: number; tokensBefore: number; tokensAfter: number }>
}

/**
 * Replay a corpus through the shipped pipeline and read the three fidelity
 * numbers.
 *
 * The store is injected (`stash` / `resolve`) so the caller owns the lifetime
 * of whatever holds the originals — a temp directory in the CLI, an in-memory
 * map in tests.
 */
export function evaluateCorpus(
  rows: readonly CorpusRow[],
  options: EvaluateOptions
): EvaluationReport {
  const results: EvaluationRowResult[] = []
  const typeTotals = new Map<ContentType, { rows: number; tokensBefore: number; tokensAfter: number }>()
  const totals: EvaluationTotals = {
    rows: 0,
    rewritten: 0,
    bytesIn: 0,
    bytesOut: 0,
    tokensBefore: 0,
    tokensAfter: 0,
    markers: 0,
    resolvable: 0,
    unrecoverable: 0,
    pairingBreaks: 0,
    foldedMessages: 0,
    foldedChars: 0,
  }

  for (const row of rows) {
    const outcome = applyCompression({
      messages: row.messages,
      config: options.config,
      stash: options.stash,
      ...(options.fold === true ? { fold: true } : {}),
    })

    const after = outcome.messages ?? row.messages
    const report = outcome.report
    const hashes = [...(report?.ccrHashes ?? []), ...(report?.folded?.hashes ?? [])]

    let resolvable = 0
    let storedBytes = 0
    for (const hash of hashes) {
      const content = options.resolve(hash)
      if (content === undefined) continue
      resolvable += 1
      storedBytes += Buffer.byteLength(content, 'utf8')
    }

    // Text bytes, not whole-message JSON: the envelope (role, tool_call_id,
    // escaping) is present before and after, so counting it would make every
    // rewrite look like it lost the difference in quoting.
    const bytesIn = contentBytes(row.messages)
    const bytesOut = contentBytes(after)
    const breaks = Math.max(0, pairingBreaks(after) - pairingBreaks(row.messages))

    const result: EvaluationRowResult = {
      id: row.id,
      applied: report?.applied ?? [],
      bytesIn,
      bytesOut,
      tokensBefore: report?.tokensBefore ?? 0,
      tokensAfter: report?.tokensAfter ?? 0,
      markers: countMarkers(after),
      resolvable,
      // A marker whose original is missing makes its removed bytes unrecoverable;
      // the `max(0, …)` keeps a compressor that stores *more* than it removed
      // from reporting a negative loss.
      unrecoverable: Math.max(0, bytesIn - bytesOut - storedBytes),
      pairingBreaks: breaks,
      foldedMessages: report?.folded?.messages ?? 0,
      foldedChars: report?.folded?.chars ?? 0,
    }
    results.push(result)

    totals.rows += 1
    if (result.applied.length > 0) totals.rewritten += 1
    totals.bytesIn += result.bytesIn
    totals.bytesOut += result.bytesOut
    totals.tokensBefore += result.tokensBefore
    totals.tokensAfter += result.tokensAfter
    totals.markers += result.markers
    totals.resolvable += result.resolvable
    totals.unrecoverable += result.unrecoverable
    totals.pairingBreaks += result.pairingBreaks
    totals.foldedMessages += result.foldedMessages
    totals.foldedChars += result.foldedChars

    for (const candidate of report?.candidates ?? []) {
      const entry = typeTotals.get(candidate.contentType) ?? { rows: 0, tokensBefore: 0, tokensAfter: 0 }
      entry.rows += 1
      entry.tokensBefore += candidate.tokensBefore
      entry.tokensAfter += candidate.tokensAfter
      typeTotals.set(candidate.contentType, entry)
    }
  }

  return {
    rows: results,
    totals,
    byType: [...typeTotals.entries()]
      .map(([type, entry]) => ({ type, ...entry }))
      .sort((a, b) => b.tokensBefore - a.tokensBefore),
  }
}