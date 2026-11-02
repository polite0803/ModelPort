/**
 * 2026-11-02 Codex → Raccoon：Codex 的延迟工具发现带了一条
 * `function.name: ''` 的占位工具，严格上游整条拒收
 * （`tools[14].function.name is invalid or missing`）。
 * 网关在账号渠道转发前必须清掉不可调用的定义，并补齐缺失的 `parameters`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeChatToolDefinitions } from '../../src/main/channelPack/toolCallValidation.ts'

test('sanitizeChatToolDefinitions：删除空名字工具，保留可调用工具', () => {
  const tools = [
    { type: 'function', function: { name: 'exec_command', parameters: { type: 'object' } } },
    { type: 'function', function: { name: '', parameters: { type: 'object' } } },
    { type: 'function', function: { name: '   ' } },
  ]
  const sanitized = sanitizeChatToolDefinitions(tools) as Array<{ function: { name: string } }>
  assert.deepEqual(sanitized.map(tool => tool.function.name), ['exec_command'])
  assert.equal(tools.length, 3, '不得修改入参数组')
})

test('sanitizeChatToolDefinitions：缺失 parameters 的定义补空对象 schema', () => {
  const tools = [
    { type: 'function', function: { name: 'apply_patch', description: 'apply a patch' } },
  ]
  const sanitized = sanitizeChatToolDefinitions(tools) as Array<{ function: { parameters: unknown } }>
  assert.deepEqual(sanitized[0]?.function.parameters, { type: 'object', properties: {} })
  assert.equal(
    (tools[0]?.function as { parameters?: unknown }).parameters,
    undefined,
    '不得把补齐字段写回入参',
  )
})

test('sanitizeChatToolDefinitions：非 function 工具与非法输入不冒充可调用工具', () => {
  assert.deepEqual(
    sanitizeChatToolDefinitions([{ type: 'custom', name: 'freeform' }]),
    [],
  )
  assert.equal(sanitizeChatToolDefinitions(undefined), undefined)
  assert.equal(sanitizeChatToolDefinitions('not-an-array'), 'not-an-array')
})
