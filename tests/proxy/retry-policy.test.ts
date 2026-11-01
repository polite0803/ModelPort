/**
 * 转发重试预算的回归测试（纯函数，无 electron、无网络、无定时器）。
 *
 * 要钉住的是**两类 provider 的不对称**与**只下调**这一条方向：
 * 账号渠道的排队 / 额度 / 换号退避已经在渠道 Worker 里跑过一轮，宿主再按
 * 内建端点那套 `5s × retryCount` 叠加，就是用户体感的双重等待。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ACCOUNT_CHANNEL_MAX_RETRIES,
  ACCOUNT_CHANNEL_RETRY_DELAY_MS,
  DEFAULT_FIRST_EVENT_TIMEOUT_MS,
  DEFAULT_FORWARD_RETRY_DELAY_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  planAttemptDeadline,
  planForwardRetries,
  planRequestDeadlines,
} from '../../src/main/proxy/retryPolicy.ts'

test('账号渠道只额外试一次，且用短退避', () => {
  const profile = planForwardRetries('account', 3)
  assert.deepEqual(profile, { maxRetries: ACCOUNT_CHANNEL_MAX_RETRIES, retryDelayMs: ACCOUNT_CHANNEL_RETRY_DELAY_MS })
})

test('其余 provider 保持历史预算（这次改动不许顺手改它们）', () => {
  for (const type of ['builtin', 'aggregate', 'custom'] as const) {
    const profile = planForwardRetries(type, 3)
    assert.deepEqual(profile, { maxRetries: 3, retryDelayMs: DEFAULT_FORWARD_RETRY_DELAY_MS })
  }
})

test('调用方显式给的预算只下调、绝不上调', () => {
  // `forwardAutoCompletion` / 链式转发传 `{ maxRetries: 0 }`：那是一句指令
  // （候选链上每个供应商只打一次，失败就换下一个），被上调成 1 会让整条链
  // 的等待翻倍，并且违背"失败立即换候选"的设计。
  assert.equal(planForwardRetries('account', 0).maxRetries, 0)
  assert.equal(planForwardRetries('builtin', 0).maxRetries, 0)
  // 账号渠道被封顶到 1，但用户配得更小时以用户为准。
  assert.equal(planForwardRetries('account', 1).maxRetries, 1)
  assert.equal(planForwardRetries('account', 5).maxRetries, ACCOUNT_CHANNEL_MAX_RETRIES)
})

test('两类的间隔必须保持不对称（"统一成一套"得先改掉这条）', () => {
  assert.ok(
    ACCOUNT_CHANNEL_RETRY_DELAY_MS < DEFAULT_FORWARD_RETRY_DELAY_MS,
    '账号渠道的宿主层退避必须短于内建端点：渠道内部已有自己的排队/超时退避',
  )
})

test('非法预算按 0 处理，而不是悄悄回落到默认 3 次', () => {
  // 回落成"看起来合理的默认值"是最坏的一种容错：`retryCount` 被写成 `NaN`
  // 时用户以为重试已关，实际每次失败仍在睡 5 秒。
  for (const bad of [Number.NaN, -1, undefined, null, 'x']) {
    assert.equal(planForwardRetries('builtin', bad as number).maxRetries, 0, `bad=${String(bad)}`)
    assert.equal(planForwardRetries('account', bad as number).maxRetries, 0)
  }
})

test('最坏情况的可加等待：账号渠道从 15 秒降到 0.5 秒', () => {
  // 这个数字本身就是这次改动的理由，写成断言是为了让"重新统一成一套"的
  // 编辑必须显式地改掉它，而不是顺手改完没人发现。
  const before = 3 * DEFAULT_FORWARD_RETRY_DELAY_MS
  const after = planForwardRetries('account', 3)
  assert.equal(before, 15_000)
  assert.equal(after.maxRetries * after.retryDelayMs, 500)
})

/**
 * 等待侧（2026-11-01，192.168.85.131 实测驱动）。
 *
 * 四条值各自钉一条**方向**，而不是钉四个数：
 * - 非流式必须**有界**（原先是 `0`＝永不超时，实测单笔 525s）；
 * - 不得比改动前**更短**（HTTP 侧今天吃 `status.ts` 的 120s 字面量，
 *   已安装实例存的请求超时却是 60s，直接照抄会把能成的请求砍失败）；
 * - 渠道内部排队必须**早于**宿主截止（让渠道自己答「排队」）；
 * - 流式首事件在默认配置下必须**不变**（60s）。
 */
test('默认配置下四条等待值各自的取值', () => {
  assert.deepEqual(planRequestDeadlines(undefined), {
    completeMs: 120_000,
    firstEventMs: DEFAULT_FIRST_EVENT_TIMEOUT_MS,
    idleMs: DEFAULT_FIRST_EVENT_TIMEOUT_MS,
    packQueueMs: 110_000,
  })
  // 显式写默认值与「没给」必须同解：已安装实例存的就是这个数。
  assert.deepEqual(planRequestDeadlines(DEFAULT_REQUEST_TIMEOUT_MS), planRequestDeadlines(undefined))
})

test('非流式等待有下界：把请求超时调小不会砍掉今天能成的 HTTP 请求', () => {
  // 20s 的旋钮：流式按 20s 收紧（用户要的是快失败），非流式仍停在 120s 下限。
  const plan = planRequestDeadlines(20_000)
  assert.equal(plan.completeMs, 120_000)
  assert.equal(plan.firstEventMs, 20_000)
  assert.equal(plan.idleMs, 20_000)
  assert.ok(plan.packQueueMs < plan.completeMs, '排队预算必须早于宿主截止，否则渠道永远来不及答「排队」')
})

test('把请求超时调到上限时四条值一起放宽', () => {
  const plan = planRequestDeadlines(300_000)
  assert.equal(plan.completeMs, 300_000)
  assert.equal(plan.packQueueMs, 290_000)
  // 首事件不跟着涨：再长的沉默也该按假死对待（判据理由见 failover 的头注释）。
  assert.equal(plan.firstEventMs, DEFAULT_FIRST_EVENT_TIMEOUT_MS)
  assert.equal(plan.idleMs, DEFAULT_FIRST_EVENT_TIMEOUT_MS)
})

test('块间静默有自己的下限，不跟随极小的旋钮', () => {
  // 推理模型可以合理地沉默几十秒；把「请求超时 1s」翻译成「1s 没出声就掐流」
  // 会掐死每一个思考型渠道。首事件仍按旋钮走（那里没有半途掐断的代价）。
  const plan = planRequestDeadlines(1_000)
  assert.equal(plan.firstEventMs, 1_000)
  assert.equal(plan.idleMs, 15_000)
})

test('非法的请求超时不产生非法等待', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    const plan = planRequestDeadlines(bad)
    assert.deepEqual(plan, planRequestDeadlines(undefined), `非法值 ${String(bad)} 应退回默认计划`)
  }
  // 负数读成「下界」而不是「默认」：仍是有限、正、可用的数。
  const negative = planRequestDeadlines(-5)
  assert.equal(negative.completeMs, 120_000)
  assert.equal(negative.firstEventMs, 1_000)
})

test('墙钟预算折算成单次截止：既不超过计划值也不低于下限', () => {
  const base = { completeMs: 120_000, budgetMs: 90_000 }
  assert.equal(planAttemptDeadline({ ...base, elapsedMs: 0 }), 90_000)
  assert.equal(planAttemptDeadline({ ...base, elapsedMs: 80_000 }), 10_000)
  // 预算已被前置步骤（预检/已试候选）吃光时给下限，而不是 0 —— 给 0 等于
  // 「这一家必然超时」，会把换家变成假失败。
  assert.equal(planAttemptDeadline({ ...base, elapsedMs: 95_000 }), 5_000)
  // 也永远不放宽到计划值以上（旋钮 30s 时不该等到 90s）。
  assert.equal(planAttemptDeadline({ completeMs: 30_000, elapsedMs: 0, budgetMs: 90_000 }), 30_000)
})
