/**
 * 2026-11-13「按建议实施」六条里，可在纯决策层证明的四条：
 *
 * 1. **钉失效快速失败**（`pinStale`）：软钉指向池外模型 → 本轮零候选 + 退役；
 *    持久 `preferredModel` 指同 → 不删配置，但日志/菜单读作「已失效」。
 * 2. **reason 在裁剪前算**：`single` 把链裁到同一模型，若用裁剪后的条数判
 *    `only` 会永远报 `only`（现网 29/29 行）。这里用「钉名池」与「点名命中」
 *    两个样本把两种原因分开钉住。
 * 3. **托盘固定默认 10 分钟**：路由级钉子会影响这条路由背后的所有客户端。
 * 4. **preview 短缓存**：返回的是隔离副本，调用方改不脏缓存。
 * 5. **能力下限 `minTier`**：低于下限的模型在策略与手动加回之前就被筛掉，
 *    空池报 `min_tier`，预览状态是 `below-tier`；写入侧拒绝怪值。
 *
 * fixture：三档各一个模型（fast / balanced / strong），fast 那个免费 ——
 * `prefer:'fast'` 下它是自然队首，`minTier` 的每一条都能用「谁能留下」证明。
 */
import { test } from 'node:test'
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
        stickyMinutes: 30,
        prefer: 'fast',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager

const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

function providerFixture(id: string, displayName: string, capabilities: Record<string, unknown>) {
  return {
    id,
    name: `Tier Provider ${id}`,
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
    modelCapabilities: { [displayName]: capabilities },
  }
}

sm.addProvider(providerFixture('pfast', 'Quick-Mini', { tier: 'fast', free: true }) as never)
sm.addProvider(providerFixture('pbal', 'Core-Mid', { tier: 'balanced' }) as never)
sm.addProvider(providerFixture('pstr', 'Heavy-Pro', { tier: 'strong' }) as never)

for (const [providerId, displayName] of [
  ['pfast', 'Quick-Mini'],
  ['pbal', 'Core-Mid'],
  ['pstr', 'Heavy-Pro'],
] as const) {
  sm.addAccount({
    id: `${providerId}-acct1`,
    providerId,
    name: `${providerId} account`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [displayName],
  } as never)
}

const REQUEST = {
  model: 'auto',
  messages: [{ role: 'user', content: 'one line question' }],
} as ChatCompletionRequest

let routeCounter = 0
function makeRoute(overrides: Record<string, unknown> = {}): ModelRoute {
  const name = `t${routeCounter++}`
  const created = sm.createRoute({
    name,
    enabled: true,
    strategy: 'round-robin',
    prefer: 'fast',
    maxAttempts: 3,
    stickyMinutes: 30,
    ...overrides,
  })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  return created.route as ModelRoute
}

const select = (route: ModelRoute, request: ChatCompletionRequest = REQUEST) =>
  autoRouter.select(request, 'round-robin', undefined, route)

// ---------------- 1. 钉失效快速失败 ----------------

test('软钉指向池外模型：本轮零候选，钉当场退役', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Ghost-Not-Served', scope: 'route', source: 'tray' })

  const decision = select(route)

  assert.equal(decision.pinMiss, 'Ghost-Not-Served', '失配要能被日志与响应头读到')
  assert.deepEqual(decision.pinStale, {
    displayName: 'Ghost-Not-Served',
    scope: 'route',
    source: 'tray',
    action: 'retired',
  })
  assert.deepEqual(decision.candidates, [],
    '不派任何候选 = 不产生上游调用；原先「照常按池服务」实测是客户端读到 3 次换实现')
  assert.equal(decision.pin?.displayName, 'Ghost-Not-Served', '本轮决策仍如实回显那颗被退役的钉')

  const next = select(route)
  assert.equal(next.pin, undefined, '退役是持久的：下一轮不该再用这颗钉')
  assert.equal(next.pinMiss, undefined)
  assert.equal(next.pinStale, undefined)
  assert.equal(next.candidates[0]?.displayName, 'Quick-Mini', '下一轮回到自动排序')
})

test('持久 preferredModel 指向池外模型：不删配置，照常服务但标记 ignored', () => {
  const route = makeRoute({
    modelScope: 'pool',
    preferredModel: { providerId: 'pzz', displayName: 'Ghost-Direct' },
  })

  const decision = select(route)

  assert.deepEqual(decision.pinStale, {
    displayName: 'Ghost-Direct',
    scope: 'route',
    source: 'console',
    action: 'ignored',
  })
  assert.ok(decision.candidates.length > 0, '配置错误不能让整条路由 503')
  const stored = sm.listModelRoutes().find(candidate => candidate.name === route.name)
  assert.deepEqual(stored?.preferredModel, { providerId: 'pzz', displayName: 'Ghost-Direct' },
    '撤销持久偏好只有 routes:unpin 一条路，选路阶段不许替用户删配置')
})

test('菜单：钉子指向池外模型时带 stale，不显示成「已固定」', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Ghost-Not-Served', scope: 'route', source: 'tray' })

  const menu = autoRouter.routeMenu(route)
  assert.equal(menu.pin?.displayName, 'Ghost-Not-Served')
  assert.equal(menu.pin?.stale, true)

  autoRouter.clearPin(route.name, 'route')
})

// ---------------- 2. reason 在裁剪前算 ----------------

test('reason：钉名池只有一个模型报 only（裁剪前），点名命中报 pin', () => {
  const narrowed = makeRoute({ pinModels: [{ providerId: 'pbal', displayName: 'Core-Mid' }] })
  assert.equal(select(narrowed).reason, 'only',
    '裁剪前池只有一个模型，原因就是「没得选」，不是打分赢的')

  const wide = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: wide.name, displayName: 'Core-Mid', scope: 'route', source: 'tray' })
  assert.equal(select(wide).reason, 'pin', '点名命中优先于 sticky/score')
})

// ---------------- 3. 托盘固定默认 10 分钟 ----------------

test('托盘固定默认 10 分钟：路由级钉子影响这条路由背后的每个客户端', () => {
  const route = makeRoute()
  const before = Date.now()
  const result = autoRouter.switchModel(
    { route: route.name, model: 'Core-Mid', source: 'tray' },
    sm.listModelRoutes(),
  )
  assert.equal(result.ok, true, result.reason)

  const until = result.menu?.pin?.until
  assert.ok(until !== undefined && until !== 0, '托盘固定有倒计时，不是持久偏好')
  const minutes = (until! - before) / 60_000
  assert.ok(minutes > 9.5 && minutes <= 10.5, `默认应是 10 分钟，实际 ${minutes.toFixed(1)}`)
})

// ---------------- 4. preview 短缓存 ----------------

test('preview：同一份池配置返回隔离副本，调用方改不脏缓存', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const first = autoRouter.preview(route)
  assert.ok(first.models.length > 0, '前置：池非空')

  first.models.length = 0
  first.missing.push('vision')

  const second = autoRouter.preview(route)
  assert.ok(second.models.length > 0, '缓存命中也要 clone：否则一次 UI 改动就把预览清空')
  assert.equal(second.missing.includes('vision'), false)
})

test('preview 缓存键不含标注：编辑器用 fresh 绕过读缓存拿到当下真值', () => {
  // 缓存键只含「路由 + 画像」：手工标注、账号增减都不在键里。菜单读 15 秒内的旧答案
  // 可以接受，但编辑器保存标注后立刻重取时必须看到新值 —— 否则「标了可用、预览说不可用」。
  const route = makeRoute({ modelScope: 'pool', minTier: 'strong' })
  assert.equal(
    autoRouter.preview(route).models.find(model => model.displayName === 'Quick-Mini')?.status,
    'below-tier',
  )

  sm.setUserModelMark('pfast', 'Quick-Mini', { tier: 'strong' } as never)
  assert.equal(
    autoRouter.preview(route).models.find(model => model.displayName === 'Quick-Mini')?.status,
    'below-tier',
    '前置：15 秒内命中旧缓存',
  )
  assert.equal(
    autoRouter.preview(route, {}, { fresh: true }).models.find(model => model.displayName === 'Quick-Mini')?.status,
    'kept',
    'fresh 要看到刚保存的标注',
  )

  sm.setUserModelMark('pfast', 'Quick-Mini', null)
})

// ---------------- 5. 能力下限 ----------------

test('minTier 是下限不是等号：至少 balanced 时 balanced 与 strong 都留下', () => {
  const route = makeRoute({ modelScope: 'pool', minTier: 'balanced' })
  const decision = select(route)

  const served = new Set(decision.candidates.map(candidate => candidate.displayName))
  assert.equal(served.has('Quick-Mini'), false, 'fast 档在下限之下，整条路由都不派')
  assert.equal(served.has('Core-Mid'), true)
  assert.equal(served.has('Heavy-Pro'), true)
  assert.equal(decision.candidates[0]?.displayName, 'Core-Mid',
    'single 作用域按打分取队首：prefer fast 下 balanced 比 strong 更接近目标')
})

test('minTier 把池筛空：报 min_tier，不报成池策略写错了', () => {
  const route = makeRoute({
    modelScope: 'pool',
    minTier: 'strong',
    // 手动加回也绕不过去：它是路基声明，不是策略
    includeModels: [{ providerId: 'pfast', displayName: 'Quick-Mini' }],
  })
  const decision = select(route)

  assert.deepEqual(decision.candidates.map(candidate => candidate.displayName), ['Heavy-Pro'],
    'strong 下限下只有 strong 模型；include 捞不回 fast')
})

test('minTier 筛空 + 没有任何模型达到档位：missing 明确写 min_tier', () => {
  // 只钉 fast 那个模型，再设 strong 下限 —— 基底被钉名收成 fast，再被下限清空
  const route = makeRoute({
    minTier: 'strong',
    pinModels: [{ providerId: 'pfast', displayName: 'Quick-Mini' }],
  })
  const decision = select(route)

  assert.deepEqual(decision.candidates, [])
  assert.deepEqual(decision.missing, ['min_tier'])
})

test('preview：低于下限的模型状态是 below-tier，空池原因同样是 min_tier', () => {
  const route = makeRoute({
    modelScope: 'pool',
    minTier: 'strong',
    pinModels: [{ providerId: 'pfast', displayName: 'Quick-Mini' }],
  })
  const preview = autoRouter.preview(route)

  assert.equal(preview.models.find(model => model.displayName === 'Quick-Mini')?.status, 'below-tier')
  assert.deepEqual(preview.missing, ['min_tier'])
})

test('写入侧拒绝怪 minTier：静默回落等于「选了 strong 却不生效」', () => {
  const created = sm.createRoute({ name: 'bad-tier', minTier: 'ultra' } as never)
  assert.equal(created.ok, false)
  assert.equal(created.error?.code, 'invalid_input')

  const route = makeRoute()
  const updated = sm.updateRoute(route.name, { minTier: 'ultra' } as never)
  assert.equal(updated.ok, false)
  assert.equal(updated.error?.code, 'invalid_input')

  const valid = sm.updateRoute(route.name, { minTier: 'balanced' })
  assert.equal(valid.ok, true, JSON.stringify(valid.error))
  assert.equal(
    sm.listModelRoutes().find(candidate => candidate.name === route.name)?.minTier,
    'balanced',
  )
})