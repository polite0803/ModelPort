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
  assert.deepEqual(reports, [{ convertedCalls: 1, convertedNames: ['exec_command'], droppedCalls: 0 }])
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
  assert.deepEqual(reports, [{ convertedCalls: 0, convertedNames: [], droppedCalls: 0, synthesizedFinish: 'stop' }])
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

test('调用名未声明：整块按文本交付', async () => {
  const tap = createDsmlToolCallTap({ declared: new Set(['read_file']) })
  const done = collect(tap)

  tap.write(frame({ content: DSML }))
  tap.write(frame({}, 'stop'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.ok(text.includes('｜DSML｜'))
  assert.equal(dataFrames(text).some(entry => entry.choices[0].delta.tool_calls !== undefined), false)
})

test('没声明工具：整块丢弃并计数（这一轮没有执行器，留着只会渲染给用户）', async () => {
  const reports: DsmlTapReport[] = []
  const tap = createDsmlToolCallTap({ declared: new Set(), onReport: report => reports.push(report) })
  const done = collect(tap)

  tap.write(frame({ content: DSML }))
  tap.write(frame({}, 'stop'))
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.equal(text.includes('｜DSML｜'), false, '标记不能进客户端正文')
  assert.equal(dataFrames(text).some(entry => entry.choices[0].delta.tool_calls !== undefined), false)
  assert.deepEqual(reports, [{ convertedCalls: 0, convertedNames: [], droppedCalls: 1 }])
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