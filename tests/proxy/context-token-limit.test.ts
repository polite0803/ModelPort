/**
 * `TokenLimitStrategy` 的兜底：**不许把历史裁成空数组**。
 *
 * 证的是这条路径以前真的会炸：单条消息自己就超预算时，从尾部反向装入预算的循环
 * 一条也不会留下，非系统消息全丢 → `messages: []` 照样发给上游 → 账号渠道的网关
 * 回一句 `messages must be a non-empty array`（vendor 里唯一的出处：
 * `openai-gateway/messages.ts`），客户端看到的是「你没传消息」而不是「消息太长」。
 * 实测复现于 2026-11-01：同一模型 24000 字符 200、26000 字符 400（`maxTokens: 8000`，
 * 估算口径 `ceil(length/3)`）。
 *
 * 纯函数层，无 store、无 electron、无网络。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TokenLimitStrategy, DEFAULT_TOKEN_LIMIT_CONFIG } from '../../src/main/proxy/services/contextManagementService.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const msg = (role: ChatMessage['role'], length: number): ChatMessage =>
  ({ role, content: 'x'.repeat(length) }) as ChatMessage

const strategy = (maxTokens: number, enabled = true) =>
  new TokenLimitStrategy({ ...DEFAULT_TOKEN_LIMIT_CONFIG, enabled, maxTokens })

test('最新一条超预算时保留它而不是清空', () => {
  // 9000 字符 → ceil(9000/3)=3000 > 2000 预算
  const result = strategy(2000).execute([msg('user', 9000)])

  assert.equal(result.messages.length, 1, '一条都不留 = 没有要回答的话')
  assert.equal(result.messages[0]?.role, 'user')
  assert.equal(result.processedCount, 1)
  assert.equal(result.trimmed, false, '原样一条，没什么被裁掉')
})

test('系统提示独占预算时也不能只剩系统提示', () => {
  const system = msg('system', 9000) // 3000 > 2000
  const result = strategy(2000).execute([system, msg('user', 300)])

  assert.deepEqual(result.messages.map(m => m.role), ['system', 'user'])
  assert.equal(result.trimmed, false, '两条都留下了：被救回来的那条本来会被整段丢掉')
})

test('正常裁剪：最新的留下，装不下的更早轮次丢掉，首条任务保留', () => {
  const result = strategy(2000).execute([
    msg('system', 300), // 100
    msg('user', 3000), // 1000 —— 首条任务，预算先扣掉
    msg('assistant', 3000), // 1000
    msg('user', 1200), // 400 → 累计 400 ≤ 900 可用
  ])

  assert.equal(result.messages.length, 3)
  assert.deepEqual(result.messages.map(m => m.role), ['system', 'user', 'user'])
  assert.equal(result.messages[1]?.content, 'x'.repeat(3000), '首条任务补回')
  assert.equal(result.messages[2]?.content, 'x'.repeat(1200))
  assert.equal(result.trimmed, true)
})

test('从 tool 结果切进去时，把 assistant(tool_calls) 一起带回来（上游不接受孤儿 tool）', () => {
  const toolCalls = [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{}' } }]
  const messages = [
    { role: 'system', content: 'x'.repeat(30) } as ChatMessage,
    { role: 'user', content: 'task' } as ChatMessage,
    { role: 'assistant', content: 'x'.repeat(900), tool_calls: toolCalls } as ChatMessage,
    { role: 'tool', content: 'x'.repeat(900) } as ChatMessage,
  ]
  // 预算 400：system ~10、任务预留 ~2，只剩 ~388；tool(300) 进、assistant(300) 不进
  const result = strategy(400).execute(messages)

  const roles = result.messages.map(m => m.role)
  assert.equal(roles[0], 'system')
  assert.equal(roles[1], 'user')
  const toolIndex = roles.indexOf('tool')
  assert.ok(toolIndex > 2, 'tool 结果保留')
  const parent = result.messages[toolIndex - 1] as ChatMessage & { tool_calls?: unknown[] }
  assert.equal(parent.role, 'assistant')
  assert.ok(Array.isArray(parent.tool_calls) && parent.tool_calls.length > 0)
})

test('关闭时原样透传，不做任何判断', () => {
  const input = [msg('user', 30_000)]
  const result = strategy(2000, false).execute(input)

  assert.equal(result.messages, input, '不复制也不裁剪')
  assert.equal(result.trimmed, false)
})

test('空输入不是崩溃点：仍然返回空而不是编一条消息', () => {
  const result = strategy(2000).execute([])

  assert.deepEqual(result.messages, [])
  assert.equal(result.processedCount, 0)
})
