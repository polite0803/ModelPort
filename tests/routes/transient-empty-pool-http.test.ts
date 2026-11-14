/**
 * 瞬时空池在**真 HTTP 请求**上的形状：429 + `Retry-After` + `model_temporarily_unavailable`。
 *
 * 证明的层次：真 Koa 中间件（CORS → API key → bodyParser → 路由）→ `routes/chat.ts` /
 * `routes/completions.ts` 的真实处理器 → `autoRouter.select()` → 客户端读到的状态码/头/错误体。
 *
 * 它替掉的是「候选全被额度/当日上限挡掉时报 503 No available model」：那个 503 读起来像
 * 配置问题、且不可重试，而真相是等一会儿池子里就重新有人。配置筛空（`pool_strategy` /
 * `manual_filter`）仍然报 503 —— 那一格由 `tests/routes/proxy-routes-request.test.ts` 钉着。
 */
import { test, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'
import { localDayKey } from '../../src/shared/localDay.ts'

// 18947 与 completions-empty-prompt 相同，node --test 并行时互撞
const PORT = 18954

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

const proxy = await startProxy(PORT)
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

afterEach(() => {
  autoRouter.reset()
})
after(async () => {
  await proxy.stop()
  autoRouter.reset()
  harness.dispose()
})

const chatBody = (model: string) => ({ model, messages: [{ role: 'user', content: 'ping' }] })

test('全部账号当日打满：两条入口都 429 + Retry-After，不再报 503「路由没有模型」', async () => {
  sm.updateAccount('tp-acct', {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })

  for (const [path, body] of [
    ['/v1/chat/completions', chatBody('auto')],
    ['/v1/completions', { model: 'auto', prompt: 'ping' }],
  ] as const) {
    const response = await proxy.request('POST', path, { body })
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
    assert.equal(row.auto.chainLength, 0, `${path} 的行要说明池子是空的`)
    assert.ok(
      row.auto.skipped.some((marker: string) => marker.endsWith(':daily_limit')),
      `${path} 的行里要存成因，实际：${JSON.stringify(row.auto.skipped)}`
    )
  }
})

test('负控：计数换成别的日期（复位）后，同一个请求重新被转发，不再 429', async () => {
  sm.updateAccount('tp-acct', { todayUsedDay: '2000-01-01' })

  const response = await proxy.request('POST', '/v1/chat/completions', { body: chatBody('auto') })
  assert.equal(response.status, 500, '端口 1 连接被拒 —— 池子重新有候选人，路由确实转发了')
  assert.equal(response.json.error.type, 'api_error')
  assert.notEqual(response.json.error.code, 'model_temporarily_unavailable')
})