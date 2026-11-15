import type { ChatMessage } from '../types'

/**
 * 清掉历史里**没有名字**的 assistant `tool_calls`。
 *
 * ## 为什么需要（2026-11-14 实测）
 *
 * Claude Code 经 `/v1/messages` 打 `daily` 线路时，第 10 轮在 OpenRouter 上拿到
 * `tool_calls[1].function.name must be a non-empty string (got empty string)`
 * （`chatcmpl-mwgfb5ax-xg72hv`）。请求本身没有别的坏形，坏的是它回放的历史：
 * 某次工具调用的 `name` 是空串。chat 规范要求 name 非空，严格上游见一次就拒
 * 整段请求 —— 而客户端每一轮都会把同一份历史发回来，**不修历史，这个会话从此
 * 每轮都失败**（与 `toolArguments.ts` 那格同一个失效模式）。
 *
 * ## 为什么是删除
 *
 * 空名字的调用无法映射到任何 chat 工具（本网关不猜、也不伪造工具名），它产生
 * 的那条 `tool` 结果因此失去配对对象；留着只会变成孤儿结果，同样被严格上游
 * 拒绝。删除属于明确放行的 deletion-only trimming，语义上也诚实：那次调用本来
 * 就没有可执行的工具。
 *
 * ## 边界
 *
 * - 只动 `name` 不是非空字符串的调用；**没有任何空名调用时原样返回同一个数组**。
 * - 连带删除 `tool_call_id` 指向被删调用、或指向任何已不存在调用的结果消息
 *   （后者与 `channelPack/toolCallValidation.ts` 的 `orphan_result` 同判据）。
 * - 调用被清空的 assistant 消息：有正文/推理内容就保留，没有就整条删除
 *   （`content:null` 的空 assistant 会被上游当成空回复）。
 */
export interface ToolCallNameNormalization {
  messages: ChatMessage[]
  /** 清掉的空名调用个数 */
  droppedCalls: number
  /** 随之清掉的工具结果个数 */
  droppedResults: number
}

function callNameOf(call: unknown): string {
  const name = (call as { function?: { name?: unknown } } | null)?.function?.name
  return typeof name === 'string' ? name.trim() : ''
}

function callIdOf(call: unknown): string {
  const id = (call as { id?: unknown } | null)?.id
  return typeof id === 'string' ? id : ''
}

function hasContent(content: unknown): boolean {
  if (typeof content === 'string') return content.trim() !== ''
  if (Array.isArray(content)) return content.length > 0
  return false
}

export function normalizeToolCallNames(messages: ChatMessage[]): ToolCallNameNormalization {
  if (!Array.isArray(messages)) return { messages, droppedCalls: 0, droppedResults: 0 }

  const acceptedIds = new Set<string>()
  let droppedCalls = 0

  // 第一遍：只留名字非空的调用，并登记它们的 id。
  const withNames: (ChatMessage | null)[] = messages.map((message) => {
    const record = message as unknown as { role?: unknown; tool_calls?: unknown }
    if (record.role !== 'assistant' || !Array.isArray(record.tool_calls)) return message

    const calls = record.tool_calls as unknown[]
    const kept = calls.filter((call) => {
      if (callNameOf(call) !== '') {
        const id = callIdOf(call)
        if (id !== '') acceptedIds.add(id)
        return true
      }
      droppedCalls += 1
      return false
    })
    if (kept.length === calls.length) return message

    if (kept.length > 0) {
      return { ...(message as object), tool_calls: kept } as ChatMessage
    }
    const rest = { ...(message as unknown as Record<string, unknown>) }
    delete rest.tool_calls
    if (hasContent(rest.content) || hasContent(rest.reasoning_content)) {
      return rest as unknown as ChatMessage
    }
    return null
  })

  // 没有空名调用就没有孤儿结果需要连带清理：保持「只动坏的」这条边界。
  if (droppedCalls === 0) return { messages, droppedCalls: 0, droppedResults: 0 }

  // 第二遍：结果消息必须指向一条仍然存在的调用。
  let droppedResults = 0
  const next: ChatMessage[] = []
  for (const message of withNames) {
    if (message === null) continue
    const record = message as unknown as { role?: unknown; tool_call_id?: unknown }
    if (record.role === 'tool') {
      const id = typeof record.tool_call_id === 'string' ? record.tool_call_id : ''
      if (id === '' || !acceptedIds.has(id)) {
        droppedResults += 1
        continue
      }
    }
    next.push(message)
  }

  return { messages: next, droppedCalls, droppedResults }
}