/**
 * 多路由的**候选池语义（C）**与**按路由隔离的会话粘性（E）**，外加逐路由的换家预算。
 *
 * 证明的层次：真 `storeManager`（供应商/账号/模型目录/在服名单）+ 真 `autoRouter.select()`
 * 的返回值 —— 也就是 `src/main/proxy/autoRouter.ts` 里那段「每请求重算池 → 池策略折叠 →
 * 契约过滤 → 打分 → 粘性」的完整决策，`applyPoolStrategies` 与 `scoreCandidate` 都在其内。
 * 断言读的是 `decision.candidates / reason / baseCap / prefer / skipped / missing` 这些真返回值，
 * 不是源码文本。
 *
 * 为什么落在这一层而不是 HTTP 层：候选的**精确集合**与**谁被钉住**在响应里不可见
 * （`/v1/chat/completions` 只透出了 Prefer/Reason/Attempts/Route，见 proxy-routes-request.test.ts）。
 * 两半合起来才是完整证据：状态码/头在请求级，成员/钉住在决策级。
 *
 * 打分前提（都写在 fixture 里，故意让自然分只差 0.1）：三家供应商各一个模型、
 * 都是 `tier:'fast'`、请求 prefer `fast` → tierFit 相同；只有 `Alpha-Flash` 标了 `free:true`
 * （costBonus 0.2×(1−0.5)=+0.1）→ 自然首选是它。粘性加分 0.12（同账号）恰好盖过这 0.1，
 * 于是「谁被钉住」在结果里是可见的，而不是靠冷却/在途这些运行时噪声。
 *
 * 不在本层证明：HTTP 状态码与响应头、renderer UI、真 Electron、上游网络、时间流逝导致的过期
 * （过期用 `reset()` 与「烘焙后的绝对时间戳」两条真实路径证明，不假装能等 30 分钟）。
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
      // `routes` 键**存在**（空表）：本文件测的是池与粘性，不参与迁移，
      // 所以要把「永不重放迁移」这一条钉死，legacy 值只作为对照存在。
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
    name: `Pool Provider ${id}`,
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

// 三家：long-context（≥128000）= pa/pb；vision-capable = pb/pc；free-only = pa
sm.addProvider(providerFixture('pa', 'Alpha-Flash', { tier: 'fast', vision: 'no', contextTokens: 200000, free: true }) as never)
sm.addProvider(providerFixture('pb', 'Beta-Lite', { tier: 'fast', vision: 'yes', contextTokens: 200000 }) as never)
sm.addProvider(providerFixture('pc', 'Gamma-Mini', { tier: 'fast', vision: 'yes', contextTokens: 16000 }) as never)
for (const id of ['pa', 'pb', 'pc']) sm.addAccount(accountFixture(id) as never)

/** 一段固定对话：`conversationKey` 由 system/首条 user 文本算出，跨用例一致。 */
const REQUEST = {
  model: 'auto',
  messages: [{ role: 'user', content: 'one line question' }],
} as ChatCompletionRequest

const select = (route?: ModelRoute, request: ChatCompletionRequest = REQUEST, preferOverride?: string) =>
  autoRouter.select(request, 'round-robin', preferOverride, route)

/** 参与决策的模型名（去重后排序）：池语义的断言只关心成员，不关心同名的多账号副本。 */
const modelsIn = (decision: { candidates: Array<{ displayName: string }> }) =>
  [...new Set(decision.candidates.map(candidate => candidate.displayName))].sort()

let routeCounter = 0
/** 走真写入通道（`createRoute` → normalize）拿路由对象，不在测试里手搓形状。 */
function makeRoute(overrides: Record<string, unknown> = {}): ModelRoute {
  const name = `r${routeCounter++}`
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

beforeEach(() => {
  // 冷却/粘性都是 autoRouter 的进程内态：每条用例从干净的一份开始，
  // 这样结果只由路由配置决定（`reset()` 就是代理重启的真语义）。
  autoRouter.reset()
})

after(() => {
  autoRouter.reset()
  harness.dispose()
})

// ------------------------------------------------------------------ C：池语义

test('C：`poolStrategies: []` 是 no-op —— 池就是「在服名单」本身，与今天不带路由的 auto 完全一致', () => {
  const emptyPool = makeRoute({ poolStrategies: [] })
  const decision = select(emptyPool)
  const served = [...new Set(['pa', 'pb', 'pc'].flatMap(id => sm.getEffectiveModels(id).map(m => m.displayName)))].sort()

  assert.deepEqual(modelsIn(decision), served)
  assert.deepEqual(modelsIn(decision), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'])
  // legacy（不传 route）走的是同一条采集路径：两边成员必须逐项相同
  assert.deepEqual(modelsIn(select()), modelsIn(decision))
})

test('C：单个策略就是它的谓词；第一个条目的 operator 被忽略（`and`/`or` 结果相同）', () => {
  const asAnd = makeRoute({ poolStrategies: [{ id: 'vision-capable', operator: 'and' }] })
  const asOr = makeRoute({ poolStrategies: [{ id: 'vision-capable', operator: 'or' }] })

  assert.deepEqual(modelsIn(select(asAnd)), ['Beta-Lite', 'Gamma-Mini'])
  assert.deepEqual(modelsIn(select(asOr)), ['Beta-Lite', 'Gamma-Mini'])
})

test('C：and / or 从左到右折叠 —— 两个顺序给出两个答案（这才叫折叠而不是集合交并一遍）', () => {
  // long-context = {pa, pb}；vision-capable = {pb, pc}
  const andSecond = makeRoute({
    poolStrategies: [
      { id: 'long-context', operator: 'and' },
      { id: 'vision-capable', operator: 'and' },
    ],
  })
  const orSecond = makeRoute({
    poolStrategies: [
      { id: 'long-context', operator: 'and' },
      { id: 'vision-capable', operator: 'or' },
    ],
  })
  const reversed = makeRoute({
    poolStrategies: [
      { id: 'vision-capable', operator: 'and' },
      { id: 'long-context', operator: 'or' },
    ],
  })

  assert.deepEqual(modelsIn(select(andSecond)), ['Beta-Lite'], '交集：两条都满足的只有 pb')
  assert.deepEqual(modelsIn(select(orSecond)), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'], '并集：三家都回来')
  assert.deepEqual(modelsIn(select(reversed)), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'])

  // 顺序真的参与计算：`and` 之后 `or` 只会往回加，不会把第一个筛掉的重新拉进来
  const andAfterOr = makeRoute({
    poolStrategies: [
      { id: 'long-context', operator: 'and' },
      { id: 'free-only', operator: 'or' },
      { id: 'vision-capable', operator: 'and' },
    ],
  })
  // {pa,pb} ∪ {pa} = {pa,pb} → ∩ vision = {pb}
  assert.deepEqual(modelsIn(select(andAfterOr)), ['Beta-Lite'])
})

test('C：池被筛空 = 空候选 + 点名是配置筛空（不是缺能力）', () => {
  const noneLeft = makeRoute({ poolStrategies: [{ id: 'aggregate-only', operator: 'and' }] })
  const decision = select(noneLeft)

  assert.deepEqual(decision.candidates, [])
  assert.deepEqual(decision.missing, ['pool_strategy'], 'custom 供应商不是 aggregate，要报策略筛空而不是缺能力')
  assert.deepEqual(decision.skipped, [])
  assert.equal(decision.routeName, noneLeft.name)
  assert.equal(decision.route, noneLeft)

  // 同一份池，换成带图片的请求：视觉硬过滤在策略之后，缺能力才该报出来
  const visionRequest = {
    model: 'auto',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://127.0.0.1/x.png' } }] }],
  } as unknown as ChatCompletionRequest
  const visionOnly = select(noneLeft, visionRequest)
  assert.deepEqual(visionOnly.candidates, [])
  assert.deepEqual(visionOnly.profile.needsVision, true)
  // 策略先筛空时仍报 pool_strategy：先改路由配置比换模型更直接
  assert.deepEqual(visionOnly.missing, ['pool_strategy'])
})

test('C：未知策略 id 由写入归一剔掉（fail-open），剩下的照旧生效，绝不抛错', () => {
  const raw = {
    name: 'odd',
    enabled: true,
    strategy: 'round-robin',
    prefer: 'fast',
    maxAttempts: 3,
    stickyMinutes: 30,
    // 绕过 `createRoute` 的写入校验（那是 IPC 之外的手改通道）：读取侧必须自己剔掉
    poolStrategies: [
      { id: 'not-a-real-strategy', operator: 'and' },
      { id: 'vision-capable', operator: 'or' },
    ],
  }
  sm.updateConfig({ routes: { ...sm.getModelRoutes(), odd: raw as never } })

  const route = sm.getModelRoutes().odd
  assert.deepEqual(route.poolStrategies, [{ id: 'vision-capable', operator: 'or' }], '非法 id 不留在表里')
  assert.deepEqual(modelsIn(select(route)), ['Beta-Lite', 'Gamma-Mini'])

  // 全是非法 id → 归一后为空 → 退化成 no-op，而不是「一个候选都不给」
  const allBad = { ...raw, name: 'allbad', poolStrategies: [{ id: 'nope', operator: 'and' }] }
  sm.updateConfig({ routes: { ...sm.getModelRoutes(), allbad: allBad as never } })
  const badRoute = sm.getModelRoutes().allbad
  assert.deepEqual(badRoute.poolStrategies, [])
  assert.deepEqual(modelsIn(select(badRoute)), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'])
})

test('C：成员从不持久化 —— 停服/恢复在下一次决策里就反映出来，路由本身没被改过', () => {
  const route = makeRoute({ poolStrategies: [{ id: 'long-context', operator: 'or' }, { id: 'vision-capable', operator: 'or' }] })
  assert.deepEqual(modelsIn(select(route)), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'])

  sm.setModelsServed('pc', ['Gamma-Mini'], false)
  assert.deepEqual(modelsIn(select(route)), ['Alpha-Flash', 'Beta-Lite'], '刚停服的模型立即退出池')
  assert.deepEqual(sm.getModelRoutes()[route.name].poolStrategies, route.poolStrategies,
    '池是每次重算的：路由里没有任何成员名单被写进去')

  sm.setModelsServed('pc', ['Gamma-Mini'], true)
  assert.deepEqual(modelsIn(select(route)), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'])

  // 整个供应商停用：它的模型一次退出，其它路由同理
  sm.updateProvider('pb', { enabled: false })
  assert.deepEqual(modelsIn(select(route)), ['Alpha-Flash', 'Gamma-Mini'])
  sm.updateProvider('pb', { enabled: true })
  assert.deepEqual(modelsIn(select(route)), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'])
})

test('C：停用账号 ≠ 停服模型：账号冷却之外没有活跃账号的供应商整家不进池', () => {
  const route = makeRoute()
  assert.deepEqual(modelsIn(select(route)), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'])

  sm.updateAccount('pc-acct1', { status: 'suspended' })
  assert.deepEqual(modelsIn(select(route)), ['Alpha-Flash', 'Beta-Lite'], '没有活跃账号的供应商不进候选')

  sm.updateAccount('pc-acct1', { status: 'active' })
  assert.deepEqual(modelsIn(select(route)), ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'])
})

// --------------------------------------------------------- 逐路由预算与 prefer

test('逐路由配置进决策：baseCap 取该路由的 maxAttempts（不传路由才回退 legacy 全局值）', () => {
  const legacy = select()
  assert.equal(legacy.baseCap, 2, 'legacy `autoRouting.maxAttempts` 只在没有路由时参与')
  assert.equal(legacy.routeName, 'auto')
  assert.equal(legacy.route, undefined)

  const tight = makeRoute({ maxAttempts: 1 })
  const loose = makeRoute({ maxAttempts: 5 })
  assert.equal(select(tight).baseCap, 1)
  assert.equal(select(loose).baseCap, 5)
})

test('逐路由配置进决策：候选条数按 maxAttempts + 可恢复余量（3）裁剪', () => {
  // 三家各加两把 Key → 6 个候选，裁剪上限才看得见
  for (const id of ['pa', 'pb', 'pc']) {
    sm.addAccount(accountFixture(id, 2) as never)
    sm.addAccount(accountFixture(id, 3) as never)
  }
  const route = makeRoute({ maxAttempts: 1 })
  const decision = select(route)
  assert.equal(decision.candidates.length, 4, '1 + AUTO_RECOVERABLE_EXTRA_ATTEMPTS(3)')
  assert.equal(decision.baseCap, 1)

  const wide = makeRoute({ maxAttempts: 2 })
  assert.equal(select(wide).candidates.length, 5)

  for (const id of ['pa', 'pb', 'pc']) {
    sm.deleteAccount(`${id}-acct2`)
    sm.deleteAccount(`${id}-acct3`)
  }
})

test('逐路由配置进决策：prefer 取该路由的值，`X-Auto-Prefer` 口径的 override 再盖一层', () => {
  const cheap = makeRoute({ prefer: 'cheap' })
  assert.equal(select(cheap).prefer, 'cheap')
  assert.equal(select(cheap, REQUEST, 'strong').prefer, 'strong')
  // 路由的 prefer 盖过 legacy 全局的 'fast'
  assert.equal(select(cheap).prefer, 'cheap')
  assert.equal(select().prefer, 'fast')
})

// ------------------------------------------------------------------ E：粘性隔离

test('E：粘性按路由分键 —— 同一段对话，另一条路由不被前一条钉住，legacy 路径也不共享', () => {
  const routeX = makeRoute()
  const routeY = makeRoute()

  const fresh = select(routeX)
  assert.equal(fresh.candidates[0].displayName, 'Alpha-Flash', '无粘性时自然首选是免费那家')
  assert.equal(fresh.reason, 'score')
  assert.ok(fresh.conversationKey, '有 user 文本就有会话指纹')

  const pinned = fresh.candidates.find(candidate => candidate.displayName === 'Beta-Lite')
  assert.ok(pinned)
  autoRouter.rememberRoute(fresh.conversationKey, pinned, routeX)

  const again = select(routeX)
  assert.equal(again.reason, 'sticky')
  assert.equal(again.candidates[0].displayName, 'Beta-Lite', '0.12 的同账号粘性加分盖过 0.1 的成本差')

  const other = select(routeY)
  assert.equal(other.reason, 'score', '另一条路由的键是 `<路由名>|<会话指纹>`，读不到 routeX 那条记录')
  assert.equal(other.candidates[0].displayName, 'Alpha-Flash')

  const legacy = select()
  assert.equal(legacy.routeName, 'auto')
  assert.equal(legacy.reason, 'score', 'legacy 路径的键名前缀是 `auto`，同样不共享')
  assert.equal(legacy.candidates[0].displayName, 'Alpha-Flash')

  // 反方向也要成立：给 routeY 钉住 Alpha-Flash 之外的另一家后，routeX 的记录仍是自己那条
  const pinnedForY = fresh.candidates.find(candidate => candidate.displayName === 'Gamma-Mini')
  assert.ok(pinnedForY)
  autoRouter.rememberRoute(fresh.conversationKey, pinnedForY, routeY)
  assert.equal(select(routeY).candidates[0].displayName, 'Gamma-Mini')
  assert.equal(select(routeX).candidates[0].displayName, 'Beta-Lite')
})

test('E：路由层粘性是硬优先 —— 自然分更低的上一轮模型也会排到第一', () => {
  const route = makeRoute()
  const fresh = select(route)
  const gamma = fresh.candidates.find(candidate => candidate.displayName === 'Gamma-Mini')
  assert.ok(gamma)
  autoRouter.rememberRoute(fresh.conversationKey, gamma, route)

  const again = select(route)
  assert.equal(again.candidates[0].displayName, 'Gamma-Mini', 'agent 会话不能每轮换模型')
  assert.equal(again.reason, 'sticky')
})

test('E：粘性只是加分不是硬钉 —— 被钉住的模型停服后自然让位，恢复后又回来', () => {
  const route = makeRoute()
  const fresh = select(route)
  autoRouter.rememberRoute(fresh.conversationKey,
    fresh.candidates.find(candidate => candidate.displayName === 'Beta-Lite')!, route)
  assert.equal(select(route).candidates[0].displayName, 'Beta-Lite')

  sm.setModelsServed('pb', ['Beta-Lite'], false)
  const yielded = select(route)
  assert.equal(yielded.candidates[0].displayName, 'Alpha-Flash')
  assert.notEqual(yielded.reason, 'sticky', '候选已经不在了，不能谎称命中粘性')

  sm.setModelsServed('pb', ['Beta-Lite'], true)
  assert.equal(select(route).candidates[0].displayName, 'Beta-Lite', '记录还在有效期内，恢复即命中')
})

test('E：`stickyMinutes: 0` 的路由不写记录（同一段对话对另一条路由的行为）', () => {
  const off = makeRoute({ stickyMinutes: 0 })
  const fresh = select(off)
  autoRouter.rememberRoute(fresh.conversationKey,
    fresh.candidates.find(candidate => candidate.displayName === 'Beta-Lite')!, off)

  const after = select(off)
  assert.equal(after.candidates[0].displayName, 'Alpha-Flash')
  assert.notEqual(after.reason, 'sticky')

  // 同一次记录换个 stickyMinutes>0 的路由对象再试：写入侧按那条路由的时长判空
  const on = makeRoute({ stickyMinutes: 30 })
  assert.equal(select(on).candidates[0].displayName, 'Alpha-Flash')
  autoRouter.rememberRoute(fresh.conversationKey,
    fresh.candidates.find(candidate => candidate.displayName === 'Beta-Lite')!, on)
  assert.equal(select(on).candidates[0].displayName, 'Beta-Lite')
})

test('E：过期时间在写入时烘焙 —— 改成 0 分钟只是「不读」，记录没被删；改回来立刻又命中，`reset()`（重启）才归零', () => {
  const route = makeRoute({ stickyMinutes: 30 })
  const fresh = select(route)
  const target = fresh.candidates.find(candidate => candidate.displayName === 'Beta-Lite')!
  autoRouter.rememberRoute(fresh.conversationKey, target, route)
  assert.equal(select(route).candidates[0].displayName, 'Beta-Lite')

  // 用户此刻把这条路由的粘性改成 0：配置读取侧立即生效（A 已证），而 `select` 的粘性
  // 查询本身被 `stickyMinutes > 0` 这道门挡住（autoRouter.ts:396）—— 于是这条**未过期**
  // 的记录既不参与打分、也不会被删掉（删除分支在同一道门里面）。0 的语义就是「不粘」，
  // 所以这是正确行为，但陈旧记录仍在表里是 autoRouter.ts:207-214 写明的那条边界。
  const turnedOff = sm.updateRoute(route.name, { stickyMinutes: 0 })
  assert.equal(turnedOff.ok, true)
  assert.equal(sm.getModelRoutes()[route.name].stickyMinutes, 0)
  assert.equal(select(turnedOff.route as ModelRoute).candidates[0].displayName, 'Alpha-Flash',
    'stickyMinutes=0 的路由不读粘性')

  // 记录还活着：把时长改回 30，同一次钉住在**重启之前**继续有效
  const turnedBack = sm.updateRoute(route.name, { stickyMinutes: 30 })
  assert.equal(turnedBack.ok, true)
  assert.equal(select(turnedBack.route as ModelRoute).candidates[0].displayName, 'Beta-Lite',
    '烘焙的绝对过期时间是写入时的 30 分钟，读取时长的改动不会把记录抹掉')

  autoRouter.reset()
  assert.equal(select(turnedBack.route as ModelRoute).candidates[0].displayName, 'Alpha-Flash',
    '只有重启（reset）才真的归零')
})

test('E：粘性按对话内容分键 —— 换一段对话不受影响；没有 user 文本则完全不参与', () => {
  const route = makeRoute()
  const fresh = select(route)
  autoRouter.rememberRoute(fresh.conversationKey,
    fresh.candidates.find(candidate => candidate.displayName === 'Beta-Lite')!, route)

  const otherConversation = {
    model: 'auto',
    messages: [{ role: 'user', content: 'a completely different question' }],
  } as ChatCompletionRequest
  const shifted = select(route, otherConversation)
  assert.notEqual(shifted.conversationKey, fresh.conversationKey)
  assert.equal(shifted.candidates[0].displayName, 'Alpha-Flash')
  assert.notEqual(shifted.reason, 'sticky')

  const systemOnly = {
    model: 'auto',
    messages: [{ role: 'system', content: 'be brief' }],
  } as ChatCompletionRequest
  const anonymous = select(route, systemOnly)
  assert.equal(anonymous.conversationKey, undefined, '算不出会话指纹就没有粘性')
  autoRouter.rememberRoute(anonymous.conversationKey,
    anonymous.candidates[0], route)
  assert.equal(select(route).candidates[0].displayName, 'Beta-Lite',
    '没有键的 rememberRoute 是 no-op，不得把已有记录冲掉')
})

// ------------------------------------------------- C：候选池预览（与 select 同一条管线）

test('C/preview：逐模型状态就是决策的一步 —— 策略筛掉 / 手动加回 / 手动移除互不矛盾', () => {
  const route = makeRoute({
    poolStrategies: [{ id: 'long-context', operator: 'and' }],
    includeModels: [{ providerId: 'pc', displayName: 'Gamma-Mini' }],
    excludeModels: [{ providerId: 'pb', displayName: 'Beta-Lite' }],
  })
  const preview = autoRouter.preview(route)
  const statusOf = (displayName: string) =>
    preview.models.find(model => model.displayName === displayName)?.status

  assert.equal(statusOf('Alpha-Flash'), 'kept')
  assert.equal(statusOf('Beta-Lite'), 'excluded', '手动移除赢过策略保留')
  assert.equal(statusOf('Gamma-Mini'), 'included', '手动加回能救回被策略筛掉的模型')
  assert.deepEqual(preview.counts, {
    candidates: 3,
    afterStrategies: 2,
    afterManual: 2,
    unavailable: 0,
  })
  assert.deepEqual(preview.manual, { included: 1, excluded: 1, unresolved: [] })
  assert.deepEqual(preview.missing, [])

  // 预览不是另一套算法：成员集合必须与真实决策逐项相同
  const decision = select(route)
  assert.deepEqual(
    [...new Set(decision.candidates.map(candidate => candidate.displayName))].sort(),
    ['Alpha-Flash', 'Gamma-Mini'],
  )
})

test('C/preview：手动加回不绕过硬过滤；不在池里的引用进 unresolved 而不是被静默丢弃', () => {
  const route = makeRoute({
    includeModels: [
      { providerId: 'pc', displayName: 'Gamma-Mini' },
      { providerId: 'pa', displayName: 'Ghost-Not-Served' },
    ],
  })
  // pc 只有 16000 窗口，被预览画像的 50000 要求淘汰；pa 不是视觉模型
  const preview = autoRouter.preview(route, { needsVision: true, estimatedTokens: 50000 })
  const byName = (displayName: string) =>
    preview.models.find(model => model.displayName === displayName)

  assert.equal(byName('Gamma-Mini')?.status, 'unavailable')
  assert.equal(byName('Gamma-Mini')?.unavailableReason, 'context')
  assert.equal(byName('Alpha-Flash')?.status, 'unavailable')
  assert.equal(byName('Alpha-Flash')?.unavailableReason, 'vision')
  assert.equal(byName('Beta-Lite')?.status, 'kept')
  assert.deepEqual(preview.manual.unresolved, [
    { providerId: 'pa', displayName: 'Ghost-Not-Served' },
  ])
})

test('C/preview：空池点名是哪一步清空的 —— 策略筛空 vs 手动移除筛空', () => {
  const byStrategy = autoRouter.preview(
    makeRoute({ poolStrategies: [{ id: 'aggregate-only', operator: 'and' }] }),
  )
  assert.deepEqual(byStrategy.missing, ['pool_strategy'])
  assert.equal(byStrategy.counts.afterStrategies, 0)
  assert.equal(byStrategy.models.length, 3, '被策略筛掉的模型仍要列出来，否则用户没法手动加回')

  const byManual = autoRouter.preview(
    makeRoute({
      excludeModels: ['Alpha-Flash', 'Beta-Lite', 'Gamma-Mini'].map(displayName => ({
        providerId: displayName === 'Alpha-Flash' ? 'pa' : displayName === 'Beta-Lite' ? 'pb' : 'pc',
        displayName,
      })),
    }),
  )
  assert.deepEqual(byManual.missing, ['manual_filter'])
  assert.equal(byManual.counts.afterManual, 0)
  assert.deepEqual(
    byManual.models.map(model => model.status),
    ['excluded', 'excluded', 'excluded'],
  )
})
