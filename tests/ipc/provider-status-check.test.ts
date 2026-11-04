/**
 * 供应商健康巡检的成本门（IPC `providers:checkStatus` / `providers:checkAllStatus` 那两条链路）。
 *
 * 证明的层次（全是**真代码 + 真 HTTP**，不是读源码文本）：
 * `src/main/providers/checker.ts` 的巡检缓存（TTL + 在途去重）
 * → `src/main/store/providers.ts::persistStatusSnapshot` 的「只认翻转」落盘门
 * → `src/main/store/store.ts::updateProvider` 真写的 `store.set('providers')`
 * → `Update provider:` 那行应用日志。
 * 上游用 `node:http` 起在 127.0.0.1 的回环端口，`checkCustomProvider` 真发
 * `GET <apiEndpoint>/models`，请求次数是服务端计数器读的，不是替身编的。
 * store 是 `tests/routes/harness.mjs` bootstrap 出来的真 `StoreManager`（electron 边界用替身，
 * 数据落在 `mkdtemp` 临时目录，绝不碰开发者的 `~/.modelport`）。
 *
 * 为什么不在这里 import `src/main/ipc/handlers.ts`：它把整个主进程图（electron-updater、
 * channel pack、proxy）拖进 `node --test`，`electron-updater` 在纯 Node 下连命名导出都没有
 * （实测 `does not provide an export named 'autoUpdater'`）。那两个 handler 现在只剩
 * 「取 provider → 调 `checkAllProviderStatuses`/`checkProviderStatus` → 把落盘交给
 * `persistStatusSnapshot`」这一段接线，本文件用**同一条接线**驱动真函数，最后一例把这段
 * 接线钉在源码上，防止有人再往 handler 里塞一次逐 provider 的 `ProviderManager.update`。
 *
 * 时钟：缓存的 `checkedAt` 与 TTL 比较走调用方注入的 `now`（见
 * `ProviderStatusCheckOptions.now`），所以「5 分钟后过期」这一条是确定性断言，不需要真等。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

/** 假时钟的起点：任何互不相同的 epoch 都行，关键是它与注入的偏移同单位。 */
const T0 = 1_760_000_000_000

// ── 上游桩：真实的 HTTP 服务，计数在服务端做 ──────────────────────────────
const upstream = { hits: 0, status: 200, hold: false }
const heldResponses: Array<{ writeHead: (s: number, h?: Record<string, string>) => unknown; end: (b?: string) => unknown }> = []

const server = createServer((req, res) => {
  upstream.hits += 1
  if (upstream.hold) {
    heldResponses.push(res)
    return
  }
  res.writeHead(upstream.status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ data: [] }))
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
const upstreamPort = (server.address() as AddressInfo).port

// ── 真 store（harness 在 import src 之前注册 electron 替身钩子）──────────
const harness = await bootstrapStore({
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: {},
  },
})
const storeManager = harness.storeManager

const { ProviderManager } = await loadModule('main/store/providers.ts')
const {
  ProviderChecker,
  checkAllProviderStatuses,
  clearProviderStatusCache,
  PROVIDER_STATUS_CACHE_TTL_MS,
} = await loadModule('main/providers/checker.ts')
const { channelRuntimeState } = await loadModule('main/providers/accountChannels/runtimeState.ts')

// ── 落盘计数：包住真 electron-store 实例的 `set`（`updateProvider` 用的就是它）──
const rawStore = storeManager.getStore()
const originalSet = rawStore.set.bind(rawStore)
const setKeys: string[] = []
rawStore.set = (key: string, value: unknown) => {
  setKeys.push(String(key))
  return originalSet(key, value)
}
function resetWrites(): void {
  setKeys.length = 0
}
/** 整份供应商表被序列化+加密+落盘的次数 —— 本缺陷的成本单位。 */
function providerWrites(): number {
  return setKeys.filter((key) => key === 'providers').length
}
/** `Update provider:` 那一类 info 行（缺陷里一天 3829 行的就是它）。 */
function updateProviderLogs(): string[] {
  return storeManager
    .getLogs()
    .filter((entry: { message?: string }) => typeof entry.message === 'string' && entry.message.startsWith('Update provider:'))
    .map((entry: { message: string }) => entry.message)
}

function customFixture(id: string): Record<string, unknown> {
  return {
    id,
    name: `Sweep ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: `http://127.0.0.1:${upstreamPort}/v1`,
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: ['glm-4.6'],
    // 库里已经是 online：一次健康的巡检因此不该是「翻转」，也就不该写盘。
    status: 'online',
  }
}

storeManager.addProvider(customFixture('kp-a'))
storeManager.addProvider(customFixture('kp-b'))
resetWrites()

/** handler 里那条接线：落盘交给「只认翻转」的门。 */
const persistSnapshot = (providerId: string, status: string, checkedAt: number): boolean =>
  ProviderManager.persistStatusSnapshot(providerId, status, checkedAt)

function customProviders(): Array<{ id: string }> {
  return ProviderManager.getAll().filter((p: { type: string }) => p.type === 'custom')
}

async function sweepCustom(now: number): Promise<Record<string, { status: string }>> {
  return checkAllProviderStatuses(customProviders(), persistSnapshot, { now })
}

after(() => {
  server.close()
  harness.dispose()
})

test('TTL 之内的第二轮巡检：上游只被探一轮，全量写盘 0 次，日志 0 行', async () => {
  clearProviderStatusCache()
  upstream.status = 200
  upstream.hold = false
  resetWrites()

  const hitsBefore = upstream.hits
  await sweepCustom(T0)
  assert.equal(upstream.hits - hitsBefore, 2, '第一轮每个 custom provider 各探一次上游')
  assert.equal(providerWrites(), 0, '状态未翻转 ⇒ 一次 store.set("providers") 都不该有')
  assert.equal(updateProviderLogs().length, 0, '未翻转不该打 Update provider:')

  await sweepCustom(T0 + 60_000)
  assert.equal(upstream.hits - hitsBefore, 2, '60s 后仍在 5 分钟 TTL 内：零次上游探测')
  assert.equal(providerWrites(), 0)
})

test('online → offline 翻转：恰好一次落盘 + 一次带迁移方向的 info', async () => {
  clearProviderStatusCache()
  upstream.status = 503
  resetWrites()

  const results = await sweepCustom(T0 + 1000)
  assert.equal(results['kp-a'].status, 'offline')
  assert.equal(providerWrites(), 2, '两个 provider 各翻转一次 ⇒ 各写一次（翻转极稀少，不为此加批量接口）')
  assert.equal(ProviderManager.getById('kp-a').status, 'offline', '快照门确实把新状态落了库')
  assert.equal(ProviderManager.getById('kp-a').lastStatusCheck, T0 + 1000, 'lastStatusCheck = 这次翻转的时刻')

  const flipLogs = updateProviderLogs()
  assert.equal(flipLogs.length, 2)
  assert.ok(
    flipLogs.every((message) => /\(online → offline\)$/.test(message)),
    `翻转行要带迁移方向，实测：${JSON.stringify(flipLogs)}`,
  )

  resetWrites()
  await sweepCustom(T0 + 2000)
  assert.equal(providerWrites(), 0, '同一状态的第二轮不再写盘')
})

test('TTL 过期后重新探测（假时钟推进 5 分钟）', async () => {
  clearProviderStatusCache()
  upstream.status = 200
  resetWrites()

  const hitsBefore = upstream.hits
  await sweepCustom(T0)
  const writesAfterFirst = providerWrites()
  assert.equal(upstream.hits - hitsBefore, 2, '第一轮把 offline 快照翻回 online')
  assert.ok(writesAfterFirst > 0, '翻转确实写了盘')

  await sweepCustom(T0 + PROVIDER_STATUS_CACHE_TTL_MS - 1)
  assert.equal(upstream.hits - hitsBefore, 2, 'TTL 边界内（4:59.999）仍走缓存')

  await sweepCustom(T0 + PROVIDER_STATUS_CACHE_TTL_MS + 1)
  assert.equal(upstream.hits - hitsBefore, 4, '过了 5 分钟 ⇒ 重新探一轮')
  assert.equal(providerWrites(), writesAfterFirst, '重新探测不等于重新落盘')
})

test('同一 provider 的并发检查只发一次上游（在途去重），且缓存副本不可被消费方改坏', async () => {
  clearProviderStatusCache()
  upstream.hold = true
  upstream.status = 200
  const provider = ProviderManager.getById('kp-a')
  const hitsBefore = upstream.hits

  const first = ProviderChecker.checkProviderStatus(provider, { now: T0 })
  const second = ProviderChecker.checkProviderStatus(provider, { now: T0 + 1 })

  for (const res of heldResponses.splice(0)) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [] }))
  }
  upstream.hold = false

  const [a, b] = await Promise.all([first, second])
  assert.equal(a.status, 'online')
  assert.equal(b.status, 'online')
  assert.equal(upstream.hits - hitsBefore, 1, '在途去重：一次并发只发一个上游 GET')

  // 消费方拿到的是副本：改它不能污染缓存里那份冻结的结果。
  a.latency = 999_999
  assert.notEqual(a, b, '两次调用不共享同一个对象')
  const later = await ProviderChecker.checkProviderStatus(provider, { now: T0 + 2 })
  assert.notEqual(later.latency, 999_999, '缓存里的那份没被改到')
})

test('account 渠道不进缓存：channelRuntimeState.running 当场可见', async () => {
  storeManager.addProvider({
    id: 'chan-1',
    name: 'Sweep chan-1',
    type: 'account',
    authType: 'oauth',
    apiEndpoint: 'channel://qoder',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    status: 'unknown',
  })
  clearProviderStatusCache()
  upstream.status = 200
  resetWrites()

  const hitsBefore = upstream.hits
  channelRuntimeState.running = false
  const stopped = await ProviderChecker.checkProviderStatus(ProviderManager.getById('chan-1'), { now: T0 })
  channelRuntimeState.running = true
  const started = await ProviderChecker.checkProviderStatus(ProviderManager.getById('chan-1'), { now: T0 + 1000 })

  assert.equal(stopped.status, 'unknown')
  assert.equal(started.status, 'online', '1s 前那次读到的标志没有把它压住 5 分钟')
  assert.equal(started.reason, 'channel_runtime_running')
  assert.equal(upstream.hits - hitsBefore, 0, '账号渠道一次上游请求都不发')

  const results = await checkAllProviderStatuses(ProviderManager.getAll(), persistSnapshot, { now: T0 + 1000 })
  assert.equal(results['chan-1'].status, 'online')
  assert.equal(providerWrites(), 1, 'unknown → online 是翻转，写一次；custom 那两个未翻转，零次')
})

test('非巡检的手工编辑仍然留痕（这条门不许把它静音）', async () => {
  clearProviderStatusCache()
  upstream.status = 200
  resetWrites()
  const logsBefore = updateProviderLogs().length

  assert.equal(ProviderManager.persistStatusSnapshot('kp-a', 'online', T0), false, '未翻转：返回 false 且不写')
  assert.equal(providerWrites(), 0)

  ProviderManager.update('kp-a', { description: '手工改了描述' })
  assert.equal(updateProviderLogs().length, logsBefore + 1, 'UI 手工改供应商必须有 info 痕')

  // 上面那次手工编辑本身就写了一次盘；从这里起只数「翻转」那一次。
  resetWrites()
  assert.equal(ProviderManager.persistStatusSnapshot('kp-a', 'offline', T0 + 5), true)
  const logs = updateProviderLogs()
  assert.equal(logs.length, logsBefore + 2)
  assert.match(logs[logs.length - 1], /Sweep kp-a \(online → offline\)$/)
  assert.equal(providerWrites(), 1, '只有那次翻转写了盘')

  ProviderManager.persistStatusSnapshot('kp-a', 'online', T0 + 6)
})

test('对照：通用的 update 快照落盘是无条件的 —— 这正是两个入口必须走翻转门的原因', async () => {
  // 这条不是「旧实现还能跑」，而是把成本单位钉死：走 `ProviderManager.update` 落状态快照
  // 就是每个 provider 一次整份 `store.set('providers')`（加密 + 940KB 全量序列化 + 原子
  // rename），与状态有没有变化无关。23 个 provider 的一轮巡检 = 23 次这种写。
  upstream.status = 200
  upstream.hold = false
  resetWrites()

  const legacyWiring = async (now: number): Promise<Record<string, { status: string }>> => {
    const settled = await Promise.all(
      customProviders().map(async (provider: { id: string }) => {
        const result = await ProviderChecker.checkProviderStatus(provider)
        ProviderManager.update(provider.id, { status: result.status, lastStatusCheck: now })
        return [provider.id, result] as const
      }),
    )
    return Object.fromEntries(settled)
  }

  await legacyWiring(T0)
  assert.equal(providerWrites(), 2, '未翻转也一样写：这条门不在 update 里')
})

test('改了端点/凭据立刻重探：缓存键含探测目标，不会把 5 分钟 TTL 拖成「拿旧上游报健康」', async () => {
  clearProviderStatusCache()
  upstream.status = 200
  upstream.hold = false
  resetWrites()

  const hitsBefore = upstream.hits
  const provider = () => ProviderManager.getById('kp-a')
  await ProviderChecker.checkProviderStatus(provider(), { now: T0 })
  assert.equal(upstream.hits - hitsBefore, 1)
  await ProviderChecker.checkProviderStatus(provider(), { now: T0 + 1000 })
  assert.equal(upstream.hits - hitsBefore, 1, '同一条记录（同端同 Key）：TTL 内不重探')

  // 换 Key 走的是通用 update（聚合那侧的 Key 轮换更是直接写库），巡检缓存拦不到那条通路，
  // 所以探测目标必须进缓存键 —— 这里必须立刻重探，而不是等 5 分钟。
  ProviderManager.update('kp-a', { headers: { 'X-Api-Key': 'rotated' } })
  await ProviderChecker.checkProviderStatus(provider(), { now: T0 + 2000 })
  assert.equal(upstream.hits - hitsBefore, 2, '探测目标变了 ⇒ 缓存未命中，立刻重探')
  await ProviderChecker.checkProviderStatus(provider(), { now: T0 + 3000 })
  assert.equal(upstream.hits - hitsBefore, 2, '新组合自己又进表了')

  ProviderManager.update('kp-a', { headers: {} })
})

test('两个 IPC 入口只剩接线：不再逐 provider 落盘状态快照', () => {
  const handlersSource = readFileSync(new URL('../../src/main/ipc/handlers.ts', import.meta.url), 'utf8')

  assert.match(handlersSource, /import \{ ProviderChecker, checkAllProviderStatuses \} from '\.\.\/providers\/checker'/)
  assert.match(
    handlersSource,
    /PROVIDERS_CHECK_ALL_STATUS[\s\S]{0,700}?checkAllProviderStatuses\(\s*ProviderManager\.getAll\(\),[\s\S]{0,200}?persistStatusSnapshot/,
    '全量入口必须把落盘交给 persistStatusSnapshot',
  )
  assert.match(
    handlersSource,
    /PROVIDERS_CHECK_STATUS[\s\S]{0,700}?checkProviderStatus\(provider, \{ force: true \}\)[\s\S]{0,400}?persistStatusSnapshot/,
    '单查入口必须 force + persistStatusSnapshot',
  )
  assert.doesNotMatch(handlersSource, /lastStatusCheck:\s*Date\.now\(\)/, 'handler 里不许再有逐 provider 的快照写')
  assert.doesNotMatch(handlersSource, /status:\s*result\.status/, 'handler 里不许再用通用 update 落状态')
})
