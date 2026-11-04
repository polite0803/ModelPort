import { Transform } from 'stream'

/**
 * 「模型调用了本次请求**没有声明**的工具名」诊断。
 *
 * 2026-11-04 用户报障：客户端收到 `Model generated invalid tool call: finish`，
 * 但网关侧每笔请求都是 200、`endReason=done`、`sawDone=true` —— 流没断、也没被
 * 改写，是上游模型自己造了一个不在 `tools` 里的名字，客户端按自己的工具表拒收。
 *
 * 光看请求日志判不了这个案子：它不记工具名。而这里同时握着两边 ——
 * 请求里的声明集、响应里真正出现的名字 —— 所以把「不一致」这个事实记下来：
 * 下次复发时，日志一句话就能回答「客户端到底声明了 finish 没有」。
 *
 * ⚠️ **纯观测**：不校验、不丢弃、不改写任何响应字节。工具名不是用户内容
 * （与 `channelPack/outboundDump.ts` 同一口径），可以整名落日志。
 */

/** 一行里最多列多少个声明名（超出只留计数，避免把日志行撑成请求体）。 */
const MAX_DECLARED_IN_LINE = 12

/** 同一条 (模型, 越界名) 的告警最小间隔 —— 卡在重试循环里的客户端会每 3 秒复发一次。 */
export const UNDECLARED_TOOL_NAME_COOLDOWN_MS = 5 * 60_000

/**
 * 请求 `tools` 里声明过的函数名。
 *
 * 只认 chat 形状 `{type:'function', function:{name}}`；空名字与其它形状跳过 ——
 * 它们本来就不会出现在发给上游的定义里（`sanitizeChatToolDefinitions` 会删掉），
 * 算进声明集只会制造假阴性。
 */
export function declaredChatToolNames(tools: unknown): Set<string> {
  const names = new Set<string>()
  if (!Array.isArray(tools)) return names
  for (const tool of tools) {
    if (tool === null || typeof tool !== 'object') continue
    const record = tool as { type?: unknown; function?: { name?: unknown } }
    if (record.type !== 'function') continue
    const name = record.function?.name
    if (typeof name !== 'string' || name.trim().length === 0) continue
    names.add(name)
  }
  return names
}

/**
 * 请求 `tools` 里**出现过的**名字（不限形状），用来区分两种完全不同的局面：
 *
 * - 客户端根本没发 `finish` → 名字不在这个集合里，是模型自己造的；
 * - 客户端发了 `finish` 但定义不是 chat 形状（`type:'custom'`、空名占位等）
 *   → 名字在这里、却不在 {@link declaredChatToolNames} 里，说明是**我们**
 *   把它从发给上游的定义里删掉了（`sanitizeChatToolDefinitions`）。
 *
 * 两种情况客户端看到的错误一模一样，日志必须能分开。
 */
export function rawChatToolNames(tools: unknown): Set<string> {
  const names = new Set<string>()
  if (!Array.isArray(tools)) return names
  for (const tool of tools) {
    if (tool === null || typeof tool !== 'object') continue
    const record = tool as { name?: unknown; function?: { name?: unknown } }
    for (const candidate of [record.function?.name, record.name]) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) names.add(candidate)
    }
  }
  return names
}

/** 响应体（非流式）里的工具调用名，按首次出现顺序去重。 */
export function collectToolCallNames(body: unknown): string[] {
  const calls = (body as { choices?: Array<{ message?: { tool_calls?: unknown } }> } | null)
    ?.choices?.[0]?.message?.tool_calls
  return namesOfToolCalls(calls)
}

/** 返回 `names` 里没出现在 `declared` 中的名字（保持顺序、去重）。 */
export function findUndeclaredToolNames(
  names: readonly string[],
  declared: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>()
  const undeclared: string[] = []
  for (const name of names) {
    if (declared.has(name) || seen.has(name)) continue
    seen.add(name)
    undeclared.push(name)
  }
  return undeclared
}

/** 拼一行应用日志。只写名字与计数，不写任何消息内容。 */
export function formatUndeclaredToolNameLine(input: {
  model: string
  offending: readonly string[]
  declared: ReadonlySet<string>
  /** 客户端发过、但定义形状不受 chat 支持因而没下发的名字。 */
  dropped?: readonly string[]
  requestId: string
}): string {
  const declared = [...input.declared]
  const listed = declared.slice(0, MAX_DECLARED_IN_LINE).join(', ')
  const more = declared.length > MAX_DECLARED_IN_LINE
    ? ` 等 ${declared.length} 个`
    : ''
  const dropped = input.dropped !== undefined && input.dropped.length > 0
    ? `；客户端发过但定义未下发：${input.dropped.join(', ')}`
    : ''
  return `工具名越界：${input.model} 返回了未声明的工具 ${input.offending.join(', ')}`
    + `（本次下发的声明：${listed}${more}${dropped}）[request_id: ${input.requestId}]`
}

/**
 * 同一告警的节流器：键是「模型 + 越界名」，冷却期内只放行一次。
 *
 * 进程内内存即可 —— 它只用于压日志，重启丢失无影响。
 */
export class ToolNameAuditLimiter {
  private readonly last = new Map<string, number>()
  private readonly cooldownMs: number

  constructor(cooldownMs: number = UNDECLARED_TOOL_NAME_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs
  }

  /** 冷却期外返回 true 并记下本次时间；冷却期内返回 false。 */
  claim(key: string, now: number = Date.now()): boolean {
    const previous = this.last.get(key)
    if (previous !== undefined && now - previous < this.cooldownMs) return false
    this.last.set(key, now)
    return true
  }
}

export const undeclaredToolNameLimiter = new ToolNameAuditLimiter()

/**
 * SSE 观测 tap：把事件原样透传，只在 `tool_calls[].function.name` 不在声明集里时
 * 回调一次（按名字去重）。
 *
 * 非 `data:` 帧（心跳注释、`[DONE]`、坏 JSON）一律忽略 —— 这是旁路观测，
 * 解析失败绝不能影响客户端收到的字节。
 */
export function createUndeclaredToolNameTap(options: {
  declared: ReadonlySet<string>
  onUndeclared: (offending: string[]) => void
}): Transform {
  let buffer = ''
  const reported = new Set<string>()

  const inspect = (frame: string): void => {
    if (!frame.includes('tool_calls')) return
    const line = frame.split('\n').find(entry => entry.startsWith('data:'))
    if (line === undefined) return
    const payload = line.slice(5).trim()
    if (payload.length === 0 || payload === '[DONE]') return

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }

    const choice = (parsed as { choices?: Array<Record<string, unknown>> } | null)?.choices?.[0]
    if (choice === undefined) return
    const names = [
      ...namesOfToolCalls((choice.delta as { tool_calls?: unknown } | undefined)?.tool_calls),
      // 非流式形状偶尔混进流里（部分上游把整条 message 打在一帧里）。
      ...namesOfToolCalls((choice.message as { tool_calls?: unknown } | undefined)?.tool_calls),
    ]
    const fresh = findUndeclaredToolNames(names, options.declared).filter(name => !reported.has(name))
    if (fresh.length === 0) return
    for (const name of fresh) reported.add(name)
    options.onUndeclared(fresh)
  }

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const text = chunk.toString()
      buffer += text
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        inspect(frame)
        boundary = buffer.indexOf('\n\n')
      }
      // 原样透传，一个字节都不改。
      this.push(text)
      callback()
    },
    flush(callback) {
      if (buffer.trim().length > 0) inspect(buffer)
      buffer = ''
      callback()
    },
  })
}

function namesOfToolCalls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const names: string[] = []
  for (const call of raw) {
    if (call === null || typeof call !== 'object') continue
    const name = (call as { function?: { name?: unknown } }).function?.name
    if (typeof name === 'string' && name.length > 0) names.push(name)
  }
  return names
}