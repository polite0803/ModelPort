/**
 * 点名/显式选模路径：pack 明确不服务的账号渠道条目必须在**发出渠道 worker 往返之前**
 * 本地拦下，客户端可见结果与今天**逐字相同**（404 + `模型不存在或已停用` 错误体）。
 *
 * ## 被证明的缺陷（真实流量，非探测）
 *
 * 同 `account-channel-served-precheck.test.ts`：宿主可路由名单来自 `model.list`
 * （不套身份档），渠道 worker 的请求前闸门读的是**分档后**的 `listModels(provider)`
 * （`channelPack/worker.ts`，不命中即在零上游调用时抛 404 `模型不存在或已停用`）。
 * 上一批只修了 auto 路径；实测形态里点名 49 行 + 内部 id 86 行走的是 `!autoDecision`
 * 的具名路径，本文件把它修掉。
 *
 * 证明层次：真 `ProxyServer` → 真 `routes/chat.ts` 具名路径预检 → 真
 * `accountChannelManager.packUnservedModels` / 真 30s 清单缓存 → 客户端状态码 /
 * 错误体逐字 / 错误行 / `complete` 调用次数。
 * 替身只有 OS/进程边界两处：`ChannelBridge`（`bridgeOrThrow`）与渠道对话调用
 * （`complete`）——与姊妹文件同一 stub 形态，不起 worker/WASM。
 * 「转发了」的可观测样貌取自 `proxy-routes-request.test.ts` 的既有手法：链上的
 * custom 供应商 `apiEndpoint` 固定 `http://127.0.0.1:1/v1`（端口 1 本机不监听，
 * 连接立刻被拒且绝不出网），「没转发给别家」才会是本地 404 `模型不存在或已停用`。
 *
 * 不在本层证明：worker 侧闸门本身、failover 的文案识别（`tests/proxy/failover.test.ts`）、
 * auto 路径预检（姊妹文件）、聚合目录的真实内容。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

const PORT = 18998

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
      // ⑤ 用：裸名 `glm-5` 硬性点名到 opencode 渠道（`getPreferredProvider`），
      // 同时它在聚合目录里被 ≥2 家条目接住 → `chainCandidates` 成形，检验「别家能服务时不提前 404」。
      modelMappings: {
        'glm-5': { actualModel: 'glm-5', preferredProviderId: 'opencode' },
      },
    },
  },
})
const sm = harness.storeManager

/**
 * 一家账号渠道。目录条目：
 * - `OpenCode / Gone` → `opencode/gone`：pack 服务清单里没有（今天的本地必败 404 条目）。
 * - `OpenCode / Live` → `opencode/live`：pack 在服务清单里，点名应正常放行。
 * - `glm-5` → `opencode/glm-5-ns`：pack 不服务，但裸名有跨家链（⑤）。
 * 两个账号同家：验证「同一家多个账号逐个空转」被省掉（②）。
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
  supportedModels: ['OpenCode / Gone', 'OpenCode / Live', 'glm-5'],
  modelMappings: {
    'OpenCode / Gone': 'opencode/gone',
    'OpenCode / Live': 'opencode/live',
    'glm-5': 'opencode/glm-5-ns',
  },
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
sm.addAccount({
  id: 'opencode-acct-2',
  providerId: 'opencode',
  name: 'OpenCode (channel 2)',
  credentials: {},
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

/**
 * ⑤ 的「别家」：id 取真实聚合注册表里的条目 id（`alibaba_cloud`/`zai` 都广告裸名
 * `glm-5`，见 `AGGREGATE_REGISTRY`），type 用 custom 走普通 HTTP 转发——链的成形只看
 * `provider.id ∈ 注册表条目`，与 type 无关；预检也只剔 `type === 'account'` 的候选。
 * 上游固定端口 1：不出网、确定性失败，能区分「换家真的发了」与「被本地 404 拦死」。
 */
function chainProviderFixture(id: string, displayName: string) {
  return {
    id,
    name: `Chain ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [displayName],
    modelMappings: { [displayName]: 'glm-5' },
    credentialFields: [],
  }
}
sm.addProvider(chainProviderFixture('alibaba_cloud', 'alibaba_cloud/glm-5') as never)
sm.addProvider(chainProviderFixture('zai', 'zai/glm-5') as never)
sm.addAccount({
  id: 'alibaba_cloud-acct',
  providerId: 'alibaba_cloud',
  name: 'chain acct',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)
sm.addAccount({
  id: 'zai-acct',
  providerId: 'zai',
  name: 'chain acct 2',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')
const { channelRuntimeState, markChannelRuntimeRunning, markChannelRuntimeStopped } = await loadModule(
  'main/providers/accountChannels/runtimeState.ts',
)
const { mapForwardFailure, withRequestId } = await loadModule('main/proxy/errorMapping.ts')

/** pack 侧 `bridge.models()` 的返回值（`{ id: '<channel>/<model>' }`，与真视图同形）。 */
let packView: Array<Record<string, unknown>> = [{ id: 'opencode/live' }]
/** 渠道实际收到哪些模型名——它的长度就是 `complete` 的调用次数。 */
const seenModels: string[] = []

const fakeBridge = {
  models: async () => packView.map(entry => ({ ...entry })),
  rpc: async (method: string) => {
    if (method === 'model.list') {
      return {
        ok: true,
        value: {
          models: [
            { id: 'gone', name: 'Gone' },
            { id: 'live', name: 'Live' },
            { id: 'glm-5-ns', name: 'glm-5' },
          ],
        },
      }
    }
    return { ok: true, value: {} }
  },
}

accountChannelManager.bridgeOrThrow = async () => {
  // 与真实 `bridgeOrThrow` 同形：运行时没在跑就打不开这扇门；替身**不**负责拉起 Worker。
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

/** 让 pack 报出这份服务清单，并把目录/清单缓存一起压到新状态（姊妹文件同款入口）。 */
async function serveView(view: Array<Record<string, unknown>>): Promise<void> {
  packView = view
  await accountChannelManager.warmModels()
}

const postNamed = (model: string) => proxy.request('POST', '/v1/chat/completions', {
  body: { model, messages: [{ role: 'user', content: 'ping' }] },
})

const errorRows = () => sm.getRequestLogs(1000, { status: 'error' }) as Array<Record<string, unknown>>
const newErrorRowsSince = (before: number) => errorRows().length - before

/** 今天 worker 闸门那笔的逐字错误体口径（`forwarder` catch → `mapForwardFailure` → `withRequestId`）。 */
function expectedWireMessage(requestId: string): string {
  const mapped = mapForwardFailure({
    status: 404,
    message: '模型不存在或已停用',
    details: { message: '模型不存在或已停用' },
  })
  return withRequestId(mapped.message, requestId)
}

beforeEach(async () => {
  seenModels.length = 0
  markChannelRuntimeRunning()
  await serveView([{ id: 'opencode/live' }])
})

after(async () => {
  await proxy.stop()
  markChannelRuntimeStopped()
  harness.dispose()
})

test('①点名 pack 不服务的条目：恰好一次本地 404，错误体与今天逐字相同，worker complete 零调用', async () => {
  const before = errorRows().length
  const response = await postNamed('OpenCode / Gone')

  assert.equal(response.status, 404, '点名本地必败条目：状态码今天就是 404，不许变成 503/502')
  const requestId = String(response.headers['x-request-id'])
  assert.ok(requestId, '每个 /v1/* 响应都要带 X-Request-Id')
  assert.equal(response.json.error.message, expectedWireMessage(requestId),
    '错误体 message 与今天 worker 404 过完 mapForwardFailure + withRequestId 的字节逐字相同')
  assert.ok(response.json.error.message.startsWith('模型不存在或已停用 [request_id:'),
    '原文 `模型不存在或已停用` 一个字节都不许改（failover.ts::isChannelModelUnavailableError 按这句原文识别）')
  assert.equal(response.json.error.type, 'not_found_error')
  assert.equal(response.json.error.param, null)
  assert.equal(response.json.error.code, null)
  assert.deepEqual(Object.keys(response.json.error).sort(), ['code', 'message', 'param', 'type'],
    '不许自造新响应字段')
  assert.equal(seenModels.length, 0, '预检的意义就是省掉渠道 worker 往返：complete 一次都不许被调')
  assert.equal(newErrorRowsSince(before), 1, '恰好一行错误行——本地拦下也要留今天的可诊断性')
  const row = errorRows().find(r => r.requestId === requestId)
  assert.ok(row, '错误行要能和 X-Request-Id 对上')
  assert.equal(row!.statusCode, 404)
  assert.equal(row!.errorCode, 'pack_not_serving')
  assert.equal(row!.providerId, 'opencode')
})

test('①b点名路径不发明 skipped 头：X-ModelPort-Auto-Skipped 属于 auto 透出，具名路径没有这个通道', async () => {
  const response = await postNamed('OpenCode / Gone')
  assert.equal(response.status, 404)
  assert.equal(response.headers['x-modelport-auto-skipped'], undefined,
    '具名路径没有既有 skipped 通道；剔除原因进错误行（①），不许往响应里造新字段')
})

test('②同一家两个账号都不服务：零 worker 往返、恰好一行错误，不出现逐账号空转', async () => {
  // `opencode` 家下两个 active 账号，round-robin 会各选一次；pack 判的是
  // (渠道, 模型)，两家账号一起死 ⇒ 一次本地 404 收口，complete 零调用。
  const before = errorRows().length
  const first = await postNamed('OpenCode / Gone')
  assert.equal(first.status, 404)
  assert.equal(newErrorRowsSince(before), 1)
  assert.equal(seenModels.length, 0, '逐账号空转被省掉：0 次而不是 1 次')

  const second = await postNamed('OpenCode / Gone')
  assert.equal(second.status, 404)
  assert.equal(seenModels.length, 0, '第二笔也不许退回去打 worker')
})

test('③点名 pack 在服务的条目：行为不变，正常放行到渠道', async () => {
  const response = await postNamed('OpenCode / Live')
  assert.equal(response.status, 200)
  assert.deepEqual(seenModels, ['opencode/live'], '在服务清单里的条目一个字都不该被动到')
})

test('④清单读不到（空表/整家未知/运行时下线）：fail-open，照常放行', async () => {
  // 视图为空 ⇒ `seedPackServedCache` 给每家记「未知」（与「一条都不服务」不可区分），
  // `packUnservedModels` 返回空表 ⇒ 什么都不剔。
  await serveView([])
  const empty = await postNamed('OpenCode / Gone')
  assert.equal(empty.status, 200, '目录故障不能变成新增的 404')
  assert.deepEqual(seenModels, ['opencode/gone'], '读不到就当不知道，照发给渠道（今天的形态）')

  seenModels.length = 0
  markChannelRuntimeStopped()
  const stopped = await postNamed('OpenCode / Gone')
  assert.equal(stopped.status, 200)
  assert.deepEqual(seenModels, ['opencode/gone'], '运行时下线同样 fail-open，且预检不打 pack、不拉起 Worker')

  // 视图里整家缺席（未登录/目录读失败不可区分）也未知。
  markChannelRuntimeRunning()
  await serveView([{ id: 'trae/somebody-elses-model' }])
  seenModels.length = 0
  const absent = await postNamed('OpenCode / Gone')
  assert.equal(absent.status, 200)
  assert.deepEqual(seenModels, ['opencode/gone'])
})

test('⑤链上别家 provider 能服务同一裸名：预检不提前 404，换家行为保持', async () => {
  // `glm-5`：config.modelMappings 点名 opencode（pack 不服务），但裸名在聚合注册表里
  // 被 ≥2 家条目接住 → chainCandidates 成形且全是非 account 候选 → 不得因剔除而返回 404。
  const response = await postNamed('glm-5')
  assert.equal(seenModels.length, 0, '必败的 opencode 候选不该再打 worker')
  assert.notEqual(response.status, 404, '别家还活着：今天这笔走链转发，今天不是 pack 404')
  assert.ok(!String(response.json?.error?.message ?? '').includes('模型不存在或已停用'),
    '错误体不得被改写成 pack 文案')
  assert.equal(response.json?.error?.type, 'api_error',
    '链上的两家 custom 上游都是端口 1（ECONNREFUSED）→ 今天的稳定样貌是 500 api_error')
  assert.equal(response.status, 500)
})
