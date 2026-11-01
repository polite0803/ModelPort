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
 *    显式映射；不认识的（`thinking`、`container`、`mcp_servers`）不猜语义，但**必须
 *    进 `dropped` 清单**（见 `AnthropicToChatResult`）—— 静默丢掉会让客户端把
 *    「附件/思考没生效」当成正常结果读，本仓的既有裁定是「拿不到可以说，不许装成正常」。
 */

import { ANTHROPIC_FAMILY_TIERS, type AnthropicFamilyTier } from './types.ts'

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
  /**
   * `document` 块要不要翻成 chat 的 `file` 块发出去。缺省即 `true`
   * （只有显式 `false` 才关，与 `trailingUserGuard` 同一形态）。
   *
   * 开着时附件真的进上游报文；上游如果不吃 `file` 块会**硬报错** —— 那比「客户端以为
   * 模型读了这份 PDF、实际拿到的是空白」诚实。关掉它就回到旧行为：丢掉但记进 `dropped`。
   */
  documentsAsFileParts?: boolean
}

/**
 * `document` 块 → chat 的 `file` 块（`{type:'file', file:{filename, file_data}}`，
 * 这是 OpenAI 侧 PDF 输入的写法，`file_data` 收 data URL 或裸 base64 两种形态的供应商都见过，
 * 这里统一发 data URL）。
 *
 * 两种 source 都要认：`base64`（带 `media_type`）与 `text`（Anthropic 允许纯文本文件，
 * `media_type` 常为 `text/plain`）。翻不出去的一律返回 `null`，由调用方进 `dropped` ——
 * 不许在这里造一个空壳块发上去。
 */
function documentPartOf(block: Payload, index: number): Payload | null {
  const source = asRecord(block.source)
  if (!source) return null
  const mediaType = stringOf(source.media_type) || 'application/pdf'
  const data = stringOf(source.data)
  if (data === '') return null

  // 文件名很多上游拿来做类型判断（OpenAI 要求 `.pdf` 结尾才当 PDF 读），
  // 所以后缀必须由 media_type 反推，不能统一叫 document。
  const title = stringOf(block.title) || stringOf(block.name)
  const extension = EXTENSION_OF_MEDIA_TYPE[mediaType] ?? '.bin'
  const filename = title === '' ? `document-${index + 1}${extension}` : title

  return {
    type: 'file',
    file: { filename, file_data: `data:${mediaType};base64,${data}` },
  }
}

const EXTENSION_OF_MEDIA_TYPE: Readonly<Record<string, string>> = {
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
}

/**
 * 一次入向翻译的产物。
 *
 * `dropped` 是「客户端确实发来了、但本网关没有翻出去」的清单：内容块的 `type` 原样
 * 记录（没有 `type` 的记 `unknown`），请求体里没搬运的键记成 `body:<键名>`。
 *
 * 为什么必须由翻译层自己报（而不是另写一个扫描函数）：判「这块翻没翻」的代码只该有
 * 一份，两份会在下一个块类型上分叉，届时日志说「没丢」而正文真的丢了 —— 那正是这条
 * 清单要消灭的东西。
 */
export interface AnthropicToChatResult {
  request: Payload
  dropped: string[]
}

/**
 * 请求体里被翻译层读取的键。其余键（`thinking`、`top_k`、`service_tier`、
 * `mcp_servers`、`container` 这些）一律进 `dropped`，不猜语义、也不静默吞掉。
 */
const TRANSLATED_BODY_KEYS: ReadonlySet<string> = new Set([
  'model',
  'messages',
  'system',
  'max_tokens',
  'temperature',
  'top_p',
  'stop_sequences',
  'stream',
  'tools',
  'tool_choice',
  'metadata',
])

/**
 * anthropic `/v1/messages` 请求体 → chat `/v1/chat/completions` 请求体。
 *
 * 一条 anthropic 消息可能同时带文本与 `tool_use`（合成一个 assistant 消息），
 * 也可能同时带文本与多个 `tool_result`（拆成多条 `tool` 消息 + 一条 user 文本），
 * 顺序必须保持：`tool` 消息紧跟产生它的 assistant `tool_calls`，否则上游会
 * 把它当成「没有对应调用的工具结果」而拒绝。
 */
export function anthropicToChatRequest(body: unknown, options: AnthropicToChatOptions): AnthropicToChatResult {
  const source = asRecord(body) ?? {}
  const messages: Payload[] = []
  const dropped: string[] = []

  for (const key of Object.keys(source)) {
    if (!TRANSLATED_BODY_KEYS.has(key)) dropped.push(`body:${key}`)
  }

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
    let hasFile = false

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
        } else {
          // 翻不出去的图片（缺 data 或缺 url）也是「客户端发了、模型收不到」，同样要报。
          dropped.push('image')
        }
        continue
      }
      if (type === 'document') {
        const part = options.documentsAsFileParts === false
          ? null
          : documentPartOf(block, parts.length)
        if (part) {
          parts.push(part)
          hasFile = true
        } else {
          // 关掉开关、或这份附件根本翻不出去（没有 source/data）：照旧是缺席，但要看得见。
          dropped.push('document')
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
      // `thinking` / `redacted_thinking` / `document` / 未知块：不猜语义，但必须留痕。
      dropped.push(stringOf(block.type) || 'unknown')
    }

    if (role === 'assistant') {
      // assistant 轮只搬文本与 tool_calls：混进来的图片与工具结果到不了上游，逐条报数。
      for (const part of parts) {
        if (part.type === 'image_url') dropped.push('image')
        // assistant 轮的历史里不会出现待发附件；真出现了就是客户端把块放错了位置，
        // 这一格到不了上游，报出来而不是塞进那条消息。
        if (part.type === 'file') dropped.push('document')
      }
      toolResults.forEach(() => dropped.push('tool_result'))
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
        content: hasImage || hasFile || parts.length > 1 ? parts : text,
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
  if (toolChoice !== undefined) {
    request.tool_choice = toolChoice
  } else if (source.tool_choice !== undefined) {
    // 客户端点名了一种我们不认识的强制方式（例如 `{"type":"none"}` 之外的新形态）：
    // 静默当「没要求」会让它以为工具被禁了，所以这里也进清单。
    dropped.push('body:tool_choice')
  }

  const metadata = asRecord(source.metadata)
  const userId = metadata ? stringOf(metadata.user_id) : ''
  if (userId !== '') request.user = userId

  return { request, dropped }
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
 *
 * `document` 块按 Anthropic 公布的 **每页 1590 token** 计入，页数从 PDF 自身的页对象里
 * 数出来。数不出来（页树在压缩的对象流里、或不是 PDF）就**不计入并登记进 `uncounted`** ——
 * 宁可得出一个声明过的下界，也不要拍一个数：客户端拿这个数决定要不要压缩上下文，
 * 拍高的数会让它把正常请求提前截断。
 */
export interface AnthropicTokenEstimate {
  tokens: number
  /** 没能计入的块类型（去重、按出现顺序）。非空时 `tokens` 是下界，响应里必须说出来。 */
  uncounted: string[]
}

const CHARS_PER_TOKEN = 4
const PDF_TOKENS_PER_PAGE = 1590
/** 解码上限：再大的附件不在本机做字符串扫描，直接登记为未计入。 */
const MAX_SCANNED_DOCUMENT_BYTES = 8 * 1024 * 1024

/** 数 PDF 里的页对象（`/Type /Page` 与 `/Type/Page` 都认，页树节点 `/Pages` 跳过）。 */
function pdfPageCount(buffer: Buffer): number {
  const text = buffer.toString('latin1')
  let pages = 0
  let index = 0
  while (index < text.length) {
    const hit = text.indexOf('/Type', index)
    if (hit < 0) break
    const after = text.slice(hit + 5, hit + 24)
    // `/Page` 后面不能紧跟 `s`（那是页树 `/Pages`）也不能是更长单词的首字母前缀之外的东西。
    const match = /^\s*\/(Page[sS]?)/.exec(after)
    if (match !== null && match[1] === 'Page') pages += 1
    index = hit + 5
  }
  return pages
}

/** 一个 `document` 块能计入多少 token；返回 `undefined` 表示估不出来（要登记为未计入）。 */
function documentTokenEstimate(block: Payload): number | undefined {
  const source = asRecord(block.source)
  if (source === null) return undefined
  const mediaType = stringOf(source.media_type)
  const data = stringOf(source.data)
  if (data === '') return undefined

  if (mediaType === 'text/plain' || mediaType.startsWith('text/')) {
    // 文本类文件：`data` 是 base64，解出字符数按同一条 /4 规则计。
    try {
      return Math.ceil(Buffer.from(data, 'base64').toString('utf8').length / CHARS_PER_TOKEN)
    } catch {
      return undefined
    }
  }
  if (mediaType !== 'application/pdf') return undefined

  if (data.length > MAX_SCANNED_DOCUMENT_BYTES * 1.4) return undefined
  const pages = pdfPageCount(Buffer.from(data, 'base64'))
  return pages > 0 ? pages * PDF_TOKENS_PER_PAGE : undefined
}

export function estimateAnthropicInputTokensDetailed(body: unknown): AnthropicTokenEstimate {
  const source = asRecord(body) ?? {}
  const uncounted = new Set<string>()
  let characters = systemTextOf(source.system).length
  let wholeTokens = 0

  const rawMessages = Array.isArray(source.messages) ? source.messages : []
  for (const raw of rawMessages) {
    const message = asRecord(raw)
    if (!message) continue
    characters += textOfContent(message.content).length
    const content = Array.isArray(message.content) ? message.content : []
    for (const rawBlock of content) {
      const block = asRecord(rawBlock)
      if (!block) continue
      const type = stringOf(block.type)
      if (type === 'tool_use') {
        characters += JSON.stringify(asRecord(block.input) ?? {}).length
        continue
      }
      if (type === 'document') {
        const tokens = documentTokenEstimate(block)
        if (tokens === undefined) uncounted.add('document')
        else wholeTokens += tokens
        continue
      }
      // 图片没有尺寸就要按 Anthropic 的 (w×h)/750 定价，而 base64 里读不到宽高
      // （要解 PNG IHDR / JPEG SOF，那是另一件事）—— 这里只登记，不拍数。
      if (type === 'image') uncounted.add('image')
    }
  }

  const tools = Array.isArray(source.tools) ? source.tools : []
  if (tools.length > 0) characters += JSON.stringify(tools).length

  return {
    tokens: Math.max(1, wholeTokens + Math.ceil(characters / CHARS_PER_TOKEN)),
    uncounted: [...uncounted],
  }
}

export function estimateAnthropicInputTokens(body: unknown): number {
  return estimateAnthropicInputTokensDetailed(body).tokens
}

/**
 * 清单条目：`context_window` 只在网关真的知道时才带（与 OpenAI 形状同一口径）。
 */
export interface AnthropicListModelEntry {
  id: string
  created?: number
  context_window?: number
}

/**
 * 档位判据的唯一实现处：值不在合法表里就不发这一格，而不是发一个客户端会整行丢弃的值。
 * 大小写与首尾空白在这里归一。
 */
export function normalizeFamilyTier(value: unknown): AnthropicFamilyTier | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.trim().toLowerCase()
  return (ANTHROPIC_FAMILY_TIERS as readonly string[]).includes(key)
    ? (key as AnthropicFamilyTier)
    : undefined
}

/**
 * 网关的 OpenAI 模型清单 → anthropic `/v1/models` 形状。
 *
 * `display_name` 用模型 id：网关的 id 本身就是 `<供应商>/<模型>`，比再编一个
 * 人类可读名更准；`created_at` 用 ISO 时间（anthropic 这一版是字符串，不是秒数）。
 *
 * `anthropicNames`（即 `anthropicInbound.modelMap`）的键**排在最前面**，因为只发网关
 * 内部名等于让客户端自己把整张表过滤空：Claude Desktop 4.4212 的模型发现逐行要求 `id`
 * 是它认识的 Anthropic 模型名，否则该行必须带 `anthropic_family_tier`
 * （sonnet/opus/haiku/fable/mythos），两者都没有就整行丢弃，最后写一条
 * `[custom-3p] Gateway /v1/models returned 0 usable models`（判据取自本机那份安装
 * `app.asar` 里的解析代码，不是推测）。而用户申报的映射键正是客户端下一轮会原样发回
 * 来的名字 —— 广告它，「清单里的名字」与「能跑的名字」才是同一份。
 *
 * `max_input_tokens` 只在目标模型真有窗口时才发（沿用 `context_window` 的既有裁定：
 * 省略而不是编 0）；客户端用它判断要不要给这条模型开 1M 变体。
 *
 * `routeTiers`（即 `anthropicInbound.routeTiers`）是上面那条判据的**第二条活路**：客户端
 * 保留一行的条件是「`id` 是它认识的 Anthropic 名 **或** 带合法 `anthropic_family_tier`」，
 * 所以给一条现有路由标档位，就能把它广告给 Desktop，而不必伪造 Anthropic 名字。映射键
 * 继承其目标路由的档位（客户端下一轮发回来的正是那个键）。
 */
export function modelsToAnthropicList(
  models: AnthropicListModelEntry[],
  anthropicNames?: Record<string, string>,
  routeTiers?: Record<string, string>,
  routeDisplayNames?: Record<string, string>
): Payload {
  const byGatewayName = new Map<string, AnthropicListModelEntry>()
  for (const model of models) {
    const key = model.id.trim().toLowerCase()
    if (key !== '' && !byGatewayName.has(key)) byGatewayName.set(key, model)
  }

  const tierByKey = new Map<string, AnthropicFamilyTier>()
  for (const [name, tier] of Object.entries(routeTiers ?? {})) {
    const key = name.trim().toLowerCase()
    const normalized = normalizeFamilyTier(tier)
    if (key !== '' && normalized !== undefined) tierByKey.set(key, normalized)
  }

  // 显示名按小写键取：id 必须是能被解析的路由名，想让用户看见别的字只能改这一格。
  const displayByKey = new Map<string, string>()
  for (const [name, label] of Object.entries(routeDisplayNames ?? {})) {
    const key = name.trim().toLowerCase()
    const value = typeof label === 'string' ? label.trim() : ''
    if (key !== '' && value !== '') displayByKey.set(key, value)
  }

  const now = Math.floor(Date.now() / 1000)
  const data: Payload[] = []
  const added = new Set<string>()

  const pushRow = (
    rawId: string,
    entry: AnthropicListModelEntry | undefined,
    tier?: AnthropicFamilyTier,
    displayName?: string,
  ): void => {
    const name = rawId.trim()
    if (name === '') return
    const key = name.toLowerCase()
    if (added.has(key)) return
    added.add(key)
    data.push({
      type: 'model',
      id: name,
      display_name: displayName ?? name,
      created_at: new Date((entry?.created ?? now) * 1000).toISOString(),
      ...(entry?.context_window === undefined ? {} : { max_input_tokens: entry.context_window }),
      ...(tier === undefined ? {} : { anthropic_family_tier: tier }),
    })
  }

  for (const [name, target] of Object.entries(anthropicNames ?? {})) {
    const targetKey = String(target ?? '').trim().toLowerCase()
    const resolved = byGatewayName.get(targetKey)
    // 映射指向一个此刻不广告的名字时不发这一行：发出去就是让客户端选中一条必然失败的
    // 模型，与 `resolveAnthropicModel` 里「映射目标必须被网关认识」是同一条判据。
    if (resolved === undefined) continue
    const rowKey = name.trim().toLowerCase()
    pushRow(
      name,
      resolved,
      tierByKey.get(targetKey) ?? tierByKey.get(rowKey),
      displayByKey.get(rowKey) ?? displayByKey.get(targetKey),
    )
  }

  for (const model of models) {
    const key = model.id.trim().toLowerCase()
    pushRow(model.id, model, tierByKey.get(key), displayByKey.get(key))
  }

  return {
    data,
    has_more: false,
    first_id: data.length > 0 ? data[0].id : null,
    last_id: data.length > 0 ? data[data.length - 1].id : null,
  }
}
