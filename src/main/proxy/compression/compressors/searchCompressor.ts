/**
 * Search-result compressor.
 *
 * Search output is naturally grouped by file and dominated by context lines.
 * This compressor keeps the strongest matches per file, preserves each file's
 * beginning and end, and stashes the complete result in CCR before dropping a
 * single match.
 */

import { BLOCK_HASH_LENGTH, makeSearchMarker } from '../ccr/markers.ts'
import { computeOptimalK } from '../signals/adaptiveSizer.ts'

export interface SearchCompressorOptions {
  /** Aggressiveness multiplier for the adaptive retention budget. */
  bias: number
  /** Persist the original and return the id to embed in the marker. */
  stash: (original: string, idLength: number) => string | null
}

export interface SearchCompressResult {
  text: string
  changed: boolean
  ccrHash?: string
  strategy: string
  /** Non-empty lines that did not have `path:line:content` shape. */
  linesUnparsed?: number
}

/** Below this a search result is small enough to forward verbatim. */
const MIN_LINES = 50
/** Per-file candidate ceiling. */
const MAX_PER_FILE = 15
/** Scored candidates retained per file before the global budget is applied. */
const MAX_SCORED_PER_FILE = 5
/** Context words that make a match more useful to the model. */
const CONTEXT_WORDS = [
  'proxy',
  'compression',
  'provider',
  'route',
  'config',
  'store',
  'auth',
  'test',
  'error',
  'handler',
]
const CONFIG_WORDS = ['port', 'host', 'endpoint', 'timeout', 'enabled', 'disabled', 'path', 'key']
const IMPORTANT_PATTERN = /\b(?:TODO|FIXME|BREAKING|deprecated|security)\b/i
const SEARCH_LINE = /^(.+?)([-:])(\d+)([-:])(.*)$/

interface SearchMatch {
  file: string
  line: number
  content: string
  score: number
}

interface FileGroup {
  file: string
  matches: SearchMatch[]
}

function scoreMatch(text: string): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const word of CONTEXT_WORDS) {
    if (lower.includes(word)) score += 0.3
  }
  if (/\berror\b/i.test(text)) score += 0.5
  if (/\bwarning\b/i.test(text)) score += 0.4
  if (IMPORTANT_PATTERN.test(text)) score += 0.3
  for (const word of CONFIG_WORDS) {
    if (lower.includes(word)) score += 0.4
  }
  return Math.min(1, score)
}

function parseLine(raw: string): SearchMatch | null {
  const match = SEARCH_LINE.exec(raw)
  if (!match) return null

  const [, file, , lineNumber, , content] = match
  if (!file || !lineNumber) return null
  const line = Number.parseInt(lineNumber, 10)
  if (!Number.isFinite(line)) return null

  return {
    file,
    line,
    content,
    score: scoreMatch(`${file} ${content}`),
  }
}

function parseSearchResults(text: string): { groups: FileGroup[]; unparsed: number } {
  const byFile = new Map<string, SearchMatch[]>()
  let unparsed = 0

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const match = parseLine(line)
    if (!match) {
      unparsed += 1
      continue
    }
    const group = byFile.get(match.file)
    if (group) group.push(match)
    else byFile.set(match.file, [match])
  }

  const groups = [...byFile.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, matches]) => ({ file, matches }))
  return { groups, unparsed }
}

/** First, last and best-scored lines for a file, in original order. */
function fileCandidates(group: FileGroup): SearchMatch[] {
  const first = group.matches[0]
  const last = group.matches[group.matches.length - 1]
  const anchors = first === last ? [first] : [first, last]

  const scored = group.matches
    .filter(match => match !== first && match !== last)
    .sort((a, b) => b.score - a.score || a.line - b.line)
    .slice(0, MAX_SCORED_PER_FILE)

  const selected = [...anchors, ...scored]
    .sort((a, b) => a.line - b.line || a.content.localeCompare(b.content))
    .slice(0, MAX_PER_FILE)
  return selected
}

function renderMatch(match: SearchMatch): string {
  return `${match.file}:${match.line}:${match.content}`
}

function unchanged(strategy: string, linesUnparsed?: number): SearchCompressResult {
  return { text: '', changed: false, strategy, ...(linesUnparsed === undefined ? {} : { linesUnparsed }) }
}

/** Compress one grep/ripgrep result block. Returns unchanged when not storable. */
export function compressSearch(
  text: string,
  options: SearchCompressorOptions
): SearchCompressResult {
  if (text.split('\n').length < MIN_LINES) return unchanged('below_min_lines')
  if (text.includes('Retrieve more: hash=')) return unchanged('already_compressed')

  const { groups, unparsed } = parseSearchResults(text)
  if (groups.length === 0) return unchanged('no_matches', unparsed)

  const allItems = groups.flatMap(group => group.matches.map(match => renderMatch(match)))
  const globalBudget = computeOptimalK(allItems, {
    bias: options.bias,
    minK: 5,
    maxK: 30,
  })

  // First/last anchors are mandatory per file. If there are more anchors than
  // the statistical budget, those anchors win; optional scored matches fill the
  // remaining room without evicting a file entirely.
  const mandatory = new Set<string>()
  const optionalByFile = new Map<string, SearchMatch[]>()
  for (const group of groups) {
    const candidates = fileCandidates(group)
    const first = group.matches[0]
    const last = group.matches[group.matches.length - 1]

    for (const match of candidates) {
      if (match === first || match === last) mandatory.add(renderMatch(match))
      else optionalByFile.set(group.file, [...(optionalByFile.get(group.file) ?? []), match])
    }
  }

  const selected = new Set<string>()
  for (const key of mandatory) selected.add(key)

  const optional: SearchMatch[] = [...optionalByFile.values()].flat()
  optional.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
  for (const match of optional) {
    if (selected.size >= Math.max(globalBudget, mandatory.size)) break
    selected.add(renderMatch(match))
  }

  const totalMatches = groups.reduce((sum, group) => sum + group.matches.length, 0)
  if (selected.size >= totalMatches) return unchanged('nothing_dropped', unparsed)

  const blocks: string[] = []
  for (const group of groups) {
    const kept = group.matches.filter(match => selected.has(renderMatch(match)))
    if (kept.length === 0) continue

    const lines = kept.map(renderMatch)
    const omitted = group.matches.length - kept.length
    if (omitted > 0) lines.push(`[... and ${omitted} more matches in file]`)
    blocks.push(lines.join('\n'))
  }

  const body = blocks.join('\n')
  const hash = options.stash(text, BLOCK_HASH_LENGTH)
  if (!hash) return unchanged('ccr_unavailable', unparsed)

  const rendered = `${body}\n${makeSearchMarker(totalMatches, selected.size, hash)}`
  if (rendered.length >= text.length) return unchanged('not_smaller', unparsed)

  return {
    text: rendered,
    changed: true,
    ccrHash: hash,
    strategy: `search(${totalMatches}->${selected.size})`,
    linesUnparsed: unparsed,
  }
}
