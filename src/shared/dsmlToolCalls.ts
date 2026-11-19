/**
 * DeepSeek 原生 DSML 工具调用语法。
 *
 * 真实形态（2026-11-19 18:02 OpenCode Go 泄漏原文，逐字节核对）：
 *   `<｜DSML｜ calls>`、`<｜DSML｜ invoke name="exec_command">`、
 *   `<｜DSML｜ parameter name="cmd" string="true">…</｜DSML｜ parameter>`、
 *   `</｜DSML｜ invoke>`、`</｜DSML｜ calls>`
 * `｜` 是 U+FF5C 全角竖线；`DSML｜` 之后常带空格；关键字段有 `calls` 与
 * `tool_calls` 两种写法（渠道包 CodeArts 侧用后者）。闭标签同样带 `DSML`。
 *
 * 本模块只做「还原」不做「猜测」：调用方（`dsmlToolCallTap`）负责判断这段正文
 * 是不是整段都是 DSML、调用名是否都在客户端声明集合里；这里只把已闭合的块
 * 解析成 `{ name, arguments }`，解析失败一律返回 undefined。
 */

const BAR = '\uFF5C'
const HEAD = `<${BAR}DSML${BAR}`
const TAIL = `${BAR}`
const CALLS_KEYWORD = '(?:tool_calls|calls)'
const OPEN_AT_START = new RegExp(`^<${BAR}DSML${BAR}\\s*${CALLS_KEYWORD}>`)
const CLOSE_ANYWHERE = new RegExp(`</${BAR}DSML${BAR}\\s*${CALLS_KEYWORD}>`)
const CLOSE_AT_START = new RegExp(`^</${BAR}DSML${BAR}\\s*${CALLS_KEYWORD}>`)
const INVOKE_OPEN = new RegExp(`<${BAR}DSML${BAR}\\s*invoke\\b[^>]*>`, 'g')
const INVOKE_CLOSE = new RegExp(`</${BAR}DSML${BAR}\\s*invoke>`)
const PARAM_OPEN = new RegExp(`<${BAR}DSML${BAR}\\s*parameter\\b[^>]*>`, 'g')
const PARAM_CLOSE = new RegExp(`</${BAR}DSML${BAR}\\s*parameter>`)

export interface DsmlToolCall {
  name: string
  arguments: string
}

/** 文本是否以完整开标签开头；是则返回开标签长度。 */
export function dsmlOpenTokenLength(text: string): number | undefined {
  const match = OPEN_AT_START.exec(text)
  return match === null ? undefined : match[0].length
}

/** 文本是否可能是开标签的前缀（流式判定要按前缀保持缓冲）。 */
export function isDsmlOpenPrefix(text: string): boolean {
  if (text === '') return true
  if (HEAD.startsWith(text)) return true
  if (!text.startsWith(HEAD)) return false
  const rest = text.slice(HEAD.length).replace(/^\s+/, '')
  return ['tool_calls>', 'calls>'].some(keyword => keyword.startsWith(rest))
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
 * 从一段已闭合的 `calls`/`tool_calls` 块解析所有 invoke。
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

export interface DsmlContentEvent {
  text: string
  calls: DsmlToolCall[]
  /** 被整块丢弃的调用数（只在 drop 模式下非零）。 */
  dropped: number
}

export interface DsmlContentFilter {
  push(chunk: string): DsmlContentEvent
  flush(): DsmlContentEvent
  readonly mode: 'probe' | 'dsml' | 'text'
}

/**
 * 两种处置：
 * - `convert`：请求声明了工具 —— 还原成 `tool_calls`，交给客户端执行。
 * - `drop`：请求没有声明工具 —— 这一轮根本没有执行器，还原出来也没人调用，
 *   留着就是把标记渲染给用户。整块丢弃，计数供日志使用。
 */
export type DsmlDisposition = 'convert' | 'drop'

/** 判定阶段的空白缓冲上限；超过就按纯文本放行，绝不无限攒正文。 */
const PROBE_WHITESPACE_CAP = 4096
/** DSML 块未闭合时的缓冲上限；超过说明这不是一次工具调用，按纯文本放行。 */
const DSML_BLOCK_CAP = 1_048_576

/**
 * 流式 DSML 过滤器。
 *
 * 三态：
 * - `probe`：还没放行任何正文。缓冲以 DSML 开标签开头（允许前导空白）则进 `dsml`；
 *   一旦出现非空白正文（或空白超上限）就锁存 `text`，此后逐字放行。
 * - `dsml`：找闭合标签；闭合且可解析才按 `disposition` 处置，否则整块按文本放行并锁存。
 * - `text`：纯文本模式，一个字节都不再改。
 *
 * 因此「模型在讲解 DSML 语法」的回合（前面有正文）永远不受影响。
 */
export function createDsmlContentFilter(
  accept: (call: DsmlToolCall) => boolean = () => true,
  disposition: DsmlDisposition = 'convert',
): DsmlContentFilter {
  let buffer = ''
  let mode: 'probe' | 'dsml' | 'text' = 'probe'
  /** 已吞掉的开标签原文；回吐时必须补回，保证纯文本路径字节完整。 */
  let consumedHead = ''

  const toText = (): DsmlContentEvent => {
    mode = 'text'
    const text = consumedHead + buffer
    consumedHead = ''
    buffer = ''
    return { text, calls: [], dropped: 0 }
  }

  return {
    get mode() { return mode },
    push(chunk: string): DsmlContentEvent {
      if (mode === 'text' || chunk === '') return { text: mode === 'text' ? chunk : '', calls: [], dropped: 0 }
      buffer += chunk
      let text = ''
      let dropped = 0
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
          const headLength = dsmlOpenTokenLength(trimmed)
          if (headLength !== undefined) {
            consumedHead = trimmed.slice(0, headLength)
            buffer = trimmed.slice(headLength)
            mode = 'dsml'
            continue
          }
          if (isDsmlOpenPrefix(trimmed)) break
          const event = toText()
          text += event.text
          break
        }
        // mode === 'dsml'
        const close = CLOSE_ANYWHERE.exec(buffer)
        if (close === null) {
          if (buffer.length > DSML_BLOCK_CAP) {
            const event = toText()
            text += event.text
          }
          break
        }
        const body = buffer.slice(0, close.index)
        const rest = buffer.slice(close.index + close[0].length)
        const parsed = parseDsmlToolCalls(`${consumedHead}${body}${close[0]}`)
        const usable = parsed !== undefined && parsed.length > 0 && parsed.every(call => call.name !== '')
        if (!usable || (disposition === 'convert' && !parsed!.every(accept))) {
          // 解析不了 / 空块 / 名字不在声明集合：整块按原文放行，不猜。
          text += `${consumedHead}${body}${close[0]}`
          consumedHead = ''
          buffer = rest
          const event = toText()
          text += event.text
          break
        }
        if (disposition === 'convert') calls.push(...parsed!)
        else dropped += parsed!.length
        consumedHead = ''
        buffer = rest.replace(/^\s+/, '')
        if (buffer === '') break
        if (dsmlOpenTokenLength(buffer) !== undefined) continue
        if (isDsmlOpenPrefix(buffer)) break
        const event = toText()
        text += event.text
        break
      }
      return { text, calls, dropped }
    },
    flush(): DsmlContentEvent {
      if (mode === 'text' || (buffer === '' && consumedHead === '')) return { text: '', calls: [], dropped: 0 }
      // 未闭合的块：连开标签原文一起回吐，不吞内容。
      const text = consumedHead + buffer
      consumedHead = ''
      buffer = ''
      mode = 'text'
      return { text, calls: [], dropped: 0 }
    },
  }
}

/** 供测试与调用方复用的闭合标签正则（`\s*` 兼容带空格写法）。 */
export const DSML_CLOSE_AT_START = CLOSE_AT_START
/** 开标签在文本开头时的匹配（同时认 `calls` 与 `tool_calls`）。 */
export const DSML_OPEN_AT_START = OPEN_AT_START
/** 导出分隔符，供测试构造真实标记文本。 */
export const DSML_BAR = TAIL