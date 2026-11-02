/**
 * 多路由在**真 HTTP 请求**上的即时生效（验收 A 的请求级 + G 删除 `auto` 的边界 + D 的停用路由错误）。
 *
 * 证明的层次（这一层只有真请求能给）：
 * `ProxyServer`（真 Koa 中间件：CORS → API key → bodyParser → 路由）
 * → `routes/chat.ts` / `routes/completions.ts` / `routes/models.ts` 的真实处理器
 * → `store/modelRoutes.ts::resolveRouteRequest` → `autoRouter.select()`
 * → 客户端能看到的**状态码 / 响应头 / 错误体**。
 * 每条断言都读的是 `fetch` 拿回来的东西，不是源码文本。
 *
 * 上游网络：两个自定义供应商的 `apiEndpoint` 固定 `http://127.0.0.1:1/v1`
 * （端口 1 是 TCPMUX，本机不会监听）—— 连接**立刻**被拒，既不出网也不需要替身服务，
 * 所以「转发了」这件事的可观测样貌是稳定的 500 `api_error`，而「没转发」是 503/404。
 * 这一层的差集（differential）就是本文件的主证据形式。
 *
 * 不在本层证明：候选池的**精确集合**与粘性隔离（`routes-pool-and-sticky.test.ts`）、
 * renderer UI、真 Electron 进程、OS 钥匙串、流式响应。
 */
import { test, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

const PORT = 18931

/** 升级安装的第一次读取：legacy config（**无** `routes` 键）+ 两个在服的自定义供应商。 */
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
        stickyMinutes: 30,
        prefer: 'balanced',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager

function providerFixture(id: string, displayName: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Route Provider ${id}`,
    type: 'custom',
    authType: 'token',
    // 端口 1：本机不监听，连接立刻 ECONNREFUSED（绝不外发）
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    supportedModels: [displayName],
    modelMappings: { [displayName]: `${id}-upstream` },
    ...overrides,
  }
}

function accountFixture(providerId: string) {
  return {
    id: `${providerId}-acct`,
    providerId,
    name: `${providerId} account`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  }
}

sm.addProvider(providerFixture('rp1', 'Test-A', { modelCapabilities: { 'Test-A': { contextTokens: 32000 } } }) as never)
sm.addProvider(providerFixture('rp2', 'Test-B') as never)
sm.addAccount(accountFixture('rp1') as never)
sm.addAccount(accountFixture('rp2') as never)

const proxy = await startProxy(PORT)
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

/**
 * 失败换家会给账号打冷却（`accountRuntime.recordFailure`），而冷却里的候选会被
 * `rankCandidates` 硬剔除（autoRouting.ts:698-700）—— 那会让**下一条**用例的池变空，
 * 报出一个与路由配置无关的 503。`reset()` 是代理重启的真语义（server 启动时也是它），
 * 所以每条用例之后清一次，用例之间只由路由配置决定结果。
 */
afterEach(() => {
  autoRouter.reset()
})

/** 失败换家会给账号打冷却：每条转发用例之后清一次，保证用例之间只由路由配置决定结果。 */
const chatBody = (model: string) => ({ model, messages: [{ role: 'user', content: 'ping' }] })
const postChat = (model: string, headers?: Record<string, string>) =>
  proxy.request('POST', '/v1/chat/completions', { body: chatBody(model), headers })
const models = async () => {
  const response = await proxy.request('GET', '/v1/models')
  assert.equal(response.status, 200)
  return response.json as { data: Array<Record<string, unknown>> }
}
const modelIds = async () => (await models()).data.map(entry => entry.id)

after(async () => {
  await proxy.stop()
  autoRouter.reset()
  harness.dispose()
})

// ------------------------------------------------- A：升级首读 + 新建，无重启

test('A/请求级：迁移出来的 `auto` 在第一次 HTTP 请求里就被广告成一条路由条目', async () => {
  const list = await models()
  assert.deepEqual(list.data.map(entry => entry.id), ['auto'],
    '清单只剩启用中的路由：两家供应商各有一个在服模型，都不再进清单')

  const auto = list.data[0]
  assert.equal(auto.object, 'model')
  assert.equal(auto.owned_by, 'auto-router')
  // 实现（models.ts::routeEntry 注释）+ AGENTS.md + tests/proxy/models-context-window.test.ts
  // 钉的是「广告候选里最小的那个窗口」，空池才省略键；简报里写的「不带 context_window」
  // 与实现不一致，这里按**真实行为**断言，分歧已写进交付说明。
  assert.equal(auto.context_window, 32000, '有标注候选时广告可证下界（rp1=32000 已公布；rp2 未公布不贡献值）')
  assert.equal(typeof auto.created, 'number')
})

test('请求日志：转发失败也记尝试链与请求关联 id', async () => {
  const response = await postChat('auto')
  assert.notEqual(response.status, 200)
  const requestId = response.headers['x-request-id']
  assert.match(String(requestId), /^chatcmpl-/)

  const row = sm.getRequestLogs().find((entry: Record<string, any>) => entry.requestId === requestId)
  assert.ok(row, '失败请求必须有请求日志行')
  assert.ok(Array.isArray(row.attempts) && row.attempts.length > 0, '失败请求也要记尝试链')
  assert.ok(['rp1', 'rp2'].includes(row.attempts[0].providerId), '第一家是谁由轮询状态决定')
  assert.equal(row.attempts[0].outcome, 'failover')
  assert.ok(row.attempts.every((attempt: Record<string, any>) => typeof attempt.latencyMs === 'number'))
})

test('A/请求级：createRoute 之后同一个代理实例（未重启）的下一个 /v1/models 就有它', async () => {
  const created = sm.createRoute({
    name: 'fast',
    prefer: 'fast',
    maxAttempts: 2,
    stickyMinutes: 0,
    poolStrategies: [{ id: 'vision-capable', operator: 'and' }],
  })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  assert.equal(created.route.strategy, 'round-robin', '未指定 strategy 时回落到当时的 loadBalanceStrategy')

  const ids = await modelIds()
  assert.deepEqual(ids, ['auto', 'fast'])

  const single = await proxy.request('GET', '/v1/models/fast')
  assert.equal(single.status, 200)
  assert.equal(single.json.id, 'fast')
  assert.equal(single.json.owned_by, 'auto-router')
  // 这条路由的池被 `vision-capable` 剔空了（两家供应商都没声明视觉），所以广告里
  // **没有**窗口可说 —— 与它自己请求时的 503 同源。改之前这里报的是全局池的 32000：
  // 一个与这条路由无关、来自它根本不会路由的模型的数（下界逐路由算，见 A＋B 改动）。
  assert.equal('context_window' in (single.json as Record<string, unknown>), false,
    '池被剔空时省略键，而不是借用别家路由的窗口')
})

// --------------------------------- A：池策略 / prefer / 名字解析都逐请求现读

test('A/请求级：池策略把候选剔空 → 503 点名该路由，且带 X-ModelPort-Route-Name', async () => {
  const response = await postChat('fast')

  assert.equal(response.status, 503)
  assert.equal(response.headers['x-modelport-route-name'], 'fast')
  assert.equal(response.json.error.code, 'no_available_model')
  assert.equal(response.json.error.message, "No available model for route 'fast'")
  assert.equal(response.json.error.type, 'service_unavailable_error')
  assert.equal(response.json.error.param, null)
  assert.deepEqual(response.json.error.details, { missing: ['pool_strategy'] }, '池被策略剔空要报 pool_strategy，而不是笼统的缺能力')
  // 503 在写 Auto-Prefer/Reason 之前返回：这三项都不该出现
  assert.equal(response.headers['x-modelport-auto-prefer'], undefined)
  assert.equal(response.headers['x-modelport-auto-reason'], undefined)
  assert.equal(response.headers['x-modelport-auto-attempts'], undefined)
})

test('A/请求级：同一请求体，把池策略清空后立刻真的转发（代理没重启过）', async () => {
  const updated = sm.updateRoute('fast', { poolStrategies: [] })
  assert.equal(updated.ok, true, JSON.stringify(updated.error))

  const response = await postChat('fast')

  // 候选非空 → 真发出上游请求 → 回环端口 1 拒接 → 500（不是 503/404：证明它确实被路由了）
  assert.equal(response.status, 500)
  assert.equal(response.headers['x-modelport-route-name'], 'fast')
  // 网络失败没有上游状态码，`mapUpstreamError` 给的是 `type:'api_error' / code:null`
  assert.equal(response.json.error.type, 'api_error')
  assert.equal(response.json.error.code, null)
  assert.equal(typeof response.json.error.message, 'string')
  assert.ok(response.json.error.message.length > 0)
  // 逐路由配置从这些头里可见：prefer 用的是这条路由的值，不是 legacy 全局的 'balanced'
  assert.equal(response.headers['x-modelport-auto-prefer'], 'fast')
  assert.ok(['only', 'score', 'sticky'].includes(response.headers['x-modelport-auto-reason']))
  assert.match(String(response.headers['x-modelport-auto-attempts']), /^[1-3]$/,
    '换家次数受该路由 maxAttempts=2（+ 可恢复余量）约束')
  assert.ok(response.headers['x-modelport-route'])
})

test('A/请求级：`X-Auto-Prefer` 逐请求盖过该路由的 prefer', async () => {
  const response = await postChat('fast', { 'X-Auto-Prefer': 'strong' })

  assert.equal(response.status, 500)
  assert.equal(response.headers['x-modelport-route-name'], 'fast')
  assert.equal(response.headers['x-modelport-auto-prefer'], 'strong')
})

test('A/请求级：请求里的名字按 trim + 小写解析（` FAST ` 命中的是 `fast`）', async () => {
  const response = await postChat(' FAST ')

  assert.equal(response.headers['x-modelport-route-name'], 'fast')
  assert.equal(response.status, 500, '命中路由后按该路由的池走，不退回具名模型解析')
  assert.equal(response.json.error.type, 'api_error')
})

// ------------------------------------------------------------- D：停用路由

test('D/请求级：停用路由后两条入口都给 404 `route_disabled`（并仍带路由名头），且不再被广告', async () => {
  const updated = sm.updateRoute('fast', { enabled: false })
  assert.equal(updated.ok, true, JSON.stringify(updated.error))

  assert.deepEqual(await modelIds(), ['auto'], '停用的路由不广告，单模型从来就不在清单里')

  const single = await proxy.request('GET', '/v1/models/fast')
  assert.equal(single.status, 404)
  assert.equal(single.json.error.code, 'model_not_found')

  for (const [path, body] of [
    ['/v1/chat/completions', chatBody('fast')],
    ['/v1/completions', { model: 'fast', prompt: 'ping' }],
  ] as const) {
    const response = await proxy.request('POST', path, { body })
    assert.equal(response.status, 404, path)
    assert.equal(response.headers['x-modelport-route-name'], 'fast', path)
    assert.equal(response.json.error.code, 'route_disabled', path)
    assert.equal(response.json.error.message, "Route 'fast' is disabled", path)
    assert.equal(response.json.error.type, 'invalid_request_error', path)
    assert.equal(response.json.error.param, 'model', path)
  }
})

test('A/请求级：重新启用 `fast` 后同一个请求体又回到「被路由」的样貌', async () => {
  sm.updateRoute('fast', { enabled: true, poolStrategies: [{ id: 'vision-capable', operator: 'and' }] })

  const blocked = await postChat('fast')
  assert.equal(blocked.status, 503)
  assert.equal(blocked.json.error.code, 'no_available_model')

  sm.updateRoute('fast', { poolStrategies: [{ id: 'standard-context', operator: 'and' }] })
  const forwarded = await postChat('fast')
  assert.equal(forwarded.status, 500)
  assert.equal(forwarded.json.error.type, 'api_error')
})

// ----------------------------------------------- A/G：删除后这个名字不再被路由

test('A/请求级：删除路由后同一个请求体从「被路由」变成具名解析的 503 no_available_account', async () => {
  const removed = sm.deleteRoute('fast')
  assert.equal(removed.ok, true, JSON.stringify(removed.error))

  assert.deepEqual(await modelIds(), ['auto'])

  const response = await postChat('fast')
  assert.equal(response.status, 503)
  assert.equal(response.headers['x-modelport-route-name'], undefined,
    '表里已经没有这条路由：不许再给它盖路由名的戳')
  assert.equal(response.json.error.code, 'no_available_account')
  assert.equal(response.json.error.message, 'No available account for model: fast')
})

test('G/请求级：删掉 `auto` 后 `/v1/models` 不再出现它，`model:"auto"` 落到具名解析（503，不是 404/500）', async () => {
  // 删除前先留一份「它还活着」的真请求样貌，作差集的左半边
  const before = await postChat('auto')
  assert.equal(before.status, 500, '迁移出来的 auto 池为空 → 直接候选转发（上游拒接）')
  assert.equal(before.headers['x-modelport-route-name'], 'auto')

  const removed = sm.deleteRoute('auto')
  assert.equal(removed.ok, true, JSON.stringify(removed.error))
  assert.deepEqual(sm.getModelRoutes(), {})
  const stored = sm.getStore().get('config') as Record<string, unknown>
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'routes'), true,
    '存储里仍是「routes 键存在且为空」，否则读取侧会再迁移一次把 auto 复活')
  assert.deepEqual(stored.routes, {})

  assert.deepEqual(await modelIds(), [], '没有启用中的路由时清单就是空的 —— 单模型不再回填')

  const single = await proxy.request('GET', '/v1/models/auto')
  assert.equal(single.status, 404)
  assert.equal(single.json.error.code, 'model_not_found')

  const after = await postChat('auto')
  assert.equal(after.status, 503)
  assert.equal(after.headers['x-modelport-route-name'], undefined)
  assert.equal(after.json.error.code, 'no_available_account')
  assert.equal(after.json.error.message, 'No available account for model: auto')
  assert.equal(after.json.error.type, 'service_unavailable_error')
})

test('G/请求级：`auto` 这个名字没有被特殊保留，重建后仍是普通路由', async () => {
  const created = sm.createRoute({
    name: 'auto',
    poolStrategies: [{ id: 'vision-capable', operator: 'and' }],
    stickyMinutes: 0,
    maxAttempts: 1,
  })
  assert.equal(created.ok, true, JSON.stringify(created.error))

  const response = await postChat('auto')
  assert.equal(response.status, 503)
  assert.equal(response.headers['x-modelport-route-name'], 'auto')
  assert.equal(response.json.error.message, "No available model for route 'auto'")

  assert.equal(sm.deleteRoute('auto').ok, true)
  assert.deepEqual(await modelIds(), [], '删光后回到零条路由，且不会被复活')
})

// ------------------------------ 路由名优先于同名模型（拍板语义的请求级证据）

test('同名优先：路由表里的名字抢在具名模型解析之前（真请求差集），建名时则被 conflicts_model 拒绝', async () => {
  const rejected = sm.createRoute({ name: 'Test-A' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'conflicts_model')

  // 已经存在同名模型的用户可以手改 config 把路由名种进去（IPC 之外的通道），
  // 请求解析这一侧必须按「路由优先」回答 —— 这正是 checkRouteName 只在**新建/改名**
  // 时拦、且「改名不冲突就不动其它字段」的理由。
  const planted = sm.updateConfig({
    routes: {
      'test-a': {
        name: 'test-a',
        enabled: true,
        strategy: 'round-robin',
        prefer: 'balanced',
        maxAttempts: 1,
        stickyMinutes: 0,
        poolStrategies: [{ id: 'vision-capable', operator: 'and' }],
      },
    },
  })
  assert.deepEqual(Object.keys(planted.routes), ['test-a'])

  const list = await models()
  assert.deepEqual(list.data.map(entry => entry.id), ['test-a'],
    '清单里只有路由那一条；与它同名的模型不进清单，所以也不存在「同名留哪条」的取舍')

  const routed = await postChat('Test-A')
  assert.equal(routed.status, 503)
  assert.equal(routed.headers['x-modelport-route-name'], 'test-a')
  assert.equal(routed.json.error.message, "No available model for route 'test-a'")

  const completions = await proxy.request('POST', '/v1/completions', {
    body: { model: 'test-a', prompt: 'ping' },
  })
  assert.equal(completions.status, 503, '两条入口共用 resolveRouteRequest，判定必须一致')
  assert.equal(completions.headers['x-modelport-route-name'], 'test-a')
  assert.equal(completions.json.error.code, 'no_available_model')
  assert.equal(completions.json.error.message, "No available model for route 'test-a'")

  // 撤掉这条路由：同一个 `model:"Test-A"` 请求体回到具名解析并真的转发（差集的右半边）
  const nextRoutes = { ...sm.getModelRoutes() }
  delete nextRoutes['test-a']
  sm.updateConfig({ routes: nextRoutes })

  const named = await postChat('Test-A')
  assert.equal(named.status, 500, '没有同名路由时 `Test-A` 还是那个模型，照常找账号')
  assert.equal(named.headers['x-modelport-route-name'], undefined)
  assert.equal(named.json.error.type, 'api_error')
})

test('A/请求级：路由表的三次状态（有/停用/无）在连续请求里都即时反映，全程未重启代理', async () => {
  sm.createRoute({ name: 'steady', stickyMinutes: 0, maxAttempts: 1 })

  const withRoute = await postChat('steady')
  assert.equal(withRoute.headers['x-modelport-route-name'], 'steady')
  assert.equal(withRoute.status, 500, '池为空 = 全部在服模型参与，所以会真转发')
  autoRouter.reset()

  sm.updateRoute('steady', { enabled: false })
  const disabled = await postChat('steady')
  assert.equal(disabled.status, 404)
  assert.equal(disabled.json.error.code, 'route_disabled')

  sm.deleteRoute('steady')
  const gone = await postChat('steady')
  assert.equal(gone.status, 503)
  assert.equal(gone.json.error.code, 'no_available_account')
  assert.equal(gone.headers['x-modelport-route-name'], undefined)

  assert.deepEqual(sm.getModelRoutes(), {})
  assert.deepEqual(await modelIds(), [])
})

// ---------------------- R1/R2：不广告 ≠ 不能点名（拍板裁定的请求级证据）

test('R1/R2：清单里没有的模型名，启用时仍能点名直连；停用后同一个名字立刻不可用', async () => {
  assert.equal((await modelIds()).includes('Test-B'), false, '单模型不再进清单')

  const forwarded = await postChat('Test-B')
  assert.equal(forwarded.status, 500, '清单不认它，但它是启用中的模型，具名解析照旧转发')
  assert.equal(forwarded.json.error.type, 'api_error')

  const single = await proxy.request('GET', '/v1/models/Test-B')
  assert.equal(single.status, 404, '单查与列表同一个名字域，不许清单否认、单查承认')

  sm.setModelsServed('rp2', ['Test-B'], false)
  const stopped = await postChat('Test-B')
  assert.equal(stopped.status, 503, '停用即不可点名 —— 这是「必须启用才接」的那一半')
  assert.equal(stopped.json.error.code, 'no_available_account')

  sm.setModelsServed('rp2', ['Test-B'], true)
  const again = await postChat('Test-B')
  assert.equal(again.status, 500, '重新启用后同一个名字又能跑，无需重启代理')
})

// ------------------------- R3：别名行的启用位（落映射表自身，四通路同一判据）

test('R3：别名停用后再也点不进，重新启用即恢复；停用位落在映射表自身的 disabled 上', async () => {
  const withAlias = sm.updateConfig({
    modelMappings: {
      ...sm.getConfig().modelMappings,
      'my-alias': { requestModel: 'my-alias', actualModel: 'Test-A' },
    },
  })

  const named = await postChat('my-alias')
  assert.equal(named.status, 500, '别名指向一个在服的模型时点名它照旧转发（上游拒接才是 500）')

  sm.updateConfig({
    modelMappings: {
      ...withAlias.modelMappings,
      'my-alias': { ...withAlias.modelMappings['my-alias'], disabled: true },
    },
  })
  assert.equal(sm.getConfig().modelMappings['my-alias'].disabled, true,
    '写入侧走的是同一条归一路径，停用位没被抹平')

  const stopped = await postChat('my-alias')
  assert.equal(stopped.status, 503, '停用后这个名字不再被任何解析路径认识')
  assert.equal(stopped.json.error.code, 'no_available_account')

  assert.equal((await modelIds()).includes('my-alias'), false, '别名从来就不在清单里（R2）')
  const retrieve = await proxy.request('GET', '/v1/models/my-alias')
  assert.equal(retrieve.status, 404, '单查也不认它')

  // 同名目录行不受牵连：停用的是别名，不是 `Test-A` 那一家
  const modelStillRoutable = await postChat('Test-A')
  assert.equal(modelStillRoutable.status, 500, '两本账各记各的，停别名不停模型')

  const rest = { ...sm.getConfig().modelMappings }
  delete rest['my-alias']
  sm.updateConfig({ modelMappings: rest })
})
