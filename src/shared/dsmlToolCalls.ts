/**
 * 模型「自己发明」的工具调用文本：两种已知格式，都还原成标准调用。
 *
 * 成因：上游没有拿到可用的 `tools` 声明（或宿主解析失败）时，DeepSeek 系模型会把
 * 调用写成可读文本而不是结构化 `tool_calls`。实测两种：
 *
 * 1. **DSML**（DeepSeek 原生特殊 token，OpenCode Go 2026-11-19 18:02 泄漏原文）：
 *    `<｜DSML｜ calls>` / `<｜DSML｜ invoke name="exec_command">` /
 *    `<｜DSML｜ parameter name="cmd" string="true">…</｜DSML｜ parameter>` /
 *    `</｜DSML｜ invoke>` / `</｜DSML｜ calls>`。
 *    `｜` 是 U+FF5C 全角竖线；`DSML｜` 后可带空格；关键字有 `calls` 与 `tool_calls`
 *    两种写法（渠道包 CodeArts 用后者）。
 *
 * 2. **`<tool_call>` JSON**（relayai 一类「模拟工具」网关的约定格式，实测空工具集
 *    时出现）：`<tool_call>{"name":"…","arguments":{…}}</tool_call>`，也接受
 *    Anthropic 风格的 `{"name":…,"input":{…}}`。
 *
 * 处置是**还原**不是丢弃：两种格式都携带完整意图（工具名 + 参数），丢掉等于把
 * 模型已经做出的决定作废，客户端只会看到空回复。调用方负责判断这段正文是不是
 * 整段都是标记、以及调用名是否在声明集合里；本模块只做解析与流式切分。
 */

const BAR = '\uFF5C'
const HEAD = `<${BAR}DSML${BAR}`
const CALLS_KEYWORD = '(?:tool_calls|calls)'
const OPEN_AT_START = new RegExp(`^<${BAR}DSML${BAR}\\s*${CALLS_KEYWORD}>`)
const CLOSE_ANYWHERE = new RegExp(`</${BAR}DSML${BAR}\\s*${CALLS_KEYWORD}>`)
const CLOSE_AT_START = new RegExp(`^</${BAR}DSML${BAR}\\s*${CALLS_KEYWORD}>`)
const INVOKE_OPEN = new RegExp(`<${BAR}DSML${BAR}\\s*invoke\\b[^>]*>`, 'g')
const INVOKE_CLOSE = new RegExp(`</${BAR}DSML${BAR}\\s*invoke>`)
const PARAM_OPEN = new RegExp(`<${BAR}DSML${BAR}\\s*parameter\\b[^>]*>`, 'g')
const PARAM_CLOSE = new RegExp(`</${BAR}DSML${BAR}\\s*parameter>`)

/** `<tool_call>` JSON 形态：开标签与闭标签。 */
const TOOL_CALL_OPEN = '<tool_call>'
const TOOL_CALL_CLOSE = '</tool_call>'

export interface DsmlToolCall {
  name: string
  arguments: string
}

/** 文本是否以完整 DSML 开标签开头；是则返回开标签长度。 */
export function dsmlOpenTokenLength(text: string): number | undefined {
  const match = OPEN_AT_START.exec(text)
  return match === null ? undefined : match[0].length
}

/** 文本是否可能是 DSML 开标签的前缀（流式判定要按前缀保持缓冲）。 */
export function isDsmlOpenPrefix(text: string): boolean {
  if (text === '') return true
  if (HEAD.startsWith(text)) return true
  if (!text.startsWith(HEAD)) return false
  const rest = text.slice(HEAD.length).replace(/^\s+/, '')
  return ['tool_calls>', 'calls>'].some(keyword => keyword.startsWith(rest))
}

/** 文本是否以完整 `<tool_call>` 开标签开头。 */
export function toolCallOpenTokenLength(text: string): number | undefined {
  return text.startsWith(TOOL_CALL_OPEN) ? TOOL_CALL_OPEN.length : undefined
}

/** 文本是否可能是 `<tool_call>` 的前缀。 */
export function isToolCallOpenPrefix(text: string): boolean {
  if (text === '') return true
  return TOOL_CALL_OPEN.startsWith(text)
}

/**
 * 把 DSML 文本值还原成原始类型。模型（尤其 pro）会把数字/布尔参数标成
 * `string="true"`、或用 JSON 字符串包一层；这里按字面量还原，普通文本
 * （路径、正文）保持字符串。
 */
function tryParseScalar(value: string): unknown {
  if (value === '') return ''
  const trimmed = value.trim()
  if (trimmed === '') return value
  if (trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const decoded = JSON.parse(trimmed) as unknown
      if (typeof decoded === 'string') return tryParseScalar(decoded)
      return decoded
    } catch { /* 非合法 JSON 字符串字面量，按原样处理 */ }
  }
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed) } catch { /* 非合法 JSON，保持字符串 */ }
  }
  return value
}

function parseDsmlInvoke(block: string): DsmlToolCall | undefined {
  const nameMatch = /name\s*=\s*"([^"]*)"/.exec(block)
  if (nameMatch === null) return undefined
  const params: Record<string, unknown> = {}
  PARAM_OPEN.lastIndex = 0
  for (;;) {
    const open = PARAM_OPEN.exec(block)
    if (open === null) break
    const paramNameMatch = /name\s*=\s*"([^"]*)"/.exec(open[0])
    if (paramNameMatch === null) continue
    const valueStart = PARAM_OPEN.lastIndex
    const closeMatch = PARAM_CLOSE.exec(block.slice(valueStart))
    if (closeMatch === null) break
    const value = block.slice(valueStart, valueStart + closeMatch.index)
    const isString = /string\s*=\s*"true"/.test(open[0])
    if (isString) {
      params[paramNameMatch[1]] = tryParseScalar(value)
    } else {
      try {
        const parsed = JSON.parse(value)
        params[paramNameMatch[1]] = typeof parsed === 'string' ? tryParseScalar(parsed) : parsed
      } catch { params[paramNameMatch[1]] = value }
    }
    PARAM_OPEN.lastIndex = valueStart + closeMatch.index + closeMatch[0].length
  }
  return { name: nameMatch[1], arguments: JSON.stringify(params) }
}

/**
 * 从一段已闭合的 DSML `calls`/`tool_calls` 块解析所有 invoke。
 * 返回 undefined 表示解析失败（调用方应回退为纯文本），空数组表示块内没有调用。
 */
export function parseDsmlToolCalls(block: string): DsmlToolCall[] | undefined {
  const open = OPEN_AT_START.exec(block)
  if (open === null) return undefined
  const close = CLOSE_ANYWHERE.exec(block)
  if (close === null) return undefined
  const inner = block.slice(open[0].length, close.index)
  const calls: DsmlToolCall[] = []
  INVOKE_OPEN.lastIndex = 0
  for (;;) {
    const invokeOpen = INVOKE_OPEN.exec(inner)
    if (invokeOpen === null) break
    const from = INVOKE_OPEN.lastIndex
    const invokeClose = INVOKE_CLOSE.exec(inner.slice(from))
    if (invokeClose === null) return undefined
    const parsed = parseDsmlInvoke(inner.slice(invokeOpen.index, from + invokeClose.index + invokeClose[0].length))
    if (parsed === undefined) return undefined
    calls.push(parsed)
    INVOKE_OPEN.lastIndex = from + invokeClose.index + invokeClose[0].length
  }
  return calls
}

/**
 * 解析一段已闭合的 `<tool_call>…</tool_call>`。
 *
 * 支持三种内层写法（都是实测/文档里出现过的）：
 * - `{"name":"x","arguments":{...}}`（relayai 约定）
 * - `{"name":"x","input":{...}}`（Anthropic 风格）
 * - `{"tool":"x","parameters":{...}}`
 * 参数已是对象就原样序列化；是字符串且看起来是 JSON 就解析后再序列化，
 * 否则当作自由文本包进 `input`（freeform 工具的形态）。
 */
export function parseToolCallBlock(block: string): DsmlToolCall[] | undefined {
  if (!block.startsWith(TOOL_CALL_OPEN)) return undefined
  const closeIndex = block.indexOf(TOOL_CALL_CLOSE, TOOL_CALL_OPEN.length)
  if (closeIndex === -1) return undefined
  const inner = block.slice(TOOL_CALL_OPEN.length, closeIndex).trim()
  if (inner === '') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(inner)
  } catch {
    return undefined
  }
  const items = Array.isArray(parsed) ? parsed : [parsed]
  const calls: DsmlToolCall[] = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') return undefined
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string'
      ? record.name
      : typeof record.tool === 'string' ? record.tool : ''
    if (name === '') return undefined
    const raw = record.arguments ?? record.input ?? record.parameters
    calls.push({ name, arguments: normalizeArguments(raw) })
  }
  return calls.length > 0 ? calls : undefined
}

function normalizeArguments(raw: unknown): string {
  if (raw === undefined || raw === null) return '{}'
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (parsed !== null && typeof parsed === 'object') return JSON.stringify(parsed)
      } catch { /* 不是合法 JSON：按自由文本处理 */ }
    }
    // 自由文本参数（freeform 工具的原文）：包成 `input`，与 responses 侧同一形状。
    return JSON.stringify({ input: raw })
  }
  if (typeof raw === 'object') return JSON.stringify(raw)
  return JSON.stringify({ input: String(raw) })
}

export interface DsmlContentEvent {
  text: string
  calls: DsmlToolCall[]
}

export interface DsmlContentFilter {
  push(chunk: string): DsmlContentEvent
  flush(): DsmlContentEvent
  readonly mode: 'probe' | 'dsml' | 'toolcall' | 'text'
}

/** 判定阶段的空白缓冲上限；超过就按纯文本放行，绝不无限攒正文。 */
const PROBE_WHITESPACE_CAP = 4096
/** 标记块未闭合时的缓冲上限；超过说明这不是一次工具调用，按纯文本放行。 */
const BLOCK_CAP = 1_048_576

/**
 * 流式过滤器：把「整体就是一个调用块」的正文切成标准调用。
 *
 * 四态：
 * - `probe`：还没放行任何正文。缓冲以 DSML 开标签或 `<tool_call>` 开头（允许前导
 *   空白）则进对应块态；一旦出现非空白正文（或空白超上限）就锁存 `text`，此后逐字放行。
 * - `dsml` / `toolcall`：找对应闭标签；闭合且可解析才产出调用，否则整块按文本放行并锁存。
 * - `text`：纯文本模式，一个字节都不再改。
 *
 * 因此「模型在讲解这些语法」的回合（前面有正文）永远不受影响。
 */
export function createDsmlContentFilter(
  accept: (call: DsmlToolCall) => boolean = () => true,
): DsmlContentFilter {
  let buffer = ''
  let mode: 'probe' | 'dsml' | 'toolcall' | 'text' = 'probe'
  /** 已吞掉的开标签原文；回吐时必须补回，保证纯文本路径字节完整。 */
  let consumedHead = ''

  const toText = (): DsmlContentEvent => {
    mode = 'text'
    const text = consumedHead + buffer
    consumedHead = ''
    buffer = ''
    return { text, calls: [] }
  }

  return {
    get mode() { return mode },
    push(chunk: string): DsmlContentEvent {
      if (mode === 'text' || chunk === '') return { text: mode === 'text' ? chunk : '', calls: [] }
      buffer += chunk
      let text = ''
      const calls: DsmlToolCall[] = []
      for (;;) {
        if (mode === 'probe') {
          const lead = /^\s*/.exec(buffer)![0]
          const trimmed = buffer.slice(lead.length)
          if (trimmed === '') {
            if (buffer.length <= PROBE_WHITESPACE_CAP) break
            const event = toText()
            text += event.text
            break
          }
          const dsmlLength = dsmlOpenTokenLength(trimmed)
          if (dsmlLength !== undefined) {
            consumedHead = trimmed.slice(0, dsmlLength)
            buffer = trimmed.slice(dsmlLength)
            mode = 'dsml'
            continue
          }
          const jsonLength = toolCallOpenTokenLength(trimmed)
          if (jsonLength !== undefined) {
            consumedHead = trimmed.slice(0, jsonLength)
            buffer = trimmed.slice(jsonLength)
            mode = 'toolcall'
            continue
          }
          if (isDsmlOpenPrefix(trimmed) || isToolCallOpenPrefix(trimmed)) break
          const event = toText()
          text += event.text
          break
        }
        // mode === 'dsml' | 'toolcall'
        const close = mode === 'dsml' ? CLOSE_ANYWHERE.exec(buffer) : (() => {
          const index = buffer.indexOf(TOOL_CALL_CLOSE)
          return index === -1 ? null : { index, 0: TOOL_CALL_CLOSE } as unknown as RegExpExecArray
        })()
        if (close === null) {
          if (buffer.length > BLOCK_CAP) {
            const event = toText()
            text += event.text
          }
          break
        }
        const rest = buffer.slice(close.index + close[0].length)
        const block = `${consumedHead}${buffer.slice(0, close.index + close[0].length)}`
        const parsed = mode === 'dsml' ? parseDsmlToolCalls(block) : parseToolCallBlock(block)
        const usable = parsed !== undefined && parsed.length > 0 && parsed.every(call => call.name !== '')
        if (!usable || !parsed!.every(accept)) {
          // 解析不了 / 空块 / 名字不在声明集合：整块按原文放行，不猜。
          text += block
          consumedHead = ''
          buffer = rest
          const event = toText()
          text += event.text
          break
        }
        calls.push(...parsed!)
        consumedHead = ''
        buffer = rest.replace(/^\s+/, '')
        if (buffer === '') {
          mode = 'probe'
          break
        }
        if (dsmlOpenTokenLength(buffer) !== undefined) { mode = 'dsml'; continue }
        if (toolCallOpenTokenLength(buffer) !== undefined) { mode = 'toolcall'; continue }
        if (isDsmlOpenPrefix(buffer) || isToolCallOpenPrefix(buffer)) {
          mode = 'probe'
          break
        }
        const event = toText()
        text += event.text
        break
      }
      return { text, calls }
    },
    flush(): DsmlContentEvent {
      if (mode === 'text' || (buffer === '' && consumedHead === '')) return { text: '', calls: [] }
      // 未闭合的块：连开标签原文一起回吐，不吞内容。
      const text = consumedHead + buffer
      consumedHead = ''
      buffer = ''
      mode = 'text'
      return { text, calls: [] }
    },
  }
}

/** 供测试与调用方复用的闭合标签正则（`\s*` 兼容带空格写法）。 */
export const DSML_CLOSE_AT_START = CLOSE_AT_START
/** 开标签在文本开头时的匹配（同时认 `calls` 与 `tool_calls`）。 */
export const DSML_OPEN_AT_START = OPEN_AT_START
/** 导出分隔符，供测试构造真实标记文本。 */
export const DSML_BAR = BAR
/** JSON 形态的开/闭标签，供测试与调用方引用。 */
export const TOOL_CALL_TAGS = { open: TOOL_CALL_OPEN, close: TOOL_CALL_CLOSE }

/**
 * 残缺的调用标记：**只有闭合标签、没有开标签**。
 *
 * 实测形态（2026-11-19 18:55–19:02，Codex 会话 `rollout-2026-11-20T02-49-26…` 里
 * 6 条 assistant 消息，258–430 字）：
 *
 *   ...现在补两张硬证据：当前 1.5.2 构建/测试是否干净…
 *   </｜DSML｜ parameter>
 *   </｜DSML｜ invoke>
 *   </｜DSML｜ calls>
 *
 * 6 条里含开标签的是 **0 条**，也没有任何 `parameter name="…"`：模型想调用工具，
 * 但生成的开标签与全部参数都没送到客户端，只剩三个闭合符号。正文里那段说明是
 * 有效内容，因此处置是**剥掉残片、保留正文**，而不是整发丢弃 —— 这些标签不含任何
 * 可执行信息，任何解析器都无法从中还原「调哪个工具、传什么参数」。
 *
 * 判据刻意窄：必须同时出现 `parameter`、`invoke`、`calls` 三个闭合标签才算，
 * 避免误伤正文里偶尔提到的单个词。
 */
const DANGLING_CLOSERS = new RegExp(
  `(?:\\s*</${BAR}DSML${BAR}\\s*parameter>\\s*</${BAR}DSML${BAR}\\s*invoke>\\s*</${BAR}DSML${BAR}\\s*${CALLS_KEYWORD}>)+\\s*$`,
)

/** 尾部是否挂着残缺的闭合标签组。 */
export function hasDanglingCallClosers(text: string): boolean {
  return DANGLING_CLOSERS.test(text)
}

/**
 * 从正文尾部剥掉残缺的闭合标签组；返回新字符串，正文其余部分逐字保留。
 * 没有残片时原样返回同一个字符串（调用方可用引用相等判断是否改动）。
 */
export function stripDanglingCallClosers(text: string): string {
  if (!hasDanglingCallClosers(text)) return text
  return text.replace(DANGLING_CLOSERS, '').replace(/\s+$/, '')
}