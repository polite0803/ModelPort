/**
 * Anthropic 可发现名「建路由」的落库判据（真 store，不是纯函数对拍）。
 *
 * 纯函数那一层在 `tests/shared/anthropic-discovery.test.ts`，这里证明的是三件它证明不了的
 * 事：路由**真的落进 `config.routes`**、`pinModels` 原样活着（归一化没把它抹掉），
 * 以及第二次点「生成路由」是空操作。端到端（列得到 + 上游收到哪个名字）在
 * `tests/routes/anthropic-inbound.test.ts`。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

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
      proxyPort: 18972,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

// 被测模块一律走 `await import()`：静态 import 在 ESM 链接期解析，`src` 里那些不带扩展名的
// 相对引用在那一阶段解析不到（`harness.mjs` 顶部记着同一条规矩）。
const { applyAnthropicRoutes, planAnthropicRoutes }: typeof import('../../src/main/store/anthropicRoutes.ts') =
  await loadModule('main/store/anthropicRoutes.ts')
const { resolveAnthropicModel }: typeof import('../../src/main/proxy/routes/messages.ts') =
  await loadModule('main/proxy/routes/messages.ts')

after(() => harness.dispose())

const addEntry = (id: string, displayName: string, upstreamId: string, activeAccount: boolean): void => {
  sm.addProvider({
    id,
    name: `Provider ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [displayName],
    modelMappings: { [displayName]: upstreamId },
  } as never)
  if (activeAccount) {
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
}

test('旧数据里没有 pinModels 的路由，读出来一律补成空数组（不钉 = 全目录）', () => {
  const auto = sm.getConfig().routes?.auto
  assert.ok(auto !== undefined, '默认迁移应给出 auto 路由')
  assert.deepEqual(auto?.pinModels, [], '读侧必须同形，消费方不用区分「没配」与「配了空」')
})

test('生成后路由真的落库，钉定原样活着，网关也认识这个名字', () => {
  addEntry('llm7', 'llm7/claude-opus-5', 'claude-opus-5', true)

  const preview = planAnthropicRoutes()
  if (!preview.ok) assert.fail(`预览不该失败：${preview.error.message}`)
  assert.deepEqual(preview.plan.create.map(route => route.name), ['claude-opus-5'])

  const applied = applyAnthropicRoutes()
  if (!applied.ok) assert.fail(`建路由不该失败：${applied.error.message}`)
  assert.equal(applied.created.length, 1)
  assert.deepEqual(applied.failed, [])

  const route = sm.getConfig().routes?.['claude-opus-5']
  assert.ok(route !== undefined, '路由必须真的进表')
  assert.equal(route?.enabled, true)
  assert.deepEqual(route?.pinModels, [{ providerId: 'llm7', displayName: 'llm7/claude-opus-5' }])
  assert.deepEqual(route?.poolStrategies, [], '钉定在前收基底，池策略留空才是「只跑钉的那几个」')

  // 客户端下一轮原样发回这个名字：它必须被直接解析成这条路由，而不是落兜底。
  assert.deepEqual(resolveAnthropicModel('claude-opus-5', sm.getConfig()), {
    model: 'claude-opus-5',
    source: 'as-requested',
  })
})

test('第二次生成是空操作，不会越点越多', () => {
  const before = Object.keys(sm.getConfig().routes ?? {}).sort().join(',')
  const again = applyAnthropicRoutes()
  if (!again.ok) assert.fail(`建路由不该失败：${again.error.message}`)
  assert.deepEqual(again.created, [])
  assert.equal(Object.keys(sm.getConfig().routes ?? {}).sort().join(','), before)
})

test('没有可用账号的那家不建，含点号的名字也不建，各自报原因', () => {
  const before = Object.keys(sm.getConfig().routes ?? {}).length
  addEntry('dead', 'dead/claude-haiku-4-5', 'claude-haiku-4-5', false)
  addEntry('dotted', 'dotted/claude-opus-4.8', 'claude-opus-4.8', true)

  const preview = planAnthropicRoutes()
  if (!preview.ok) assert.fail(`预览不该失败：${preview.error.message}`)
  // 前面几条测试已经建过 claude-opus-5，它会以 route-name-taken 出现在同一份报告里；
  // 这里只断言新加的两家各自的原因，不拿整表长度当判据。
  const reasons = preview.plan.skipped.map(entry => `${entry.name}:${entry.reason}`)
  assert.ok(reasons.includes('claude-haiku-4-5:no-active-account'), reasons.join(', '))
  assert.ok(reasons.includes('claude-opus-4.8:name-not-routable'), reasons.join(', '))
  assert.deepEqual(preview.plan.create, [])
  assert.equal(Object.keys(sm.getConfig().routes ?? {}).length, before, '这两类都不许写进库')
})
