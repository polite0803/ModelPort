import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import type { ChatMessage } from '../../src/main/proxy/types.ts'
import { applyCompression } from '../../src/main/proxy/compression/index.ts'
import { DEFAULT_COMPRESSION_CONFIG } from '../../src/shared/types.ts'

/**
 * In-memory CCR sink. The production store writes to `~/.modelport/ccr`, which a
 * locked-down test environment cannot create; a fake keeps the assertions about
 * compression behaviour instead of about filesystem permissions.
 */
const stash = (original: string, idLength: number): string | null =>
  createHash('sha256').update(original).digest('hex').slice(0, idLength)

/** A tool payload big enough to clear the JSON-array floor and the token gate. */
function toolPayload(count: number): string {
  const rows: Array<Record<string, unknown>> = Array.from({ length: count }, (_, index) => ({
    id: index,
    path: `src/module-${index % 7}.ts`,
    line: index,
    match: 'export function handler()',
    status: 'ok',
  }))
  rows[Math.floor(count / 2)] = {
    id: Math.floor(count / 2),
    path: 'src/broken.ts',
    line: 0,
    match: 'export function handler()',
    status: 'ok',
    error: 'FATAL: unexpected token',
  }
  return JSON.stringify(rows)
}

function messagesWithToolOutput(): ChatMessage[] {
  return [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'user', content: 'search the codebase for handler' },
    { role: 'assistant', content: 'running grep' },
    { role: 'tool', content: toolPayload(300) },
  ]
}

/** Run the facade with the fake sink and an enabled config. */
function apply(
  messages: ChatMessage[],
  aggressiveness: 'conservative' | 'moderate' | 'aggressive' = 'moderate',
  n?: number
) {
  return applyCompression({
    messages,
    n,
    config: { enabled: true, aggressiveness },
    stash,
  })
}

test('disabled compression returns the very same array reference', () => {
  const messages = messagesWithToolOutput()

  const outcome = applyCompression({
    messages,
    config: { ...DEFAULT_COMPRESSION_CONFIG, enabled: false },
  })

  assert.equal(outcome.messages, messages)
  assert.equal(outcome.report, undefined)
})

test('enabled compression rewrites only the live zone', () => {
  const messages = messagesWithToolOutput()
  const outcome = apply(messages)

  assert.ok(outcome.report)
  assert.deepEqual(outcome.report?.applied, ['json'])
  assert.ok(outcome.report!.saved > 0)
  assert.ok(outcome.messages)

  const next = outcome.messages as ChatMessage[]

  // The three frozen messages are the SAME objects, so their serialized bytes
  // cannot drift — this is the prompt-cache guarantee.
  assert.equal(next[0], messages[0])
  assert.equal(next[1], messages[1])
  assert.equal(next[2], messages[2])

  // The tool message changed and got smaller.
  assert.notEqual(next[3], messages[3])
  assert.notEqual(next[3].content, messages[3].content)
  assert.ok((next[3].content as string).length < (messages[3].content as string).length)

  // The original request is untouched.
  assert.equal((messages[3].content as string).length, toolPayload(300).length)
})

test('the error row survives compression', () => {
  const outcome = apply(messagesWithToolOutput(), 'aggressive')
  const compressed = (outcome.messages as ChatMessage[])[3].content as string
  assert.ok(compressed.includes('FATAL: unexpected token'), 'the error row must survive')
})

test('multiple choices are never compressed', () => {
  const messages = messagesWithToolOutput()
  const outcome = apply(messages, 'moderate', 3)

  assert.equal(outcome.messages, messages)
  assert.equal(outcome.report?.skipped, 'multiple_choices')
})

test('a history-only request reports no live zone and is untouched', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: toolPayload(300) },
    { role: 'assistant', content: 'done' },
  ]

  const outcome = apply(messages)

  assert.equal(outcome.messages, messages)
  assert.equal(outcome.report?.skipped, 'no_live_zone')
})

test('compression is idempotent across a retried request', () => {
  const messages = messagesWithToolOutput()
  const first = apply(messages)
  assert.equal(first.report?.applied.length, 1)

  const second = apply(first.messages as ChatMessage[])

  assert.equal(second.messages, first.messages)
  assert.deepEqual(second.report?.applied, [])
  assert.equal(second.report?.skipped, 'already_compressed')
})

test('a payload too small to matter is left byte-identical', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'tool', content: '{"ok":true}' },
  ]

  const outcome = apply(messages)

  assert.equal(outcome.messages, messages)
  assert.equal(outcome.report?.applied.length, 0)
})

test('a wrapped tool result is compressed through the live zone', () => {
  // The shape an MCP tool or HTTP API actually returns: the records sit one
  // level down, inside a wrapper object. Before the document path existed this
  // payload was detected as plain_text and never compressed at all.
  const wrapped = JSON.stringify({
    total: 300,
    results: JSON.parse(toolPayload(300)),
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'assistant', content: 'searching' },
    { role: 'tool', content: wrapped },
  ]

  const outcome = apply(messages)

  assert.ok(outcome.report)
  assert.deepEqual(outcome.report?.applied, ['json'])
  assert.ok(outcome.report!.saved > 0)

  const next = outcome.messages as ChatMessage[]
  assert.equal(next[0], messages[0])
  assert.ok((next[2].content as string).length < wrapped.length)
  // The error row nested inside the wrapper survives.
  assert.ok((next[2].content as string).includes('FATAL: unexpected token'))
})

// P0 acceptance (PLAN-token-compression §P0), pinned 2026-11-03.

test('a compressor that throws forwards verbatim and only logs a warn', () => {
  const boom = (): never => {
    throw new Error('synthetic compressor explosion')
  }
  const logged: unknown[][] = []
  const realError = console.error
  console.error = (...args: unknown[]) => logged.push(args)
  try {
    const messages = messagesWithToolOutput()
    const outcome = applyCompression({
      messages,
      config: { enabled: true, aggressiveness: 'moderate' },
      stash: boom as unknown as (original: string, idLength: number) => string | null,
    })
    // The fail-open contract: the request survives with its original bytes,
    // reported as an error skip, and the only side effect is a warn.
    assert.equal(outcome.messages, messages)
    assert.equal((outcome.messages as ChatMessage[])[3].content, messages[3].content)
    assert.equal(outcome.report?.skipped, 'error')
    assert.equal(outcome.report?.applied.length, 0)
  } finally {
    console.error = realError
  }
  assert.ok(logged.length > 0, 'the swallowed failure must leave a warn on the log')
  assert.match(JSON.stringify(logged), /compressor failed, forwarding verbatim/)
})

test('an empty messages list is skipped, not crashed', () => {
  const outcome = applyCompression({
    messages: [] as unknown as ChatMessage[],
    config: { enabled: true, aggressiveness: 'moderate' },
    stash,
  })

  assert.equal(outcome.report?.skipped, 'no_messages')
  assert.equal(outcome.report?.applied.length, 0)
})

test('a prose payload is skipped as below the type threshold', () => {
  const prose =
    'The quick brown fox jumps over the lazy dog. '.repeat(80) +
    'It is a truth universally acknowledged, that a single man in possession of a good fortune, ' +
    'must be in want of a wife. '.repeat(40)

  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'user', content: 'summarise' },
    { role: 'assistant', content: 'here' },
    { role: 'tool', content: prose },
  ]

  const outcome = apply(messages)

  assert.equal(outcome.messages, messages)
  assert.equal(outcome.report?.skipped, 'below_threshold')
})
