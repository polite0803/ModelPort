/**
 * 「这一家的上下文窗口装不下这次请求」必须换成下一家，而不是把整条路由打死。
 *
 * 证明的层次：真 `ProxyServer` → 真 `routes/chat.ts` → 真换家循环 → 客户端状态码 /
 * `X-ModelPort-Auto-Attempts` / 请求日志里的那条读数。上游是本机 `node:http` 替身。
 *
 * 三条用例的顺序有讲究：
 * 1. 先把候选顺序**测出来**（`cheap` 下免费的 Bad 排第一），后两条才谈得上「试了几家」；
 * 2. overflow 与 generic400 的状态码完全相同（都是 400），只有文案不同 ——
 *    这条文件同时钉住「判据窄」：无关的 400 照旧终止，不因为新增例外而变宽。
 * 3. 换家之后再来一发：Bad 没被记冷却，仍然排在第一位 —— 证明窗口不够不算账号故障。
 *
 * 不在本层证明：判据的字符串口径（`tests/proxy/failover.test.ts`）、
 * 读数的算法（`tests/shared/requestContextFit.test.ts`）、窗口广告口径
 * （`tests/routes/route-context-floor.test.ts`）。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

const PORT = 18991
const UPSTREAM_PORT = 18992

type UpstreamMode = 'ok' | 'overflow' | 'generic400' | 'reasoning400'
let mode: UpstreamMode = 'ok'
const seenModels: string[] = []

const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { model?: string }
    const actualModel = body.model ?? ''
    seenModels.push(actualModel)

    if (actualModel === 'badp-upstream' && mode !== 'ok') {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: {
          message: mode === 'overflow'
            ? "This model's maximum context length is 8192 tokens, however you requested 30000 tokens"
            : mode === 'reasoning400'
              ? "feature 'reasoning_effort for this model' is not currently supported"
              : "Invalid request: unsupported parameter 'temperature' for this model",
          type: 'invalid_request_error',
          ...(mode === 'overflow' ? { code: 'context_length_exceeded' } : { code: 'unsupported_parameter' }),
        },
      }))
      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      created: 1,
      model: actualModel,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 21, completion_tokens: 3, total_tokens: 24 },
    }))
  })
})
const listening = new Promise<void>(resolve => server.listen(UPSTREAM_PORT, '127.0.0.1', resolve))

const harness = await bootstrapStore({
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: {
      proxyPort: PORT,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'cheap', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager
const upstreamBase = `http://127.0.0.1:${UPSTREAM_PORT}/v1`

function providerFixture(id: string, displayName: string, capabilities: Record<string, unknown> = {}) {
  return {
    id,
    name: `Ctx Provider ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: upstreamBase,
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [displayName],
    modelMappings: { [displayName]: `${id}-upstream` },
    ...(Object.keys(capabilities).length === 0 ? {} : { modelCapabilities: { [displayName]: capabilities } }),
  }
}

// Bad 故意**不公布窗口**（所以不会被上下文硬过滤提前剔掉，只能由它自己回 400 认账）,
// 又标成免费：`prefer:'cheap'` 的成本档把它顶到第一位，顺序可复现。
sm.addProvider(providerFixture('badp', 'Small-Ctx', { free: true }) as never)
sm.addProvider(providerFixture('goodp', 'Big-Ctx', { contextTokens: 128_000 }) as never)
for (const id of ['badp', 'goodp']) {
  sm.addAccount({
    id: `${id}-acct`,
    providerId: id,
    name: `${id} account`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  } as never)
}

await listening
const proxy = await startProxy(PORT)
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

const postAuto = () => proxy.request('POST', '/v1/chat/completions', {
  body: { model: 'auto', messages: [{ role: 'user', content: 'ping' }] },
})

function rowOf(requestId: string | undefined) {
  return sm.getRequestLogs().find((entry: Record<string, unknown>) => entry.requestId === requestId) as
    | Record<string, any>
    | undefined
}

beforeEach(() => {
  mode = 'ok'
  seenModels.length = 0
  autoRouter.reset()
})

after(async () => {
  await proxy.stop()
  autoRouter.reset()
  server.close()
  harness.dispose()
})

test('前置：cheap 下未公布窗口的免费候选排第一', async () => {
  const response = await postAuto()
  assert.equal(response.status, 200)
  assert.equal(response.headers['x-modelport-auto-attempts'], '1')
  assert.deepEqual(seenModels, ['badp-upstream'], '顺序可复现，后面的用例才有资格数尝试次数')
})

test('上下文超限的 400：换成下一家并成功，日志记下这条实测读数', async () => {
  mode = 'overflow'

  const response = await postAuto()

  assert.equal(response.status, 200, '这一家装不下 ≠ 这条路由不可用')
  assert.match(response.headers['x-modelport-route'], /Ctx Provider goodp/)
  assert.equal(response.headers['x-modelport-auto-attempts'], '2')
  assert.deepEqual(seenModels, ['badp-upstream', 'goodp-upstream'])

  const row = rowOf(response.headers['x-request-id'])
  assert.ok(row, '请求日志里要能找到这一行')
  assert.equal(row.contextFit, 'overflow')
  assert.equal(row.contextFitSource, 'measured', '超限来自上游报错，不是判定')
  assert.equal(typeof row.inputTokensEstimate, 'number', '每轮体量要留得下读数')
  assert.equal('modelContextWindow' in row, false,
    '本次服务的候选没公布窗口，就不写猜测值')
})

test('无关的 400 照旧终止：新增例外没有把判据放宽（窄口径负控）', async () => {
  mode = 'generic400'

  const response = await postAuto()

  assert.equal(response.status, 400)
  assert.equal(response.headers['x-modelport-auto-attempts'], '1',
    '不是上下文问题就不该换家 —— 否则任何 400 都会被当成窗口不够')
  assert.deepEqual(seenModels, ['badp-upstream'])
})

test('窗口不够不记账号故障：下一轮同一家仍然排第一并成功', async () => {
  mode = 'overflow'
  await postAuto()

  mode = 'ok'
  seenModels.length = 0
  const second = await postAuto()

  assert.equal(second.status, 200)
  assert.equal(second.headers['x-modelport-auto-attempts'], '1')
  assert.deepEqual(seenModels, ['badp-upstream'], '被换家过一次的候选不该进冷却')
})

// 2026-11-03 用户报障：WorkBuddy 带 `reasoning_effort` 打 `daily`，落到 OVH 的
// `Meta-Llama-3_3-70B-Instruct`（没标注推理能力 ⇒ 硬筛拦不住），上游 400 把整轮打死。
test('不接受 reasoning_effort 的 400：换成下一家并成功，日志按能力类记账', async () => {
  mode = 'reasoning400'

  const response = await proxy.request('POST', '/v1/chat/completions', {
    body: { model: 'auto', messages: [{ role: 'user', content: 'ping' }], reasoning_effort: 'high' },
  })

  assert.equal(response.status, 200, '这一家不认这个参数 ≠ 这条路由不可用')
  assert.match(response.headers['x-modelport-route'], /Ctx Provider goodp/)
  assert.equal(response.headers['x-modelport-auto-attempts'], '2')
  assert.deepEqual(seenModels, ['badp-upstream', 'goodp-upstream'])

  const row = rowOf(response.headers['x-request-id'])
  assert.ok(row, '请求日志里要能找到这一行')
  assert.deepEqual((row.auto.failures as Array<Record<string, unknown>>).map(f => f.kind), ['capability'],
    'kind 必须与换家循环实际走的分支一致：记成 fatal 就等于说「这一家之后没再试」')
})
