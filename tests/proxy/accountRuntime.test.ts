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

/**
 * 限流退避按 (账号, 模型) 记档（2026-11-01 修）。
 *
 * 触发场景是真实读数：账号渠道在宿主侧只有一个占位账号，131 上 `Raccoon (商汤)` 的
 * DeepSeek-V4.1-Flash 被上游 429 后，同一渠道别的模型（用户在 VS Code 里跑的另一个
 * 名字）成功一次就把整账号的退避与连击清零 —— 实测表现为「解禁时间每次只往后挪
 * 约 60s」的自维持循环，一笔 71,889 字符 system 的 prefill 每分钟重付一次，
 * 10 分钟封顶那一档永远够不到。
 */
test('同渠道别的模型成功，不得解除本模型的限流档', () => {
  const runtime = new AccountRuntime()

  assert.equal(runtime.recordFailure('a', 429, NOW, 'm1'), 60_000)
  runtime.recordSuccess('a', 'm2')

  assert.equal(runtime.isCooling('a', NOW + 1000, 'm1'), true, 'm1 必须还在限流窗里')
  assert.equal(runtime.isCooling('a', NOW + 1000, 'm2'), false, 'm2 自己不受牵连')

  // 只有本模型自己成功才解除
  runtime.recordSuccess('a', 'm1')
  assert.equal(runtime.isCooling('a', NOW + 1000, 'm1'), false)
})

test('限流档的翻倍只看本模型自己的连击，别的模型成功不打断它', () => {
  const runtime = new AccountRuntime()

  assert.equal(runtime.recordFailure('a', 429, NOW, 'm1'), 60_000)
  runtime.recordSuccess('a', 'm2')
  assert.equal(runtime.recordFailure('a', 429, NOW + 1000, 'm1'), 120_000, '旧行为在这里会退回 60s')
  runtime.recordSuccess('a', 'm2')
  assert.equal(runtime.recordFailure('a', 429, NOW + 2000, 'm1'), 240_000)

  for (let i = 0; i < 6; i++) runtime.recordFailure('a', 429, NOW + 3000 + i, 'm1')
  assert.equal(runtime.recordFailure('a', 429, NOW + 9000, 'm1'), 10 * 60 * 1000, '封顶 10 分钟')
})

test('不带模型的 recordSuccess 清掉该账号全部限流档（渠道池变化 / 重新登录）', () => {
  const runtime = new AccountRuntime()

  runtime.recordFailure('a', 429, NOW, 'm1')
  runtime.recordFailure('a', 429, NOW, 'm2')
  assert.equal(runtime.isCooling('a', NOW + 1000, 'm1'), true)

  runtime.recordSuccess('a')

  assert.equal(runtime.isCooling('a', NOW + 1000, 'm1'), false)
  assert.equal(runtime.isCooling('a', NOW + 1000, 'm2'), false)
})

test('snapshot 的 coolingUntil 取账号档与模型档里更晚的那个', () => {
  const runtime = new AccountRuntime()
  runtime.recordFailure('a', 500, NOW)            // 账号档 15s
  runtime.recordFailure('a', 429, NOW + 1, 'm1')  // 模型档 60s
  assert.equal(runtime.snapshot('a', NOW + 2, 'm1').coolingUntil, NOW + 1 + 60_000)
  assert.equal(
    runtime.snapshot('a', NOW + 2).coolingUntil,
    NOW + 15_000,
    '不带 model 的既有调用只看账号档，行为不得因这次改动而变',
  )

  // 账号档更长时取账号档：限流模型不能因为「自己那档短」被提前派出去
  const other = new AccountRuntime()
  other.recordCredentialFailure('b', NOW)         // 5 分钟
  other.recordFailure('b', 429, NOW + 1, 'm1')    // 60s
  assert.equal(other.snapshot('b', NOW + 2, 'm1').coolingUntil, NOW + 5 * 60 * 1000)
})

test('限流档每账号有上限：自定义供应商的任意模型名不能把表撑大', () => {
  const runtime = new AccountRuntime()

  for (let i = 0; i < 70; i++) runtime.recordFailure('a', 429, NOW, `m${i}`)

  assert.equal(runtime.isCooling('a', NOW + 1000, 'm69'), true, '最新的必须留着')
  assert.equal(runtime.isCooling('a', NOW + 1000, 'm6'), true, '只该摘掉最久没碰的 6 个')
  assert.equal(runtime.isCooling('a', NOW + 1000, 'm0'), false, '超过 64 档的最旧那条必须被摘掉')
})

/* ---------------- 每模型 AIMD / 短窗口 ---------------- */

test('tryBeginAttempt：每个 (账号, 模型) 的并发到默认上限后拒绝，释放后可再进', () => {
  const runtime = new AccountRuntime()
  const model = 'm1'

  for (let i = 0; i < 4; i++) {
    assert.deepEqual(runtime.tryBeginAttempt('a', model, NOW), { ok: true })
  }
  const rejected = runtime.tryBeginAttempt('a', model, NOW)
  assert.equal(rejected.ok, false)
  if (!rejected.ok) assert.ok(rejected.retryAfterMs > 0)

  assert.equal(runtime.snapshot('a', NOW, model).modelInFlight, 4)
  assert.equal(runtime.snapshot('a', NOW, model).modelLimit, 4)

  runtime.endAttempt('a', model)
  assert.deepEqual(runtime.tryBeginAttempt('a', model, NOW), { ok: true })
})

test('429 拥塞会乘性降并发；连续成功且冷却够了再慢慢加一', () => {
  const runtime = new AccountRuntime()
  const model = 'm1'

  for (let i = 0; i < 4; i++) runtime.tryBeginAttempt('a', model, NOW)
  for (let i = 0; i < 4; i++) runtime.endAttempt('a', model)
  runtime.recordAttemptOutcome('a', model, { success: false, status: 429 }, NOW)

  // 4 -> floor(4*0.7)=2；两次准入后第三次必须被拒
  assert.deepEqual(runtime.tryBeginAttempt('a', model, NOW + 10), { ok: true })
  assert.deepEqual(runtime.tryBeginAttempt('a', model, NOW + 10), { ok: true })
  assert.equal(runtime.tryBeginAttempt('a', model, NOW + 10).ok, false)

  for (let i = 0; i < 2; i++) runtime.endAttempt('a', model)
  // 连续成功 5 次后加一档（距上次降速已经超过 30s）
  for (let i = 0; i < 5; i++) {
    runtime.tryBeginAttempt('a', model, NOW + 60_000 + i)
    runtime.endAttempt('a', model)
    runtime.recordAttemptOutcome('a', model, { success: true, totalMs: 1000 }, NOW + 60_000 + i)
  }
  assert.equal(runtime.snapshot('a', NOW + 61_000, model).modelLimit, 3)
})

test('短窗口记录首字 EWMA、429/超时/degraded 比例', () => {
  const runtime = new AccountRuntime()
  const model = 'm1'

  runtime.tryBeginAttempt('a', model, NOW)
  runtime.endAttempt('a', model)
  runtime.recordAttemptOutcome('a', model, { success: true, firstTokenMs: 1000, totalMs: 2000 }, NOW)
  assert.equal(runtime.snapshot('a', NOW, model).ewmaFirstTokenMs, 1000)

  runtime.tryBeginAttempt('a', model, NOW + 1)
  runtime.endAttempt('a', model)
  runtime.recordAttemptOutcome('a', model, { success: false, status: 429 }, NOW + 1)

  runtime.tryBeginAttempt('a', model, NOW + 2)
  runtime.endAttempt('a', model)
  runtime.recordStreamOutcome('a', model, {
    firstTokenMs: 1200,
    totalMs: 3000,
    endReason: 'done',
    degraded: true,
  }, NOW + 2)

  const snapshot = runtime.snapshot('a', NOW + 3, model)
  assert.equal(snapshot.rateLimitedRate, 1 / 3)
  assert.equal(snapshot.degradedRate, 1 / 3)
  assert.equal(snapshot.timeoutRate, 0)
})
