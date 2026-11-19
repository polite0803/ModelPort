/**
 * 上下文 400 的两条救场路径（用户报障 2026-11-19）。
 *
 * 现网读数：`daily` 对外公布 1,000,000（上一轮服务的是 1M 模型），本轮该模型被
 * 限流跳过，评分派给 `modelscope/Qwen/Qwen3.5-35B-A3B`（目录 262,144）。网关估计
 * 255,812（ASCII 4 字符/token，偏低），判「fits」；上游回
 * `<400> InternalError.Algo.InvalidParameter: Range of input length should be
 * [1, 258048]`。原先这条报文不命中任何 overflow 判据 ⇒ 通用 400 终止 ⇒ 原样透传。
 *
 * 本文件钉住三件事：
 * 1. 报文形状被识别，并取回上游给的区间上界（不猜比例）；
 * 2. `(provider, 模型)` 的亲口上界被记住、会过期、互不串；
 * 3. `planContextTrim` 的四个入口（点名渠道 / 承诺大于实际 / 实测上界 / 本轮强制），
 *    以及一个行为负控：1M 窗口下同一份输入一个字都不动。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isContextOverflowError,
  measuredContextLimitFromError,
} from '../../src/main/proxy/failover.ts'
import {
  clearMeasuredContextLimits,
  measuredContextLimitOf,
  recordMeasuredContextLimit,
  recordMeasuredContextLimitFromError,
} from '../../src/main/proxy/contextOverflowLimits.ts'
import {
  ContextManagementService,
  createContextManagementService,
  normalizeContextManagementConfig,
  planContextTrim,
} from '../../src/main/proxy/services/contextManagementService.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const MODELSCOPE_400 =
  '<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 258048] [request_id: chatcmpl-mwn0w0pn-9jaih1]'

test('识别 ModelScope 的区间报文；无关 400 不受影响', () => {
  assert.equal(isContextOverflowError(MODELSCOPE_400), true)
  assert.equal(
    isContextOverflowError('InternalError.Algo.InvalidParameter: Range of temperature should be [0, 2]'),
    false,
  )
  assert.equal(isContextOverflowError('invalid_request_error: model not found'), false)
})

test('从报文里取回区间上界；没有区间的报文不返回数', () => {
  assert.equal(measuredContextLimitFromError(MODELSCOPE_400), 258_048)
  assert.equal(
    measuredContextLimitFromError('Range of input length should be [ 1 , 4096 ]'),
    4096,
  )
  assert.equal(measuredContextLimitFromError('maximum context length is 8192 tokens'), undefined)
  assert.equal(measuredContextLimitFromError(undefined), undefined)
})

test('亲口上界按 (provider, 模型) 记：互不串、过了 TTL 失效', () => {
  clearMeasuredContextLimits()
  const t0 = 1_000_000
  assert.equal(recordMeasuredContextLimitFromError('modelscope', 'Qwen/Qwen3.5-35B-A3B', MODELSCOPE_400, t0), true)
  recordMeasuredContextLimit('modelscope', 'MiniMax/MiniMax-M3', 1_000_000, t0)

  assert.equal(measuredContextLimitOf('modelscope', 'Qwen/Qwen3.5-35B-A3B', t0 + 1), 258_048)
  assert.equal(measuredContextLimitOf('modelscope', 'MiniMax/MiniMax-M3', t0 + 1), 1_000_000)
  assert.equal(measuredContextLimitOf('trae', 'Qwen/Qwen3.5-35B-A3B', t0 + 1), undefined)

  const dayLater = t0 + 24 * 60 * 60 * 1000 + 1
  assert.equal(measuredContextLimitOf('modelscope', 'Qwen/Qwen3.5-35B-A3B', dayLater), undefined)
  clearMeasuredContextLimits()
})

test('planContextTrim：点名渠道仍是老路径，预算交给调用方', () => {
  const config = normalizeContextManagementConfig({
    enabled: true,
    channelIds: ['trae'],
    strategies: {},
    executionOrder: [],
  })
  const plan = planContextTrim({ config, providerId: 'trae' })
  assert.deepEqual(plan, { applies: true, reason: 'whitelist' })
})

test('planContextTrim：承诺大于这一跳模型窗口时就地裁（免 400 的主路径）', () => {
  const config = normalizeContextManagementConfig({
    enabled: true,
    channelIds: ['trae', 'loomy'],
    strategies: {},
    executionOrder: [],
  })
  const plan = planContextTrim({
    config,
    providerId: 'modelscope',
    advertisedContextWindow: 1_000_000,
    knownContextWindow: 262_144,
  })
  assert.equal(plan.applies, true)
  assert.equal(plan.reason, 'below-advertised')
  assert.equal(plan.budget, 262_144)
})

test('planContextTrim：承诺与实际相等（或未公布）时不越界裁剪', () => {
  const config = normalizeContextManagementConfig({
    enabled: true,
    channelIds: ['trae'],
    strategies: {},
    executionOrder: [],
  })
  assert.deepEqual(
    planContextTrim({ config, providerId: 'modelscope', advertisedContextWindow: 262_144, knownContextWindow: 262_144 }),
    { applies: false, reason: 'off' },
  )
  assert.deepEqual(
    planContextTrim({ config, providerId: 'modelscope', knownContextWindow: 262_144 }),
    { applies: false, reason: 'off' },
  )
})

test('planContextTrim：实测上界优先，且与已知窗口取小', () => {
  const config = normalizeContextManagementConfig({
    enabled: true,
    channelIds: ['trae'],
    strategies: {},
    executionOrder: [],
  })
  const plan = planContextTrim({
    config,
    providerId: 'modelscope',
    advertisedContextWindow: 1_000_000,
    knownContextWindow: 262_144,
    measuredContextLimit: 258_048,
  })
  assert.equal(plan.applies, true)
  assert.equal(plan.reason, 'measured-limit')
  assert.equal(plan.budget, 258_048)

  // 已知窗口比实测上界还小 ⇒ 取更紧的那个
  const tighter = planContextTrim({
    config,
    providerId: 'modelscope',
    knownContextWindow: 200_000,
    measuredContextLimit: 258_048,
  })
  assert.equal(tighter.budget, 200_000)
})

test('planContextTrim：本轮强制预算压过一切，但仍与已知窗口取小', () => {
  const config = normalizeContextManagementConfig({
    enabled: true,
    channelIds: [],
    strategies: {},
    executionOrder: [],
  })
  const plan = planContextTrim({
    config,
    providerId: 'modelscope',
    knownContextWindow: 200_000,
    forcedContextLimit: 258_048,
  })
  assert.deepEqual(plan, { applies: true, budget: 200_000, reason: 'forced' })
})

test('planContextTrim：enabled:false 一票否决（用户明确关掉的开关）', () => {
  const config = normalizeContextManagementConfig({
    enabled: false,
    channelIds: ['trae'],
    strategies: {},
    executionOrder: [],
  })
  assert.deepEqual(planContextTrim({ config, providerId: 'trae' }), { applies: false, reason: 'off' })
  assert.deepEqual(
    planContextTrim({ config, providerId: 'modelscope', measuredContextLimit: 258_048, forcedContextLimit: 258_048 }),
    { applies: false, reason: 'off' },
  )
})

/** ≈ 35 万 token（按裁剪器自己的保守估计）：40 条各 2.5 万 ASCII 字符的历史 + 最新指令。 */
function oversizedConversation(): ChatMessage[] {
  const history: ChatMessage[] = []
  for (let i = 0; i < 40; i += 1) {
    history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(25_000) } as ChatMessage)
  }
  history.push({ role: 'user', content: '现在把剩下的活干完，保留这一条指令。' } as ChatMessage)
  return history
}

const trimConfig = normalizeContextManagementConfig({
  enabled: true,
  channelIds: ['trae', 'loomy'],
  strategies: {
    slidingWindow: { enabled: false },
    tokenLimit: { enabled: true, maxTokens: 65_536 },
  },
  executionOrder: ['slidingWindow', 'tokenLimit'],
})

test('行为：按实测上界裁后落在窗口内，且最新指令还在', async () => {
  const messages = oversizedConversation()
  const before = ContextManagementService.estimateTotalTokens(messages)
  assert.ok(before > 258_048, `前置：这份输入必须真的超过上界，实测 ${before}`)

  const plan = planContextTrim({
    config: trimConfig,
    providerId: 'modelscope',
    advertisedContextWindow: 1_000_000,
    knownContextWindow: 262_144,
    measuredContextLimit: 258_048,
  })
  assert.equal(plan.budget, 258_048)

  const service = createContextManagementService(trimConfig, 'modelscope', plan.budget)
  const result = await service.process(messages)
  assert.equal(result.changed, true, '超过上界必须真的裁')
  assert.ok(
    ContextManagementService.estimateTotalTokens(result.messages) <= 258_048,
    `输出必须落在上界内，实测 ${ContextManagementService.estimateTotalTokens(result.messages)}`,
  )
  assert.ok(result.finalCount > 0, '裁断不许清空历史')
  assert.ok(
    result.messages.some(msg => String(msg.content).includes('现在把剩下的活干完')),
    '最新的用户指令必须保留',
  )
})

test('负控：同一份输入在 1M 窗口下一个字节都不动', async () => {
  const messages = oversizedConversation()
  const before = ContextManagementService.estimateTotalTokens(messages)
  const service = createContextManagementService(trimConfig, 'modelscope', 1_000_000)
  const result = await service.process(messages)
  assert.equal(result.changed, false)
  assert.equal(ContextManagementService.estimateTotalTokens(result.messages), before)
})