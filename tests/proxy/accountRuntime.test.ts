import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AccountRuntime } from '../../src/main/proxy/accountRuntime.ts'

const NOW = 1_800_000_000_000

test('tracks in-flight requests and a sliding minute window', () => {
  const runtime = new AccountRuntime()

  runtime.beginAttempt('a', NOW)
  runtime.beginAttempt('a', NOW + 1000)

  const snapshot = runtime.snapshot('a', NOW + 2000)
  assert.equal(snapshot.inFlight, 2)
  assert.equal(snapshot.rpmUsed, 2)

  runtime.endAttempt('a')
  runtime.endAttempt('a')
  runtime.endAttempt('a')
  assert.equal(runtime.snapshot('a', NOW + 2000).inFlight, 0)

  // 窗口滑出后 RPM 归零
  assert.equal(runtime.snapshot('a', NOW + 62_000).rpmUsed, 0)
})

test('429 backoff escalates exponentially and resets after a success', () => {
  const runtime = new AccountRuntime()

  assert.equal(runtime.recordFailure('a', 429, NOW), 60_000)
  assert.equal(runtime.isCooling('a', NOW + 1000), true)
  assert.equal(runtime.isCooling('a', NOW + 61_000), false)

  assert.equal(runtime.recordFailure('a', 429, NOW + 2000), 120_000)
  assert.equal(runtime.recordFailure('a', 429, NOW + 3000), 240_000)

  runtime.recordSuccess('a')
  assert.equal(runtime.snapshot('a', NOW + 4000).consecutiveFailures, 0)
  assert.equal(runtime.isCooling('a', NOW + 4000), false)
})

test('non-429 failures use the shorter backoff and cap at two minutes', () => {
  const runtime = new AccountRuntime()

  assert.equal(runtime.recordFailure('a', 500, NOW), 15_000)
  assert.equal(runtime.recordFailure('a', undefined, NOW + 1), 30_000) // 网络错误按 5xx 口径

  for (let i = 0; i < 6; i++) {
    runtime.recordFailure('a', 500, NOW + 2 + i)
  }

  const snapshot = runtime.snapshot('a', NOW + 10)
  assert.equal(snapshot.coolingUntil, NOW + 7 + 120_000)
  assert.ok(snapshot.consecutiveFailures >= 3)
})

test('unknown accounts report neutral metrics', () => {
  const runtime = new AccountRuntime()

  assert.deepEqual(runtime.snapshot('missing', NOW), {
    inFlight: 0,
    rpmUsed: 0,
    consecutiveFailures: 0,
  })
  assert.equal(runtime.isCooling('missing', NOW), false)
})

/**
 * 凭据类故障的冷却档（2026-11-01 实测：qoder 凭据失效后每一笔新请求都再撞
 * 一遍 214s–245s，`auto` 一笔被拖到 525s）。
 *
 * 方向：比 5xx 档**长得多**（不会自己好，短退避等于反复收费），但仍随连续失败
 * 翻倍、有上限，并且一次成功就解除（用户重新登录后不必等冷却自然到期）。
 */
test('credential failures cool far longer than ordinary 5xx', () => {
  const runtime = new AccountRuntime()

  const ordinary = runtime.recordFailure('a', 502, NOW)
  const credential = runtime.recordCredentialFailure('b', NOW)
  assert.equal(ordinary, 15_000)
  assert.equal(credential, 5 * 60 * 1000)
  assert.ok(credential > 2 * 60 * 1000, '凭据档必须高于普通 5xx 的上限，否则两档没有区别')

  // 翻倍但封顶 30 分钟。
  assert.equal(runtime.recordCredentialFailure('b', NOW), 10 * 60 * 1000)
  assert.equal(runtime.recordCredentialFailure('b', NOW), 20 * 60 * 1000)
  assert.equal(runtime.recordCredentialFailure('b', NOW), 30 * 60 * 1000)
  assert.equal(runtime.recordCredentialFailure('b', NOW), 30 * 60 * 1000)
})

test('a success clears the credential cooldown', () => {
  const runtime = new AccountRuntime()
  runtime.recordCredentialFailure('a', NOW)
  assert.equal(runtime.isCooling('a', NOW + 1000), true)
  runtime.recordSuccess('a')
  assert.equal(runtime.isCooling('a', NOW + 1000), false)
  // 计数清零：重新登录后的下一次故障回到 5 分钟起，而不是继续翻倍。
  assert.equal(runtime.recordCredentialFailure('a', NOW), 5 * 60 * 1000)
})
