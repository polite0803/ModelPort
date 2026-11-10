import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildToolUseResults,
  extractClientToolResults,
  mapComateToolCall,
  mergeToolInput,
  type ClientToolDefinition,
  type PendingToolCall,
} from '../../vendor/channel-pack/src/comate-bridge.ts'

const claudeTools: ClientToolDefinition[] = [
  { name: 'Read', parameters: { properties: { file_path: {}, offset: {}, limit: {} } } },
  { name: 'Write', parameters: { properties: { file_path: {}, content: {} } } },
  { name: 'Edit', parameters: { properties: { file_path: {}, old_string: {}, new_string: {}, replace_all: {} } } },
  { name: 'Bash', parameters: { properties: { command: {} } } },
  { name: 'Grep', parameters: { properties: { pattern: {}, path: {}, glob: {}, '-i': {}, '-A': {}, '-B': {}, '-C': {}, head_limit: {} } } },
  { name: 'Glob', parameters: { properties: { pattern: {}, path: {} } } },
  { name: 'LS', parameters: { properties: { path: {} } } },
]

const codexTools: ClientToolDefinition[] = [
  { name: 'shell', parameters: { properties: { command: {}, workdir: {} } } },
]

const clineTools: ClientToolDefinition[] = [
  { name: 'execute_command', parameters: { properties: { command: {}, requires_approval: {} } } },
  { name: 'read_file', parameters: { properties: { path: {}, start_line: {}, end_line: {} } } },
  { name: 'write_to_file', parameters: { properties: { path: {}, content: {} } } },
  { name: 'replace_in_file', parameters: { properties: { path: {}, diff: {} } } },
  { name: 'list_files', parameters: { properties: { path: {}, recursive: {} } } },
  { name: 'search_files', parameters: { properties: { path: {}, regex: {}, file_pattern: {} } } },
]

test('参数分片按增量拼接，完整值则替换', () => {
  const target: Record<string, unknown> = {}
  mergeToolInput(target, { command: 'echo' })
  mergeToolInput(target, { command: ' COM' })
  mergeToolInput(target, { command: 'ATE_TOOL_OK' })
  assert.equal(target.command, 'echo COMATE_TOOL_OK')
  mergeToolInput(target, { command: 'echo COMATE_TOOL_OK and more' })
  assert.equal(target.command, 'echo COMATE_TOOL_OK and more')

  // apply_patch 的 MERGE 帧发送新的完整值：不以旧值为前缀时也要替换。
  const patch: Record<string, unknown> = { input: 'old patch' }
  mergeToolInput(patch, { input: 'new patch' }, true)
  assert.equal(patch.input, 'new patch')
})

test('Claude Code：直接映射到 Read/Write/Edit/Bash/Grep/Glob/LS', () => {
  assert.deepEqual(
    JSON.parse(mapComateToolCall('run_command', { command: 'ls' }, claudeTools).arguments),
    { command: 'ls' },
  )
  assert.equal(mapComateToolCall('run_command', { command: 'ls' }, claudeTools).name, 'Bash')
  assert.equal(mapComateToolCall('read_file', { file_path: 'a.ts' }, claudeTools).name, 'Read')
  assert.equal(mapComateToolCall('write_file', { file_path: 'a.ts', content: 'x' }, claudeTools).name, 'Write')
  assert.equal(mapComateToolCall('edit_file', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }, claudeTools).name, 'Edit')
  assert.equal(mapComateToolCall('grep_content', { pattern: 'foo', path: '.' }, claudeTools).name, 'Grep')
  assert.equal(mapComateToolCall('glob_path', { pattern: '*.ts', target_directory: '.' }, claudeTools).name, 'Glob')
  assert.equal(mapComateToolCall('list_dir', { target_directory: '.' }, claudeTools).name, 'LS')
})

test('Codex 只有 shell：文件/搜索工具退化为 shell 命令', () => {  const read = mapComateToolCall('read_file', { file_path: 'a b.ts' }, codexTools)
  assert.equal(read.mapped, true)
  assert.equal(read.name, 'shell')
  assert.match(JSON.parse(read.arguments).command, /cat -- 'a b\.ts'/)

  const write = mapComateToolCall('write_file', { file_path: 'a.ts', content: 'hello' }, codexTools)
  assert.match(JSON.parse(write.arguments).command, /base64 -d > 'a\.ts'/)

  const grep = mapComateToolCall('grep_content', { pattern: 'foo', path: '.' }, codexTools)
  assert.match(JSON.parse(grep.arguments).command, /grep -R -n -E 'foo' '\.'/)

  const glob = mapComateToolCall('glob_path', { pattern: '*.ts', target_directory: '.' }, codexTools)
  assert.match(JSON.parse(glob.arguments).command, /find '\.' -type f -name '\*\.ts'/)

  const patch = mapComateToolCall('apply_patch', { input: '--- a/a\n+++ b/a\n' }, codexTools)
  assert.equal(patch.mapped, true)
  assert.match(JSON.parse(patch.arguments).command, /git apply --whitespace=nowarn/)
})

test('Cline 类：execute_command/read_file/write_to_file/replace_in_file/list_files/search_files', () => {
  const run = mapComateToolCall('run_command', { command: 'ls' }, clineTools)
  assert.equal(run.name, 'execute_command')
  assert.deepEqual(JSON.parse(run.arguments), { command: 'ls', requires_approval: true })

  const read = mapComateToolCall('read_file', { file_path: 'a.ts', offset: 10, limit: 5 }, clineTools)
  assert.equal(read.name, 'read_file')
  assert.deepEqual(JSON.parse(read.arguments), { path: 'a.ts', start_line: 10, end_line: 14 })

  const write = mapComateToolCall('write_file', { file_path: 'a.ts', content: 'x' }, clineTools)
  assert.equal(write.name, 'write_to_file')
  assert.deepEqual(JSON.parse(write.arguments), { path: 'a.ts', content: 'x' })

  const edit = mapComateToolCall('edit_file', { file_path: 'a.ts', old_string: 'old', new_string: 'new' }, clineTools)
  assert.equal(edit.name, 'replace_in_file')
  assert.deepEqual(JSON.parse(edit.arguments), {
    path: 'a.ts',
    diff: '------- SEARCH\nold\n=======\nnew\n+++++++ REPLACE',
  })

  const list = mapComateToolCall('list_dir', { target_directory: '.' }, clineTools)
  assert.equal(list.name, 'list_files')
  assert.deepEqual(JSON.parse(list.arguments), { path: '.', recursive: true })

  const grep = mapComateToolCall('grep_content', { pattern: 'foo', path: '.', glob: '*.ts' }, clineTools)
  assert.equal(grep.name, 'search_files')
  assert.deepEqual(JSON.parse(grep.arguments), { regex: 'foo', path: '.', file_pattern: '*.ts' })

  // Cline 没有 glob/patch/delete 专用工具，走 execute_command 兜底。
  const glob = mapComateToolCall('glob_path', { pattern: '*.ts', target_directory: '.' }, clineTools)
  assert.equal(glob.name, 'execute_command')
  assert.match(JSON.parse(glob.arguments).command, /find '\.' -type f -name '\*\.ts'/)

  const patch = mapComateToolCall('apply_patch', { input: '--- a/a\n+++ b/a\n' }, clineTools)
  assert.equal(patch.name, 'execute_command')
  assert.match(JSON.parse(patch.arguments).command, /git apply --whitespace=nowarn/)

  const remove = mapComateToolCall('delete_file', { file_path: 'a.ts' }, clineTools)
  assert.equal(remove.name, 'execute_command')
  assert.match(JSON.parse(remove.arguments).command, /rm -- 'a\.ts'/)
})

test('没有对应工具时返回不可用原因，todo_write 是无操作成功', () => {
  const edit = mapComateToolCall('edit_file', { file_path: 'a', old_string: 'a', new_string: 'b' }, codexTools)
  assert.equal(edit.mapped, false)
  assert.match(edit.failure ?? '', /not available/)

  const todo = mapComateToolCall('todo_write', {}, claudeTools)
  assert.equal(todo.noop, true)
  assert.equal(todo.mapped, false)
})

test('客户端 tool-result 被提取，并与 pending/noop/不可用结果合并', () => {
  const messages = [{
    role: 'user',
    content: [{
      type: 'tool-result',
      toolCallId: 'call_1',
      content: [{ type: 'text', text: 'COMATE_TOOL_OK' }],
      isError: false,
    }],
  }]
  const results = extractClientToolResults(messages as never)
  assert.deepEqual(results, [{ toolCallId: 'call_1', text: 'COMATE_TOOL_OK', isError: false }])

  const pending: PendingToolCall[] = [
    {
      agentId: 'call_1', agentName: 'run_command', agentInput: { command: 'echo' },
      clientId: 'call_1', clientName: 'Bash', clientArgs: '{"command":"echo"}',
      mapped: true, noop: false,
    },
    {
      agentId: 'call_2', agentName: 'todo_write', agentInput: {},
      clientId: 'call_2', clientName: '', clientArgs: '', mapped: false, noop: true,
    },
    {
      agentId: 'call_3', agentName: 'skill', agentInput: {},
      clientId: 'call_3', clientName: '', clientArgs: '', mapped: false, noop: false, failure: 'not available',
    },
  ]
  const built = buildToolUseResults(pending, results)
  assert.equal(built[0].success, true)
  assert.equal(built[0].message, 'COMATE_TOOL_OK')
  assert.equal(built[1].success, true)
  assert.equal(built[2].success, false)
  assert.match(built[2].message, /not available/)
})
