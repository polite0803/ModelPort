import { randomUUID } from 'node:crypto'
import type { FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { OpenAiGatewayError } from './messages.js'
import { normalizeUpstreamFailure, upstreamStatusOrFallback } from './model-errors.js'
import { toOpenAiUsage } from './usage.js'

/**
 * 失败后给出纠错建议的钩子。
 *
 * 只在**出错时**被调用（正常路径零开销），故可以放心在这里去查模型目录。
 * 流式与非流式共用同一个钩子，保证两条路径给出的建议完全一致。
 */
export type SuggestionHook = (message: string) => string | undefined | Promise<string | undefined>

/**
 * 把「你可能是想用 X」拼到错误消息后面。
 *
 * ⚠️ 导出给 `responses.ts` 复用：两个端点的纠错建议必须逐字一致，
 * 否则同一次误填在两个 URL 上会得到不同的提示。
 */
export async function withSuggestion(message: string, suggest: SuggestionHook | undefined): Promise<string> {
  if (suggest === undefined) return message
  try {
    const hint = await suggest(message)
    return typeof hint === 'string' && hint.length > 0 ? `${message}（${hint}）` : message
  } catch {
    // 建议只是锦上添花，取目录失败绝不能盖掉真正的错误消息。
    return message
  }
}

interface ToolState {
  id: string
  name?: string
  arguments: string
  /**
   * 客户端侧的 `tool_calls[].index`（**按首次出现顺序的密集序号** 0,1,2…）。
   *
   * 与 DSH 的内部块 index（`chunk.index`）**必须解耦**：内部 index 是
   * reasoning / text / tool-call 各类块**共用**一个计数器（openai-compat 的
   * `nextIndex++`、minimax 的 Anthropic content_block index 同理）。2026-10-31
   * 用户报障（本机 Qoder CN，`mcp_list` + `{}` 合法输入被拦）：「思考块(0) +
   * 工具块(1)」的响应把 `tool_calls` 以 `index:1` 凭空下发（没有 0），
   * Qoder 的 StreamAdapter 严格校验 wire 索引，直接判
   * `MALFORMED_TOOL_CALL_STREAM: incomplete_tool_replaced` 把整个 turn 打死
   * （用户看到 "Request cancelled during pre-tool-use hook"）。OpenAI 规范里
   * `index` 是工具调用在 tool_calls 数组里的**位置**，与内容块序号无关 ——
   * 投影边界必须重编号。
   */
  wireIndex: number
  /**
   * `id`/`type` 是否已随首分片下发给客户端。
   *
   * OpenAI 流式规范：tool_calls 分片的 `id`/`type`/`name` 只随**首个**分片
   * 出现，后续分片只带 `index` + `function.arguments` 增量。2026-10-31 用户
   * 报障（第七轮，本机 Qoder CN 02:59:45 `incomplete_tool_replaced,
   * wireIndex:0, existingInternal:1`）：投影此前给**每个**分片都重复携带完整
   * id+name，Qoder 的 StreamAdapter 把「带 id 的分片」当成一次**新工具调用
   * 宣告** —— 第二个宣告到达时替换掉还在累积参数的第一个，整个 turn 被判
   * 畸形报废。宽容客户端（Trae CN）按 id 去重所以从不报错。
   */
  announced: boolean
  /** `name` 是否已下发（上游可能把 name 放在 id 之后的分片里，需补发一次）。 */
  nameAnnounced: boolean
}

interface Accumulated {
  content: string
  reasoning: string
  tools: Map<number, ToolState>
  usage?: TokenUsage
  finishReason?: string
}

function finishReason(reason: FinishReason): string {
  switch (reason.kind) {
    case 'stop': return 'stop'
    case 'tool-calls': return 'tool_calls'
    case 'max-tokens': return 'length'
    case 'aborted': return 'error'
    case 'error': return 'error'
  }
}

/**
 * DSH 的用量 → OpenAI Chat Completions 的 `usage`。
 *
 * ⚠️ 口径转换全部在 `usage.ts` 里（两个端点共用一份判断，见该文件头）。
 * 这里只负责**改字段名**：`inputTokens`（已含缓存）→ `prompt_tokens`。
 */
function usageJson(usage: TokenUsage): Record<string, unknown> {
  const normalized = toOpenAiUsage(usage)
  return {
    prompt_tokens: normalized.inputTokens,
    completion_tokens: normalized.outputTokens,
    total_tokens: normalized.totalTokens,
    // 官方明细：`cached_tokens` 是 `prompt_tokens` 的**子集**（见 `usage.ts`）。
    // ⚠️ 上游没报就整个对象不发：发 `{cached_tokens: 0}` 会被宿主读成
    // 「报了且零命中」，把 TRAE 这类从不报缓存的渠道伪造成 0% 命中率。
    ...normalized.cacheReported
      ? { prompt_tokens_details: { cached_tokens: normalized.cachedTokens } }
      : {},
    ...normalized.reasoningTokens === undefined
      ? {}
      : {
          reasoning_tokens: normalized.reasoningTokens,
          completion_tokens_details: { reasoning_tokens: normalized.reasoningTokens },
        },
    // 私有兼容字段（见上方注释）：只在真有缓存命中时才发，避免凭空多出 0。
    ...normalized.cachedTokens > 0 ? { prompt_cache_hit_tokens: normalized.cachedTokens } : {},
  }
}

function line(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`
}

function baseChunk(id: string, model: string, delta: Record<string, unknown>, finish?: string, created?: number): Record<string, unknown> {
  return {
    id,
    object: 'chat.completion.chunk',
    // created 由调用方冻结传入（OpenAI 全流共享同一个值）；缺省兜底现取，
    // 仅供非流式辅助路径使用。
    created: created ?? Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  }
}

function failureMessage(reason: Extract<FinishReason, { kind: 'error' | 'aborted' }>): string {
  return reason.failure.message || `DSH model request ${reason.kind}`
}

function consumeChunk(state: Accumulated, chunk: StreamChunk): Record<string, unknown> | undefined {
  switch (chunk.type) {
    case 'text-delta':
      state.content += chunk.text
      return { delta: { content: chunk.text } }
    case 'reasoning-delta':
      state.reasoning += chunk.text
      return { delta: { reasoning_content: chunk.text } }
    case 'tool-call-delta': {
      // 同 id 合并兜底（2026-10-31 Qoder invalid_tool_call_id）：个别上游会把
      // 同一个调用的分片打在多个内部块 index 上（openai-compat 已在适配器侧
      // 合并，这里兜住其余 Anthropic 形状适配器的同类形态）。同 id 只能是同一
      // 次调用 —— tool 结果按 id 配对，复用 id 的「并行调用」本就配不了对。
      const incomingId = String(chunk.id || '')
      let tool = (incomingId.length > 0
        ? [...state.tools.values()].find(existing => existing.id === incomingId)
        : undefined) ?? state.tools.get(chunk.index)
      if (!tool) {
        tool = { id: incomingId, arguments: '', wireIndex: state.tools.size, announced: false, nameAnnounced: false }
        state.tools.set(chunk.index, tool)
      }
      if (incomingId.length > 0) tool.id = incomingId
      if (chunk.name !== undefined) tool.name = chunk.name
      tool.arguments += chunk.argumentsDelta
      // 首分片宣告：id/type 只随第一个分片下发，name 随第一个已知 name 的分片
      // 下发（上游可能把 name 放在 id 之后的分片里）。后续分片只带 index +
      // arguments 增量 —— 重复 id 会被严格客户端（Qoder StreamAdapter）当成
      // 新宣告，替换掉还在累积参数的调用（见 ToolState.announced 注释）。
      const first = !tool.announced && tool.id.length > 0
      if (first) tool.announced = true
      const withName = tool.name !== undefined && !tool.nameAnnounced
      if (withName) tool.nameAnnounced = true
      return {
        delta: {
          tool_calls: [{
            // 密集重编号（见 ToolState.wireIndex 注释）：内部块 index 与思考/文本
            // 块共用计数器，直接透传会出现「单工具调用却 index:1」的规范外形状。
            index: tool.wireIndex,
            ...first ? { id: tool.id, type: 'function' as const } : {},
            function: {
              ...withName ? { name: tool.name } : {},
              arguments: chunk.argumentsDelta,
            },
          }],
        },
      }
    }
    case 'usage':
      state.usage = chunk.usage
      return undefined
    case 'finish':
      if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
        // ⚠️ 把上游自带的状态码一并带出来（`LlmError` 把它放在 `failure.status`）：
        // 少了它，下游只能退化成 502，模型名写错这种确定性失败会被客户端白重试。
        return {
          error: {
            message: failureMessage(chunk.reason),
            type: 'server_error',
            code: chunk.reason.failure.code,
            status: chunk.reason.failure.status,
          },
        }
      }
      state.finishReason = finishReason(chunk.reason)
      return { delta: {}, finish_reason: state.finishReason }
    case 'block-start':
    case 'block-end':
      return undefined
  }
}

export async function* toOpenAiSse(
  chunks: AsyncIterable<StreamChunk>,
  requestId = `chatcmpl-${randomUUID()}`,
  model: string,
  suggest?: SuggestionHook,
): AsyncIterable<string> {
  const state: Accumulated = { content: '', reasoning: '', tools: new Map() }
  // OpenAI 全流共享同一个 created（2026-10-31 审计项：每帧现取会跨秒不一致）。
  const created = Math.floor(Date.now() / 1000)
  // OpenAI 惯例首块 `delta:{role:"assistant",content:""}`（2026-10-31 审计项）：
  // 官方流永远以它开场，严格客户端可能以此定位会话角色。惰性下发 —— 错误帧
  // （choices:[]）与 usage 帧不需要它，首个内容/finish 帧之前发一次即可。
  let roleAnnounced = false
  try {
    for await (const chunk of chunks) {
      const event = consumeChunk(state, chunk)
      if (event === undefined) continue
      if ('error' in event) {
        const error = event.error as { message?: unknown; type?: unknown; code?: unknown; status?: unknown }
        const message = typeof error.message === 'string' ? error.message : 'upstream error'
        // 上游「模型不存在」以 502 离开网关时会被客户端当成可重试故障重试，
        // 但它是确定性失败 —— 翻成 404 让客户端提示用户改配置。
        const normalized = normalizeUpstreamFailure({
          // 上游自带状态码（如 gemini 拒绝未知模型名时的 404）优先，否则才退化成 502。

          // 原样透出会让「额度用尽」在客户端眼里读成成功。另两处出口已有同一门禁。
          status: upstreamStatusOrFallback(error.status),
          type: typeof error.type === 'string' ? error.type : 'server_error',
          code: typeof error.code === 'string' ? error.code : 'upstream_error',
          message,
        })
        yield line({
          id: requestId,
          object: 'chat.completion.chunk',
          model,
          choices: [],
          error: {
            message: await withSuggestion(message, suggest),
            type: normalized.type,
            code: normalized.code,
            // 流已发出 200，状态码改不了；把该有的 404 放进 status 字段供客户端读。
            status: normalized.status,
          },
        })
        yield 'data: [DONE]\n\n'
        return
      }
      // Role 首块：惰性发一次（首个内容/finish 帧之前）。
      if (!roleAnnounced) {
        roleAnnounced = true
        yield line(baseChunk(requestId, model, { role: 'assistant', content: '' }, undefined, created))
      }
      if ('finish_reason' in event) {
        yield line(baseChunk(requestId, model, event.delta as Record<string, unknown>, event.finish_reason as string, created))
      } else {
        yield line(baseChunk(requestId, model, event.delta as Record<string, unknown>, undefined, created))
      }
    }
    if (state.finishReason === undefined) {
      yield line({ id: requestId, object: 'chat.completion.chunk', created, model, choices: [], error: { message: 'upstream stream ended before finish', type: 'server_error', code: 'incomplete_stream' } })
      yield 'data: [DONE]\n\n'
      return
    }
    if (state.usage !== undefined) {
      yield line({ id: requestId, object: 'chat.completion.chunk', created, model, choices: [], usage: usageJson(state.usage) })
    }
    yield 'data: [DONE]\n\n'
  } catch (error) {
    const converted = failureToOpenAiError(error)
    // ⚠️ `status` 必须进帧，与上面流内错误帧同一口径：建流阶段的失败也只能以
    // HTTP 200 的 SSE 帧浮现，而宿主换家循环读的就是这个数。丢掉它，上游的
    // 404「这一家供不了这个模型」就退化成 502 账号故障，白占路由的换家上限
    // （实测：cline 的 `:batch` 变体每条一发 404，三条撞满 `maxAttempts: 3`，
    // 整条链在第 7 家收手，后面一千多个候选一个没试到，客户端拿到 503）。
    yield line({
      id: requestId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [],
      error: { ...converted.body.error, status: converted.status },
    })
    yield 'data: [DONE]\n\n'
  }
}

export async function collectOpenAiCompletion(
  chunks: AsyncIterable<StreamChunk>,
  requestId = `chatcmpl-${randomUUID()}`,
  model: string,
  suggest?: SuggestionHook,
): Promise<Record<string, unknown>> {
  const state: Accumulated = { content: '', reasoning: '', tools: new Map() }
  try {
    for await (const chunk of chunks) {
      const event = consumeChunk(state, chunk)
      if (event?.error) {
        const detail = event.error as Record<string, unknown>
        throw new OpenAiGatewayError(
          String(detail.message),
          // 上游自带状态码优先（模型名不存在 = 404），否则才当可重试的服务端故障。
          upstreamStatusOrFallback(detail.status),
          'server_error',
          String(detail.code ?? 'upstream_error'),
        )
      }
    }
    if (state.finishReason === undefined) {
      throw new OpenAiGatewayError('upstream stream ended before finish', 502, 'server_error', 'incomplete_stream')
    }
  } catch (error) {
    const converted = failureToOpenAiError(error)
    const message = String(converted.body.error.message)
    // 同 toOpenAiSse：把上游「模型不存在」翻成 404，避免客户端把它当可重试故障。
    const normalized = normalizeUpstreamFailure({
      status: converted.status,
      type: String(converted.body.error.type),
      code: String(converted.body.error.code ?? 'upstream_error'),
      message,
    })
    throw new OpenAiGatewayError(await withSuggestion(message, suggest), normalized.status, normalized.type, normalized.code)
  }
  const toolCalls = [...state.tools.entries()].sort(([a], [b]) => a - b).map(([, tool]) => ({
    id: tool.id,
    type: 'function',
    function: { name: tool.name ?? '', arguments: tool.arguments },
  }))
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: state.content || null,
    ...state.reasoning.length === 0 ? {} : { reasoning_content: state.reasoning },
    ...toolCalls.length === 0 ? {} : { tool_calls: toolCalls },
  }
  return {
    id: requestId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: state.finishReason }],
    ...state.usage === undefined ? {} : { usage: usageJson(state.usage) },
  }
}

export function failureToOpenAiError(error: unknown): { status: number; body: { error: Record<string, unknown> } } {
  if (error instanceof OpenAiGatewayError) {
    return { status: error.status, body: { error: { message: error.message, type: error.type, code: error.code } } }
  }
  // ⚠️ `LlmError` 的 `status` **不是顶层属性**（实测 `'status' in e === false`），
  // 它只落在 `e.failure.status`（`@deepseek-ai/dsh-llm` 的 `LlmFailure`）。
  // 只读顶层等于没读 —— 上游声明的 404 会一路退化成 502 并被客户端反复重试。
  const value = error as
    | { code?: unknown; status?: unknown; failure?: { status?: unknown }; message?: unknown }
    | undefined
  const raw = typeof value?.status === 'number' ? value.status : value?.failure?.status
  const status = upstreamStatusOrFallback(raw)
  return {
    status,
    body: { error: {
      message: typeof value?.message === 'string' ? value.message : 'DSH model request failed',
      type: 'server_error',
      code: typeof value?.code === 'string' ? value.code : 'upstream_error',
    } },
  }
}
