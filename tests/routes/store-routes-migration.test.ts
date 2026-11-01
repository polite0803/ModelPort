/**
 * 多路由在**真 store** 上的迁移、CRUD 与 R1 回归（验收项 B、D 的 store 层、F，以及 A 的「立即生效」在读侧）。
 *
 * 证明的层次：`src/main/store/store.ts` 的 `normalizeConfig` / `normalizeRoutes`（迁移判据在
 * **原始存储对象**上）+ `updateConfig` / `setConfig`（通用 `STORE_SET` 整对象 raw 写的那条归一通道）
 * + `createRoute` / `updateRoute` / `deleteRoute` + `getRouteNameOccupants` + 模型目录的 served 语义。
 * 全部是真 `StoreManager`（`tests/routes/harness.mjs`：electron 边界用替身，存储落在 `mkdtemp` 临时目录，
 * 绝不碰开发者的 `~/.modelport`），不是读源码文本。
 *
 * 不在本层证明：HTTP 状态码/响应头（`proxy-routes-request.test.ts`）、候选池与粘性
 * （`routes-pool-and-sticky.test.ts`）、renderer UI。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore } from './harness.mjs'
import { resolveRouteRequest } from '../../src/main/store/modelRoutes.ts'
import type { ModelMapping } from '../../src/main/store/types.ts'

/** 旧版本落盘的那份 config：**没有** `routes` 键，只有 legacy `autoRouting`。 */
const LEGACY_CONFIG = {
  proxyPort: 8080,
  proxyHost: '127.0.0.1',
  loadBalanceStrategy: 'fill-first',
  autoRouting: {
    enabled: true,
    maxAttempts: 2,
    stickyMinutes: 15,
    prefer: 'strong',
    poolStrategies: [{ id: 'long-context', operator: 'and' }],
  },
}

const harness = await bootstrapStore({
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: LEGACY_CONFIG,
  },
})
const sm = harness.storeManager

/** 一条自定义供应商记录（够 loadbalancer/autoRouter 用，不发送任何网络请求）。 */
function providerFixture(id = 'kp', overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Key Pool ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: ['Kimi-K3'],
    modelMappings: { 'Kimi-K3': 'kimi-k3' },
    ...overrides,
  }
}

function accountFixture(providerId: string, id = `${providerId}-acct`) {
  return {
    id,
    providerId,
    name: `${providerId} account`,
    credentials: { token: 'secret' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  }
}

/** 回到出厂状态（`clearAll` 之后 `get('config')` 拿回不带 `routes` 键的 DEFAULT_CONFIG）。 */
function factory() {
  sm.clearAll()
}

const configOnDisk = () => sm.getStore().get('config') as Record<string, unknown>

// ------------------------------------------------------------------ B 一次性迁移

test('升级安装：盘上的旧 config（无 `routes` 键）在首次读取时迁移成一条 `auto`，配置逐项等于 legacy', () => {
  const routes = sm.getConfig().routes as Record<string, any>

  assert.deepEqual(Object.keys(routes), ['auto'])
  assert.deepEqual(routes.auto, {
    name: 'auto',
    enabled: LEGACY_CONFIG.autoRouting.enabled,
    // `strategy` 取当时的 `loadBalanceStrategy`：那正是今天 auto 用的打分口径
    strategy: LEGACY_CONFIG.loadBalanceStrategy,
    prefer: LEGACY_CONFIG.autoRouting.prefer,
    maxAttempts: LEGACY_CONFIG.autoRouting.maxAttempts,
    stickyMinutes: LEGACY_CONFIG.autoRouting.stickyMinutes,
    poolStrategies: LEGACY_CONFIG.autoRouting.poolStrategies,
    includeModels: [],
    excludeModels: [],
    pinModels: [],
  })
})

test('迁移只跑一次：归一后的 config 会带着 `routes` 键落盘，所以读取侧的判据从此永假', () => {
  // 落盘证据（不是「应该已经写了」）：盘上的 config 确有 routes 键。
  assert.equal(Object.prototype.hasOwnProperty.call(configOnDisk(), 'routes'), true)

  const first = sm.getConfig().routes
  const second = sm.getConfig().routes
  const third = sm.getConfig().routes

  assert.deepEqual(second, first)
  assert.deepEqual(third, first)
  assert.deepEqual(Object.keys(third), ['auto'], '重复读取绝不追加第二条 auto')
})

test('用户后来改 legacy `autoRouting` 不会改写已迁移的路由（键存在即永不重放）', () => {
  const written = sm.updateConfig({ autoRouting: { maxAttempts: 5, stickyMinutes: 60 } as never })

  assert.equal(written.autoRouting.maxAttempts, 5, 'legacy 字段自己是要归一的')
  assert.equal(written.routes!.auto.maxAttempts, LEGACY_CONFIG.autoRouting.maxAttempts)
  assert.equal(written.routes!.auto.stickyMinutes, LEGACY_CONFIG.autoRouting.stickyMinutes)
})

test('删光路由后 `routes === {}`：重复读取、写其它 config 字段、整对象 raw 写都不得复活 `auto`', () => {
  const removed = sm.deleteRoute('auto')
  assert.equal(removed.ok, true)
  assert.deepEqual(sm.getModelRoutes(), {})
  assert.deepEqual(configOnDisk().routes, {}, '盘上必须是「键存在且为空」，不是键消失')

  for (let i = 0; i < 5; i++) {
    assert.deepEqual(sm.getConfig().routes, {}, `第 ${i + 1} 次读取复活了已删的 auto`)
  }

  // 写其它字段（`updateConfig` 走 `{...currentConfig, ...updates}`，routes 键随 currentConfig 保留）
  const otherField = sm.updateConfig({ proxyPort: 8899 })
  assert.equal(otherField.proxyPort, 8899)
  assert.deepEqual(otherField.routes, {})

  // 通用 `STORE_SET` 的整对象 raw 写（ipc/handlers.ts 的 `store:set('config')` 就调这条）：
  // 入参**不带** routes 键 —— 漏键的正确答案是「保持原样」，不是重放迁移。
  const withoutRoutesKey = { ...sm.getConfig() } as Record<string, unknown>
  delete withoutRoutesKey.routes
  assert.equal(Object.prototype.hasOwnProperty.call(withoutRoutesKey, 'routes'), false)
  const settled = sm.setConfig(withoutRoutesKey)
  assert.deepEqual(settled.routes, {}, '一次漏键的整对象写把已删的 auto 复活了')
  assert.deepEqual(configOnDisk().routes, {})

  // 连 legacy 值一起送上门也不许复活（renderer 保存的就是整份 config）
  const withLegacy = { ...withoutRoutesKey, autoRouting: { ...LEGACY_CONFIG.autoRouting, maxAttempts: 4 } }
  assert.deepEqual(sm.setConfig(withLegacy).routes, {})
})

test('全新安装（config 键都没有）得到一条出厂默认的 `auto`', () => {
  factory()

  assert.deepEqual(sm.getModelRoutes(), {
    auto: {
      name: 'auto',
      enabled: true,
      strategy: 'round-robin',
      prefer: 'balanced',
      maxAttempts: 3,
      stickyMinutes: 30,
      poolStrategies: [],
      includeModels: [],
      excludeModels: [],
      pinModels: [],
    },
  })
})

test('`resetConfig()` 落的是不带 `routes` 键的 DEFAULT_CONFIG，所以读取侧再迁移一次（重置=全新安装）', () => {
  sm.createRoute({ name: 'fast' })
  const before = Object.keys(sm.getConfig().routes!)
  assert.deepEqual(before, ['auto', 'fast'])

  const returned = sm.resetConfig()

  assert.deepEqual(Object.keys(returned.routes!), ['auto'], '返回值要与 getConfig() 同形，否则 UI 以为路由全没了')
  assert.equal(Object.prototype.hasOwnProperty.call(configOnDisk(), 'routes'), false, '盘上仍是 raw DEFAULT_CONFIG')
  assert.deepEqual(sm.getModelRoutes().auto.prefer, 'balanced')
})

test('手坏的 routes 条目在读取侧安全丢弃，绝不把整个 config 读挂', () => {
  const normalized = sm.setConfig({
    ...sm.getConfig(),
    routes: { auto: { enabled: true }, 'Bad Key': { enabled: true }, '含空格 名': {}, junk: 'not-an-object' },
  })

  assert.deepEqual(Object.keys(normalized.routes!), ['auto'])
  assert.deepEqual(Object.keys(sm.getModelRoutes()), ['auto'])
})

// -------------------------------------------------------------- A（读侧）/ CRUD / D

test('新建路由立刻进配置（不需要重启），存储键就是规范化后的名字', () => {
  factory()

  const created = sm.createRoute({ name: 'fast', prefer: 'fast', maxAttempts: 4 })

  assert.equal(created.ok, true)
  if (!created.ok) return
  assert.equal(created.route.name, 'fast')
  assert.equal(created.route.prefer, 'fast')
  assert.equal(created.route.maxAttempts, 4)
  assert.deepEqual(Object.keys(sm.getModelRoutes()), ['auto', 'fast'])
  assert.deepEqual(Object.keys(configOnDisk().routes as Record<string, unknown>), ['auto', 'fast'])

  // 大写输入按同一份规范收敛（`Foo` 存成 `foo`）
  const upper = sm.createRoute({ name: 'VIP' })
  assert.equal(upper.ok, true)
  assert.equal(Object.prototype.hasOwnProperty.call(sm.getModelRoutes(), 'vip'), true)

  // trim 语义（名字规则原文：trim + 小写 + `[a-z0-9_-]`）：首尾空白先被裁掉，
  // `' Fast '` 规范成 `fast` 后参与校验 —— 这里被拒是因为它**撞了上面刚建的 `fast`**
  // （duplicate_name），不是「含空白即非法」。
  const padded = sm.createRoute({ name: ' Fast ' })
  assert.equal(padded.ok, false)
  if (!padded.ok) assert.equal(padded.error.code, 'duplicate_name')
  assert.equal(sm.getModelRoute(' Fast ')?.name, 'fast', '查询侧同样先 trim')

  // 不与现有条目相撞的带空白名：trim 后接受，落盘键与 `route.name` 都是规范形。
  const paddedFresh = sm.createRoute({ name: ' Turbo ' })
  assert.equal(paddedFresh.ok, true)
  if (paddedFresh.ok) {
    assert.equal(paddedFresh.route.name, 'turbo')
    assert.equal(Object.prototype.hasOwnProperty.call(sm.getModelRoutes(), 'turbo'), true)
  }
})

test('改这条路由的池策略立刻反映到下一次读取（池是每请求现算的，成员不落盘）', () => {
  factory()
  sm.createRoute({ name: 'vision' })

  const updated = sm.updateRoute('vision', { poolStrategies: [{ id: 'vision-capable', operator: 'and' }] })

  assert.equal(updated.ok, true)
  if (!updated.ok) return
  assert.deepEqual(updated.route.poolStrategies, [{ id: 'vision-capable', operator: 'and' }])
  assert.deepEqual(sm.getModelRoutes().vision.poolStrategies, [{ id: 'vision-capable', operator: 'and' }])
})

test('删除路由后这个名字不再是路由：条目消失，且不复活', () => {
  factory()
  sm.createRoute({ name: 'temp' })

  const removed = sm.deleteRoute('temp')

  assert.equal(removed.ok, true)
  if (!removed.ok) return
  assert.equal(removed.removed.name, 'temp')
  assert.equal(sm.getModelRoute('temp'), undefined)
  assert.deepEqual(resolveRouteRequest(sm.getModelRoutes(), 'temp'), { kind: 'not-a-route' })
  assert.deepEqual(sm.getConfig().routes!.temp, undefined)
})

test('停用不是删除：条目还在，解析给出 disabled', () => {
  factory()
  sm.createRoute({ name: 'paused' })

  sm.updateRoute('paused', { enabled: false })

  assert.equal(sm.getModelRoutes().paused.enabled, false)
  assert.equal(resolveRouteRequest(sm.getModelRoutes(), 'paused').kind, 'disabled')
  assert.deepEqual(Object.keys(sm.getModelRoutes()), ['auto', 'paused'])
})

test('`routes:list` 含停用的并按名字排序；`getModelRoute` 大小写不敏感', () => {
  factory()
  sm.createRoute({ name: 'zeta', enabled: false })
  sm.createRoute({ name: 'alpha' })

  assert.deepEqual(sm.listModelRoutes().map(r => r.name), ['alpha', 'auto', 'zeta'])
  assert.equal(sm.getModelRoute('ALPHA')?.name, 'alpha')
})

test('名称冲突（store 层，真目录）：与展示名/别名/已停用但仍在目录里的名都撞，错误带 code 与可读 message', () => {
  factory()
  sm.addProvider(providerFixture() as never)
  sm.addAccount(accountFixture('kp') as never)

  // 1) 在服的展示名 `Kimi-K3` → conflicts_model（大小写不同也算）
  const onModel = sm.createRoute({ name: 'kimi-k3' })
  assert.equal(onModel.ok, false)
  if (onModel.ok) throw new Error('unreachable')
  assert.equal(onModel.error.code, 'conflicts_model')
  assert.equal(onModel.error.message, "Route name 'kimi-k3' collides with the served model 'Kimi-K3'")

  // 2) 用户显式停用**但仍在目录里**的名字同样不许占用（否则请求解析会分叉）
  sm.setModelsServed('kp', ['Kimi-K3'], false)
  assert.equal(sm.getEffectiveModels('kp').length, 0, '停用的名字不再在服务')
  assert.deepEqual(sm.getModelCatalogue('kp').map(m => m.displayName), ['Kimi-K3'], '但条目留在目录里')
  const stopped = sm.createRoute({ name: 'Kimi-K3' })
  assert.equal(stopped.ok, false)
  if (stopped.ok) throw new Error('unreachable')
  assert.equal(stopped.error.code, 'conflicts_model')

  // 3) 供应商自己的映射名也占用（`provider.modelMappings` 的键）
  sm.addProvider(providerFixture('kp2', { supportedModels: [], modelMappings: { 'solo-name': 'x' } }) as never)
  const mappingKey = sm.createRoute({ name: 'solo-name' })
  assert.equal(mappingKey.ok, false)
  if (mappingKey.ok) throw new Error('unreachable')
  assert.equal(mappingKey.error.code, 'conflicts_model')

  // 4) 全局别名（`config.modelMappings` 的键）→ conflicts_alias
  sm.updateConfig({ modelMappings: { MyAlias: { actualModel: 'Kimi-K3' } satisfies ModelMapping } })
  const alias = sm.createRoute({ name: 'myalias' })
  assert.equal(alias.ok, false)
  if (alias.ok) throw new Error('unreachable')
  assert.equal(alias.error.code, 'conflicts_alias')
  assert.match(alias.error.message, /model alias 'MyAlias'/)

  // 5) routes 内大小写不敏感唯一：`foo` 与 `Foo` 是同一条
  const first = sm.createRoute({ name: 'foo' })
  assert.equal(first.ok, true)
  const dup = sm.createRoute({ name: 'Foo' })
  assert.equal(dup.ok, false)
  if (dup.ok) throw new Error('unreachable')
  assert.equal(dup.error.code, 'duplicate_name')
  assert.match(dup.error.message, /already exists/)
})

test('写入侧对非法值报错（读取侧是回落）：字符集、空串、含空格、未知池策略 id、未知打分口径', () => {
  factory()

  const cases: Array<[Record<string, unknown>, string]> = [
    [{ name: 'my route' }, 'invalid_name'],
    [{ name: '' }, 'invalid_name'],
    [{ name: '带中文' }, 'invalid_name'],
    [{ name: 'a'.repeat(65) }, 'invalid_name'],
    [{ name: 'ok-one', poolStrategies: [{ id: 'made-up' }] }, 'unknown_pool_strategy'],
    [{ name: 'ok-two', poolStrategies: 'vision-capable' }, 'invalid_input'],
    [{ name: 'ok-three', strategy: 'shuffle' }, 'invalid_input'],
  ]
  for (const [input, code] of cases) {
    const result = sm.createRoute(input as never)
    assert.equal(result.ok, false, `${JSON.stringify(input)} 本该被拒绝`)
    if (result.ok) continue
    assert.equal(result.error.code, code, `${JSON.stringify(input)} → ${result.error.message}`)
    assert.ok(result.error.message.length > 0, '错误必须带可读文案')
  }

  assert.deepEqual(Object.keys(sm.getModelRoutes()), ['auto'], '被拒绝的写入一个都不许落盘')
})

test('改名：撞别人被拒、改成自己放行；只改字段时不拿模型名拒绝（否则已生效路由永久写不进去）', () => {
  factory()
  sm.createRoute({ name: 'kimi-k3-before', prefer: 'cheap' })
  sm.createRoute({ name: 'taken' })

  const clash = sm.updateRoute('kimi-k3-before', { name: 'taken' })
  assert.equal(clash.ok, false)
  if (clash.ok) return
  assert.equal(clash.error.code, 'duplicate_name')

  const selfRename = sm.updateRoute('kimi-k3-before', { name: 'Kimi-K3-Before' })
  assert.equal(selfRename.ok, true, '改成同一个规范名不是冲突')

  // 表里已有的路由名与同名模型并存时，编辑**其它**字段必须还能保存：
  // 路由名优先于同名模型，这是拍板过的语义，不是要在这里拒绝的冲突。
  sm.addProvider(providerFixture('kpX', { supportedModels: ['kimi-k3-before'], modelMappings: {} }) as never)
  const patchOnly = sm.updateRoute('kimi-k3-before', { prefer: 'strong' })
  assert.equal(patchOnly.ok, true, JSON.stringify(patchOnly))
  if (patchOnly.ok) assert.equal(patchOnly.route.prefer, 'strong')

  const missing = sm.updateRoute('never-existed', { prefer: 'fast' })
  assert.equal(missing.ok, false)
  if (missing.ok) return
  assert.equal(missing.error.code, 'not_found')
})

test('`getRouteNameOccupants` 把「目录展示名（含停用）+ 供应商映射名 + 全局别名」两路来源都交出来', () => {
  factory()
  sm.addProvider(providerFixture('kpa', { supportedModels: ['Kimi-K3', 'glm-4.6'], modelMappings: { 'inner-name': 'x' } }) as never)
  sm.addAccount(accountFixture('kpa') as never)
  sm.setModelsServed('kpa', ['glm-4.6'], false)
  sm.updateConfig({ modelMappings: { 'My-Alias': { actualModel: 'Kimi-K3' } satisfies ModelMapping } })

  const occupants = sm.getRouteNameOccupants()

  assert.ok(occupants.modelNames.includes('Kimi-K3'))
  assert.ok(occupants.modelNames.includes('glm-4.6'), '已停用但仍在目录里的名字也要占用')
  assert.ok(occupants.modelNames.includes('inner-name'))
  assert.ok(occupants.aliases.includes('My-Alias'))
})

// ------------------------------------------------------------------------ F（R1）

test('R1：同步/刷新/归一/启动修复都不写 `excludedModels`；新进来的模型一律在服务', () => {
  factory()
  sm.addProvider(providerFixture('sync') as never)
  sm.addAccount(accountFixture('sync') as never)

  const before = structuredClone(sm.getStore().get('userModelOverrides') ?? {})

  // (1) 在线刷新模型列表（`providers:updateModels` / `aggregate.syncModels` 的落库出口）
  const synced = sm.applyFetchedModels('sync', [
    { displayName: 'sync/brand-new', actualModelId: 'brand-new' },
    { displayName: 'sync/another', actualModelId: 'another' },
  ])
  assert.equal(synced.addedCount, 2)
  assert.deepEqual(
    sm.getEffectiveModels('sync').map(m => m.displayName),
    ['Kimi-K3', 'sync/brand-new', 'sync/another'],
    '新同步进来的模型必须直接可路由，不需要用户再点一次「启用」',
  )
  const afterSync = sm.getStore().get('userModelOverrides').sync
  assert.deepEqual(before, {}, '起点是覆盖表为空')
  assert.deepEqual(afterSync.excludedModels, [], 'applyFetchedModels 不许写 excludedModels')
  assert.deepEqual(afterSync.addedModels, [])
  assert.deepEqual(
    afterSync.fetchedModels.map((m: { displayName: string }) => m.displayName),
    ['sync/brand-new', 'sync/another'],
  )
  assert.equal(typeof afterSync.fetchedAt, 'number')

  // (2) 供应商目录被启动同步重写（`initializeDefaultProviders` 每次启动都干这事）
  sm.updateProvider('sync', { supportedModels: ['Kimi-K3', 'sync/brand-new', 'sync/another', 'sync/third'] })
  assert.deepEqual(sm.getStore().get('userModelOverrides').sync.excludedModels, [])
  assert.ok(sm.getEffectiveModels('sync').some(m => m.displayName === 'sync/third'))

  // (3) 启动期的记录修复路径
  sm.ensureProviderExists('sync')
  sm.ensureLocalAccount('sync')
  assert.deepEqual(sm.getStore().get('userModelOverrides').sync.excludedModels, [])

  // (4) 配置的读/写/归一/迁移路径同样不许顺手停用任何模型
  const snapshot = structuredClone(sm.getStore().get('userModelOverrides'))
  sm.getConfig()
  sm.updateConfig({ proxyPort: 8090 })
  sm.setConfig({ ...sm.getConfig() })
  sm.createRoute({ name: 'router-a' })
  sm.updateRoute('router-a', { enabled: false })
  sm.deleteRoute('router-a')
  sm.resetConfig()
  assert.deepEqual(sm.getStore().get('userModelOverrides'), snapshot, '以上任一路径写坏了 userModelOverrides')

  // (5) 正控制：用户显式停用**确实**要落进 excludedModels，并让 served 翻面
  const stopped = sm.setModelsServed('sync', ['sync/third'], false)
  assert.equal(stopped.find(m => m.displayName === 'sync/third')?.served, false)
  assert.deepEqual(sm.getStore().get('userModelOverrides').sync.excludedModels, ['sync/third'])
  assert.ok(!sm.getEffectiveModels('sync').some(m => m.displayName === 'sync/third'))
})

test('R1：`served = !excluded.has(name)` 对三种来源（shipped / hand-added / fetched）都成立', () => {
  factory()
  sm.addProvider(providerFixture('mixed', { supportedModels: ['shipped-one'], modelMappings: { 'shipped-one': 'shipped-one' } }) as never)
  sm.addAccount(accountFixture('mixed') as never)
  sm.applyFetchedModels('mixed', [{ displayName: 'mixed/fetched-one', actualModelId: 'fetched-one' }])
  sm.addCustomModel('mixed', { displayName: 'mixed/custom-one', actualModelId: 'custom-one' })

  assert.deepEqual(
    sm.getModelCatalogue('mixed').map(m => [m.displayName, m.served]),
    [['shipped-one', true], ['mixed/custom-one', true], ['mixed/fetched-one', true]],
  )

  sm.setModelsServed('mixed', ['mixed/fetched-one'], false)
  assert.deepEqual(
    sm.getModelCatalogue('mixed').map(m => [m.displayName, m.served]),
    [['shipped-one', true], ['mixed/custom-one', true], ['mixed/fetched-one', false]],
    '只有被点名的那条翻面',
  )
  assert.deepEqual(sm.getStore().get('userModelOverrides').mixed.excludedModels, ['mixed/fetched-one'])
})

test('R1：路由与「在服务」的交集是现算的 —— 停用一个模型后它不再出现在任何路由的候选里', () => {
  factory()
  sm.addProvider(providerFixture('pool') as never)
  sm.addAccount(accountFixture('pool') as never)
  sm.createRoute({ name: 'all' })

  assert.deepEqual(sm.getEffectiveModels('pool').map(m => m.displayName), ['Kimi-K3'])
  sm.setModelsServed('pool', ['Kimi-K3'], false)
  assert.deepEqual(sm.getEffectiveModels('pool'), [])
  // 路由表本身**没有**因为目录变化而写入任何东西（键序是归一的排序，不是插入序）
  assert.deepEqual(Object.keys(sm.getModelRoutes()), ['all', 'auto'])
  assert.deepEqual(sm.getStore().get('userModelOverrides').pool.excludedModels, ['Kimi-K3'], '唯一写入者是上面那次显式停用')
})

test('收尾：路由表的最终落盘形态与 getConfig 一致（不给下一个用例留脏状态）', () => {
  factory()
  const created = sm.createRoute({ name: 'final', strategy: 'smart' })
  assert.equal(created.ok, true)

  assert.deepEqual(sm.getConfig().routes, configOnDisk().routes)
  harness.dispose()
})
