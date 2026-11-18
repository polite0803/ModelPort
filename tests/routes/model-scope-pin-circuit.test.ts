/**
 * 架构 A（2026-11-13）：一轮只用一个模型，外加「快速切换」的三条通路。
 *
 * 被证明的三件事，各有一组用例：
 * 1. **作用域裁剪**（`ModelRoute.modelScope`）：`single`（缺省）只留队首模型的账号，
 *    `family` 留同一份实现的同名家族，`pool` 才是原来那套全池换家。裁剪之后一轮里
 *    换家只换账号 —— 中途换模型是「客户端莫名其妙崩掉」的主要来源。
 * 2. **钉**（`setPin` / `preferredModel`，裁定 2026-11-15：持久硬钉、固定即独占）：
 *    有钉时这一轮只派被钉的模型（`pool` 的跨模型换家也关掉），优先于粘性、优先于
 *    熔断；钉不上时不静默（`pinMiss`）且拒答保钉，否则托盘显示的选择与实际行为会长期不一致。
 * 3. **模型级熔断**（`tripModelCircuit`）：退化过的模型在**下一轮**排到队尾 —— 这是
 *    `single` 下唯一的中途换家通道。全池都在熔断时这张票不生效（跳过没有落脚点就
 *    等于把这一轮变成空池），成功一次即清票。
 *
 * 证明的层次：真 `storeManager` + 真 `autoRouter` 的返回值（`candidates` / `reason` /
 * `modelScope` / `pin` / `pinMiss` / `circuited` / `wallClockBudgetMs` / `routeMenu` /
 * `switchModel`）。不碰 HTTP、不碰 Electron、不碰上游网络 —— 请求级的那两层在
 * `proxy-routes-*.test.ts` 与 `tests/shell/` 里各自证明。
 *
 * fixture 的顺序前提：四家各一个模型、都 `tier:'fast'`，只有 Alpha-Flash 标了
 * `free:true`（`prefer:'fast'` 下成本档领先 0.1），所以「自然队首」是它；另外
 * `Vertex/Alpha-Flash` 与它同属一个同名家族（`modelFamilyKey` 去掉前缀后相等），
 * 是 `family` 那一档的判别样本。
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
    name: `Scope Provider ${id}`,
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

sm.addProvider(providerFixture('pa', 'Alpha-Flash', { tier: 'fast', free: true }) as never)
sm.addProvider(providerFixture('pb', 'Beta-Lite', { tier: 'fast' }) as never)
sm.addProvider(providerFixture('pc', 'Gamma-Mini', { tier: 'fast' }) as never)
sm.addProvider(providerFixture('pf', 'Vertex/Alpha-Flash', { tier: 'fast' }) as never)

function accountFixture(providerId: string, index = 1) {
  return {
    id: `${providerId}-acct${index}`,
    providerId,
    name: `${providerId} account ${index}`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  }
}
for (const id of ['pa', 'pb', 'pc', 'pf']) sm.addAccount(accountFixture(id) as never)
// 同一模型的第二把 Key：`single` 要留的是**这个模型的全部账号**，不是「一个候选」。
sm.addAccount(accountFixture('pa', 2) as never)

const REQUEST = {
  model: 'auto',
  messages: [{ role: 'user', content: 'one line question' }],
} as ChatCompletionRequest

let routeCounter = 0
function makeRoute(overrides: Record<string, unknown> = {}): ModelRoute {
  const name = `s${routeCounter++}`
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

const modelsIn = (decision: { candidates: Array<{ displayName: string }> }) =>
  [...new Set(decision.candidates.map(candidate => candidate.displayName))].sort()

beforeEach(() => {
  autoRouter.reset()
})

after(() => {
  autoRouter.reset()
  harness.dispose()
})

// ------------------------------------------------------------- 1. 作用域裁剪

test('缺省是 single：候选只剩队首模型的账号，墙钟预算收到 40s', () => {
  const route = makeRoute()
  const decision = select(route)

  assert.equal(decision.modelScope, 'single', '没写 modelScope 的存量路由落到 single，这是架构 A 的缺省')
  assert.equal(decision.candidates[0].displayName, 'Alpha-Flash', '自然队首仍是打分第一（免费那家）')
  assert.deepEqual(modelsIn(decision), ['Alpha-Flash'], '一轮只留一个模型')
  assert.equal(decision.candidates.length, 2, '留下的是这个模型的**全部账号**（pa 两把 Key）')
  assert.equal(decision.model, 'Alpha-Flash', '日志/菜单读的 model 与 candidates[0] 同源')
  assert.equal(decision.wallClockBudgetMs, 40_000, '单模型的链只剩同模型账号，90s 池预算没有意义')
})

test('family：同一份实现的同名家族留下，异名模型被裁掉', () => {
  const route = makeRoute({ modelScope: 'family' })
  const decision = select(route)

  assert.equal(decision.modelScope, 'family')
  assert.deepEqual(modelsIn(decision), ['Alpha-Flash', 'Vertex/Alpha-Flash'],
    'modelFamilyKey 去掉供应商前缀后同名 ⇒ 同一份实现')
  assert.equal(decision.wallClockBudgetMs, undefined, '只有 single 才收短预算')
})

test('pool：不裁剪（对照组，证明上面两条不是「什么都没做」）', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const decision = select(route)

  assert.equal(decision.modelScope, 'pool')
  assert.deepEqual(modelsIn(decision), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini', 'Vertex/Alpha-Flash'])
  assert.equal(decision.wallClockBudgetMs, undefined)
})

// ---------------------------------------------------------- 2. 钉（持久硬钉）

test('钉：点名的模型排到队首，并压过粘性（用户意图高于历史惯性）', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const fresh = select(route)
  // 先让上一轮锚在 Alpha-Flash：没有钉子时它会被硬粘性提到队首
  autoRouter.rememberRoute(fresh.conversationKey,
    fresh.candidates.find(candidate => candidate.displayName === 'Alpha-Flash')!, route)
  assert.equal(select(route).candidates[0].displayName, 'Alpha-Flash', '前置：锚点确实生效')

  const pin = autoRouter.setPin({
    route: route.name,
    displayName: 'Beta-Lite',
    scope: 'route',
    source: 'tray',
  })
  const decision = select(route)

  assert.equal(decision.candidates[0].displayName, 'Beta-Lite', '钉优先于粘性')
  assert.deepEqual(decision.pin, {
    displayName: 'Beta-Lite',
    scope: 'route',
    source: 'tray',
    until: pin.until,
  })
  assert.equal(decision.pinMiss, undefined)
})

test('钉优先于熔断：用户钉了它，熔断票不是否决权', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.tripModelCircuit(route.name, 'Beta-Lite', 'empty-turn')
  assert.deepEqual(select(route).circuited, ['Beta-Lite'], '前置：熔断票在生效，Beta 被排到队尾')

  autoRouter.setPin({ route: route.name, displayName: 'Beta-Lite', scope: 'route', source: 'tray' })
  const decision = select(route)

  assert.equal(decision.candidates[0].displayName, 'Beta-Lite')
  assert.equal(decision.circuited, undefined, '有显式选择时熔断不参与排序')
})

test('钉不上不静默：拒答保钉（held），本轮快速失败、下一轮仍然拒绝', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.setPin({ route: route.name, displayName: 'Ghost-Not-Served', scope: 'route', source: 'tray' })

  const decision = select(route)

  assert.equal(decision.pinMiss, 'Ghost-Not-Served', '钉子没命中要能被日志与响应头读到')
  assert.equal(decision.pin?.displayName, 'Ghost-Not-Served', '「生效中的选择」如实回显，便于托盘对账')
  assert.equal(decision.pinStale?.action, 'held', '钉保留：只有用户手动替换/解除能改（裁定 2026-11-15）')
  assert.deepEqual(decision.candidates, [], '不派候选 = 不产生上游调用，也不回落别的模型')

  const next = select(route)
  assert.equal(next.pin?.displayName, 'Ghost-Not-Served', '钉不自动退役')
  assert.deepEqual(next.candidates, [], '下一轮仍然拒绝，不会悄悄回到自动排序')
})

test('持久钉 preferredModel：与内存钉同效，until 0 = 没有倒计时', () => {
  const route = makeRoute({
    modelScope: 'pool',
    preferredModel: { providerId: 'pc', displayName: 'Gamma-Mini' },
  })
  const decision = select(route)

  assert.equal(decision.candidates[0].displayName, 'Gamma-Mini')
  assert.deepEqual(decision.pin, {
    displayName: 'Gamma-Mini',
    scope: 'route',
    source: 'console',
    until: 0,
  }, '持久钉没有倒计时：until 0 在界面上读作「一直」')

  const menu = autoRouter.routeMenu(route)
  assert.equal(menu.pin?.until, 0)
  assert.equal(menu.models.find(model => model.displayName === 'Gamma-Mini')?.pinned, true)
})

test('钉可写可清：控制台「固定」走的 updateRoute 这一来一回', () => {
  const route = makeRoute()
  const written = sm.updateRoute(route.name, {
    preferredModel: { providerId: 'pc', displayName: 'Gamma-Mini' },
  })
  assert.equal(written.ok, true, JSON.stringify(written.error))

  const pinned = sm.listModelRoutes().find(candidate => candidate.name === route.name)!
  assert.deepEqual(pinned.preferredModel, { providerId: 'pc', displayName: 'Gamma-Mini' })
  assert.equal(select(pinned).candidates[0].displayName, 'Gamma-Mini',
    '写进配置就生效，不需要再点一次')

  const cleared = sm.updateRoute(route.name, { preferredModel: undefined })
  assert.equal(cleared.ok, true, JSON.stringify(cleared.error))
  const after = sm.listModelRoutes().find(candidate => candidate.name === route.name)!
  assert.equal(after.preferredModel, undefined,
    'undefined 要把整格从盘上去掉；留着旧值等于「恢复自动排序」没用')
  assert.equal(select(after).candidates[0].displayName, 'Alpha-Flash', '清掉后回到打分顺序')
})

test('客户端点名（第 6 个参数）落成会话级持久钉：只影响这一段会话', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const session = { value: 'thread-pin', source: 'prompt_cache_key' } as const

  const pinned = autoRouter.select(REQUEST, 'round-robin', undefined, route, session, {
    displayName: 'Gamma-Mini',
  })
  assert.equal(pinned.candidates[0].displayName, 'Gamma-Mini')
  assert.equal(pinned.pin?.scope, 'session')
  assert.equal(pinned.pin?.source, 'header')

  // 同一段会话的下一轮沿用；另一段会话不受影响
  assert.equal(
    autoRouter.select(REQUEST, 'round-robin', undefined, route, session).candidates[0].displayName,
    'Gamma-Mini',
  )
  assert.equal(select(route).candidates[0].displayName, 'Alpha-Flash', '别的会话照常打分')
})

// ------------------------------------------------------------- 3. 模型级熔断

test('熔断：next 轮换模型 —— single 下唯一的中途换家通道', () => {
  const route = makeRoute()
  assert.equal(select(route).candidates[0].displayName, 'Alpha-Flash')

  autoRouter.tripModelCircuit(route.name, 'Alpha-Flash', 'announced-stop')
  const decision = select(route)

  assert.deepEqual(decision.circuited, ['Alpha-Flash'])
  const head = decision.candidates[0].displayName
  assert.notEqual(head, 'Alpha-Flash', '退化过的模型不在下一轮上台')
  assert.deepEqual(modelsIn(decision), [head], '换的仍然是**一个**模型：作用域裁剪在熔断之后')
})

test('全池都在熔断：这张票不生效（跳过没有落脚点就等于空池）', () => {
  const route = makeRoute()
  for (const name of ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini', 'Vertex/Alpha-Flash']) {
    autoRouter.tripModelCircuit(route.name, name, 'repetition')
  }

  const decision = select(route)
  assert.equal(decision.circuited, undefined)
  assert.equal(decision.candidates[0].displayName, 'Alpha-Flash', '全池熄火时回到正常排序')
})

test('熔断票的两条生命周期：到期自解，成功清票', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const now = Date.now()
  autoRouter.tripModelCircuit(route.name, 'Alpha-Flash', 'empty-turn', 1, now)

  assert.equal(typeof autoRouter.modelCircuitUntil(route.name, 'Alpha-Flash', now + 60_000 - 1), 'number')
  assert.equal(autoRouter.modelCircuitUntil(route.name, 'Alpha-Flash', now + 60_000 + 1), undefined,
    'TTL 之内有效，过了就自解')

  autoRouter.tripModelCircuit(route.name, 'Beta-Lite', 'empty-turn')
  const beta = select(route).candidates.find(candidate => candidate.displayName === 'Beta-Lite')!
  autoRouter.rememberRoute(undefined, beta, route)
  assert.equal(autoRouter.modelCircuitUntil(route.name, 'Beta-Lite'), undefined,
    '同一模型成功一次就清票：一次抖动不该锁满 TTL')
})

// --------------------------------------------------------------- 4. 菜单快照

test('菜单：当前服务的模型排最前并打上 current，被钉的带 pinned', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.noteServedModel(route.name, {
    provider: { id: 'pc', name: 'Scope Provider pc' },
    displayName: 'Gamma-Mini',
  })

  const menu = autoRouter.routeMenu(route)

  assert.equal(menu.route, route.name)
  assert.equal(menu.enabled, true)
  assert.equal(menu.modelScope, 'pool')
  assert.equal(menu.current?.displayName, 'Gamma-Mini')
  assert.equal(menu.models[0].displayName, 'Gamma-Mini', '当前模型排最前')
  assert.equal(menu.models[0].current, true)
  assert.equal(menu.totalModels, 4)

  autoRouter.setPin({ route: route.name, displayName: 'Beta-Lite', scope: 'route', source: 'tray' })
  const pinnedMenu = autoRouter.routeMenu(route)
  assert.equal(pinnedMenu.pin?.displayName, 'Beta-Lite')
  assert.equal(pinnedMenu.models.find(model => model.displayName === 'Beta-Lite')?.pinned, true)
  assert.equal(pinnedMenu.models.find(model => model.displayName === 'Alpha-Flash')?.pinned, false)
})

test('菜单：熔断中的模型带 circuitUntil，limit 只影响列表长度不影响 totalModels', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const until = autoRouter.tripModelCircuit(route.name, 'Gamma-Mini', 'repetition').until

  const menu = autoRouter.routeMenu(route, 2)
  assert.equal(menu.models.length, 2, '托盘子菜单再长就滚不动了')
  assert.equal(menu.totalModels, 4, '总数如实给，截断只发生在列表')

  const full = autoRouter.routeMenu(route)
  assert.equal(full.models.find(model => model.displayName === 'Gamma-Mini')?.circuitUntil, until)
  assert.equal(full.models.find(model => model.displayName === 'Beta-Lite')?.circuitUntil, undefined)
})

test('菜单：能力解析只在显式索取时带出，且与选路读的是同一份', () => {
  const route = makeRoute({ modelScope: 'pool' })

  const plain = autoRouter.routeMenu(route)
  assert.ok(plain.models.every(model => model.capability === undefined),
    '托盘不画能力徽标：默认不载荷来源表，免得每次快捷切换都变重')

  // 第 6 参才是 includeCapability：前五个沿用既有语义（limit / now / 账号池 / 含被筛行）。
  const withCapability = autoRouter.routeMenu(route, 2, Date.now(), undefined, false, true)
  assert.ok(withCapability.models.length > 0)
  for (const model of withCapability.models) {
    assert.ok(model.capability !== undefined, `${model.displayName} 缺能力解析`)
    assert.ok(model.capability.sources !== undefined, `${model.displayName} 缺每格的出处`)
  }

  // 与 `hardFilterFailure` 同一份解析：Alpha-Flash 的档位来自供应商记录而不是名字启发式，
  // 所以标注一改，行上显示的判据随之改 —— 显示面与派发面不许各算一次。
  const alpha = withCapability.models.find(model => model.displayName === 'Alpha-Flash')
  assert.ok(alpha?.capability !== undefined)
  assert.equal(alpha.capability.tier, 'fast')
  assert.equal(alpha.capability.tierEvidenced, true, '档位来自标注，不是名字启发式')
  assert.equal(alpha.capability.sources.tier, 'provider-record',
    '出处如实报给界面：这一格来自供应商记录，不是页面自己猜的')
})

test('菜单：池被筛空时列不出模型，但路由本身仍然可读', () => {
  const route = makeRoute({ poolStrategies: [{ id: 'aggregate-only', operator: 'and' }] })
  const menu = autoRouter.routeMenu(route)

  assert.deepEqual(menu.models, [])
  assert.equal(menu.totalModels, 0)
  assert.equal(menu.route, route.name, '空池不是「路由不存在」')
})

test('菜单：星级推荐按 (providerId, displayName) 投影到行上，未评分不落键，也不改选路顺序', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const written = sm.updateRoute(route.name, {
    modelRatings: [
      { providerId: 'pb', displayName: 'Beta-Lite', stars: 5 },
      { providerId: 'pc', displayName: 'Gamma-Mini', stars: 2 },
    ],
  })
  assert.equal(written.ok, true, JSON.stringify(written.error))
  const rated = sm.listModelRoutes().find(candidate => candidate.name === route.name)!

  const menu = autoRouter.routeMenu(rated)
  assert.equal(menu.models.find(model => model.displayName === 'Beta-Lite')?.rating, 5)
  assert.equal(menu.models.find(model => model.displayName === 'Gamma-Mini')?.rating, 2)
  assert.equal(menu.models.find(model => model.displayName === 'Alpha-Flash')?.rating, undefined,
    '没评过分的行不落 rating 键')

  // 纯标注：队首仍是打分第一，评分不参与选路，也不重排菜单。
  assert.equal(select(rated).candidates[0].displayName, 'Alpha-Flash',
    '5 星的 Beta-Lite 不许因为评分爬到队首 —— 主观推荐与客观排序是两件事')
  assert.deepEqual(
    autoRouter.routeMenu(rated).models.map(model => model.displayName),
    menu.models.map(model => model.displayName),
    '菜单顺序 = 选路顺序，星级只挂在行上',
  )

  // 清除（写空表）把整格从盘上去掉，行上不再带 rating。
  const cleared = sm.updateRoute(route.name, { modelRatings: [] })
  assert.equal(cleared.ok, true, JSON.stringify(cleared.error))
  const after = sm.listModelRoutes().find(candidate => candidate.name === route.name)!
  assert.equal(after.modelRatings, undefined, '空表归一成「没配」，不留空键')
  assert.equal(autoRouter.routeMenu(after).models.find(model => model.displayName === 'Beta-Lite')?.rating,
    undefined)
})

test('菜单：未评分的行也带系统推荐星 recommendedStars（1–5），手动评分不改变它', () => {
  const route = makeRoute({ modelScope: 'pool' })
  const menu = autoRouter.routeMenu(route)
  assert.ok(menu.models.length > 0)
  for (const model of menu.models) {
    assert.equal(typeof model.recommendedStars, 'number', `${model.displayName} 缺系统推荐星`)
    assert.ok(model.recommendedStars! >= 1 && model.recommendedStars! <= 5,
      `${model.displayName} 推荐星越界：${model.recommendedStars}`)
    assert.equal(model.rating, undefined, '未评分不落 rating 键')
  }

  // 手动评分只覆盖显示，不改动系统推导值，也不重排选路。
  const written = sm.updateRoute(route.name, {
    modelRatings: [{ providerId: 'pb', displayName: 'Beta-Lite', stars: 1 }],
  })
  assert.equal(written.ok, true, JSON.stringify(written.error))
  const rated = sm.listModelRoutes().find(candidate => candidate.name === route.name)!
  const ratedMenu = autoRouter.routeMenu(rated)
  const before = menu.models.find(model => model.displayName === 'Beta-Lite')!
  const now = ratedMenu.models.find(model => model.displayName === 'Beta-Lite')!
  assert.equal(now.rating, 1)
  assert.equal(now.recommendedStars, before.recommendedStars, '手动评分不改系统推导值')
  assert.deepEqual(
    ratedMenu.models.map(model => model.displayName),
    menu.models.map(model => model.displayName),
    '系统推荐星只作展示，不重排菜单/选路',
  )
})

// ------------------------------------------------------------ 5. 切换入口

test('切换：命中校验返回 providerId，落盘后下一轮就按它服务', () => {
  const route = makeRoute()
  const result = autoRouter.switchModel(
    { route: route.name, model: 'Gamma-Mini', source: 'tray' },
    sm.listModelRoutes(),
  )

  assert.equal(result.ok, true, result.reason)
  assert.equal(result.model, 'Gamma-Mini')
  assert.equal(result.providerId, 'pc', '落盘 write 要的就是这个解析结果，不是请求里的猜测')
  assert.equal(autoRouter.pinFor(route.name), undefined,
    '路由级钉不写内存：控制台与托盘统一落盘成 preferredModel（裁定 2026-11-15）')

  // routes:switch 的落盘分支（handlers.ts）：写配置 + 广播，这里证明写后生效。
  const written = sm.updateRoute(route.name, {
    preferredModel: { providerId: result.providerId!, displayName: result.model! },
  })
  assert.equal(written.ok, true, JSON.stringify(written.error))
  const fresh = sm.listModelRoutes().find(candidate => candidate.name === route.name)!
  assert.equal(select(fresh).candidates[0].displayName, 'Gamma-Mini')
  const menu = autoRouter.routeMenu(fresh)
  assert.equal(menu.pin?.displayName, 'Gamma-Mini')
  assert.equal(menu.pin?.until, 0, '钉住即持久')
})

test('切换：「换下一个」从当前服务的模型往前走一格并绕回', () => {
  const route = makeRoute({ modelScope: 'pool' })
  autoRouter.noteServedModel(route.name, {
    provider: { id: 'pc', name: 'Scope Provider pc' },
    displayName: 'Gamma-Mini',
  })
  const order = autoRouter.routeMenu(route).models.map(model => model.displayName)
  assert.equal(order[0], 'Gamma-Mini', '前置：当前模型排最前')

  const next = autoRouter.switchModel({ route: route.name }, sm.listModelRoutes())
  assert.equal(next.ok, true, next.reason)
  assert.equal(next.model, order[1], '就是菜单顺序里的下一项')
  assert.notEqual(next.model, 'Gamma-Mini')
})

test('切换：失败一定带原因（不存在 / 已停用 / 空池 / 不在池里）', () => {
  const missing = autoRouter.switchModel({ route: 'no-such-route' }, sm.listModelRoutes())
  assert.equal(missing.ok, false)
  assert.match(missing.reason ?? '', /不存在/)

  const route = makeRoute()
  sm.updateRoute(route.name, { enabled: false })
  const disabled = autoRouter.switchModel({ route: route.name }, sm.listModelRoutes())
  assert.equal(disabled.ok, false)
  assert.match(disabled.reason ?? '', /已停用/)
  sm.updateRoute(route.name, { enabled: true })

  const empty = makeRoute({ poolStrategies: [{ id: 'aggregate-only', operator: 'and' }] })
  const noPool = autoRouter.switchModel({ route: empty.name }, sm.listModelRoutes())
  assert.equal(noPool.ok, false)
  assert.match(noPool.reason ?? '', /没有可切换的模型/)

  const outside = autoRouter.switchModel(
    { route: route.name, model: 'Ghost-Not-Served' },
    sm.listModelRoutes(),
  )
  assert.equal(outside.ok, false)
  assert.match(outside.reason ?? '', /候选池/)
  assert.ok(outside.menu !== undefined, '失败也带最新菜单：托盘可以就地刷新，不用再问一次')
})

test('切换：会话级作用域被拒（会话钉只由请求头写入）', () => {
  const route = makeRoute()
  const result = autoRouter.switchModel(
    { route: route.name, model: 'Beta-Lite', scope: 'session' },
    sm.listModelRoutes(),
  )

  assert.equal(result.ok, false)
  assert.match(result.reason ?? '', /控制台/)
  assert.equal(autoRouter.pinFor(route.name), undefined, '被拒的请求不许留下半颗钉子')
})

// --------------------------------------- 6. 渠道行的账号数（Worker 池口径）

test('菜单：账号渠道行改读 Worker 池的启用账号数，读不到时保留占位计数', () => {
  sm.addProvider({
    ...providerFixture('cha', 'Channel-Model', { tier: 'fast' }),
    type: 'account',
    apiEndpoint: 'channel://cha',
  } as never)
  sm.addAccount(accountFixture('cha') as never)
  const route = makeRoute()

  const rowOf = (menu: { models: Array<{ providerId: string; accountCount: number }> }) =>
    menu.models.find(model => model.providerId === 'cha')

  assert.equal(rowOf(autoRouter.routeMenu(route))?.accountCount, 1,
    '池计数缺席 = 本机那条占位账号，不能让已连上的渠道读成 0')

  assert.equal(rowOf(autoRouter.routeMenu(route, undefined, Date.now(), {
    cha: { total: 2, enabled: 2 },
  }))?.accountCount, 2, '池里两个启用账号就是 2')

  assert.equal(rowOf(autoRouter.routeMenu(route, undefined, Date.now(), {
    cha: { total: 2, enabled: 0 },
  }))?.accountCount, 0, '池里没有启用的号：读 0，钉定按钮据此禁用')

  const switched = autoRouter.switchModel(
    { route: route.name, model: 'Channel-Model' },
    sm.listModelRoutes(),
    Date.now(),
    { cha: { total: 2, enabled: 2 } },
  )
  assert.equal(switched.ok, true, switched.reason)
  assert.equal(rowOf(switched.menu!)?.accountCount, 2,
    '切换后的回灌菜单同样带池计数，否则点一下又变回 1')
})

test('菜单：includeDropped 时列出被池策略筛掉的模型并带 status（控制台路由页要就地排除/加回）', () => {
  // 只留免费模型：别的模型会被 `free-only` 筛掉，托盘默认看不到它们 ——
  // 而控制台那一页要能就地做排除/加回，否则用户只能跳回路由编辑器改配置。
  const route = makeRoute({ poolStrategies: [{ id: 'free-only', operator: 'and' }] })

  const tray = autoRouter.routeMenu(route)
  assert.ok(tray.models.every(model => model.status === 'kept' || model.status === 'included'),
    '托盘默认只列能派/手动加回的行')

  const consoleMenu = autoRouter.routeMenu(route, undefined, Date.now(), undefined, true)
  const dropped = consoleMenu.models.filter(model => model.status === 'filtered')
  assert.ok(dropped.length > 0, 'includeDropped 把被筛掉的行也列出来')
  assert.ok(dropped.every(model => model.filteredBy === 'free-only'),
    '每行带上「哪个策略筛掉了它」，界面据此说明原因')
  assert.equal(consoleMenu.totalModels, tray.totalModels === 0 ? consoleMenu.totalModels : consoleMenu.totalModels,
    '总数如实给')

  // 三段顺序：能派的前、被筛掉的在后。被筛掉的模型绝不能混进「能派」那一段。
  const firstDroppedAt = consoleMenu.models.findIndex(model => model.status === 'filtered')
  const lastKeptAt = consoleMenu.models.reduce(
    (last, model, index) => (model.status === 'kept' || model.status === 'included' ? index : last),
    -1,
  )
  assert.ok(firstDroppedAt > lastKeptAt, '能派的在前，被筛掉的在后')
})
