/**
 * `SlidingWindowStrategy` 与 `TokenLimitStrategy` 同一条不变量：
 * **裁剪永远不许把要回答的那句话裁没**，且不许把 tool 组切出孤儿。
 *
 * 触发形状：system 消息数量已经吃满 `maxMessages`，此时
 * `maxMessages - systemMessages.length <= 0`，旧实现用 `slice(-0)` / 负数切片
 * 可能把非 system 消息全部丢掉；上游收到只剩 system 的序列后，某些适配器把
 * system 单独提走，最终变成 `messages: []`，报 `messages must be a non-empty array`。
 *
 * 2026-11-09 追加两条契约（为了给长会话降 token/积分）：
 * - 从 `tool` 结果处切开时，把它所属的 `assistant(tool_calls)` 一起带回来；
 * - 窗口不再覆盖首条非 system user 消息时，把它补回最前面（任务原文）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SlidingWindowStrategy,
  DEFAULT_SLIDING_WINDOW_CONFIG,
} from '../../src/main/proxy/services/contextManagementService.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const msg = (role: ChatMessage['role'], content: string): ChatMessage =>
  ({ role, content }) as ChatMessage

const strategy = (maxMessages: number) =>
  new SlidingWindowStrategy({ ...DEFAULT_SLIDING_WINDOW_CONFIG, enabled: true, maxMessages })

test('system 吃满窗口时仍保留最新一条非 system 消息', () => {
  const systems = Array.from({ length: 3 }, (_, i) => msg('system', `s${i}`))
  const result = strategy(3).execute([...systems, msg('user', 'old'), msg('user', 'newest')])

  // 3 条 system + 首条任务（old）+ 最新一条（newest）
  assert.equal(result.messages.length, 5)
  assert.deepEqual(result.messages.map(m => m.role), ['system', 'system', 'system', 'user', 'user'])
  assert.equal(result.messages[3]?.content, 'old', '任务原文补回')
  assert.equal(result.messages[4]?.content, 'newest', '最新一条保留')
})

test('系统消息超过窗口且非 system 超出部分全被裁掉时，仍保留最新一条', () => {
  const systems = Array.from({ length: 3 }, (_, i) => msg('system', `s${i}`))
  const result = strategy(1).execute([...systems, msg('user', 'a'), msg('user', 'b')])

  assert.deepEqual(result.messages.map(m => m.role), ['system', 'system', 'system', 'user', 'user'])
  assert.equal(result.messages[3]?.content, 'a', '首条任务保留')
  assert.equal(result.messages[4]?.content, 'b', '保留的是最新的 b')
})

test('正常窗口：最近 N 条 non-system + 首条任务，system 永远保留', () => {
  const systems = [msg('system', 'sys')]
  const users = Array.from({ length: 25 }, (_, i) => msg('user', `u${i}`))
  const result = strategy(20).execute([...systems, ...users])

  // system + u0（任务）+ u6..u24（窗口 19 条）
  assert.equal(result.messages.length, 21)
  assert.equal(result.messages[0]?.role, 'system')
  assert.equal(result.messages[1]?.content, 'u0')
  assert.equal(result.messages[2]?.content, 'u6')
  assert.equal(result.messages[20]?.content, 'u24')
})

test('从 tool 结果切进去时，把 assistant(tool_calls) 一起带回来（上游不接受孤儿 tool）', () => {
  const toolCalls = [{ id: 'call-1', type: 'function', function: { name: 'read', arguments: '{}' } }]
  const messages: ChatMessage[] = [
    msg('system', 'sys'),
    msg('user', 'task'),
    { role: 'assistant', content: '', tool_calls: toolCalls } as ChatMessage,
    msg('tool', 'result'),
    msg('assistant', 'ok'),
  ]
  // system 1 + 2 条 non-system：窗口正好切在 tool 与 assistant(ok)
  const result = strategy(3).execute(messages)

  const roles = result.messages.map(m => m.role)
  assert.equal(roles[0], 'system')
  assert.equal(roles[1], 'user', '任务补回')
  const toolIndex = roles.indexOf('tool')
  assert.ok(toolIndex > 2, 'tool 结果被保留')
  const parent = result.messages[toolIndex - 1] as ChatMessage & { tool_calls?: unknown[] }
  assert.equal(parent.role, 'assistant', 'tool 结果前面必须紧邻它的 assistant')
  assert.ok(Array.isArray(parent.tool_calls) && parent.tool_calls.length > 0, '带上的是带 tool_calls 的那条')
})

test('任务已在窗口内时不重复添加', () => {
  const messages = [msg('system', 'sys'), msg('user', 'task'), msg('assistant', 'a'), msg('user', 'next')]
  const result = strategy(10).execute(messages)

  assert.deepEqual(result.messages.map(m => m.content), ['sys', 'task', 'a', 'next'])
  assert.equal(result.trimmed, false)
})

test('只有 system 消息时原样返回，不凭空编一条 user', () => {
  const systems = [msg('system', 'sys')]
  const result = strategy(20).execute(systems)

  assert.deepEqual(result.messages, systems)
  assert.equal(result.trimmed, false)
})
