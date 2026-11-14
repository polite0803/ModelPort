/**
 * 请求前预检「剔空之后」的两件事：**重选**与**口径**。
 *
 * ## 被证明的缺陷（真实流量，2026-11-14 现网）
 *
 * `daily` 路由（`modelScope: single`）一天 27 笔 `503 no_available_model`，三段时间
 * 全部同一个形状：头部被 `single` 裁成 `OpenCode / Big Pickle`，它的免费日额度在
 * 00:00 UTC 前打满（worker 报 `resetAt`，主进程选路看不到），`chat.ts` 的请求前
 * 预检在**裁剪之后**把唯一候选剔掉 —— 整轮零候选，池子里另外 51 个模型一次都没被
 * 派过。同期客户端在 3 分半里重试 11 次，每次拿到的都是 503。
 *
 * 证明层次：真 `ProxyServer` → 真 `routes/chat.ts` 预检 + 重选 → 真
 * `accountChannelManager.modelRateLimits`（含限流镜像）→ 客户端状态码 / 实际派给渠道
 * 的模型名 / 请求日志行。替身只有 OS/进程边界两处：`bridgeOrThrow`（worker 内存 rpc）
 * 与 `complete`（上游对话）。
 *
 * 不在本层证明：真实 worker 的限流语义（`channelPack/worker.ts`）、真实 pack 目录。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

// 与 `account-channel-served-precheck-named` 的 18998 错开：全量测试是多文件并发跑的。
const PORT = 19004

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
      autoRouting: { enabled: true, maxAttempts: 3, stickyMinutes: 0, prefer: 'cheap', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

/**
 * 一家账号渠道，两个条目：
 * - `OpenCode / Pickle` —— `free`，`prefer:'cheap'` 下它是头部（现网的 Big Pickle）；
 * - `OpenCode / Live` —— 排在后面的替补，证明「头部被剔后下一个接住」。
 */
sm.addProvider({
  id: 'opencode',
  name: 'OpenCode',
  type: 'account',
  authType: 'token',
  loginKind: 'api-key',
  apiEndpoint: 'channel://opencode',
  headers: { 'Content-Type': 'application/json' },
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['OpenCode / Pickle', 'OpenCode / Live'],
  modelMappings: {
    'OpenCode / Pickle': 'opencode/pickle',
    'OpenCode / Live': 'opencode/live',
  },
  modelCapabilities: { 'OpenCode / Pickle': { free: true } },
  credentialFields: [],
  supportsModelFetch: false,
} as never)
sm.addAccount({
  id: 'opencode-acct',
  providerId: 'opencode',
  name: 'OpenCode (channel)',
  credentials: {},
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

assert.equal(sm.updateRoute('auto', { modelScope: 'single', prefer: 'cheap', poolStrategies: [] }).ok, true,
  '单模型作用域是本文件要钉的那一档（缺省值，但显式写上）')

const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

/** worker 报「限流中」的模型 id；`resetAtMs` 由 every test 现算。 */
let limitedModels = new Set<string>()
/** 上游在**产出前**就以额度文案拒绝的模型 id（预检看不见的那一类）。 */
let failingModels = new Set<string>()
let rateLimitQueries: string[][] = []
/** 渠道实际收到的模型名（被剔的条目不应出现在这里）。 */
const seenModels: string[] = []

accountChannelManager.bridgeOrThrow = async () => ({
  models: async () => [],
  rpc: async (method: string, payload: { models?: string[] }) => {
    if (method === 'model.rateLimits') {
      const requested = payload.models ?? []
      rateLimitQueries.push([...requested])
      const table: Record<string, { limited: true; resetAtMs: number }> = {}
      for (const id of requested) {
        if (limitedModels.has(id)) table[id] = { limited: true, resetAtMs: Date.now() + 30 * 60_000 }
      }
      return { ok: true, value: { rateLimits: table } }
    }
    return { ok: true, value: {} }
  },
} as never)
accountChannelManager.packUnservedModels = async () => ({})
accountChannelManager.complete = async (request: { model: string }) => {
  seenModels.push(request.model)
  if (failingModels.has(request.model)) {
    // 渠道包跨桥只带 message/status（`bridge.ts`），与真流量同一形状：
    // 2026-11-14 现网 `opencode: 所有通道对该模型均受限（…(free_usage_limit)）` + 429。
    const failure = new Error('opencode: 所有通道对该模型均受限（acct-a(free_usage_limit)）')
    ;(failure as { status?: number }).status = 429
    throw failure
  }
  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion',
    created: 1,
    model: request.model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
  }
}

const proxy = await startProxy(PORT)

const postAuto = () => proxy.request('POST', '/v1/chat/completions', {
  body: { model: 'auto', messages: [{ role: 'user', content: 'ping' }] },
})
const autoRoute = () => sm.listModelRoutes().find(route => route.name === 'auto')

beforeEach(() => {
  seenModels.length = 0
  rateLimitQueries = []
  limitedModels = new Set()
  failingModels = new Set()
  autoRouter.reset()
  // 镜像与 TTL 缓存一起清：否则上一轮的限流读数会把这一轮的头部继续挡在外面。
  accountChannelManager.clearRateLimitCache()
})

after(async () => {
  await proxy.stop()
  autoRouter.reset()
  accountChannelManager.clearRateLimitCache()
  harness.dispose()
})

test('single 作用域：头部被 worker 限流时重选到下一个模型，而不是整轮 503', async () => {
  limitedModels = new Set(['opencode/pickle'])

  const response = await postAuto()

  assert.equal(response.status, 200, '头部不可服务时必须落到下一个模型，不能把整轮变成空池')
  assert.deepEqual(seenModels, ['opencode/live'], '被限流的头部一次都不该被派出去')
  const skipped = decodeURIComponent(String(response.headers['x-modelport-auto-skipped'] ?? ''))
  assert.match(skipped, /OpenCode \/ Pickle:quota_reset_in_/, '剔除要可解释，且要带多久回来')
})

test('限流读数落成镜像：下一次选路在排序前就跳过它', async () => {
  limitedModels = new Set(['opencode/pickle'])
  await postAuto()
  assert.equal(seenModels.length, 1)

  assert.equal(accountChannelManager.isModelRateLimitedNow('opencode', 'opencode/pickle'), true,
    '预检读数必须写进选路可读的镜像')

  const decision = autoRouter.select(
    { model: 'auto', messages: [{ role: 'user', content: 'ping' }] },
    'round-robin',
    undefined,
    autoRoute(),
  )
  assert.ok(!decision.candidates.some(candidate => candidate.displayName === 'OpenCode / Pickle'),
    '镜像里的限流模型不能进这一轮的候选链')
  assert.ok(decision.skipped.some(marker => marker.endsWith('OpenCode / Pickle:rate_limited')),
    '跳过要带自己的原因，不能并进别的口径')
})

test('整池都被 worker 限流：回 429 + Retry-After，且不伪造上游调用', async () => {
  limitedModels = new Set(['opencode/pickle', 'opencode/live'])

  const response = await postAuto()

  assert.equal(response.status, 429, '等窗口复位不是「这条路由没有模型」')
  assert.equal(response.json?.error?.code, 'model_temporarily_unavailable')
  assert.equal(response.json?.error?.type, 'rate_limit_error')
  assert.equal(response.json?.error?.details?.cause, 'rate_limit')
  assert.ok(Number(response.headers['retry-after']) >= 1, '必须给出可退避的 Retry-After')
  assert.deepEqual(seenModels, [], '剔空之后不该有任何上游调用')

  const rows = sm.getRequestLogs()
  // `getRequestLogs()` 按时间倒序，最新的一条在第一位。
  const row = rows[0]
  assert.equal(row.errorCode, 'model_temporarily_unavailable')
  assert.equal(row.providerId, 'opencode', '拒绝行必须指得出是哪个模型把池子掏空的')
  assert.ok(row.actualModel === 'opencode/pickle' || row.actualModel === 'opencode/live')
})

test('钉子不被重选绕开：钉住的模型被限流时快速失败，不静默换模型', async () => {
  limitedModels = new Set(['opencode/pickle'])
  assert.equal(sm.updateRoute('auto', {
    preferredModel: { providerId: 'opencode', displayName: 'OpenCode / Pickle' },
  }).ok, true)
  try {
    const response = await postAuto()

    assert.equal(response.status, 429, '钉子在、只是此刻不可用：可重试，而不是换一个模型顶上')
    assert.deepEqual(seenModels, [], '用户钉的模型不能用，就不该派别家')
    assert.equal(response.json?.error?.details?.cause, 'rate_limit')
  } finally {
    assert.equal(sm.updateRoute('auto', { preferredModel: undefined }).ok, true)
  }
})

test('上游零产出地拒绝额度：同一回合换下一个模型重放，而不是把 429 交给客户端', async () => {
  // 预检看不见的那一类：渠道匿名池的 free_usage_limit 只在请求发出后才以 429 回来。
  // 一个字节都没产出 ⇒ 客户端看来这一发还没开始，换模型不伤上下文/工具协议/缓存。
  failingModels = new Set(['opencode/pickle'])

  const response = await postAuto()

  assert.equal(response.status, 200, '头部零产出地被额度拒绝后，下一个模型应当接住')
  assert.deepEqual(seenModels, ['opencode/pickle', 'opencode/live'],
    '先试头部（被拒，零产出），再换下一个模型重放')
  const skipped = decodeURIComponent(String(response.headers['x-modelport-auto-skipped'] ?? ''))
  assert.match(skipped, /OpenCode \/ Pickle:quota-exhausted/, '换掉的那一家要写进跳过清单')
  assert.equal(response.headers['x-modelport-auto-attempts'], '2', '两次尝试都要记进读数')

  const row = sm.getRequestLogs()[0]
  assert.equal(row.status, 'success')
  assert.equal(row.actualModel, 'opencode/live')
  assert.equal(row.auto?.attempts, 2)
})

test('整池都零产出地被额度拒绝：尝试有上限，收口成可重试的 503 而不是无限换家', async () => {
  failingModels = new Set(['opencode/pickle', 'opencode/live'])

  const response = await postAuto()

  // 多家候选都被上游亲口判了额度：按既有裁定收口成 503（客户端退避后重来），
  // 429 在客户端是终止语义，见 `failover.ts::autoExhaustedResponse` 的注释。
  assert.equal(response.status, 503)
  assert.equal(response.json?.error?.code, 'no_available_model')
  assert.match(String(response.json?.error?.message ?? ''), /exhausted all 2 accounts of 'OpenCode \/ Live'/)
  assert.match(String(response.json?.error?.message ?? ''), /free_usage_limit/)
  assert.ok(Number(response.headers['retry-after']) >= 1, '要给出可退避的间隔')
  assert.deepEqual(seenModels, ['opencode/pickle', 'opencode/live'],
    '池里只有两个模型：各试一次就收口，排除了整池之后不再空转')
})