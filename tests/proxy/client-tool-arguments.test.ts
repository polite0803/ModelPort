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

test('Unix 命令保留 bash；非 exec_command 工具不碰', () => {
  const unix = JSON.parse(sanitizeClientToolArguments(
    'exec_command',
    args({ cmd: 'ls -la && pwd', shell: 'bash' }),
    'win32',
  ))
  assert.equal(unix.shell, 'bash')

  const raw = args({ query: 'x' })
  assert.equal(sanitizeClientToolArguments('other_tool', raw, 'win32'), raw)
})

test('非 JSON 参数原样返回，不制造新的坏参数', () => {
  const raw = '{not json'
  assert.equal(sanitizeClientToolArguments('exec_command', raw, 'win32'), raw)
})
