import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeToolCallNames } from '../../src/main/proxy/utils/toolCallNames.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const asIncoming = (message: Record<string, unknown>): ChatMessage => message as unknown as ChatMessage

const call = (id: string, name: string, args = '{}'): Record<string, unknown> => ({
  id,
  type: 'function',
  function: { name, arguments: args },
})

const toolCallsOf = (message: ChatMessage): Array<{ id: string }> =>
  (message as unknown as { tool_calls: Array<{ id: string }> }).tool_calls

test('没有空名调用时原样返回同一个数组', () => {
  const messages = [
    asIncoming({ role: 'user', content: 'hi' }),
    asIncoming({ role: 'assistant', content: null, tool_calls: [call('c1', 'read')] }),
    asIncoming({ role: 'tool', tool_call_id: 'c1', content: 'ok' }),
  ]
  const result = normalizeToolCallNames(messages)
  assert.equal(result.messages, messages)
  assert.equal(result.droppedCalls, 0)
  assert.equal(result.droppedResults, 0)
})

test('空名调用与它的结果一起删掉，其余调用和结果保留', () => {
  const messages = [
    asIncoming({ role: 'user', content: 'go' }),
    asIncoming({ role: 'assistant', content: 'look', tool_calls: [call('c1', 'read'), call('c2', '')] }),
    asIncoming({ role: 'tool', tool_call_id: 'c1', content: 'r1' }),
    asIncoming({ role: 'tool', tool_call_id: 'c2', content: 'r2' }),
    asIncoming({ role: 'tool', tool_call_id: '', content: '没有 id 的结果' }),
  ]
  const result = normalizeToolCallNames(messages)
  assert.equal(result.droppedCalls, 1)
  assert.equal(result.droppedResults, 2)
  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'assistant', 'tool'])
  assert.deepEqual(toolCallsOf(result.messages[1]).map((entry) => entry.id), ['c1'])
  assert.equal((result.messages[2] as unknown as { tool_call_id: string }).tool_call_id, 'c1')
})

test('调用删光且没有正文时整条 assistant 删除；有正文或推理则只丢调用', () => {
  const messages = [
    asIncoming({ role: 'user', content: 'go' }),
    asIncoming({ role: 'assistant', content: null, tool_calls: [call('c1', '')] }),
    asIncoming({ role: 'assistant', content: 'still here', tool_calls: [call('c2', '   ')] }),
    asIncoming({ role: 'assistant', content: null, reasoning_content: 'think', tool_calls: [call('c3', '')] }),
    asIncoming({ role: 'tool', tool_call_id: 'c1', content: 'r1' }),
  ]
  const result = normalizeToolCallNames(messages)
  assert.equal(result.droppedCalls, 3)
  assert.equal(result.droppedResults, 1)
  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'assistant', 'assistant'])
  assert.equal((result.messages[1] as unknown as { content: string }).content, 'still here')
  assert.equal('tool_calls' in (result.messages[1] as unknown as Record<string, unknown>), false)
  assert.equal((result.messages[2] as unknown as { reasoning_content: string }).reasoning_content, 'think')
  assert.equal('tool_calls' in (result.messages[2] as unknown as Record<string, unknown>), false)
})