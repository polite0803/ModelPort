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

import {
  ContextManagementService,
  TokenLimitStrategy,
  DEFAULT_TOKEN_LIMIT_CONFIG,
} from '../../src/main/proxy/services/contextManagementService.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const msg = (role: ChatMessage['role'], length: number): ChatMessage =>
  ({ role, content: 'x'.repeat(length) }) as ChatMessage

const strategy = (maxTokens: number, enabled = true) =>
  new TokenLimitStrategy({ ...DEFAULT_TOKEN_LIMIT_CONFIG, enabled, maxTokens })

test('最新一条超预算时截断它而不是清空（上限必须真的绑定）', () => {
  // 9000 字符 → ceil(9000/3)=3000 > 2000 预算。
  //
  // 旧行为是「原样保留」并报 `trimmed: false`：消息条数不变，于是调用方
  // （`forwarder.ts`）认为「什么都没发生」而丢弃裁剪结果 —— 现网一笔 125,024
  // token 的请求就这样打在 65,536 的上限上。现在改成截断 + 取回指针：
  // 仍有东西可回答，且上限成立。
  const result = strategy(2000).execute([msg('user', 9000)])

  assert.equal(result.messages.length, 1, '一条都不留 = 没有要回答的话')
  assert.equal(result.messages[0]?.role, 'user')
  assert.equal(result.processedCount, 1)
  assert.equal(result.trimmed, true, '内容被截短了，必须报「裁过」而不是原样透传')
  assert.equal(result.rewrote, true, '条数没变、内容变了 —— 这个区别正是调用方要读的')
  const tokens = ContextManagementService.estimateTotalTokens(result.messages)
  assert.ok(tokens <= 2000, `输出必须落在上限内，实际 ${tokens}`)
})

test('系统提示独占预算时：两条都保住，且最新一条不被砍成残句', () => {
  // system 3000 token 单独就超过 2000 的上限，而该策略没开 system 截断 ——
  // 上限在这一格**够不到**：没有任何东西被允许缩到能落回 2000 的程度。
  //
  // 2026-11-16 的旧行为是拿负余额（2000-3000 = -1000）当预算去截最新一条，
  // 于是它被截到 `MIN_KEPT_TOKENS` = 64 —— 一句指令只剩开头几个字。现网
  // Claude Code 会话（自身系统提示 ~65,880 token / 上限 65,536）每轮收到的
  // 就是 `"客\n… [626 of 627 chars dropped…]"`，客户端把它读成模型换了语言。
  // 裁掉换不回落回上限，只是把问题从「超预算」变成「没有指令可答」。
  const system = msg('system', 9000) // 3000 token
  const user = msg('user', 300) // 100 token
  const result = strategy(2000).execute([system, user])

  assert.deepEqual(result.messages.map(m => m.role), ['system', 'user'], '被救回来的那条不能整段丢掉')
  // 系统块没有点名 `maxSystemTokensByProvider`，因此一个字节都不许动：那
  // 是客户自己的提示词，比丢历史更强的动作必须由渠道显式点开。
  assert.equal(result.messages[0]?.content, system.content, '未点名时系统块原样保留')
  // 够不到上限时不做无谓的牺牲：指令完整送达，超限由告警说清楚。
  assert.equal(result.messages[1]?.content, user.content, '够不到上限时不许把指令截成残句')
  assert.equal(result.trimmed, false, '没有东西真的变短，就不许报「裁过」')
  // 这一格诚实地承认超了：系统块自己就大于上限，而不许它缩，就没有别的可缩。
  assert.ok(ContextManagementService.estimateTotalTokens(result.messages) > 2000)
})

test('系统提示超上限但最新一条自己就很大：仍按上限截断，不是放行', () => {
  // 上一格保留指令原样，前提是它本来就装得下。一条真正超大的 turn 仍必须有界，
  // 否则「够不到上限」会变成「不做任何约束」。
  const system = msg('system', 9000) // 3000 token > 2000 上限
  const huge = msg('user', 30_000) // 10,000 token
  const result = strategy(2000).execute([system, huge])

  assert.equal(result.trimmed, true, '内容被截短了，必须报「裁过」')
  assert.equal(result.rewrote, true)
  const tokens = ContextManagementService.estimateTotalTokens(result.messages)
  assert.ok(tokens <= 2000 + 3000, `除系统块外必须收在上限内，实际 ${tokens}`)
  assert.ok(tokens < 3000 + 10_000, '确实截短了，不是原样放行')
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
