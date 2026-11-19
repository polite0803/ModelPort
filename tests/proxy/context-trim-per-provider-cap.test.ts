/**
 * 按渠道的 token 上限（`maxTokensByProvider`）。
 *
 * 缺口：裁剪**作用域**是按渠道的（`channelIds`），但**上限**曾是一个全局数。于是
 * 同一份作用域里的两条渠道无法分别定界 —— trae 必须小（积分耗几乎全由 prompt 体量
 * 决定，且它拿不到前缀缓存，2026-11-10 拍板 107K→67K），而 AFP 计费的订阅套餐对
 * 缓存命中按全价输入收费（官方抵扣表无缓存折扣行），需要大得多的窗口才能保住
 * agent 会话的连贯性。2026-11-15 现网：火山 Agent Plan 每笔重发 73–91 万 token，
 * 69 AFP/笔，Medium 档 10,000 AFP 的 5 小时窗只够 ~145 笔。
 *
 * 判据：缺省＝沿用全局值（既有调用方零行为变化）；点名渠道用覆盖值；坏值丢弃而
 * **不是**回落成 0（0 会把历史裁到只剩最新一条）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ContextManagementService,
  createContextManagementService,
  normalizeContextManagementConfig,
} from '../../src/main/proxy/services/contextManagementService.ts'

const base = { enabled: true, strategies: {}, executionOrder: [] as never[] }

test('归一化：只收正有限数，去空白键；坏值丢弃而不是变成 0', () => {
  const config = normalizeContextManagementConfig({
    ...base,
    strategies: {
      tokenLimit: {
        enabled: true,
        maxTokens: 1000,
        maxTokensByProvider: {
          ' plan ': 5000,
          trae: 65536,
          zero: 0,
          negative: -1,
          nan: Number.NaN,
          text: 'abc' as never,
          '': 999,
          frac: 1234.9,
        },
      },
    },
  } as never)
  assert.deepEqual(config.strategies.tokenLimit.maxTokensByProvider, {
    plan: 5000,
    trae: 65536,
    frac: 1234,
  })
  assert.equal(config.strategies.tokenLimit.maxTokens, 1000, '全局值不被覆盖表改动')
})

test('归一化：缺省/畸形覆盖表归一为空表，全局上限照常', () => {
  for (const raw of [undefined, null, 'plan' as never, 42 as never]) {
    const config = normalizeContextManagementConfig({
      ...base,
      strategies: { tokenLimit: { enabled: true, maxTokens: 1000, maxTokensByProvider: raw } },
    } as never)
    assert.deepEqual(config.strategies.tokenLimit.maxTokensByProvider, {})
    assert.equal(config.strategies.tokenLimit.maxTokens, 1000)
  }
})

/** 一段远超两个上限的历史：1 token ≈ 3 字符，40 × 600 字符 ≈ 8000 token。 */
function longHistory() {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: 'you are a helpful assistant' },
  ]
  for (let i = 0; i < 40; i++) {
    messages.push({ role: 'user', content: `q${i} ${'x'.repeat(600)}` })
    messages.push({ role: 'assistant', content: `a${i} ${'y'.repeat(600)}` })
  }
  return messages
}

const CONFIG = {
  enabled: true,
  channelIds: ['plan', 'trae'],
  executionOrder: ['tokenLimit'] as never[],
  strategies: {
    slidingWindow: { enabled: false, maxMessages: 40 },
    tokenLimit: { enabled: true, maxTokens: 1000, maxTokensByProvider: { plan: 5000 } },
  },
}

const tokensOf = (messages: { content: string }[]) =>
  ContextManagementService.estimateTotalTokens(messages as never)

test('点名渠道用覆盖值，未点名渠道用全局值，不传 providerId 也用全局值', async () => {
  const history = longHistory()
  assert.ok(tokensOf(history) > 5000, '前置：历史必须同时超过两个上限，否则这个测试没有分辨力')

  const plan = await createContextManagementService(CONFIG, 'plan').process(history as never)
  const trae = await createContextManagementService(CONFIG, 'trae').process(history as never)
  const legacy = await createContextManagementService(CONFIG).process(history as never)

  const planTokens = tokensOf(plan.messages)
  const traeTokens = tokensOf(trae.messages)
  const legacyTokens = tokensOf(legacy.messages)

  assert.ok(planTokens <= 5000, `plan 应被裁到 ≤5000，实际 ${planTokens}`)
  assert.ok(traeTokens <= 1000, `trae 应被裁到 ≤1000，实际 ${traeTokens}`)
  assert.equal(legacyTokens, traeTokens, '不传 providerId 的既有调用方行为不变')
  assert.ok(
    planTokens > traeTokens,
    `覆盖值必须真的生效：plan(${planTokens}) 应严格大于 trae(${traeTokens})；相等即覆盖被忽略`,
  )
})

test('覆盖值不是「不裁」：超过覆盖值的历史仍然被裁', async () => {
  const history = longHistory()
  const result = await createContextManagementService(CONFIG, 'plan').process(history as never)
  assert.ok(result.finalCount < result.originalCount, '必须真的删了消息，而不是原样放行')
  assert.ok(tokensOf(result.messages) <= 5000)
  // 最新一条永远保留（历史裁剪不得清空历史）
  const last = result.messages[result.messages.length - 1]
  assert.equal(last.content, history[history.length - 1].content)
})

test('覆盖表里没有这个渠道时回落全局值，不是回落到 0 或无穷', async () => {
  const history = longHistory()
  const other = await createContextManagementService(CONFIG, 'someone-else').process(history as never)
  const trae = await createContextManagementService(CONFIG, 'trae').process(history as never)
  assert.equal(tokensOf(other.messages), tokensOf(trae.messages))
  assert.ok(tokensOf(other.messages) > 0, '回落全局值而不是把历史裁空')
})

test('负控：抽掉覆盖表后 plan 与 trae 相等 —— 上面那条「严格大于」断言因此有分辨力', async () => {
  const history = longHistory()
  const noOverride = {
    ...CONFIG,
    strategies: {
      ...CONFIG.strategies,
      tokenLimit: { enabled: true, maxTokens: 1000 },
    },
  }
  const plan = await createContextManagementService(noOverride, 'plan').process(history as never)
  const trae = await createContextManagementService(noOverride, 'trae').process(history as never)
  assert.equal(
    tokensOf(plan.messages),
    tokensOf(trae.messages),
    '没有覆盖表时两者必须相同：若此格也「大于」，说明分辨断言恒真、没有测到覆盖',
  )
})

/**
 * 窗口覆盖表（`maxMessagesByProvider`）。
 *
 * slidingWindow 排在 tokenLimit **之前**，所以一个小的全局条数会先绑定，按渠道的
 * token 预算根本轮不到说话。2026-11-15 现网实测：火山 1452 条历史被全局 40 条砍到
 * 43 条，而它的 200k token 预算只用掉 80k —— 绑定的是条数，不是预算。
 */
const WINDOW_CONFIG = {
  enabled: true,
  channelIds: ['plan', 'trae'],
  executionOrder: ['slidingWindow', 'tokenLimit'] as never[],
  strategies: {
    slidingWindow: { enabled: true, maxMessages: 10, maxMessagesByProvider: { plan: 60 } },
    tokenLimit: { enabled: true, maxTokens: 100000 },
  },
}

test('窗口覆盖：点名渠道保住更多历史，未点名渠道仍用全局条数', async () => {
  const history = longHistory()
  assert.ok(history.length > 60, '前置：历史必须长于两个窗口，否则这个测试没有分辨力')

  const plan = await createContextManagementService(WINDOW_CONFIG, 'plan').process(history as never)
  const trae = await createContextManagementService(WINDOW_CONFIG, 'trae').process(history as never)

  assert.ok(
    plan.finalCount > trae.finalCount,
    `plan(${plan.finalCount}) 应严格多于 trae(${trae.finalCount})；相等即窗口覆盖被忽略`,
  )
  // 上界留出 keepToolGroupAndTask 补回任务原文/tool 组的余量。
  assert.ok(plan.finalCount <= 62, `plan 应受 60 条窗口约束，实际 ${plan.finalCount}`)
  assert.ok(trae.finalCount <= 12, `trae 应受全局 10 条窗口约束，实际 ${trae.finalCount}`)
})

test('负控：抽掉窗口覆盖表后两者条数相等 —— 上面那条「严格多于」因此有分辨力', async () => {
  const history = longHistory()
  const noOverride = {
    ...WINDOW_CONFIG,
    strategies: {
      ...WINDOW_CONFIG.strategies,
      slidingWindow: { enabled: true, maxMessages: 10 },
    },
  }
  const plan = await createContextManagementService(noOverride, 'plan').process(history as never)
  const trae = await createContextManagementService(noOverride, 'trae').process(history as never)
  assert.equal(plan.finalCount, trae.finalCount)
})

test('窗口覆盖不解除 token 上限：两个覆盖同时生效，预算仍是最终约束', async () => {
  const history = longHistory()
  const both = {
    ...WINDOW_CONFIG,
    strategies: {
      slidingWindow: { enabled: true, maxMessages: 10, maxMessagesByProvider: { plan: 60 } },
      tokenLimit: { enabled: true, maxTokens: 500, maxTokensByProvider: { plan: 1000 } },
    },
  }
  const plan = await createContextManagementService(both, 'plan').process(history as never)
  assert.ok(tokensOf(plan.messages) <= 1000, `token 上限必须仍然绑定，实际 ${tokensOf(plan.messages)}`)
  assert.ok(plan.finalCount < 60, '窗口放宽后 tokenLimit 必须继续裁，而不是原样放行')
  assert.equal(
    plan.messages[plan.messages.length - 1].content,
    history[history.length - 1].content,
    '最新一条永远保留',
  )
})

test('归一化：窗口覆盖表同样只收正有限数，缺省/畸形归一为空表', () => {
  const config = normalizeContextManagementConfig({
    ...base,
    strategies: {
      slidingWindow: {
        enabled: true,
        maxMessages: 40,
        maxMessagesByProvider: { ' plan ': 200, zero: 0, negative: -3, frac: 199.9, text: 'x' as never },
      },
    },
  } as never)
  assert.deepEqual(config.strategies.slidingWindow.maxMessagesByProvider, { plan: 200, frac: 199 })
  assert.equal(config.strategies.slidingWindow.maxMessages, 40, '全局值不被覆盖表改动')

  for (const raw of [undefined, null, 'plan' as never, 42 as never]) {
    const c = normalizeContextManagementConfig({
      ...base,
      strategies: { slidingWindow: { enabled: true, maxMessages: 40, maxMessagesByProvider: raw } },
    } as never)
    assert.deepEqual(c.strategies.slidingWindow.maxMessagesByProvider, {})
  }
})