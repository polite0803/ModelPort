/**
 * 第 2 条（2026-11-13）：终止性拒绝不再按 15 秒账号冷却处理。
 *
 * 现网读数（11-12 20:11 → 11-13 00:21 的 223 行 + 8 笔直探）：opencode
 * `free_usage_limit`、cline 402「等待不会恢复」、qodercn 403「需要升级」、
 * workbuddy 400 风控 —— 四类都只有 15 秒冷却，于是每一笔新请求都把同一家再撞
 * 一遍，付一次完整 prefill 和排队，用户读到的就是「路由又慢又莫名失败」。
 *
 * 两个证明面：
 * 1. **判据窄**（`permanentRefusalCooldownMs`）：要钱/要订阅 → 6h，额度窗自复位
 *    → 1h；裸 429、限流文案、「订阅档里的限流」一律不命中。
 * 2. **落库取更晚者**（`AccountRuntime.recordFailure`）：permanent 与指数退避、
 *    上游 `Retry-After` 三方取 max —— 上游说的解禁时刻更权威。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AccountRuntime } from '../../src/main/proxy/accountRuntime.ts'
import {
  isRecoverableChainExhaustion,
  permanentRefusalCooldownMs,
  PERMANENT_REFUSAL_COOLDOWN_MS,
  QUOTA_WINDOW_COOLDOWN_MS,
} from '../../src/main/proxy/failover.ts'

const HOUR = 60 * 60 * 1000
const NOW = 1_800_000_000_000

test('要人动手的那一档（402 / 没订阅 / 没钱）是 6 小时', () => {
  assert.equal(permanentRefusalCooldownMs({ status: 402 }), PERMANENT_REFUSAL_COOLDOWN_MS)
  assert.equal(permanentRefusalCooldownMs({ message: 'Insufficient credits' }), PERMANENT_REFUSAL_COOLDOWN_MS)
  assert.equal(permanentRefusalCooldownMs({ message: '账号余额不足' }), PERMANENT_REFUSAL_COOLDOWN_MS)
  assert.equal(permanentRefusalCooldownMs({ message: 'No active subscription for this model' }), PERMANENT_REFUSAL_COOLDOWN_MS)
  assert.equal(permanentRefusalCooldownMs({ message: '订阅已过期' }), PERMANENT_REFUSAL_COOLDOWN_MS)
  assert.equal(PERMANENT_REFUSAL_COOLDOWN_MS, 6 * HOUR)
})

test('会自己复位的那一档（免费额度 / 日限 / 全池受限）是 1 小时', () => {
  assert.equal(permanentRefusalCooldownMs({ message: 'free_usage_limit reached' }), QUOTA_WINDOW_COOLDOWN_MS)
  assert.equal(permanentRefusalCooldownMs({ message: 'daily limit exceeded' }), QUOTA_WINDOW_COOLDOWN_MS)
  assert.equal(permanentRefusalCooldownMs({ message: '所有通道均受限' }), QUOTA_WINDOW_COOLDOWN_MS)
  assert.equal(QUOTA_WINDOW_COOLDOWN_MS, HOUR)
})

test('判据要窄：裸 429、普通限流、订阅档内限流都不算终止性拒绝', () => {
  assert.equal(permanentRefusalCooldownMs({ status: 429 }), undefined)
  assert.equal(permanentRefusalCooldownMs({ status: 429, message: 'rate limit exceeded' }), undefined)
  assert.equal(permanentRefusalCooldownMs({ status: 429, message: 'Too many requests, slow down' }), undefined)
  assert.equal(
    permanentRefusalCooldownMs({ message: '429 rate limit exceeded for your subscription tier' }),
    undefined,
    '「限流发生在订阅档里」是限流，不是没有订阅',
  )
  assert.equal(permanentRefusalCooldownMs({ status: 500, message: 'upstream exploded' }), undefined)
})

test('恢复轮不再重付一次永久拒绝', () => {
  assert.equal(isRecoverableChainExhaustion({ status: 429 }), true, '普通 429 仍然等一轮')
  assert.equal(isRecoverableChainExhaustion({ status: 402 }), false)
  assert.equal(isRecoverableChainExhaustion({ status: 400, error: 'free_usage_limit' }), false)
  assert.equal(isRecoverableChainExhaustion({ status: 403, error: 'subscription required' }), false)
})

test('落库：permanent 与指数退避取更晚者，账号档与限流档都生效', () => {
  const runtime = new AccountRuntime()

  assert.equal(
    runtime.recordFailure('a', 500, NOW, undefined, undefined, { permanentTtlMs: PERMANENT_REFUSAL_COOLDOWN_MS }),
    PERMANENT_REFUSAL_COOLDOWN_MS,
    '普通 5xx 的 15s 退避被 6h 抬起来',
  )
  assert.equal(runtime.isCooling('a', NOW + 5 * HOUR), true)
  assert.equal(runtime.isCooling('a', NOW + 6 * HOUR + 1), false)

  assert.equal(
    runtime.recordFailure('b', 429, NOW, 'model-x', undefined, { permanentTtlMs: QUOTA_WINDOW_COOLDOWN_MS }),
    QUOTA_WINDOW_COOLDOWN_MS,
    '限流档的 60s 退避被 1h 抬起来',
  )

  assert.equal(
    runtime.recordFailure('c', 429, NOW, 'model-y', 8 * HOUR, { permanentTtlMs: QUOTA_WINDOW_COOLDOWN_MS }),
    8 * HOUR,
    '上游 Retry-After 更晚时以它为准',
  )
})