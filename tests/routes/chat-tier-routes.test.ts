/**
 * `/v1/chat` 的三档预设路由（日常 / 稳定 / 性能）在真 HTTP 请求上的行为。
 *
 * 三档的差异**只**来自种子表里的 `poolStrategies` + `prefer`
 * （`store/modelRoutes.ts::PRESET_ROUTE_SEEDS`），所以这一层要证的是「筛选真的生效」，
 * 不是「名字存在」：
 * - 日常（`free-only`）只跑免费档候选；
 * - 稳定（`channel-only`）只跑账号渠道；这一份夹具里没有账号渠道 ⇒ 池为空 ⇒ 503，
 *   且**一个上游都没被打到**（证明它没有悄悄回落到聚合/自定义）；
 * - 性能（`strong-tier`）只跑强档候选。
 *
 * 上游是 `node:http` 替身，记录收到的请求体；模型名走 `modelMappings`，所以
 * 「命中了谁」看的是上游那一侧，不是网关自己的日志。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, startProxy } from './harness.mjs'

const PORT = 18981
const UPSTREAM_PORT = 18982

type Payload = Record<string, any>

let seenBodies: Payload[] = []

const upstream = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Payload
    seenBodies.push(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-tier',
      object: 'chat.completion',
      created: 1,
      model: body.model ?? '',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))
  })
})
const listening = new Promise<void>(resolve => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve))

const harness = await bootstrapStore({
  // 这份要的是真实播种：三档就是播种出来的。
  seedPresetRoutes: true,
  initialData: {
    providers: [
      {
        id: 'tierp',
        name: 'Tier Provider',
        type: 'custom',
        authType: 'token',
        apiEndpoint: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
        chatPath: '/chat/completions',
        headers: {},
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        supportedModels: ['Free-Model', 'Strong-Model', 'Fast-Model'],
        modelMappings: {
          'Free-Model': 'up-free',
          'Strong-Model': 'up-strong',
          'Fast-Model': 'up-fast',
        },
      },
    ],
    accounts: [
      {
        id: 'tierp-acct',
        providerId: 'tierp',
        name: 'tierp account',
        credentials: { token: 'test-token' },
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    // 三档判据读的就是这份手工标注（最高优先级）。
    userModelMarks: {
      tierp: {
        'Free-Model': { free: true },
        'Strong-Model': { tier: 'strong' },
        'Fast-Model': { tier: 'fast' },
      },
    },
    userModelOverrides: {},
    config: {
      proxyPort: PORT,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

await listening
const proxy = await startProxy(PORT)

const chat = (model: string): Promise<Payload> =>
  proxy.request('POST', '/v1/chat/completions', {
    body: { model, messages: [{ role: 'user', content: 'hi' }] },
  })

beforeEach(() => {
  seenBodies = []
})

after(async () => {
  await proxy.stop()
  upstream.close()
  harness.dispose()
})

test('三档都被广告成路由名（R2：清单里只有路由）', async () => {
  const list = await proxy.request('GET', '/v1/models')
  const names = (list.json.data as Payload[]).map(entry => entry.id).sort()

  assert.deepEqual(
    names.filter((name: string) => ['daily', 'stable', 'performance'].includes(name)),
    ['daily', 'performance', 'stable'],
  )
})

test('日常档：只命中免费档候选', async () => {
  const response = await chat('daily')

  assert.equal(response.status, 200)
  assert.equal(response.headers['x-modelport-route-name'], 'daily')
  assert.deepEqual(seenBodies.map(body => body.model), ['up-free'])
})

test('性能档：只命中强档候选', async () => {
  const response = await chat('performance')

  assert.equal(response.status, 200)
  assert.equal(response.headers['x-modelport-route-name'], 'performance')
  assert.deepEqual(seenBodies.map(body => body.model), ['up-strong'])
})

test('稳定档：没有账号渠道时候选池为空，报可读错误且一个上游都没被打到', async () => {
  const response = await chat('stable')

  assert.equal(response.status, 503)
  assert.equal(response.json.error.code, 'no_available_model')
  assert.match(response.json.error.message, /route 'stable'/)
  // 空池的原因必须说出来：是池策略把候选筛光了，不是「没有供应商」。
  assert.deepEqual(response.json.error.details?.missing, ['pool_strategy'])
  assert.deepEqual(seenBodies, [], '稳定档不许悄悄回落到自定义/聚合供应商')
})

test('auto 的行为不被三档改动（仍是原来的池）', async () => {
  const response = await chat('auto')

  assert.equal(response.status, 200)
  assert.equal(response.headers['x-modelport-route-name'], 'auto')
  assert.equal(seenBodies.length, 1, 'auto 的池是整份目录，必定选出候选')
  assert.ok(['up-free', 'up-strong', 'up-fast'].includes(seenBodies[0].model))
})

test('三档的池与优化目标按种子表落库（不是运行期临时拼的）', () => {
  const routes = sm.getConfig().routes as Record<string, any>

  assert.deepEqual(routes.daily.poolStrategies, [{ id: 'free-only', operator: 'and' }])
  assert.equal(routes.daily.prefer, 'cheap')
  assert.deepEqual(routes.stable.poolStrategies, [{ id: 'channel-only', operator: 'and' }])
  assert.equal(routes.stable.prefer, 'balanced')
  assert.deepEqual(routes.performance.poolStrategies, [{ id: 'strong-tier', operator: 'and' }])
  assert.equal(routes.performance.prefer, 'strong')
})
