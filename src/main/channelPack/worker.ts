/**
 * 账号渠道 Worker 宿主。
 *
 * 只实现 channel-pack 需要的平台契约，业务（登录、凭据刷新、模型目录、上游协议）
 * 全部由 vendor 源码提供，不在这里复制任何渠道逻辑：
 * - `credentials` 通过消息转给主线程，由 safeStorage 落盘，worker 内不接触明文文件；
 * - `llm` 把 pack 注册的适配器聚合成 `models()` / `complete()`；
 * - OpenAI 响应直接复用 pack 的投影（`toOpenAiSse` / `collectOpenAiCompletion`），
 *   避免我们在宿主演一套、上游演一套导致流形状漂移。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { apply } from 'virtual:channel-pack'
import { markGatewayChannel } from 'virtual:channel-pack-gateway'
import {
  collectGatewayModelDetails,
  collectGatewayModels,
  toOpenAiModels,
} from 'virtual:channel-pack-models'
import {
  normalizeMaxTokens,
  normalizeReasoningEffort,
  toGenerateOptions,
} from 'virtual:channel-pack-messages'
import { collectOpenAiCompletion, toOpenAiSse } from 'virtual:channel-pack-stream'
import { assertValidToolCalls, countToolCallShapes } from './toolCallValidation'
import { ReasoningReplay, reasoningReplayEnabled } from './reasoningReplay'
import { appendOutboundDump, resolveDumpTarget, summarizeOutbound } from './outboundDump'

type Adapter = {
  prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{ stream: (options: unknown) => AsyncIterable<unknown> }>
  listModels(provider: string): Promise<unknown>
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<unknown>
}

type CompleteRequest = {
  requestId: string
  model: string
  stream: boolean
  openAi: Record<string, unknown>
}

const dataDir = String(workerData.dataDir)
const attachmentDir = join(dataDir, 'attachments')

/**
 * 宿主机代理配置文件（`scripts/wsl-host-proxy.mjs` 写的那个）跟着数据目录走：
 * daemon 是 `/root/.modelport/host-proxy.json`，Electron 是 `<userData>/host-proxy.json`。
 * 环境变量显式给了就按给出的（`off` 表示关闭；脚本也可以直接写这个路径）。
 */
if (!process.env.MODELPORT_HOST_PROXY_FILE) {
  process.env.MODELPORT_HOST_PROXY_FILE = join(dataDir, 'host-proxy.json')
}

const send = (message: Record<string, unknown>): void => {
  parentPort?.postMessage(message)
}

const cleanups: Array<() => unknown> = []
const adapters = new Map<string, Adapter>()
const services = new Map<string, unknown>()
const routes = new Map<string, { path: string; fetch: (request: Request) => Promise<Response> }>()
const controllers = new Map<string, AbortController>()
let closed = false

/* ------------------------------------------------------------------ 凭据桥 */

let credentialSequence = 0
const credentialPending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

function credentialCall(op: string, args: Record<string, unknown>): Promise<unknown> {
  const id = `cred-${++credentialSequence}`
  return new Promise((resolve, reject) => {
    credentialPending.set(id, { resolve, reject })
    send({ type: 'credential', id, op, args })
  })
}

const credentials = {
  resolve: (ref: unknown) => credentialCall('resolve', { ref }),
  describe: (ref: unknown) => credentialCall('describe', { ref }),
  set: (ref: unknown, value: unknown) => credentialCall('set', { ref, value }),
  unset: (ref: unknown) => credentialCall('unset', { ref }),
}

function disposeCredentials(): void {
  for (const entry of credentialPending.values()) entry.reject(new Error('渠道已停止'))
  credentialPending.clear()
}

/* ------------------------------------------------------------------ 附件 */

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const attachments = {
  async saveImage(input: { data: Uint8Array; mediaType: string }) {
    await mkdir(attachmentDir, { recursive: true })
    const id = randomUUID()
    const path = join(attachmentDir, `${id}.${IMAGE_EXT[input.mediaType] ?? 'bin'}`)
    await writeFile(path, input.data)
    return { id, mediaType: input.mediaType, path }
  },
  async readImage(ref: unknown) {
    const descriptor = ref as { path?: string; mediaType?: string }
    if (typeof descriptor?.path !== 'string') throw new Error('图片引用无效')
    return {
      data: new Uint8Array(await readFile(descriptor.path)),
      ref: { mediaType: descriptor.mediaType ?? 'application/octet-stream' },
    }
  },
  async readImageRequest(ref: unknown) {
    return attachments.readImage(ref)
  },
  imageLimits: {
    maxImageBytes: 20 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 200 * 1024 * 1024,
    maxImageDimension: 8192,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
}

/* ------------------------------------------------------------------ 平台 */

const logger = {
  info: (message: unknown) => send({ type: 'log', level: 'info', message: String(message) }),
  warn: (message: unknown) => send({ type: 'log', level: 'warn', message: String(message) }),
  error: (message: unknown) => send({ type: 'log', level: 'error', message: String(message) }),
}

/**
 * 出站请求体取证开关（默认关闭）。开法与取值见 `outboundDump.ts` 头注释：
 * `MODELPORT_CHANNEL_PACK_DUMP=1` 写 `<dataDir>/channel-pack/outbound-dump.ndjson`，
 * 给别的值就按那个路径写。只落摘要（role / 长度 / 末尾片段 / 工具坐标），不落正文。
 */
const outboundDumpPath = resolveDumpTarget(process.env.MODELPORT_CHANNEL_PACK_DUMP, dataDir)

/**
 * TRAE 原始用量帧取证开关（默认关闭），约定同上，落 `trae-usage-dump.ndjson`。
 * vendor 侧（trae-usage-dump.ts）只认路径，标志值 → 路径的解析在这里做完后
 * 写回 worker 的 env —— vendor 代码在请求时读到的就是具体路径。
 */
const traeUsageDumpPath = resolveDumpTarget(process.env.MODELPORT_TRAE_USAGE_DUMP, dataDir, 'trae-usage-dump.ndjson')
if (traeUsageDumpPath !== null) process.env.MODELPORT_TRAE_USAGE_DUMP = traeUsageDumpPath

/**
 * 跨请求的思考回放缓存（按 `tool_call.id`、有界）。
 *
 * ⚠️ 必须是**进程级单例**：一次请求发出的思考要在**下一次**请求里补回去，所以
 * 不能按请求重建。容量上限见 `REPLAY_MAX_IDS`（默认 4096 个 id）。
 *
 * 可用 `DSH_REASONING_REPLAY=0` 关闭（见 {@link reasoningReplayEnabled}）。
 */
const reasoningReplay = new ReasoningReplay()
const reasoningReplayOn = reasoningReplayEnabled()

/** 渠道包看到的 `ctx.llm`（形状由 `openai-gateway/models.ts` 的采集器决定）。 */
interface LlmRuntime {
  registerAdapter(providers: readonly string[], adapter: Adapter): void
  listProviders(): Array<{ id: string }>
  listModels(provider: string): Promise<Array<{ id: string }>>
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<unknown>
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<unknown>
  stream(options: unknown): AsyncIterable<unknown>
}

const ctx: Record<string, unknown> & { llm: LlmRuntime } = {
  platform: { channelHome: dataDir },
  credentials,
  logger,
  attachments,
  connection: {
    fetch: {
      register(route: { path: string; fetch: (request: Request) => Promise<Response> }) {
        routes.set(route.path, route)
      },
    },
  },
  llm: {
    registerAdapter(providers: readonly string[], adapter: Adapter) {
      for (const provider of providers) adapters.set(provider, adapter)
    },
    listProviders: () => [...adapters.keys()].map(id => ({ id })),
    listModels: async (provider: string): Promise<Array<{ id: string }>> => {
      const adapter = adapters.get(provider)
      if (!adapter) return []
      const models = await adapter.listModels(provider)
      return Array.isArray(models) ? models as Array<{ id: string }> : []
    },
    resolveModel: async (provider: string, model: string, signal?: AbortSignal) => {
      const adapter = adapters.get(provider)
      if (!adapter) throw Object.assign(new Error('渠道不存在'), { status: 404 })
      return adapter.resolveModel(provider, model, signal)
    },
    resolveModelInfo: async (provider: string, model: string, signal?: AbortSignal) => {
      const adapter = adapters.get(provider)
      if (!adapter) return undefined
      return adapter.resolveModel(provider, model, signal)
    },
    stream: async function* (options: { provider: string; model: string; signal?: AbortSignal }) {
      const adapter = adapters.get(options.provider)
      if (!adapter) throw Object.assign(new Error('渠道不存在'), { status: 404 })
      const call = await adapter.prepareCall(options.provider, options.model, options.signal)
      yield* call.stream(options)
    },
  },
  get(name: string) {
    return services.get(name) ?? ctx[name]
  },
  provide(name: string, value: unknown) {
    if (services.has(name)) throw new Error(`服务重复注册：${name}`)
    services.set(name, value)
  },
  effect(body: () => unknown) {
    const cleanup = body()
    if (typeof cleanup === 'function') {
      if (closed) void (cleanup as () => void)()
      else cleanups.push(cleanup as () => void)
    }
    return cleanup
  },
  inject(names: readonly string[], body: (platform: unknown) => unknown) {
    return names.every(name => ctx[name] !== undefined) ? body(ctx) : undefined
  },
  emit() {
    send({ type: 'changed' })
  },
}

/* ------------------------------------------------------------------ 操作 */

async function models(): Promise<Array<Record<string, unknown>>> {
  const onError = (provider: string, error: unknown) =>
    logger.warn(`${provider} 模型目录读取失败：${error instanceof Error ? error.message : String(error)}`)
  const groups = await collectGatewayModels(ctx.llm, onError)
  // ⚠️ 窗口只能在 `resolveModelInfo` 里拿到（`listModels` 不带它），此前这里只取
  // 档位，于是 `/v1/models` 的 `context_window` 一次都没发出去。实测：宿主侧
  // 12 个渠道全部 0/N，而客户端（DSH/Codex）拿不到窗口就退回自己的默认值决定压缩。
  const details = await collectGatewayModelDetails(ctx.llm, groups, onError)
  return toOpenAiModels(groups, details)
}

async function rpc(call: unknown, signal: AbortSignal): Promise<unknown> {
  const route = routes.get('/api/channel-pack')
  if (!route) throw new Error('渠道管理接口未注册')
  const response = await route.fetch(new Request('http://localhost/api/channel-pack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'modelport', method: 'channel-pack', payload: call }),
    signal,
  }))
  const reply = await response.json() as { result?: unknown }
  return reply.result
}

async function complete(request: CompleteRequest, jobId: string, signal: AbortSignal): Promise<void> {
  const body = { ...request.openAi, model: request.model } as Record<string, unknown>
  const slash = request.model.indexOf('/')
  if (slash <= 0) throw Object.assign(new Error(`模型 ID 无效：${request.model}`), { status: 400 })
  const provider = request.model.slice(0, slash)
  const model = request.model.slice(slash + 1)

  // 停用的模型必须同时影响 API，而不只是从列表里消失。
  const listed = await ctx.llm.listModels(provider) as Array<{ id?: string }>
  if (!listed.some(entry => entry.id === model)) {
    throw Object.assign(new Error('模型不存在或已停用'), { status: 404 })
  }

  const info = await ctx.llm.resolveModel(provider, model, signal)
  const effort = normalizeReasoningEffort(body.reasoning_effort, info, provider, model, notice => {
    logger.info(`${request.model} 思考档位：${JSON.stringify(notice)}`)
  })
  const requestedMax = body.max_completion_tokens ?? body.max_tokens
  const maxTokens = typeof requestedMax === 'number' ? normalizeMaxTokens(requestedMax, provider, model) : undefined

  // ── 补回客户端丢弃的思考 ──────────────────────────────────────────
  // DeepSeek 系上游要求「带 tool_calls 的 assistant 轮 reasoning_content 成对回传」，
  // 而实测客户端 92% 不回传（trae/deepseek 274 轮缺 253 轮），后果是整段对话被判
  // `invalid function call`。我们手里有那份思考（是本进程自己发出去的），按
  // `tool_call.id` 补回去 —— 详见 `reasoningReplay.ts`。客户端已带回的一字节不动。
  const recovered = reasoningReplayOn
    ? reasoningReplay.recover(body.messages)
    : { messages: body.messages, injected: 0 }
  if (recovered.injected > 0) {
    body.messages = recovered.messages
    logger.info(`${request.model} 补回 reasoning_content：${recovered.injected} 轮客户端未回传`)
  }

  // 先按网关的同一套判据校验入站 tool_calls：网关那句「invalid function call」
  // 不带坐标，客户端无从知道是哪条消息、哪个调用、哪个字段不对。
  assertValidToolCalls(body.messages)
  // 影子诊断（纯观测，不影响校验）：只记"规范合法但上游可能不认"的形状计数。
  // 不记任何内容 —— 真实请求体 1.8MB，落盘只保留开头 2%，而 tool_calls 在尾部，
  // 所以想从请求体日志取证这条路结构性地走不通（详见 countToolCallShapes 注释）。
  const shapes = countToolCallShapes(body.messages)
  if (shapes.assistantWithCalls > 0) {
    logger.info(
      `${request.model} 历史形状：带 tool_calls 的 assistant 轮 ${shapes.assistantWithCalls}，`
      + `缺 reasoning_content ${shapes.missingReasoning}，空串参数 ${shapes.emptyArguments}，`
      + `带前缀工具名 ${shapes.prefixedName}`,
    )
  }
  // 不钉 `sessionId`：各适配器按自己的口径派生（Gemini 按首条 user 文本，
  // 钉住一个固定值会把全部会话并成一个服务端会话，并在累计超限后无法升代自愈）。
  const options = await toGenerateOptions(body, signal, effort, maxTokens, { bridge: attachments })

  // 取证开关打开时，把「交给适配器的两段形状」（宿主收到的 OpenAI messages 与
  // 转换后的 harness messages）落一行摘要 —— 排查「尾巴消息到底有没有出站」
  // 只能在这里取证，请求日志的截断把尾部证据结构性地切掉了。
  if (outboundDumpPath !== null) {
    appendOutboundDump(
      outboundDumpPath,
      summarizeOutbound({
        ts: Date.now(),
        requestId: request.requestId,
        model: request.model,
        stream: request.stream,
        openAiMessages: Array.isArray(body.messages) ? body.messages as unknown[] : [],
        harnessMessages: Array.isArray(options.messages) ? options.messages as unknown[] : [],
      }),
      message => logger.warn(message),
    )
  }

  const stream = ctx.llm.stream(markGatewayChannel(options))
  // 观测**我们下行发出的**思考（两种上游形态在这里已合并成 reasoning_content）。
  reasoningReplay.begin()
  try {
    if (request.stream) {
      for await (const chunk of toOpenAiSse(stream, request.requestId, request.model)) {
        if (reasoningReplayOn) reasoningReplay.observeSseChunk(chunk)
        send({ type: 'sse', id: jobId, text: chunk })
      }
      return
    }
    const completion = await collectOpenAiCompletion(stream, request.requestId, request.model)
    if (reasoningReplayOn) reasoningReplay.observeCompletion(completion)
    send({ type: 'completion', id: jobId, value: completion })
  } finally {
    // 无论成功、失败还是被取消都要收尾：失败时也把已产出的思考提交（下一轮同样要补）。
    if (reasoningReplayOn) reasoningReplay.commit()
  }
}

/* ------------------------------------------------------------------ 消息 */

parentPort?.on('message', async (message: Record<string, any>) => {
  if (message.type === 'credential-result') {
    const pending = credentialPending.get(message.id)
    if (!pending) return
    credentialPending.delete(message.id)
    if (message.ok) pending.resolve(message.value)
    else pending.reject(new Error(message.error ?? '凭据操作失败'))
    return
  }
  if (message.type === 'cancel') {
    controllers.get(message.id)?.abort()
    return
  }
  if (message.type === 'close') {
    closed = true
    for (const controller of controllers.values()) controller.abort()
    disposeCredentials()
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup() } catch { /* 停机阶段不再报错 */ }
    }
    send({ type: 'closed' })
    return
  }

  const id = String(message.id)
  const controller = new AbortController()
  controllers.set(id, controller)
  try {
    if (closed) throw new Error('渠道已停止')
    if (message.type === 'models') send({ type: 'result', id, value: await models() })
    else if (message.type === 'rpc') send({ type: 'result', id, value: await rpc(message.call, controller.signal) })
    else if (message.type === 'complete') {
      await complete(message.request, id, controller.signal)
      // 流式路径没有返回值，必须显式通知宿主「这一笔结束了」，
      // 否则宿主无法知道何时可以关闭响应流。
      send({ type: 'done', id })
    } else throw new Error('未知渠道操作')
  } catch (error) {
    // `code` 与 `providerRetryAfterMs` 是渠道包唯一两个机读事实（QUOTA_EXCEEDED /
    // RATE_LIMIT / AUTH…、上游真实解禁时刻），旧实现只搬 message/status，宿主就只能
    // 拿中文散文去猜，客户端也收不到「换一条」的结构化信号。
    const failure = error as {
      message?: string
      status?: number
      code?: string
      providerRetryAfterMs?: number
      failure?: { status?: number; code?: string; providerRetryAfterMs?: number }
    }
    send({
      type: 'error',
      id,
      message: failure.message ?? '渠道请求失败',
      status: failure.status ?? failure.failure?.status,
      code: failure.code ?? failure.failure?.code,
      providerRetryAfterMs: failure.providerRetryAfterMs ?? failure.failure?.providerRetryAfterMs,
    })
  } finally {
    controllers.delete(id)
  }
})

apply(ctx)
if (outboundDumpPath !== null) {
  // 显式声明开关生效，避免「以为开了其实没开」——路径也打出来，直接照着取文件。
  logger.info(`渠道包出站取证已开启：每次请求写一行摘要到 ${outboundDumpPath}`)
}
if (traeUsageDumpPath !== null) {
  logger.info(`TRAE 用量取证已开启：每轮 SOLO 原始 token_usage 帧写一行到 ${traeUsageDumpPath}`)
}
send({ type: 'ready', providers: [...adapters.keys()] })
