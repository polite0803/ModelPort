/**
 * 批 B：池结构变更事件（`routes:pool-changed`）的**主进程发射面**。
 *
 * 证明的层次：真 `storeManager` 的结构写 → 结构写拦截（conf 实例 `set` 包装，零读盘）
 * → `getHost().push`。
 * harness 绑的是无头宿主（`createNodeHost`），它的 push 喂 `onHeadlessPush` 订阅者，
 * 所以这里直接收集推帧，断言「哪些写发了事件、哪些没发」—— 不是读源码文本。
 *
 * 关键边界（与星级推荐的冲突点）：评分写的是 `config.routes[].modelRatings`，也落在
 * config 键上，但它**不改池成员**。若评分也发事件，路由页每次点星都会整池重读
 * （全池扫描 p50 4.7s）。所以 config 键的订阅只 bump 修订号、不发事件；路由结构改动
 * 由 createRoute/updateRoute/deleteRoute 显式发，纯评分补丁除外。
 *
 * 不在本层证明：renderer 订阅与重取（`tests/renderer/routes-console-surface.test.mjs`
 * 钉源码接线）、真 Electron 窗口推送、SSE 网络帧。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from './harness.mjs'
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
        stickyMinutes: 30,
        prefer: 'fast',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager

const { onHeadlessPush } = await loadModule('main/runtime/host.ts')
const { IpcChannels } = await loadModule('main/ipc/channels.ts')

const frames: Array<{ channel: string; payload: unknown }> = []
const offPush = onHeadlessPush((channel, payload) => frames.push({ channel, payload }))
after(() => {
  offPush()
  harness.dispose()
})

const poolChangedCount = (): number =>
  frames.filter(frame => frame.channel === IpcChannels.ROUTES_POOL_CHANGED).length

sm.addProvider({
  id: 'p1',
  name: 'Pool Event Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Model-One'],
  modelMappings: { 'Model-One': 'p1-upstream' },
  modelCapabilities: { 'Model-One': { tier: 'fast' } },
} as never)
sm.addAccount({
  id: 'p1-acct1',
  providerId: 'p1',
  name: 'p1 account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Model-One'],
} as never)

const created = sm.createRoute({ name: 'evt', enabled: true, strategy: 'round-robin' })
assert.equal(created.ok, true, JSON.stringify(created.error))
const route = created.route as ModelRoute

test('供应商启停：落盘即推 routes:pool-changed', () => {
  frames.length = 0
  sm.updateProvider('p1', { enabled: false })
  assert.ok(poolChangedCount() >= 1, '停用供应商必须通知路由页/托盘重取')
  frames.length = 0
  sm.updateProvider('p1', { enabled: true })
  assert.ok(poolChangedCount() >= 1, '重新启用同样通知')
})

test('模型停服/恢复（served）：推 routes:pool-changed', () => {
  frames.length = 0
  sm.setModelsServed('p1', ['Model-One'], false)
  assert.ok(poolChangedCount() >= 1, '停服写 userModelOverrides，是结构键')
  frames.length = 0
  sm.setModelsServed('p1', ['Model-One'], true)
  assert.ok(poolChangedCount() >= 1)
})

test('能力标注：推 routes:pool-changed', () => {
  frames.length = 0
  sm.setUserModelMark('p1', 'Model-One', { tier: 'strong' } as never)
  assert.ok(poolChangedCount() >= 1, '标注改变能力画像，从而改变池成员')
  sm.setUserModelMark('p1', 'Model-One', null)
})

test('纯评分补丁：不推 routes:pool-changed（避免每次点星整池重读）', () => {
  frames.length = 0
  const rated = sm.updateRoute(route.name, {
    modelRatings: [{ providerId: 'p1', displayName: 'Model-One', stars: 3 }],
  })
  assert.equal(rated.ok, true, JSON.stringify(rated.error))
  assert.equal(poolChangedCount(), 0, '评分是纯标注，不该触发池重取')

  // 清评分同样是纯 modelRatings 补丁，也不发。
  frames.length = 0
  sm.updateRoute(route.name, { modelRatings: [] })
  assert.equal(poolChangedCount(), 0)
})

test('路由结构编辑（exclude/include/enabled）：推 routes:pool-changed', () => {
  frames.length = 0
  const updated = sm.updateRoute(route.name, {
    excludeModels: [{ providerId: 'p1', displayName: 'Model-One' }],
  })
  assert.equal(updated.ok, true, JSON.stringify(updated.error))
  assert.ok(poolChangedCount() >= 1, '排除模型改池成员，必须通知')

  frames.length = 0
  sm.updateRoute(route.name, { enabled: false })
  assert.ok(poolChangedCount() >= 1, '路由启停同样通知')
  sm.updateRoute(route.name, { enabled: true, excludeModels: [] })
})

test('新建/删除路由：推 routes:pool-changed', () => {
  frames.length = 0
  const made = sm.createRoute({ name: 'evt-temp', enabled: true, strategy: 'round-robin' })
  assert.equal(made.ok, true, JSON.stringify(made.error))
  assert.ok(poolChangedCount() >= 1)

  frames.length = 0
  sm.deleteRoute('evt-temp')
  assert.ok(poolChangedCount() >= 1)
})

test('纯读与统计写：不推 routes:pool-changed', () => {
  frames.length = 0
  sm.getProviders()
  sm.getEffectiveModels('p1')
  sm.updateStatistics({})
  assert.equal(poolChangedCount(), 0, '读与每请求统计写都不该触发池重取')
})

// 2026-11-15 现网：每笔成功请求都写 accounts 的 lastUsed/requestCount/todayUsed，
// 而 accounts 是结构键 ⇒ 每请求 bump 修订号 + 推一次 pool-changed。路由页一次刷新
// 发两条全池扫描（实测 6.6 / 10.9 / 14.1s），12 分钟 56 条把主线程占满，回环转发
// 饿死成 read ECONNRESET（半小时 16 笔 502）。修订号还折在 preview 的 15s 缓存键里，
// 每请求 +1 等于缓存永远命中不了 —— 与 preview 注释声明的「每请求的写不 bump」相反。
test('每请求记账写：不推 pool-changed，也不 bump 结构修订号', () => {
  frames.length = 0
  const before = sm.getStructuralRevision()
  for (let i = 0; i < 5; i++) {
    sm.updateAccount('p1-acct1', {
      lastUsed: Date.now() + i,
      requestCount: i + 1,
      todayUsed: i + 1,
      todayUsedDay: '2026-11-15',
    })
  }
  assert.equal(poolChangedCount(), 0, '记账不改池成员，不该让路由页整池重扫')
  assert.equal(
    sm.getStructuralRevision(),
    before,
    '修订号折在 preview 缓存键里：记账 bump 会让 15s 短缓存永远失效',
  )
})

test('账号启停 / 凭据 / 每日上限：仍然推事件并 bump 修订号', () => {
  frames.length = 0
  const before = sm.getStructuralRevision()
  sm.updateAccount('p1-acct1', { status: 'inactive' })
  assert.ok(poolChangedCount() >= 1, '启停真的改池成员，投影不许把它一起摘掉')
  assert.ok(sm.getStructuralRevision() > before)

  frames.length = 0
  const mid = sm.getStructuralRevision()
  sm.updateAccount('p1-acct1', { status: 'active', dailyLimit: 500 })
  assert.ok(poolChangedCount() >= 1, 'dailyLimit 参与选路，不是记账')
  assert.ok(sm.getStructuralRevision() > mid)

  frames.length = 0
  const last = sm.getStructuralRevision()
  sm.updateAccount('p1-acct1', { credentials: { token: 'rotated-token' } })
  assert.ok(poolChangedCount() >= 1, '凭据轮换改可用性')
  assert.ok(sm.getStructuralRevision() > last)
})

test('记账写之后的真结构写仍然 bump（投影不许把快照写脏）', () => {
  sm.updateAccount('p1-acct1', { lastUsed: Date.now(), requestCount: 99 })
  frames.length = 0
  const before = sm.getStructuralRevision()
  sm.updateAccount('p1-acct1', { status: 'expired' })
  assert.ok(poolChangedCount() >= 1)
  assert.ok(sm.getStructuralRevision() > before)
  sm.updateAccount('p1-acct1', { status: 'active' })
})