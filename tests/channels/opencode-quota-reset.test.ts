/**
 * 2026-11-13 实测回归：匿名免费通道的日额度耗尽时，上游回
 * `429 FreeUsageLimitError` + `retry-after: 75411`（≈20.9 小时，正好指向
 * 次日 `00:00 UTC` = 08:00 CST 的日窗口复位）。
 *
 * 旧实现对上游值一律钳到 30 分钟，三处后果：
 *   ① 池里那条通道每 30 分钟被放出来重撞一次（自维持空转）；
 *   ② 面板与客户端被告知「约 30 分钟后恢复」，真实复位在 21 小时后；
 *   ③ 最终那条 `QUOTA_EXCEEDED` 不带 `providerRetryAfterMs`，客户端拿不到 `Retry-After`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BACKOFF_CAP_MS,
  QUOTA_DEFAULT_MS,
  RATE_LIMIT_BASE_MS,
  UPSTREAM_RETRY_AFTER_CAP_MS,
  opencodeRetryAfterMs,
} from '../../vendor/channel-pack/src/opencode-retry.ts'
import { formatRecoveryReset } from '../../vendor/channel-pack/src/retry-after.ts'

const adapterSource = readFileSync('vendor/channel-pack/src/opencode-adapter.ts', 'utf-8')
const indexSource = readFileSync('vendor/channel-pack/src/index.ts', 'utf-8')

test('上游 retry-after 原样生效，不再被钳到 30 分钟', () => {
  const upstream = 75_411_000
  assert.equal(
    opencodeRetryAfterMs('free_usage_limit', upstream, 1),
    upstream,
    '日额度复位 21 小时后：上游给多少就是多少',
  )
  // 0 是合法值（「立即解除」），不能被 falsy 判据换成默认值。
  assert.equal(opencodeRetryAfterMs('free_usage_limit', 0, 1), 0)
  // 只防畸形头（7 天），不按业务推断。
  assert.equal(
    opencodeRetryAfterMs('free_usage_limit', 400 * 24 * 3_600_000, 1),
    UPSTREAM_RETRY_AFTER_CAP_MS,
  )
})

test('上游没给等待时长时按语义退避', () => {
  assert.equal(opencodeRetryAfterMs('free_usage_limit', undefined, 1), QUOTA_DEFAULT_MS)
  assert.equal(opencodeRetryAfterMs('quota', undefined, 1), QUOTA_DEFAULT_MS)
  assert.equal(opencodeRetryAfterMs('auth', undefined, 1), RATE_LIMIT_BASE_MS)
  assert.equal(opencodeRetryAfterMs('rate_limit', undefined, 3), RATE_LIMIT_BASE_MS * 4)
  // 自我退避仍有 30 分钟上界（没有上游依据的那一支）。
  assert.equal(opencodeRetryAfterMs('rate_limit', undefined, 20), BACKOFF_CAP_MS)
})

test('长等待的文案给绝对复位时刻，短等待只说相对时长', () => {
  const now = new Date(2026, 10, 13, 11, 0, 0).getTime()
  const reset = new Date(2026, 10, 14, 8, 0, 0).getTime()
  assert.equal(formatRecoveryReset(reset, now), '11-14 08:00 恢复，约 21.0 小时后')
  assert.equal(formatRecoveryReset(now + 30 * 60_000, now), '约 30 分钟后恢复')
  assert.equal(formatRecoveryReset(now + 45_000, now), '约 45 秒后恢复')
  assert.equal(formatRecoveryReset(now + 7 * 24 * 3_600_000, now), '11-20 11:00 恢复，约 7.0 天后')
})

test('适配器把最早解禁时刻随 QUOTA_EXCEEDED 一起交出去', () => {
  assert.match(
    adapterSource,
    /from '\.\/opencode-retry\.js'/,
    '受限时长策略必须走共用模块（否则钳位会悄悄长回来）',
  )
  assert.match(
    adapterSource,
    /'QUOTA_EXCEEDED',\s*\{\s*status: 429,[\s\S]{0,200}providerRetryAfterMs/,
    '整池受限的最终错误要带 429 与上游解禁时刻，客户端才有 Retry-After',
  )
  assert.match(
    adapterSource,
    /limited\.length === 0[\s\S]{0,200}throw lastError/,
    '一个槽都没被记成受限时（上游 5xx / 网络错误）不得报「均受限」',
  )
})

test('池空门控的文案按真实复位时刻渲染', () => {
  assert.match(
    indexSource,
    /该模型的所有通道当前都在限流中[\s\S]{0,400}formatRecoveryReset\(earliestReset, now\)/,
    '长等待（21 小时）不能折算成「约 30 分钟后恢复」',
  )
  assert.match(
    indexSource,
    /'RATE_LIMIT',[\s\S]{0,200}providerRetryAfterMs: waitMs/,
    '池空仍是 429 + 解禁时长',
  )
})