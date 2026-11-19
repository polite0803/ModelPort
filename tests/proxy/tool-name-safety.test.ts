/**
 * 工具名规范化：非法名字改名后发送、响应里还原成原名。
 *
 * 依据（2026-11-20 实测 WorkBuddy）：`filesystem.read_file` / `shell/run` 这类名字
 * 让上游整条 400 —— `工具名称不规范 the tool name is invalid or duplicated`，
 * 一个坏名字连累全部工具，那一轮模型什么都用不了。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  planToolNameRenames,
  renamesHeaderValue,
  restoreToolCallName,
} from '../../src/shared/toolNameSafety.ts'
import {
  createToolNameRestoreTap,
  restoreToolNamesInBody,
} from '../../src/main/proxy/utils/toolNameRestoreTap.ts'

const fnTool = (name: string) => ({
  type: 'function',
  function: { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } },
})

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    stream.on('data', (chunk: Buffer) => { text += chunk.toString() })
    stream.on('end', () => resolve(text))
    stream.on('error', reject)
  })
}

test('合法名字原样不动：没有改名就没有映射', () => {
  const plan = planToolNameRenames([fnTool('read_file'), fnTool('mcp__codex_app__list_projects'), fnTool('tool-1')])
  assert.deepEqual(plan.renames, [])
  assert.deepEqual(plan.tools.map(t => (t as any).function.name), ['read_file', 'mcp__codex_app__list_projects', 'tool-1'])
})

test('点号与斜杠被替换成下划线，映射保留原名', () => {
  const plan = planToolNameRenames([fnTool('filesystem.read_file'), fnTool('shell/run')])
  assert.deepEqual(plan.tools.map(t => (t as any).function.name), ['filesystem_read_file', 'shell_run'])
  assert.deepEqual(plan.renames, [
    { sent: 'filesystem_read_file', original: 'filesystem.read_file' },
    { sent: 'shell_run', original: 'shell/run' },
  ])
  assert.equal(renamesHeaderValue(plan.renames), 'filesystem_read_file=filesystem.read_file,shell_run=shell/run')
})

test('超长名字截断到 64 个字符', () => {
  const long = 'a'.repeat(80)
  const plan = planToolNameRenames([fnTool(long)])
  const sent = (plan.tools[0] as any).function.name as string
  assert.equal(sent.length, 64)
  assert.equal(plan.renames[0].original, long)
})

test('改名结果撞上已有合法名时加后缀，保证一对一', () => {
  const plan = planToolNameRenames([fnTool('fs.read'), fnTool('fs_read')])
  const names = plan.tools.map(t => (t as any).function.name)
  assert.deepEqual(names, ['fs_read_2', 'fs_read'])
  assert.deepEqual(plan.renames, [{ sent: 'fs_read_2', original: 'fs.read' }])
})

test('无名字段与空名条目不参与改名（交给既有清洗）', () => {
  const plan = planToolNameRenames([
    { type: 'function', function: {} },
    fnTool(''),
    { type: 'custom', name: 'a.b' },
  ])
  assert.deepEqual(plan.renames, [])
})

test('还原只认精确命中，模型自造的名字原样透传', () => {
  const renames = [{ sent: 'filesystem_read_file', original: 'filesystem.read_file' }]
  assert.equal(restoreToolCallName('filesystem_read_file', renames), 'filesystem.read_file')
  assert.equal(restoreToolCallName('exec_command', renames), 'exec_command')
  assert.equal(restoreToolCallName('filesystem_read_file_2', renames), 'filesystem_read_file_2')
})

test('流式：调用名被还原，参数与其余帧不变', async () => {
  const tap = createToolNameRestoreTap([{ sent: 'filesystem_read_file', original: 'filesystem.read.file' }])
  const done = collect(tap)
  const frame = (name: string, args: string): string =>
    `data: ${JSON.stringify({ id: 'x', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name, arguments: args } }] } }] })}\n\n`

  tap.write(frame('filesystem_read_file', '{"path":"a.ts"}'))
  tap.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n')
  tap.write('data: [DONE]\n\n')
  tap.end()

  const text = await done
  assert.ok(text.includes('filesystem.read.file'), '客户端必须拿回原名')
  assert.equal(text.includes('"name":"filesystem_read_file"'), false)
  const call = JSON.parse(text.split('\n\n')[0].slice('data: '.length))
  assert.equal(call.choices[0].delta.tool_calls[0].function.arguments, '{"path":"a.ts"}', '参数原样')
})

test('非流式：message.tool_calls 里的名字被还原', () => {
  const body = {
    choices: [{
      message: {
        role: 'assistant',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'shell_run', arguments: '{"command":"ls"}' } },
          { id: 'c2', type: 'function', function: { name: 'exec_command', arguments: '{"cmd":"pwd"}' } },
        ],
      },
      finish_reason: 'tool_calls',
    }],
  }
  const restored = restoreToolNamesInBody(body, [{ sent: 'shell_run', original: 'shell/run' }]) as any
  assert.equal(restored.choices[0].message.tool_calls[0].function.name, 'shell/run')
  assert.equal(restored.choices[0].message.tool_calls[1].function.name, 'exec_command')
})

test('没有改名时不碰响应体（同一个对象返回）', () => {
  const body = { choices: [{ message: { tool_calls: [{ function: { name: 'x' } }] } }] }
  assert.equal(restoreToolNamesInBody(body, []), body)
})