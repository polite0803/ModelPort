/**
 * The two blocks of gateway-authored text, and the rules that keep them from
 * becoming the 2026-11-03 regression again.
 *
 * What is pinned here:
 * - both blocks are pure functions (byte-identical on every turn, so the prefix
 *   cache keeps working);
 * - they arrive as their own leading `system` message, never as a `user` turn
 *   and never appended to the client's system prompt;
 * - re-running the injection is idempotent, including when a client echoes the
 *   block back;
 * - the protocol block is only planned for conversations that have been compressed, and once planned
 *   it stays for the rest of that conversation, so a conversation that never compresses pays nothing
 *   and a compressing one never has its prefix rewritten by the block coming and going.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  GATEWAY_TEXT_HEADER,
  applyGatewayText,
  ccrProtocolText,
  conversationHasCompressionMarker,
  outputContractText,
} from '../../src/main/proxy/gatewayText.ts'
import {
  MARKED_CONVERSATION_TTL_MS,
  MAX_MARKED_CONVERSATIONS,
  conversationHasProtocolBlock,
  rememberProtocolBlock,
  resetProtocolBlockMemory,
} from '../../src/main/proxy/gatewayProtocolMemory.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const clientMessages: ChatMessage[] = [
  { role: 'system', content: 'You are a coding agent.' },
  { role: 'user', content: 'read the file' },
]

test('the protocol block names the marker syntax and its retrieval endpoint', () => {
  const text = ccrProtocolText()
  assert.match(text, /<<ccr:/)
  assert.match(text, /hash=/)
  assert.match(text, /GET \/v1\/ccr\/<hash>/)
  // Deterministic: the prefix cache needs the same bytes next turn.
  assert.equal(ccrProtocolText(), text)
})

test('output contract: default authors nothing, the two levels are distinct', () => {
  assert.equal(outputContractText('default'), null)
  const concise = outputContractText('concise')
  const minimal = outputContractText('minimal')
  assert.ok(concise && minimal)
  assert.notEqual(concise, minimal)
  assert.equal(outputContractText('concise'), concise)
})

test('marker detection ignores the gateway block itself', () => {
  assert.equal(conversationHasCompressionMarker(clientMessages), false)

  const withSentinel: ChatMessage[] = [
    ...clientMessages,
    { role: 'assistant', content: 'calling tool' },
    { role: 'tool', content: '… 3 more items <<ccr:abcdef123456 3_items_offloaded>>' },
  ]
  assert.equal(conversationHasCompressionMarker(withSentinel), true)

  const withLogMarker: ChatMessage[] = [
    { role: 'tool', content: '[120 lines compressed to 30. Retrieve more: hash=abcdef1234567890abcdef12]' },
  ]
  assert.equal(conversationHasCompressionMarker(withLogMarker), true)

  // Our own block mentions `<<ccr:` in prose; that must not count as evidence.
  const onlyOurBlock: ChatMessage[] = [
    { role: 'system', content: `${GATEWAY_TEXT_HEADER}\n\n${ccrProtocolText()}` },
    { role: 'user', content: 'hello' },
  ]
  assert.equal(conversationHasCompressionMarker(onlyOurBlock), false)
})

test('injection prepends one system message and leaves the client prompt alone', () => {
  const next = applyGatewayText(clientMessages, [ccrProtocolText()])

  assert.equal(next.length, clientMessages.length + 1)
  assert.equal(next[0].role, 'system', 'a user turn here is the retired trailing-user-guard failure')
  assert.ok(String(next[0].content).startsWith(GATEWAY_TEXT_HEADER))
  // The client's own messages are the same objects, in the same order.
  assert.equal(next[1], clientMessages[0])
  assert.equal(next[2], clientMessages[1])
})

test('injection is idempotent and replaces rather than stacks', () => {
  const once = applyGatewayText(clientMessages, [ccrProtocolText()])
  const twice = applyGatewayText(once, [ccrProtocolText()])
  assert.equal(twice, once, 'a re-run with the same blocks must be a no-op')

  const contract = outputContractText('concise') as string
  const withContract = applyGatewayText(once, [ccrProtocolText(), contract])
  assert.equal(withContract.length, once.length, 'the block is replaced, not added')
  assert.match(String(withContract[0].content), /concise/)
  assert.equal(withContract[1], clientMessages[0])
})

test('an empty plan removes the block and restores the original conversation', () => {
  const injected = applyGatewayText(clientMessages, [ccrProtocolText()])
  const restored = applyGatewayText(injected, [])
  assert.deepEqual(restored, clientMessages)
  assert.equal(applyGatewayText(clientMessages, []), clientMessages, 'nothing to undo is a no-op')
})

test('the protocol block is remembered per conversation, so its presence cannot flap', () => {
  resetProtocolBlockMemory()
  const now = 1_000_000

  assert.equal(conversationHasProtocolBlock('conv-a', now), false, 'a fresh conversation pays nothing')
  rememberProtocolBlock('conv-a', now)
  assert.equal(conversationHasProtocolBlock('conv-a', now + 1000), true, 'a later turn keeps the same prefix')
  assert.equal(conversationHasProtocolBlock('conv-b', now + 1000), false, 'another conversation is unaffected')

  assert.equal(
    conversationHasProtocolBlock('conv-a', now + MARKED_CONVERSATION_TTL_MS + 1),
    false,
    'an idle conversation is forgotten'
  )
  // No key means no memory: behaviour falls back to the per-turn decision.
  rememberProtocolBlock(undefined, now)
  assert.equal(conversationHasProtocolBlock(undefined, now), false)
})

test('the memory is bounded and evicts the oldest conversation first', () => {
  resetProtocolBlockMemory()
  const now = 2_000_000
  for (let index = 0; index <= MAX_MARKED_CONVERSATIONS; index += 1) {
    rememberProtocolBlock(`conv-${index}`, now + index)
  }

  assert.equal(conversationHasProtocolBlock('conv-0', now + 1000), false, 'the oldest was evicted')
  assert.equal(
    conversationHasProtocolBlock(`conv-${MAX_MARKED_CONVERSATIONS}`, now + 1000),
    true,
    'the newest is kept'
  )
  resetProtocolBlockMemory()
})