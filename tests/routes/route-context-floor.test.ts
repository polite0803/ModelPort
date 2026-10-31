/**
 * `/v1/models` 上每条路由各自的 `context_window`（改动 A＋B）。
 *
 * 证明的层次：真 `storeManager` + 真 `ProxyServer` 的 `routes/models.ts` 处理器 →
 * `autoRouter.advertisedContextFloors()` / `advertisedContextFloor(route)` →
 * 与 `select` 同一条池管线（`applyPoolStrategiesWithTrace` + `applyManualModelSelection`）
 * → 客户端 `fetch` 回来的**每个数字**。断言全部读响应体，不读源码文本。
 *
 * 这一层只有真 HTTP 能给：改之前 `routeFloor` 在 models.ts 里**只算一次**（全局未筛池）
 * 再套给每一条路由，所以两条池完全不同的路由会报同一个数；改之后它们报各自的池的下界。
 * 上游网络：所有供应商的 `apiEndpoint` 固定 `http://127.0.0.1:1/v1`（端口 1 本机不监听），
 * 本文件也不发 chat 请求，只读目录。
 *
 * 不在本层证明：放行判据（`satisfiesCapability` 的 context 硬过滤与它的兜底放宽，见
 * `tests/proxy/autoRouting.test.ts`）、纯函数口径（`tests/proxy/models-context-window.test.ts`）、
 * renderer UI、真 Electron 进程。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

const PORT = 18935

/**
 * 四个窗口故意拉开：1_000_000 / 128_000 / 8192 / 未标注。
 * 外加一个只有通配符模型的供应商 —— 通配符不是上游真实模型，不该参与任何下界。
 */
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
      proxyPort: PORT,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      // 无 `routes` 键：升级首读会迁移出一条名为 `auto` 的普通路由
      autoRouting: {
        enabled: true,
        maxAttempts: 2,
        stickyMinutes: 0,
        prefer: 'balanced',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager

function providerFixture(id: string, displayName: string, contextTokens?: number) {
  return {
    id,
    name: `Floor Provider ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    supportedModels: [displayName],
    modelMappings: { [displayName]: `${id}-upstream` },
    ...(contextTokens === undefined
      ? {}
      : { modelCapabilities: { [displayName]: { contextTokens } } }),
  }
}

function accountFixture(providerId: string) {
  return {
    id: `${providerId}-acct`,
    providerId,
    name: `${providerId} account`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  }
}

sm.addProvider(providerFixture('big', 'Big-1M', 1_000_000) as never)
sm.addProvider(providerFixture('mid', 'Mid-128K', 128_000) as never)
sm.addProvider(providerFixture('small', 'Small-8K', 8192) as never)
// 未标注：按 `UNANNOTATED_CONTEXT_FLOOR`(64000) 参与，与放行判据同一个数
sm.addProvider(providerFixture('noann', 'Unknown-W') as never)
// 通配符供应商：故意给它一个更小的窗口标注，验证它根本不进池
sm.addProvider({
  ...providerFixture('wild', 'Wild-*', 4096),
  modelMappings: { 'Wild-*': 'wild-upstream' },
} as never)
for (const id of ['big', 'mid', 'small', 'noann', 'wild']) sm.addAccount(accountFixture(id) as never)

const proxy = await startProxy(PORT)
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

after(async () => {
  await proxy.stop()
  autoRouter.reset()
  harness.dispose()
})

const ref = (providerId: string, displayName: string) => ({ providerId, displayName })

/** 走真写入通道拿路由对象，不在测试里手搓形状。 */
function makeRoute(name: string, overrides: Record<string, unknown> = {}) {
  const created = sm.createRoute({
    name,
    enabled: true,
    strategy: 'round-robin',
    prefer: 'balanced',
    maxAttempts: 3,
    stickyMinutes: 0,
    ...overrides,
  })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  return created.route
}

const floorOf = async (id: string): Promise<number | undefined> => {
  const response = await proxy.request('GET', '/v1/models')
  assert.equal(response.status, 200)
  const entry = (response.json as { data: Array<Record<string, unknown>> }).data
    .find(item => item.id === id)
  assert.ok(entry, `/v1/models 里没有 ${id}`)
  return entry.context_window as number | undefined
}

// 池成员：{big 1M, mid 128K, small 8192, noann 未标注}（wild 的通配符永不进池）

test('A：每条路由报**自己池**的下界，同一次响应里出现不同的数字', async () => {
  // 默认 `auto`：无策略 → 全池最小是 Small-8K 的 8192（连未标注的 64000 都排不到）
  assert.equal(await floorOf('auto'), 8192)

  // 只钉一家大窗（B）：候选收敛到一个模型 → 就是它自己的窗口
  const wide = makeRoute('wide', { excludeModels: [ref('mid', 'Mid-128K'), ref('small', 'Small-8K'), ref('noann', 'Unknown-W')] })
  assert.equal(await floorOf('wide'), 1_000_000)

  // 两家：取两者里更小的那个，仍然与别家小窗模型无关
  const pair = makeRoute('pair', { excludeModels: [ref('small', 'Small-8K'), ref('noann', 'Unknown-W')] })
  assert.equal(await floorOf('pair'), 128_000,
    '未标注候选与通配符都不参与（改之前这里会被全局池压成 8192）')

  // 池策略同样进算：`long-context` 要求已标注且 ≥128000
  makeRoute('longonly', { poolStrategies: [{ id: 'long-context', operator: 'and' }] })
  assert.equal(await floorOf('longonly'), 128_000)

  // 只剩未标注候选：64K 是真答案，不是 bug —— 放行判据给它的就是同一个数
  const onlyUnknown = makeRoute('onlyunknown', {
    excludeModels: [ref('big', 'Big-1M'), ref('mid', 'Mid-128K'), ref('small', 'Small-8K')],
  })
  assert.equal(await floorOf('onlyunknown'), 64_000)

  // 手动标注是唯一能把这个数抬起来的杠杆（标注优先级最高，且不被模型同步清掉）
  sm.setUserModelMark('noann', 'Unknown-W', { contextTokens: 256_000 })
  assert.equal(await floorOf('onlyunknown'), 256_000)
  assert.equal(await floorOf('auto'), 8192, '标注不会把小窗模型顶上去：全池下界照旧')
  sm.setUserModelMark('noann', 'Unknown-W', null)
})

test('池被策略剔空 → 省略键而不是写个默认窗口（与 503 同源）', async () => {
  makeRoute('emptied', { poolStrategies: [{ id: 'aggregate-only', operator: 'and' }] })
  const response = await proxy.request('GET', '/v1/models')
  const entry = (response.json as { data: Array<Record<string, unknown>> }).data
    .find(item => item.id === 'emptied')
  assert.ok(entry)
  assert.equal('context_window' in entry, false, '没有候选就没有可说的，键必须整个省略')
})

test('单查 `/v1/models/<路由名>` 与列表同口径（都用那条路由自己的池）', async () => {
  const single = await proxy.request('GET', '/v1/models/wide')
  assert.equal(single.status, 200)
  assert.equal(single.json.id, 'wide')
  assert.equal(single.json.owned_by, 'auto-router')
  assert.equal(single.json.context_window, 1_000_000)

  const emptied = await proxy.request('GET', '/v1/models/emptied')
  assert.equal(emptied.status, 200)
  assert.equal('context_window' in (emptied.json as Record<string, unknown>), false)
})

test('瞬时状态不动广告值：账号当日额度打满后下界仍是原来的数', async () => {
  assert.equal(await floorOf('auto'), 8192, 'Small-8K 在池里时下界是 8192')

  // 把 small 的账号标成当日已用满：请求决策会把它的模型剔掉（否则就是白发的上游请求），
  // 但广告值不能跟着抖 —— 客户端按它安排压缩时机，一个每次请求都可能变小的数更糟。
  sm.updateAccount('small-acct', { dailyLimit: 1, todayUsed: 1 })
  assert.equal(await floorOf('auto'), 8192)
  assert.equal(await floorOf('wide'), 1_000_000, '另一条路由同理')

  sm.updateAccount('small-acct', { dailyLimit: 0, todayUsed: 0 })
})
