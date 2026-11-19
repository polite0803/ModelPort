import { Transform } from 'stream'
import {
  createDsmlContentFilter,
  type DsmlContentFilter,
  type DsmlToolCall,
} from '../../../shared/dsmlToolCalls.ts'

export interface DsmlTapReport {
  /** 还原成 tool_calls 的条数（请求声明了工具时）。 */
  convertedCalls: number
  convertedNames: string[]
  /** 整块丢弃的条数（请求没声明工具时：没有执行器，留着只会被渲染给用户）。 */
  droppedCalls: number
  /** 收尾帧是补出来的（上游给了 [DONE] 却没有 finish_reason）。 */
  synthesizedFinish?: 'stop' | 'tool_calls'
}

export interface DsmlToolCallTapOptions {
  /** 客户端本次声明的工具名；为空集时整块丢弃而不是还原。 */
  declared: ReadonlySet<string>
  onReport?: (report: DsmlTapReport) => void
}

/**
 * chat SSE 泳道里的 DSML 标记处置。
 *
 * 真实成因（2026-11-20 对照实测，两个上游一致）：DeepSeek 系模型在**请求没有声明
 * 工具**、上下文却像 agent 任务时，会把工具调用写成 `<｜DSML｜ calls>` 文本。声明了
 * 工具时同一提示走结构化 `tool_calls`，两种上游各 3/3 无泄漏。所以两种处置：
 *
 * - 声明了工具 → 还原成 `tool_calls`（带工具才有人执行）；
 * - 没声明工具 → 整块丢弃（这一轮没有执行器，还原出来没人调用，留着就是把标记
 *   渲染进对话），并让 `X-ModelPort-Dsml-Dropped` 与日志记下条数。
 *
 * 形态判据（与供应商无关，只看响应本身）：正文在出现任何非空白前就进入 DSML 块，
 * 且块后除空白/下一个块外没有正文 —— 带前言、讲解语法的回合一律锁存为纯文本，
 * 逐字节原样放行。
 *
 * 另修一种上游收尾缺陷：整条流给了 `[DONE]` 却没有任何 `finish_reason` 时，按已交付
 * 内容补一个结束帧（有工具调用 → `tool_calls`，否则 `stop`）—— 否则严格客户端
 * （Qoder）会把整轮判成「流没完成」。
 */
export function createDsmlToolCallTap(options: DsmlToolCallTapOptions): Transform {
  const declared = options.declared
  const converting = declared.size > 0
  const accept = (call: DsmlToolCall): boolean => !conversionDisabled && declared.has(call.name)
  const filters = new Map<number, DsmlContentFilter>()

  let buffer = ''
  let meta: { id?: unknown; object?: unknown; created?: unknown; model?: unknown } | undefined
  let sawToolCalls = false
  let conversionDisabled = false
  let finishSeen = false
  let doneSeen = false
  let contentDelivered = false
  let convertedCalls = 0
  let droppedCalls = 0
  let callIndex = 0
  /** 已还原、尚未下发的调用帧。 */
  let pendingCalls = ''
  const convertedNames: string[] = []
  let synthesizedFinish: 'stop' | 'tool_calls' | undefined
  let reported = false

  const filterFor = (index: number): DsmlContentFilter => {
    let filter = filters.get(index)
    if (filter === undefined) {
      filter = createDsmlContentFilter(accept, converting ? 'convert' : 'drop')
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
    if (convertedCalls === 0 && droppedCalls === 0 && synthesizedFinish === undefined) return
    options.onReport?.({
      convertedCalls,
      convertedNames: [...new Set(convertedNames)],
      droppedCalls,
      ...(synthesizedFinish === undefined ? {} : { synthesizedFinish }),
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
      droppedCalls += event.dropped
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
      const out = `${drainFilters()}${takePending()}${synthesizeFinish()}`
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
          contentDelivered = true
        } else {
          const event = filterFor(index).push(delta.content)
          if (event.calls.length > 0) {
            holdCalls(index, event.calls)
            mutated = true
          }
          if (event.dropped > 0) {
            droppedCalls += event.dropped
            mutated = true
          }
          if (event.text === '') {
            delete delta.content
            mutated = true
          } else {
            if (event.text !== delta.content) {
              delta.content = event.text
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
      out += takePending()
      out += synthesizeFinish()
      if (out !== '') this.push(out)
      report()
      callback()
    },
  })
}