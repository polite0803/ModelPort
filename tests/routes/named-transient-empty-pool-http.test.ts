/**
 * 具名模型（非路由名）的瞬时空池在**真 HTTP 请求**上的形状：429 + `Retry-After` +
 * `model_temporarily_unavailable`，与 auto 路径同口径。
 *
 * 它替掉的是「账号全被额度/当日上限挡掉时报 503 No available account」：那个 503
 * 读起来像配置问题、且不可重试，客户端硬重试 11 次后弹错误窗口（2026-11-14 现网：
 * bailian_token_plan/qwen3.8-flash 的额度耗尽标记 → 503 → 11 连重试）。永久成因
 * （账号停用、名字不存在）仍然报 503 —— 那两格在这里钉着。
 *
 * 证明的层次：真 Koa 中间件 → `routes/chat.ts` / `routes/completions.ts` 的真实
 * 处理器 → `loadBalancer.selectAccount` + `transientEmptyPoolSkips` → 客户端读到
 * 的状态码/头/错误体/请求日志行。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'
import { localDayKey } from '../../src/shared/localDay.ts'

// 18949 与 completions-output-cap 的 stub 上游相同，node --test 并行时互撞
const PORT = 18950

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
      autoRouting: {
        enabled: true,
        maxAttempts: 2,
        stickyMinutes: 0,
        prefer: 'balanced',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager

sm.addProvider({
  id: 'tp',
  name: 'Transient Provider',
  type: 'custom',
  authType: 'token',
  // 端口 1：本机不监听，连接立刻被拒 —— 「转发了」的样貌是 500 api_error，绝不出网
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  supportedModels: ['Tp-A'],
  modelMappings: { 'Tp-A': 'tp-a' },
} as never)
sm.addAccount({
  id: 'tp-acct',
  providerId: 'tp',
  name: 'tp account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)
sm.addProvider({
  id: 'open_router',
  name: 'OpenRouter',
  type: 'aggregate',
  authType: 'token',
  apiEndpoint: 'https://openrouter.invalid/api/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  supportedModels: ['open_router/openrouter/free'],
  modelMappings: { 'open_router/openrouter/free': 'openrouter/free' },
} as never)
sm.addAccount({
  id: 'or-acct',
  providerId: 'open_router',
  name: 'or account',
  credentials: { apiKey: 'sk-or-test' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

const proxy = await startProxy(PORT)

after(async () => {
  await proxy.stop()
  harness.dispose()
})

const chatBody = (model: string) => ({ model, messages: [{ role: 'user', content: 'ping' }] })
const ENTRIES = [
  ['/v1/chat/completions', (model: string) => chatBody(model)],
  ['/v1/completions', (model: string) => ({ model, prompt: 'ping' })],
] as const

test('具名模型账号当日打满：两条入口都 429 + Retry-After，不再报 503「没有可用账号」', async () => {
  sm.updateAccount('tp-acct', {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })

  for (const [path, body] of ENTRIES) {
    const response = await proxy.request('POST', path, { body: body('Tp-A') })
    assert.equal(response.status, 429, path)
    assert.equal(response.json.error.code, 'model_temporarily_unavailable', path)
    assert.equal(response.json.error.type, 'rate_limit_error', path)
    assert.equal(response.json.error.details.cause, 'daily_limit', path)
    const retryAfter = Number(response.headers['retry-after'])
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1, `${path} 必须带整数 Retry-After`)
    assert.equal(retryAfter, response.json.error.details.retry_after_seconds, path)
    assert.match(String(response.json.error.message), /temporarily unavailable/, path)

    // 本地拒绝也要留痕：这一笔没有任何上游往返，不写行就等于「面板上没有流量」。
    const row = sm.getRequestLogs().find(entry => entry.requestId === response.headers['x-request-id'])
    assert.ok(row, `${path} 的 429 必须有请求日志行`)
    assert.equal(row.statusCode, 429, path)
    assert.equal(row.errorCode, 'model_temporarily_unavailable', path)
    assert.equal(row.errorType, 'rate_limit_error', path)
    assert.equal(row.auto, undefined, `${path} 是具名路径，没有 auto 段`)
    // body 默认不保留（采样为 0）：成因的持久读数是 errorMessage 里的人话成因
    assert.match(String(row.errorMessage), /daily request limit reached/, `${path} 的行里要存成因`)
  }
})

test('负控：计数换成别的日期（复位）后，同一个具名请求重新被转发，不再 429', async () => {
  sm.updateAccount('tp-acct', { todayUsedDay: '2000-01-01' })

  const response = await proxy.request('POST', '/v1/chat/completions', { body: chatBody('Tp-A') })
  assert.equal(response.status, 500, '端口 1 连接被拒 —— 池子重新有候选人，路由确实转发了')
  assert.equal(response.json.error.type, 'api_error')
  assert.notEqual(response.json.error.code, 'model_temporarily_unavailable')
})

test('具名模型额度耗尽标记：两条入口 429，Retry-After 从标记的 until 派生', async () => {
  const now = Date.now()
  sm.recordAggregateQuotaExhaustion('open_router', {
    accountId: 'or-acct',
    modelId: 'openrouter/free',
    reason: 'quota-exhausted',
    message: 'Allocated quota exceeded',
    asOf: new Date(now).toISOString(),
    until: new Date(now + 5 * 60_000).toISOString(),
  })

  for (const [path, body] of ENTRIES) {
    const response = await proxy.request('POST', path, { body: body('open_router/openrouter/free') })
    assert.equal(response.status, 429, path)
    assert.equal(response.json.error.code, 'model_temporarily_unavailable', path)
    assert.equal(response.json.error.details.cause, 'quota', path)
    const retryAfter = Number(response.headers['retry-after'])
    assert.ok(retryAfter > 280 && retryAfter <= 300, `${path} Retry-After 应从 until 派生，实际 ${retryAfter}s`)
    assert.equal(retryAfter, response.json.error.details.retry_after_seconds, path)

    const row = sm.getRequestLogs().find(entry => entry.requestId === response.headers['x-request-id'])
    assert.ok(row, `${path} 的 429 必须有请求日志行`)
    assert.equal(row.errorCode, 'model_temporarily_unavailable', path)
  }
})

test('永久成因保持 503：账号停用、名字不存在都不许翻 429', async () => {
  sm.updateAccount('tp-acct', { status: 'disabled' })

  for (const [path, body] of ENTRIES) {
    const disabled = await proxy.request('POST', path, { body: body('Tp-A') })
    assert.equal(disabled.status, 503, `${path} 停用账号不是瞬时状态`)
    assert.equal(disabled.json.error.code, 'no_available_account', path)
    assert.equal(disabled.headers['retry-after'], undefined, path)

    const unknown = await proxy.request('POST', path, { body: body('No-Such-Model') })
    assert.equal(unknown.status, 503, `${path} 名字不存在是配置问题`)
    assert.equal(unknown.json.error.code, 'no_available_account', path)
  }
})