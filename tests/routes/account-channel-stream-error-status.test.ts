/**
 * 账号渠道**流式**失败的错误帧里那个状态码，必须决定换家循环的记账档位。
 *
 * ## 被证明的缺陷（真实流量，2026-11-12 用户报障「Codex 接 codex 路由 503」）
 *
 * 现网请求 `chatcmpl-mwcbjari-izjtek`：客户端发 `model: "codex"`，路由 `codex`
 * 的候选链长 1152，循环在第 7 家收手，客户端拿到
 * `503 no_available_model（last: cline: model not supported）`。
 * 那 7 家里三条是 cline 的 `:batch` 变体 —— 上游对它们逐发 **404**，但流式路径
 * 把状态码丢成了 502 账号故障（`forwardAccountChannel` 的嗅探分支只按文案判
 * 400/502，而同文件的姊妹分支 `probeAndWrapStream` 读 `details.status`）。
 * 三条 404 于是吃满路由的 `maxAttempts: 3`，后面 1145 个候选一个没试到。
 *
 * 证明层次：真 `RequestForwarder.forwardAutoCompletion` 换家循环 + 真
 * `probeSseHead` 帧解析 + 真 `describeAttemptFailure` 记账；替身只有渠道 Worker
 * 的流（`accountChannelManager.openStream`）——它要起真 WASM 与十个适配器，
 * 不参与本层的判定。帧形状取自 `toOpenAiSse` 的实际产出（见
 * `tests/channels/openai-gateway-error-frame-status.test.ts`，两半在那一侧钉）。
 *
 * 不在本层证明：路由选号顺序、pack 目录内容、客户端可见错误体文案。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { bootstrapStore, loadModule } from './harness.mjs'

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
      proxyPort: 18998,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 3, stickyMinutes: 0, prefer: 'strong', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

/**
 * 一家渠道、四个条目：三条 `:batch`（上游逐发 404）与一条正常服务的。
 * 顺序由本测试直接喂给换家循环，所以「撞满上限」与「试到第四家」两种结局
 * 只可能由状态码的归类决定。
 *
 * `actualModel` 用现网目录里的完整形状（`<channel>/<model>`，见请求日志的
 * `actualModel` 字段）：cline 的模型 id 自己就带 `/`（`anthropic/claude-opus-5`），
 * 裸 id 会被 `qualifyChannelModel` 当成「别家前缀」原样透给 worker。
 */
const BATCH_MODELS = [
  'cline/anthropic/claude-opus-4.7:batch',
  'cline/anthropic/claude-opus-4.8:batch',
  'cline/anthropic/claude-opus-5:batch',
]
const LIVE_MODEL = 'cline/anthropic/claude-opus-5'

sm.addProvider({
  id: 'cline',
  name: 'Cline',
  type: 'account',
  authType: 'token',
  loginKind: 'oauth',
  apiEndpoint: 'channel://cline',
  headers: { 'Content-Type': 'application/json' },
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: [...BATCH_MODELS, LIVE_MODEL].map(id => `Cline / ${id}`),
  modelMappings: Object.fromEntries([...BATCH_MODELS, LIVE_MODEL].map(id => [`Cline / ${id}`, id])),
  credentialFields: [],
  supportsModelFetch: false,
} as never)
sm.addAccount({
  id: 'cline-acct',
  providerId: 'cline',
  name: 'Cline (channel)',
  credentials: {},
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')
const { requestForwarder } = await loadModule('main/proxy/forwarder.ts')
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

/** 渠道 Worker 实际收到的模型名（`<channel>/<model>` 形状）。 */
const seenModels: string[] = []

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** 与 `toOpenAiSse` 的产出同形：建流阶段失败 = 一帧 `choices: [] + error` + 一发 `[DONE]`。 */
accountChannelManager.openStream = (request: { model: string }): Readable => {
  seenModels.push(request.model)
  if (request.model.endsWith(':batch')) {
    return Readable.from([
      sse({
        id: 'chatcmpl-fake',
        object: 'chat.completion.chunk',
        created: 1,
        model: request.model,
        choices: [],
        error: { message: 'cline: model not supported', type: 'server_error', code: 'HTTP_404', status: 404 },
      }),
      'data: [DONE]\n\n',
    ])
  }
  return Readable.from([
    sse({
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      created: 1,
      model: request.model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' } }],
    }),
    sse({
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      created: 1,
      model: request.model,
      choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }],
    }),
    'data: [DONE]\n\n',
  ])
}

const provider = sm.getProviders().find(p => p.id === 'cline')!
const account = sm.getAccountsByProviderId('cline')[0]!

function candidate(actualModel: string): {
  account: typeof account
  provider: typeof provider
  displayName: string
  actualModel: string
} {
  return { account, provider, displayName: `Cline / ${actualModel}`, actualModel }
}

const REQUEST = {
  model: 'codex',
  messages: [{ role: 'user', content: 'ping' }],
  stream: true,
  requestId: 'req-stream-error-status',
} as never

const CONTEXT = {
  requestId: 'req-stream-error-status',
  providerId: 'cline',
  accountId: 'cline-acct',
  model: 'codex',
  actualModel: BATCH_MODELS[0],
  startTime: Date.now(),
  isStream: true,
}

beforeEach(() => {
  seenModels.length = 0
  // autoRouter.reset() 连带清 accountRuntime 与目录缺失冷却（同一套运行时状态）。
  autoRouter.reset()
})

test('流式 404 按能力不匹配换家：三条 :batch 不吃掉 maxAttempts，第四家正常服务', async () => {
  const outcome = await requestForwarder.forwardAutoCompletion(
    REQUEST,
    [...BATCH_MODELS.map(candidate), candidate(LIVE_MODEL)],
    CONTEXT,
    { baseCap: 3 },
  )

  assert.ok(outcome, '换家循环必须给出结果，而不是在预算耗尽时收场')
  assert.equal(outcome.result.success, true, '第四家本该服务成功 —— 状态码丢成 502 时这里到不了')
  assert.equal(outcome.attempts, 4)
  assert.equal(outcome.candidate.actualModel, LIVE_MODEL)
  assert.deepEqual(seenModels, [...BATCH_MODELS, LIVE_MODEL])

  for (const failure of outcome.failures) {
    assert.equal(failure.status, 404, `帧里的状态码不许退化成 502：${failure.candidate}`)
    assert.equal(failure.kind, 'capability', '「这一家供不了这个模型」不记账号故障')
  }
  for (const trace of outcome.attemptTrace.filter(entry => entry.model.endsWith(':batch'))) {
    assert.equal(trace.status, 404)
    assert.equal(trace.outcome, 'capability')
  }
})

test('单发一笔 :batch：ForwardResult 带 404 与 HTTP_404，账号不进冷却', async () => {
  const result = await requestForwarder.forwardChatCompletion(
    REQUEST,
    account,
    provider,
    BATCH_MODELS[0],
    CONTEXT,
    { maxRetries: 0 },
  )

  assert.equal(result.success, false)
  assert.equal(result.status, 404)
  assert.equal(result.error, 'cline: model not supported')
  assert.equal(result.errorDetails?.code, 'HTTP_404')
  assert.equal(
    autoRouter.isAccountCooling(account.id, BATCH_MODELS[0]),
    false,
    '404 是目录事实，不该给账号记冷却',
  )
})
