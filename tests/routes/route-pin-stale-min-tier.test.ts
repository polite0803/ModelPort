/**
 * 钉与选路的纯决策层判据（裁定 2026-11-15：钉是持久硬钉，任何算法不得切换它）：
 *
 * 1. **钉失配拒答保钉**（`pinStale`）：钉指向池外模型 → 本轮零候选 + `action:'held'`，
 *    钉保留、不回落；内存钉与持久 `preferredModel` 同一套处置，配置不替用户删。
 * 2. **reason 在裁剪前算**：`single` 把链裁到同一模型，若用裁剪后的条数判
 *    `only` 会永远报 `only`（现网 29/29 行）。这里用「钉名池」与「点名命中」
 *    两个样本把两种原因分开钉住。
 * 3. **切换 = 钉住**：`switchModel` 只做命中校验，落盘由 `routes:switch` 统一做；
 *    菜单读到的钉 `until: 0`（持久，没有倒计时）。
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
import { localDayKey } from '../../src/shared/localDay.ts'
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

// ---------------- 1. 钉失配拒答保钉 ----------------

test('钉指向池外模型：本轮零候选，钉保留（held），下一轮仍然拒绝', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Ghost-Not-Served', scope: 'route', source: 'tray' })

  const decision = select(route)

  assert.equal(decision.pinMiss, 'Ghost-Not-Served', '失配要能被日志与响应头读到')
  assert.deepEqual(decision.pinStale, {
    displayName: 'Ghost-Not-Served',
    scope: 'route',
    source: 'tray',
    action: 'held',
  })
  assert.deepEqual(decision.candidates, [],
    '不派任何候选 = 不产生上游调用，也不回落别的模型')
  assert.equal(decision.pin?.displayName, 'Ghost-Not-Served', '本轮决策仍如实回显那颗钉')

  const next = select(route)
  assert.equal(next.pin?.displayName, 'Ghost-Not-Served', '钉不自动退役：只有用户手动替换/解除能改')
  assert.equal(next.pinStale?.action, 'held')
  assert.deepEqual(next.candidates, [], '下一轮仍然拒绝，不会悄悄回到自动排序')
})

test('持久 preferredModel 指向池外模型：不删配置、零候选、标记 held', () => {
  const route = makeRoute({
    modelScope: 'pool',
    preferredModel: { providerId: 'pzz', displayName: 'Ghost-Direct' },
  })

  const decision = select(route)

  assert.deepEqual(decision.pinStale, {
    displayName: 'Ghost-Direct',
    scope: 'route',
    source: 'console',
    action: 'held',
  })
  assert.deepEqual(decision.candidates, [], '钉是硬闸：不回落普通顺序（原先「照常按池服务」就是用户看到的「固定了还会切换」）')
  const stored = sm.listModelRoutes().find(candidate => candidate.name === route.name)
  assert.deepEqual(stored?.preferredModel, { providerId: 'pzz', displayName: 'Ghost-Direct' },
    '撤销只有 routes:unpin 一条路，选路阶段不许替用户删配置')
})

test('菜单：钉子指向池外模型时带 stale 标记（钉保留，本轮拒绝）', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Ghost-Not-Served', scope: 'route', source: 'tray' })

  const menu = autoRouter.routeMenu(route)
  assert.equal(menu.pin?.displayName, 'Ghost-Not-Served')
  assert.equal(menu.pin?.stale, true)

  autoRouter.clearPin(route.name, 'route')
})

test('冷却不是失效：钉住的账号在退避 → pinCooling，本轮不派候选但钉子留着', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Core-Mid', scope: 'route', source: 'console' })
  assert.equal(select(route).reason, 'pin', '前置：钉得住')

  autoRouter.markAccountCooldown('pbal-acct1', 504)

  const decision = select(route)
  assert.equal(decision.pinMiss, 'Core-Mid')
  assert.equal(decision.pinStale, undefined, '退避不是失效：不许退役用户的选择')
  assert.deepEqual(decision.candidates, [], '本轮零候选：中途换模型比等一次更伤')
  assert.equal(decision.pinCooling?.displayName, 'Core-Mid')
  assert.equal(decision.pinCooling?.scope, 'route')
  assert.equal(decision.pinCooling?.source, 'console')
  const retry = decision.pinCooling?.retryAfterSeconds ?? 0
  assert.ok(retry >= 13 && retry <= 15, `首次 5xx 退避 15s，实际报 ${retry}s`)

  // 钉子没有被退役：再问一次仍在，冷却清掉后立刻恢复命中
  assert.equal(select(route).pin?.displayName, 'Core-Mid')
  autoRouter.clearAccountCooldown('pbal-acct1')
  assert.equal(select(route).reason, 'pin')
})

test('持久 preferredModel 的账号在退避：pinCooling 拒答保钉，不回落别的模型', () => {
  // 裁定 2026-11-15：固定 = 独占。钉住的模型不可用时本轮拒绝（429 + Retry-After），
  // 绝不「由池子顶上」—— 那正是用户看到的「固定了还会切换」。
  const route = makeRoute({
    modelScope: 'pool',
    preferredModel: { providerId: 'pstr', displayName: 'Heavy-Pro' },
  })
  autoRouter.markAccountCooldown('pstr-acct1', 429, 'pstr-upstream')

  const decision = select(route)
  assert.equal(decision.pinStale, undefined, '冷却不是失效')
  assert.equal(decision.pinCooling?.displayName, 'Heavy-Pro')
  assert.equal(decision.pinMiss, 'Heavy-Pro', '没命中要如实写，界面据此知道这一轮为什么拒绝')
  assert.deepEqual(decision.candidates, [], '钉是硬闸：不派别的模型顶上')

  const stored = sm.listModelRoutes().find(candidate => candidate.name === route.name)
  assert.equal(stored?.preferredModel?.displayName, 'Heavy-Pro', '配置不替用户删')

  autoRouter.clearAccountCooldown('pstr-acct1')
  assert.equal(select(route).reason, 'pin', '冷却过去后回到钉本身')
})

test('钉住的模型这一轮用不了（缺视觉）：不退役、本轮 503 并写明缺什么', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Core-Mid', scope: 'route', source: 'console' })

  // 三个 fixture 都没有标注视觉：这张图谁都不满足，但钉子的错不在这里
  const withImage = {
    model: 'auto',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'what is in this picture' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ],
    }],
  } as unknown as ChatCompletionRequest

  const decision = select(route, withImage)
  assert.equal(decision.pinStale, undefined, '一张图不该把用户固定的模型撤掉')
  assert.deepEqual(decision.pinBlocked, {
    displayName: 'Core-Mid',
    scope: 'route',
    source: 'console',
    missing: ['vision'],
  })
  assert.deepEqual(decision.candidates, [], '本轮不换家：换模型只发生在回合之间')

  assert.equal(select(route).reason, 'pin', '下一张纯文本请求仍然命中同一颗钉')
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

// ---------------- 3. 切换 = 钉住（持久，无倒计时） ----------------

test('切换只做命中校验：路由级钉不写内存，落盘后菜单读到 until 0', () => {
  const route = makeRoute()
  const result = autoRouter.switchModel(
    { route: route.name, model: 'Core-Mid', source: 'tray' },
    sm.listModelRoutes(),
  )
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.providerId, 'pbal', '命中的是哪一家由选路说了算，落盘要原样写')
  assert.equal(autoRouter.pinFor(route.name), undefined,
    '控制台与托盘同一颗钉：统一落盘成 preferredModel，不走内存')

  const written = sm.updateRoute(route.name, {
    preferredModel: { providerId: result.providerId!, displayName: result.model! },
  })
  assert.equal(written.ok, true, JSON.stringify(written.error))
  const fresh = sm.listModelRoutes().find(candidate => candidate.name === route.name)!
  const menu = autoRouter.routeMenu(fresh)
  assert.equal(menu.pin?.displayName, 'Core-Mid')
  assert.equal(menu.pin?.until, 0, '钉住即持久：没有倒计时（退役面：托盘 10 分钟 / 控制台 30 分钟）')
})

test('固定 = 独占：pool 作用域下有钉也只派被钉的模型，路由算法不生效', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const written = sm.updateRoute(route.name, {
    preferredModel: { providerId: 'pbal', displayName: 'Core-Mid' },
  })
  assert.equal(written.ok, true, JSON.stringify(written.error))
  const fresh = sm.listModelRoutes().find(candidate => candidate.name === route.name)!

  const decision = select(fresh)
  assert.equal(decision.reason, 'pin')
  assert.ok(decision.candidates.length > 0, '前置：池非空')
  assert.deepEqual(
    [...new Set(decision.candidates.map(candidate => candidate.displayName))],
    ['Core-Mid'],
    'pool 的跨模型换家在有钉时关闭：失败只换账号，不换模型',
  )
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

test('preview 缓存键含结构修订号：标注一落盘，下一次预览立刻重算（无需 fresh）', () => {
  // 结构写修订号（2026-11-15，批 A）折进缓存键：手工标注改变能力画像、从而改变池成员，
  // 落盘即 bump，预览/菜单下一次读就是新池 —— 不再停在 ≤15s 的旧快照上。
  // （旧契约「标注不在键里、菜单读旧答案可接受」正是「停了还在池里」那类显示层滞后的根因。）
  const route = makeRoute({ modelScope: 'pool', minTier: 'strong' })
  assert.equal(
    autoRouter.preview(route).models.find(model => model.displayName === 'Quick-Mini')?.status,
    'below-tier',
  )

  sm.setUserModelMark('pfast', 'Quick-Mini', { tier: 'strong' } as never)
  assert.equal(
    autoRouter.preview(route).models.find(model => model.displayName === 'Quick-Mini')?.status,
    'kept',
    '结构写后无需 fresh：缓存键已随修订号变化',
  )

  sm.setUserModelMark('pfast', 'Quick-Mini', null)
  assert.equal(
    autoRouter.preview(route).models.find(model => model.displayName === 'Quick-Mini')?.status,
    'below-tier',
    '撤标注同样立刻生效',
  )
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

// ---------------- 6. 结构写修订号：启停立刻穿透 preview 短缓存（批 A） ----------------

test('供应商停用：preview/menu 立刻不再列它的模型，无需 fresh、无需等 15 秒', () => {
  const route = makeRoute({ modelScope: 'pool' })
  assert.ok(
    autoRouter.preview(route).models.some(model => model.displayName === 'Core-Mid'),
    '前置：启用时在池里',
  )

  sm.updateProvider('pbal', { enabled: false })
  // 路由配置一个字没变（缓存键的池部分相同），旧契约会把这份快照再端 ≤15s。
  assert.equal(
    autoRouter.preview(route).models.some(model => model.displayName === 'Core-Mid'),
    false,
    '停用后下一次 preview 立刻剔除（结构修订号已折进缓存键）',
  )
  assert.equal(
    autoRouter.routeMenu(route).models.some(model => model.displayName === 'Core-Mid'),
    false,
    '托盘/控制台菜单读同一份 preview，也立刻剔除',
  )

  sm.updateProvider('pbal', { enabled: true })
  assert.ok(
    autoRouter.preview(route).models.some(model => model.displayName === 'Core-Mid'),
    '重新启用立刻回到池里',
  )
})

test('模型停服（served=false）：preview 立刻剔除，恢复后立刻回来', () => {
  const route = makeRoute({ modelScope: 'pool' })
  assert.ok(
    autoRouter.preview(route).models.some(model => model.displayName === 'Heavy-Pro'),
    '前置：在服时在池里',
  )

  sm.setModelsServed('pstr', ['Heavy-Pro'], false)
  assert.equal(
    autoRouter.preview(route).models.some(model => model.displayName === 'Heavy-Pro'),
    false,
    '停服写的是 userModelOverrides（结构键），立刻穿透缓存',
  )

  sm.setModelsServed('pstr', ['Heavy-Pro'], true)
  assert.ok(
    autoRouter.preview(route).models.some(model => model.displayName === 'Heavy-Pro'),
    '恢复在服立刻回来',
  )
})

test('结构修订号：只认真正改变池的写，纯读与统计写不 bump（保住短缓存）', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const baseline = sm.getStructuralRevision()

  autoRouter.preview(route)
  autoRouter.preview(route)
  assert.equal(sm.getStructuralRevision(), baseline, '纯读不 bump：15s 短缓存对高频读仍然有效')

  sm.updateStatistics({})
  assert.equal(sm.getStructuralRevision(), baseline, '统计写不在结构键里：每请求落盘不打穿缓存')

  sm.updateProvider('pbal', { enabled: false })
  assert.ok(sm.getStructuralRevision() > baseline, '供应商启停 bump')
  sm.updateProvider('pbal', { enabled: true })
})

// ---------------- 7. 瞬时剔除与钉拒答：成因不许撒谎（2026-11-16） ----------------

test('钉住的账号当日打满：pinTransient 拒答保钉，不报 pin_stale、不回落', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Core-Mid', scope: 'route', source: 'console' })
  assert.equal(select(route).reason, 'pin', '前置：钉得住')

  sm.updateAccount('pbal-acct1', {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })

  const decision = select(route)
  assert.equal(decision.pinStale, undefined, '模型仍在路由里：窗口打满不许退役一颗好钉')
  assert.equal(decision.pinTransient?.displayName, 'Core-Mid')
  assert.equal(decision.pinTransient?.cause, 'daily_limit')
  assert.ok((decision.pinTransient?.retryAfterSeconds ?? 0) >= 1, '要给出可重试的时刻')
  assert.deepEqual(decision.candidates, [], '钉是硬闸：不派别的模型顶上')
  assert.equal(decision.transientUnavailable, undefined, '钉拒答自带形状，不借整池投影')
  assert.equal(decision.pin?.displayName, 'Core-Mid', '保钉')

  sm.updateAccount('pbal-acct1', { todayUsedDay: '2000-01-01' })
  assert.equal(select(route).reason, 'pin', '日期键复位后回到钉本身')
})

test('钉被能力挡下 + 无关模型瞬时剔除：不报整池 transientUnavailable（现网 22.9 天谎报）', () => {
  // Heavy-Pro 能看图、钉 Quick-Mid 不能：这张图被钉挡下，与 Core-Mid 当日打满
  // 无关。旧代码把无关剔除汇总成 429 + 午夜 Retry-After —— 成因与时刻双双撒谎。
  sm.updateProvider('pstr', {
    modelCapabilities: { 'Heavy-Pro': { tier: 'strong', vision: 'yes' } },
  })
  sm.updateAccount('pbal-acct1', {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Quick-Mini', scope: 'route', source: 'console' })

  const withImage = {
    model: 'auto',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'what is in this picture' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ],
    }],
  } as unknown as ChatCompletionRequest

  const decision = select(route, withImage)
  assert.deepEqual(decision.pinBlocked?.missing, ['vision'], '前置：这一轮是钉缺视觉挡下的')
  assert.equal(decision.transientUnavailable, undefined, '空池是钉造成的，不是 Core-Mid 的当日上限')
  assert.deepEqual(decision.candidates, [])

  sm.updateAccount('pbal-acct1', { todayUsedDay: '2000-01-01' })
  sm.updateProvider('pstr', { modelCapabilities: { 'Heavy-Pro': { tier: 'strong' } } })
})

test('幽灵钉 + 无关瞬时剔除：仍然 pin_stale，不翻 429', () => {
  sm.updateAccount('pbal-acct1', {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Ghost-Not-Served', scope: 'route', source: 'tray' })

  const decision = select(route)
  assert.equal(decision.pinStale?.action, 'held', '名字真不在池里：这才是 pin_stale')
  assert.equal(decision.pinTransient, undefined)
  assert.equal(decision.transientUnavailable, undefined)

  sm.updateAccount('pbal-acct1', { todayUsedDay: '2000-01-01' })
})

test('钉的一个账号当日打满、另一个健康：派健康的，不整轮拒答', () => {
  sm.addAccount({
    id: 'pbal-acct2',
    providerId: 'pbal',
    name: 'pbal account 2',
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    supportedModels: ['Core-Mid'],
  } as never)
  sm.updateAccount('pbal-acct1', {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Core-Mid', scope: 'route', source: 'console' })

  const decision = select(route)
  assert.equal(decision.reason, 'pin')
  assert.equal(decision.pinTransient, undefined, '还有一个健康账号就不算「全被挡下」')
  assert.deepEqual(decision.candidates.map(candidate => candidate.account.id), ['pbal-acct2'])

  sm.updateAccount('pbal-acct1', { todayUsedDay: '2000-01-01' })
  sm.deleteAccount('pbal-acct2')
})