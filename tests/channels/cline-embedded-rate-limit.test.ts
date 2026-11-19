/**
 * 「上游 429 被 cline.bot 包进 5xx」判据（`cline-embedded-rate-limit.ts`）的回归测试。
 *
 * 背景（2026-11-19 现网 `chatcmpl-mwn9hlta-u1alis`）：OpenRouter 的 Particle AI
 * 共享算力池瞬时打满（`fleet_capacity_exhausted`，`retry_after_seconds: 1`），
 * cline.bot 把它包成 5xx，适配器按 `httpErrorCode(5xx)` 归成 `SERVER` →
 * 客户端看到 502 硬撞、宿主也不进恢复轮。
 *
 * 契约核心：
 * 1. 实测报障原文（转义串形态）必须命中，并读出 `retry_after_seconds`；
 * 2. 非转义 JSON 与 `Retry-After` 字段形态同样命中；
 * 3. 判据窄：包装句缺失时，正文里出现无关数字或泛化的 rate limit 词**不得**命中。
 *
 * ⚠️ 被测模块**零 import**，可直接以 TS 源动态加载（同 raccoon-rate-limit.test.ts）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')

async function loadModule() {
  return await import(pathToFileURL(join(VENDOR_SRC, 'cline-embedded-rate-limit.ts')).href)
}

/** 现网形态：cline.bot 的外层 JSON 里再套一段**转义**的 OpenRouter 报文。 */
const LIVE_ESCAPED = '{"error":"Failed to create stream: inference request failed: failed to generate '
  + 'stream from OpenRouter: failed to invoke model \'particle-ai/particle-1:free\' with streaming: '
  + 'request failed with status 429: {\\"error\\":{\\"message\\":\\"Provider returned error\\",'
  + '\\"code\\":429,\\"metadata\\":{\\"provider_error_code\\":\\"fleet_capacity_exhausted\\",'
  + '\\"retry_after_seconds\\":1,\\"headers\\":{\\"Retry-After\\":\\"1\\"}}}}"}'

test('实测报障原文（5xx 正文内嵌转义 429）命中并读出 1 秒', async () => {
  const { parseEmbeddedUpstreamRateLimit } = await loadModule()
  assert.deepEqual(parseEmbeddedUpstreamRateLimit(LIVE_ESCAPED), { retryAfterMs: 1_000 })
})

test('非转义 JSON 形态：retry_after_seconds 读出秒数', async () => {
  const { parseEmbeddedUpstreamRateLimit } = await loadModule()
  const body = '{"error":"request failed with status 429: {\\"retry_after_seconds\\":2}"}'
  assert.deepEqual(parseEmbeddedUpstreamRateLimit(body), { retryAfterMs: 2_000 })
})

test('命中但报文没写时长：返回空对象（宿主走出厂退避）', async () => {
  const { parseEmbeddedUpstreamRateLimit } = await loadModule()
  const result = parseEmbeddedUpstreamRateLimit('request failed with status 429: nothing else')
  assert.notEqual(result, undefined, '包装句命中即成立')
  assert.equal(result?.retryAfterMs, undefined)
})

test('Retry-After 头样式字段同样可读', async () => {
  const { parseEmbeddedUpstreamRateLimit } = await loadModule()
  const body = 'request failed with status 429: {"headers":{"Retry-After":"3"}}'
  assert.deepEqual(parseEmbeddedUpstreamRateLimit(body), { retryAfterMs: 3_000 })
})

test('判据窄：没有包装句的普通 5xx 不得命中（即使正文出现 429 或 rate limit）', async () => {
  const { parseEmbeddedUpstreamRateLimit } = await loadModule()
  assert.equal(parseEmbeddedUpstreamRateLimit('{"error":{"message":"internal error 4290"}}'), undefined)
  assert.equal(
    parseEmbeddedUpstreamRateLimit('{"error":{"message":"Provider returned error, rate limited"}}'),
    undefined,
    '泛化的 rate limit 词不算「被包装的上游 429」',
  )
  assert.equal(parseEmbeddedUpstreamRateLimit(''), undefined)
})

test('异常时长：负数与非数字读不出，超大值夹到 60 秒', async () => {
  const { parseEmbeddedUpstreamRateLimit } = await loadModule()
  assert.equal(
    parseEmbeddedUpstreamRateLimit('request failed with status 429 {"retry_after_seconds":-1}')?.retryAfterMs,
    undefined,
  )
  assert.equal(
    parseEmbeddedUpstreamRateLimit('request failed with status 429 {"retry_after_seconds":86400}')?.retryAfterMs,
    60_000,
  )
})