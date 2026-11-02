/**
 * Anthropic Messages wire adapter.
 *
 * Three aggregate endpoints speak `anthropic-messages` (anthropic, z.ai's
 * /api/anthropic, minimax-cn). The proxy contract is OpenAI chat completions,
 * so this adapter converts the request into messages/system/tool_use blocks and
 * turns the SSE event stream back into OpenAI chunks. It emits complete SSE
 * frames itself, which is why the forward result carries `skipTransform`.
 */

import { PassThrough } from 'node:stream'
import axios from 'axios'
import type { Account, Provider } from '../../store/types'
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../utils/outputCap.ts'
import { readUpstreamErrorData } from '../upstreamErrorBody.ts'
import type {
  ChatCompletionMessageToolCall,
  ChatCompletionRequest,
  ChatMessage,
  ForwardResult,
} from '../types'

const ANTHROPIC_VERSION = '2023-06-01'
/**
 * Anthropic requires `max_tokens` even when the client omits it. The live value
 * normally arrives already filled in by `ensureAnthropicOutputCap` (client cap,
 * per-model parameter, then the `defaultMaxOutputTokens` setting); this constant
 * is only the last resort for callers that build a request bypassing the forwarder.
 */
const DEFAULT_MAX_TOKENS = DEFAULT_MAX_OUTPUT_TOKENS

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: Record<string, unknown> }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] }

interface AnthropicRequest {
  model: string
  max_tokens: number
  messages: AnthropicMessage[]
  system?: string
  stream?: boolean
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  tools?: { name: string; description?: string; input_schema: Record<string, unknown> }[]
  tool_choice?:
    | { type: 'auto'; disable_parallel_tool_use?: boolean }
    | { type: 'any'; disable_parallel_tool_use?: boolean }
    | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean }
}

export class AnthropicAdapter {
  private provider: Provider
  private account: Account

  constructor(provider: Provider, account: Account) {
    this.provider = provider
    this.account = account
  }

  static isAnthropicProvider(provider: Provider): boolean {
    return provider.type === 'aggregate' && provider.wire === 'anthropic-messages'
  }

  private buildUrl(): string {
    const base = (this.provider.apiEndpoint || '').replace(/\/+$/, '')
    const path = this.provider.chatPath || '/messages'
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      ...this.provider.headers,
    }
    const credentials = this.account.credentials
    const key = credentials.apiKey || credentials.token
    if (key) {
      const headerName = this.provider.authHeader || 'x-api-key'
      const prefix = this.provider.authPrefix ?? ''
      headers[headerName] = `${prefix}${key}`
    }
    return headers
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    actualModel: string
  ): Promise<ForwardResult> {
    const startTime = Date.now()
    const body = buildAnthropicRequest(request, actualModel)

    try {
      const response = await axios.request({
        method: 'POST',
        url: this.buildUrl(),
        headers: this.buildHeaders(),
        data: body,
        timeout: 120000,
        responseType: request.stream ? 'stream' : 'json',
        validateStatus: () => true,
        signal: request.signal,
      })

      if (response.status >= 400) {
        return {
          success: false,
          status: response.status,
          error: extractErrorMessage(await readUpstreamErrorData(response.data), response.status),
          latency: Date.now() - startTime,
        }
      }

      if (request.stream) {
        return {
          success: true,
          status: response.status,
          headers: { 'Content-Type': 'text/event-stream' },
          stream: convertAnthropicStream(
            response.data as NodeJS.ReadableStream,
            request.model,
            response.headers as Record<string, string>
          ) as never,
          skipTransform: true,
          latency: Date.now() - startTime,
        }
      }

      return {
        success: true,
        status: response.status,
        body: convertAnthropicResponse(response.data, request.model),
        latency: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - startTime,
      }
    }
  }
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, any>
    const nested = record.error && typeof record.error === 'object' ? record.error : record
    const message = nested.message || nested.error
    if (typeof message === 'string' && message) return message
  }
  return `Anthropic endpoint returned HTTP ${status}`
}

function toText(blocks: AnthropicBlock[]): string {
  return blocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function imageBlock(url: string): AnthropicBlock | null {
  const dataUrl = /^data:([^;]+);base64,(.*)$/i.exec(url)
  if (dataUrl) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: dataUrl[1], data: dataUrl[2] },
    }
  }
  if (/^https?:\/\//i.test(url)) {
    return { type: 'image', source: { type: 'url', url } }
  }
  return null
}

function convertContent(content: ChatMessage['content']): AnthropicBlock[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) return []

  const blocks: AnthropicBlock[] = []
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'image_url' && part.image_url?.url) {
      const block = imageBlock(part.image_url.url)
      if (block) blocks.push(block)
    }
  }
  return blocks
}

function toolUseBlock(call: ChatCompletionMessageToolCall): AnthropicBlock {
  let input: unknown = {}
  try {
    input = call.function.arguments ? JSON.parse(call.function.arguments) : {}
  } catch {
    // Incomplete JSON means the upstream cannot read it as a tool_use input;
    // keeping it as a raw string is the least surprising degradation.
    input = { input: call.function.arguments }
  }
  return { type: 'tool_use', id: call.id, name: call.function.name, input }
}

export function buildAnthropicRequest(
  request: ChatCompletionRequest,
  actualModel: string
): AnthropicRequest {
  const messages: AnthropicMessage[] = []
  const systemParts: string[] = []

  for (const message of request.messages) {
    if (message.role === 'system') {
      const text = typeof message.content === 'string'
        ? message.content
        : toText(convertContent(message.content))
      if (text) systemParts.push(text)
      continue
    }

    if (message.role === 'tool') {
      const result: AnthropicBlock = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id || '',
        content: typeof message.content === 'string'
          ? message.content
          : toText(convertContent(message.content)),
      }
      const last = messages[messages.length - 1]
      if (last && last.role === 'user' && last.content.some(block => block.type === 'tool_result')) {
        last.content.push(result)
      } else {
        messages.push({ role: 'user', content: [result] })
      }
      continue
    }

    if (message.role === 'assistant') {
      const content = convertContent(message.content)
      for (const call of message.tool_calls || []) {
        content.push(toolUseBlock(call))
      }
      if (content.length > 0) {
        messages.push({ role: 'assistant', content })
      }
      continue
    }

    messages.push({ role: 'user', content: convertContent(message.content) })
  }

  const body: AnthropicRequest = {
    model: actualModel,
    max_tokens: request.max_tokens && request.max_tokens > 0 ? request.max_tokens : DEFAULT_MAX_TOKENS,
    messages,
  }

  if (systemParts.length > 0) body.system = systemParts.join('\n\n')
  if (request.stream) body.stream = true
  if (typeof request.temperature === 'number') body.temperature = Math.min(request.temperature, 1)
  if (typeof request.top_p === 'number') body.top_p = request.top_p
  if (request.stop) body.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop]

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
    }))
    const disableParallel = request.parallel_tool_calls === false
    const choice = request.tool_choice
    if (choice === 'none') {
      // Anthropic has no "none"; omitting tools is the only way to forbid them.
      delete body.tools
    } else if (choice === 'required') {
      body.tool_choice = { type: 'any', disable_parallel_tool_use: disableParallel }
    } else if (choice && typeof choice === 'object' && choice.type === 'function') {
      body.tool_choice = { type: 'tool', name: choice.function.name, disable_parallel_tool_use: disableParallel }
    } else if (disableParallel) {
      body.tool_choice = { type: 'auto', disable_parallel_tool_use: true }
    }
  }

  return body
}

function mapStopReason(reason: string | null | undefined): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
  switch (reason) {
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    case 'refusal':
      return 'content_filter'
    default:
      return 'stop'
  }
}

function openAiUsage(usage: { input_tokens?: number; output_tokens?: number } | undefined) {
  if (!usage || typeof usage.input_tokens !== 'number' || typeof usage.output_tokens !== 'number') {
    return undefined
  }
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.input_tokens + usage.output_tokens,
  }
}

export function convertAnthropicResponse(payload: any, displayModel: string): Record<string, unknown> {
  const blocks: AnthropicBlock[] = Array.isArray(payload?.content) ? payload.content : []
  const text = toText(blocks)
  const toolCalls = blocks
    .filter((block): block is Extract<AnthropicBlock, { type: 'tool_use' }> => block.type === 'tool_use')
    .map((block, index) => ({
      index,
      id: block.id,
      type: 'function',
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      },
    }))

  const message: Record<string, unknown> = { role: 'assistant', content: text || null }
  if (toolCalls.length > 0) message.tool_calls = toolCalls

  const usage = openAiUsage(payload?.usage)
  return {
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: displayModel,
    choices: [{
      index: 0,
      message,
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : mapStopReason(payload?.stop_reason),
    }],
    ...(usage ? { usage } : {}),
  }
}

/** True when accumulated tool arguments parse as a complete JSON object (empty string counts as {}). */
function isCompleteJson(args: string): boolean {
  const trimmed = args.trim()
  if (trimmed === '') return true
  try {
    const parsed = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

/**
 * Turns the Anthropic SSE stream into OpenAI chat.completion.chunk frames and
 * terminates with exactly one `[DONE]`.
 */
export function convertAnthropicStream(
  source: NodeJS.ReadableStream,
  displayModel: string,
  responseHeaders?: Record<string, string>
): NodeJS.ReadableStream {
  const output = new PassThrough()
  const id = `chatcmpl-${Date.now().toString(36)}`
  const created = Math.floor(Date.now() / 1000)

  let buffer = ''
  let roleSent = false
  let finishSent = false
  let finishReason: ReturnType<typeof mapStopReason> = 'stop'
  let usage: ReturnType<typeof openAiUsage>
  let startedUsage: { input_tokens?: number; output_tokens?: number } = {}
  let toolCalls = 0
  let activeToolIndex: number | null = null
  // 2026-10-31 audit (same disease as the channel-pack projection): tool-call
  // fragments are staged, not written immediately. Truncation — upstream cut
  // before stop_reason, max_tokens landing mid-call, partial JSON args — can
  // only be decided at finish time, and a half-emitted tool call makes strict
  // clients (Qoder StreamAdapter) abort the whole turn as malformed.
  let sawStopReason = false
  const stagedToolFrames: string[] = []
  const toolArgs = new Map<number, string>()

  const write = (delta: Record<string, unknown>, finish: string | null = null, includeUsage = false) => {
    if (finishSent) return
    const payload: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created,
      model: displayModel,
      choices: [{ index: 0, delta, finish_reason: finish }],
    }
    if (includeUsage && usage) payload.usage = usage
    output.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  // Serialize a tool fragment into the staging buffer; flushed at finish.
  const stageTool = (delta: Record<string, unknown>) => {
    if (finishSent) return
    stagedToolFrames.push(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: displayModel,
      choices: [{ index: 0, delta, finish_reason: null }],
    })}\n\n`)
  }

  const handleEvent = (event: string, data: string) => {
    if (!data || data === '[DONE]') return
    let parsed: any
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }

    if (event === 'message_start') {
      startedUsage = parsed?.message?.usage ?? startedUsage
      if (!roleSent) {
        roleSent = true
        write({ role: 'assistant', content: '' })
      }
      return
    }

    if (event === 'content_block_start') {
      const block = parsed?.content_block
      if (block?.type === 'tool_use') {
        activeToolIndex = toolCalls
        toolCalls += 1
        toolArgs.set(activeToolIndex, '')
        stageTool({
          tool_calls: [{
            index: activeToolIndex,
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: '' },
          }],
        })
      } else {
        activeToolIndex = null
      }
      return
    }

    if (event === 'content_block_delta') {
      const delta = parsed?.delta
      if (delta?.type === 'text_delta' && delta.text) {
        write({ content: delta.text })
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        write({ reasoning_content: delta.thinking })
      } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const index = activeToolIndex ?? Math.max(toolCalls - 1, 0)
        toolArgs.set(index, (toolArgs.get(index) ?? '') + delta.partial_json)
        stageTool({
          tool_calls: [{ index, function: { arguments: delta.partial_json } }],
        })
      }
      return
    }

    if (event === 'message_delta') {
      if (parsed?.delta?.stop_reason) {
        sawStopReason = true
        finishReason = mapStopReason(parsed.delta.stop_reason)
      }
      if (parsed?.usage) startedUsage = { ...startedUsage, ...parsed.usage }
      usage = openAiUsage(startedUsage)
      return
    }

    if (event === 'error') {
      // Terminate the stream exactly like the source-error path below: one
      // error frame + [DONE], no trailing finish chunk afterwards.
      if (!finishSent) {
        finishSent = true
        output.write(`data: ${JSON.stringify({ error: parsed?.error ?? { message: 'Anthropic stream error' } })}\n\n`)
        output.write('data: [DONE]\n\n')
        output.end()
      }
      return
    }
  }

  source.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString()
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const lines = frame.split('\n')
      let event = 'message'
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      handleEvent(event, data)
      boundary = buffer.indexOf('\n\n')
    }
  })

  const finish = () => {
    if (finishSent) return
    // Role fallback first, then the discard decision and the final chunk —
    // the finishSent latch goes down LAST, because write() refuses anything
    // past it.
    if (!roleSent) write({ role: 'assistant', content: '' })
    // 2026-10-31 audit: drop staged tool fragments when the call cannot be
    // legal — partial JSON args, upstream cut before any stop_reason, or
    // max_tokens landing mid-call — and upgrade the finish to "length" so
    // clients retry instead of executing a half call.
    const argsTruncated = [...toolArgs.values()].some(args => args !== '' && !isCompleteJson(args))
    const discardTools = argsTruncated
      || (stagedToolFrames.length > 0 && (!sawStopReason || finishReason === 'length'))
    if (discardTools) {
      finishReason = 'length'
    } else {
      for (const frame of stagedToolFrames) output.write(frame)
    }
    usage = usage ?? openAiUsage(startedUsage)
    write({}, finishReason, true)
    output.write('data: [DONE]\n\n')
    output.end()
    finishSent = true
  }

  source.on('end', finish)
  source.on('error', (error: Error) => {
    if (!finishSent) {
      finishSent = true
      output.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`)
      output.write('data: [DONE]\n\n')
      output.end()
    }
  })

  // The headers are attached for parity with the default branch; they are not
  // used elsewhere once the route has already replied.
  void responseHeaders
  return output
}
