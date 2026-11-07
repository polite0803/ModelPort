/**
 * Prefix-stability gate.
 *
 * The upstream prompt cache is a byte-prefix cache. Two things must therefore
 * hold before any cache claim is believable:
 *
 * 1. the gateway must not rewrite history (only the live zone may change);
 * 2. the serialization of everything before the new turn must not drift, and
 *    `cache_control` markers are metadata — the *content* prefix is what the
 *    cache key covers.
 *
 * A negative control is included: the helper must report a deliberately mutated
 * prefix as different, otherwise the green below proves nothing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyCompression } from '../../src/main/proxy/compression/index.ts'
import { buildAnthropicRequest } from '../../src/main/proxy/adapters/anthropic.ts'
import type { PromptCacheCapability } from '../../src/shared/promptCache.ts'

const turn1 = {
  model: 'claude-x',
  messages: [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'first question' },
  ],
}

const turn2 = {
  model: 'claude-x',
  messages: [
    ...turn1.messages,
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'second question' },
  ],
}

const capability: PromptCacheCapability = {
  mode: 'explicit-breakpoints',
  maxBreakpoints: 4,
  minCacheableTokens: 0,
}

const config = { enabled: true, anthropicTtl: '5m' as const }

/** Remove the marker metadata, keeping the content bytes the cache key covers. */
function stripMarkers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMarkers)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'cache_control') continue
    out[key] = stripMarkers(entry)
  }
  return out
}

function assertStablePrefix(previous: unknown, next: unknown): void {
  assert.deepEqual(stripMarkers(next), stripMarkers(previous))
}

test('the Anthropic wire keeps the previous turns byte-identical', () => {
  const first = buildAnthropicRequest(turn1 as never, 'claude-x', { capability, config })
  const second = buildAnthropicRequest(turn2 as never, 'claude-x', { capability, config })

  assert.equal(second.model, first.model)
  assert.deepEqual(second.tools, first.tools)
  assertStablePrefix(first.messages, second.messages.slice(0, first.messages.length))
  assert.deepEqual(stripMarkers(second.system), stripMarkers(first.system))
})

test('the gate catches a mutated history byte', () => {
  const first = buildAnthropicRequest(turn1 as never, 'claude-x', { capability, config })
  const mutated = {
    ...turn2,
    messages: turn2.messages.map((message, index) =>
      index === 1 ? { ...message, content: 'first question — edited' } : message
    ),
  }
  const second = buildAnthropicRequest(mutated as never, 'claude-x', { capability, config })

  assert.throws(() => assertStablePrefix(first.messages, second.messages.slice(0, first.messages.length)))
})

test('compression never touches history messages', () => {
  const toolResult = JSON.stringify(
    Array.from({ length: 80 }, (_, index) => ({ id: index, file: `src/f${index}.ts`, status: 'ok' }))
  )
  const messages = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: 'old answer' },
    { role: 'tool', content: toolResult, tool_call_id: 'call-1' },
  ]

  const outcome = applyCompression({
    messages: messages as never,
    config: { enabled: true, aggressiveness: 'moderate' },
  })

  assert.ok(outcome.messages)
  for (let index = 0; index < messages.length - 1; index += 1) {
    assert.equal(outcome.messages[index], messages[index], `history message ${index} must keep identity`)
  }
  if (outcome.report?.applied.length) {
    assert.notEqual(outcome.messages.at(-1), messages.at(-1), '只有 live zone 允许变化')
  }
})
