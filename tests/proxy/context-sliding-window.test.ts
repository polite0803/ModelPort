/**
 * `SlidingWindowStrategy` 与 `TokenLimitStrategy` 同一条不变量：
 * **裁剪永远不许把要回答的那句话裁没**。
 *
 * 触发形状：system 消息数量已经吃满 `maxMessages`，此时
 * `maxMessages - systemMessages.length <= 0`，旧实现用 `slice(-0)` / 负数切片
 * 可能把非 system 消息全部丢掉；上游收到只剩 system 的序列后，某些适配器把
 * system 单独提走，最终变成 `messages: []`，报 `messages must be a non-empty array`。
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

  assert.equal(result.messages.length, 4, '3 条 system + 最新 1 条 user')
  assert.deepEqual(result.messages.map(m => m.role), ['system', 'system', 'system', 'user'])
  assert.equal(result.messages[3]?.content, 'newest')
})

test('系统消息超过窗口且非 system 超出部分全被裁掉时，仍保留最新一条', () => {
  const systems = Array.from({ length: 3 }, (_, i) => msg('system', `s${i}`))
  const result = strategy(1).execute([...systems, msg('user', 'a'), msg('user', 'b')])

  assert.deepEqual(result.messages.map(m => m.role), ['system', 'system', 'system', 'user'])
  assert.equal(result.messages[3]?.content, 'b', '保留的是最新的 b，不是最早的 a')
})

test('正常窗口行为不变：保留最近 N 条 non-system，system 永远保留', () => {
  const systems = [msg('system', 'sys')]
  const users = Array.from({ length: 25 }, (_, i) => msg('user', `u${i}`))
  const result = strategy(20).execute([...systems, ...users])

  assert.equal(result.messages.length, 20)
  assert.equal(result.messages[0]?.role, 'system')
  assert.equal(result.messages[1]?.content, 'u6')
  assert.equal(result.messages[19]?.content, 'u24')
})

test('只有 system 消息时原样返回，不凭空编一条 user', () => {
  const systems = [msg('system', 'sys')]
  const result = strategy(20).execute(systems)

  assert.deepEqual(result.messages, systems)
  assert.equal(result.trimmed, false)
})
