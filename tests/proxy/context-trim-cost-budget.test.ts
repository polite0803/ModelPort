/**
 * 成本目标（`costBudgetByProvider`）与窗口预算是**两个问题、两个数**。
 *
 * 起因：把裁剪预算改成「模型自己的标注优先」之后，trae 那类渠道的按渠道上限
 * （65,536）就不再约束了 —— 它 32 个模型里 30 个声明了 ≥65,536 的窗口，最大的
 * 1M，于是 prompt 体量最多涨 15 倍。而 65,536 当初写下去的理由是**成本**（trae
 * 的积分耗几乎全由 prompt 体量决定，且拿不到前缀缓存），不是窗口正确性。
 *
 * 所以把它们分开：
 *   - 窗口 = 上游事实（模型标注 → 档位 → 渠道/全局），超了是 `context` 400；
 *   - 成本目标 = 我们自己的开销上限，只能把窗口**收紧**，永不放松。
 *
 * 但成本目标是我们的选择，因此**结构上不许**造出「够不到的 cap」—— 2026-11-16
 * 那个缺陷的唯一形状。三条断言：
 *   1. 目标装不下最小可用量（system + 任务预留 + 可用尾部）时，退回窗口并告警；
 *   2. 目标能装上时，它就是实际预算；
 *   3. 目标比窗口大时无效 —— 它不能把请求放大到上游会拒的尺寸。
 *
 * 纯逻辑层（`budgetFor` 是 `TokenLimitStrategy` 的私有方法，经 `execute` 观察）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  TokenLimitStrategy,
  normalizeContextManagementConfig,
} from '../../src/main/proxy/services/contextManagementService.ts'

/** `estimateTokens` 把 CJK 按 1.5 字符/token、其余按 3 计价；这里都用 ASCII 便于度量。 */
const chars = (tokens: number) => 'a'.repeat(tokens * 3)

const message = (role: string, tokens: number) => ({ role, content: chars(tokens) })

/** 一份「系统块 + 两条历史 + 一条新指令」的会话。 */
function conversation(systemTokens: number, historyTokens: number[], newestTokens: number) {
  return [
    message('system', systemTokens),
    ...historyTokens.map(tokens => message('user', tokens)),
    message('user', newestTokens),
  ]
}

/** 数一个结果里一共有多少 token（与策略内部同一把尺）。 */
function totalTokens(messages: { content: string }[]): number {
  return messages.reduce((sum, item) => sum + Math.ceil(item.content.length / 3), 0)
}

const strategy = (maxTokens: number, costBudget?: number) =>
  new TokenLimitStrategy({
    enabled: true,
    maxTokens,
    ...(costBudget === undefined ? {} : { costBudget }),
  })

test('成本目标装得下时生效：预算按目标裁剪，不是按窗口', () => {
  // 窗口 200K，成本目标 10K：系统 2K + 任务预留 1K + 尾部 256 的小账之后，
  // 目标仍然可兑付（3338 < 10000），所以它说了算。会话 22K 必须被裁到 10K。
  const messages = conversation(2_000, [1_000, 1_000], 18_000)
  const result = strategy(200_000, 10_000).execute(messages as never)

  assert.equal(result.trimmed, true, '目标小于会话体量，必须真的裁')
  const total = totalTokens(result.messages as never)
  assert.ok(total <= 10_000, `裁剪后 ${total} 应落在成本目标 10000 内`)
  assert.ok(total > 0, '不能裁成空历史')
})

test('任务预留算进最小可用量：首条 user 很大时小目标被拒，不是硬裁', () => {
  // 首条 user 20K（Codex 把 AGENTS.md 当第一条 user 注入就是这个形状）+ 系统 2K，
  // 最小可用量已经 22K+，10K 目标无论如何兑现不了。拒绝并退回窗口是对的：
  // 硬兑现只能靠丢掉那条任务声明。
  const messages = conversation(2_000, [20_000, 20_000], 18_000)
  const result = strategy(200_000, 10_000).execute(messages as never)
  assert.equal(result.trimmed, false, '窗口 200K 装得下 60K，拒绝成本目标后无需裁剪')
})

test('目标装不下最小可用量 → 退回窗口，不丢对话（2026-11-16 的形状）', () => {
  // 系统块 65,880 是那天的现网读数；成本目标 65,536 比它还小。
  // 若照字面兑现，availableTokens 为负 → 整段对话被丢弃 → 客户端读成语言跳变。
  const messages = conversation(65_880, [200, 200], 300)
  const result = strategy(1_000_000, 65_536).execute(messages as never)

  assert.equal(result.trimmed, false, '窗口装得下，成本目标被拒绝，不该裁任何东西')
  assert.deepEqual(result.messages, messages, '原样返回 —— 既不丢历史也不造残句')
})

test('目标恰好等于窗口时不算成本闸（不产生第二套口径）', () => {
  const messages = conversation(1_000, [20_000], 500)
  const result = strategy(50_000, 50_000).execute(messages as never)
  assert.equal(result.trimmed, false, '目标 ≥ 窗口 → 窗口说了算，会话装得下就不动')
})

test('目标大于窗口时无效：成本闸只能收紧，不能把请求放大', () => {
  // 窗口 8K（上游只收这么多），成本目标写成 500K。会话 10.5K 超窗口但远低于目标：
  // 若成本目标能放宽，它会原样发出去撞上游 context 400。走的必须是**普通分支**
  // （任务预留装得下），才证明是窗口在约束。
  const messages = conversation(500, [4_000, 4_000], 2_000)
  const result = strategy(8_000, 500_000).execute(messages as never)

  assert.equal(result.trimmed, true)
  const total = totalTokens(result.messages as never)
  assert.ok(total <= 8_000, `裁剪后 ${total} 必须落在窗口 8000 内，成本目标不能放宽它`)
  assert.ok(total > 2_000, '尾部那条 2000 token 的新指令必须完整保留')
})

test('没有成本目标 → 行为与只有窗口时完全一致', () => {
  const messages = conversation(1_000, [20_000, 20_000], 18_000)
  const withWindowOnly = strategy(200_000).execute(messages as never)
  assert.equal(withWindowOnly.trimmed, false, '60K 会话在 200K 窗口里装得下')
})

test('归一化：坏值丢弃而不是变成 0（0 会把历史裁到只剩最新一条）', () => {
  const config = normalizeContextManagementConfig({
    enabled: true,
    strategies: {
      tokenLimit: {
        enabled: true,
        maxTokens: 1000,
        costBudgetByProvider: {
          ' trae ': 5000,
          zero: 0,
          negative: -1,
          nan: Number.NaN,
          text: 'abc' as never,
          frac: 1234.9,
          '': 999,
        },
      },
    },
    executionOrder: ['tokenLimit'],
  } as never)
  assert.deepEqual(config.strategies.tokenLimit.costBudgetByProvider, {
    trae: 5000,
    frac: 1234,
  })
})

test('归一化：成本目标是解析值不在盘上（防止一格错配到别家渠道）', () => {
  const config = normalizeContextManagementConfig({
    enabled: true,
    strategies: {
      tokenLimit: { enabled: true, maxTokens: 1000, costBudget: 50_000 },
    },
    executionOrder: ['tokenLimit'],
  } as never)
  assert.equal('costBudget' in config.strategies.tokenLimit, false)
})