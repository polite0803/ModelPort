/**
 * 入向 responses 翻译层：客户端说 OpenAI Responses API（`/v1/responses`），本应用说 chat。
 *
 * 方向与 `responsesWire.ts` 相反（那份是「本应用 → 只会 responses 的供应商」），做法与
 * `anthropicWire.ts` 相同：把客户端请求翻成 chat 请求体，回来再把 chat 响应翻回去，
 * 中间那条链（路由、换家、配额、日志）只有一份实现。
 *
 * 五条纪律（前四条与出向那四条同源，第五条是入向特有的）：
 *
 * 1. **`usage` 上游没报就是 `null`**，不补 0 —— 补 0 等于申报「这次没消耗」。
 * 2. **流里恰好一个结尾**：`response.completed` / `response.incomplete` / `response.failed`
 *    三选一。Responses 没有 `[DONE]`，客户端只认结尾事件。
 * 3. **失败不是正文**：上游错误帧翻成 `response.failed`（带 `error`），绝不写成 assistant 文本。
 * 4. **`refusal` 不进 `output_text`**：它是拒绝语，形状上就是另一种 content part。
 * 5. **做不到的语义点名拒绝**：本代理不保存 response，所以 `previous_response_id`、
 *    `background: true`、`input` 里的 `item_reference` 一律 400（见
 *    `responsesUnsupportedParams`）。静默接受会让客户端以为后面还取得回来。
 */

type Payload = Record<string, unknown>

function asRecord(value: unknown): Payload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Payload)
    : null
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** responses 的文本分片：`input_text` / `output_text` / `text` 三种叫法都见过。 */
function textOfParts(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => {
      const record = asRecord(part)
      if (!record) return ''
      const type = stringOf(record.type)
      if (type === 'input_text' || type === 'output_text' || type === 'text' || type === '') {
        return stringOf(record.text)
      }
      return ''
    })
    .join('')
}

export interface ResponsesToChatOptions {
  /** 交给 chat 那条链的模型名（名字怎么解析由调用方决定，这里只负责搬过去）。 */
  model: string
  stream: boolean
}

/**
 * responses 请求 → chat 请求体。
 *
 * `instructions` 落回 chat 的 system 消息（出向那一半反过来把它抬到顶层）；
 * `input` 里的 `function_call` 投影成 assistant 的 `tool_calls`，`function_call_output`
 * 投影成 `tool` 消息，且**顺序保持** —— 工具结果一旦与产生它的调用分离，上游会当成
 * 「没有对应调用的工具结果」直接拒。
 */
export function responsesToChatRequest(body: unknown, options: ResponsesToChatOptions): Payload {
  const source = asRecord(body) ?? {}
  const messages: Payload[] = []

  const instructions = instructionsText(source.instructions)
  if (instructions.trim() !== '') messages.push({ role: 'system', content: instructions })

  const input = source.input
  if (typeof input === 'string') {
    if (input !== '') messages.push({ role: 'user', content: input })
  } else if (Array.isArray(input)) {
    for (const raw of input) {
      const item = asRecord(raw)
      if (!item) continue
      const type = stringOf(item.type)

      if (type === 'function_call') {
        messages.push({
          role: 'assistant',
          // 只有调用时 content 必须是 null：给 '' 会让部分上游把这条算成空回复。
          content: null,
          tool_calls: [
            {
              id: stringOf(item.call_id),
              type: 'function',
              function: {
                name: stringOf(item.name),
                arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
              },
            },
          ],
        })
        continue
      }

      if (type === 'function_call_output') {
        messages.push({
          role: 'tool',
          tool_call_id: stringOf(item.call_id),
          content: textOfParts(item.output),
        })
        continue
      }

      // `reasoning` 项没有 chat 对应物（思维链不能当正文回灌）；`item_reference`
      // 需要 response 存储，那种请求在上面就被拒了，不会走到这里。
      if (type === 'reasoning') continue

      const role = stringOf(item.role)
      const normalizedRole =
        role === 'assistant' ? 'assistant'
          : role === 'system' || role === 'developer' ? 'system'
            : 'user'
      const content = item.content
      const text = textOfParts(content)

      if (normalizedRole === 'system') {
        if (text.trim() !== '') messages.push({ role: 'system', content: text })
        continue
      }

      const imageParts: Payload[] = []
      for (const rawPart of Array.isArray(content) ? content : []) {
        const record = asRecord(rawPart)
        if (!record || stringOf(record.type) !== 'input_image') continue
        const url = typeof record.image_url === 'string'
          ? record.image_url
          : stringOf(asRecord(record.image_url)?.url)
        if (url !== '') imageParts.push({ type: 'image_url', image_url: { url } })
      }

      if (text === '' && imageParts.length === 0) continue
      messages.push({
        role: normalizedRole,
        // 单段纯文本用字符串：老上游对数组形态的兼容性参差，有图片才必须用数组。
        content: imageParts.length > 0 ? [{ type: 'text', text }, ...imageParts] : text,
      })
    }
  }

  const request: Payload = { model: options.model, messages }
  if (options.stream) {
    request.stream = true
    // 流式必须主动要 usage：OpenAI 形状的上游默认不发最后一个 usage 块，不要就拿不到数。
    // 内建供应商会在 `parameterPolicy` 里把这格剥掉（它们不支持），那是既有裁定。
    request.stream_options = { include_usage: true }
  }

  if (typeof source.temperature === 'number') request.temperature = source.temperature
  if (typeof source.top_p === 'number') request.top_p = source.top_p
  const maxOutput = numberOrNull(source.max_output_tokens)
  if (maxOutput !== null) request.max_tokens = maxOutput
  const user = stringOf(source.user)
  if (user !== '') request.user = user
  // `prompt_cache_key` 两边同名，且**只有上游能用**：本代理不缓存任何东西，丢掉等于
  // 让客户端的 prompt caching 整段命中率归零，而它自己看不出为什么变慢。
  const cacheKey = stringOf(source.prompt_cache_key)
  if (cacheKey !== '') request.prompt_cache_key = cacheKey
  if (typeof source.parallel_tool_calls === 'boolean') request.parallel_tool_calls = source.parallel_tool_calls
  const stop = source.stop
  if (Array.isArray(stop) && stop.length > 0) request.stop = stop

  const tools = Array.isArray(source.tools) ? source.tools : []
  if (tools.length > 0) {
    request.tools = tools.map(tool => {
      const record = asRecord(tool) ?? {}
      // responses 把 function 的字段抬在 tool 自身，chat 要求嵌进 `function`。
      return {
        type: 'function',
        function: {
          name: stringOf(record.name),
          ...(stringOf(record.description) !== '' ? { description: stringOf(record.description) } : {}),
          ...(asRecord(record.parameters) ? { parameters: record.parameters } : {}),
        },
      }
    })
  }

  const toolChoice = responsesToolChoiceToChat(source.tool_choice)
  if (toolChoice !== undefined) request.tool_choice = toolChoice

  const responseFormat = responsesTextToResponseFormat(source.text)
  if (responseFormat !== undefined) request.response_format = responseFormat

  // `reasoning.effort` 在 chat 侧叫 `reasoning_effort`；`'auto'` 没有对应值，丢掉
  // 而不是猜一个档位 —— 猜了就等于替客户端决定推理深度。
  const effort = stringOf(asRecord(source.reasoning)?.effort)
  if (effort !== '' && effort !== 'auto') request.reasoning_effort = effort

  return request
}

/**
 * 客户端点名了本代理**结构上做不到**的参数。
 *
 * 只收这三类：它们都要求「网关记得上一次」，而这里没有任何 response 存储。其余
 * responses 专有的字段（`truncation`、`metadata`、`include`、`service_tier`）要么是可
 * tolerable 的装饰、要么本就有等价行为，不拒绝 —— 拒了会让每次固定发 `truncation`
 * 的客户端（Codex 就发）永远进不来。
 */
export function responsesUnsupportedParams(body: unknown): string[] {
  const source = asRecord(body) ?? {}
  const unsupported: string[] = []

  if (stringOf(source.previous_response_id).trim() !== '') unsupported.push('previous_response_id')
  if (source.conversation !== undefined && stringOf(source.conversation).trim() !== '') {
    unsupported.push('conversation')
  }
  if (source.background === true) unsupported.push('background')

  const input = Array.isArray(source.input) ? source.input : []
  if (input.some(raw => asRecord(raw)?.type === 'item_reference')) unsupported.push('input[].item_reference')

  return unsupported
}

/** `input` 有没有给出任何内容（只有 `instructions` 也算 —— 那是合法的「按系统提示生成」用法）。 */
export function responsesHasInput(body: unknown): boolean {
  const source = asRecord(body) ?? {}
  if (instructionsText(source.instructions).trim() !== '') return true

  const input = source.input
  if (typeof input === 'string') return input !== ''
  if (Array.isArray(input)) return input.length > 0
  return false
}

function instructionsText(value: unknown): string {
  return Array.isArray(value) ? textOfParts(value) : stringOf(value)
}

function responsesToolChoiceToChat(value: unknown): Payload | string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  const record = asRecord(value)
  if (!record) return undefined
  const name = stringOf(record.name)
  if (stringOf(record.type) === 'function' && name !== '') {
    return { type: 'function', function: { name } }
  }
  // 其余形态（`allowed_tools` 之类）chat 没有对应物：原样交出去，由上游决定。
  return record
}

function responsesTextToResponseFormat(value: unknown): Payload | undefined {
  const text = asRecord(value)
  if (!text) return undefined
  const format = text.format
  if (typeof format === 'string') return format === 'json_object' ? { type: 'json_object' } : { type: 'text' }

  const record = asRecord(format)
  if (!record) return undefined
  const type = stringOf(record.type)
  if (type === 'json_schema') {
    const schema = asRecord(record.schema)
    return {
      type: 'json_schema',
      json_schema: {
        ...(stringOf(record.name) !== '' ? { name: stringOf(record.name) } : {}),
        ...(schema ? { schema } : {}),
        ...(typeof record.strict === 'boolean' ? { strict: record.strict } : {}),
      },
    }
  }
  if (type === 'json_object') return { type: 'json_object' }
  if (type === 'text') return { type: 'text' }
  return undefined
}

function usageOfChat(usage: unknown): Payload | null {
  const record = asRecord(usage)
  if (!record) return null
  const input = numberOrNull(record.prompt_tokens)
  const output = numberOrNull(record.completion_tokens)
  if (input === null && output === null) return null

  const result: Payload = {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    total_tokens: (input ?? 0) + (output ?? 0),
  }
  const reasoning = numberOrNull(asRecord(record.completion_tokens_details)?.reasoning_tokens)
  if (reasoning !== null) result.output_tokens_details = { reasoning_tokens: reasoning }
  const cached = numberOrNull(asRecord(record.prompt_tokens_details)?.cached_tokens)
  if (cached !== null) result.input_tokens_details = { cached_tokens: cached }
  return result
}

/** chat 的 `finish_reason` → responses 的 `status` + `incomplete_details`。 */
function statusOf(finishReason: string): { status: 'completed' | 'incomplete'; incompleteReason?: string } {
  if (finishReason === 'length') return { status: 'incomplete', incompleteReason: 'max_output_tokens' }
  if (finishReason === 'content_filter') return { status: 'incomplete', incompleteReason: 'content_filter' }
  return { status: 'completed' }
}

export interface ChatToResponsesOptions {
  /** 回显客户端发来的模型名：它按这个名字做上下文预算，换成网关内部名字等于「模型被换了」。 */
  model: string
  /** 本路由的 request id，上游没给 id 时用它兜底。 */
  fallbackId: string
}

/**
 * chat completion → responses 的 `response` 对象。
 *
 * `output` 里 message 在前、function_call 在后：客户端按 `type` 分派，但把调用排在
 * 正文之前会让「先说一句再调用」的模型看起来像只调用了工具。
 */
export function chatResponseToResponseBody(payload: unknown, options: ChatToResponsesOptions): Payload {
  const source = asRecord(payload) ?? {}
  const choice = asRecord(Array.isArray(source.choices) ? source.choices[0] : null) ?? {}
  const message = asRecord(choice.message) ?? {}
  const createdAt = typeof source.created === 'number' ? source.created : Math.floor(Date.now() / 1000)
  const responseId = responsesIdOf(source.id, options.fallbackId)

  const refusal = stringOf(message.refusal)
  const text = typeof message.content === 'string' ? message.content : textOfParts(message.content)

  const output: Payload[] = []
  if (text !== '' || refusal !== '') {
    const content: Payload[] = []
    if (text !== '') content.push({ type: 'output_text', text, annotations: [] })
    if (refusal !== '') content.push({ type: 'refusal', refusal })
    output.push({
      id: `msg_${idTail(responseId, '')}`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content,
    })
  }

  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  calls.forEach((raw, position) => {
    const call = asRecord(raw)
    if (!call) return
    const fn = asRecord(call.function) ?? {}
    const callId = stringOf(call.id)
    output.push({
      id: callId !== '' ? `fc_${callId.replace(/^call_/, '')}` : `fc_${position}`,
      type: 'function_call',
      status: 'completed',
      call_id: callId,
      name: stringOf(fn.name),
      arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}',
    })
  })

  const { status, incompleteReason } = statusOf(stringOf(choice.finish_reason))
  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    error: null,
    incomplete_details: incompleteReason ? { reason: incompleteReason } : null,
    model: options.model,
    output,
    usage: usageOfChat(source.usage),
  }
}

function responsesIdOf(rawId: unknown, fallbackId: string): string {
  const id = stringOf(rawId)
  if (id === '') return `resp_${fallbackId}`
  return id.startsWith('resp_') ? id : `resp_${id.replace(/^chatcmpl-/, '')}`
}

/** `resp_<tail>` / `msg_<tail>` / `fc_<tail>` 是同一笔请求的三种 id，共用这一段尾巴。 */
function idTail(responseId: string, suffix: string): string {
  const tail = responseId.replace(/^resp_/, '')
  return suffix === '' ? tail : `${tail}_${suffix}`
}

export interface ResponsesStreamTranslator {
  /** 吃一段 chat SSE 文本（可跨块截断），吐出要写给客户端的 responses SSE 文本。 */
  push(chunk: string): string
  /** 上游结束时调用：补齐没发出的骨架与唯一的结尾事件。 */
  end(): string
  /**
   * 传输层异常时调用：只发一条 `response.failed`，**不再补 completed**。
   * 发过失败再发成功结尾，客户端会把这次失败读成一次短回答。
   */
  fail(message: string): string
}

interface OpenItem {
  kind: 'message' | 'function_call'
  itemId: string
  outputIndex: number
  /** chat 流里一次调用按 `index` 分片，同 index 必须落进同一个 responses 项。 */
  toolIndex: number
  partType?: 'output_text' | 'refusal'
  callId?: string
  name?: string
  text: string
}

/**
 * chat SSE 流 → responses SSE 流（有状态）。
 *
 * Responses 的流不是逐帧直译：一个内容项是一条 `output_item.added` → 若干 delta →
 * `output_item.done` 的配对骨架，`output_index` 单调递增，整条流最后必须落在唯一的
 * `response.completed` / `response.incomplete` 上。所以这里得自己记「当前打开的项」。
 */
export function createResponsesStreamTranslator(options: ChatToResponsesOptions): ResponsesStreamTranslator {
  let buffer = ''
  let sequence = 0
  let responseId = `resp_${options.fallbackId}`
  let createdAt = Math.floor(Date.now() / 1000)
  let created = false
  let terminal = false
  let nextOutputIndex = 0
  let open: OpenItem | null = null
  let finishReason: string | null = null
  const items: Payload[] = []
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let reasoningTokens: number | null = null
  let cachedTokens: number | null = null

  const event = (type: string, payload: Payload): string =>
    `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...payload })}\n\n`

  const usageSnapshot = (): Payload | null => {
    if (inputTokens === null && outputTokens === null) return null
    const usage: Payload = {
      input_tokens: inputTokens ?? 0,
      output_tokens: outputTokens ?? 0,
      total_tokens: (inputTokens ?? 0) + (outputTokens ?? 0),
    }
    if (reasoningTokens !== null) usage.output_tokens_details = { reasoning_tokens: reasoningTokens }
    if (cachedTokens !== null) usage.input_tokens_details = { cached_tokens: cachedTokens }
    return usage
  }

  const snapshot = (status: string, withOutput: boolean): Payload => ({
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    error: null,
    incomplete_details: null,
    model: options.model,
    output: withOutput ? items : [],
    usage: usageSnapshot(),
  })

  const contentOf = (item: OpenItem): Payload =>
    item.partType === 'refusal'
      ? { type: 'refusal', refusal: item.text }
      : { type: 'output_text', text: item.text, annotations: [] }

  const doneItemOf = (item: OpenItem): Payload =>
    item.kind === 'function_call'
      ? {
          id: item.itemId,
          type: 'function_call',
          status: 'completed',
          call_id: item.callId ?? '',
          name: item.name ?? '',
          arguments: item.text,
        }
      : {
          id: item.itemId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [contentOf(item)],
        }

  function closeItem(): string {
    const item = open
    if (item === null) return ''
    open = null
    const out: string[] = []

    if (item.kind === 'message') {
      const isText = item.partType !== 'refusal'
      out.push(event(isText ? 'response.output_text.done' : 'response.refusal.done', {
        item_id: item.itemId,
        output_index: item.outputIndex,
        content_index: 0,
        [isText ? 'text' : 'refusal']: item.text,
      }))
      out.push(event('response.content_part.done', {
        item_id: item.itemId,
        output_index: item.outputIndex,
        content_index: 0,
        part: contentOf(item),
      }))
    } else {
      out.push(event('response.function_call_arguments.done', {
        item_id: item.itemId,
        output_index: item.outputIndex,
        call_id: item.callId ?? '',
        name: item.name ?? '',
        arguments: item.text,
      }))
    }

    const done = doneItemOf(item)
    out.push(event('response.output_item.done', { output_index: item.outputIndex, item: done }))
    items.push(done)
    return out.join('')
  }

  function openMessage(partType: 'output_text' | 'refusal'): string {
    const itemId = `msg_${idTail(responseId, String(nextOutputIndex))}`
    const outputIndex = nextOutputIndex++
    open = { kind: 'message', itemId, outputIndex, partType, toolIndex: -1, text: '' }
    const part: Payload = partType === 'refusal'
      ? { type: 'refusal', refusal: '' }
      : { type: 'output_text', text: '', annotations: [] }
    return event('response.output_item.added', {
      output_index: outputIndex,
      item: { id: itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
    }) + event('response.content_part.added', {
      item_id: itemId,
      output_index: outputIndex,
      content_index: 0,
      part,
    })
  }

  function openTool(toolIndex: number, callId: string, name: string): string {
    const itemId = callId !== '' ? `fc_${callId.replace(/^call_/, '')}` : `fc_${idTail(responseId, String(toolIndex))}`
    const outputIndex = nextOutputIndex++
    open = { kind: 'function_call', itemId, outputIndex, callId, name, toolIndex, text: '' }
    return event('response.output_item.added', {
      output_index: outputIndex,
      item: { id: itemId, type: 'function_call', status: 'in_progress', call_id: callId, name, arguments: '' },
    })
  }

  function useMessagePart(partType: 'output_text' | 'refusal'): string {
    if (open !== null && open.kind === 'message' && open.partType === partType) return ''
    return closeItem() + openMessage(partType)
  }

  /**
   * chat 把一次调用拆成「首个 delta 带 id/name」+「后续只带 arguments 片段」，所以同
   * `index` 的分片必须续在同一个项上。arguments 逐段发：拼完再发会让客户端从
   * 「逐段渲染」退化成「最后一次性出现」。
   */
  function useTool(toolIndex: number, callId: string, name: string): string {
    if (open !== null && open.kind === 'function_call' && open.toolIndex === toolIndex) return ''
    return closeItem() + openTool(toolIndex, callId, name)
  }

  function handleChunk(payload: Payload): string {
    const out: string[] = []

    const rawId = stringOf(payload.id)
    if (rawId !== '') responseId = responsesIdOf(rawId, options.fallbackId)
    if (typeof payload.created === 'number') createdAt = payload.created

    const usage = asRecord(payload.usage)
    if (usage) {
      const input = numberOrNull(usage.prompt_tokens)
      const output = numberOrNull(usage.completion_tokens)
      if (input !== null) inputTokens = input
      if (output !== null) outputTokens = output
      const reasoning = numberOrNull(asRecord(usage.completion_tokens_details)?.reasoning_tokens)
      if (reasoning !== null) reasoningTokens = reasoning
      const cached = numberOrNull(asRecord(usage.prompt_tokens_details)?.cached_tokens)
      if (cached !== null) cachedTokens = cached
    }

    const choice = asRecord(Array.isArray(payload.choices) ? payload.choices[0] : null) ?? {}
    const delta = asRecord(choice.delta) ?? {}

    const text = typeof delta.content === 'string' ? delta.content : textOfParts(delta.content)
    if (text !== '') {
      out.push(startResponse())
      out.push(useMessagePart('output_text'))
      const item = open as OpenItem
      item.text += text
      out.push(event('response.output_text.delta', {
        item_id: item.itemId,
        output_index: item.outputIndex,
        content_index: 0,
        delta: text,
      }))
    }

    const refusal = stringOf(delta.refusal)
    if (refusal !== '') {
      out.push(startResponse())
      out.push(useMessagePart('refusal'))
      const item = open as OpenItem
      item.text += refusal
      out.push(event('response.refusal.delta', {
        item_id: item.itemId,
        output_index: item.outputIndex,
        content_index: 0,
        delta: refusal,
      }))
    }

    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
    for (const rawCall of calls) {
      const call = asRecord(rawCall)
      if (!call) continue
      const fn = asRecord(call.function) ?? {}
      out.push(startResponse())
      out.push(useTool(typeof call.index === 'number' ? call.index : 0, stringOf(call.id), stringOf(fn.name)))
      const item = open as OpenItem
      const args = stringOf(fn.arguments)
      if (args !== '') {
        item.text += args
        out.push(event('response.function_call_arguments.delta', {
          item_id: item.itemId,
          output_index: item.outputIndex,
          call_id: item.callId ?? '',
          delta: args,
        }))
      }
    }

    const reason = stringOf(choice.finish_reason)
    if (reason !== '') finishReason = reason

    return out.join('')
  }

  function startResponse(): string {
    if (created) return ''
    created = true
    return event('response.created', { response: snapshot('in_progress', false) })
      + event('response.in_progress', { response: snapshot('in_progress', false) })
  }

  function handlePayloadText(data: string): string {
    // Responses 没有 `[DONE]`：那只是 chat 那侧的流结束记号，不翻译给客户端。
    if (data === '[DONE]') return ''
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return ''
    }
    const record = asRecord(parsed)
    if (!record) return ''

    const error = asRecord(record.error)
    if (error) {
      terminal = true
      const response = snapshot('failed', true)
      response.error = {
        code: stringOf(error.code) || 'api_error',
        message: stringOf(error.message) || 'upstream stream error',
      }
      return event('response.failed', { response })
    }
    return handleChunk(record)
  }

  function finish(): string {
    if (terminal) return ''
    const out: string[] = []
    out.push(startResponse())
    out.push(closeItem())

    const { status, incompleteReason } = statusOf(finishReason ?? 'stop')
    const response = snapshot(status, true)
    if (incompleteReason) response.incomplete_details = { reason: incompleteReason }
    out.push(event(status === 'incomplete' ? 'response.incomplete' : 'response.completed', { response }))
    terminal = true
    return out.join('')
  }

  return {
    push(chunk: string): string {
      if (terminal) return ''
      buffer += chunk
      let out = ''
      // SSE 帧以空行分隔；\r\n 与 \n 都见过，统一按换行处理再切空行。
      while (true) {
        const normalized = buffer.replace(/\r\n/g, '\n')
        const boundary = normalized.indexOf('\n\n')
        if (boundary < 0) {
          buffer = normalized
          break
        }
        const frame = normalized.slice(0, boundary)
        buffer = normalized.slice(boundary + 2)
        for (const line of frame.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          out += handlePayloadText(trimmed.slice(5).trim())
        }
      }
      return out
    },

    end(): string {
      return finish()
    },

    fail(message: string): string {
      if (terminal) return ''
      terminal = true
      const response = snapshot('failed', true)
      response.error = { code: 'api_error', message }
      return event('response.failed', { response })
    },
  }
}
