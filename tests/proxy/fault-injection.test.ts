/**
 * 故障注入：钉住换家循环与流边界（PLAN-fault-injection-failover）。
 *
 * 骨架与 `tests/routes/account-channel-stream-error-status.test.ts` 同源：真 store +
 * 真 `requestForwarder.forwardAutoCompletion` 换家循环 + 真 `probeSseHead` 帧解析 +
 * 真 `describeAttemptFailure` 记账；替身只有渠道 Worker 的流（`openStream`）。
 *
 * 每个用例按注入的故障断言三样：
 * ① 客户端最终形态（success / status / 错误码）；
 * ② attemptTrace 的 outcome 序列与注入一一对应；
 * ③ 「首块后不换家」——流已经交付（probe 通过、pipe 已接管）之后，任何失败
 *    都不得再派发下一家候选。
 *
 * 不在本层证明：路由选号顺序、pack 目录内容、客户端可见错误体文案。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Readable } from 'node:stream'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

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
      proxyPort: 18999,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 3, stickyMinutes: 0, prefer: 'strong', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

const MODEL_A = 'chan/model-a'
const MODEL_B = 'chan/model-b'

sm.addProvider({
  id: 'chan',
  name: 'Channel',
  type: 'account',
  authType: 'token',
  loginKind: 'oauth',
  apiEndpoint: 'channel://chan',
  headers: { 'Content-Type': 'application/json' },
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Model A', 'Model B'],
  modelMappings: { 'Model A': MODEL_A, 'Model B': MODEL_B },
  credentialFields: [],
  supportsModelFetch: false,
} as never)
sm.addAccount({
  id: 'chan-acct',
  providerId: 'chan',
  name: 'Channel (channel)',
  credentials: {},
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')
const { requestForwarder } = await loadModule('main/proxy/forwarder.ts')
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

/** 每次派发的模型名，按顺序记录——换家行为的直接证据。 */
const seenModels: string[] = []

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function contentChunk(model: string, text: string): string {
  return sse({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })
}

function doneFrame(): string {
  return 'data: [DONE]\n\n'
}

/**
 * 假上游的故障剧本：按模型名分派。每个剧本是一个接收流写入器的函数，
 * 由用例自己定义——测试断言（尤其「B 未被调用」）读 `seenModels`。
 */
type Script = (model: string, out: PassThrough) => void

const SCRIPTS: Record<string, Script> = {
  /** 429 + Retry-After，建流阶段（一个内容字节都没有）。 */
  '429': (model, out) => {
    out.write(sse({
      id: 'x', object: 'chat.completion.chunk', created: 1, model, choices: [],
      error: { message: 'rate limited', type: 'rate_limit_error', code: 'HTTP_429', status: 429 },
    }))
    out.end(doneFrame())
  },
  /** 502，建流阶段。 */
  '502': (model, out) => {
    out.write(sse({
      id: 'x', object: 'chat.completion.chunk', created: 1, model, choices: [],
      error: { message: 'bad gateway', type: 'api_error', code: 'HTTP_502', status: 502 },
    }))
    out.end(doneFrame())
  },
  /** 客户端写坏的 400：整场终结，不换家。 */
  'bad-400': (model, out) => {
    out.write(sse({
      id: 'x', object: 'chat.completion.chunk', created: 1, model, choices: [],
      error: { message: "Invalid value: 'session_id' must be a string", type: 'invalid_request_error', code: 'HTTP_400', status: 400 },
    }))
    out.end(doneFrame())
  },
  /** HTTP 200 但零字节假死（首块超时路径）。 */
  'silent': (_model, out) => {
    // 一个字节都不写、也不结束——firstStreamEvent 超时后 destroy 这个流。
    void out
  },
  /** 正常完整服务。 */
  'ok': (model, out) => {
    out.write(contentChunk(model, 'role-frame'))
    out.write(contentChunk(model, 'ok'))
    out.write(sse({
      id: 'x', object: 'chat.completion.chunk', created: 1, model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }))
    out.end(doneFrame())
  },
}

accountChannelManager.openStream = (request: { model: string }): Readable => {
  seenModels.push(request.model)
  const script = SCRIPTS[request.model === MODEL_A ? 'a' : 'b'] ?? SCRIPTS['ok']
  const out = new PassThrough()
  // 异步写入，模拟真实流时序（同步全写入会让 probe 帧解析与真实场景失真）。
  queueMicrotask(() => script(request.model, out))
  return out
}

const provider = sm.getProviders().find(p => p.id === 'chan')!
const account = sm.getAccountsByProviderId('chan')[0]!

function candidate(actualModel: string) {
  return { account, provider, displayName: actualModel === MODEL_A ? 'Model A' : 'Model B', actualModel }
}

function makeRequest(requestId: string) {
  return {
    model: 'auto',
    messages: [{ role: 'user', content: 'ping' }],
    stream: true,
    requestId,
  } as never
}

function makeContext(requestId: string) {
  return {
    requestId,
    providerId: 'chan',
    accountId: 'chan-acct',
    model: 'auto',
    actualModel: MODEL_A,
    startTime: Date.now(),
    isStream: true,
  } as never
}

beforeEach(() => {
  seenModels.length = 0
  autoRouter.reset()
})

test('429：换到下一家，A 记 failover，B 服务成功', async () => {
  // 覆盖剧本：A=429，B=ok。
  SCRIPTS.a = (model, out) => SCRIPTS['429'](model, out)
  SCRIPTS.b = (model, out) => SCRIPTS.ok(model, out)

  const outcome = await requestForwarder.forwardAutoCompletion(
    makeRequest('req-fi-429'),
    [candidate(MODEL_A), candidate(MODEL_B)],
    makeContext('req-fi-429'),
    { baseCap: 3 },
  )

  assert.ok(outcome)
  assert.equal(outcome.result.success, true)
  assert.equal(outcome.candidate.actualModel, MODEL_B)
  assert.deepEqual(seenModels, [MODEL_A, MODEL_B], 'A 撞 429 后必须换到 B')
  const aTrace = outcome.attemptTrace.find(t => t.model === MODEL_A)!
  assert.equal(aTrace.status, 429)
  assert.equal(aTrace.outcome, 'failover')
})

test('502：换到下一家，A 记 failover（账号故障档由 baseCap 计数，不体现在 kind）', async () => {
  SCRIPTS.a = (model, out) => SCRIPTS['502'](model, out)
  SCRIPTS.b = (model, out) => SCRIPTS.ok(model, out)

  const outcome = await requestForwarder.forwardAutoCompletion(
    makeRequest('req-fi-502'),
    [candidate(MODEL_A), candidate(MODEL_B)],
    makeContext('req-fi-502'),
    { baseCap: 3 },
  )

  assert.ok(outcome)
  assert.equal(outcome.result.success, true)
  assert.deepEqual(seenModels, [MODEL_A, MODEL_B])
  const aTrace = outcome.attemptTrace.find(t => t.model === MODEL_A)!
  assert.equal(aTrace.status, 502)
  assert.equal(aTrace.outcome, 'failover')
  assert.equal(outcome.failures[0]?.kind, 'failover')
})

test('客户端写坏的 400：池语义换两次即收口，第 3 家不被派发', async () => {
  // 池语义（forwardAutoCompletion → switchOnRejectedRequest）下裸 400 是「这家
  // 拒收这份请求体」，设计为换下一家，上限 MAX_REJECTED_REQUEST_SWITCHES = 2
  // （forwarder.ts:74）——再换下去只会把同一次拒绝在池里重演。用三个候选钉住
  // 「换满两次后收口」：A、B 各吃一发 400，C 绝不被派发。
  const MODEL_C = 'chan/model-c'
  SCRIPTS.a = (model, out) => SCRIPTS['bad-400'](model, out)
  SCRIPTS.b = (model, out) => SCRIPTS['bad-400'](model, out)

  const outcome = await requestForwarder.forwardAutoCompletion(
    makeRequest('req-fi-400'),
    [candidate(MODEL_A), candidate(MODEL_B), candidate(MODEL_C)],
    makeContext('req-fi-400'),
    { baseCap: 3 },
  )

  assert.ok(outcome)
  assert.equal(outcome.result.success, false)
  assert.deepEqual(seenModels, [MODEL_A, MODEL_B], '换满 2 次后收口，第 3 家不再试')
  assert.equal(
    outcome.attemptTrace.filter(t => t.outcome === 'fatal').length, 2,
    '400 按终止档记账（attemptTraceOf：400 → fatal），但链在池语义下确实换过',
  )
  // describeAttemptFailure 的口径是「kind 与当时实际走的分支一致」（failover.ts
  // 注释）：池语义下 A、B 都真换了下一家，所以 kind 都是 failover，不是 fatal
  // ——两处记账口径不同正是这条注释防的事，本用例把它钉住。
  assert.deepEqual(outcome.failures.map(f => f.kind), ['failover', 'failover'])
  assert.match(outcome.failures.at(-1)?.reason ?? '', /session_id/)
})

test('假死上游：首块超时 → 504 first_block_timeout → 换到 B 成功', async () => {
  SCRIPTS.a = (model, out) => SCRIPTS.silent(model, out)
  SCRIPTS.b = (model, out) => SCRIPTS.ok(model, out)

  const outcome = await requestForwarder.forwardAutoCompletion(
    makeRequest('req-fi-silent'),
    [candidate(MODEL_A), candidate(MODEL_B)],
    makeContext('req-fi-silent'),
    { baseCap: 3 },
  )

  assert.ok(outcome)
  assert.equal(outcome.result.success, true)
  assert.deepEqual(seenModels, [MODEL_A, MODEL_B])
  const aTrace = outcome.attemptTrace.find(t => t.model === MODEL_A)!
  assert.equal(aTrace.status, 504)
  assert.equal(aTrace.errorCode, 'first_block_timeout')
  assert.equal(aTrace.outcome, 'failover')
})

test('首块后断流：流已交付，绝不换家——B 未被派发', async () => {
  // A 正常给出首块（probe 通过、判成功、pipe 接管），在 probe 窗口（200ms）
  // 之后断流——太早会撞进 probe 窗口被当成建流失败参与换家，那不是这条边界。
  SCRIPTS.a = (model, out) => {
    out.write(contentChunk(model, 'first-token'))
    setTimeout(() => out.destroy(new Error('connection reset')), 400)
  }
  SCRIPTS.b = (model, out) => SCRIPTS.ok(model, out)

  const outcome = await requestForwarder.forwardAutoCompletion(
    makeRequest('req-fi-midstream'),
    [candidate(MODEL_A), candidate(MODEL_B)],
    makeContext('req-fi-midstream'),
    { baseCap: 3 },
  )

  // 换家循环看到的仍是 success（首块已交付），outcome 只带最后赢家 A。
  assert.ok(outcome)
  assert.equal(outcome.result.success, true)
  assert.equal(outcome.candidate.actualModel, MODEL_A)
  assert.deepEqual(seenModels, [MODEL_A], '首块交付后任何失败都不得再派发下一家')

  // 断流错误必须在交付流上浮现（error 事件），让路由层写流内错误帧。
  const stream = outcome.result.stream!
  const error = await new Promise<Error | null>(resolve => {
    stream.once('error', e => resolve(e as Error))
    setTimeout(() => resolve(null), 1000)
  })
  assert.ok(error, '断流错误必须出现在交付流上（路由层据此写错误帧 + [DONE]）')
  assert.match(error.message, /connection reset/)
})

test('流中错误帧：过首块之后到达的错误帧在 skipTransform 管道上原样透传', async () => {
  // skipTransform: true —— SSE 形状由渠道包保证，forwarder 的桥流不做错误帧
  // 到异常的转换；错误化发生在 chat 路由的下游 transform（stream-error-frame
  // 测试已钉那一层）。本用例钉的是管道层：错误帧字节活着到达交付流，B 未被派发。
  SCRIPTS.a = (model, out) => {
    out.write(contentChunk(model, 'first'))
    out.write(sse({
      id: 'x', object: 'chat.completion.chunk', created: 1, model, choices: [],
      error: { message: 'midstream failure', type: 'server_error', code: 'HTTP_500', status: 500 },
    }))
    out.end(doneFrame())
  }
  SCRIPTS.b = (model, out) => SCRIPTS.ok(model, out)

  const outcome = await requestForwarder.forwardAutoCompletion(
    makeRequest('req-fi-midframe'),
    [candidate(MODEL_A), candidate(MODEL_B)],
    makeContext('req-fi-midframe'),
    { baseCap: 3 },
  )

  assert.ok(outcome)
  assert.equal(outcome.result.success, true)
  assert.equal(outcome.result.skipTransform, true)
  assert.deepEqual(seenModels, [MODEL_A])
  const text = await new Promise<string>(resolve => {
    let acc = ''
    outcome.result.stream!.on('data', (c: Buffer) => { acc += c.toString() })
    outcome.result.stream!.on('end', () => resolve(acc))
    outcome.result.stream!.on('error', () => resolve(acc))
    setTimeout(() => resolve(acc), 1000)
  })
  assert.match(text, /midstream failure/, '错误帧字节必须活着到达交付流')
  assert.match(text, /\[DONE\]/, '上游的 [DONE] 原样透传')
})
