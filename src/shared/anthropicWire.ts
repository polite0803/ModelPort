/**
 * 入向 anthropic 翻译层：客户端说 anthropic（`/v1/messages`），本应用说 chat。
 *
 * 与 `responsesWire.ts` 同一套做法，方向相反：那里是「本应用 → 只会 responses 的
 * 供应商」，这里是「只会 anthropic 的客户端 → 本应用」。两边都不进转发器内部，
 * 只在进出处翻译，所以路由/故障转移/配额/压缩/日志一条都不需要复制。
 *
 * 四条纪律（与项目既有契约一致）：
 *
 * 1. **上游没报 usage 就是 0 之外的可空字段。** anthropic 的 `usage` 是必填对象，
 *    但 `input_tokens`/`output_tokens` 我们只填拿到的数；没拿到就不编。
 * 2. **流里恰好一套骨架。** `message_start` → 若干 `content_block_*` →
 *    `message_delta` → `message_stop`，一条流里只发一次；中途失败改发 `error` 事件。
 * 3. **失败不是正文。** 上游 `{"error": …}` 帧必须翻成 anthropic 的 `error` 事件，
 *    绝不能变成 assistant 文本（客户端会把报错当回答读）。
 * 4. **只搬运能一一对应的字段。** 不同名的（`tool_choice` 三种形态、`stop_sequences`）
 *    显式映射；不认识的（`thinking`、`container`、`mcp_servers`）直接丢，不猜。
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

/** anthropic 的 `content` 既可以是字符串，也可以是块数组；文本块取 `text` 字段。 */
function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const record = asRecord(block)
      if (!record) return ''
      return typeof record.text === 'string' ? record.text : ''
    })
    .join('')
}

/** `system` 支持字符串或 `[{type:'text', text}]`；块数组里的 `cache_control` 不影响文本。 */
function systemTextOf(system: unknown): string {
  if (typeof system === 'string') return system
  return textOfContent(system)
}

/** `image` 块 → chat 的 `image_url`；`base64` 与 `url` 两种 source 都要认。 */
function imagePartOf(block: Payload): Payload | null {
  const source = asRecord(block.source)
  if (!source) return null
  if (source.type === 'base64') {
    const mediaType = stringOf(source.media_type) || 'image/png'
    const data = stringOf(source.data)
    if (data === '') return null
    return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } }
  }
  const url = stringOf(source.url)
  if (url === '') return null
  return { type: 'image_url', image_url: { url } }
}

/**
 * `tool_choice` 的三种 anthropic 形态 → chat 的两种。
 *
 * `any` 是「必须调工具但不确定哪个」，chat 里对应 `required`；`tool` + `name` 是
 * 点名，对应 `{type:'function'}`。`none` 与 `auto` 同名直通。
 */
function toolChoiceOf(value: unknown): unknown {
  const record = asRecord(value)
  if (!record) return undefined
  const type = stringOf(record.type)
  if (type === 'auto') return 'auto'
  if (type === 'none') return 'none'
  if (type === 'any') return 'required'
  if (type === 'tool') {
    const name = stringOf(record.name)
    return name === '' ? 'required' : { type: 'function', function: { name } }
  }
  return undefined
}

/** `[{name, description, input_schema}]` → chat 的 function tools。 */
function toolsOf(value: unknown): Payload[] {
  if (!Array.isArray(value)) return []
  const tools: Payload[] = []
  for (const raw of value) {
    const tool = asRecord(raw)
    if (!tool) continue
    const name = stringOf(tool.name)
    if (name === '') continue
    const fn: Payload = {
      name,
      // `input_schema` 缺省要补成空对象：chat 的 function.parameters 不能是 undefined，
      // 有些上游会把「没有参数」当成 schema 非法而拒绝整个请求。
      parameters: asRecord(tool.input_schema) ?? { type: 'object', properties: {} },
    }
    const description = stringOf(tool.description)
    if (description !== '') fn.description = description
    tools.push({ type: 'function', function: fn })
  }
  return tools
}

export interface AnthropicToChatOptions {
  /** 已解析过的网关模型名（不是客户端发来的 anthropic 模型名）。 */
  model: string
  stream: boolean
}

/**
 * anthropic `/v1/messages` 请求体 → chat `/v1/chat/completions` 请求体。
 *
 * 一条 anthropic 消息可能同时带文本与 `tool_use`（合成一个 assistant 消息），
 * 也可能同时带文本与多个 `tool_result`（拆成多条 `tool` 消息 + 一条 user 文本），
 * 顺序必须保持：`tool` 消息紧跟产生它的 assistant `tool_calls`，否则上游会
 * 把它当成「没有对应调用的工具结果」而拒绝。
 */
export function anthropicToChatRequest(body: unknown, options: AnthropicToChatOptions): Payload {
  const source = asRecord(body) ?? {}
  const messages: Payload[] = []

  const systemText = systemTextOf(source.system)
  if (systemText.trim() !== '') {
    messages.push({ role: 'system', content: systemText })
  }

  const rawMessages = Array.isArray(source.messages) ? source.messages : []
  for (const raw of rawMessages) {
    const message = asRecord(raw)
    if (!message) continue
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const content = message.content

    if (typeof content === 'string') {
      if (content !== '') messages.push({ role, content })
      continue
    }
    if (!Array.isArray(content)) continue

    const parts: Payload[] = []
    const toolCalls: Payload[] = []
    const toolResults: Payload[] = []
    let hasImage = false

    for (const rawBlock of content) {
      const block = asRecord(rawBlock)
      if (!block) continue
      const type = stringOf(block.type)

      if (type === 'text') {
        const text = stringOf(block.text)
        if (text !== '') parts.push({ type: 'text', text })
        continue
      }
      if (type === 'image') {
        const part = imagePartOf(block)
        if (part) {
          parts.push(part)
          hasImage = true
        }
        continue
      }
      if (type === 'tool_use') {
        toolCalls.push({
          id: stringOf(block.id),
          type: 'function',
          function: {
            name: stringOf(block.name),
            // `input` 已经是对象；chat 要的是 JSON 字符串，序列化失败就给空对象。
            arguments: JSON.stringify(asRecord(block.input) ?? {}),
          },
        })
        continue
      }
      if (type === 'tool_result') {
        toolResults.push({
          role: 'tool',
          tool_call_id: stringOf(block.tool_use_id),
          content: textOfContent(block.content),
        })
        continue
      }
      // `thinking` / `redacted_thinking` / `document` / 未知块：不猜，丢掉。
    }

    if (role === 'assistant') {
      const text = parts.map((part) => stringOf(part.text)).join('')
      const assistant: Payload = {
        role: 'assistant',
        // 只有工具调用时 content 必须是 null，给 '' 会让部分上游把这条消息算成空回复。
        content: text !== '' ? text : toolCalls.length > 0 ? null : '',
      }
      if (toolCalls.length > 0) assistant.tool_calls = toolCalls
      if (text !== '' || toolCalls.length > 0) messages.push(assistant)
      continue
    }

    for (const result of toolResults) messages.push(result)
    if (parts.length > 0) {
      // 单段纯文本用字符串：老上游对数组形态的兼容性参差；有图片才必须用数组。
      const text = parts.map((part) => stringOf(part.text)).join('')
      messages.push({
        role: 'user',
        content: hasImage || parts.length > 1 ? parts : text,
      })
    }
  }

  const request: Payload = {
    model: options.model,
    messages,
  }
  if (options.stream) {
    request.stream = true
    // 流式必须主动要 usage：OpenAI 形状的上游默认**不发**最后一个 usage 块，
    // 不要就拿不到数。不接这一句，下面 `message_start`/`message_delta` 的
    // `usage` 就永远是 0，Claude Code 那类客户端的上下文余量条会算错，
    // 结果是它把压缩推迟到上游硬拒之后（本仓已有同类事故：缓存字段读反）。
    // 内建供应商会在 `parameterPolicy` 里把这格剥掉（它们不支持），那是既有裁定。
    request.stream_options = { include_usage: true }
  }

  const maxTokens = source.max_tokens
  if (typeof maxTokens === 'number') request.max_tokens = maxTokens
  if (typeof source.temperature === 'number') request.temperature = source.temperature
  if (typeof source.top_p === 'number') request.top_p = source.top_p

  // `stop_sequences` 与 chat 的 `stop` 同义（单数/复数在 chat 侧都表示多值），直通。
  const stopSequences = source.stop_sequences
  if (Array.isArray(stopSequences) && stopSequences.length > 0) request.stop = stopSequences

  const tools = toolsOf(source.tools)
  if (tools.length > 0) request.tools = tools
  const toolChoice = toolChoiceOf(source.tool_choice)
  if (toolChoice !== undefined) request.tool_choice = toolChoice

  const metadata = asRecord(source.metadata)
  const userId = metadata ? stringOf(metadata.user_id) : ''
  if (userId !== '') request.user = userId

  return request
}

/** chat 的 `finish_reason` → anthropic 的 `stop_reason`。 */
export function stopReasonOf(finishReason: unknown): string {
  switch (stringOf(finishReason)) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'refusal'
    default:
      return 'end_turn'
  }
}

interface ChatUsageShape {
  prompt_tokens?: unknown
  completion_tokens?: unknown
}

function usageOf(value: unknown): ChatUsageShape | null {
  return asRecord(value) as ChatUsageShape | null
}

function tokenCountOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * chat 的 tool_call `arguments`（JSON 字符串）→ anthropic 的 `input`（对象）。
 *
 * 解析失败给空对象而不是原文：anthropic 的 `input` 必须是对象，塞字符串会让客户端
 * 在渲染工具调用时抛错，而空对象至少能让人看到「模型调了这个工具但参数坏了」。
 */
function parseArguments(raw: unknown): Payload {
  if (asRecord(raw)) return raw as Payload
  const text = stringOf(raw)
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    return asRecord(parsed) ?? {}
  } catch {
    return {}
  }
}

export interface ChatToAnthropicOptions {
  /** 回显给客户端的模型名：用**客户端请求的那个名字**，不是网关转出的实际模型。 */
  model: string
  /** anthropic 消息 id 前缀；上游 id 若存在则用它。调用方传的是 `randomUUID()` 字符串。 */
  fallbackId?: string
  /**
   * 本机估算的输入 token，只在**流式**的 `message_start` 上用。
   *
   * anthropic 的 `message_start.usage.input_tokens` 是必填数字，而这一刻上游还
   * 什么都没报（chat 形状把 usage 放在最后一个块里）。填 0 是一个谎（等于申报
   * 「这次没消耗输入」），所以填估算值，并由调用方用响应头
   * `X-ModelPort-Usage-Estimated` 说清这一格是估的；真数一旦到达会在
   * `message_delta.usage.input_tokens` 里覆盖它。
   */
  estimatedInputTokens?: number
}

/**
 * chat 响应体 → anthropic `message`。
 *
 * `content` 里文本在前、`tool_use` 在后：anthropic 对块顺序敏感（客户端按顺序渲染），
 * 而 chat 的 `message.content` 与 `tool_calls` 本就是两个字段，没有交叉顺序可保留。
 */
export function chatResponseToAnthropicMessage(
  body: unknown,
  options: ChatToAnthropicOptions
): Payload {
  const response = asRecord(body) ?? {}
  const choice = Array.isArray(response.choices) ? asRecord(response.choices[0]) ?? {} : {}
  const message = asRecord(choice.message) ?? {}
  const content: Payload[] = []

  const text = textOfContent(message.content)
  if (text !== '') content.push({ type: 'text', text })

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  for (const rawCall of toolCalls) {
    const call = asRecord(rawCall)
    if (!call) continue
    const fn = asRecord(call.function) ?? {}
    content.push({
      type: 'tool_use',
      id: stringOf(call.id) || `toolu_${Date.now().toString(36)}`,
      name: stringOf(fn.name),
      input: parseArguments(fn.arguments),
    })
  }

  const usage = usageOf(response.usage)
  const result: Payload = {
    id: stringOf(response.id) || `msg_${options.fallbackId ?? Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model: options.model,
    content,
    stop_reason: toolCalls.length > 0 ? 'tool_use' : stopReasonOf(choice.finish_reason),
    stop_sequence: null,
  }
  // usage 只在真有数时出现：anthropic 客户端用它算上下文余量，编 0 会让它以为没消耗。
  if (usage) {
    result.usage = {
      input_tokens: tokenCountOf(usage.prompt_tokens),
      output_tokens: tokenCountOf(usage.completion_tokens),
    }
  }
  return result
}

function sseEvent(name: string, payload: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`
}

export interface AnthropicStreamTranslator {
  /** 吃一段 chat SSE 文本（可跨块截断），吐出要写给客户端的 anthropic SSE 文本。 */
  push(chunk: string): string
  /** 上游结束时调用：补齐没发出的骨架（块收尾、message_delta、message_stop）。 */
  end(): string
  /**
   * 传输层异常（连接被掐断等）时调用：只发一条 `error` 事件，**不再补骨架**。
   * 发过 `error` 之后再发 `message_stop` 会让客户端把这次失败记成一次成功的短回答。
   */
  fail(message: string): string
}

/**
 * chat SSE 流 → anthropic SSE 流（有状态）。
 *
 * 块骨架的规则来自 anthropic 自己的约束：一段文本或一次工具调用是一个
 * `content_block`，开 `start` 就必须配对 `stop`，块索引单调递增；`message_start`
 * 与 `message_stop` 各一次，且 `message_delta` 夹在最后一块与 `message_stop` 之间。
 * 所以这里必须自己维护「当前打开的块」，不能逐帧直译。
 *
 * 工具调用分片：chat 把一次调用拆成「首个 delta 带 id/name」+「后续 delta 只带
 * arguments 片段」，anthropic 对应 `content_block_start(tool_use)` +
 * 若干 `input_json_delta(partial_json)`；**不能**把片段拼起来再一次性发，那会让
 * 客户端在长参数上从「逐段渲染」退化成「最后一次性出现」。
 */
export function createAnthropicStreamTranslator(options: ChatToAnthropicOptions): AnthropicStreamTranslator {
  let buffer = ''
  let started = false
  let stopped = false
  let blockIndex = -1
  let openKind: 'text' | 'tool' | null = null
  let openToolIndex: number | null = null
  let finishReason: string | null = null
  let inputTokens = 0
  let outputTokens = 0

  const messageId = `msg_${options.fallbackId ?? Date.now().toString(36)}`

  function startMessage(): string {
    if (started) return ''
    started = true
    return sseEvent('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: options.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens || options.estimatedInputTokens || 0, output_tokens: 0 },
      },
    })
  }

  function closeBlock(): string {
    if (openKind === null) return ''
    const closing = sseEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex })
    openKind = null
    openToolIndex = null
    return closing
  }

  function openText(): string {
    if (openKind === 'text') return ''
    const out: string[] = []
    out.push(closeBlock())
    blockIndex += 1
    openKind = 'text'
    out.push(
      sseEvent('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'text', text: '' },
      })
    )
    return out.join('')
  }

  function openTool(toolIndex: number, id: string, name: string): string {
    if (openKind === 'tool' && openToolIndex === toolIndex) return ''
    const out: string[] = []
    out.push(closeBlock())
    blockIndex += 1
    openKind = 'tool'
    openToolIndex = toolIndex
    out.push(
      sseEvent('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'tool_use', id, name, input: {} },
      })
    )
    return out.join('')
  }

  function handleChunk(payload: Payload): string {
    const out: string[] = []
    const choice = Array.isArray(payload.choices) ? asRecord(payload.choices[0]) ?? {} : {}
    const delta = asRecord(choice.delta) ?? {}

    const usage = usageOf(payload.usage)
    if (usage) {
      inputTokens = tokenCountOf(usage.prompt_tokens) || inputTokens
      outputTokens = tokenCountOf(usage.completion_tokens) || outputTokens
    }

    const text = textOfContent(delta.content)
    if (text !== '') {
      out.push(startMessage())
      out.push(openText())
      out.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text },
        })
      )
    }

    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
    for (const rawCall of toolCalls) {
      const call = asRecord(rawCall)
      if (!call) continue
      const toolIndex = typeof call.index === 'number' ? call.index : 0
      const fn = asRecord(call.function) ?? {}
      const name = stringOf(fn.name)
      const id = stringOf(call.id)

      // chat 的后续分片只带 arguments；只有第一次出现（带 id 或 name）才开新块。
      if (openKind !== 'tool' || openToolIndex !== toolIndex) {
        out.push(startMessage())
        out.push(openTool(toolIndex, id || `toolu_${toolIndex}`, name))
      }

      const args = stringOf(fn.arguments)
      if (args !== '') {
        out.push(
          sseEvent('content_block_delta', {
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'input_json_delta', partial_json: args },
          })
        )
      }
    }

    const reason = stringOf(choice.finish_reason)
    if (reason !== '') finishReason = reason

    return out.join('')
  }

  function handlePayloadText(data: string): string {
    if (data === '[DONE]') return ''
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return ''
    }
    const record = asRecord(parsed)
    if (!record) return ''
    // 上游错误帧：翻成 anthropic 的 error 事件，绝不当正文。
    const error = asRecord(record.error)
    if (error) {
      stopped = true
      return sseEvent('error', {
        type: 'error',
        error: {
          type: 'api_error',
          message: stringOf(error.message) || 'upstream stream error',
        },
      })
    }
    return handleChunk(record)
  }

  function finish(): string {
    if (stopped) return ''
    const out: string[] = []
    out.push(startMessage())
    out.push(closeBlock())
    out.push(
      sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReasonOf(finishReason), stop_sequence: null },
        // 真数一旦到达就在这里覆盖 `message_start` 的那格估算（anthropic 自己也用
        // `message_delta.usage` 增量更新用量，多带一个 `input_tokens` 是合规的）。
        usage: { output_tokens: outputTokens, ...(inputTokens > 0 ? { input_tokens: inputTokens } : {}) },
      })
    )
    out.push(sseEvent('message_stop', { type: 'message_stop' }))
    stopped = true
    return out.join('')
  }

  return {
    push(chunk: string): string {
      if (stopped) return ''
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
      if (stopped) return ''
      stopped = true
      return sseEvent('error', {
        type: 'error',
        error: { type: 'api_error', message },
      })
    },
  }
}

/**
 * anthropic 的错误体。`type` 必须落在它认识的枚举里（`invalid_request_error` /
 * `authentication_error` / `api_error` / `overloaded_error`），否则客户端只会
 * 显示「unknown error」。
 */
export function anthropicErrorBody(
  message: string,
  type: 'invalid_request_error' | 'authentication_error' | 'api_error' | 'overloaded_error' = 'api_error'
): Payload {
  return { type: 'error', error: { type, message } }
}

/** HTTP 状态码 → anthropic 错误类型。 */
export function anthropicErrorTypeOf(status: number): 'invalid_request_error' | 'authentication_error' | 'api_error' | 'overloaded_error' {
  if (status === 401 || status === 403) return 'authentication_error'
  if (status === 429 || status === 529) return 'overloaded_error'
  if (status >= 400 && status < 500) return 'invalid_request_error'
  return 'api_error'
}

/**
 * 粗估输入 token。`/v1/messages/count_tokens` 只被客户端用于「发不发得出去」的
 * 预判，不需要精确；按字符数 /4 估（中英文混排的常见近似），工具 schema 也计入
 * —— 那部分在 agent 客户端里往往比对话本身还大。
 */
export function estimateAnthropicInputTokens(body: unknown): number {
  const source = asRecord(body) ?? {}
  let characters = systemTextOf(source.system).length

  const rawMessages = Array.isArray(source.messages) ? source.messages : []
  for (const raw of rawMessages) {
    const message = asRecord(raw)
    if (!message) continue
    characters += textOfContent(message.content).length
    const content = Array.isArray(message.content) ? message.content : []
    for (const rawBlock of content) {
      const block = asRecord(rawBlock)
      if (!block) continue
      if (block.type === 'tool_use') characters += JSON.stringify(asRecord(block.input) ?? {}).length
    }
  }

  const tools = Array.isArray(source.tools) ? source.tools : []
  if (tools.length > 0) characters += JSON.stringify(tools).length

  return Math.max(1, Math.ceil(characters / 4))
}

/**
 * 网关的 OpenAI 模型清单 → anthropic `/v1/models` 形状。
 *
 * `display_name` 用模型 id：网关的 id 本身就是 `<供应商>/<模型>`，比再编一个
 * 人类可读名更准；`created_at` 用 ISO 时间（anthropic 这一版是字符串，不是秒数）。
 */
export function modelsToAnthropicList(models: Array<{ id: string; created?: number }>): Payload {
  const data = models.map((model) => ({
    type: 'model',
    id: model.id,
    display_name: model.id,
    created_at: new Date((model.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  }))
  return {
    data,
    has_more: false,
    first_id: data.length > 0 ? data[0].id : null,
    last_id: data.length > 0 ? data[data.length - 1].id : null,
  }
}
