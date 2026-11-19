import { Transform } from 'stream'
import type { ToolNameRename } from '../../../shared/toolNameSafety.ts'

/**
 * 把上游回来的工具调用名还原成客户端声明的原名。
 *
 * 改名发生在出站（`planToolNameRenames`）：非法字符（点号、斜杠…）会让严格上游
 * 整条 400。客户端按名字分派执行器，所以回来时必须是它自己那个名字 —— 否则
 * `filesystem.read_file` 会变成 `filesystem_read_file`，客户端找不到对应工具。
 *
 * 只认精确命中映射表：模型自己造的名字不在表里，原样透传，由既有的未声明工具名
 * 审计去报。
 */
export function createToolNameRestoreTap(renames: readonly ToolNameRename[]): Transform {
  const mapping = new Map(renames.map(rename => [rename.sent, rename.original]))
  let buffer = ''

  const processEvent = (event: string): string => {
    if (mapping.size === 0 || !event.includes('tool_calls')) return `${event}\n\n`
    const line = event.split('\n').find(entry => entry.startsWith('data:'))
    if (!line) return `${event}\n\n`
    const payload = line.slice(5).trim()
    if (payload === '' || payload === '[DONE]') return `${event}\n\n`

    let parsed: any
    try {
      parsed = JSON.parse(payload)
    } catch {
      return `${event}\n\n`
    }

    let mutated = false
    const choices = Array.isArray(parsed?.choices) ? parsed.choices : []
    for (const choice of choices) {
      for (const slot of [choice?.delta?.tool_calls, choice?.message?.tool_calls]) {
        if (!Array.isArray(slot)) continue
        for (const call of slot) {
          const name = call?.function?.name
          if (typeof name !== 'string') continue
          const original = mapping.get(name)
          if (original === undefined) continue
          call.function.name = original
          mutated = true
        }
      }
    }
    return mutated ? `data: ${JSON.stringify(parsed)}\n\n` : `${event}\n\n`
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
      if (buffer.trim()) this.push(processEvent(buffer))
      buffer = ''
      callback()
    },
  })
}

/** 非流式响应体：把 `choices[].message.tool_calls[].function.name` 还原。 */
export function restoreToolNamesInBody(body: unknown, renames: readonly ToolNameRename[]): unknown {
  if (renames.length === 0) return body
  const mapping = new Map(renames.map(rename => [rename.sent, rename.original]))
  const record = body as { choices?: Array<{ message?: { tool_calls?: unknown } }> } | null
  if (record === null || typeof record !== 'object' || !Array.isArray(record.choices)) return body
  let mutated = false
  for (const choice of record.choices) {
    const calls = choice?.message?.tool_calls
    if (!Array.isArray(calls)) continue
    for (const call of calls) {
      const name = (call as { function?: { name?: unknown } })?.function?.name
      if (typeof name !== 'string') continue
      const original = mapping.get(name)
      if (original === undefined) continue
      ;(call as { function: { name: string } }).function.name = original
      mutated = true
    }
  }
  return mutated ? record : body
}