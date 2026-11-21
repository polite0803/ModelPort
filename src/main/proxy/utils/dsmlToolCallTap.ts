import { Transform } from 'stream'
import {
  createDsmlContentFilter,
  stripDanglingCallClosers,
  type DsmlContentFilter,
  type DsmlToolCall,
} from '../../../shared/dsmlToolCalls.ts'

/** 尾部暂留上限：够覆盖一组残缺闭合标签（三个标签约 60–80 字），再多就发。 */
const TAIL_HOLD_LIMIT = 120

/** 残缺闭合标签的开头；只有出现它的前缀才值得暂留，避免暂留正常正文里的 `<`。 */
const CLOSER_ANCHOR = '</\uFF5CDSML\uFF5C'
/** 开标签开头：正文里若正在形成完整调用块，同样要暂留（那一支由过滤器处理）。 */
const OPENER_ANCHOR = '<\uFF5CDSML\uFF5C'

/** 文本尾部可能是标记开头的最长长度；0 表示不需要暂留。 */
function holdPointOf(text: string): number {
  const max = Math.min(Math.max(CLOSER_ANCHOR.length, OPENER_ANCHOR.length) + 60, text.length)
  for (let length = max; length >= 1; length -= 1) {
    // 尾巴里的空白算在标记前面：残片真实形态是 `\n</｜DSML｜ parameter>`。
    const tail = text.slice(text.length - length).replace(/^\s+/, '')
    if (tail === '') continue
    if (CLOSER_ANCHOR.startsWith(tail) || OPENER_ANCHOR.startsWith(tail)) return length
    if (tail.startsWith(CLOSER_ANCHOR)) return Math.min(length, TAIL_HOLD_LIMIT)
  }
  return 0
}

export interface DsmlTapReport {
  /** 从正文还原成 tool_calls 的条数。 */
  convertedCalls: number
  convertedNames: string[]
  /** 收尾帧是补出来的（上游给了 [DONE] 却没有 finish_reason）。 */
  synthesizedFinish?: 'stop' | 'tool_calls'
  /** 正文尾部挂着残缺的闭合标签，已剥掉（这一轮按退化记）。 */
  danglingStripped?: boolean
}

export interface DsmlToolCallTapOptions {
  /** 客户端本次声明的工具名；模型造出的名字不在其中时仍会还原（见下方说明）。 */
  declared: ReadonlySet<string>
  onReport?: (report: DsmlTapReport) => void
}

/**
 * chat SSE 泳道里「模型用文本写出的工具调用」的还原。
 *
 * 两种格式（见 `shared/dsmlToolCalls.ts`）：DSML 原生标记、`<tool_call>` JSON。
 * 成因是模型没拿到可用工具声明时自己发明调用语法，因此**一律还原成
 * `tool_calls`**：文本里带着完整意图（名字 + 参数），丢掉等于把模型的决策作废，
 * 客户端只会看到空回复；还原后至少有一个可执行对象，名字对不上时客户端会以
 * 明确的 `unknown tool` 失败，那是可解释的结果。
 *
 * 形态判据（与供应商无关，只看响应本身）：正文在出现任何非空白前就进入调用块，
 * 且块后除空白/下一个块外没有正文 —— 带前言、讲解语法的回合一律锁存为纯文本，
 * 逐字节原样放行。
 *
 * 还原出的调用帧**暂存到收尾前**才下发：上游若在正文之后又给了结构化调用，
 * 暂存的这份就是同一意图的重复，直接丢弃 —— 否则一次写入会被执行两遍。
 *
 * 另修一种上游收尾缺陷：整条流给了 `[DONE]` 却没有任何 `finish_reason` 时，
 * 按已交付内容补一个结束帧（有调用 → `tool_calls`，否则 `stop`）。
 */
export function createDsmlToolCallTap(options: DsmlToolCallTapOptions): Transform {
  // declared 只用于「越界审计」的语义对齐；还原本身不看它 —— 见上：丢掉比还原更糟。
  const accept = (call: DsmlToolCall): boolean => call.name !== ''
  const filters = new Map<number, DsmlContentFilter>()

  let buffer = ''
  let meta: { id?: unknown; object?: unknown; created?: unknown; model?: unknown } | undefined
  let sawToolCalls = false
  let conversionDisabled = false
  let finishSeen = false
  let doneSeen = false
  let contentDelivered = false
  let convertedCalls = 0
  let callIndex = 0
  /** 已还原、尚未下发的调用帧。 */
  let pendingCalls = ''
  const convertedNames: string[] = []
  let synthesizedFinish: 'stop' | 'tool_calls' | undefined
  let reported = false
  /** 尾部暂留的正文：可能是残缺闭合标签的开头，攒到能判为止。 */
  let tailHold = ''
  /** 这一轮剥掉了残缺闭合标签 —— 要按退化记。 */
  let danglingStripped = false

  /**
   * 正文要发了，但尾部可能正在形成残缺的闭合标签组（`</｜DSML｜ parameter>` …）。
   *
   * 实测形态是「一段正常正文 + 三个闭合标签，没有开标签、没有 invoke」：那些标签
   * 不含任何可执行信息，交付给客户端只会像标记泄漏一样污染对话。所以把可能是
   * 标签开头的尾巴（最多 120 字）暂留，攒够或流结束再决定发不发。
   *
   * 返回该发出去的文本（可能比入参短，也可能为空）。
   */
  const emitContentText = (incoming: string): string => {
    let text = incoming
    if (tailHold !== '') {
      text = tailHold + text
      tailHold = ''
    }
    const cut = holdPointOf(text)
    if (cut > 0) {
      tailHold = text.slice(text.length - cut)
      text = text.slice(0, text.length - cut)
    }
    if (text !== '') contentDelivered = true
    return text
  }

  /**
   * 收尾：把暂留的尾巴决定掉 —— 是残片就剥，不是就补发。
   *
   * 返回**纯文本**（不再包帧）：调用方要在同一个事件里把它并回正文，
   * 或在自己那一帧里下发；单独成一帧会让「正文还在流」的客户端读成两段。
   */
  const flushTailText = (): string => {
    if (tailHold === '') return ''
    const held = tailHold
    tailHold = ''
    const stripped = stripDanglingCallClosers(held)
    if (stripped !== held) {
      danglingStripped = true
      return stripped
    }
    return held
  }

  const filterFor = (index: number): DsmlContentFilter => {
    let filter = filters.get(index)
    if (filter === undefined) {
      filter = createDsmlContentFilter(accept)
      filters.set(index, filter)
    }
    return filter
  }

  const frame = (index: number, delta: Record<string, unknown>, finish?: string): string => {
    const payload: Record<string, unknown> = {
      id: meta?.id ?? 'chatcmpl-dsml',
      object: meta?.object ?? 'chat.completion.chunk',
      created: meta?.created ?? 0,
      model: meta?.model ?? '',
      choices: [{ index, delta, ...(finish === undefined ? {} : { finish_reason: finish }) }],
    }
    return `data: ${JSON.stringify(payload)}\n\n`
  }

  const report = (): void => {
    if (reported) return
    reported = true
    if (convertedCalls === 0 && synthesizedFinish === undefined && !danglingStripped) return
    options.onReport?.({
      convertedCalls,
      convertedNames: [...new Set(convertedNames)],
      ...(synthesizedFinish === undefined ? {} : { synthesizedFinish }),
      ...(danglingStripped ? { danglingStripped: true } : {}),
    })
  }

  const holdCalls = (index: number, calls: DsmlToolCall[]): void => {
    for (const call of calls) {
      pendingCalls += frame(index, {
        tool_calls: [{
          index: callIndex,
          id: `call_dsml_${callIndex.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        }],
      })
      callIndex += 1
      convertedCalls += 1
      convertedNames.push(call.name)
    }
  }

  const drainFilters = (): string => {
    let out = ''
    for (const [index, filter] of filters) {
      const event = filter.flush()
      if (event.text !== '') {
        out += frame(index, { content: event.text })
        contentDelivered = true
      }
      if (event.calls.length > 0) holdCalls(index, event.calls)
    }
    filters.clear()
    return out
  }

  const takePending = (): string => {
    const out = pendingCalls
    pendingCalls = ''
    return out
  }

  const synthesizeFinish = (): string => {
    if (finishSeen || doneSeen) return ''
    if (convertedCalls === 0 && !sawToolCalls && !contentDelivered) return ''
    synthesizedFinish = convertedCalls > 0 || sawToolCalls ? 'tool_calls' : 'stop'
    return frame(0, {}, synthesizedFinish)
  }

  const processEvent = (event: string): string => {
    const line = event.split('\n').find((entry) => entry.startsWith('data:'))
    if (!line) return `${event}\n\n`

    const payload = line.slice(5).trim()
    if (payload === '[DONE]') {
      const tail = flushTailText()
      const tailFrame = tail === '' ? '' : frame(0, { content: tail })
      if (tailFrame !== '') contentDelivered = true
      const out = `${drainFilters()}${tailFrame}${takePending()}${synthesizeFinish()}`
      doneSeen = true
      report()
      return `${out}${event}\n\n`
    }
    if (payload === '') return `${event}\n\n`

    let parsed: any
    try {
      parsed = JSON.parse(payload)
    } catch {
      return `${event}\n\n`
    }
    if (meta === undefined && parsed && typeof parsed === 'object') {
      meta = { id: parsed.id, object: parsed.object, created: parsed.created, model: parsed.model }
    }

    let out = ''
    let mutated = false
    const choices = Array.isArray(parsed?.choices) ? parsed.choices : []
    for (const choice of choices) {
      const index = typeof choice?.index === 'number' ? choice.index : 0
      const delta = choice?.delta
      if (delta && typeof delta === 'object' && typeof delta.content === 'string' && delta.content !== '') {
        if (conversionDisabled) {
          // 结构化调用已出现过：正文照发，但尾部仍要防残缺闭合标签。
          const piece = emitContentText(delta.content)
          if (piece === '') {
            delete delta.content
          } else {
            if (piece !== delta.content) delta.content = piece
            contentDelivered = true
          }
          mutated = true
        } else {
          const event = filterFor(index).push(delta.content)
          if (event.calls.length > 0) {
            holdCalls(index, event.calls)
            mutated = true
          }
          // 过滤器放行的正文同样要过尾巴暂留：它可能是 `</｜DSML｜ …>` 的开头。
          const piece = event.text === '' ? '' : emitContentText(event.text)
          if (piece === '') {
            delete delta.content
            mutated = true
          } else {
            if (piece !== delta.content) {
              delta.content = piece
              mutated = true
            }
            contentDelivered = true
          }
        }
      }
      if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) {
        sawToolCalls = true
        if (!conversionDisabled) {
          // 上游已经给了结构化调用：正文里那份是重复意图，丢弃暂存并停手。
          conversionDisabled = true
          pendingCalls = ''
          convertedCalls = 0
          convertedNames.length = 0
          out += drainFilters()
          mutated = true
        }
      }
      if (typeof choice?.finish_reason === 'string' && choice.finish_reason !== '') {
        finishSeen = true
        // 暂留的尾巴要么是残片（剥掉）、要么是正文：正文必须在结束帧**之前**补发，
        // strict 客户端会把「finish 之后再来正文」判成 content_after_finish 整轮拒绝。
        const tail = flushTailText()
        if (tail !== '') {
          out += frame(index, { content: tail })
          contentDelivered = true
        }
        out += takePending()
        if (convertedCalls > 0 && choice.finish_reason === 'stop') {
          choice.finish_reason = 'tool_calls'
          mutated = true
        }
      }
    }

    if (mutated) return `${out}data: ${JSON.stringify(parsed)}\n\n`
    return `${out}${event}\n\n`
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
      let out = ''
      if (buffer.trim()) {
        out += processEvent(buffer)
        buffer = ''
      }
      out += drainFilters()
      const tail = flushTailText()
      if (tail !== '') {
        out += frame(0, { content: tail })
        contentDelivered = true
      }
      out += takePending()
      out += synthesizeFinish()
      if (out !== '') this.push(out)
      report()
      callback()
    },
  })
}