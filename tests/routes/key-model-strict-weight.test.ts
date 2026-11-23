/**
 * 重点标识 → 真实路由选择的比例证明。
 *
 * 与纯决策层测试的分工：这里跑真 `storeManager` + 真 `autoRouter.select()`，证明用户在
 * 模型管理页翻开的「重点」开关（独立名单，不进能力标注）不需要在代码里硬编码任何
 * 模型名，也不需要逐条路由写数字；三条模型里标两条，30 次派发应落在约 40% / 40% / 20%。
 *
 * 每次选完手工把那一次派发记进路由账本（真实链路里由 `forwarder` 记），因为这里不
 * 打上游，`select()` 自身不知道这一轮最后是不是真的发出去了。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from './harness.mjs'
import type { ChatCompletionRequest } from '../../src/main/proxy/types.ts'
import type { ModelRoute } from '../../src/shared/types.ts'

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
      proxyPort: 8080,
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

const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')
const { dispatchLedger } = await loadModule('main/proxy/dispatchLedger.ts')

function providerFixture(id: string, displayName: string) {
  return {
    id,
    name: `Quota Provider ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [displayName],
    modelMappings: { [displayName]: `${id}-upstream` },
    modelCapabilities: { [displayName]: { tier: 'fast' } },
  }
}

const MODELS = [
  { providerId: 'pq1', displayName: 'Quota-Alpha' },
  { providerId: 'pq2', displayName: 'Quota-Beta' },
  { providerId: 'pq3', displayName: 'Quota-Gamma' },
] as const

for (const { providerId, displayName } of MODELS) {
  sm.addProvider(providerFixture(providerId, displayName) as never)
  sm.addAccount({
    id: `${providerId}-acct`,
    providerId,
    name: `${providerId} account`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  } as never)
}

// 一次点击 = 独立名单里的一行；没有把任何模型名写进网关代码，也不碰能力标注。
sm.setKeyModel('pq1', 'Quota-Alpha', true)
sm.setKeyModel('pq2', 'Quota-Beta', true)

const created = sm.createRoute({
  name: 'key-quota',
  enabled: true,
  strategy: 'round-robin',
  prefer: 'balanced',
  maxAttempts: 3,
  stickyMinutes: 0,
  // 集成测试要看跨模型的轮换；缺省 single 会把池裁到队首那一个模型。
  modelScope: 'pool',
})
assert.equal(created.ok, true, JSON.stringify(created.error))
const route = created.route as ModelRoute

beforeEach(() => {
  autoRouter.reset()
  dispatchLedger.reset()
})

after(() => {
  autoRouter.reset()
  dispatchLedger.reset()
})

test('被标识的模型各拿约 40%，未标识的备用拿约 20%，30 轮内收敛', () => {
  const counts: Record<string, number> = {}
  for (let i = 0; i < 30; i += 1) {
    const request = {
      model: route.name,
      messages: [{ role: 'user', content: `distinct request ${i}` }],
    } as ChatCompletionRequest
    const decision = autoRouter.select(request, 'round-robin', undefined, route)
    const chosen = decision.candidates[0]
    assert.ok(chosen, '路由不该选空')
    counts[chosen.displayName] = (counts[chosen.displayName] ?? 0) + 1
    dispatchLedger.record(chosen.provider.id, chosen.actualModel, undefined, route.name)
  }

  assert.equal(Object.keys(counts).length, 3, `三行都该被派到：${JSON.stringify(counts)}`)
  assert.ok(counts['Quota-Alpha']! >= 10 && counts['Quota-Alpha']! <= 14, JSON.stringify(counts))
  assert.ok(counts['Quota-Beta']! >= 10 && counts['Quota-Beta']! <= 14, JSON.stringify(counts))
  assert.ok(counts['Quota-Gamma']! >= 4 && counts['Quota-Gamma']! <= 8, JSON.stringify(counts))
})

test('取消全部重点标识后配额消失：回到原来的轮转序列，不再按标识纠偏', () => {
  sm.setKeyModel('pq1', 'Quota-Alpha', false)
  sm.setKeyModel('pq2', 'Quota-Beta', false)
  try {
    for (let i = 0; i < 6; i += 1) {
      const request = {
        model: route.name,
        messages: [{ role: 'user', content: `plain request ${i}` }],
      } as ChatCompletionRequest
      const decision = autoRouter.select(request, 'round-robin', undefined, route)
      const chosen = decision.candidates[0]
      assert.ok(chosen)
      dispatchLedger.record(chosen.provider.id, chosen.actualModel, undefined, route.name)
    }
    // 无配额时走 fairnessLead 的均匀轮转：任何一行都不会被固定成唯一队首。
    const picks = new Set<string>()
    for (let i = 0; i < 6; i += 1) {
      const decision = autoRouter.select({
        model: route.name,
        messages: [{ role: 'user', content: `follow-up ${i}` }],
      } as ChatCompletionRequest, 'round-robin', undefined, route)
      picks.add(decision.candidates[0]?.displayName ?? '')
    }
    assert.ok(picks.size > 1)
  } finally {
    sm.setKeyModel('pq1', 'Quota-Alpha', true)
    sm.setKeyModel('pq2', 'Quota-Beta', true)
  }
})
