import { looksLikeTruncatedToolArguments } from '../../../shared/truncatedToolArguments.ts'

/**
 * 非流式 chat 响应里的截断工具调用剪枝。
 *
 * 流式那条没法撤回（帧已经发给客户端），非流式这条还能在交付前改：把
 * `arguments` 是截断 JSON 的 `function` 调用整条摘掉，客户端这一轮就"没有工具可执行"，
 * 会按自己的策略重试，而不是执行半个补丁。
 *
 * 只摘 `type:'function'`：自由文本工具在 chat 形状里同样是 function（`{"input":"…"}`），
 * 由同一把尺 `looksLikeTruncatedToolArguments` 判，不需要第二套分支。
 *
 * 返回新对象，绝不改入参 —— 上层的日志/审计还在读原始 body。
 */
export interface TruncatedToolCallPrune {
  body: unknown
  /** 摘掉的调用条数；0 表示入参原样可用 */
  dropped: number
}

export function pruneTruncatedToolCalls(body: unknown): TruncatedToolCallPrune {
  if (body === null || typeof body !== 'object') return { body, dropped: 0 }
  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return { body, dropped: 0 }

  let dropped = 0
  const nextChoices = choices.map(choice => {
    if (choice === null || typeof choice !== 'object') return choice
    const record = choice as Record<string, unknown>
    const message = record.message
    if (message === null || typeof message !== 'object') return choice
    const messageRecord = message as Record<string, unknown>
    const toolCalls = messageRecord.tool_calls
    if (!Array.isArray(toolCalls)) return choice

    const kept = toolCalls.filter(call => !isTruncatedFunctionCall(call))
    dropped += toolCalls.length - kept.length
    if (kept.length === toolCalls.length) return choice

    const nextMessage: Record<string, unknown> = { ...messageRecord }
    // 全被摘掉时删键而不是留空数组：多数客户端把 `tool_calls: []` 当"声明了但没调"，
    // 缺键才是"这一轮没有工具调用"。
    if (kept.length === 0) delete nextMessage.tool_calls
    else nextMessage.tool_calls = kept
    return { ...record, message: nextMessage }
  })

  return dropped === 0 ? { body, dropped } : { body: { ...(body as object), choices: nextChoices }, dropped }
}

function isTruncatedFunctionCall(call: unknown): boolean {
  if (call === null || typeof call !== 'object') return false
  const record = call as Record<string, unknown>
  if (record.type !== 'function') return false
  const fn = record.function
  if (fn === null || typeof fn !== 'object') return false
  return looksLikeTruncatedToolArguments((fn as { arguments?: unknown }).arguments)
}