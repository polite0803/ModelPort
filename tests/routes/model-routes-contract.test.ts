/**
 * 多路由（`AppConfig.routes`）的**纯函数层**契约测试。
 *
 * 证明的层次：`src/main/store/modelRoutes.ts`（归一 / legacy 迁移 / 请求解析 / 写入校验）
 * 与 `src/shared/modelRouteName.ts`（名字规则的唯一真值源）。这两处不 import electron，
 * 所以本文件跑的是真代码，不是读源码文本。
 *
 * 不在本文件证明的层次：落盘与迁移判据（`store.ts::normalizeRoutes` 的「原始对象有没有
 * `routes` 键」）→ `store-routes-migration.test.ts`；HTTP 状态码/响应头 →
 * `proxy-routes-request.test.ts`；粘性隔离 → `routes-sticky-isolation.test.ts`。
 *
 * 覆盖验收项：C 的读取侧（非法池策略安全丢弃）与写入侧报错、D 的名字校验、
 * G 的「删除 auto 后不再是路由」的解析语义、B 的迁移**内容**（内容之外的幂等见 migration 文件）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LEGACY_AUTO_ROUTE_NAME,
  allModelRoutes,
  checkPoolStrategyIds,
  checkRouteName,
  enabledModelRoutes,
  findModelRoute,
  isRouteStrategyValue,
  mergeRouteTables,
  normalizeModelRoutes,
  resolveRouteRequest,
  routesFromLegacyAutoRouting,
  validateRoutesForWrite,
} from '../../src/main/store/modelRoutes.ts'
import { normalizeAutoRoutingConfig } from '../../src/main/store/autoRoutingConfig.ts'
import {
  ROUTE_NAME_MAX_LENGTH,
  canonicalRouteName,
  findRouteNameConflict,
  hasRouteNamed,
  isCanonicalRouteName,
  routeNamesOf,
  validateRouteNameInput,
} from '../../src/shared/modelRouteName.ts'
import { DEFAULT_AUTO_ROUTING_CONFIG } from '../../src/shared/types.ts'

/** 一条完整合法的持久化条目，用来做「缺省字段必须落到出厂值」的对照。 */
const FULL_ROUTE = {
  name: 'fast',
  enabled: true,
  strategy: 'pace',
  prefer: 'fast',
  maxAttempts: 5,
  stickyMinutes: 120,
  poolStrategies: [{ id: 'vision-capable', operator: 'and' }],
}

// ---------------------------------------------------------------- 读取侧归一

test('空壳条目也得到与 legacy 同一套出厂值（缺省≠0，也≠undefined）', () => {
  const normalized = normalizeModelRoutes({ fast: {} })

  assert.deepEqual(normalized.fast, {
    name: 'fast',
    enabled: true,
    strategy: 'round-robin',
    prefer: DEFAULT_AUTO_ROUTING_CONFIG.prefer,
    maxAttempts: DEFAULT_AUTO_ROUTING_CONFIG.maxAttempts,
    stickyMinutes: DEFAULT_AUTO_ROUTING_CONFIG.stickyMinutes,
    poolStrategies: [],
    includeModels: [],
    excludeModels: [],
    pinModels: [],
  })
  assert.notEqual(normalized.fast, undefined)
})

test('键即名字：`name` 字段与键不一致时以键为准并把 name 修成键', () => {
  // 请求解析、/v1/models、sticky 键都按「键 == name」读，留着两套写法就会分叉。
  const normalized = normalizeModelRoutes({ fast: { name: 'FAST', enabled: true } })

  assert.deepEqual(Object.keys(normalized), ['fast'])
  assert.equal(normalized.fast.name, 'fast')
})

test('非法键（大写 / 越界字符集 / 空 / 超长）整条丢弃且绝不抛异常', () => {
  const handBroken = {
    'Foo': FULL_ROUTE, // 大写键：规范化后不再是它自己
    'my route': FULL_ROUTE, // 含空格：要进 X-ModelPort-Route-Name，留着就是把 500 写进盘
    '带中文': FULL_ROUTE,
    [`${'a'.repeat(ROUTE_NAME_MAX_LENGTH + 1)}`]: FULL_ROUTE,
    '': FULL_ROUTE,
    'good-one': FULL_ROUTE,
  }
  const normalized = normalizeModelRoutes(handBroken)

  assert.deepEqual(Object.keys(normalized), ['good-one'])
})

test('入参不是「按名字建键的对象」时得到空表（数组 / 标量 / null / undefined）', () => {
  for (const bad of [undefined, null, 'auto', 42, [], [{ name: 'fast' }]]) {
    assert.deepEqual(normalizeModelRoutes(bad), {}, `input=${JSON.stringify(bad)}`)
  }
})

test('条目值不是对象时丢弃该条，但同表其他条目照常归一', () => {
  const normalized = normalizeModelRoutes({
    keep: { enabled: true },
    'not-object': 'yes',
    nully: null,
    arr: [1, 2],
  })

  assert.deepEqual(Object.keys(normalized), ['keep'])
})

test('大小写不敏感重复的键只保留一条（`foo` 与 `Foo` 是同一条路由）', () => {
  const normalized = normalizeModelRoutes({
    foo: { enabled: true, maxAttempts: 2 },
    Foo: { enabled: true, maxAttempts: 5 },
  })

  assert.deepEqual(Object.keys(normalized), ['foo'])
  assert.equal(normalized.foo.maxAttempts, 2, '合法的那条（键 == 规范名）必须留下')
})

test('非法 strategy 回落调用方传入的口径，而不是把请求打到另一个权重表上', () => {
  // 读取侧「手坏就兜住」，与写入侧报错（下面的 isRouteStrategyValue）是两条不同契约。
  assert.equal(normalizeModelRoutes({ r: { strategy: 'not-a-strategy' } }, { fallbackStrategy: 'smart' }).r.strategy, 'smart')
  assert.equal(normalizeModelRoutes({ r: { strategy: 42 } }, { fallbackStrategy: 'pace' }).r.strategy, 'pace')
  assert.equal(normalizeModelRoutes({ r: {} }).r.strategy, 'round-robin', '不传 fallback 时是出厂口径')
  assert.equal(normalizeModelRoutes({ r: { strategy: 'failover' } }, { fallbackStrategy: 'smart' }).r.strategy, 'failover')
})

test('逐路由字段复用 legacy 的边界：maxAttempts 1-5、stickyMinutes 0-1440、未知 prefer→balanced', () => {
  // 口径与 legacy `normalizeAutoRoutingConfig` 逐字一致：undefined→出厂默认，
  // 而 `null` 是「写了但值是 null」→ `Number(null)=0` → 参与钳位（不是回落默认）。
  // 这条区别不是新发明的：它就是今天 `config.autoRouting` 的行为，路由只是复用。
  const clamp = (entry: Record<string, unknown>) => normalizeModelRoutes({ r: entry }).r!

  assert.equal(clamp({ maxAttempts: 99 }).maxAttempts, 5)
  assert.equal(clamp({ maxAttempts: 0 }).maxAttempts, 1)
  assert.equal(clamp({ maxAttempts: -3 }).maxAttempts, 1)
  assert.equal(clamp({ maxAttempts: 2.6 }).maxAttempts, 3, '四舍五入而不是截断，与 legacy 同')
  assert.equal(clamp({ maxAttempts: 'abc' }).maxAttempts, DEFAULT_AUTO_ROUTING_CONFIG.maxAttempts)
  assert.equal(clamp({ maxAttempts: null }).maxAttempts, 1, 'null → Number(null)=0 → 钳到下限')
  assert.equal(clamp({}).maxAttempts, DEFAULT_AUTO_ROUTING_CONFIG.maxAttempts)

  assert.equal(clamp({ stickyMinutes: 9999 }).stickyMinutes, 1440)
  assert.equal(clamp({ stickyMinutes: -1 }).stickyMinutes, 0)
  assert.equal(clamp({ stickyMinutes: 'abc' }).stickyMinutes, DEFAULT_AUTO_ROUTING_CONFIG.stickyMinutes)
  assert.equal(clamp({ stickyMinutes: null }).stickyMinutes, 0, 'null 参与钳位，与 maxAttempts 同一口径')
  assert.equal(clamp({}).stickyMinutes, DEFAULT_AUTO_ROUTING_CONFIG.stickyMinutes)

  assert.equal(clamp({ prefer: 'cheapest' }).prefer, 'balanced')
  assert.equal(clamp({ prefer: 'cheap' }).prefer, 'cheap')
})

test('`enabled` 的读取侧只在显式 false 时为假；非布尔在**写入侧**才报错', () => {
  assert.equal(normalizeModelRoutes({ r: { enabled: false } }).r.enabled, false)
  assert.equal(normalizeModelRoutes({ r: { enabled: 'false' } }).r.enabled, true, "读取侧只认 `=== false`：手写的字符串不算关掉")
  assert.equal(normalizeModelRoutes({ r: { enabled: 0 } }).r.enabled, true)
  assert.equal(normalizeModelRoutes({ r: {} }).r.enabled, true)

  // 同一个非法值在整表写入校验里必须报错 —— 静默回落等于「我明明勾了停用」。
  assert.match(
    validateRoutesForWrite({ r: { enabled: 'false' } }, {}, { modelNames: [], aliases: [] }).join('\n'),
    /'enabled' must be a boolean/,
  )
})

test('未知池策略 id 在读取侧被安全丢弃（不报错），非法 operator 回落 and', () => {
  const normalized = normalizeModelRoutes({
    r: {
      poolStrategies: [
        { id: 'vision-capable', operator: 'or' },
        { id: 'made-up-strategy', operator: 'and' },
        { id: 'tools-capable', operator: 'maybe' },
        'not-an-object',
        null,
        { operator: 'and' },
      ],
    },
  })

  assert.deepEqual(normalized.r.poolStrategies, [
    { id: 'vision-capable', operator: 'or' },
    { id: 'tools-capable', operator: 'and' },
  ])
})

test('归一绝不改入参，且返回的条目是新对象（仓库的不可变规矩）', () => {
  const input = { r: { ...FULL_ROUTE, poolStrategies: [{ id: 'vision-capable', operator: 'or' }] } }
  const snapshot = structuredClone(input)
  const normalized = normalizeModelRoutes(input)

  assert.deepEqual(input, snapshot, '入参必须逐字节保持原状')
  assert.notEqual(normalized.r, input.r)
  assert.notEqual(normalized.r.poolStrategies, input.r.poolStrategies)
})

// ------------------------------------------------------------------ 列表与顺序

test('路由列表按名字显式排序，不依赖 Record 的迭代顺序（整数键会被提升）', () => {
  const routes = normalizeModelRoutes({
    fast: { enabled: true },
    '2026': { enabled: true },
    auto: { enabled: true },
    zeta: { enabled: false },
  })

  assert.deepEqual(allModelRoutes(routes).map(r => r.name), ['2026', 'auto', 'fast', 'zeta'])
  assert.deepEqual(enabledModelRoutes(routes).map(r => r.name), ['2026', 'auto', 'fast'])
  assert.deepEqual(allModelRoutes(undefined), [])
  assert.deepEqual(enabledModelRoutes(undefined), [])
})

// ------------------------------------------------------------------ 一次性迁移

test('迁移：legacy `autoRouting` 的每一项都原样进 `auto` 路由（含用户关掉的开关）', () => {
  const legacy = normalizeAutoRoutingConfig({
    enabled: false,
    maxAttempts: 5,
    stickyMinutes: 0,
    prefer: 'cheap',
    poolStrategies: [{ id: 'long-context', operator: 'and' }],
  })
  const migrated = routesFromLegacyAutoRouting(legacy, { fallbackStrategy: 'fill-first' })

  assert.deepEqual(Object.keys(migrated), [LEGACY_AUTO_ROUTE_NAME])
  assert.deepEqual(migrated.auto, {
    name: 'auto',
    enabled: false,
    strategy: 'fill-first',
    prefer: legacy.prefer,
    maxAttempts: legacy.maxAttempts,
    stickyMinutes: legacy.stickyMinutes,
    poolStrategies: legacy.poolStrategies,
    includeModels: [],
    excludeModels: [],
    pinModels: [],
  })
})

test('迁移：没有 legacy 配置时得到一条出厂默认的 `auto`（全新安装）', () => {
  assert.deepEqual(routesFromLegacyAutoRouting(undefined), {
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

test('迁移：手坏的 legacy 值走同一兜底，绝不把 absurd 值带进路由', () => {
  const migrated = routesFromLegacyAutoRouting({ maxAttempts: 'abc', stickyMinutes: 10_000, prefer: 'zzz' })

  assert.equal(migrated.auto.maxAttempts, DEFAULT_AUTO_ROUTING_CONFIG.maxAttempts)
  assert.equal(migrated.auto.stickyMinutes, 1440)
  assert.equal(migrated.auto.prefer, 'balanced')
})

// ------------------------------------------------------------------ 请求解析

test('解析大小写不敏感并 trim：` FAST ` 命中的是 `fast` 那条', () => {
  const routes = normalizeModelRoutes({ fast: { enabled: true } })

  for (const requested of ['fast', 'FAST', '  Fast  ']) {
    assert.equal(findModelRoute(routes, requested)?.name, 'fast', requested)
  }
  assert.equal(findModelRoute(routes, 'slow'), undefined)
  assert.equal(findModelRoute(routes, undefined), undefined)
  assert.equal(findModelRoute(routes, '   '), undefined, '空白不是路由名')
})

test('三态判定：在服=routable、停用=disabled、查不到=not-a-route', () => {
  const routes = normalizeModelRoutes({ fast: { enabled: true }, slow: { enabled: false } })

  assert.deepEqual(resolveRouteRequest(routes, 'fast'), { kind: 'routable', route: routes.fast })
  assert.equal(resolveRouteRequest(routes, 'slow').kind, 'disabled')
  assert.deepEqual(resolveRouteRequest(routes, 'nope'), { kind: 'not-a-route' })
})

test('删掉 `auto` 之后 `model="auto"` 就是 not-a-route（保留名不再享有特权）', () => {
  // 这条钉住的是「不许为删除的 auto 留第二条分支」：回退 legacy 全局 autoRouting 的
  // 唯一入口是 autoRouter.select 的 `route ?? legacy` 兜底，而调用方只在 routable 时才进。
  const routes = normalizeModelRoutes({ fast: { enabled: true } })

  assert.deepEqual(resolveRouteRequest(routes, 'auto'), { kind: 'not-a-route' })
  assert.deepEqual(resolveRouteRequest({}, 'auto'), { kind: 'not-a-route' })
  assert.deepEqual(resolveRouteRequest(undefined, 'auto'), { kind: 'not-a-route' })
})

test('停用的路由名仍然「是路由」：给可读的 disabled，而不是掉进具名模型路径', () => {
  const routes = normalizeModelRoutes({ auto: { enabled: false } })
  const outcome = resolveRouteRequest(routes, 'auto')

  assert.equal(outcome.kind, 'disabled')
  assert.equal('route' in outcome && outcome.route.enabled, false)
})

// ------------------------------------------------------------------ 写入侧校验

test('写入侧的 strategy 是白名单（读取侧回落、写入侧报错，两条契约不许互串）', () => {
  for (const good of ['round-robin', 'fill-first', 'failover', 'smart', 'pace']) {
    assert.equal(isRouteStrategyValue(good), true, good)
  }
  for (const bad of ['auto', 'random', '', 'ROUND-ROBIN', 42, undefined, null]) {
    assert.equal(isRouteStrategyValue(bad), false, String(bad))
  }
})

test('`checkPoolStrategyIds`：undefined 放行、非数组 invalid_input、未知 id 报可读错误', () => {
  assert.equal(checkPoolStrategyIds(undefined), undefined)
  assert.deepEqual(checkPoolStrategyIds('vision-capable'), {
    code: 'invalid_input',
    message: "Route field 'poolStrategies' must be an array",
  })
  assert.deepEqual(checkPoolStrategyIds([]), undefined)
  assert.deepEqual(checkPoolStrategyIds([{ id: 'vision-capable', operator: 'or' }]), undefined)

  const error = checkPoolStrategyIds([{ id: 'nope' }])
  assert.equal(error?.code, 'unknown_pool_strategy')
  assert.match(error!.message, /Unknown pool strategy id/)
  assert.equal(checkPoolStrategyIds([{ operator: 'and' }])?.code, 'unknown_pool_strategy', '缺 id 同样是未知')
  assert.equal(checkPoolStrategyIds([null])?.code, 'unknown_pool_strategy')
})

test('名字规则：trim + 小写化 + 1-64 + 仅 `[a-z0-9_-]`，非字符串/空/内部含空格/超长/字符集各有独立文案', () => {
  assert.equal(ROUTE_NAME_MAX_LENGTH, 64)
  // 规范化会 trim；写入校验吃同一条规则：**首尾空白被裁掉后**再判非法，只有内部空白才报错。
  assert.equal(canonicalRouteName(' My-Route_2 '), 'my-route_2')
  assert.deepEqual(validateRouteNameInput('my-route_2'), { ok: true, name: 'my-route_2' })
  assert.deepEqual(validateRouteNameInput('AUTO'), { ok: true, name: 'auto' })
  assert.deepEqual(validateRouteNameInput(' My-Route_2 '), { ok: true, name: 'my-route_2' }, 'trim 后接受，返回规范形')
  assert.deepEqual(validateRouteNameInput(' Fast '), { ok: true, name: 'fast' })
  assert.equal(validateRouteNameInput('a'.repeat(ROUTE_NAME_MAX_LENGTH)).ok, true)
  assert.equal(validateRouteNameInput('a'.repeat(ROUTE_NAME_MAX_LENGTH + 1)).ok, false)

  const cases: Array<[unknown, string]> = [
    [42, 'Route name must be a string'],
    ['', 'Route name must not be empty'],
    ['   ', 'Route name must not be empty'],
    ['my route', 'must not contain spaces'],
    ['a b', 'must not contain spaces'],
    ['foo.bar', 'may only use a-z, 0-9, underscore and hyphen'],
    ['kilo/gpt-4o', 'may only use a-z, 0-9, underscore and hyphen'],
    ['a'.repeat(65), 'must be at most 64 characters'],
  ]
  for (const [raw, fragment] of cases) {
    const result = validateRouteNameInput(raw)
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(raw)}`)
    if (result.ok) continue
    assert.equal(result.error.code, 'invalid_name', JSON.stringify(raw))
    assert.match(result.error.message, new RegExp(fragment), `${JSON.stringify(raw)} → ${result.error.message}`)
  }

  // 全非 ASCII / 控制字符都进不来：名字要写进 `X-ModelPort-Route-Name`。
  assert.equal(validateRouteNameInput('带中文').ok, false)
  assert.equal(isCanonicalRouteName('auto\n'), false)
  assert.equal(isCanonicalRouteName('Auto'), false)
  assert.equal(canonicalRouteName(undefined), '')
})

test('冲突查找大小写不敏感，并且报出**占用者**的原始写法', () => {
  assert.equal(findRouteNameConflict('gpt-4o', ['GPT-4o', 'glm']), 'GPT-4o')
  assert.equal(findRouteNameConflict('glm', ['GPT-4o']), undefined)
  assert.deepEqual(routeNamesOf({ fast: { name: 'fast', enabled: true, strategy: 'pace', prefer: 'balanced', maxAttempts: 3, stickyMinutes: 30, poolStrategies: [] }, stale: { name: 'other', enabled: true, strategy: 'pace', prefer: 'balanced', maxAttempts: 3, stickyMinutes: 30, poolStrategies: [] } }), ['fast', 'stale', 'other'])
  assert.equal(hasRouteNamed({ fast: { name: 'fast', enabled: true, strategy: 'pace', prefer: 'balanced', maxAttempts: 3, stickyMinutes: 30, poolStrategies: [] } }, 'FAST'), true)
  assert.equal(hasRouteNamed({ fast: { name: 'fast', enabled: true, strategy: 'pace', prefer: 'balanced', maxAttempts: 3, stickyMinutes: 30, poolStrategies: [] } }, 'fast', 'fast'), false, '改名成自己不算冲突')
})

test('`checkRouteName` 的拒绝顺序：字符集 → 表内重复 → 模型名 → 别名，文案指得对问题', () => {
  const routes = normalizeModelRoutes({ fast: { enabled: true } })
  const base = {
    routes,
    // 占用者刻意混着写：带 `.`/`/` 的聚合展示名与路由字符集不可能相等，
    // 只有 `[a-z0-9_-]` 形的名字才可能真的撞（见下面那条独立的用例）。
    modelNameOccupants: ['Kimi-K3', 'GLM-4.6', 'kilo/gpt-4o'],
    aliasOccupants: ['MyAlias'],
  }

  assert.equal(checkRouteName({ ...base, name: 'cheap-pool' }), undefined)
  assert.equal(checkRouteName({ ...base, name: 'my route' })?.code, 'invalid_name', '字符集不过就别提别的')
  assert.deepEqual(checkRouteName({ ...base, name: 'fast' }), {
    code: 'duplicate_name',
    message: "A route named 'fast' already exists",
  })
  // 展示名/别名比较都大小写不敏感，且错误文案带上撞上的那个**原始写法**
  assert.deepEqual(checkRouteName({ ...base, name: 'kimi-k3' }), {
    code: 'conflicts_model',
    message: "Route name 'kimi-k3' collides with the served model 'Kimi-K3'",
  })
  assert.equal(checkRouteName({ ...base, name: 'glm' }), undefined, '目录名是 GLM-4.6，不是 glm')
  assert.equal(checkRouteName({ ...base, name: 'myalias' })?.code, 'conflicts_alias')
  assert.match(checkRouteName({ ...base, name: 'myalias' })!.message, /model alias 'MyAlias'/)

  // 改名成自己：`excluding` 必须让这条路放行，否则每次编辑都自我拒绝
  assert.equal(checkRouteName({ ...base, name: 'fast', excluding: 'fast' }), undefined)
})

test('路由字符集与聚合展示名的关系：带 `.` 或 `/` 的模型名不可能被路由名占走', () => {
  // 这不是兜底，是字符集的必然结果：`kilo/gpt-4o` 这种展示名连 `validateRouteNameInput`
  // 都进不来，所以「路由名优先于同名模型」永远不会把这类模型挤出解析路径。
  const base = {
    routes: {},
    modelNameOccupants: ['kilo/gpt-4o'],
    aliasOccupants: [],
  }
  assert.equal(checkRouteName({ ...base, name: 'kilo/gpt-4o' })?.code, 'invalid_name')
  assert.equal(checkRouteName({ ...base, name: 'gpt-4o' }), undefined, '裸 id（无 entry 前缀）才是可能被占用的名字')
})

test('整表写入校验（管理 API 用）：结构错误成串报出，已生效的名字不因后来同步进来的同名模型永久 400', () => {
  const current = normalizeModelRoutes({ fast: { enabled: true } })
  const occupants = { modelNames: ['Kimi-K3', 'kilo/gpt-4o'], aliases: ['myalias'] }

  assert.deepEqual(validateRoutesForWrite('nope', current, occupants), [
    'routes must be an object keyed by route name',
  ])

  const errors = validateRoutesForWrite(
    {
      'my route': { enabled: true },
      Auto: { enabled: true },
      fast: { name: 'other-route', enabled: 'yes' },
      'kimi-k3': { enabled: true },
      myalias: { enabled: true },
      nope: { poolStrategies: [{ id: 'made-up' }], strategy: 'shuffle' },
    },
    current,
    occupants,
  )

  assert.match(errors.join('\n'), /must not contain spaces/)
  // 写侧与读侧同一套名字规则：键必须**等于其规范形**（读侧会丢非规范键，写侧放进 200
  // 就是「保存成功但条目凭空消失」）。消息点名具体键并给出规范形。
  assert.match(errors.join('\n'), /routes\."Auto": the key must equal its canonical name 'auto'/)
  assert.match(errors.join('\n'), /its 'name' field .* must match the key/)
  assert.match(errors.join('\n'), /'enabled' must be a boolean/)
  assert.match(errors.join('\n'), /collides with the served model 'Kimi-K3'/)
  assert.match(errors.join('\n'), /collides with the model alias 'myalias'/)
  assert.match(errors.join('\n'), /unknown pool strategy id "made-up"/)
  assert.match(errors.join('\n'), /'strategy' must be one of/)

  // 已在表里的名字（fast）是「已生效的路由」：不因为模型目录后来长出一个同名模型就永久拒绝整表。
  const alreadyLive = validateRoutesForWrite(
    { fast: { enabled: true } },
    normalizeModelRoutes({ fast: { enabled: true } }),
    { modelNames: ['fast'], aliases: [] },
  )
  assert.deepEqual(alreadyLive, [])

  // 大小写不同的两个键在**一次写入**里就是重复
  assert.match(
    validateRoutesForWrite({ foo: { name: 'foo' }, Foo: {} }, {}, occupants).join('\n'),
    /duplicates routes/,
  )
})

test('`mergeRouteTables` 是 PATCH 语义：逐字段合并、池策略整体替换、非法键跳过', () => {
  const base = normalizeModelRoutes({ fast: { enabled: true, maxAttempts: 2, poolStrategies: [{ id: 'vision-capable' }] } })
  const merged = mergeRouteTables(base, { fast: { enabled: false, maxAttempts: 4 } as never, 'Bad Key': {} as never })

  assert.equal(merged.fast.enabled, false)
  assert.equal(merged.fast.maxAttempts, 4)
  assert.deepEqual(merged.fast.poolStrategies, [{ id: 'vision-capable', operator: 'and' }], '没写池策略就保持原样，不许悄悄清空')
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'Bad Key'), false)
  assert.notEqual(merged, base, '必须返回新表')
  assert.deepEqual(base.fast.poolStrategies, [{ id: 'vision-capable', operator: 'and' }])
})

test('`mergeRouteTables` 写入侧的池策略是替换而不是追加（否则删掉的策略会拼回来）', () => {
  const base = normalizeModelRoutes({ fast: { poolStrategies: [{ id: 'vision-capable' }, { id: 'tools-capable' }] } })
  const merged = mergeRouteTables(base, { fast: { ...base.fast, poolStrategies: [{ id: 'free-only', operator: 'or' }] } })

  assert.deepEqual(merged.fast.poolStrategies, [{ id: 'free-only', operator: 'or' }])
})
