/**
 * 2026-11-03 Codex 循环：模型把 PowerShell 命令塞进 `shell:"bash"`，或者
 * `shell:"powershell"` 被 Codex 忽略落到 cmd.exe；`workdir:"/root"` 触发
 * `CreateProcessWithLogonW failed: 267`。这里锁住网关侧的最小校正。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeClientToolArguments } from '../../src/shared/clientToolArguments.ts'

function args(value: Record<string, unknown>): string {
  return JSON.stringify(value)
}

test('Windows 客户端上任何非 PowerShell 的 shell 都改成 pwsh（bash/cmd 会被 Codex 忽略成 cmd.exe）', () => {
  for (const shell of ['bash', 'cmd', 'zsh', 'sh']) {
    const out = JSON.parse(sanitizeClientToolArguments(
      'exec_command',
      args({ cmd: 'git status --short; git log -1 --oneline', shell, workdir: 'D:\\OneManager\\AxInvest' }),
      'win32',
    ))
    assert.equal(out.shell, 'pwsh', shell)
  }
})

test('PowerShell 命令在 bash 槽里要改回 pwsh，并去掉非 escalated 的 justification', () => {
  const out = JSON.parse(sanitizeClientToolArguments(
    'exec_command',
    args({
      cmd: 'Get-Location; Get-ChildItem -Force',
      shell: 'bash',
      justification: '',
      sandbox_permissions: 'use_default',
      workdir: 'D:\\OneManager\\AxInvest',
    }),
    'win32',
  ))
  assert.equal(out.shell, 'pwsh')
  assert.equal(out.justification, undefined)
  assert.equal(out.workdir, 'D:\\OneManager\\AxInvest')
})

test('shell:"powershell" 归一为 pwsh；/root 这类 POSIX 绝对路径在 Windows 上删除', () => {
  const out = JSON.parse(sanitizeClientToolArguments(
    'exec_command',
    args({
      cmd: 'Get-ChildItem',
      shell: 'powershell',
      workdir: '/root',
      sandbox_permissions: 'use_default',
    }),
    'win32',
  ))
  assert.equal(out.shell, 'pwsh')
  assert.equal(out.workdir, undefined)
})

test('大小写不同的 PowerShell 名也归一（实测 "PowerShell" 会落到 cmd.exe）', () => {
  const out = JSON.parse(sanitizeClientToolArguments(
    'exec_command',
    args({ cmd: 'Get-ChildItem -Force', shell: 'PowerShell' }),
    'win32',
  ))
  assert.equal(out.shell, 'pwsh')
})

test('没有 shell 字段时不主动填 bash（填了等于把能跑的默认 shell 换成 cmd.exe）', () => {
  const out = JSON.parse(sanitizeClientToolArguments(
    'exec_command',
    args({ cmd: 'ls -la && pwd', workdir: 'D:\\repo' }),
    'win32',
  ))
  assert.equal(out.shell, undefined)
})

test('网关不在 Windows 且参数里没有 Windows 线索时不动 shell', () => {
  const raw = args({ cmd: 'ls -la && pwd', shell: 'bash', workdir: '/Users/dev/repo' })
  assert.equal(sanitizeClientToolArguments('exec_command', raw, 'darwin'), raw)
})

test('workdir 是盘符路径时，即使网关不在 Windows 也按 Windows 客户端处理', () => {
  const out = JSON.parse(sanitizeClientToolArguments(
    'exec_command',
    args({ cmd: 'Get-ChildItem -Force', shell: 'bash', workdir: 'C:\\Users\\dev\\repo' }),
    'darwin',
  ))
  assert.equal(out.shell, 'pwsh')
})

test('require_escalated 保留 justification 与 prefix_rule', () => {
  const out = JSON.parse(sanitizeClientToolArguments(
    'exec_command',
    args({
      cmd: 'git pull',
      shell: 'bash',
      justification: '允许拉取',
      prefix_rule: ['git', 'pull'],
      sandbox_permissions: 'require_escalated',
    }),
    'win32',
  ))
  assert.equal(out.justification, '允许拉取')
  assert.deepEqual(out.prefix_rule, ['git', 'pull'])
})

test('非 exec_command 工具不碰', () => {
  const raw = args({ query: 'x' })
  assert.equal(sanitizeClientToolArguments('other_tool', raw, 'win32'), raw)
})

test('非 JSON 参数原样返回，不制造新的坏参数', () => {
  const raw = '{not json'
  assert.equal(sanitizeClientToolArguments('exec_command', raw, 'win32'), raw)
})
