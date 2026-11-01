/**
 * 出向 responses 翻译层：本应用说 chat，供应商只会 responses 时用它往返。
 *
 * 只覆盖**出向**（本应用 → 供应商）。入向（客户端打 `/v1/responses`）在
 * `responsesInbound.ts`，方向相反、编解码各一套，两边不共用函数。
 *
 * 四条纪律：
 *
 * 1. **`usage` 上游没报就是 `null`。** 项目既有契约，这里不例外 —— 补 0 会让客户端
 *    以为真的用了 0 token，账单与限流判断全跟着错。
 * 2. **流里恰好一个结尾。** `response.completed` / `response.incomplete` 触发 finish，
 *    失败走错误帧。
 * 3. **失败不是正文。** `response.failed` 或上游错误事件必须翻成 `{"error": …}` 帧，
 *    绝不能变成 assistant 文本（客户端会把报错当回答读）。
 * 4. **只搬运能一一对应的字段。** `messages` / `tools` / 采样参数；不认识的字段不猜，
 *    由上游决定报不报错。
 */

type Payload = Record<string, unknown>

/** chat 的 `max_tokens` 在 responses 里叫 `max_output_tokens`，其余采样参数同名。 */
const SAME_NAME_PARAMS = [
  'temperature',
  'top_p',
  'seed',
  'presence_penalty',
  'frequency_penalty',
  'stop',
  'user',
  // 上游的缓存亲和键，两边同名；不搬就等于替客户端放弃 prompt caching。
  'prompt_cache_key',
] as const

function asRecord(value: unknown): Payload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Payload)
    : null
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  // 只取文本分片：图片等非文本在 responses 的 input 里形状不同，
  // 拼接它们会造出一个上游读不懂的字符串。
  return content
    .map(part => {
      const record = asRecord(part)
      if (!record) return ''
      return typeof record.text === 'string' ? record.text : ''
    })
    .join('')
}

export interface ResponsesChatInput {
  model?: string
  messages?: unknown
  tools?: unknown
  tool_choice?: unknown
  stream?: boolean
  temperature?: number
  top_p?: number
  max_tokens?: number
  seed?: number
  presence_penalty?: number
  frequency_penalty?: number
  stop?: unknown
  user?: string
  prompt_cache_key?: string
}

/**
 * chat 请求 → responses 请求体。
 *
 * system 提到顶层 `instructions`：responses 的 `input` 只接受 user/assistant 这类
 * 对话项，混进 system 会被上游忽略，等于把系统提示词丢了。
 */
export function chatToResponsesRequest(
  request: ResponsesChatInput,
  actualModel?: string
): Payload {
  const source = request
  const messages = Array.isArray(source.messages) ? source.messages : []

  const instructions: string[] = []
  const input: Payload[] = []

  for (const raw of messages) {
    const message = asRecord(raw)
    if (!message) continue
    const role = typeof message.role === 'string' ? message.role : 'user'
    const text = textOfContent(message.content)

    if (role === 'system' || role === 'developer') {
      if (text) instructions.push(text)
      continue
    }
    if (role === 'tool') {
      // responses 的 tool 结果靠 call_id 关联，形状与 chat 不同
      input.push({
        type: 'function_call_output',
        call_id: typeof message.tool_call_id === 'string' ? message.tool_call_id : '',
        output: text,
      })
      continue
    }
    input.push({ role, content: text || null })
  }

  const body: Payload = {
    model: actualModel || source.model,
    input,
  }
  if (instructions.length > 0) body.instructions = instructions.join('\n\n')
  if (source.stream) body.stream = true

  for (const key of SAME_NAME_PARAMS) {
    const value = (source as Record<string, unknown>)[key]
    if (value === undefined || value === null || value === '') continue
    body[key] = value
  }
  if (typeof source.max_tokens === 'number') body.max_output_tokens = source.max_tokens

  const tools = Array.isArray(source.tools) ? source.tools : []
  if (tools.length > 0) {
    body.tools = tools.map(tool => {
      const record = asRecord(tool) ?? {}
      const fn = asRecord(record.function) ?? {}
      // responses 把 function 的字段抬到 tool 自身
      return {
        type: 'function',
        name: fn.name,
        ...(fn.description ? { description: fn.description } : {}),
        ...(fn.parameters ? { parameters: fn.parameters } : {}),
      }
    })
  }
  if (source.tool_choice !== undefined) body.tool_choice = source.tool_choice

  return body
}

interface ChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: { cached_tokens: number }
}

/** responses 的 usage → chat usage；缺字段就是 null，不补 0。 */
function usageOf(response: Payload): ChatUsage | null {
  const usage = asRecord(response.usage)
  if (!usage) return null
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined
  if (input === undefined && output === undefined) return null

  const result: ChatUsage = {
    prompt_tokens: input ?? 0,
    completion_tokens: output ?? 0,
    total_tokens: (input ?? 0) + (output ?? 0),
  }
  const details = asRecord(usage.input_tokens_details)
  if (details && typeof details.cached_tokens === 'number') {
    result.prompt_tokens_details = { cached_tokens: details.cached_tokens }
  }
  return result
}

/** 从 `output` 里取出正文与工具调用。`message` 之外的类型不混进 content。 */
function readOutput(output: unknown, id: string): {
  content: string | null
  toolCalls: Payload[]
} {
  let content = ''
  const toolCalls: Payload[] = []

  for (const raw of Array.isArray(output) ? output : []) {
    const item = asRecord(raw)
    if (!item) continue

    if (item.type === 'function_call') {
      toolCalls.push({
        id: typeof item.call_id === 'string' ? item.call_id : `${id}-${toolCalls.length}`,
        type: 'function',
        function: {
          name: typeof item.name === 'string' ? item.name : '',
          arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
        },
      })
      continue
    }

    if (item.type !== 'message') continue
    for (const part of Array.isArray(item.content) ? item.content : []) {
      const piece = asRecord(part)
      // refusal 是拒绝文本，不能当 assistant 正文
      if (piece && piece.type === 'output_text' && typeof piece.text === 'string') {
        content += piece.text
      }
    }
  }

  return {
    content: content.length > 0 ? content : null,
    toolCalls,
  }
}

export interface ResponsesChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: 'assistant'; content: string | null; tool_calls?: Payload[] }
    finish_reason: string
  }>
  usage: ChatUsage | null
}

/** 非流式 responses 体 → chat completion。 */
export function responsesBodyToChat(payload: unknown, model: string, createdAt = Date.now()): ResponsesChatResponse {
  const response = asRecord(payload) ?? {}
  const id = typeof response.id === 'string' ? response.id : `resp_${createdAt}`
  const { content, toolCalls } = readOutput(response.output, id)

  const message: ResponsesChatResponse['choices'][number]['message'] = {
    role: 'assistant',
    content,
  }
  if (toolCalls.length > 0) message.tool_calls = toolCalls

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(createdAt / 1000),
    model: typeof response.model === 'string' ? response.model : model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      },
    ],
    usage: usageOf(response),
  }
}

/** 一个 SSE 帧（已经是 `data: ` 后的 JSON 对象）。 */
export type ResponsesEvent = Payload

/**
 * responses 事件流 → chat SSE 文本行。
 *
 * 返回的是完整 SSE 行数组（含 `data: [DONE]`），由调用方逐行写入响应流。
 * 文本增量保持原有分片顺序，不合并 —— 合并会让前端逐字渲染变成一次性跳出。
 */
export function responsesEventToChatChunks(
  events: ResponsesEvent[],
  model: string,
  requestId: string,
  createdAt = Date.now()
): string[] {
  const chunks: string[] = []
  const created = Math.floor(createdAt / 1000)
  let id = `resp_${requestId}`
  let started = false
  let finished = false

  const emit = (delta: Payload, finishReason: string | null, extra: Payload = {}): void => {
    chunks.push(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...extra,
      })}\n\n`
    )
  }

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : ''

    if (type === 'response.created') {
      const response = asRecord(event.response)
      if (response && typeof response.id === 'string') id = response.id
      if (!started) {
        emit({ role: 'assistant' }, null)
        started = true
      }
      continue
    }

    if (type === 'response.output_text.delta') {
      if (!started) {
        emit({ role: 'assistant' }, null)
        started = true
      }
      if (typeof event.delta === 'string' && event.delta.length > 0) {
        emit({ content: event.delta }, null)
      }
      continue
    }

    if (type === 'response.output_item.added') {
      // 工具调用在 added 时给出名字与 id；arguments 由 delta 追加
      const item = asRecord(event.item)
      if (item && item.type === 'function_call') {
        if (!started) {
          emit({ role: 'assistant' }, null)
          started = true
        }
        emit(
          {
            tool_calls: [
              {
                index: typeof event.output_index === 'number' ? event.output_index : 0,
                id: typeof item.call_id === 'string' ? item.call_id : '',
                type: 'function',
                function: { name: typeof item.name === 'string' ? item.name : '', arguments: '' },
              },
            ],
          },
          null
        )
      }
      continue
    }

    if (type === 'response.function_call_arguments.delta') {
      if (typeof event.delta === 'string' && event.delta.length > 0) {
        emit(
          {
            tool_calls: [
              {
                index: typeof event.output_index === 'number' ? event.output_index : 0,
                function: { arguments: event.delta },
              },
            ],
          },
          null
        )
      }
      continue
    }

    if (type === 'response.completed' || type === 'response.incomplete') {
      const response = asRecord(event.response) ?? {}
      if (typeof response.id === 'string') id = response.id
      const usage = usageOf(response)
      const extra = usage ? { usage } : {}
      emit({}, toolFinishReason(response, type), extra)
      finished = true
      continue
    }

    if (type === 'response.failed' || type === 'error') {
      const response = asRecord(event.response)
      const error = asRecord(response?.error) ?? asRecord(event.error) ?? {}
      const message =
        typeof error.message === 'string'
          ? error.message
          : type === 'response.failed'
            ? 'upstream reported a failed response'
            : 'upstream stream error'
      chunks.push(
        `data: ${JSON.stringify({
          error: {
            message,
            type: typeof error.code === 'string' ? error.code : 'api_error',
            code: typeof error.code === 'string' ? error.code : 'api_error',
          },
        })}\n\n`
      )
      finished = true
    }
  }

  if (!finished) emit({}, 'stop')

  chunks.push('data: [DONE]\n\n')
  return chunks
}

/** `response.completed` 的 finish_reason：带工具调用就是 `tool_calls`，被截断就是 `length`。 */
function toolFinishReason(response: Payload, type: string): string {
  if (type === 'response.incomplete') return 'length'
  const output = Array.isArray(response.output) ? response.output : []
  const hasCall = output.some(item => asRecord(item)?.type === 'function_call')
  return hasCall ? 'tool_calls' : 'stop'
}
