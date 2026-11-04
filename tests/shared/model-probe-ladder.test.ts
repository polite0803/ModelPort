import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTEXT_PROBE_LADDER,
  OUTPUT_PROBE_LADDER,
  PROBE_CHARS_PER_TOKEN,
  buildContextProbePrompt,
  classifyOutputSuccess,
  classifyProbeFailure,
  createSerialTaskQueue,
  evaluateContextProbe,
  evaluateOutputProbe,
  isContextOverflowError,
  isInconclusiveProbeFailure,
  planContextProbe,
  planOutputProbe,
  probeFailureKind,
  probeFreshness,
  probeRowToLayer,
  PROBE_REQUEST_TIMEOUT_MS,
  PROBE_TOTAL_TIMEOUT_MS,
  sanitizeProbeSidecar,
  shouldSkipProbe,
  type ModelProbeRow,
  type ProbeObservation,
} from '../../src/shared/modelProbe.ts'

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0)
const FRESH_ISO = new Date(NOW - 60_000).toISOString()
const EXPIRED_ISO = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString()

function row(overrides: Partial<ModelProbeRow> = {}): ModelProbeRow {
  return {
    providerId: 'aggregate',
    displayName: 'probe-model',
    actualModelId: 'vendor/probe-model',
    asOf: FRESH_ISO,
    ...overrides,
  }
}

// ── 计划 ───────────────────────────────────────────────────────────────────

test('无推定值时上下文扫全档，请求条数不超过上限', () => {
  const plan = planContextProbe()
  assert.deepEqual(plan.tiers, [...CONTEXT_PROBE_LADDER])
  assert.equal(plan.requestCount, 8)
  assert.equal(plan.requestCount <= 8, true)
  assert.equal(plan.estimatedInputTokens > 0, true)
  assert.equal(plan.narrowedBy, undefined)
})

test('家族规则推定值把上下文档位收窄到相邻三档', () => {
  const plan = planContextProbe({ hintTokens: 131072, hintSource: 'family-rule' })
  assert.deepEqual(plan.tiers, [98304, 131072, 200000])
  assert.equal(plan.requestCount, 3)
  assert.equal(plan.narrowedBy, 'family-rule')
})

test('声明级提示同样只试相邻档，且低于首档/高于末档都不越界', () => {
  assert.deepEqual(planContextProbe({ hintTokens: 1000, hintSource: 'declared' }).tiers, [4096, 8192])
  assert.deepEqual(planContextProbe({ hintTokens: 300000, hintSource: 'declared' }).tiers, [131072, 200000])
})

test('输出上限阶梯固定为 6 档，估算覆盖输入与输出', () => {
  const plan = planOutputProbe()
  assert.deepEqual(plan.tiers, [...OUTPUT_PROBE_LADDER])
  assert.equal(plan.requestCount, 6)
  assert.equal(plan.estimatedOutputTokens >= OUTPUT_PROBE_LADDER.reduce((sum, tier) => sum + tier, 0), true)
})

test('上下文提示词按 chars/token 比例生成，不是逐 token 二分', () => {
  const prompt = buildContextProbePrompt(4096)
  assert.equal(prompt.length >= 4096 * PROBE_CHARS_PER_TOKEN - 8, true)
  assert.equal(prompt.length <= 4096 * PROBE_CHARS_PER_TOKEN + 8, true)
})

// ── 超限识别与失败语义 ──────────────────────────────────────────────────────

test('明确的上下文超限 400 记为 rejected', () => {
  assert.equal(
    isContextOverflowError({ status: 400, errorText: 'context_length_exceeded: maximum context length is 8192 tokens' }),
    true,
  )
  assert.equal(
    classifyProbeFailure({ scope: 'context', status: 400, errorText: 'context_length_exceeded' }),
    'rejected',
  )
})

test('429 永远不写成上限：分类为 inconclusive，判定不产生区间', () => {
  assert.equal(isInconclusiveProbeFailure({ status: 429 }), true)
  assert.equal(classifyProbeFailure({ scope: 'context', status: 429, errorText: 'rate limit' }), 'inconclusive')
  const verdict = evaluateContextProbe([
    { tier: 4096, outcome: 'accepted' },
    { tier: 8192, outcome: 'inconclusive', detail: 'HTTP 429' },
  ])
  assert.equal(verdict.status, 'inconclusive')
  assert.equal(verdict.bound, undefined)
})

test('401 / 403 / 5xx / 网络错误 / 超时都不判上限', () => {
  for (const status of [401, 403, 404, 408, 500, 502, 503]) {
    assert.equal(isInconclusiveProbeFailure({ status }), true)
    assert.equal(classifyProbeFailure({ scope: 'output', status }), 'inconclusive')
  }
  assert.equal(classifyProbeFailure({ scope: 'context', status: undefined }), 'inconclusive')
  assert.equal(classifyProbeFailure({ scope: 'context', timedOut: true }), 'inconclusive')
})

test('本地准入拒绝记为 deferred，而不是失败', () => {
  assert.equal(
    classifyProbeFailure({ scope: 'context', status: 429, localAdmissionRejected: true }),
    'deferred',
  )
})

test('400 但没有超限文案时保持 inconclusive，绝不猜成上限', () => {
  assert.equal(
    classifyProbeFailure({ scope: 'context', status: 400, errorText: 'invalid request: unknown field' }),
    'inconclusive',
  )
})

test('输出上限错误同样只认带 max_tokens 文案的 400', () => {
  assert.equal(
    classifyProbeFailure({ scope: 'output', status: 400, errorText: 'max_tokens is too large' }),
    'rejected',
  )
  assert.equal(
    classifyProbeFailure({ scope: 'output', status: 400, errorText: 'bad request' }),
    'inconclusive',
  )
})

// ── 区间判定 ───────────────────────────────────────────────────────────────

test('上下文阶梯：首个失败档的前一档成为下界', () => {
  const observations: ProbeObservation[] = [
    { tier: 4096, outcome: 'accepted' },
    { tier: 8192, outcome: 'accepted' },
    { tier: 16384, outcome: 'accepted' },
    { tier: 32768, outcome: 'rejected', detail: 'context_length_exceeded' },
  ]
  const verdict = evaluateContextProbe(observations)
  assert.equal(verdict.status, 'measured')
  assert.deepEqual(verdict.bound, { atLeast: 16384, below: 32768 })
})

test('首档即失败时只记上界；全档通过时只记下界', () => {
  assert.deepEqual(evaluateContextProbe([{ tier: 4096, outcome: 'rejected' }]).bound, { below: 4096 })
  assert.deepEqual(
    evaluateContextProbe(CONTEXT_PROBE_LADDER.map((tier) => ({ tier, outcome: 'accepted' as const }))).bound,
    { atLeast: 200000 },
  )
})

test('输出阶梯：真实截断点落在一对相邻档之间', () => {
  const verdict = evaluateOutputProbe([
    { tier: 1024, outcome: 'accepted' },
    { tier: 2048, outcome: 'accepted' },
    { tier: 4096, outcome: 'rejected', detail: 'max_tokens too large' },
  ])
  assert.equal(verdict.status, 'measured')
  assert.deepEqual(verdict.bound, { atLeast: 2048, below: 4096 })
})

test('成功但提前停止记为 suspect，不产生数值结论', () => {
  const verdict = evaluateOutputProbe([
    { tier: 1024, outcome: 'accepted' },
    { tier: 2048, outcome: 'suspect', detail: 'finish_reason=stop' },
  ])
  assert.equal(verdict.status, 'suspect')
  assert.equal(verdict.bound, undefined)
})

test('输出成功判定依赖 finish_reason 与 completion_tokens', () => {
  assert.equal(classifyOutputSuccess({ finishReason: 'length', completionTokens: 1024, tier: 1024 }), 'accepted')
  assert.equal(classifyOutputSuccess({ finishReason: 'length', completionTokens: 900, tier: 1024 }), 'accepted')
  assert.equal(classifyOutputSuccess({ finishReason: 'stop', completionTokens: 200, tier: 1024 }), 'suspect')
  // 上游没报 usage，但明确说被上限截断：仍算通过。
  assert.equal(classifyOutputSuccess({ finishReason: 'length', completionTokens: undefined, tier: 1024 }), 'accepted')
  assert.equal(classifyOutputSuccess({ finishReason: 'stop', completionTokens: undefined, tier: 1024 }), 'suspect')
})

// ── sidecar / TTL / 声明跳过 ─────────────────────────────────────────────────

test('30 天 TTL：新鲜行折成证据层，过期行不参与解析', () => {
  assert.equal(probeFreshness(FRESH_ISO, NOW), 'fresh')
  assert.equal(probeFreshness(EXPIRED_ISO, NOW), 'expired')
  assert.equal(probeFreshness('not-a-date', NOW), 'expired')

  const freshLayer = probeRowToLayer(row({ contextTokens: 65536, contextRange: { atLeast: 65536, below: 98304 } }), NOW)
  assert.equal(freshLayer?.source, 'probe')
  assert.equal(freshLayer?.confidence, 'measured')
  assert.equal(freshLayer?.hint.contextTokens, 65536)
  assert.equal(freshLayer?.evidence?.includes('≥65536'), true)

  assert.equal(probeRowToLayer(row({ asOf: EXPIRED_ISO, contextTokens: 65536 }), NOW), undefined)
})

test('suspect / inconclusive 的数值不会被当成证据', () => {
  const suspect = row({
    contextTokens: 65536,
    contextStatus: 'suspect',
  })
  const sanitized = sanitizeProbeSidecar({ version: 1, rows: [suspect] })
  assert.equal(sanitized.rows[0]?.contextTokens, undefined)
  assert.equal(probeRowToLayer(suspect, NOW), undefined)

  const inconclusive = row({
    maxOutputTokens: 4096,
    maxOutputStatus: 'inconclusive',
  })
  const sanitizedOutput = sanitizeProbeSidecar({ version: 1, rows: [inconclusive] })
  assert.equal(sanitizedOutput.rows[0]?.maxOutputTokens, undefined)
})

test('坏行被丢弃，不抛错', () => {
  const sanitized = sanitizeProbeSidecar({
    version: 1,
    rows: [null, 42, { providerId: 'aggregate' }, row({ contextTokens: 8192 })],
  })
  assert.equal(sanitized.rows.length, 1)
  assert.equal(sanitized.rows[0]?.contextTokens, 8192)
})

test('已有声明级来源默认跳过，强制重测或推定值才探测', () => {
  assert.equal(shouldSkipProbe({ state: 'known', confidence: 'declared' }, false), true)
  assert.equal(shouldSkipProbe({ state: 'known', confidence: 'declared' }, true), false)
  assert.equal(shouldSkipProbe({ state: 'known', confidence: 'inferred' }, false), false)
  assert.equal(shouldSkipProbe({ state: 'known', confidence: 'measured' }, false), false)
  assert.equal(shouldSkipProbe({ state: 'unclassified' }, false), false)
  assert.equal(shouldSkipProbe(undefined, false), false)
})

// ── 串行队列 ───────────────────────────────────────────────────────────────

test('探测队列串行：同一模型串行，跨模型并发上限 1', async () => {
  const enqueue = createSerialTaskQueue()
  let active = 0
  let maxActive = 0
  const order: string[] = []

  const makeTask = (name: string, delay: number) => async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    order.push(`start-${name}`)
    await new Promise((resolve) => setTimeout(resolve, delay))
    order.push(`end-${name}`)
    active -= 1
    return name
  }

  const results = await Promise.all([
    enqueue(makeTask('a', 20)),
    enqueue(makeTask('b', 5)),
    enqueue(makeTask('c', 5)),
  ])

  assert.deepEqual(results, ['a', 'b', 'c'])
  assert.equal(maxActive, 1)
  assert.deepEqual(order, ['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c'])
})

test('前一个任务失败不会卡死后续探测', async () => {
  const enqueue = createSerialTaskQueue()
  await assert.rejects(enqueue(async () => {
    throw new Error('probe failed')
  }))
  const value = await enqueue(async () => 7)
  assert.equal(value, 7)
})

test('失败分类给界面稳定的人读类别', () => {
  assert.equal(probeFailureKind({ timedOut: true }), 'timeout')
  assert.equal(probeFailureKind({ status: 401 }), 'auth')
  assert.equal(probeFailureKind({ status: 403 }), 'auth')
  assert.equal(probeFailureKind({ status: 429 }), 'rate-limit')
  assert.equal(probeFailureKind({ localAdmissionRejected: true }), 'rate-limit')
  assert.equal(probeFailureKind({ status: 408 }), 'timeout')
  assert.equal(probeFailureKind({ status: 502 }), 'upstream')
  assert.equal(probeFailureKind({ status: 503 }), 'upstream')
  assert.equal(probeFailureKind({}), 'network')
  assert.equal(probeFailureKind({ status: 400 }), 'unknown')
})

test('超时常量是显式的：单请求 30s、整体 5 分钟', () => {
  assert.equal(PROBE_REQUEST_TIMEOUT_MS, 30_000)
  assert.equal(PROBE_TOTAL_TIMEOUT_MS, 5 * 60 * 1000)
})
