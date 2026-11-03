import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { BLOCK_HASH_LENGTH, makeSearchMarker } from '../../src/main/proxy/compression/ccr/markers.ts'
import { compressSearch } from '../../src/main/proxy/compression/compressors/searchCompressor.ts'
import { applyCompression } from '../../src/main/proxy/compression/index.ts'

const stash = (original: string, idLength: number): string =>
  createHash('sha256').update(original).digest('hex').slice(0, idLength)

const options = { bias: 1, stash }

function searchFixture(): string {
  const lines = ['searching for compression']
  for (let index = 0; index < 35; index += 1) {
    lines.push(`D:\\src\\app\\module.ts:${index + 1}: compression example ${index}`)
  }
  for (let index = 0; index < 35; index += 1) {
    lines.push(`D:\\src\\app\\render.ts:${index + 1}: compression example ${index}`)
  }
  lines.push('C:\\src\\api\\client.ts:42: compression error')
  lines.push('D:\\src\\app\\module-43-search context line')
  return lines.join('\n')
}

function messagesWithSearch(text: string) {
  return [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'assistant', content: 'running search' },
    { role: 'tool', content: text },
  ]
}

test('search compressor does not compress below fifty lines', () => {
  const small = Array.from({ length: 49 }, (_, index) => `file.ts:${index + 1}: result`).join('\n')
  const result = compressSearch(small, options)

  assert.equal(result.changed, false)
  assert.equal(result.strategy, 'below_min_lines')
})

test('search compressor handles Windows paths and dash separators', () => {
  const original = searchFixture()
  const result = compressSearch(original, options)

  assert.equal(result.changed, true)
  assert.equal(result.ccrHash, stash(original, BLOCK_HASH_LENGTH))
  assert.match(result.text, /C:\\src\\api\\client\.ts:42: compression error/)
  assert.match(result.text, /D:\\src\\app\\module:43:search context line/)
  assert.match(
    result.text,
    /\[72 matches compressed to \d+\. Retrieve more: hash=[0-9a-f]{24}\]/
  )
  assert.ok(result.text.length < original.length)
})

test('search compressor sorts files and reports omitted matches', () => {
  const lines = ['z-file.ts:1:error z', 'a-file.ts:1:info a']
  for (let index = 0; index < 80; index += 1) {
    lines.push(`a-file.ts:${index + 2}:common result ${index}`)
  }
  lines.push('z-file.ts:2:important result')
  const result = compressSearch(lines.join('\n'), options)

  assert.equal(result.changed, true)
  assert.ok(result.text.indexOf('a-file.ts:1:') < result.text.indexOf('z-file.ts:1:'))
  assert.match(result.text, /\[\.\.\. and \d+ more matches in file\]/)
})

test('search compressor keeps first and last match per file under anchors', () => {
  const lines: string[] = []
  for (let index = 0; index < 60; index += 1) {
    lines.push(`one.ts:${index + 1}:ordinary match ${index}`)
  }
  const result = compressSearch(lines.join('\n'), options)

  assert.equal(result.changed, true)
  assert.match(result.text, /one\.ts:1:/)
  assert.match(result.text, /one\.ts:60:/)
})

test('search compressor reports malformed lines', () => {
  const lines = [
    'file.ts:1:real match',
    ...Array.from({ length: 60 }, (_, index) => `file.ts:${index + 2}:real match ${index}`),
    'not a search result',
  ]
  const result = compressSearch(lines.join('\n'), options)

  assert.equal(result.changed, true)
  assert.equal(result.linesUnparsed, 1)
})

test('search compressor refuses already compressed input and unavailable CCR', () => {
  const compressed = [
    'file.ts:1:match',
    ...Array.from({ length: 60 }, (_, index) => `file.ts:${index + 2}:match ${index}`),
    makeSearchMarker(61, 5, 'abc'),
  ].join('\n')
  const already = compressSearch(compressed, options)
  assert.equal(already.changed, false)
  assert.equal(already.strategy, 'already_compressed')

  const noStore = compressSearch(searchFixture(), { bias: 1, stash: () => null })
  assert.equal(noStore.changed, false)
  assert.equal(noStore.strategy, 'ccr_unavailable')
})

test('facade dispatches search output and does not mutate the original message', () => {
  const original = searchFixture()
  const messages = messagesWithSearch(original)
  const first = applyCompression({
    messages,
    config: { enabled: true, aggressiveness: 'moderate' },
    stash,
  })

  assert.deepEqual(first.report?.applied, ['search'])
  assert.ok((first.report?.saved ?? 0) > 0)
  assert.equal(messages[2].content, original)

  const second = applyCompression({
    messages: first.messages,
    config: { enabled: true, aggressiveness: 'moderate' },
    stash,
  })
  assert.equal(second.messages, first.messages)
  assert.equal(second.report?.skipped, 'already_compressed')
})

// P2 acceptance (PLAN-token-compression §P2), pinned 2026-11-03:
// every file keeps at least one match, and the kept total stays inside the
// global computeOptimalK budget (minK 5, maxK 30).

test('no file is dropped entirely and the kept total respects the budget', () => {
  const lines: string[] = []
  for (let file = 0; file < 12; file += 1) {
    for (let index = 0; index < 25; index += 1) {
      lines.push(`src/dir/file-${file}.ts:${index + 1}: found handler invocation ${index}`)
    }
  }

  const result = compressSearch(lines.join('\n'), options)
  assert.equal(result.changed, true)

  const keptPerFile = new Map<string, number>()
  for (const line of result.text.split('\n')) {
    const match = line.match(/^(src\/dir\/file-\d+\.ts):/)
    if (match) keptPerFile.set(match[1], (keptPerFile.get(match[1]) ?? 0) + 1)
  }

  assert.equal(keptPerFile.size, 12, 'every file must keep at least one match')
  for (const count of keptPerFile.values()) assert.ok(count >= 1)
  const total = [...keptPerFile.values()].reduce((sum, count) => sum + count, 0)
  assert.ok(total <= 30, `global search budget is maxK=30, kept ${total}`)
})
