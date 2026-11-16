/**
 * 时变折价在**真选路**里的两件事：生效价按本地时钟取，静态 `free` 让位。
 *
 * ## 被证明的缺陷（2026-11-16）
 *
 * 渠道包一直知道「这个模型夜里 0 白天 0.29」，但它把这个窗口折叠进展示名的
 * 箭头里、且**只在窗口开着时**才印 —— 于是宿主手里只剩采集那一刻的一个数，
 * 缓存整个目录 TTL。两条后果：跨窗口边界的请求按上一侧的价计分；夜里 0 白天
 * 0.29 的模型被 `hint.free` 判成 24 小时免费，`cheap` 偏好全天都往它身上派。
 *
 * 证明层次：真 `storeManager` + 真 `autoRouter.preview()` 的返回值（`costBucket`
 * 与 `weight` 就是打分读的那两个字段）。窗口用「已经过去的截止时间」和「很久
 * 以后才到期」两种绝对时刻构造，所以断言与跑测试的钟点无关。
 *
 * 不在本层证明：真实渠道包的 `model.list` 上抛（`tests/channels/model-catalog.test.ts`
 * 钉归一化那一半），以及页面徽标的渲染（`useDiscountClock` 与 `Channels.tsx`）。
 */
import { test } from 'node:test'
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
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'cheap', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

/** 很久以后才到期（窗口开着），与早已到期（窗口关着）：两个绝对时刻。 */
const OPEN_UNTIL = Date.parse('2099-01-01T00:00:00Z')
const CLOSED_UNTIL = Date.parse('2020-01-01T00:00:00Z')

function channel(id: string, displayName: string, hint: Record<string, unknown>): void {
  sm.addProvider({
    id,
    name: `Window ${id}`,
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
    modelCapabilities: { [displayName]: hint },
  } as never)
  sm.addAccount({
    id: `${id}-acct`,
    providerId: id,
    name: `${id} account`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [displayName],
  } as never)
}

// 夜里免费、白天 x0.29 的模型：`weight` 是采集价（白天那一侧），`promoWeight`
// 是窗口内的价。`free: true` 是采集那一刻的结论。
channel('popen', 'Night-Owl', {
  weight: 0.29,
  baseWeight: 0.29,
  promoWeight: 0,
  free: true,
  discountWindow: { validFrom: 1, validUntil: OPEN_UNTIL },
})
channel('pclosed', 'Day-Owl', {
  weight: 0.29,
  baseWeight: 0.29,
  promoWeight: 0,
  free: true,
  discountWindow: { validUntil: CLOSED_UNTIL },
})
// 对照组：没有窗口的免费模型，行为必须一个字都不变。
channel('pstatic', 'Always-Free', { free: true })

let counter = 0
function routeOf(): ModelRoute {
  const created = sm.createRoute({
    name: `dw${counter++}`,
    enabled: true,
    strategy: 'round-robin',
    prefer: 'cheap',
    maxAttempts: 2,
    stickyMinutes: 0,
    modelScope: 'pool',
  })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  return created.route as ModelRoute
}

function row(route: ModelRoute, displayName: string) {
  // `fresh` 跳过读缓存：同一个池的预览有 15 s 短缓存，而这里问的正是「此刻」。
  const model = autoRouter.preview(route, {}, { fresh: true }).models
    .find(entry => entry.displayName === displayName)
  assert.ok(model !== undefined, `${displayName} should be in the pool`)
  return model
}

test('窗口开着时按窗口内的价计分：0 就是免费', () => {
  const route = routeOf()
  const open = row(route, 'Night-Owl')
  assert.equal(open.weight, 0, '生效价取的是 promoWeight，不是采集价')
  assert.equal(open.costBucket, 'free')
})

test('窗口关着时按原价计分，静态 free 不再把它说成免费', () => {
  // 这一条就是缺陷本身：`free: true` 是采集那一刻的结论，窗口一关它已经不成立。
  // 旧实现把 24 小时都判成免费，`cheap` 偏好因此整天往一个按量计费的模型上派。
  const route = routeOf()
  const closed = row(route, 'Day-Owl')
  assert.equal(closed.weight, 0.29)
  assert.equal(closed.costBucket, 'below-base')
})

test('没有窗口的免费模型仍然免费：静态标记没被削弱', () => {
  const route = routeOf()
  const always = row(route, 'Always-Free')
  assert.equal(always.costBucket, 'free')
})

test('同一个池里三个模型的成本档分别成立，互不影响', () => {
  const route = routeOf()
  const buckets = new Map(
    autoRouter.preview(route, {}, { fresh: true }).models
      .map(model => [model.displayName, model.costBucket]),
  )
  assert.equal(buckets.get('Night-Owl'), 'free')
  assert.equal(buckets.get('Day-Owl'), 'below-base')
  assert.equal(buckets.get('Always-Free'), 'free')
})
