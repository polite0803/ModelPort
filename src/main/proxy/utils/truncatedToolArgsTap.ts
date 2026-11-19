import { Transform } from 'stream'
import { looksLikeTruncatedToolArguments } from '../../../shared/truncatedToolArguments.ts'

/**
 * chat SSE 流里的截断工具调用标注。
 *
 * 流式这一条**没法撤回**：`finish_reason` 要到流尾才出现，而 `tool_calls` 的参数
 * 分片早就发出去了。所以这里不做删除，只在收尾帧上追加一个附加字段
 * `x_modelport_tool_args_truncated: <条数>`，与 `toolViolationTap` 同一种做法 ——
 * 忽略它的客户端看到的就是原流，读它的 harness 至少能知道"这轮的调用参数是断的"。
 *
 * 真正能拦住半截补丁的是另外两条：responses 翻译层把 `input` 置空（Codex 主路径），
 * 以及非流式响应直接剪枝（`truncatedToolCalls.ts`）。
 */
export function createTruncatedToolArgsTap(): Transform {
  let buffer = ''
  // 按 index（缺省回落到 id）攒每个调用的 arguments 分片。
  const argumentsBySlot = new Map<string, string>()
  let annotated = false

  const processEvent = (event: string): string => {
    const line = event.split('\n').find((entry) => entry.startsWith('data:'))
    if (!line) return `${event}\n\n`

    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return `${event}\n\n`

    let parsed: any
    try {
      parsed = JSON.parse(payload)
    } catch {
      return `${event}\n\n`
    }

    const choice = parsed?.choices?.[0]
    const toolCalls = choice?.delta?.tool_calls
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) {
        const args = call?.function?.arguments
        if (typeof args !== 'string') continue
        const slot = typeof call?.index === 'number' ? String(call.index) : (call?.id ?? '0')
        argumentsBySlot.set(slot, (argumentsBySlot.get(slot) ?? '') + args)
      }
    }

    if (!annotated && choice?.finish_reason) {
      let broken = 0
      for (const accumulated of argumentsBySlot.values()) {
        if (looksLikeTruncatedToolArguments(accumulated)) broken += 1
      }
      if (broken > 0) {
        annotated = true
        return `data: ${JSON.stringify({ ...parsed, x_modelport_tool_args_truncated: broken })}\n\n`
      }
    }

    return `${event}\n\n`
  }

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      buffer += chunk.toString()
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        this.push(processEvent(event))
        boundary = buffer.indexOf('\n\n')
      }
      callback()
    },
    flush(callback) {
      if (buffer.trim()) {
        this.push(processEvent(buffer))
      }
      buffer = ''
      callback()
    },
  })
}