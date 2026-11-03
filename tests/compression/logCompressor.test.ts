import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { BLOCK_HASH_LENGTH } from '../../src/main/proxy/compression/ccr/markers.ts'
import { compressLog } from '../../src/main/proxy/compression/compressors/logCompressor.ts'
import { applyCompression } from '../../src/main/proxy/compression/index.ts'

const stash = (original: string, idLength: number): string =>
  createHash('sha256').update(original).digest('hex').slice(0, idLength)

const options = { bias: 1, stash }

function logFixture(errorText = 'build failed'): string {
  const lines = ['build starting', 'compiling modules']
  for (let index = 0; index < 50; index += 1) {
    lines.push(`INFO module-${index} compiled in ${index}ms`)
  }
  lines.push(`ERROR src/api/client.ts:42 ${errorText}`)
  lines.push('    at handler (src/api/client.ts:42:10)')
  lines.push('=== Summary: 51 passed, 1 failed ===')
  lines.push('build finished')
  return lines.join('\n')
}

function messagesWithLog(log: string) {
  return [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'assistant', content: 'running build' },
    { role: 'tool', content: log },
  ]
}

test('log compressor does not compress below fifty lines', () => {
  const small = Array.from({ length: 49 }, (_, index) => `INFO line ${index}`).join('\n')
  const result = compressLog(small, options)

  assert.equal(result.changed, false)
  assert.equal(result.strategy, 'below_min_lines')
})

test('log compressor keeps errors, summaries and drops repeated info lines', () => {
  const original = logFixture()
  const result = compressLog(original, options)

  assert.equal(result.changed, true)
  assert.equal(result.ccrHash, stash(original, BLOCK_HASH_LENGTH))
  assert.match(result.text, /ERROR src\/api\/client\.ts:42 build failed/)
  assert.match(result.text, /=== Summary: 51 passed, 1 failed ===/)
  assert.doesNotMatch(result.text, /lines omitted:/)
  assert.match(
    result.text,
    /\[\d+ lines compressed to \d+\. Retrieve more: hash=[0-9a-f]{24}\]/
  )
  assert.ok(result.text.length < original.length * 0.5)
})

test('log compressor collapses similar warnings to one representative', () => {
  const lines = ['run tests']
  for (let index = 0; index < 60; index += 1) {
    lines.push(`WARN deprecated option ${index}: use new option`)
  }
  const result = compressLog(lines.join('\n'), options)

  assert.equal(result.changed, true)
  const warningCount = (result.text.match(/WARN deprecated option/g) ?? []).length
  assert.equal(warningCount, 1)
})

test('log compressor returns unchanged when CCR cannot stash the original', () => {
  const result = compressLog(logFixture(), { bias: 1, stash: () => null })

  assert.equal(result.changed, false)
  assert.equal(result.strategy, 'ccr_unavailable')
})

test('compressed log idempotence and facade wiring', () => {
  const original = logFixture()
  const first = applyCompression({
    messages: messagesWithLog(original),
    config: { enabled: true, aggressiveness: 'moderate' },
    stash,
  })

  assert.deepEqual(first.report?.applied, ['log'])
  assert.ok((first.report?.saved ?? 0) > 0)
  assert.equal(
    (first.messages?.[2].content as string).includes('Retrieve more: hash='),
    true
  )

  const second = applyCompression({
    messages: first.messages,
    config: { enabled: true, aggressiveness: 'moderate' },
    stash,
  })
  assert.equal(second.messages, first.messages)
  assert.equal(second.report?.skipped, 'already_compressed')
})

// P2 acceptance (PLAN-token-compression §P3/P2), pinned 2026-11-03.

test('a 10k-line pytest log collapses under 101 lines and keeps every FAILED and the summary', () => {
  const lines: string[] = ['============ test session starts ============']
  for (let index = 0; index < 10000; index += 1) {
    lines.push(`INFO test_suite.py::case-${index} PASSED`)
    if (index % 250 === 249) lines.push(`FAILED test_suite.py::case-${index} - assertion ${index}`)
  }
  lines.push('=== short test summary info ===')
  lines.push('40 failed, 9960 passed')

  const result = compressLog(lines.join('\n'), options)

  assert.equal(result.changed, true)
  assert.ok(result.text.split('\n').length <= 101, 'the retention budget is 100 rows plus markers')
  assert.equal(
    (result.text.match(/FAILED/g) ?? []).length,
    40,
    'every FAILED line must survive — score-1 candidates fill the budget before filler'
  )
  assert.ok(result.text.includes('=== short test summary info ==='))
  assert.ok(result.text.includes('case-249 - assertion 249'), 'the first failure anchors the head')
  assert.ok(result.text.includes('case-9999 - assertion 9999'), 'the last failure anchors the tail')
})

test('two ERROR crashes on one path at different addresses are never merged', () => {
  const lines = ['runner start']
  for (let index = 0; index < 60; index += 1) lines.push(`INFO routine work step ${index}`)
  lines.push('ERROR segfault in worker pid=11 at 0x7fff1')
  for (let index = 0; index < 20; index += 1) lines.push(`INFO filler between ${index}`)
  lines.push('ERROR segfault in worker pid=22 at 0x8fff2')
  for (let index = 0; index < 60; index += 1) lines.push(`INFO tail work step ${index}`)
  lines.push('=== done ===')

  const result = compressLog(lines.join('\n'), options)

  assert.equal(result.changed, true)
  // Dedup by normalized key applies to WARNINGS only; error lines are never
  // folded, so two crashes differing solely in their address both survive.
  assert.ok(result.text.includes('0x7fff1'), 'the first crash must survive verbatim')
  assert.ok(result.text.includes('0x8fff2'), 'the second crash must survive verbatim')
})
