/**
 * 启动时生成「Claude 可发现路由」的判据。
 *
 * R2 之后 `/v1/models` 只广告路由名，而 Claude 客户端只认自己那张名字表 —— 所以这类
 * 路由**必须**在 init 末尾就存在，不能只挂在设置页按钮上（从没点过的安装会一条都没有，
 * 客户端看到 0 个可用模型）。
 *
 * 这一层钉四件事：
 * 1. 目录里真实的 `claude*` 模型 → 一条钉死它的路由（名字 = 叶子段）；
 * 2. 没有启用账号的条目**不生成**（生成了也是必死的名字），而且**不记档** ——
 *    账号以后启用时下次启动还应该补上；
 * 3. 生成过的名字进记档；
 * 4. 删掉以后不再复活：启动那条路把记档当 `skipNames` 传进去。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const harness = await bootstrapStore({
  // 要的是真实播种（夹具默认会把预设名记档、跳过整条启动播种路径）。
  seedPresetRoutes: true,
  initialData: {
    providers: [
      {
        id: 'llm7',
        name: 'LLM7',
        type: 'custom',
        authType: 'token',
        apiEndpoint: 'http://127.0.0.1:1/v1',
        chatPath: '/chat/completions',
        headers: {},
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        // 聚合形态的目录名：叶子段就是 Claude 客户端会发回来的那个 id。
        supportedModels: ['llm7/claude-opus-5', 'llm7/glm-5'],
        modelMappings: { 'llm7/claude-opus-5': 'claude-opus-5', 'llm7/glm-5': 'glm-5' },
      },
      {
        // 没有启用账号的条目：不该生成，也不该记档。
        id: 'dorm',
        name: 'Dormant',
        type: 'custom',
        authType: 'token',
        apiEndpoint: 'http://127.0.0.1:1/v1',
        chatPath: '/chat/completions',
        headers: {},
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        supportedModels: ['dorm/claude-haiku-4-5'],
        modelMappings: { 'dorm/claude-haiku-4-5': 'claude-haiku-4-5' },
      },
    ],
    accounts: [
      {
        id: 'llm7-acct',
        providerId: 'llm7',
        name: 'llm7 account',
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
    userModelOverrides: {},
    config: {
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

const { applyAnthropicRoutes }: typeof import('../../src/main/store/anthropicRoutes.ts') =
  await loadModule('main/store/anthropicRoutes.ts')
const { resolveAnthropicModel }: typeof import('../../src/main/proxy/routes/messages.ts') =
  await loadModule('main/proxy/routes/messages.ts')

after(() => harness.dispose())

test('启动后目录里的 Claude 模型有一条钉死它的路由', () => {
  const routes = sm.getConfig().routes as Record<string, any>

  assert.ok(routes['claude-opus-5'], `实际路由表：${Object.keys(routes).join(', ')}`)
  const route = routes['claude-opus-5']
  assert.equal(route.enabled, true)
  // 池策略留空 + 钉名 = 「只跑钉的那一个模型」，这是「清单里写的名字」与「实际跑的模型」一致的唯一保证。
  assert.deepEqual(route.poolStrategies, [])
  assert.deepEqual(route.pinModels, [{ providerId: 'llm7', displayName: 'llm7/claude-opus-5' }])
})

test('没有启用账号的条目不生成，也不记档（账号启用后还能补上）', () => {
  const config = sm.getConfig()
  const routes = config.routes as Record<string, any>

  assert.equal(routes['claude-haiku-4-5'], undefined)
  assert.ok(
    !(config.seededPresetRoutes ?? []).includes('claude-haiku-4-5'),
    '记档了它就永远不会再出现，账号启用也补不上',
  )
})

test('生成过的名字进记档（连同四条预设）', () => {
  const recorded = sm.getConfig().seededPresetRoutes ?? []

  for (const name of ['codex', 'daily', 'stable', 'performance', 'claude-opus-5']) {
    assert.ok(recorded.includes(name), `记档里缺 ${name}：${recorded.join(', ')}`)
  }
})

test('Claude 客户端发的名字一条就命中，不落兜底', () => {
  assert.deepEqual(resolveAnthropicModel('claude-opus-5', sm.getConfig()), {
    model: 'claude-opus-5',
    source: 'as-requested',
  })
})

test('删掉以后启动不再复活：记档作为 skipNames 传进去', () => {
  assert.equal(sm.deleteRoute('claude-opus-5').ok, true)
  assert.equal(sm.getConfig().routes?.['claude-opus-5'], undefined)

  const again = applyAnthropicRoutes({ skipNames: sm.getConfig().seededPresetRoutes ?? [] })
  assert.equal(again.ok, true)
  assert.deepEqual((again as { created: unknown[] }).created, [], '删掉的不能靠下次启动/下次 apply 复活')
  assert.equal(sm.getConfig().routes?.['claude-opus-5'], undefined)
})
