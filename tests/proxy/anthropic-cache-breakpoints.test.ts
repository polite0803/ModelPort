import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAnthropicRequest,
  applyCacheBreakpoints,
} from '../../src/main/proxy/adapters/anthropic.ts'
import type { PromptCacheCapability } from '../../src/shared/promptCache.ts'

const capability: PromptCacheCapability = {
  mode: 'explicit-breakpoints',
  maxBreakpoints: 4,
  readDiscount: 0.1,
  writeMultiplier: 0.25,
  minCacheableTokens: 0,
  ttlMinutes: 5,
}

const config = { enabled: true, anthropicTtl: '5m' as const }

const request = {
  model: 'claude-x',
  messages: [
    { role: 'system', content: 'you are a coding agent' },
    { role: 'user', content: 'read the file' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }],
    },
    { role: 'tool', tool_call_id: 'call-1', content: 'line one\nline two' },
  ],
  tools: [{ type: 'function', function: { name: 'read', description: 'read a file', parameters: { type: 'object' } } }],
} as never

function build(withCache: boolean, overrides: Partial<PromptCacheCapability> = {}) {
  return buildAnthropicRequest(request, 'claude-x', {
    capability: withCache ? { ...capability, ...overrides } : { mode: 'unknown' },
    config,
  })
}

test('explicit capability places markers on tools, system and the previous turn', () => {
  const body = build(true)

  assert.deepEqual(body.tools?.[0]?.cache_control, { type: 'ephemeral' })
  assert.ok(Array.isArray(body.system))
  const system = body.system as Array<{ text: string; cache_control?: unknown }>
  assert.deepEqual(system[0]?.cache_control, { type: 'ephemeral' })
  assert.equal(system[0]?.text, 'you are a coding agent', '文本一个字节都不动')

  // messages: [user, assistant(tool_use), user(tool_result)] — the breakpoint
  // lands on the assistant turn, i.e. the end of the previous turn.
  const previous = body.messages[body.messages.length - 2]
  assert.equal(previous?.role, 'assistant')
  assert.deepEqual(previous?.content.at(-1)?.cache_control, { type: 'ephemeral' })

  // The current turn stays unmarked: it is the block that will be written next.
  const current = body.messages.at(-1)
  assert.equal(current?.content.at(-1)?.cache_control, undefined)
})

test('markers are metadata only: stripping them reproduces the original body', () => {
  const plain = build(false)
  const cached = build(true)

  const strip = (block: Record<string, unknown>) => {
    const { cache_control: _ignored, ...rest } = block
    return rest
  }

  const normalized = {
    ...cached,
    tools: cached.tools?.map(tool => strip(tool as unknown as Record<string, unknown>)),
    system: Array.isArray(cached.system)
      ? cached.system.map(block => strip(block as unknown as Record<string, unknown>))
      : cached.system,
    messages: cached.messages.map(message => ({
      ...message,
      content: message.content.map(block => strip(block as unknown as Record<string, unknown>)),
    })),
  }

  // With breakpoints the system prompt is a block array; without them it stays a
  // string. Same text, two Anthropic-valid shapes — compare the text, not the
  // container.
  const expected = {
    ...plain,
    system: typeof plain.system === 'string'
      ? [{ type: 'text', text: plain.system }]
      : plain.system,
  }
  assert.deepEqual(normalized, expected)
})

test('unknown capability, disabled config, or a short prompt places nothing', () => {
  assert.equal(JSON.stringify(build(false)).includes('cache_control'), false)

  const disabled = buildAnthropicRequest(request, 'claude-x', {
    capability,
    config: { enabled: false, anthropicTtl: '5m' },
  })
  assert.equal(JSON.stringify(disabled).includes('cache_control'), false)

  const short = buildAnthropicRequest(request, 'claude-x', {
    capability: { ...capability, minCacheableTokens: 1_000_000 },
    config,
  })
  assert.equal(JSON.stringify(short).includes('cache_control'), false)
})

test('maxBreakpoints caps the marker count', () => {
  const body = build(true, { maxBreakpoints: 1 })

  const count = JSON.stringify(body).split('"cache_control"').length - 1
  assert.equal(count, 1)
})

test('the 1h tier carries the ttl field', () => {
  const body = buildAnthropicRequest(request, 'claude-x', {
    capability,
    config: { enabled: true, anthropicTtl: '1h' },
  })

  assert.deepEqual(body.tools?.[0]?.cache_control, { type: 'ephemeral', ttl: '1h' })
})

test('tool_choice none removes the tool list, so no tool marker is left behind', () => {
  const body = buildAnthropicRequest(
    { ...(request as Record<string, unknown>), tool_choice: 'none' } as never,
    'claude-x',
    { capability, config }
  )

  assert.equal(body.tools, undefined)
  assert.equal(JSON.stringify(body).includes('cache_control'), true, 'system/message markers remain')
})

test('a single-turn request gets no previous-turn marker', () => {
  const body = buildAnthropicRequest(
    {
      model: 'claude-x',
      messages: [{ role: 'user', content: 'hello' }],
    } as never,
    'claude-x',
    { capability, config }
  )

  assert.equal(JSON.stringify(body).includes('cache_control'), false)
})

test('applying the markers twice is idempotent', () => {
  const body = build(true)
  const first = JSON.stringify(body)
  applyCacheBreakpoints(body, capability, config)

  assert.equal(JSON.stringify(body), first)
})
