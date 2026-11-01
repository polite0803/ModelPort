import type { ChatMessage } from '../types'

/**
 * 把入站历史里 assistant `tool_calls[].function.arguments` 归成合法 JSON。
 *
 * ## 为什么需要（2026-11-01 实测）
 *
 * 上游对这一格有硬校验：`agnes/agnes-3.0-flash` 收到解析不出的 `arguments` 直接
 * 400 `Assistant tool call function.arguments must be valid JSON.`。抓样里那条历史是
 * `{"command":"Get-ChildItem D:\work | Sort-Object ..."}` —— 模型写 Windows 路径时
 * 只给了一个反斜杠，而 `\w` 在 JSON 里是非法转义。
 *
 * 后果不是"这一轮失败"，而是**这个会话从此每轮都失败**：客户端把上游下发的这份
 * 原样存进历史并每轮回放，于是只要工具调用出现在历史上，之后每一次请求都被拒。
 * 用户看到的是"这个模型一用工具就废"，而那句 400 里没有一个字指向真正坏掉的消息。
 *
 * ## 为什么修在入口而不是逐家上游
 *
 * 与 `normalizeMessageRoles` 同一格：客户端不归我们管，而下游每一家对这一格的
 * 容忍度不同。在入口折一次，聚合/自定义/账号渠道/Anthropic wire 全部下游看到的
 * 就是同一份历史；顺带消掉 `toolFormatConverter` 里那几处无保护 `JSON.parse`
 * 抛 500 的可能。
 *
 * ## 边界
 *
 * - **只动解析不出的**：已经合法的一字节不改（`repaired === 0` 时连数组都是原对象）。
 * - **只动 assistant 的 `tool_calls`**：其余角色上游根本不读这个字段（与
 *   `channelPack/toolCallValidation.ts` 的判据同一口径）。
 * - **只补反斜杠转义这一种坏法**：截断的 JSON、单引号、裸控制字符一律退化成
 *   `{}`（宁可让模型看到一次空参数，也不让整段对话报废），并计入 `discarded`
 *   供调用方写日志 —— 这里不静默吞掉任何东西。
 */
export interface ToolArgumentsNormalization {
  messages: ChatMessage[]
  /** 改写掉的 `function.arguments` 个数（含补转义与空值/非字符串归位） */
  repaired: number
  /** 其中修不了、只能降级成 `{}` 的个数 */
  discarded: number
}

/** JSON 字符串里合法的转义引导字符。 */
const VALID_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

function isJsonObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * 把字符串字面量里非法的 `\x` 补成 `\\x`。
 *
 * 只在字符串内部动手：结构位置的裸反斜杠不是"少转义"，而是模型写坏了结构，
 * 那种交给下面的 `{}` 兜底。`\u` 后面不足 4 位十六进制同样算非法。
 */
function escapeLoneBackslashes(raw: string): string {
  let out = ''
  let inString = false

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]

    if (!inString) {
      if (char === '"') inString = true
      out += char
      continue
    }
    if (char === '"') {
      inString = false
      out += char
      continue
    }
    if (char !== '\\') {
      out += char
      continue
    }

    const next = raw[i + 1]
    if (next === undefined) {
      out += '\\\\'
      continue
    }
    if (VALID_ESCAPES.has(next)) {
      if (next === 'u' && !/^[0-9a-fA-F]{4}/.test(raw.slice(i + 2, i + 6))) {
        out += '\\\\'
        continue
      }
      out += char + next
      i += 1
      continue
    }
    out += '\\\\'
  }

  return out
}

function normalizeValue(value: unknown): { arguments: string; repaired: boolean; discarded: boolean } {
  if (typeof value === 'string') {
    if (isJsonObject(value)) return { arguments: value, repaired: false, discarded: false }
    if (value.trim().length === 0) return { arguments: '{}', repaired: true, discarded: false }

    const escaped = escapeLoneBackslashes(value)
    if (isJsonObject(escaped)) return { arguments: escaped, repaired: true, discarded: false }

    return { arguments: '{}', repaired: true, discarded: true }
  }

  // `null`/缺字段是"无参数工具"的另一种写法；对象/数组是客户端把参数直接塞成
  // 了结构体。前者补成 `{}`，后者序列化后仍要求它是个 JSON 对象。
  if (value === undefined || value === null) return { arguments: '{}', repaired: true, discarded: false }

  const serialized = JSON.stringify(value)
  if (serialized !== undefined && isJsonObject(serialized)) {
    return { arguments: serialized, repaired: true, discarded: false }
  }
  return { arguments: '{}', repaired: true, discarded: true }
}

export function normalizeToolCallArguments(messages: ChatMessage[]): ToolArgumentsNormalization {
  if (!Array.isArray(messages)) return { messages, repaired: 0, discarded: 0 }

  let repaired = 0
  let discarded = 0

  const next = messages.map((message) => {
    const record = message as unknown as { role?: unknown; tool_calls?: unknown }
    if (record.role !== 'assistant' || !Array.isArray(record.tool_calls)) return message

    let changed = false
    const toolCalls = record.tool_calls.map((call) => {
      const fn = (call as { function?: unknown } | null)?.function
      if (fn === null || typeof fn !== 'object') return call

      const { arguments: args, repaired: didRepair, discarded: didDiscard } = normalizeValue(
        (fn as { arguments?: unknown }).arguments,
      )
      if (!didRepair) return call

      changed = true
      repaired += 1
      if (didDiscard) discarded += 1
      return { ...(call as object), function: { ...(fn as object), arguments: args } }
    })

    if (!changed) return message
    return { ...(message as object), tool_calls: toolCalls } as ChatMessage
  })

  if (repaired === 0) return { messages, repaired: 0, discarded: 0 }
  return { messages: next, repaired, discarded }
}
