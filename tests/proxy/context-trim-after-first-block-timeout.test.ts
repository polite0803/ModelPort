/**
 * 撞过首块超时的通道：预填充预算收紧成**窗口**，而不是 `costBudget`。
 *
 * 回归背景（2026-11-18）。Codex 会把整段会话裸发过来（客户端 catalog 没有窗口时
 * 它自己不做压缩），现网一笔 38 万 token 的请求打到 loomy/GLM-5.3-Flash 上连续
 * 19 次首块超时、一个字节都没吐；同一天 10 万以内的请求有成功读数（上限 106,826），
 * 200k 以上的成功 0 条。
 *
 * 为什么必须是窗口：`costBudgetByProvider` 装不下 system + 任务预留 + 256 token
 * 尾巴时会被 `budgetFor` **拒掉**并退回原窗口（2026-11-16 的丢对话分支），也就是
 * 什么都没收紧。窗口直接参与 `resolveTrimBudget`，没有这条退路。
 *
 * 判据是方向而不是某个数字：给了 10 万窗口，输出就必须 ≤ 10 万；给 1M 窗口时同一
 * 份输入一个字都不该动（负控——否则「裁了」可能来自别的分支）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ContextManagementService,
  createContextManagementService,
  PREFILL_SAFE_WINDOW_TOKENS,
} from '../../src/main/proxy/services/contextManagementService.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const cjk = (role: ChatMessage['role'], chars: number): ChatMessage =>
  ({ role, content: '这是一条很长的中文历史内容，包含代码片段、工具输出与重复的上下文。'.repeat(Math.ceil(chars / 30)).slice(0, chars) }) as ChatMessage

const est = (messages: ChatMessage[]) => ContextManagementService.estimateTotalTokens(messages)

const config = {
  enabled: true,
  strategies: {
    slidingWindow: { enabled: false },
    tokenLimit: { enabled: true, maxTokens: 65_536 },
  },
  executionOrder: ['slidingWindow', 'tokenLimit'] as const,
}

/** ≈ 380k token：20 条各约 19k token，外加一条最新的 user 指令。 */
function hugeConversation(): ChatMessage[] {
  const history: ChatMessage[] = []
  for (let i = 0; i < 20; i++) history.push(cjk(i % 2 === 0 ? 'user' : 'assistant', 28_500))
  history.push({ role: 'user', content: '现在把剩下的活干完。' } as ChatMessage)
  return history
}

test('负控：同一个 38 万 token 的会话说窗口 1M 时不裁', async () => {
  const messages = hugeConversation()
  assert.ok(est(messages) > 350_000, `前置：这份输入必须真的超过 35 万 token，实测 ${est(messages)}`)

  const service = createContextManagementService(config, 'loomy', 1_000_000)
  const result = await service.process(messages)
  assert.equal(result.changed, false, '1M 窗口下 38 万装得下，不该动一个字节')
  assert.equal(est(result.messages), est(messages))
})

test('撞过首块超时的通道：窗口收紧到安全线后，输出落在窗口内且保留最新指令', async () => {
  const messages = hugeConversation()

  const service = createContextManagementService(config, 'loomy', PREFILL_SAFE_WINDOW_TOKENS)
  const result = await service.process(messages)

  assert.equal(result.changed, true, '38 万 > 10 万，必须真的裁')
  assert.ok(
    est(result.messages) <= PREFILL_SAFE_WINDOW_TOKENS,
    `输出必须落在窗口内，实测 ${est(result.messages)}`,
  )
  assert.ok(result.finalCount > 0, '裁断不许清空历史')
  assert.equal(
    result.messages[result.messages.length - 1]?.content,
    '现在把剩下的活干完。',
    '最新一条非 system 消息必须保留（messages: [] 会被上游拒）',
  )
})