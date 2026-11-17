/**
 * 账号级限流明细（`accountLimits`）：部分账号限流时，路由页也要说出来。
 *
 * 2026-11-17 现网缺陷：账号渠道页每行只有「限流 1 项」，而 `model.rateLimits`
 * 的判据是「**全部启用账号**该模型都限流才上报」（`account-pool.ts:72-86`）。
 * 3 个账号里 1 个限流时，路由页整行看起来完全正常 —— 用户判断不了「这条路由
 * 还有几个号能用」。
 *
 * 证明层次：真 `accountChannelManager` 的 `account.list` 汇总 + 真 `autoRouter.routeMenu`
 * 投影；worker 用替身（`bridgeOrThrow`）。
 */
import { test, after, beforeEach } from 'node:test'
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
      proxyPort: 8080,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      routes: {},
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager
const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')
const { markChannelRuntimeRunning } = await loadModule('main/providers/accountChannels/runtimeState.ts')

after(() => harness.dispose())

// 一家账号渠道、三颗模型；账号数 3。
sm.addProvider({
  id: 'opencode',
  name: 'OpenCode',
  type: 'account',
  authType: 'token',
  loginKind: 'api-key',
  apiEndpoint: 'channel://opencode',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Pickle', 'Live', 'Idle'],
  modelMappings: {
    Pickle: 'opencode/pickle',
    Live: 'opencode/live',
    Idle: 'opencode/idle',
  },
  credentialFields: [],
  supportsModelFetch: false,
} as never)
for (const id of ['a1', 'a2', 'a3']) {
  sm.addAccount({
    id: `opencode-${id}`,
    providerId: 'opencode',
    name: `acct ${id}`,
    credentials: {},
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  } as never)
}
const created = sm.createRoute({ name: 'auto', modelScope: 'single', prefer: 'cheap', poolStrategies: [] })
assert.equal(created.ok, true, '前置：auto 路由建得起来')

const HOUR = 3_600_000
let resetAt = 0

accountChannelManager.bridgeOrThrow = async () => ({
  models: async () => [
    // 生产形状（`toOpenAiModelIds` 拼的）：`<provider>/<裸模型 id>`。
    { id: 'opencode/pickle' },
    { id: 'opencode/live' },
    { id: 'opencode/idle' },
  ],
  rpc: async (method: string) => {
    if (method === 'account.list') {
      return {
        ok: true,
        value: {
          accounts: [
            // pickle：3 个账号里 2 个限流；live：全部 3 个限流；idle：都不限流。
            { id: 'a1', enabled: true, modelRateLimits: { pickle: resetAt, live: resetAt } },
            { id: 'a2', enabled: true, modelRateLimits: { pickle: resetAt + HOUR, live: resetAt + HOUR } },
            { id: 'a3', enabled: true, modelRateLimits: { live: resetAt } },
          ],
        },
      }
    }
    if (method === 'model.rateLimits') {
      // 全部账号都限流的模型才在这里上报（与 worker 同一判据）。
      return { ok: true, value: { rateLimits: { live: { limited: true, resetAtMs: resetAt } } } }
    }
    return { ok: true, value: {} }
  },
} as never)

beforeEach(() => {
  resetAt = Date.now() + 2 * HOUR
  autoRouter.reset()
  accountChannelManager.clearRateLimitCache()
})

/** 走一遍真实的预热 → 菜单投影。 */
async function menuModels(): Promise<Map<string, { total?: number; limited?: number; earliestResetAt?: number }>> {
  markChannelRuntimeRunning()
  await accountChannelManager.refreshPackServedInBackground()
  await new Promise(resolve => setTimeout(resolve, 20))
  await accountChannelManager.prewarmRateLimits()
  const route = sm.listModelRoutes().find(entry => entry.name === 'auto')
  assert.ok(route !== undefined)
  const menu = autoRouter.routeMenu(route, 200)
  const out = new Map<string, { total?: number; limited?: number; earliestResetAt?: number }>()
  for (const model of menu.models) out.set(model.displayName, model.accountLimits ?? {})
  return out
}

test('部分账号限流也要报出份数（不是只有全部限流才说）', async () => {
  const models = await menuModels()
  const pickle = models.get('Pickle')
  assert.ok(pickle !== undefined, '前置：Pickle 在菜单里')
  assert.equal(pickle?.total, 3, '分母是启用的账号数')
  assert.equal(pickle?.limited, 2, '3 个账号里 2 个限流')
  assert.equal(pickle?.earliestResetAt, resetAt, '恢复时刻取最早解禁的那个')
})

test('全部账号限流的模型：份数 = 总数，且 blocked 同步成立', async () => {
  const models = await menuModels()
  const live = models.get('Live')
  assert.equal(live?.total, 3)
  assert.equal(live?.limited, 3, '3 个账号全限流')
  const route = sm.listModelRoutes().find(entry => entry.name === 'auto')!
  const menu = autoRouter.routeMenu(route, 200)
  const row = menu.models.find(model => model.displayName === 'Live')
  assert.equal(row?.blocked?.reason, 'rate_limited', '全部限流时 blocked 仍然成立（两个口径不冲突）')
})

test('没有账号限流的模型不带这个格子（不制造「0 个限流」的噪声）', async () => {
  const models = await menuModels()
  const idle = models.get('Idle')
  assert.ok(idle !== undefined, '前置：Idle 在菜单里')
  assert.equal(idle?.limited, undefined, '未限流时不写 accountLimits')
})