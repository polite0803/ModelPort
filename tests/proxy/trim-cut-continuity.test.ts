/**
 * 前缀契约（L2）：裁剪点必须跨轮「续得上」，而不是每轮重算一次。
 *
 * 证的是三件事：
 * 1. 上一轮记住的起点装得下时，这一轮沿用它 —— 头部不动，序列化才是上一轮的追加；
 * 2. 装不下时**一次多让出 5% 余量**：之后几轮的增长都在余量里走完，断裂被摊薄；
 * 3. 客户端改写历史（下标还在、内容已换）时不沿用 —— 指纹挡住它。
 *
 * 纯函数层，无 store、无网络。口径说明：策略会额外保留「首条 user 任务陈述」，
 * 所以结果里的第一条非 system 消息未必是窗口起点；锚点一律按 `cut.start` 断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TokenLimitStrategy, DEFAULT_TOKEN_LIMIT_CONFIG } from '../../src/main/proxy/services/contextManagementService.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const BUDGET = 10_000
const PER_MESSAGE_TOKENS = 100

const msg = (id: number): ChatMessage =>
  ({ role: 'user', content: String(id).padStart(4, '0') + 'x'.repeat(296) }) as ChatMessage

const history = (count: number): ChatMessage[] => Array.from({ length: count }, (_, index) => msg(index))

const strategy = (): TokenLimitStrategy =>
  new TokenLimitStrategy({ ...DEFAULT_TOKEN_LIMIT_CONFIG, enabled: true, maxTokens: BUDGET })

const nonSystem = (messages: ChatMessage[]): ChatMessage[] => messages.filter(message => message.role !== 'system')

test('装得下就沿用上一轮的起点：这一轮是上一轮的追加', () => {
  const turn1 = strategy().execute(history(120))
  const cut1 = turn1.cut
  assert.ok(cut1 !== undefined)

  // 追加两条（200 token）后仍在余量里：起点不许动。
  const turn2 = strategy().execute(history(122), cut1)
  assert.ok(turn2.cut !== undefined)
  assert.equal(turn2.cut.start, cut1.start, '装得下却换了起点 = 这一轮前缀全断')
  // 窗口内的第一条仍是同一条输入消息。
  assert.equal(nonSystem(turn2.messages)[1]?.content, history(122)[cut1.start]?.content)
})

test('装不下时一次多让出余量：接下来几轮都不再断', () => {
  const turn1 = strategy().execute(history(120))
  const firstStart = turn1.cut?.start
  assert.ok(firstStart !== undefined)

  let cut = turn1.cut
  let stableTurns = 0
  // 每轮追加一条：直到再次装不下为止，起点必须一直不动。
  for (let count = 121; count <= 128; count += 1) {
    const turn = strategy().execute(history(count), cut)
    if (turn.cut?.start === firstStart) {
      stableTurns += 1
      cut = turn.cut
      continue
    }
    assert.ok(
      (turn.cut?.start ?? 0) > firstStart + 1,
      `前移只挪了一格（${firstStart} -> ${turn.cut?.start}），余量没有生效`
    )
    cut = turn.cut
    break
  }
  assert.ok(stableTurns >= 2, `余量只换到 ${stableTurns} 轮稳定，摊薄没有发生`)
})

test('同一输入重复处理：裁剪点逐字相同（幂等）', () => {
  const first = strategy().execute(history(120))
  const second = strategy().execute(history(120), first.cut)
  assert.deepEqual(second.cut, first.cut)
})

test('客户端改写历史：下标还在、内容已换 ⇒ 不沿用指纹，重新前移', () => {
  const turn1 = strategy().execute(history(120))
  const cut1 = turn1.cut
  assert.ok(cut1 !== undefined)

  const rewritten = history(122)
  rewritten[cut1.start] = { role: 'user', content: 'zzzz' + 'y'.repeat(296) } as ChatMessage

  const turn2 = strategy().execute(rewritten, cut1)
  assert.ok(turn2.cut !== undefined)
  assert.notEqual(turn2.cut.start, cut1.start, '内容已换却沿用旧起点 = 发出一份自相矛盾的前缀')
  assert.equal(nonSystem(turn2.messages)[1]?.content, rewritten[turn2.cut.start]?.content)
})

test('系统消息不参与起点下标：窗口仍是输入里的连续段', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 's'.repeat(300) } as ChatMessage,
    ...history(120),
  ]
  const result = strategy().execute(messages)
  assert.ok(result.cut !== undefined)
  // 结果 = [首条 user 任务陈述] + 输入里从 cut.start 起的连续段。
  const kept = nonSystem(result.messages)
  const window = kept.slice(1)
  const expected = messages.slice(1 + result.cut.start)
  assert.deepEqual(window.map(m => m.content), expected.map(m => m.content))
})

test('前移后窗口不缩水超过余量本身', () => {
  const result = strategy().execute(history(120))
  assert.ok(result.cut !== undefined)
  const kept = nonSystem(result.messages).length
  assert.ok(kept * PER_MESSAGE_TOKENS <= BUDGET)
  assert.ok(kept * PER_MESSAGE_TOKENS >= BUDGET * 0.9, '余量不该大到把窗口砍掉一成以上')
})