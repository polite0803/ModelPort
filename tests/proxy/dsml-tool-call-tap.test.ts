/**
 * chat 泳道 DSML 还原 tap：形态判据 + 收尾帧补齐。
 *
 * 依据（2026-11-19 23:01 现网）：OpenCode Go 的 deepseek-v4.1-flash
 *  - 把工具调用写进正文（DSML 文本），且该轮 `finish_reason=stop`；
 *  - 另一些轮次给完 `[DONE]` 却整条流没有 `finish_reason`，
 *    Qoder 据此报「Model stream ended before completion」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createDsmlToolCallTap, type DsmlTapReport } from '../../src/main/proxy/utils/dsmlToolCallTap.ts'

const frame = (delta: Record<string, unknown>, finish?: string): string =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-tap',
    object: 'chat.completion.chunk',
    created: 7,
    model: 'deepseek-v4.1-flash',
    choices: [{ index: 0, delta, ...(finish === undefined ? {} : { finish_reason: finish }) }],
  })}\n\n`

const DSML = [
  '',
  '<｜DSML｜ calls>',
  '<｜DSML｜ invoke name="exec_command">',
  '<｜DSML｜ parameter name="cmd" string="true">git status --short</｜DSML｜ parameter>',
  '</｜DSML｜ invoke>',
  '</｜DSML｜ calls>',
  '',
].join('\n')

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    stream.on('data', (chunk: Buffer) => { text += chunk.toString() })
    stream.on('end', () => resolve(text))
    stream.on('error', reject)
  })
}

const dataFrames = (text: string): Array<Record<string, any>> => text
  .split('\n\n')
  .filter(block => block.startsWith('data: {'))
  .map(block => JSON.parse(block.slice('data: '.length)))

test('DSML 正文被还原成一个 tool_call，结束帧改写成 tool_calls', async () => {
  const reports: DsmlTapReport[] = []
  const tap = createDsmlToolCallTap({
    declared: new Set(['exec_command']),
    onReport: report => reports.push(report),
  })
  const done = collect(tap)

  // 按 9 个字符切刀，跨帧切断标签。
  for (let i = 0; i < DSML.length; i += 9) tap.write(frame({ content: DSML.slice(i, i + 9) }))
  tap.write(frame({}, 'stop'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.equal(text.includes('｜DSML｜'), false, 'DSML 标记不能进客户端')
  const frames = dataFrames(text)
  const callFrame = frames.find(entry => entry.choices[0].delta.tool_calls !== undefined)
  assert.ok(callFrame, '必须交付一条 tool_calls')
  const call = callFrame!.choices[0].delta.tool_calls[0]
  assert.equal(call.function.name, 'exec_command')
  assert.deepEqual(JSON.parse(call.function.arguments), { cmd: 'git status --short' })
  const finish = frames.find(entry => entry.choices[0].finish_reason !== undefined)
  assert.equal(finish!.choices[0].finish_reason, 'tool_calls')
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
  assert.deepEqual(reports, [{ convertedCalls: 1, convertedNames: ['exec_command'] }])
})

test('上游有 [DONE] 却没有任何结束帧：补一个 stop，客户端看到完整的一轮', async () => {
  const reports: DsmlTapReport[] = []
  const tap = createDsmlToolCallTap({
    declared: new Set(['exec_command']),
    onReport: report => reports.push(report),
  })
  const done = collect(tap)

  tap.write(frame({ role: 'assistant' }))
  tap.write(frame({ content: '好的，我先看一下目录结构。' }))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  const frames = dataFrames(text)
  const finish = frames.find(entry => entry.choices[0].finish_reason !== undefined)
  assert.ok(finish, '必须补一个结束帧')
  assert.equal(finish!.choices[0].finish_reason, 'stop')
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
  assert.deepEqual(reports, [{ convertedCalls: 0, convertedNames: [], synthesizedFinish: 'stop' }])
})

test('上游正常带 finish_reason 时一个字节都不补', async () => {
  const tap = createDsmlToolCallTap({ declared: new Set(['exec_command']) })
  const done = collect(tap)

  const input = `${frame({ role: 'assistant' })}${frame({ content: '普通回答。' })}${frame({}, 'stop')}data: [DONE]\n\n`
  tap.write(input.slice(0, 37))
  tap.write(input.slice(37))
  tap.end()

  assert.equal(await done, input)
})

test('正文带前言时锁存纯文本：DSML 原样放行，不产出调用', async () => {
  const tap = createDsmlToolCallTap({ declared: new Set(['exec_command']) })
  const done = collect(tap)

  tap.write(frame({ content: `下面演示格式：${DSML}` }))
  tap.write(frame({}, 'stop'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.ok(text.includes('｜DSML｜'), '文本回合不能被改写')
  assert.equal(dataFrames(text).some(entry => entry.choices[0].delta.tool_calls !== undefined), false)
})

test('调用名不在声明集合里也还原：丢掉会让模型这一轮的决策凭空消失', async () => {
  const tap = createDsmlToolCallTap({ declared: new Set(['read_file']) })
  const done = collect(tap)

  tap.write(frame({ content: DSML }))
  tap.write(frame({}, 'stop'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.equal(text.includes('｜DSML｜'), false)
  const call = dataFrames(text).flatMap(entry => entry.choices[0].delta.tool_calls ?? [])[0]
  assert.equal(call.function.name, 'exec_command', '名字原样给出，越界由审计层报')
})

test('没声明工具时同样还原：文本里带着完整意图，丢掉等于作废模型的决策', async () => {
  const reports: DsmlTapReport[] = []
  const tap = createDsmlToolCallTap({ declared: new Set(), onReport: report => reports.push(report) })
  const done = collect(tap)

  tap.write(frame({ content: DSML }))
  tap.write(frame({}, 'stop'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.equal(text.includes('｜DSML｜'), false, '标记不交付')
  const call = dataFrames(text).flatMap(entry => entry.choices[0].delta.tool_calls ?? [])[0]
  assert.ok(call, '必须还原成一条调用')
  assert.equal(call.function.name, 'exec_command')
  assert.deepEqual(reports, [{ convertedCalls: 1, convertedNames: ['exec_command'] }])
})

test('上游已给结构化 tool_calls 时，正文里的 DSML 被丢弃而不是重复交付', async () => {
  const tap = createDsmlToolCallTap({ declared: new Set(['exec_command']) })
  const done = collect(tap)

  tap.write(frame({ content: DSML }))
  tap.write(frame({ tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'exec_command', arguments: '{}' } }] }))
  tap.write(frame({}, 'tool_calls'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.equal(text.includes('｜DSML｜'), false, '同一意图不能既交标记又交调用')
  const frames = dataFrames(text).flatMap(entry => entry.choices[0].delta.tool_calls ?? [])
  assert.equal(frames.length, 1, '只保留上游那一份结构化调用')
  assert.equal(frames[0].id, 'call_x')
})

/**
 * 残缺闭合标签：只有 `parameter`/`invoke`/`calls` 三个闭合符号，没有开标签、
 * 没有 invoke、没有参数名。2026-11-19 18:55–19:02 现网 6 条 assistant 正文都是
 * 这个形态（258–430 字），含开标签的 0 条。处置是剥掉残片、保留正文。
 */
const DANGLING = '\n</｜DSML｜ parameter>\n</｜DSML｜ invoke>\n</｜DSML｜ calls>'

test('残缺闭合标签被剥掉，正文保留', async () => {
  const reports: DsmlTapReport[] = []
  const tap = createDsmlToolCallTap({ declared: new Set(), onReport: report => reports.push(report) })
  const done = collect(tap)

  tap.write(frame({ content: '现在补两张硬证据：构建是否干净，以及用户开了哪些页面。' }))
  tap.write(frame({ content: DANGLING }))
  tap.write(frame({}, 'stop'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.equal(text.includes('｜DSML｜'), false, '残片不能进客户端')
  const content = dataFrames(text).map(entry => entry.choices[0].delta.content ?? '').join('')
  assert.equal(content, '现在补两张硬证据：构建是否干净，以及用户开了哪些页面。')
  assert.equal(reports.some(r => r.danglingStripped === true), true, '要按退化记')
})

test('残缺标签被逐帧拆开也能识别（真实流式分片）', async () => {
  const tap = createDsmlToolCallTap({ declared: new Set() })
  const done = collect(tap)
  const full = `正文一段。${DANGLING}`
  for (let i = 0; i < full.length; i += 7) {
    tap.write(frame({ content: full.slice(i, i + 7) }))
  }
  tap.write(frame({}, 'stop'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.equal(text.includes('｜DSML｜'), false)
  const content = dataFrames(text).map(entry => entry.choices[0].delta.content ?? '').join('')
  assert.equal(content, '正文一段。')
})

test('正文里出现不完整的单个闭合词不算残片，不被剥', async () => {
  const tap = createDsmlToolCallTap({ declared: new Set() })
  const done = collect(tap)
  tap.write(frame({ content: '文档里提到 parameter 与 invoke 这两个词。' }))
  tap.write(frame({}, 'stop'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  const content = dataFrames(text).map(entry => entry.choices[0].delta.content ?? '').join('')
  assert.equal(content, '文档里提到 parameter 与 invoke 这两个词。', '普通文本逐字保留')
})