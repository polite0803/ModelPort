/**
 * Proxy Service Module - Stream Response Handler
 * Properly handles SSE format, supports stream and non-stream response conversion
 */

import { PassThrough, Transform } from 'stream'
import type { SSEEvent, ChatCompletionResponse, ChatCompletionChoice, ToolCall } from './types.ts'
import { parseToolCalls } from './utils/toolParser/index.ts'
import { readUsageFromBody, toWireUsage, type TokenUsage } from './quota/usage.ts'

/**
 * SSE Parser
 */
export class SSEParser {
  private buffer: string = ''

  /**
   * Parse SSE data
   */
  parse(data: string): SSEEvent[] {
    this.buffer += data
    const events: SSEEvent[] = []
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    let currentEvent: Partial<SSEEvent> = {}

    for (const line of lines) {
      if (line === '') {
        if (currentEvent.data !== undefined) {
          events.push({
            event: currentEvent.event,
            data: currentEvent.data,
            id: currentEvent.id,
            retry: currentEvent.retry,
          })
        }
        currentEvent = {}
        continue
      }

      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) {
        continue
      }

      const field = line.slice(0, colonIndex)
      let value = line.slice(colonIndex + 1)

      if (value.startsWith(' ')) {
        value = value.slice(1)
      }

      switch (field) {
        case 'event':
          currentEvent.event = value
          break
        case 'data':
          currentEvent.data = (currentEvent.data || '') + value
          break
        case 'id':
          currentEvent.id = value
          break
        case 'retry':
          currentEvent.retry = parseInt(value, 10)
          break
      }
    }

    return events
  }

  /**
   * Reset parser
   */
  reset(): void {
    this.buffer = ''
  }
}

/**
 * SSE Formatter
 */
export class SSEFormatter {
  /**
   * Format SSE event
   */
  format(event: SSEEvent): string {
    let result = ''

    if (event.id) {
      result += `id: ${event.id}\n`
    }

    if (event.event) {
      result += `event: ${event.event}\n`
    }

    if (event.retry !== undefined) {
      result += `retry: ${event.retry}\n`
    }

    result += `data: ${event.data}\n\n`

    return result
  }

  /**
   * Format JSON data
   */
  formatJSON(data: object, event?: string): string {
    return this.format({
      event,
      data: JSON.stringify(data),
    })
  }

  /**
   * Format done marker
   */
  formatDone(): string {
    return 'data: [DONE]\n\n'
  }
}

/** 上游 SSE 里错误帧的结构化样子；`status` 允许缺失（很多网关只给 message）。 */
export interface StreamErrorFrame {
  message: string
  type?: string
  code?: string | number | null
  param?: string | null
  status?: number
}

/**
 * 从一条已解析的 SSE data 里取错误帧。
 *
 * 只看 `error` 键，不把 `choices:[] + finish_reason` 这类正常空帧误判成错误。
 * 兼容三种实际形状：`{error:{message,type,code,param,statusCode}}`、
 * `{error:"...",status:400}`、以及错误体平铺在顶层（少数网关）。
 */
export function extractStreamErrorFrame(data: unknown): StreamErrorFrame | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const raw = record.error
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'string') {
    return raw.trim() === '' ? null : { message: raw.trim() }
  }
  if (typeof raw !== 'object') return null
  const error = raw as Record<string, unknown>
  const message =
    typeof error.message === 'string' && error.message.trim() !== ''
      ? error.message
      : typeof error.error === 'string' && error.error.trim() !== ''
        ? error.error
        : 'Upstream stream error'
  const status =
    typeof error.status === 'number'
      ? error.status
      : typeof error.statusCode === 'number'
        ? error.statusCode
        : typeof record.status === 'number'
          ? record.status
          : typeof record.statusCode === 'number'
            ? record.statusCode
            : undefined
  const type = typeof error.type === 'string' && error.type.trim() !== '' ? error.type : undefined
  const code = typeof error.code === 'string' || typeof error.code === 'number' ? error.code : null
  const param = typeof error.param === 'string' || error.param === null ? error.param : null
  return {
    message,
    ...(type === undefined ? {} : { type }),
    code,
    param,
    ...(status === undefined ? {} : { status }),
  }
}

/**
 * `reasoningAccum` 的累积上限（字符）。它唯一的用途是「content 全程为空时回填一帧」，
 * 不是正文通道，所以留够头即可，不必按模型上下文长度无界留着。
 */
const REASONING_ACCUM_LIMIT = 16_384

/**
 * Stream Response Handler
 */
export class StreamHandler {
  // `SSEFormatter` 只拼字符串、没有跨调用的状态，可以共享；`SSEParser` 带着跨 chunk 的
  // 半行残留，一个实例服务两条并发流就会把 A 的残帧接到 B 上，所以解析器一律按流新建。
  private formatter: SSEFormatter

  constructor() {
    this.formatter = new SSEFormatter()
  }

  /**
   * Create SSE transform stream
   * Converts upstream response to OpenAI compatible format
   */
  createTransformStream(
    model: string,
    responseId: string,
    onEnd?: () => void
  ): Transform {
    let isFirstChunk = true
    const created = Math.floor(Date.now() / 1000)
    const parser = new SSEParser()
    const formatter = this.formatter
    const transformChunk = this.transformChunk.bind(this)

    // Tool call buffering state
    let contentBuffer = ''
    let isBufferingToolCall = false
    let toolCallIndex = 0
    let doneSent = false

    // 部分上游（商汤系等推理模型）只回 reasoning_content，content 恒为空。
    // 对只读 content 的客户端（VS Code 原生 Chat 等）这等于空响应，收尾时需要用 reasoning 回填。
    let reasoningAccum = ''
    let emittedContentText = ''
    let sawToolCall = false

    // 上游整段正文为空时，用累积的 reasoning 补一帧 content，避免客户端判为空响应
    const buildReasoningFallback = (): string | null => {
      if (emittedContentText.trim() || sawToolCall) return null
      const text = reasoningAccum.trim()
      if (!text) return null
      const data = transformChunk({ content: text }, model, responseId, created, isFirstChunk)
      if (!data) return null
      isFirstChunk = false
      return formatter.formatJSON(data)
    }

    return new Transform({
      objectMode: true,
      transform(chunk: Buffer, encoding, callback) {
        try {
          const events = parser.parse(chunk.toString())

          for (const event of events) {
            if (event.data === '[DONE]') {
              // Flush any remaining buffer before done
              if (contentBuffer) {
                const finalData = transformChunk({ content: contentBuffer }, model, responseId, created, isFirstChunk)
                if (finalData) {
                  isFirstChunk = false
                  this.push(formatter.formatJSON(finalData))
                }
                contentBuffer = ''
              }
              if (!doneSent) {
                const fallbackFrame = buildReasoningFallback()
                if (fallbackFrame) {
                  this.push(fallbackFrame)
                }
                doneSent = true
                this.push(formatter.formatDone())
              }
              continue
            }

            let parsedData: any
            try {
              parsedData = JSON.parse(event.data)
            } catch {
              this.push(formatter.format(event))
              continue
            }

            // 上游在流里报错时，旧实现把它当「无内容帧」丢掉，客户端看到的是
            // 一条正常结束的截断答案。这里改成抛出带结构的错误：路由层统一写
            // 错误帧 + 恰好一个 [DONE]，并把请求日志翻成 error。
            const streamError = extractStreamErrorFrame(parsedData)
            if (streamError) {
              const error = new Error(streamError.message) as Error & Partial<StreamErrorFrame>
              error.name = 'UpstreamStreamError'
              if (streamError.status !== undefined) error.status = streamError.status
              if (streamError.type !== undefined) error.type = streamError.type
              if (streamError.code !== undefined && streamError.code !== null) error.code = streamError.code
              if (streamError.param !== undefined && streamError.param !== null) error.param = streamError.param
              throw error
            }

            const transformedData = transformChunk(parsedData, model, responseId, created, isFirstChunk)
            if (!transformedData) continue

            const reasoningPiece =
              parsedData?.choices?.[0]?.delta?.reasoning_content ?? parsedData?.reasoning_content
            if (typeof reasoningPiece === 'string' && reasoningPiece && reasoningAccum.length < REASONING_ACCUM_LIMIT) {
              reasoningAccum += reasoningPiece.slice(0, REASONING_ACCUM_LIMIT - reasoningAccum.length)
            }
            if (transformedData.choices[0].delta?.tool_calls) {
              sawToolCall = true
            }

            // Handle tool call buffering
            const deltaContent = transformedData.choices[0].delta?.content || ''

            if (deltaContent) {
              contentBuffer += deltaContent

              const marker = '[function_calls]'

              // If we are not buffering, check if we should start
              if (!isBufferingToolCall) {
                const markerIdx = contentBuffer.indexOf(marker)

                if (markerIdx !== -1) {
                  isBufferingToolCall = true
                  // If we have text before the marker, send it first
                  if (markerIdx > 0) {
                    const textBefore = contentBuffer.substring(0, markerIdx)
                    const textData = {
                      ...transformedData,
                      choices: [{
                        index: 0,
                        delta: { content: textBefore },
                        finish_reason: null
                      }]
                    }
                    this.push(formatter.formatJSON(textData))
                  }
                  contentBuffer = contentBuffer.substring(markerIdx)
                } else {
                  // Check for partial marker
                  for (let i = 0; i < contentBuffer.length; i++) {
                    if (contentBuffer[i] === '[') {
                      const potentialMarker = contentBuffer.substring(i)
                      if (marker.startsWith(potentialMarker)) {
                        isBufferingToolCall = true
                        if (i > 0) {
                          const textBefore = contentBuffer.substring(0, i)
                          const textData = {
                            ...transformedData,
                            choices: [{
                              index: 0,
                              delta: { content: textBefore },
                              finish_reason: null
                            }]
                          }
                          this.push(formatter.formatJSON(textData))
                        }
                        contentBuffer = potentialMarker
                        break
                      }
                    }
                  }
                }
              }

              if (isBufferingToolCall) {
                // Try to parse tool calls from buffer
                const { content: cleanContent, toolCalls } = parseToolCalls(contentBuffer)

                if (toolCalls.length > 0) {
                  // We found complete tool calls!
                  for (const tc of toolCalls) {
                    tc.index = toolCallIndex++
                    const toolCallData = {
                      ...transformedData,
                      choices: [{
                        index: 0,
                        delta: {
                          role: isFirstChunk ? 'assistant' : undefined,
                          tool_calls: [tc]
                        },
                        finish_reason: null
                      }]
                    }
                    isFirstChunk = false
                    this.push(formatter.formatJSON(toolCallData))
                  }

                  // Reset buffer with remaining content
                  contentBuffer = cleanContent
                  isBufferingToolCall = contentBuffer.includes('[function_calls]')

                  if (contentBuffer && !isBufferingToolCall) {
                    const textData = {
                      ...transformedData,
                      choices: [{
                        index: 0,
                        delta: { content: contentBuffer },
                        finish_reason: null
                      }]
                    }
                    this.push(formatter.formatJSON(textData))
                    contentBuffer = ''
                  }
                  continue
                } else {
                  // Still buffering, waiting for complete JSON or closing tag
                  // Safety check: if buffer is too long and no tool call found, flush it
                  if (contentBuffer.length > 10000) {
                    isBufferingToolCall = false
                    // Fall through to normal text output
                  } else {
                    continue
                  }
                }
              }

              // Normal text output
              transformedData.choices[0].delta!.content = contentBuffer
              contentBuffer = ''
            }

            // Handle tool_calls in streaming response
            if (parsedData.choices?.[0]?.delta?.tool_calls) {
              transformedData.choices[0].delta!.tool_calls = parsedData.choices[0].delta.tool_calls
            }

            // Only push if we are NOT currently buffering a potential tool call
            if (!isBufferingToolCall) {
              const pushedDelta = transformedData.choices[0].delta || {}
              if (typeof pushedDelta.content === 'string' && pushedDelta.content) {
                emittedContentText += pushedDelta.content
              }
              isFirstChunk = false
              this.push(formatter.formatJSON(transformedData))
            }
          }

          callback()
        } catch (error) {
          callback(error as Error)
        }
      },

      flush(callback) {
        if (contentBuffer) {
          // Final check for tool calls in buffer
          const { content: cleanContent, toolCalls } = parseToolCalls(contentBuffer)

          if (toolCalls.length > 0) {
            for (const tc of toolCalls) {
              const callIndex = toolCallIndex++
              tc.index = callIndex
              const toolCallData = {
                id: `call_${responseId}-${callIndex}`,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [tc]
                  },
                  finish_reason: null
                }]
              }
              this.push(formatter.formatJSON(toolCallData))
            }
          } else {
            // No tool calls, just flush content
            const finalData = transformChunk({ content: contentBuffer }, model, responseId, created, isFirstChunk)
            if (finalData) {
              this.push(formatter.formatJSON(finalData))
            }
          }
        }
        if (!doneSent) {
          const fallbackFrame = buildReasoningFallback()
          if (fallbackFrame) {
            this.push(fallbackFrame)
          }
          doneSent = true
          this.push(formatter.formatDone())
        }
        onEnd?.()
        callback()
      },
    })
  }

  /**
   * Transform chunk to OpenAI format
   */
  private transformChunk(
    data: any,
    model: string,
    responseId: string,
    created: number,
    isFirstChunk: boolean
  ): ChatCompletionResponse | null {
    if (!data) return null

    const delta: ChatCompletionChoice['delta'] = {}

    if (isFirstChunk) {
      delta.role = 'assistant'
    }

    // Set reasoning_content first to ensure it appears before content in the response
    if (data.choices?.[0]?.delta?.reasoning_content) {
      delta.reasoning_content = data.choices[0].delta.reasoning_content
    } else if (data.reasoning_content) {
      delta.reasoning_content = data.reasoning_content
    }

    if (typeof data === 'string') {
      delta.content = data
    } else if (data.choices?.[0]?.delta?.content !== undefined) {
      delta.content = data.choices[0].delta.content
    } else if (data.choices?.[0]?.text) {
      delta.content = data.choices[0].text
    } else if (data.content !== undefined) {
      delta.content = data.content
    } else if (data.message) {
      delta.content = data.message
    }

    // Handle tool_calls in streaming response
    if (data.choices?.[0]?.delta?.tool_calls) {
      delta.tool_calls = data.choices[0].delta.tool_calls
    }

    const finishReason = data.choices?.[0]?.finish_reason || data.finish_reason || null

    // 上游报了 usage 就必须原样带着走。规范里 `stream_options.include_usage` 的最后
    // 一帧是 `choices: [] + usage`，原先下面那句「什么都没有就丢」把它连同
    // finish_reason 帧上的 usage 一起吞掉，后果是**流式响应的 usage 永远是 null，
    // 哪怕上游明明报了数** —— 本仓的契约是「上游没报才 null」，不是「报了也 null」。
    // 不重塑结构（原样透传），`prompt_tokens_details` 这类上游自有字段才不会被抹掉。
    const reportedUsage = data.usage !== null && typeof data.usage === 'object' ? data.usage : undefined

    // Allow null content when there are tool_calls or finish_reason
    if (
      delta.content === undefined
      && !delta.reasoning_content
      && !delta.tool_calls
      && !finishReason
      && reportedUsage === undefined
    ) {
      return null
    }

    return {
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta,
        finish_reason: finishReason,
      }],
      ...(reportedUsage === undefined ? {} : { usage: reportedUsage }),
    }
  }

  /**
   * Convert stream response to non-stream response
   */
  async streamToResponse(
    stream: NodeJS.ReadableStream,
    model: string,
    responseId: string
  ): Promise<ChatCompletionResponse> {
    return new Promise((resolve, reject) => {
      let content = ''
      let reasoningContent = ''
      let finishReason: ChatCompletionChoice['finish_reason'] = null
      let usage: TokenUsage | null = null
      const toolCalls: ToolCall[] = []
      const created = Math.floor(Date.now() / 1000)
      const parser = new SSEParser()

      stream.on('data', (chunk: Buffer) => {
        const events = parser.parse(chunk.toString())

        for (const event of events) {
          if (event.data === '[DONE]') continue

          try {
            const data = JSON.parse(event.data)

            if (data.choices?.[0]?.delta?.content) {
              content += data.choices[0].delta.content
            } else if (data.choices?.[0]?.text) {
              content += data.choices[0].text
            } else if (data.content) {
              content += data.content
            } else if (data.text) {
              content += data.text
            }

            if (data.choices?.[0]?.delta?.reasoning_content) {
              reasoningContent += data.choices[0].delta.reasoning_content
            } else if (data.reasoning_content) {
              reasoningContent += data.reasoning_content
            }

            // Aggregate tool_calls from streaming chunks
            if (data.choices?.[0]?.delta?.tool_calls) {
              const deltaToolCalls = data.choices[0].delta.tool_calls
              for (const tc of deltaToolCalls) {
                const existing = toolCalls.find(t => t.index === tc.index)
                if (existing) {
                  if (tc.id) existing.id = tc.id
                  if (tc.type) existing.type = tc.type
                  if (tc.function?.name) existing.function.name = tc.function.name
                  if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
                } else {
                  toolCalls.push({
                    index: tc.index,
                    id: tc.id || '',
                    type: tc.type || 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || ''
                    }
                  })
                }
              }
            }

            const reported = readUsageFromBody(data)
            if (reported) {
              usage = reported
            }

            if (data.choices?.[0]?.finish_reason) {
              finishReason = data.choices[0].finish_reason
            }
          } catch {
            // Ignore parse errors
          }
        }
      })

      stream.on('end', () => {
        // Parse tool calls from accumulated content
        const { content: cleanContent, toolCalls: parsedToolCalls } = parseToolCalls(content)

        // Merge parsed tool calls with any native tool calls
        const finalToolCalls = [...toolCalls]
        if (parsedToolCalls.length > 0) {
          parsedToolCalls.forEach(ptc => {
            ptc.index = (ptc.index ?? 0) + finalToolCalls.length
            finalToolCalls.push(ptc)
          })
        }

        const message: any = {
          role: 'assistant',
        }
        if (reasoningContent) {
          message.reasoning_content = reasoningContent.trim()
        }
        // If we have tool calls, force content to null to avoid client confusion
        // 正文为空但上游给了 reasoning（推理模型常见），用 reasoning 兜底，避免客户端读到空
        message.content =
          finalToolCalls.length > 0
            ? null
            : cleanContent || reasoningContent.trim() || null

        if (finalToolCalls.length > 0) {
          // Remove index field and sort by original index
          message.tool_calls = finalToolCalls
            .sort((a, b) => (a.index || 0) - (b.index || 0))
            .map(({ index, ...rest }) => rest)

          // If we have tool calls, finish reason should be tool_calls
          if (!finishReason || finishReason === 'stop') {
            finishReason = 'tool_calls'
          }
        }

        resolve({
          id: responseId,
          object: 'chat.completion',
          created,
          model,
          choices: [{
            index: 0,
            message,
            finish_reason: finishReason || 'stop',
          }],
          usage: usage ? toWireUsage(usage) : null,
        })
      })

      stream.on('error', reject)
    })
  }

  /**
   * Create PassThrough stream for SSE response
   */
  createPassThrough(): PassThrough {
    return new PassThrough()
  }

  /**
   * Write SSE event to stream
   */
  writeSSEEvent(stream: PassThrough, data: object): void {
    stream.write(this.formatter.formatJSON(data))
  }

  /**
   * Write SSE done marker
   */
  writeSSEDone(stream: PassThrough): void {
    stream.write(this.formatter.formatDone())
    stream.end()
  }

  /**
   * Create error response stream
   */
  createErrorStream(model: string, responseId: string, error: string): PassThrough {
    const stream = new PassThrough()
    const created = Math.floor(Date.now() / 1000)

    stream.write(this.formatter.formatJSON({
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: error,
        },
        finish_reason: 'stop',
      }],
    }))

    stream.write(this.formatter.formatDone())
    stream.end()

    return stream
  }
}

export const streamHandler = new StreamHandler()
export default streamHandler
