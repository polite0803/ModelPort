/**
 * 合成 incomplete（`incomplete_step`）是**模型级**缺陷，不是账号容量故障。
 *
 * 架构 A：一轮之内不换模型，所以「这家干不了活」必须在回合边界变成「下一轮从
 * 别家开始」—— 落模型熔断票。账号级 AIMD 管的是「账号能不能接」，模型没把活
 * 干完不该降它的并发（同模型三家账号全限流也不代表模型该换，反之亦然）。
 *
 * 对照面：真实输出上限（第五类）只撤锚点，不上熔断票 —— 它可能只发生这一次。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AccountRuntime } from '../../src/main/proxy/accountRuntime.ts'
import {
  INCOMPLETE_STEP_CODE,
  modelQualityDegradation,
  shouldRevokeStickyAfterStream,
} from '../../src/main/proxy/streamOutcomePolicy.ts'

const NOW = 1_800_000_000_000

test('incomplete_step 上模型熔断票，普通上游错误不上', () => {
  assert.equal(
    modelQualityDegradation({ endReason: 'error' }, false, INCOMPLETE_STEP_CODE),
    'incomplete-step',
  )
  assert.equal(modelQualityDegradation({ endReason: 'error' }, false, 'upstream_error'), undefined)
  assert.equal(modelQualityDegradation({ endReason: 'error' }, false, null), undefined)
  assert.equal(modelQualityDegradation({ endReason: 'error' }), undefined)
})

test('真实输出上限仍只撤锚点，不上熔断票（第五类口径不变）', () => {
  const trace = { endReason: 'done' as const }
  assert.equal(shouldRevokeStickyAfterStream(trace, true), true)
  assert.equal(modelQualityDegradation(trace, false), undefined)
})

test('incomplete_step 也撤锚点：下一轮不再钉在同一家', () => {
  assert.equal(shouldRevokeStickyAfterStream({ endReason: 'error' }, false), true)
})

test('模型级退化不降 AIMD 并发，但清零成功连击并记 degraded', () => {
  const runtime = new AccountRuntime()
  runtime.tryBeginAttempt('a', 'm', NOW)
  runtime.endAttempt('a', 'm')
  runtime.recordAttemptOutcome('a', 'm', { success: true, totalMs: 1000 }, NOW)

  runtime.recordStreamOutcome('a', 'm', { endReason: 'error', modelQuality: true }, NOW + 1)

  const snapshot = runtime.snapshot('a', NOW + 2, 'm')
  assert.equal(snapshot.modelLimit, 4, '模型没干完活不是账号接不住，不得降并发')
  assert.equal(snapshot.degradedRate, 1, '但要记成退化，不能当干净成功去加并发')
})

test('对照：同一笔若按普通流错误上报，并发照旧乘性降速', () => {
  const runtime = new AccountRuntime()
  runtime.tryBeginAttempt('a', 'm', NOW)
  runtime.endAttempt('a', 'm')
  runtime.recordAttemptOutcome('a', 'm', { success: true, totalMs: 1000 }, NOW)

  runtime.recordStreamOutcome('a', 'm', { endReason: 'error' }, NOW + 1)

  assert.equal(runtime.snapshot('a', NOW + 2, 'm').modelLimit, 2)
})