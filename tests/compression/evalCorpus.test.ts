/**
 * The D prerequisite's yardstick, tested with the two samples that matter:
 * a conversation it should judge clean, and a wrong sample it must catch.
 *
 * If `pairingBreaks` or `unrecoverable` cannot fail, the number they print is
 * decoration — so each metric gets a negative control here, not just a happy
 * path.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  captureFromLogRows,
  describeCorpus,
  pairingBreaks,
  evaluateCorpus,
  type CorpusRow,
} from '../../src/main/proxy/compression/evalCorpus.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

function makeStash() {
  const store = new Map<string, string>()
  let next = 0
  return {
    store,
    stash: (original: string) => {
      next += 1
      const id = String(next).padStart(24, 'a').slice(0, 24)
      store.set(id, original)
      return id
    },
    resolve: (hash: string) => store.get(hash),
  }
}

const config = { enabled: true, aggressiveness: 'moderate' as const, cacheFirst: false }

test('capture counts every rejection class instead of dropping rows silently', () => {
  const { rows, stats } = captureFromLogRows([
    { id: 'a', requestBody: JSON.stringify({ messages: [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'two' }] }) },
    { id: 'b' }, // no body at all: body capture was off
    { id: 'c', requestBody: '{not json' },
    { id: 'd', requestBody: JSON.stringify({ messages: [{ role: 'user', content: 'single' }] }) },
    { id: 'e', requestBody: JSON.stringify({ messages: 'not an array' }) },
  ])

  assert.equal(stats.scanned, 5)
  assert.equal(stats.withBody, 4, 'b is the only row with no body')
  assert.equal(stats.unparsable, 1, 'c is counted as unparsable')
  assert.equal(stats.tooShort, 2, 'd (one message) and e (not an array) are both too short')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'a')
})

test('the corpus description classifies by the largest message, not the first', () => {
  const rows: CorpusRow[] = [
    {
      id: 'big-json',
      model: null,
      capturedAt: null,
      messages: [
        { role: 'user', content: 'short' },
        { role: 'tool', content: JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ i }))) },
      ],
    },
    {
      id: 'empty',
      model: null,
      capturedAt: null,
      messages: [{ role: 'user', content: '' }, { role: 'assistant', content: '' }],
      tools: [],
    },
  ]

  const description = describeCorpus(rows)
  const byType = Object.fromEntries(description.mix.map(entry => [entry.type, entry.rows]))

  assert.equal(byType.json_array, 1, 'the tool message is the largest one in row 1')
  assert.equal(byType.empty, 1)
  assert.equal(description.withTools, 1)
  assert.deepEqual(description.sizes, [...description.sizes].sort((a, b) => a - b))
})

test('a folded duplicate is fully recoverable and changes no pointer target', () => {
  const file = Array.from({ length: 40 }, (_, i) => `line ${i} of the file, filler filler`).join('\n')
  const messages: ChatMessage[] = [
    { role: 'user', content: 'read it' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: file },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'read it again' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_2', content: file },
    { role: 'assistant', content: 'ok again' },
    { role: 'user', content: 'now do something else' },
  ]

  const { store, stash, resolve } = makeStash()
  const report = evaluateCorpus([{ id: 'row', model: null, capturedAt: null, messages }], {
    config,
    fold: true,
    stash,
    resolve,
  })

  const row = report.rows[0]
  assert.equal(row.foldedMessages, 1, 'the later copy is folded, the earlier one is the anchor')
  assert.equal(row.markers, 1)
  assert.equal(row.resolvable, 1)
  assert.equal(row.unrecoverable, 0, 'the removed text is behind a marker that resolves')
  assert.equal(row.pairingBreaks, 0, 'the tool_call_id survives the rewrite')
  assert.equal(store.size, 1)
  assert.ok(row.bytesOut < row.bytesIn)
})

test('a refused stash leaves the conversation intact instead of losing bytes', () => {
  const file = 'x'.repeat(2000)
  const messages: ChatMessage[] = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: '' },
    { role: 'tool', content: file },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
    { role: 'assistant', content: '' },
    { role: 'tool', content: file },
    { role: 'assistant', content: 'd' },
  ]

  const report = evaluateCorpus([{ id: 'row', model: null, capturedAt: null, messages }], {
    config,
    fold: true,
    stash: () => null,
    resolve: () => undefined,
  })

  const row = report.rows[0]
  assert.equal(row.foldedMessages, 0)
  assert.equal(row.markers, 0)
  assert.equal(row.bytesOut, row.bytesIn, 'nothing was rewritten')
  assert.equal(row.unrecoverable, 0)
})

test('the live zone is measured too, and its pointer resolves', () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: index, status: 'ok', duration: 10 }))
  const messages: ChatMessage[] = [
    { role: 'assistant', content: 'fetching' },
    { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify(rows) },
  ] as ChatMessage[]

  const { stash, resolve } = makeStash()
  const report = evaluateCorpus([{ id: 'row', model: null, capturedAt: null, messages }], {
    config,
    stash,
    resolve,
  })

  const row = report.rows[0]
  assert.ok(row.tokensBefore > 0, 'the JSON array reached the accept gate')
  assert.ok(row.tokensAfter < row.tokensBefore)
  assert.equal(row.markers, 1)
  assert.equal(row.resolvable, 1)
  assert.equal(row.unrecoverable, 0)
})

test('pairingBreaks has teeth: a removed tool result is counted', () => {
  const intact: ChatMessage[] = [
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'result' },
  ]
  assert.equal(pairingBreaks(intact), 0)

  const missingResult: ChatMessage[] = [intact[0]]
  assert.equal(pairingBreaks(missingResult), 1)

  const orphanResult: ChatMessage[] = [intact[1]]
  assert.equal(pairingBreaks(orphanResult), 1)
})