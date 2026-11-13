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
  FIRST_ATTEMPT_CAP_MS,
  MIN_REMAINING_FOR_NEXT_ATTEMPT_MS,
  planAttemptDeadline,
  planFirstEventWait,
  planRecoveryWaitMs,
  planForwardRetries,
  planRequestDeadlines,
  SINGLE_CANDIDATE_FIRST_EVENT_CAP_MS,
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

test('首轮切片上限只压低、不抬高（2026-11-12 用户裁定：不提高总预算，降低第一轮）', () => {
  const base = { completeMs: 90_000, budgetMs: 90_000 }
  // 首轮：预算充裕也只给 20s，把后面的等待与换家空间留出来
  assert.equal(planAttemptDeadline({ ...base, elapsedMs: 0, capMs: FIRST_ATTEMPT_CAP_MS }), 20_000)
  // 非首轮（不传 capMs）：维持原语义，逐字不变
  assert.equal(planAttemptDeadline({ ...base, elapsedMs: 0 }), 90_000)
  // 只压不抬：剩余预算本来就小于上限时，capMs 不该把它放大
  assert.equal(planAttemptDeadline({ ...base, elapsedMs: 80_000, capMs: FIRST_ATTEMPT_CAP_MS }), 10_000)
  // 预算归零时仍回下限，capMs 不改变这一点
  assert.equal(planAttemptDeadline({ ...base, elapsedMs: 95_000, capMs: FIRST_ATTEMPT_CAP_MS }), 5_000)
  // 出厂首事件等待是 60s，首轮压到 20s 才是「降低第一轮」
  assert.ok(FIRST_ATTEMPT_CAP_MS < DEFAULT_FIRST_EVENT_TIMEOUT_MS)
  assert.equal(FIRST_ATTEMPT_CAP_MS, 20_000)
})

test('没有换家空间的流式请求：首块等待压到 30s，并归因 single-candidate', () => {
  // 具名 provider 模型不走换家链（没有 attemptDeadlineMs）。客户端自己的耐心
  // 就是 60s（码道 2026-11-12：39 笔 codearts 失败全落在 57.3–61.1s），网关陪等
  // 60s 只会双双超时，用户拿到的是「客户端已断开」而不是渠道结论。
  assert.equal(SINGLE_CANDIDATE_FIRST_EVENT_CAP_MS, 30_000)
  assert.deepEqual(
    planFirstEventWait({ firstEventMs: DEFAULT_FIRST_EVENT_TIMEOUT_MS, deadlineMs: 120_000 }),
    { waitMs: 30_000, clampedBy: 'single-candidate' },
  )
  // 旋钮本来就更短时（请求超时 20s）不再加归因：那是用户设的值，不是这条上限
  assert.deepEqual(
    planFirstEventWait({ firstEventMs: 20_000, deadlineMs: 120_000 }),
    { waitMs: 20_000, clampedBy: 'none' },
  )
})

test('换家链里的首块等待沿用尝试截止，不叠 30s 上限', () => {
  // 首轮切片 20s 来自 planAttemptDeadline：归因必须是 attempt-budget，
  // 文案才能继续写「剩余墙钟预算」
  assert.deepEqual(
    planFirstEventWait({ firstEventMs: 60_000, deadlineMs: 120_000, attemptDeadlineMs: 20_000 }),
    { waitMs: 20_000, clampedBy: 'attempt-budget' },
  )
  // 非首轮拿到的是出厂 60s，不该被 30s 截断 —— 链里由墙钟预算收口
  assert.deepEqual(
    planFirstEventWait({ firstEventMs: 60_000, deadlineMs: 70_000, attemptDeadlineMs: 70_000 }),
    { waitMs: 60_000, clampedBy: 'none' },
  )
  // 链里有下家：实测再慢也不放宽 —— 换一家比等它便宜
  assert.deepEqual(
    planFirstEventWait({
      firstEventMs: 60_000,
      deadlineMs: 120_000,
      attemptDeadlineMs: 20_000,
      measuredFirstTokenMs: 24_600,
    }),
    { waitMs: 20_000, clampedBy: 'attempt-budget' },
  )
})

test('无下家时用该账号的实测首字放宽地板：30s 不再是天花板', () => {
  // 11-13 codearts 实测：成功首字 p50 28.5–30.4s、max 33–37s，长期均值约 24.6s。
  // 2×≈49s 覆盖观测上界，同时仍在客户端 ~60s 耐心之内。
  assert.deepEqual(
    planFirstEventWait({ firstEventMs: 60_000, deadlineMs: 120_000, measuredFirstTokenMs: 24_600 }),
    { waitMs: 49_200, clampedBy: 'single-candidate' },
  )
  // 快账号：2× 远低于地板，30s 仍然生效（放宽只上不下）
  assert.deepEqual(
    planFirstEventWait({ firstEventMs: 60_000, deadlineMs: 120_000, measuredFirstTokenMs: 2_000 }),
    { waitMs: 30_000, clampedBy: 'single-candidate' },
  )
  // 实测把上限推过出厂首事件上限时，由 firstEventMs 收口，不再算被这条规则压短
  assert.deepEqual(
    planFirstEventWait({ firstEventMs: 60_000, deadlineMs: 120_000, measuredFirstTokenMs: 40_000 }),
    { waitMs: 60_000, clampedBy: 'none' },
  )
  // 请求超时本来就短（用户设 25s）时以用户为准，实测不能把它拉长
  assert.deepEqual(
    planFirstEventWait({ firstEventMs: 25_000, deadlineMs: 120_000, measuredFirstTokenMs: 24_600 }),
    { waitMs: 25_000, clampedBy: 'none' },
  )
})

test('恢复轮的等待计划：只用剩余墙钟，受上限与解禁时刻夹住', () => {
  const BUDGET = 90_000
  // 没有解禁时刻（聚合 429 的常态）→ 出厂退避
  assert.equal(planRecoveryWaitMs({ elapsedMs: 20_000, budgetMs: BUDGET }), 5_000)
  // 上游给了时刻 → 照它等，但不超过上限
  assert.equal(planRecoveryWaitMs({ retryAfterSeconds: 3, elapsedMs: 20_000, budgetMs: BUDGET }), 3_000)
  assert.equal(planRecoveryWaitMs({ retryAfterSeconds: 600, elapsedMs: 20_000, budgetMs: BUDGET }), 15_000)
  // 剩余预算是硬顶：A2 腾出多少就只能等多少，总预算不因此变大
  assert.equal(planRecoveryWaitMs({ retryAfterSeconds: 20, elapsedMs: 82_000, budgetMs: BUDGET }), 8_000)
  // 剩余不够就不等（返回 undefined，由调用方直接收口）
  assert.equal(planRecoveryWaitMs({ elapsedMs: 89_000, budgetMs: BUDGET }), undefined)
  assert.equal(planRecoveryWaitMs({ elapsedMs: 95_000, budgetMs: BUDGET }), undefined)
  // 亚秒级的解禁时刻向上取到 1s，不等 0 毫秒装成等过了
  assert.equal(planRecoveryWaitMs({ retryAfterSeconds: 0.2, elapsedMs: 0, budgetMs: BUDGET }), 1_000)
})

test('剩余预算低于下限时不再新开尝试（避免一发注定假超时的请求）', () => {
  // 收口线必须等于 planAttemptDeadline 的下限，否则会出现「还能开尝试、
  // 但一发下去只有 5s」的中间态 —— 那正是现网那句假「渠道未产出首块」的来源。
  assert.equal(MIN_REMAINING_FOR_NEXT_ATTEMPT_MS, 5_000)
  assert.equal(planAttemptDeadline({ completeMs: 90_000, elapsedMs: 85_000, budgetMs: 90_000 }), 5_000)
  assert.equal(90_000 - 85_000 < MIN_REMAINING_FOR_NEXT_ATTEMPT_MS, false, '刚好等于下限时边界归循环自己判')
  assert.equal(90_000 - 86_000 < MIN_REMAINING_FOR_NEXT_ATTEMPT_MS, true)
})
