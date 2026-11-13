/**
 * 「渠道 pack 不服务的条目」必须在**发出上游请求之前**被剔出候选，而不是靠用户请求去撞。
 *
 * ## 被证明的缺陷（真实流量，非探测）
 *
 * 宿主的可路由名单来自渠道包的 `model.list`（优先适配器 `listAllModels()`：静态兜底表，
 * 不套身份档、也不随远端目录收缩），而 `src/main/channelPack/worker.ts:253-257` 的请求前
 * 闸门读的是**分档后**的 `ctx.llm.listModels(provider)`。两个集合一分歧，点名或 auto 选中
 * 的条目就在任何上游请求发出之前本地 404 `模型不存在或已停用`：实测 4 天 137 行，
 * providerId 全是 `opencode`（`opencode/nemotron-3-ultra-free` 30 行、
 * `opencode/mimo-v2.5-free` 20 行……）。
 *
 * 证明层次：真 `ProxyServer` → 真 `routes/chat.ts` 的选路预检 → 真
 * `accountChannelManager.packUnservedModels` / 真 30s 目录缓存 → 客户端状态码 /
 * `X-ModelPort-Auto-Skipped` / 渠道实际收到哪些模型名。
 * 替身只有 OS/进程边界两处：`ChannelBridge`（`bridgeOrThrow`）与渠道对话调用
 * （`complete`）——它们要起真 worker（WASM + 十个适配器），不参与本层的判定。
 *
 * 不在本层证明：`failover.ts` 那句精确文案的识别（`tests/proxy/failover.test.ts`）、
 * 限流预检本身（同一位置的姊妹段）、pack 侧目录的真实内容。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

const PORT = 18997

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

// 架构 A 的缺省换家范围是 `single`：一轮只试一个模型，换模型发生在回合之间。
// 本文件证明的「剔掉必败条目后另一条接住」是**同回合跨模型**换家，那是 `pool`
// 这一档的语义，所以显式写上，不靠缺省值。
assert.equal(sm.updateRoute('auto', { modelScope: 'pool' }).ok, true, '迁移必须造出 auto 路由')

/**
 * 一家账号渠道，目录里两个条目：
 * - `OpenCode / Gone` —— pack 的服务清单里没有它（今天的必败条目）；标 `free` 让
 *   `prefer:'cheap'` 把它顶到第一候选，否则「被剔掉」与「本来就轮不到」无法区分。
 * - `OpenCode / Live` —— pack 在服务清单里，正常放行。
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
  supportedModels: ['OpenCode / Gone', 'OpenCode / Live'],
  modelMappings: {
    'OpenCode / Gone': 'opencode/gone',
    'OpenCode / Live': 'opencode/live',
  },
  modelCapabilities: { 'OpenCode / Gone': { free: true } },
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

const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')
const { channelRuntimeState, markChannelRuntimeRunning, markChannelRuntimeStopped } = await loadModule(
  'main/providers/accountChannels/runtimeState.ts',
)

/** pack 侧 `bridge.models()` 的返回值（`{ id: '<channel>/<model>' }` 形状，与真视图一致）。 */
let packView: Array<Record<string, unknown>> = []
/** `bridge.models()` 被真读了多少次 —— TTL 命中与否就看它。 */
let viewReads = 0
/** 渠道实际收到的模型名（预检剔掉的不应出现在这里）。 */
const seenModels: string[] = []

const fakeBridge = {
  models: async () => {
    viewReads += 1
    return packView.map(entry => ({ ...entry }))
  },
  rpc: async (method: string) => {
    if (method === 'model.list') {
      return { ok: true, value: { models: [{ id: 'gone', name: 'Gone' }, { id: 'live', name: 'Live' }] } }
    }
    return { ok: true, value: {} }
  },
}

accountChannelManager.bridgeOrThrow = async () => {
  // 与真实 `bridgeOrThrow` 同形：运行时没在跑就打不开这扇门（本替身**不**负责拉起
  // Worker，正是「状态检查不许顺手 spawn」这条规则在测试里的形状）。
  if (!channelRuntimeState.running) throw new Error('渠道运行时不可用')
  return fakeBridge as never
}
accountChannelManager.complete = async (request: { model: string }) => {
  seenModels.push(request.model)
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

/** 让 pack 报出这份服务清单，并把两处缓存一起压到新状态（`warmModels` 是既有失效入口）。 */
async function serveView(view: Array<Record<string, unknown>>): Promise<void> {
  packView = view
  await accountChannelManager.warmModels()
}

const postAuto = () => proxy.request('POST', '/v1/chat/completions', {
  body: { model: 'auto', messages: [{ role: 'user', content: 'ping' }] },
})

beforeEach(async () => {
  seenModels.length = 0
  viewReads = 0
  autoRouter.reset()
  markChannelRuntimeRunning()
})

after(async () => {
  await proxy.stop()
  autoRouter.reset()
  markChannelRuntimeStopped()
  harness.dispose()
})

test('pack 不服务的条目在发请求前被剔，且原因进 skipped 透出', async () => {
  await serveView([{ id: 'opencode/live' }])

  const response = await postAuto()

  assert.equal(response.status, 200, '剔掉必败候选后，在服务清单里的那条应当接住')
  assert.deepEqual(seenModels, ['opencode/live'],
    'pack 目录里没有的 `opencode/gone` 一次都不该被送进渠道（送了就等于把 404 交给用户撞）')
  const skipped = String(response.headers['x-modelport-auto-skipped'] ?? '')
  assert.match(skipped, /pack_not_serving/, '剔除要可解释，不能静默消失')
  assert.match(decodeURIComponent(skipped), /OpenCode \/ Gone/)
})

test('在服务清单里的候选正常放行（预检不是黑名单以外的第二道闸）', async () => {
  await serveView([{ id: 'opencode/gone' }, { id: 'opencode/live' }])

  const response = await postAuto()

  assert.equal(response.status, 200)
  assert.equal(seenModels[0], 'opencode/gone', '两条都服务时不该动顺序：cheap 下 gone 仍排第一')
  assert.equal(response.headers['x-modelport-auto-skipped'], undefined,
    '没有剔除就不该发这个头，否则客户端读到一条假的「跳过」')
})

test('single 作用域：pack 不服务的头部模型必须在裁剪前剔掉，不能把整轮变成空池', async () => {
  // 2026-11-13 现网：`codex-deepseek` 被裁成单一模型（OpenCode / Nemotron 3 Ultra Free），
  // 而它不在 pack 的服务清单里 —— 预检跑在裁剪之后，剔光就是 40 秒内 11 笔 503，
  // 池子里其实还有能跑的模型。剔必须发生在「本轮用哪个模型」决定之前。
  assert.equal(sm.updateRoute('auto', { modelScope: 'single' }).ok, true)
  try {
    await serveView([{ id: 'opencode/live' }])

    const response = await postAuto()

    assert.equal(response.status, 200, '头部模型不可服务时应落到下一个模型，而不是零候选 503')
    assert.deepEqual(seenModels, ['opencode/live'])
    assert.match(
      decodeURIComponent(String(response.headers['x-modelport-auto-skipped'] ?? '')),
      /OpenCode \/ Gone:pack_not_serving/,
      '被剔的头部模型仍要可解释',
    )
  } finally {
    assert.equal(sm.updateRoute('auto', { modelScope: 'pool' }).ok, true)
  }
})

test('冷启动那一笔不等目录：先放行，后台补齐后下一笔才剔', async () => {
  // 预检读的是 pack 的目录视图（`bridge.models()` 的 RPC 上限 120s），所以它只能在
  // 后台刷，绝不能摆在选择路径上等它 —— 否则「一次本地必败」被换成「一笔可能卡两分钟
  // 的请求」。这条把两件事一起钉住：冷启动当未知放行；补齐后立刻开始剔。
  packView = [{ id: 'opencode/live' }]
  markChannelRuntimeStopped()
  await postAuto()          // 走 `packServedIds` 的「运行时下线 → 缓存作废」分支
  markChannelRuntimeRunning()

  seenModels.length = 0
  const cold = await postAuto()
  assert.equal(cold.status, 200)
  assert.deepEqual(seenModels, ['opencode/gone'],
    '冷启动这一笔没等到清单就当未知放行；若它同步等了目录，这里就会是 live')

  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(viewReads >= 1, true, '补齐是在后台发生的')

  seenModels.length = 0
  const warm = await postAuto()
  assert.equal(warm.status, 200)
  assert.deepEqual(seenModels, ['opencode/live'], '补齐之后，pack 不服务的条目就不再发出去了')
})

test('一次 select 内同一家只读一次清单，下一请求靠 TTL 命中', async () => {
  // gone 不在清单里（要被剔）、live 在（要放行）：一条断言同时钉住「预检真的跑了」
  // 与「跑的时候只读了一份清单」。
  packView = [{ id: 'opencode/live' }]
  viewReads = 0
  await accountChannelManager.warmModels()
  assert.equal(viewReads, 1, '预热自己读一次，作为后面的基线')

  const first = await postAuto()
  assert.equal(first.status, 200)
  assert.deepEqual(seenModels, ['opencode/live'], '预检必须真的跑过：没剔就不算命中缓存')
  assert.match(decodeURIComponent(String(first.headers['x-modelport-auto-skipped'] ?? '')),
    /OpenCode \/ Gone:pack_not_serving/)
  assert.equal(viewReads, 1, '预检复用同一次 select 上下文的缓存清单，不在候选循环里重读')

  seenModels.length = 0
  const second = await postAuto()
  assert.equal(second.status, 200)
  assert.equal(viewReads, 1, '30s TTL 内第二个请求也不该再打一次 pack')
})

test('整池被剔空：按既有 503 / no_available_model 口径返回，不伪造成功', async () => {
  // pack 报的是一条宿主目录里根本没有的条目：清单非空（= 确实读到了），
  // 而这一家广告的两条都不在里面 → 全池必败。
  await serveView([{ id: 'opencode/ghost' }])

  const response = await postAuto()

  assert.equal(response.status, 503, '剔空不是成功，也不该被改写成 404/400')
  assert.equal(response.json?.error?.code, 'no_available_model', '与既有「路由没选出候选」同一个 code')
  assert.equal(response.json?.error?.type, 'service_unavailable_error')
  assert.match(String(response.json?.error?.message ?? ''), /No available model for route 'auto'/)
  const skipped = decodeURIComponent(String(response.headers['x-modelport-auto-skipped'] ?? ''))
  assert.match(skipped, /opencode\/OpenCode \/ Live:pack_not_serving/, '剔空时更要解释剔了谁')
  assert.deepEqual(seenModels, [], '既然全池必败，一次上游请求都不该发出')
})

test('运行时没在跑时预检 fail-open：不新增拦截，也不打 pack', async () => {
  await serveView([{ id: 'opencode/live' }])
  markChannelRuntimeStopped()
  viewReads = 0

  const response = await postAuto()

  assert.equal(response.status, 200)
  assert.equal(seenModels[0], 'opencode/gone',
    '读不到清单就当不知道，照原顺序发出去 —— 预检不能把一次状态故障变成 503')
  assert.equal(viewReads, 0, '状态检查不许顺手打 pack，更不许拉起 Worker')
  assert.equal(response.headers['x-modelport-auto-skipped'] ?? undefined, undefined)
})

test('清单里整家缺席（未登录 / 目录这轮读失败）时一个都不剔', async () => {
  // `collectGatewayModels` 把读目录抛错的那一家整组跳过，于是「这一家一条都没有」
  // 与「这一家确实不服务任何模型」在视图里不可区分 —— 只能按未知处理。
  await serveView([{ id: 'trae/somebody-elses-model' }])

  const response = await postAuto()

  assert.equal(response.status, 200)
  assert.equal(seenModels[0], 'opencode/gone', '没有证据就不拦：这两条照常发出')
  assert.equal(response.headers['x-modelport-auto-skipped'] ?? undefined, undefined)
})
