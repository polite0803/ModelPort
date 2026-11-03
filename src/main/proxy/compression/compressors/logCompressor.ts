/**
 * Build-log compressor.
 *
 * A build log is not a random text blob: it has levels, repeated stack frames,
 * progress lines and a small number of summaries that carry most of the signal.
 * This compressor keeps those lines plus local context, and stashes the complete
 * log in CCR before any byte is discarded.
 */

import { BLOCK_HASH_LENGTH, makeLogMarker } from '../ccr/markers.ts'
import { computeOptimalK } from '../signals/adaptiveSizer.ts'

export interface LogCompressorOptions {
  /** Aggressiveness multiplier for the adaptive retention budget. */
  bias: number
  /** Persist the original and return the id to embed in the marker. */
  stash: (original: string, idLength: number) => string | null
}

export interface LogCompressResult {
  text: string
  changed: boolean
  ccrHash?: string
  strategy: string
  /** Lines that could not be recognized as log-shaped input. */
  linesUnparsed?: number
}

/** Below this a log is small enough to forward verbatim. */
const MIN_LINES = 50
/** Hard cap for critical error/failure lines. */
const MAX_ERROR_LINES = 10
/** Hard cap for warning representatives. */
const MAX_WARNING_LINES = 5
/** Context retained around each selected line. */
const CONTEXT_RADIUS = 3
/** The rendered block must be no more than this fraction of the input. */
const MAX_RENDER_RATIO = 0.5

const ERROR_PATTERN = /\b(?:ERROR|FATAL|CRITICAL|FAIL|FAILED)\b/i
const WARNING_PATTERN = /\b(?:WARN|WARNING)\b/i
const INFO_PATTERN = /\bINFO\b/
const DEBUG_PATTERN = /\bDEBUG\b/
const TRACE_PATTERN = /\bTRACE\b/
const STACK_PATTERN =
  /^(?:Traceback \(most recent call last\)|at .+\(.+:\d+:\d+\)|\s+at [\w.$/]+\(|thread '.*' panicked at|panic: |Exception in thread|\s+at .+:\d+)/
const SUMMARY_PATTERN =
  /^(?:===|---|\d+ (?:passed|failed|skipped|error|warning)\b|Tests?: \d|Suite: \d|TOTAL\b|Summary\b)/
const WARNING_VARIANT = /[\s:=]/
const HEX_ADDRESS = /0x[0-9a-f]+/gi
const PATH_LIKE = /(?:[A-Za-z]:)?(?:\/|\\)[^\s:]+/g
const NUMBER = /\d+(?:\.\d+)?/g

interface LineFacts {
  index: number
  text: string
  score: number
  isError: boolean
  isWarning: boolean
  isStack: boolean
  isSummary: boolean
}

/** A normalized warning text used to keep repeated variants to one slot. */
function warningKey(text: string): string {
  const colon = text.indexOf(':')
  const equals = text.indexOf('=')
  const splitAt = [colon, equals].filter(index => index >= 0).sort((a, b) => a - b)[0]
  const head = splitAt === undefined ? text : text.slice(0, splitAt)
  return head
    .replace(WARNING_VARIANT, ' ')
    .replace(HEX_ADDRESS, 'ADDR')
    .replace(PATH_LIKE, '/PATH/')
    .replace(NUMBER, 'N')
    .trim()
    .toLowerCase()
}

function scoreLine(text: string): LineFacts {
  const isStack = STACK_PATTERN.test(text)
  const isSummary = SUMMARY_PATTERN.test(text)
  let score = 0
  if (ERROR_PATTERN.test(text)) score = Math.max(score, 1)
  if (WARNING_PATTERN.test(text)) score = Math.max(score, 0.5)
  if (INFO_PATTERN.test(text)) score = Math.max(score, 0.1)
  if (DEBUG_PATTERN.test(text)) score = Math.max(score, 0.05)
  if (TRACE_PATTERN.test(text)) score = Math.max(score, 0.02)
  if (isStack) score = Math.min(1, score + 0.3)
  if (isSummary) score = Math.min(1, score + 0.4)

  return {
    index: 0,
    text,
    score,
    isError: score >= 1,
    isWarning: WARNING_PATTERN.test(text),
    isStack,
    isSummary,
  }
}

function analyzeLines(lines: readonly string[]): { facts: LineFacts[]; unparsed: number } {
  const facts: LineFacts[] = []
  let recognized = 0

  lines.forEach((text, index) => {
    const item = scoreLine(text)
    item.index = index
    if (item.score > 0 || item.isStack || item.isSummary || text.trim().length === 0) {
      recognized += 1
    }
    facts.push(item)
  })

  return { facts, unparsed: Math.max(0, lines.length - recognized) }
}

/** Select the high-signal seeds before context expansion. */
function selectSeeds(facts: readonly LineFacts[], budget: number): Set<number> {
  const selected = new Set<number>()
  const warningRepresentatives = new Set<string>()
  const rememberWarning = (item: LineFacts): boolean => {
    if (!item.isWarning) return true
    const key = warningKey(item.text)
    if (warningRepresentatives.has(key)) return false
    warningRepresentatives.add(key)
    return true
  }
  const add = (index: number): void => {
    if (index >= 0 && index < facts.length) selected.add(index)
  }

  add(0)

  const errors = facts
    .filter(item => item.isError)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_ERROR_LINES)
  for (const item of errors) add(item.index)

  const seenWarnings = new Set<string>()
  const warnings: LineFacts[] = []
  for (const item of facts) {
    if (!item.isWarning) continue
    const key = warningKey(item.text)
    if (seenWarnings.has(key) || warningRepresentatives.has(key)) continue
    seenWarnings.add(key)
    warnings.push(item)
    if (warnings.length === MAX_WARNING_LINES) break
  }
  for (const item of warnings) {
    if (rememberWarning(item)) add(item.index)
  }

  // A stack trace is only useful with a few adjacent frames; the context pass
  // adds the rest, while the seed prevents a mid-trace frame from being cut.
  for (const item of facts) {
    if (item.isStack || item.isSummary) add(item.index)
  }

  if (rememberWarning(facts[facts.length - 1])) add(facts.length - 1)

  // Fill remaining budget by score, preserving original order on ties.
  const candidates = facts
    .filter(item => !selected.has(item.index))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const candidateWarnings = new Set<string>()
  for (const item of candidates) {
    if (selected.size >= budget) break
    if (item.isWarning) {
      const key = warningKey(item.text)
      if (warningRepresentatives.has(key) || candidateWarnings.has(key)) continue
      candidateWarnings.add(key)
    }
    add(item.index)
  }

  return selected
}

/** Add local context, but never let optional context push the block over budget. */
function withContext(
  seeds: ReadonlySet<number>,
  facts: readonly LineFacts[],
  budget: number,
  shouldInclude: (item: LineFacts) => boolean
): Set<number> {
  const selected = new Set(seeds)
  for (const seed of [...seeds].sort((a, b) => a - b)) {
    for (let offset = 1; offset <= CONTEXT_RADIUS; offset += 1) {
      for (const index of [seed - offset, seed + offset]) {
        if (selected.size >= budget) return selected
        if (index >= 0 && index < facts.length && shouldInclude(facts[index])) {
          selected.add(index)
        }
      }
    }
  }
  return selected
}

function unchanged(strategy: string, linesUnparsed?: number): LogCompressResult {
  return { text: '', changed: false, strategy, ...(linesUnparsed === undefined ? {} : { linesUnparsed }) }
}

/** Compress one build/log output block. Returns unchanged text when not storable. */
export function compressLog(text: string, options: LogCompressorOptions): LogCompressResult {
  const lines = text.split('\n')
  const lineCount = lines.length
  if (lineCount < MIN_LINES) return unchanged('below_min_lines')

  const { facts, unparsed } = analyzeLines(lines)
  const adaptive = computeOptimalK(lines, { bias: options.bias, minK: 10, maxK: 100 })
  // computeOptimalK intentionally keeps a large block from being compressed to
  // a tiny sample. A log needs a stronger guarantee, so its optional budget is
  // additionally bounded by one third of the original lines.
  const budget = Math.max(10, Math.min(adaptive, Math.floor(lineCount / 3)))
  const seeds = selectSeeds(facts, budget)
  const warningRepresentatives = new Set<string>()
  for (const item of facts) {
    if (item.isWarning && seeds.has(item.index)) {
      warningRepresentatives.add(warningKey(item.text))
    }
  }
  const selected = withContext(seeds, facts, budget, item => {
    if (!item.isWarning) return true
    if (warningRepresentatives.has(warningKey(item.text))) return false
    return true
  })

  if (selected.size >= lineCount) return unchanged('nothing_dropped', unparsed)

  let errors = 0
  let warnings = 0
  for (const item of facts) {
    if (selected.has(item.index)) continue
    if (item.isError) errors += 1
    if (item.isWarning) warnings += 1
  }

  const kept = [...selected].sort((a, b) => a - b).map(index => lines[index])
  const body = kept.join('\n')
  const footer =
    errors + warnings > 0 ? `\n[${lineCount - kept.length} lines omitted: ${errors} ERROR, ${warnings} WARN]` : ''

  const hash = options.stash(text, BLOCK_HASH_LENGTH)
  if (!hash) return unchanged('ccr_unavailable', unparsed)

  const rendered = `${body}${footer}\n${makeLogMarker(lineCount, kept.length, hash)}`
  if (rendered.length >= text.length * MAX_RENDER_RATIO) {
    return unchanged('not_smaller', unparsed)
  }

  return {
    text: rendered,
    changed: true,
    ccrHash: hash,
    strategy: `log(${lineCount}->${kept.length})`,
    linesUnparsed: unparsed,
  }
}
