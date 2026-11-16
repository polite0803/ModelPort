/**
 * 钉与瞬时状态在**真 HTTP 请求**上的形状（2026-11-16 现网两处谎报的回归）：
 *
 * 1. 钉住的模型名下账号全被瞬时状态挡下（当日上限/额度耗尽标记）→ 429 +
 *    `Retry-After` + `details.pin`，**保钉**。旧代码把这类剔除发生在 `rankInputs`
 *    之前的事实读成「名字不在池里」，报 503 `pin_stale`「不再属于这条路由」——
 *    诱使用户撤掉一颗窗口复位就回来的好钉。
 * 2. 钉被能力挡下（pinBlocked）时，不得拿**无关模型**的瞬时剔除算整池
 *    `transientUnavailable`：旧代码把「钉缺视觉」谎报成「全池额度耗尽、N 秒后
 *    重试」（现网：agnes 钉被 context 挡下，客户端读到 bailian 的 22.9 天月窗）。
 *
 * 证明的层次：真 Koa 中间件 → `routes/chat.ts` / `routes/completions.ts` 的真实
 * 处理器 → `autoRouter.select` 的钉处置 → 客户端读到的状态码/头/错误体/日志行。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, startProxy } from './harness.mjs'
import { localDayKey } from '../../src/shared/localDay.ts'
import { accountRuntime } from '../../src/main/proxy/accountRuntime.ts'

// 18950 被 named-transient-empty-pool-http 占用，node --test 并行时互撞
const PORT = 18956

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
      routes: {},
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

// 端口 1：本机不监听，连接立刻被拒 —— 「转发了」的样貌是 500 api_error，绝不出网
sm.addProvider({
  id: 'tp',
  name: 'Transient Provider',
  type: 'custom',
  authType: 'token',
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
// 能看图的第三方：钉被视觉挡下时它留在 ranked 里，missing 才是空的 ——
// 这正是现网那笔谎报的形状（池里还有别人，空池是钉造成的）。
sm.addProvider({
  id: 'pv',
  name: 'Vision Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  supportedModels: ['Sees-All'],
  modelMappings: { 'Sees-All': 'sees-all' },
  modelCapabilities: { 'Sees-All': { vision: 'yes' } },
} as never)
sm.addAccount({
  id: 'pv-acct',
  providerId: 'pv',
  name: 'pv account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

const created = sm.createRoute({
  name: 'pinr',
  enabled: true,
  strategy: 'round-robin',
  prefer: 'balanced',
  maxAttempts: 3,
  stickyMinutes: 0,
  modelScope: 'pool',
  preferredModel: { providerId: 'tp', displayName: 'Tp-A' },
})
assert.equal(created.ok, true, JSON.stringify(created.error))

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

const storedPin = () =>
  sm.listModelRoutes().find(route => route.name === 'pinr')?.preferredModel

test('钉住的账号当日打满：两条入口 429 + Retry-After + details.pin，保钉不报 pin_stale', async () => {
  sm.updateAccount('tp-acct', {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })

  for (const [path, body] of ENTRIES) {
    const response = await proxy.request('POST', path, { body: body('pinr') })
    assert.equal(response.status, 429, path)
    assert.equal(response.json.error.code, 'model_temporarily_unavailable', path)
    assert.equal(response.json.error.type, 'rate_limit_error', path)
    assert.equal(response.json.error.details.pin, 'Tp-A', path)
    assert.equal(response.json.error.details.cause, 'daily_limit', path)
    const retryAfter = Number(response.headers['retry-after'])
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1, `${path} 必须带整数 Retry-After`)
    assert.equal(retryAfter, response.json.error.details.retry_after_seconds, path)
    assert.match(String(response.headers['x-modelport-pin']), /^transient=Tp-A;retry=/, path)
    assert.match(String(response.json.error.message), /pinned model 'Tp-A'/, path)

    const row = sm.getRequestLogs().find(entry => entry.requestId === response.headers['x-request-id'])
    assert.ok(row, `${path} 的 429 必须有请求日志行`)
    assert.equal(row.errorCode, 'model_temporarily_unavailable', path)
    assert.equal(row.auto?.pinTransient?.displayName, 'Tp-A', `${path} 日志行要带钉的瞬时处置`)
    assert.equal(row.auto?.pinStale, undefined, `${path} 不许把窗口打满记成钉失效`)
  }
  assert.deepEqual(storedPin(), { providerId: 'tp', displayName: 'Tp-A' }, '配置不替用户删钉')
})

test('负控：日期键复位后同一颗钉重新命中并转发，不再 429', async () => {
  sm.updateAccount('tp-acct', { todayUsedDay: '2000-01-01' })

  const response = await proxy.request('POST', '/v1/chat/completions', { body: chatBody('pinr') })
  assert.equal(response.status, 500, '端口 1 连接被拒 —— 钉重新命中，路由确实转发了')
  assert.equal(response.json.error.type, 'api_error')
  assert.notEqual(response.json.error.code, 'model_temporarily_unavailable')
})

test('钉住的聚合模型额度耗尽标记：429，Retry-After 从标记的 until 派生', async () => {
  sm.updateRoute('pinr', {
    preferredModel: { providerId: 'open_router', displayName: 'open_router/openrouter/free' },
  })
  const now = Date.now()
  sm.recordAggregateQuotaExhaustion('open_router', {
    accountId: 'or-acct',
    modelId: 'openrouter/free',
    reason: 'quota-exhausted',
    message: 'Allocated quota exceeded',
    asOf: new Date(now).toISOString(),
    until: new Date(now + 5 * 60_000).toISOString(),
  })

  const response = await proxy.request('POST', '/v1/chat/completions', { body: chatBody('pinr') })
  assert.equal(response.status, 429)
  assert.equal(response.json.error.details.pin, 'open_router/openrouter/free')
  assert.equal(response.json.error.details.cause, 'quota')
  const retryAfter = Number(response.headers['retry-after'])
  assert.ok(retryAfter > 280 && retryAfter <= 300, `Retry-After 应从 until 派生，实际 ${retryAfter}s`)

  sm.clearAggregateQuotaExhaustion('open_router', 'or-acct', 'openrouter/free')
  sm.updateRoute('pinr', { preferredModel: { providerId: 'tp', displayName: 'Tp-A' } })
})

test('钉被视觉挡下 + 无关模型当日打满：503 写明是钉缺能力，不谎报全池额度耗尽', async () => {
  // 上一条负控真转发过一发（端口 1 连接被拒），tp-acct 因此带着 15s 账号冷却 ——
  // 不清掉的话这一轮命中的是 pinCooling 而不是 pinBlocked，测不到要测的分支。
  accountRuntime.reset()
  // 现网形状：池里还有能看图的 Sees-All（ranked 非空、missing 为空），空池是钉
  // 造成的；open_router 的当日上限是无关剔除。旧代码会把它汇总成 429 + 午夜
  // Retry-After —— 成因与重试时刻双双撒谎。
  sm.updateAccount('or-acct', {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })
  const visionBody = {
    model: 'pinr',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'what is in this picture' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ],
    }],
  }

  const response = await proxy.request('POST', '/v1/chat/completions', { body: visionBody })
  assert.equal(response.status, 503, '钉挡下这一轮是 503，不是 429「等窗口复位」')
  assert.equal(response.json.error.code, 'no_available_model')
  assert.equal(response.json.error.details.pin, 'Tp-A')
  assert.deepEqual(response.json.error.details.missing, ['vision'])
  assert.equal(response.headers['retry-after'], undefined, '钉的能力缺口没有「等一会儿就好」的时刻')
  assert.match(String(response.headers['x-modelport-pin']), /^blocked=Tp-A/)

  const row = sm.getRequestLogs().find(entry => entry.requestId === response.headers['x-request-id'])
  assert.ok(row)
  assert.deepEqual(row.auto?.pinBlocked?.missing, ['vision'])
  assert.equal(row.auto?.transientUnavailable, undefined, '日志也不许把无关剔除记成整池瞬时不可用')

  sm.updateAccount('or-acct', { todayUsedDay: '2000-01-01' })
})

test('负控：幽灵钉（名字真不在池里）仍然 503 pin_stale，保钉', async () => {
  sm.updateRoute('pinr', { preferredModel: { providerId: 'tp', displayName: 'Ghost-Not-Served' } })

  for (const [path, body] of ENTRIES) {
    const response = await proxy.request('POST', path, { body: body('pinr') })
    assert.equal(response.status, 503, path)
    assert.equal(response.json.error.code, 'pin_stale', path)
    assert.equal(response.json.error.details.action, 'held', path)
  }
  assert.deepEqual(storedPin(), { providerId: 'tp', displayName: 'Ghost-Not-Served' }, '钉保留')
})