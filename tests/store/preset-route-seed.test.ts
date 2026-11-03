/**
 * 「协议路由」一次性播种的判据（R2 之后 `/v1/models` 只广告路由名，所以只会说
 * 某套入站协议的客户端要有一个属于自己的名字）。
 *
 * 两层各钉各的：
 * - 纯函数层：`pendingPresetRouteSeeds` 的记档判据、`presetRouteFields` 的继承口径；
 * - 落库层：真 `storeManager.initialize()` 之后表里确实多了一条 `codex`，字段与 `auto`
 *   一致，且记档写进了盘上的 config（那是「删掉以后不许复活」唯一的证据）。
 *
 * 不证明的：界面路由卡片怎么显示这一条（在 renderer）、名字被模型占用时的跳过
 * （那个场景要一个不同的初始存储对象，见 `protocol-route-seed-conflict.test.ts`）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const harness = await bootstrapStore({
  // 这一份要的就是真实播种行为（默认夹具会写记档键跳过它，见 harness.mjs）。
  seedPresetRoutes: true,
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: {
      // `routes` 键**存在**：这是「已经迁移过」的老数据，播种不能借用那条迁移的判据。
      routes: {
        auto: {
          name: 'auto',
          enabled: true,
          strategy: 'fill-first',
          prefer: 'cheap',
          maxAttempts: 4,
          stickyMinutes: 20,
          poolStrategies: [{ id: 'free-only', operator: 'and' }],
          pinModels: [],
          includeModels: [],
          excludeModels: [],
        },
      },
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

const {
  pendingPresetRouteSeeds,
  presetRouteFields,
  PRESET_ROUTE_SEEDS,
} = await loadModule('main/store/modelRoutes.ts')

after(() => harness.dispose())

const seedNamed = (name: string) => {
  const seed = PRESET_ROUTE_SEEDS.find(entry => entry.name === name)
  assert.ok(seed, `PRESET_ROUTE_SEEDS 里没有 ${name}`)
  return seed
}

/* ------------------------------------------------------------------ 纯函数层 */

test('记档判据只看这个名字有没有被记过，不看路由表是否为空', () => {
  assert.deepEqual(pendingPresetRouteSeeds(undefined).map(s => s.name), PRESET_ROUTE_SEEDS.map(s => s.name))
  assert.deepEqual(pendingPresetRouteSeeds([]).map(s => s.name), PRESET_ROUTE_SEEDS.map(s => s.name))
  assert.deepEqual(pendingPresetRouteSeeds(PRESET_ROUTE_SEEDS.map(s => s.name)), [], '记过就不再造，删掉也不复活')
  assert.deepEqual(pendingPresetRouteSeeds(['别的名字']).map(s => s.name), PRESET_ROUTE_SEEDS.map(s => s.name))

  // 磁盘原值可能是手写的怪值：不修、不抛，按「没记过」处理。
  assert.deepEqual(pendingPresetRouteSeeds('codex').map(s => s.name), PRESET_ROUTE_SEEDS.map(s => s.name))
  assert.deepEqual(pendingPresetRouteSeeds([1, null, {}]).map(s => s.name), PRESET_ROUTE_SEEDS.map(s => s.name))
})

test('播种出来的字段除名字以外全部沿用 auto', () => {
  const auto = {
    name: 'auto',
    enabled: true,
    strategy: 'fill-first',
    prefer: 'cheap',
    maxAttempts: 4,
    stickyMinutes: 20,
    poolStrategies: [{ id: 'free-only', operator: 'and' }],
    pinModels: [{ providerId: 'p', displayName: 'M' }],
    includeModels: [],
    excludeModels: [],
  }
  const legacy = { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] }

  assert.deepEqual(presetRouteFields(auto as never, legacy as never, 'round-robin', seedNamed('codex')), {
    enabled: true,
    strategy: 'fill-first',
    prefer: 'cheap',
    maxAttempts: 4,
    stickyMinutes: 20,
    // 粘性硬优先与 stickyMinutes 同一条继承规则：auto 没关（缺省即开）时种子也是开。
    stickyHardPin: true,
    poolStrategies: [{ id: 'free-only', operator: 'and' }],
    // auto 的钉名是「这一条路由只跑那几家」的语义，不能替另一套协议继承过去。
    pinModels: [],
    includeModels: [],
    excludeModels: [],
  })

  // 用户在 auto 上关过硬钉 ⇒ 新种下的那条不许被悄悄打开（与上面 enabled 那一条同理）。
  const unpinned = presetRouteFields(
    { ...auto, stickyHardPin: false } as never,
    legacy as never,
    'round-robin',
    seedNamed('codex')
  )
  assert.equal(unpinned.stickyHardPin, false)

  // auto 已被删除时回落到 legacy 那份，而不是拿一个出厂常量替用户决定。
  const fallback = presetRouteFields(undefined, legacy as never, 'smart', seedNamed('codex'))
  assert.equal(fallback.strategy, 'smart')
  assert.equal(fallback.maxAttempts, 2)

  // 用户关掉过 auto ⇒ 新名字也不许被悄悄打开。
  const disabled = presetRouteFields({ ...auto, enabled: false } as never, legacy as never, 'round-robin', seedNamed('codex'))
  assert.equal(disabled.enabled, false)
})

test('三档的差异就是它们的池与优化目标，其余仍沿用 auto', () => {
  // 用一个与三档**都不同**的 auto 作模板：差异只能来自档位自己，不能是从模板漏下来的。
  const auto = {
    name: 'auto',
    enabled: true,
    strategy: 'fill-first',
    prefer: 'fast',
    maxAttempts: 4,
    stickyMinutes: 20,
    poolStrategies: [{ id: 'vision-capable', operator: 'and' }],
    pinModels: [],
    includeModels: [],
    excludeModels: [],
  }
  const legacy = { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] }

  const daily = presetRouteFields(auto as never, legacy as never, 'round-robin', seedNamed('daily'))
  assert.deepEqual(daily.poolStrategies, [{ id: 'free-only', operator: 'and' }], '日常＝免费档：不是花不花钱的偏好，而是只留免费候选')
  assert.equal(daily.prefer, 'cheap')

  const stable = presetRouteFields(auto as never, legacy as never, 'round-robin', seedNamed('stable'))
  assert.deepEqual(stable.poolStrategies, [{ id: 'channel-only', operator: 'and' }], '稳定＝账号渠道：聚合与自定义整批不进池，不花聚合的钱')
  assert.equal(stable.prefer, 'balanced')

  const performance = presetRouteFields(auto as never, legacy as never, 'round-robin', seedNamed('performance'))
  assert.deepEqual(performance.poolStrategies, [{ id: 'strong-tier', operator: 'and' }], '性能＝强档：弱档与未标注的模型不进池')
  assert.equal(performance.prefer, 'strong')

  // 策略与粘性不属于档位语义，照旧沿模板。
  for (const fields of [daily, stable, performance]) {
    assert.equal(fields.strategy, 'fill-first')
    assert.equal(fields.maxAttempts, 4)
    assert.equal(fields.stickyMinutes, 20)
  }
})

/* ------------------------------------------------------------------ 落库层 */

test('存储初始化后表里多出四条预设路由，协议那条与 auto 一致、三档各带自己的池', () => {
  const routes = sm.getConfig().routes as Record<string, any>
  const names = Object.keys(routes).sort()

  assert.deepEqual(names, ['auto', 'codex', 'daily', 'performance', 'stable'], `实际路由表：${names.join(', ')}`)

  // 协议路由：除名字以外沿用 auto（夹具里的 auto 是 fill-first / cheap / free-only）。
  assert.deepEqual(routes.codex, {
    ...routes.auto,
    name: 'codex',
    pinModels: [],
  })

  assert.equal(routes.daily.enabled, true)
  assert.deepEqual(routes.daily.poolStrategies, [{ id: 'free-only', operator: 'and' }])
  assert.equal(routes.daily.prefer, 'cheap')

  assert.deepEqual(routes.stable.poolStrategies, [{ id: 'channel-only', operator: 'and' }])
  assert.equal(routes.stable.prefer, 'balanced')

  assert.deepEqual(routes.performance.poolStrategies, [{ id: 'strong-tier', operator: 'and' }])
  assert.equal(routes.performance.prefer, 'strong')

  // 三档都不钉名：钉谁只能来自用户目录里真实存在的 (providerId, displayName)。
  for (const name of ['daily', 'stable', 'performance']) {
    assert.deepEqual(routes[name].pinModels, [], `${name} 不该出厂钉名`)
    assert.deepEqual(routes[name].includeModels, [])
    assert.deepEqual(routes[name].excludeModels, [])
  }
})

test('记档落在盘上的 config 里，删除以后不再复活', () => {
  const onDisk = harness.dataFile().config
  assert.deepEqual(onDisk.seededPresetRoutes, PRESET_ROUTE_SEEDS.map(seed => seed.name), '没有这一格，下次启动会把它再造出来')

  const removed = sm.deleteRoute('codex')
  assert.equal(removed.ok, true)

  // 同一次启动内不重播（播种只跑一次），而盘上的记档保证下次启动也不重播。
  assert.equal(sm.getConfig().routes?.codex, undefined)
  assert.deepEqual(harness.dataFile().config.seededPresetRoutes, PRESET_ROUTE_SEEDS.map(seed => seed.name))
  assert.deepEqual(pendingPresetRouteSeeds(harness.dataFile().config.seededPresetRoutes), [])
})
