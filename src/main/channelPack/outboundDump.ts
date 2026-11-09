/**
 * 渠道包**出站请求体**取证开关（用户报障 2026-11-01：WorkBuddy 客户端走 auto，
 * 命中的 `buddy/hy3` 连续回答「末尾没有具体的用户指令——没有 `<user_query>`」）。
 *
 * ## 为什么必须另开一条取证通道
 *
 * 请求日志结构性地看不见这个案发现场，两堵墙叠在一起：
 * - `requestLogConfig.maxBodyChars`（默认 20 万）**从头部**截断，真实请求体 200KB+
 *   时尾部（最后一条 user 消息）永远不落盘，而 `tool_calls` 与新指令恰恰都在尾部；
 * - 日志记的是**客户端 → 宿主**那一段，而投诉发生在**宿主 → 渠道包 → 上游**之后，
 *   中间隔着 worker 线程与 pack 的两轮改写（`toGenerateOptions` 的 OpenAI→harness
 *   转换、各适配器的 `serializeMessages`），出站形状没有任何留存。
 *
 * 所以这里只记**摘要**：每条消息的 role、文本长度、**末尾若干字符**、工具调用坐标。
 * 用户正文一律不落盘（末尾片段是按案发现场需要刻意保留的最小证据），
 * 关掉开关（默认）时一个字节都不写。
 *
 * ## 开关
 *
 * `MODELPORT_CHANNEL_PACK_DUMP`（主进程环境变量，经 `bridge.ts` 的
 * `...process.env` 透传给 worker）：
 * - 未设置 / `0`：关闭；
 * - `1` / `true` / `on`：写 `<dataDir>/channel-pack/outbound-dump.ndjson`；
 * - 其它值：按**文件路径**处理，写该路径。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 单条消息保留的末尾字符数（够判断「尾巴是不是那条 `<user_query>`」）。 */
export const DUMP_TAIL_CHARS = 200

/** 一次请求最多摘要多少条消息；超出只记条数，防止超长会话把取证文件写成日志洪水。 */
export const DUMP_MAX_MESSAGES = 400

export interface OutboundMessageSummary {
  /** 在数组里的下标（出站顺序就是这里顺序）。 */
  i: number
  role: string
  /** 该条消息的纯文本长度（不含工具调用的 arguments 文本）。 */
  chars: number
  /** 文本末尾至多 {@link DUMP_TAIL_CHARS} 字符 —— 证据，不是全文。 */
  tail: string
  /** 本条发起的工具调用数（OpenAI `tool_calls` / harness `tool-call` 块）。 */
  toolCalls?: number
  /** 工具调用名（名称不含用户内容，直接留全）。 */
  toolNames?: string[]
  /** `role:'tool'` / `tool-result` 的归属调用 id。 */
  toolCallId?: string
  /** harness 形状的块类型序列，例如 `['reasoning','text','tool-call']`。 */
  blocks?: string[]
}

export interface OutboundDumpRecord {
  ts: number
  requestId: string
  /** 交给渠道包的模型 id（`<channel>/<model>`）。 */
  model: string
  stream: boolean
  /** 宿主收到的 OpenAI 形状。 */
  openAi: OutboundMessageSummary[]
  /** `toGenerateOptions` 之后的 harness 形状 —— 适配器就是拿它去序列化上游请求。 */
  harness: OutboundMessageSummary[]
  openAiChars: number
  harnessChars: number
  /** 超过 {@link DUMP_MAX_MESSAGES} 时未逐条摘要的条数。 */
  overflow?: number
}

/** 解析开关值 → 落盘路径；`null` 表示关闭。`fileName` 供同目录的其它取证通道复用约定。 */
export function resolveDumpTarget(envValue: string | undefined, dataDir: string, fileName = 'outbound-dump.ndjson'): string | null {
  const raw = envValue?.trim()
  if (!raw || raw === '0') return null
  if (/^(1|true|on|yes)$/i.test(raw)) return join(dataDir, 'channel-pack', fileName)
  return raw
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

/** 把 content（字符串 / 多模态 parts / harness 块数组）里的文本拼出来。 */
function textOf(content: unknown): string {
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

/** 一条消息的通用摘要（OpenAI 与 harness 两种形状共用）。 */
function summarize(index: number, raw: unknown, tailChars: number): OutboundMessageSummary {
  const record = asRecord(raw)
  if (!record) {
    return { i: index, role: 'unknown', chars: 0, tail: '' }
  }
  const role = typeof record.role === 'string' ? record.role : 'unknown'
  const content = record.content
  const text = textOf(content)
  const summary: OutboundMessageSummary = {
    i: index,
    role,
    chars: text.length,
    tail: text.slice(-tailChars),
  }

  // OpenAI 形状：assistant.tool_calls / tool.tool_call_id
  const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : undefined
  if (toolCalls && toolCalls.length > 0) {
    summary.toolCalls = toolCalls.length
    summary.toolNames = toolCalls.map((raw) => {
      const call = asRecord(raw)
      const fn = call ? asRecord(call.function) : null
      const name = fn?.name ?? call?.name
      return typeof name === 'string' ? name : '?'
    })
  }
  if (typeof record.tool_call_id === 'string') summary.toolCallId = record.tool_call_id

  // harness 形状：content 是块数组（text / reasoning / tool-call / tool-result / image）
  if (Array.isArray(content)) {
    const blocks: string[] = []
    let callCount = 0
    const callNames: string[] = []
    let resultCallId: string | undefined
    for (const block of content) {
      const item = asRecord(block)
      const type = item && typeof item.type === 'string' ? item.type : 'unknown'
      blocks.push(type)
      if (type === 'tool-call') {
        callCount += 1
        callNames.push(typeof item?.name === 'string' ? item.name : '?')
      }
      if (type === 'tool-result' && typeof item?.toolCallId === 'string') {
        resultCallId = item.toolCallId
      }
    }
    if (blocks.length > 0) summary.blocks = blocks
    if (callCount > 0) {
      summary.toolCalls = callCount
      summary.toolNames = callNames
    }
    if (resultCallId !== undefined) summary.toolCallId = resultCallId
  }

  return summary
}

function summarizeAll(messages: readonly unknown[], tailChars: number): {
  summaries: OutboundMessageSummary[]
  chars: number
} {
  const taken = messages.slice(0, DUMP_MAX_MESSAGES)
  const summaries = taken.map((message, index) => summarize(index, message, tailChars))
  return { summaries, chars: summaries.reduce((total, item) => total + item.chars, 0) }
}

/** 组装一次出站请求的取证记录（纯函数，不发盘）。 */
export function summarizeOutbound(input: {
  ts: number
  requestId: string
  model: string
  stream: boolean
  openAiMessages: readonly unknown[]
  harnessMessages: readonly unknown[]
  tailChars?: number
}): OutboundDumpRecord {
  const tailChars = input.tailChars ?? DUMP_TAIL_CHARS
  const openAi = summarizeAll(input.openAiMessages, tailChars)
  const harness = summarizeAll(input.harnessMessages, tailChars)
  const overflow = Math.max(0, Math.max(input.openAiMessages.length, input.harnessMessages.length) - DUMP_MAX_MESSAGES)
  return {
    ts: input.ts,
    requestId: input.requestId,
    model: input.model,
    stream: input.stream,
    openAi: openAi.summaries,
    harness: harness.summaries,
    openAiChars: openAi.chars,
    harnessChars: harness.chars,
    ...(overflow > 0 ? { overflow } : {}),
  }
}

/**
 * 追加一行。写失败**只回错误文本**，绝不抛：取证开关不许把一次正常请求变成 500
 * （磁盘满、路径不可写、权限都不该影响聊天）。
 */
export function appendOutboundDump(
  path: string,
  record: OutboundDumpRecord,
  onWarn: (message: string) => void,
): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf-8')
  } catch (error) {
    onWarn(`出站取证写入失败（不影响本次请求）：${error instanceof Error ? error.message : String(error)}`)
  }
}
