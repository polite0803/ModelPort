/**
 * Cross-turn duplicate folding and its measurement gate.
 *
 * The behaviour that matters is not "it compresses"; it is that folding stays
 * reversible, deterministic and confined to history:
 * - the earliest copy is never folded, so the pointer resolves to something the
 *   model can still read in the same conversation;
 * - the same conversation produces the same markers every turn (prefix cache);
 * - a failed stash leaves the message untouched (no pointer to nothing);
 * - nothing newer than the last assistant turn is touched (live zone belongs to
 *   live-zone compression).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { FOLD_MIN_CHARS, foldCrossTurnDuplicates } from '../../src/main/proxy/compression/fold.ts'
import {
  decideDuplicateFold,
  readFoldDecision,
  resetFoldDecisionCache,
} from '../../src/main/proxy/compression/foldGate.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

/** A tool result big enough to be eligible, with a line-numbered body. */
function toolResult(marker: string): string {
  const lines = Array.from({ length: 40 }, (_, index) => `${index + 1}: export const value${index} = ${index}`)
  lines.push(`// ${marker}`)
  return lines.join('\n')
}

function memoryStash(): {
  stash: (original: string, idLength: number) => string | null
  stored: Map<string, string>
} {
  const stored = new Map<string, string>()
  let counter = 0
  return {
    stored,
    stash: (original, idLength) => {
      const id = `${(++counter).toString(16).padStart(idLength, '0')}`.slice(0, idLength)
      stored.set(id, original)
      return id
    },
  }
}

test('a repeated history message becomes a pointer; the earliest copy stays', () => {
  const original = toolResult('first read')
  // Same text, renumbered as a later `cat` would print it.
  const repeated = original.replace(/^(\d+):/gm, (_, n: string) => `${Number(n) + 7}:`)
  const messages: ChatMessage[] = [
    { role: 'system', content: 'agent' },
    { role: 'tool', content: original },
    { role: 'user', content: 'thanks, do it again' },
    { role: 'assistant', content: 'reading again' },
    { role: 'tool', content: repeated },
  ]
  const { stash, stored } = memoryStash()

  // liveZoneFrom = 3 means indices 0..2 are history; index 4 stays untouched.
  const outcome = foldCrossTurnDuplicates(messages, { stash, liveZoneFrom: 3 })

  assert.equal(outcome.foldedMessages, 0, 'the only repeat is inside the live zone')
  assert.equal(outcome.messages, messages)

  const historyOnly = foldCrossTurnDuplicates(messages, { stash, liveZoneFrom: 5 })
  assert.equal(historyOnly.foldedMessages, 1)
  assert.equal(historyOnly.messages[1], messages[1], 'the earliest copy is never folded')
  assert.notEqual(historyOnly.messages[4], messages[4])

  const marker = String(historyOnly.messages[4].content)
  assert.match(marker, /Retrieve original: hash=/)
  const hash = /hash=([a-f0-9]+)/.exec(marker)?.[1]
  assert.ok(hash)
  assert.equal(stored.get(hash), repeated, 'the pointer resolves to the exact removed bytes')
})

test('folding is deterministic: the same conversation yields the same bytes', () => {
  const original = 'x'.repeat(FOLD_MIN_CHARS + 10)
  const messages: ChatMessage[] = [
    { role: 'tool', content: original },
    { role: 'assistant', content: 'ok' },
    { role: 'tool', content: original },
  ]

  const first = foldCrossTurnDuplicates(messages, { stash: memoryStash().stash, liveZoneFrom: 3 })
  // Re-running on its own output must not re-fold (the marker is not source).
  const second = foldCrossTurnDuplicates(first.messages, { stash: memoryStash().stash, liveZoneFrom: 3 })
  assert.equal(second.foldedMessages, 0, 'a marker is never hashed again')
  assert.equal(second.messages, first.messages)
})

test('a refused stash leaves the conversation byte-identical', () => {
  const original = 'y'.repeat(FOLD_MIN_CHARS + 10)
  const messages: ChatMessage[] = [
    { role: 'tool', content: original },
    { role: 'assistant', content: 'ok' },
    { role: 'tool', content: original },
  ]

  const outcome = foldCrossTurnDuplicates(messages, {
    stash: () => null,
    liveZoneFrom: 3,
  })

  assert.equal(outcome.foldedMessages, 0)
  assert.equal(outcome.refused, true)
  assert.equal(outcome.messages, messages, 'no pointer may point at bytes that were never stored')
})

test('system and assistant messages are never folded', () => {
  const text = 'z'.repeat(FOLD_MIN_CHARS + 10)
  const messages: ChatMessage[] = [
    { role: 'system', content: text },
    { role: 'assistant', content: text },
    { role: 'assistant', content: text },
  ]

  const outcome = foldCrossTurnDuplicates(messages, { stash: memoryStash().stash, liveZoneFrom: 3 })
  assert.equal(outcome.foldedMessages, 0)
})

const healthySummary = {
  sampled: 12,
  multiBlockRequests: 6,
  truncatedRequests: 0,
  ratio: 0.42,
}

test('the gate refuses on each of its four grounds, with a reason', () => {
  const survivorship = { meanRemainingTurns: 3.2, finishedConversations: 9 }

  assert.equal(
    decideDuplicateFold({ optIn: false, summary: healthySummary, survivorship }).reason,
    'off'
  )
  assert.equal(
    decideDuplicateFold({
      optIn: true,
      summary: { ...healthySummary, multiBlockRequests: 0 },
      survivorship,
    }).reason,
    'inconclusive',
    'a window of only single-turn requests proves nothing'
  )
  assert.equal(
    decideDuplicateFold({ optIn: true, summary: { ...healthySummary, ratio: 0.05 }, survivorship }).reason,
    'low_ratio'
  )
  assert.equal(
    decideDuplicateFold({
      optIn: true,
      summary: healthySummary,
      survivorship: { meanRemainingTurns: null, finishedConversations: 2 },
    }).reason,
    'unknown_lifetime',
    'null is "not yet known", never a zero'
  )
})

test('the gate opens only when duplication and remaining turns are both known', () => {
  const decision = decideDuplicateFold({
    optIn: true,
    summary: healthySummary,
    survivorship: { meanRemainingTurns: 4, finishedConversations: 9 },
  })
  assert.equal(decision.fold, true)
  assert.equal(decision.reason, 'ok')
  assert.equal(decision.savingsHint, 4 * 0.42)
})

test('the decision is memoised for the TTL, then recomputed', () => {
  resetFoldDecisionCache()
  let calls = 0
  const load = () => {
    calls += 1
    return {
      optIn: true,
      summary: healthySummary,
      survivorship: { meanRemainingTurns: 4, finishedConversations: 9 },
    }
  }

  const now = 1_000_000
  readFoldDecision(load, now, 60_000)
  readFoldDecision(load, now + 1_000, 60_000)
  assert.equal(calls, 1, 'the request-log window is not re-summarised per request')

  readFoldDecision(load, now + 61_000, 60_000)
  assert.equal(calls, 2)
  resetFoldDecisionCache()
})