/**
 * R1「所有可用模型默认设置为启用状态」的回归（真 store + 真同步入口，不是读源码文本）。
 *
 * 钉死两条：
 *  1. 除「用户显式动作 / 改名迁移 / retire 清理 / clearAll」以外，没有任何路径会把模型写进
 *     `userModelOverrides[*].excludedModels`（`src/main/store/modelServing.ts:14-21` 的
 *     `served = !excluded.has(name)` 因此等价于「目录内即启用」）。为此对每一条非用户动作
 *     各构造一例：启动同步、目录刷新（聚合在线同步 / OpenCode 运行时同步 / fetched 合并）、
 *     config 读侧归一与整对象 raw 写、`updateConfig`、启动期 default providers 与
 *     modelMappings 初始化、retire/改名以外的 provider 变更、渠道目录同步（改名除外）。
 *  2. 新同步进来的模型一律 `served=true` 并因此进入路由候选池（`getEffectiveModels`）。
 *     同时确认三处**结构性过滤**没有被「目录内即启用」放宽：被过滤掉的模型是**根本不进目录**
 *     （既不在 supportedModels，也不在 excludedModels），而不是「进目录但标记停用」。
 *
 * 载体：`tests/routes/harness.mjs`（electron 边界用替身，data.json 落在 mkdtemp 临时目录，
 * 绝不碰开发机的 `~/.modelport`）。`storeManager` 是单例，所以**本文件只有一个 store 进程**：
 * 启动期用例用 `bootstrapStore({ initialData })` 的真初始数据来证明，其余用例先 `clearAll()`
 * 回到出厂形态再逐个驱动。
 *
 * 不在本文件证明：HTTP 层（`/v1/models` 的响应体）、renderer UI、OS 钥匙串、真实上游网络。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

// ---------------------------------------------------------------- 启动期初始数据

/** 随包 OpenCode 清单里的一个裸运行时 id：它对应的展示名是 `opencode/big-pickle`。 */
const SHIPPED_BARE_ID = 'big-pickle'
/** 旧版同步写在 `fetchedModels` 里的裸展示名（改名迁移的靶子）。 */
const LEGACY_SYNCED_ID = 'legacy-runtime-model'
/** 目录里的一行旧模型：没有任何同步会来抹它，它也不该因此变成排除项。 */
const STALE_ROW = 'opencode/model-retired-by-sync'

/** 退役供应商（`RETIRED_PROVIDER_IDS`）：它的整份 overrides 应当被删，而不是变成排除项。 */
const RETIRED_ID = 'deepseek'

const INITIAL_DATA = {
  providers: [
    {
      // 载体是**账号渠道**记录：`opencode` 已于 2026-11-01 从内置运行时改判为渠道，
      // 内置注册表清空后它不再被启动同步重写，也不该被「内置 id 不在代码里就删记录」
      // 那条规则删掉——这正是这组判据要钉住的新形态。
      id: 'opencode',
      name: 'OpenCode',
      type: 'account',
      authType: 'token',
      apiEndpoint: 'channel://opencode',
      chatPath: '/chat/completions',
      headers: {},
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      // 一份带旧行的目录：没有任何随包配置会来重写它，STALE_ROW 会一直留在目录里
      // （下面的判据正是钉这一点），且它绝不因此变成排除项。
      supportedModels: [`opencode/${SHIPPED_BARE_ID}`, STALE_ROW],
      modelMappings: {
        [`opencode/${SHIPPED_BARE_ID}`]: SHIPPED_BARE_ID,
        [STALE_ROW]: 'model-retired-by-sync',
      },
    },
  ],
  accounts: [],
  sessions: [],
  logs: [],
  requestLogs: [],
  statistics: {},
  tokenUsage: {},
  config: {
    proxyPort: 8080,
    proxyHost: '127.0.0.1',
    loadBalanceStrategy: 'round-robin',
    // 刻意**没有** `routes` 键：启动会跑一次 legacy 迁移（读取侧归一）。
    modelMappings: {
      'opencode/big-pickle': { requestModel: 'opencode/big-pickle', actualModel: SHIPPED_BARE_ID },
      'deepseek-chat': {
        requestModel: 'deepseek-chat',
        actualModel: 'deepseek-chat',
        preferredProviderId: RETIRED_ID,
      },
    },
  },
  userModelOverrides: {
    opencode: {
      addedModels: [{ displayName: 'my-alias', actualModelId: SHIPPED_BARE_ID }],
      // 用户当年停用的是**裸名**（旧命名空间），改名迁移要把它搬到 `opencode/<id>`。
      excludedModels: [SHIPPED_BARE_ID],
      fetchedModels: [{ displayName: LEGACY_SYNCED_ID, actualModelId: LEGACY_SYNCED_ID }],
    },
    [RETIRED_ID]: { addedModels: [], excludedModels: ['deepseek-chat'] },
    // 一个既非内建也非退役的键：启动不许动它（既不整删，也不追加排除项）。
    'kept-but-unknown': { addedModels: [], excludedModels: ['kept/one'] },
  },
}

const harness = await bootstrapStore({ initialData: INITIAL_DATA })
const sm = harness.storeManager as any

const aggregateManagerMod = await loadModule('main/providers/aggregate/manager.ts')
const aggregateProviderManager = aggregateManagerMod.aggregateProviderManager

const overrides = () => sm.getStore().get('userModelOverrides') as Record<string, any>
const clone = <T>(value: T): T => structuredClone(value ?? null) as T

function customProvider(id: string, models: string[], overridesExtra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Custom ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: models,
    modelMappings: Object.fromEntries(models.map(name => [name, name])),
    ...overridesExtra,
  }
}

// ============================================================ 1) 启动期（真 initialize）

test('R1-启动：内置注册表已清空，启动同步不再改写任何供应商记录', () => {
  // 唯一的内置供应商（opencode 本机运行时）已于 2026-11-01 退役。这一条断言的是
  // 退役后的**可观察后果**：没有随包清单去重写，夹具里那行旧模型原样留着。
  // 有人加回内置供应商时这条会红，提醒他补回「同步重写目录」那组判据。
  const catalogue = sm.getModelCatalogue('opencode').map((m: any) => m.displayName)
  assert.ok(catalogue.includes(STALE_ROW), '没有随包清单可重写：旧行必须仍在目录里')
  assert.ok(!overrides().opencode.excludedModels.includes(STALE_ROW), '模型在不在目录里都不构成停用')
})

test('R1-启动：唯一的停用项来自用户，改名迁移只搬动旧名，不新增排除项', () => {
  const after = overrides().opencode

  // 数量守恒：启动前 1 条停用，启动后仍 1 条；只是名字换成了新命名空间。
  assert.deepEqual(after.excludedModels, [`opencode/${SHIPPED_BARE_ID}`])
  assert.equal(after.excludedModels.length, INITIAL_DATA.userModelOverrides.opencode.excludedModels.length)

  // 停用语义仍然成立：那一条仍在目录里、只是 served=false，其余全在服。
  const row = sm.getModelCatalogue('opencode').find((m: any) => m.displayName === `opencode/${SHIPPED_BARE_ID}`)
  assert.equal(row.served, false, '用户的停用必须扛过改名迁移')
  assert.ok(!sm.getEffectiveModels('opencode').some((m: any) => m.displayName === `opencode/${SHIPPED_BARE_ID}`))

  // 用户手加的别名（`addedModels`）按规则原样保留，不被加前缀、也不被停用。
  assert.deepEqual(after.addedModels, [{ displayName: 'my-alias', actualModelId: SHIPPED_BARE_ID }])
  assert.ok(sm.getEffectiveModels('opencode').some((m: any) => m.displayName === 'my-alias'))

  // 旧同步裸名同样只是搬名字：它变成一行在服的 fetched 目录项。
  assert.deepEqual(after.fetchedModels, [
    { displayName: `opencode/${LEGACY_SYNCED_ID}`, actualModelId: LEGACY_SYNCED_ID },
  ])
  const fetchedRow = sm.getModelCatalogue('opencode').find((m: any) => m.source === 'fetched')
  assert.equal(fetchedRow.displayName, `opencode/${LEGACY_SYNCED_ID}`)
  assert.equal(fetchedRow.served, true)
})

test('R1-启动：退役供应商的 overrides 是整删，绝不把它的模型转成排除项', () => {
  const after = overrides()

  assert.equal(RETIRED_ID in after, false, '退役条目的整份 overrides 应被删除')
  const everyExcluded = Object.values(after).flatMap((entry: any) => entry.excludedModels || [])
  assert.deepEqual(
    everyExcluded.filter((name: string) => name.includes(RETIRED_ID)),
    [],
    '退役清理只删条目，不产生任何新的 excludedModels',
  )

  // config 侧的退役归一（`normalizeModelMappingsWithDefaults`）同理：只删映射，不动目录。
  const mappings = sm.getConfig().modelMappings as Record<string, any>
  assert.equal('deepseek-chat' in mappings, false, '指向退役供应商的全局映射会被归一丢弃')
  assert.equal(mappings['opencode/big-pickle'].actualModel, SHIPPED_BARE_ID, '在服供应商的映射原样保留')
  assert.equal(overrides().opencode.excludedModels.length, 1, '归一没有顺手停用任何东西')
})

test('R1-启动：非退役的陌生键原样存活；重复启动（重启）对目录零写入', async () => {
  const beforeStartupPass = clone(overrides())
  assert.deepEqual(beforeStartupPass['kept-but-unknown'], { addedModels: [], excludedModels: ['kept/one'] })

  // 再跑一次启动同步（第二次开机走的就是同一段代码）。
  await sm.initializeDefaultProviders()

  assert.deepEqual(overrides(), beforeStartupPass, '第二次启动必须是幂等的：目录不许再变')
  assert.deepEqual(overrides()['kept-but-unknown'], { addedModels: [], excludedModels: ['kept/one'] })
})

// ==================================================== 2) config 读写与归一不许动目录

test('R1-config：读取归一、整对象 raw 写、updateConfig、resetConfig、modelMappings 初始化都不写排除项', () => {
  const snapshot = clone(overrides())

  sm.getConfig()
  sm.setConfig({ ...sm.getConfig() })
  sm.updateConfig({ proxyPort: 8091 })
  sm.setConfig({ ...sm.getConfig(), proxyPort: 8092 })
  sm.updateConfig({ modelMappings: { ...sm.getConfig().modelMappings, 'extra-alias': { requestModel: 'extra-alias', actualModel: 'big-pickle' } } })
  // 路由表的读取侧归一（`normalizeConfig` → `normalizeRoutes`）：迁移 + 重复归一。
  sm.resetConfig()
  sm.getConfig()
  // 启动期的 default modelMappings 初始化（initialize() 里的第一步）。
  sm.initializeDefaultModelMappings()
  sm.initializeDefaultModelMappings()

  assert.deepEqual(overrides(), snapshot, '以上任一路径写坏了 userModelOverrides')

  // 正控制：只有显式动作能改这张表。
  sm.setModelsServed('opencode', ['opencode/glm-5.3-flash-free'], false)
  assert.ok(overrides().opencode.excludedModels.includes('opencode/glm-5.3-flash-free'))
  sm.setModelsServed('opencode', ['opencode/glm-5.3-flash-free'], true)
  assert.equal(overrides().opencode.excludedModels.includes('opencode/glm-5.3-flash-free'), false)
})

test('R1-clearAll：回到出厂清单后，所有可用模型都在服（排除项归零）', () => {
  sm.clearAll()

  assert.deepEqual(overrides(), {}, 'clearAll 之后不存在任何停用账本')
  assert.equal(sm.hasModelOverrides('opencode'), false)

  // 出厂清单在没有任何用户动作的前提下整张在服。载体换成自定义供应商：
  // 内置注册表已随 opencode 退役清空，`ensureProviderExists` 不再有随包清单可取。
  sm.addProvider(customProvider('factory', ['Factory-A', 'Factory-B', 'Factory-C']) as never)
  assert.deepEqual(
    sm.getEffectiveModels('factory').map((m: any) => m.displayName),
    ['Factory-A', 'Factory-B', 'Factory-C'],
    '出厂清单默认全部启用（served = !excluded.has(name)，而 excluded 为空）',
  )
  assert.deepEqual(overrides(), {}, '创建供应商记录本身不写停用账本')
})

// =============================================== 3) provider 变更（非 retire / 非改名）

test('R1-provider：新增供应商 / 增删其模型 / 改名 / 停用启用，都不产生排除项', () => {
  sm.clearAll()

  sm.addProvider(customProvider('kp', ['Kimi-K3']) as never)
  assert.deepEqual(overrides(), {}, 'addProvider 不写停用账本')
  assert.deepEqual(sm.getEffectiveModels('kp').map((m: any) => m.displayName), ['Kimi-K3'])

  // 目录里新出现一个名字（等价于「同步带来了新模型」）：未经用户动作即在服。
  sm.updateProvider('kp', { supportedModels: ['Kimi-K3', 'Kimi-K4', 'Kimi-K5'] } as never)
  assert.deepEqual(
    sm.getEffectiveModels('kp').map((m: any) => m.displayName),
    ['Kimi-K3', 'Kimi-K4', 'Kimi-K5'],
  )
  assert.deepEqual(overrides(), {}, 'updateProvider 扩目录不许写 excludedModels')

  // 从目录里**移除**一行也不是「用户停用」：那一行直接消失，不进排除名单。
  sm.updateProvider('kp', { supportedModels: ['Kimi-K3', 'Kimi-K4'] } as never)
  assert.deepEqual(overrides(), {}, '被删掉的目录行不该被转成停用项')
  assert.ok(!sm.getModelCatalogue('kp').some((m: any) => m.displayName === 'Kimi-K5'))

  sm.updateProvider('kp', { name: 'Renamed', enabled: false } as never)
  sm.updateProvider('kp', { enabled: true } as never)
  assert.deepEqual(overrides(), {}, '改名/启停供应商都不写停用账本')

  sm.deleteProvider('kp')
  assert.deepEqual(overrides(), {}, '删除一条 provider 记录不会新增排除项')

  // 正控制：显式停用是这张表唯一的正常写入者。
  sm.addProvider(customProvider('kp2', ['A', 'B']) as never)
  sm.setModelsServed('kp2', ['B'], false)
  assert.deepEqual(overrides(), { kp2: { addedModels: [], excludedModels: ['B'] } })
})

// ================================================ 4) 聚合在线同步（真 HTTP + 真 manager）

/** 一个只答 `{data:[...]}` 的本地 `/models`，用来替代真实上游（不发外网请求）。 */
async function startModelServer(): Promise<{ baseUrl: string; close(): Promise<void>; setModels(list: unknown[]): void }> {
  let list: unknown[] = []
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: list }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    setModels: (next: unknown[]) => { list = next },
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

test('R1-聚合同步：上游新报的模型直接进目录并在服，同步全程不写排除项', async () => {
  sm.clearAll()
  const server = await startModelServer()
  try {
    server.setModels([{ id: 'new-a', name: 'New A' }, { id: 'new-b' }])

    // `ollama` 是免 Key 条目：静态清单为空，全靠在线同步补。
    aggregateProviderManager.save({ id: 'ollama', baseUrl: server.baseUrl, models: [] })
    assert.deepEqual(overrides(), {}, 'save() 只写供应商记录（含模型账本），不写停用账本')

    const synced = await aggregateProviderManager.syncModels('ollama')
    assert.equal(synced.success, true, `sync failed: ${JSON.stringify(synced)}`)
    assert.equal(synced.addedCount, 2)
    assert.equal(synced.modelSource, 'upstream')

    const servedNames = sm.getEffectiveModels('ollama').map((m: any) => m.displayName)
    assert.deepEqual(servedNames, ['ollama/new-a', 'ollama/new-b'], '新同步进来的模型必须默认在服')
    assert.deepEqual(overrides(), {}, '一次在线同步不产生任何 excludedModels')

    // 「在服」要等于「进了负载均衡的候选池」，而不是只在自己的目录里亮着
    // （`src/main/proxy/loadbalancer.ts:247` 的 `providerSupportsModel` 就是拿
    // `getEffectiveModels` 喂 `isModelRoutable`，所以这一步是真的在复核同一个口径）。
    const { loadBalancer } = await loadModule('main/proxy/loadbalancer.ts')
    const pool = loadBalancer.getAvailableModels()
    assert.ok(pool.includes('ollama/new-a'), `同步进来的模型要在候选池里：${pool.join(',')}`)
    assert.ok(pool.includes('ollama/new-b'))
    const selection = loadBalancer.selectAccount('ollama/new-a', 'round-robin', 'ollama')
    assert.ok(selection !== null, '免 Key 条目有本机占位账号，新模型应当被选到')
    assert.equal(selection.account.providerId, 'ollama')
    assert.equal(selection.actualModel, 'new-a')
    // 接线只落供应商账本：全局别名表是用户数据，同步不再往里写（旧版本每轮整表重写，
    // 会抹掉用户同名的钉定）。路由靠目录名本身，归属由 `<entry>/<model>` 形状推导。
    assert.equal(
      'ollama/new-a' in (sm.getConfig().modelMappings as Record<string, any>),
      false,
      '同步不再把目录名写进全局映射表',
    )
    assert.equal(sm.getProviderById('ollama').modelMappings['ollama/new-a'], 'new-a')
    const { modelMapper } = await loadModule('main/proxy/modelMapper.ts')
    assert.equal(
      modelMapper.getPreferredProvider('ollama/new-a'),
      'ollama',
      '全局表没有这一行时，归属仍从聚合前缀推导出来',
    )

    // 第二次同步带来第三个名字：仍然默认在服，仍然不写排除项。
    server.setModels([{ id: 'new-b' }, { id: 'new-c' }])
    const again = await aggregateProviderManager.syncModels('ollama')
    assert.equal(again.success, true)
    assert.deepEqual(
      sm.getEffectiveModels('ollama').map((m: any) => m.displayName),
      ['ollama/new-a', 'ollama/new-b', 'ollama/new-c'],
      '同步只增不减，新名字一样默认启用',
    )
    assert.deepEqual(overrides(), {})

    // 反面：用户显式停用的那一条，扛得住后续同步，且同步不额外加别的排除项。
    sm.setModelsServed('ollama', ['ollama/new-a'], false)
    server.setModels([{ id: 'new-a' }, { id: 'new-b' }, { id: 'new-d' }])
    await aggregateProviderManager.syncModels('ollama')
    assert.deepEqual(overrides().ollama.excludedModels, ['ollama/new-a'], '唯一写入者是上面那次显式停用')
    assert.deepEqual(
      sm.getEffectiveModels('ollama').map((m: any) => m.displayName),
      ['ollama/new-b', 'ollama/new-c', 'ollama/new-d'],
    )

    // 「在服」= 真的进了**负载均衡的候选池**（`providerSupportsModel` → `isModelRoutable`，
    // `src/main/proxy/loadbalancer.ts:247`），不是只在自己的目录里亮着。
    assert.ok(loadBalancer.getAvailableModels().includes('ollama/new-d'), '同步进来的名字可被选到')
    const picked = loadBalancer.selectAccount('ollama/new-d', 'round-robin', 'ollama')
    assert.ok(picked !== null, '新模型应能被选出账号')
    assert.equal(picked.provider.id, 'ollama')
    assert.equal(picked.actualModel, 'new-d')

    // 正控制：那一条被显式停用后，立刻从池里消失（且不是被过滤掉，而是 served=false）。
    assert.equal(loadBalancer.selectAccount('ollama/new-a', 'round-robin', 'ollama'), null)
    assert.equal(loadBalancer.getAvailableAccountCount('ollama/new-a', 'ollama'), 0)
  } finally {
    await server.close()
  }
})

test('R1-聚合同步不再吞用户钉定：全局表里的同名条目同步后原样保留', async () => {
  sm.clearAll()
  const server = await startModelServer()
  try {
    server.setModels([{ id: 'new-a' }, { id: 'new-b' }])
    aggregateProviderManager.save({ id: 'ollama', baseUrl: server.baseUrl, models: [] })

    // 用户把目录名 `<条目>/<模型>` 改指到另一个目标。旧版本的下一次同步会整表重写，
    // 把这一行直接抹掉（它只认识自己那一份机器接线）。
    const userRow = { requestModel: 'ollama/new-a', actualModel: 'new-b', preferredProviderId: 'ollama' }
    sm.updateConfig({ modelMappings: { ...sm.getConfig().modelMappings, 'ollama/new-a': userRow } })
    assert.deepEqual(sm.getConfig().modelMappings['ollama/new-a'], userRow, '写入时不被归一当成机器接线')

    const synced = await aggregateProviderManager.syncModels('ollama')
    assert.equal(synced.success, true, `sync failed: ${JSON.stringify(synced)}`)
    assert.deepEqual(sm.getConfig().modelMappings['ollama/new-a'], userRow, '同步不许整表重写把用户钉定吞掉')

    // 对照：同一次同步新发现的 `new-b` 没有被写成第二行全局映射。
    assert.equal('ollama/new-b' in sm.getConfig().modelMappings, false)
  } finally {
    await server.close()
  }
})

test('R1-聚合删除：remove() 不写排除项；重建后的清单同样默认在服', async () => {
  sm.clearAll()
  const server = await startModelServer()
  try {
    server.setModels([{ id: 'only-one' }, { id: 'two' }])
    aggregateProviderManager.save({ id: 'lmstudio', baseUrl: server.baseUrl, models: [] })
    await aggregateProviderManager.syncModels('lmstudio')
    assert.deepEqual(
      sm.getEffectiveModels('lmstudio').map((m: any) => m.displayName),
      ['lmstudio/only-one', 'lmstudio/two'],
    )

    // 用户显式停用一条，再删除整个聚合条目。
    sm.setModelsServed('lmstudio', ['lmstudio/two'], false)
    const before = clone(overrides())
    aggregateProviderManager.remove('lmstudio')

    assert.deepEqual(overrides(), before, 'remove() 只删 provider 记录（钉到它的映射由读侧归一清掉），不改停用账本')
    assert.equal(sm.getProviderById('lmstudio'), undefined)

    aggregateProviderManager.save({ id: 'lmstudio', baseUrl: server.baseUrl, models: ['only-one'] })
    await aggregateProviderManager.syncModels('lmstudio')
    assert.deepEqual(
      sm.getEffectiveModels('lmstudio').map((m: any) => m.displayName),
      ['lmstudio/only-one'],
      '重建之后没被用户停用的名字照样在服',
    )
    // 用户动作留下的那条停用记录**跨条目删除仍然有效**（`deleteProvider` 不清 overrides，
    // 与退役清理 `store.ts:584` 的整删不同）：这里 'lmstudio/two' 被同步重新带回来时，
    // 目录里有这一行但 served=false —— 没有任何**新**排除项被写出来。
    assert.deepEqual(overrides().lmstudio.excludedModels, ['lmstudio/two'], '仍是用户那一条，同步没加新的')
    assert.ok(
      sm.getModelCatalogue('lmstudio').some((m: any) => m.displayName === 'lmstudio/two' && m.served === false),
      '旧账本让重新同步回来的那一条停在服之外（口径内的用户动作残留，不是同步写入）',
    )
  } finally {
    await server.close()
  }
})


// =========================== 6) 账号通道目录同步（过滤 + 改名迁移）

/** 渠道 Worker 的替身：只接 `provider.status` / `model.list` / `/v1/models` 视图三个方法。 */
function fakeBridge(state: { accounts: Record<string, number>; models: Record<string, unknown[]> }) {
  const statuses = Object.fromEntries(
    Object.entries(state.accounts).map(([id, total]) => [id, { accounts: { total } }]),
  )
  return {
    rpc: async (method: string, payload: any) => {
      if (method === 'provider.status') return { ok: true, value: { statuses } }
      if (method === 'model.list') {
        return { ok: true, value: { models: state.models[payload.provider] ?? [] } }
      }
      return { ok: false, error: `unexpected rpc ${method}` }
    },
    models: async () => [],
  }
}

test('R1-渠道同步：disabled/dead 的过滤没被放宽；新报的可用模型一律在服', async () => {
  sm.clearAll()
  const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')

  const realBridge = accountChannelManager.bridge
  const state = {
    accounts: { qoder: 1 },
    models: {
      qoder: [
        { id: 'qmodel_free', name: 'Qoder Free · 免费' },
        { id: 'qmodel_off', name: 'Qoder Stopped', disabled: true },
        { id: 'qmodel_dead', name: 'Qoder Gone', dead: true },
      ],
    },
  }
  try {
    accountChannelManager.bridge = fakeBridge(state) as never
    accountChannelManager.modelsCache = null
    accountChannelManager.syncing = null
    await accountChannelManager.syncProviders()

    const provider = sm.getProviderById('qoder')
    assert.ok(provider, '有账号的渠道会写出 provider 记录')
    const served = sm.getEffectiveModels('qoder').map((m: any) => m.displayName)
    // 展示名是「渠道名 / 上游名」，倍率由 `accountChannels/modelCatalog` 拆掉。
    assert.deepEqual(served, ['Qoder / Qoder Free'], '渠道新报的可用模型默认在服')

    // `accountChannels/manager.ts:577` 的 `disabled || dead` 过滤照旧：它们不进目录，也不进排除名单。
    const catalogue = sm.getModelCatalogue('qoder').map((m: any) => m.displayName)
    assert.equal(catalogue.includes('Qoder / Qoder Stopped'), false, '被过滤掉的模型不该因为「目录内即启用」而进目录')
    assert.deepEqual(overrides().qoder?.excludedModels || [], [], '过滤不是停用')

    // 但它们在渠道自己的在线目录里仍然可见（`modelsFor` 读的就是这份缓存；
    // 走 `modelsFor` 会触发 `bridgeOrThrow()` 去 spawn 真 Worker，这里直接读同一份缓存）。
    const visible = accountChannelManager.cachedModels('qoder')
    assert.deepEqual(
      visible.map((m: any) => [m.id, m.disabled === true || m.dead === true]),
      [['qmodel_free', false], ['qmodel_off', true], ['qmodel_dead', true]],
      '被过滤的模型必须留在渠道目录里，否则再也关不掉/清不掉',
    )
  } finally {
    accountChannelManager.bridge = realBridge
    accountChannelManager.modelsCache = null
    accountChannelManager.syncing = null
  }
})

test('R1-渠道改名：停用标记只跟着旧名搬到新名，不新增排除项，且第二次同步幂等', async () => {
  sm.clearAll()
  const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')

  // 旧版形态的记录：supportedModels 用内部 id（`qoder/<id>`），用户停用的是这个旧名。
  sm.addProvider(customProvider('qoder', ['qoder/qmodel_38max'], { type: 'account' } as never) as never)
  sm.setModelsServed('qoder', ['qoder/qmodel_38max'], false)
  assert.deepEqual(overrides().qoder.excludedModels, ['qoder/qmodel_38max'])

  const realBridge = accountChannelManager.bridge
  const state = {
    accounts: { qoder: 1 },
    models: { qoder: [{ id: 'qmodel_38max', name: 'DeepSeek-Flash' }, { id: 'qmodel_new', name: 'Brand New' }] },
  }
  try {
    accountChannelManager.bridge = fakeBridge(state) as never
    accountChannelManager.modelsCache = null
    accountChannelManager.syncing = null
    await accountChannelManager.syncProviders()

    const stoppedName = 'Qoder / DeepSeek-Flash'
    const after = overrides().qoder
    // 数量守恒：旧名搬走、新名接手，没有第三条被写进来。
    assert.deepEqual(after.excludedModels, [stoppedName])
    assert.equal(after.excludedModels.includes('qoder/qmodel_38max'), false, '旧键要清掉，否则以后按新名重新启用会被旧值挡住')

    const rows = sm.getModelCatalogue('qoder').map((m: any) => [m.displayName, m.served])
    assert.deepEqual(rows, [[stoppedName, false], ['Qoder / Brand New', true]])

    // 幂等：同一份目录再同步一次，排除项不许累加。
    accountChannelManager.modelsCache = null
    accountChannelManager.syncing = null
    await accountChannelManager.syncProviders()
    assert.deepEqual(overrides().qoder.excludedModels, [stoppedName], '重复同步不追加排除项')
  } finally {
    accountChannelManager.bridge = realBridge
    accountChannelManager.modelsCache = null
    accountChannelManager.syncing = null
  }
})

// ==================== 7) 用户显式动作：唯一的正常写入者（正控制，防「全都常亮」的假绿）

test('R1-用户动作：停用/启用、removeModel、resetModels 的账本变化各自可复核', () => {
  sm.clearAll()
  sm.addProvider(customProvider('um', ['a', 'b', 'c']) as never)
  assert.deepEqual(overrides(), {})

  sm.setModelsServed('um', ['b', 'c'], false)
  assert.deepEqual(overrides().um.excludedModels.sort(), ['b', 'c'])
  assert.deepEqual(sm.getEffectiveModels('um').map((m: any) => m.displayName), ['a'])

  sm.setModelsServed('um', ['b'], true)
  assert.deepEqual(overrides().um.excludedModels, ['c'])

  // 删一个默认模型 = 停用（写排除项）；删一个手加模型 = 从 addedModels 移除（不写排除项）。
  sm.removeModel('um', 'a')
  assert.deepEqual(overrides().um.excludedModels.sort(), ['a', 'c'])
  sm.addCustomModel('um', { displayName: 'mine', actualModelId: 'mine-up' } as never)
  sm.removeModel('um', 'mine')
  assert.deepEqual(overrides().um.excludedModels.sort(), ['a', 'c'], '删手加模型不写排除项')

  // resetModels 是唯一能整张清掉这张表的用户动作。
  sm.resetModels('um')
  assert.equal('um' in overrides(), false, 'reset 是删除该条目的 overrides，而不是留下一份空账本')
  assert.deepEqual(
    sm.getEffectiveModels('um').map((m: any) => m.displayName),
    ['a', 'b', 'c'],
    'reset 之后目录回到全启用',
  )

  // 删掉一行「上次同步带回来」的模型 = 从 fetchedModels 里去掉，不是停用（不写排除项）。
  sm.applyFetchedModels('um', [{ displayName: 'um/synced', actualModelId: 'synced' }] as never)
  assert.ok(sm.getEffectiveModels('um').some((m: any) => m.displayName === 'um/synced'))
  sm.removeModel('um', 'um/synced')
  assert.deepEqual(overrides().um.excludedModels || [], [], '删除同步行不是停用，绝不写进 excludedModels')
})

test('R1-边界：手坏的 overrides 记录（缺 excludedModels）被读取侧归一，四个写入口都不抛', () => {
  sm.clearAll()
  sm.addProvider(customProvider('pm', ['a', 'b']) as never)
  // 模拟一份被人手改过 / 由外部工具写坏的 data.json：这张表没有任何读取侧归一
  // （`normalizeConfig` 只管 `config`），所以写路径以前直接撞在 undefined 上。
  sm.getStore().set('userModelOverrides', { pm: { addedModels: [] } })

  // 删一个默认模型：以前 `excludedModels.includes()` 抛 TypeError，现在补全并写回。
  sm.removeModel('pm', 'a')
  assert.deepEqual(overrides().pm.excludedModels, ['a'], '缺键记录被补全，删除照常生效')
  assert.deepEqual(
    sm.getEffectiveModels('pm').map((m: any) => m.displayName),
    ['b'],
    '停用只作用于被删的那一行',
  )

  // 手加模型：以前 `addedModels.find()` 同样抛。
  sm.addCustomModel('pm', { displayName: 'mine', actualModelId: 'mine-up' } as never)
  assert.deepEqual(
    sm.getEffectiveModels('pm').map((m: any) => m.displayName),
    ['b', 'mine'],
    '缺键记录上仍能手加模型',
  )

  // 批量停用/启用：以前 `applyServed(current.excludedModels || [])` 侥幸没炸，现在走同一口径。
  sm.setModelsServed('pm', ['b'], false)
  assert.deepEqual(overrides().pm.excludedModels.sort(), ['a', 'b'])
  sm.setModelsServed('pm', ['b'], true)
  assert.deepEqual(overrides().pm.excludedModels, ['a'])

  // 在线同步：写回的记录必须是补全过的形态（`addedModels` 存在，`fetchedModels` 只在真的有时留）。
  sm.applyFetchedModels('pm', [{ displayName: 'pm/synced', actualModelId: 'synced' }] as never)
  assert.deepEqual(overrides().pm.addedModels, [{ displayName: 'mine', actualModelId: 'mine-up' }])
  assert.deepEqual(overrides().pm.fetchedModels, [{ displayName: 'pm/synced', actualModelId: 'synced' }])

  // 同一份坏记录走「目录合并」那条路本来就是安全的（`buildModelCatalogue` 有 `|| []` 兜底），
  // 而补全后的记录在读侧表现一致：只有被停用的那一行是 false。
  assert.deepEqual(
    sm.getModelCatalogue('pm').map((m: any) => m.served),
    [false, true, true, true],
  )
})

test('R1-纯函数口径：served 只看 excluded，三种来源同一条规则（无第二条真值源）', async () => {
  const { buildModelCatalogue } = await loadModule('main/store/modelServing.ts')
  const rows = buildModelCatalogue(['x', 'y'], { x: 'up-x' }, {
    addedModels: [{ displayName: 'hand', actualModelId: 'hand-up' }],
    excludedModels: ['y'],
    fetchedModels: [{ displayName: 'synced', actualModelId: 'synced-up' }],
  })

  assert.deepEqual(rows.map(row => [row.displayName, row.source, row.served]), [
    ['x', 'builtin', true],
    ['y', 'builtin', false],
    ['hand', 'custom', true],
    ['synced', 'fetched', true],
  ])
})

test('收尾：出厂形态 + 路由迁移都不给停用账本留任何东西', () => {
  sm.clearAll()
  assert.deepEqual(overrides(), {})

  // 全新安装的 config 落盘时**没有** `routes` 键，读取侧才迁移出一条 `auto`；
  // 这条迁移路径同样不许往 userModelOverrides 里写任何东西。
  const onDisk = sm.getStore().get('config') as Record<string, unknown>
  assert.equal(Object.prototype.hasOwnProperty.call(onDisk, 'routes'), false, 'fixture: 出厂 config 不带 routes 键')
  assert.deepEqual(Object.keys(sm.getConfig().routes), ['auto'])
  assert.deepEqual(overrides(), {}, '路由迁移不写停用账本')

  harness.dispose()
})
