import { test } from 'node:test'
import assert from 'node:assert/strict'

import { anthropicToChatRequest } from '../../src/shared/anthropicWire.ts'
import { responsesToChatRequest } from '../../src/shared/responsesInbound.ts'
import {
  ToolNameAuditLimiter,
  collectToolCallNames,
  createUndeclaredToolNameTap,
  declaredChatToolNames,
  findUndeclaredToolNames,
  formatUndeclaredToolNameLine,
  rawChatToolNames,
} from '../../src/main/proxy/utils/undeclaredToolNameAudit.ts'

const tool = (name: unknown) => ({ type: 'function', function: { name, parameters: { type: 'object' } } })

async function runTap(declared: string[], chunks: string[]): Promise<{ out: string; reported: string[] }> {
  const reported: string[] = []
  const tap = createUndeclaredToolNameTap({
    declared: new Set(declared),
    onUndeclared: names => { reported.push(...names) },
  })
  let out = ''
  tap.on('data', chunk => { out += chunk.toString() })
  const ended = new Promise<void>(resolve => { tap.on('end', () => resolve()) })
  for (const chunk of chunks) tap.write(Buffer.from(chunk))
  tap.end()
  await ended
  return { out, reported }
}

const frame = (delta: Record<string, unknown>): string =>
  `data: ${JSON.stringify({ id: 'chatcmpl-x', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`

test('声明集只收 chat 形状的函数名，跳过空名与非函数工具', () => {
  const names = declaredChatToolNames([
    tool('read'),
    tool('  '),
    tool(''),
    { type: 'custom', name: 'apply_patch' },
    { type: 'function' },
    null,
  ])
  assert.deepEqual([...names], ['read'])
})

test('原始名字集区分「没发过」与「发了但定义被删」', () => {
  const tools = [
    tool('read'),
    { type: 'custom', name: 'finish' },
    { type: 'function', function: { name: '' } },
  ]
  assert.deepEqual([...rawChatToolNames(tools)], ['read', 'finish'])
  // 客户端发了 finish，但 chat 只认 function 形状 → 它没进下发声明集。
  assert.deepEqual([...declaredChatToolNames(tools)], ['read'])
})

test('日志行把「客户端发过但未下发」的名字单独列出', () => {
  const line = formatUndeclaredToolNameLine({
    model: 'm',
    offending: ['finish'],
    declared: new Set(['read']),
    dropped: ['finish'],
    requestId: 'r1',
  })
  assert.match(line, /客户端发过但定义未下发：finish/)
})

test('/v1/messages 与 /v1/responses 经翻译后，客户端工具名原样进 chat 审计', () => {
  const anthropic = anthropicToChatRequest(
    {
      model: 'claude-x',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { name: 'finish', input_schema: { type: 'object', properties: {} } },
        { name: 'read', input_schema: { type: 'object', properties: {} } },
      ],
    },
    { model: 'auto', stream: true },
  ).request
  assert.deepEqual([...declaredChatToolNames(anthropic.tools)], ['finish', 'read'])

  // responses 把 function 的字段抬在 tool 自身；custom/freeform 也保留名字。
  const responses = responsesToChatRequest(
    {
      model: 'gpt-x',
      input: 'hi',
      tools: [
        { type: 'function', name: 'exec_command', parameters: { type: 'object', properties: {} } },
        { type: 'custom', name: 'finish', format: { type: 'text' } },
      ],
    },
    { model: 'auto', stream: true },
  )
  assert.deepEqual([...declaredChatToolNames(responses.tools)], ['exec_command', 'finish'])
})

test('越界名保持首次出现顺序且去重，声明过的名字不算', () => {
  assert.deepEqual(
    findUndeclaredToolNames(['finish', 'read', 'finish', 'shell'], new Set(['read'])),
    ['finish', 'shell'],
  )
})

test('非流式响应体里能取出工具调用名', () => {
  const body = {
    choices: [{
      message: {
        tool_calls: [
          { id: 'call_1', function: { name: 'finish', arguments: '{}' } },
          { id: 'call_2', function: { name: 'read', arguments: '{}' } },
        ],
      },
    }],
  }
  assert.deepEqual(collectToolCallNames(body), ['finish', 'read'])
  assert.deepEqual(collectToolCallNames({ choices: [] }), [])
  assert.deepEqual(collectToolCallNames(null), [])
})

test('SSE tap 原样透传字节，并只报告未声明的名字', async () => {
  const input = [
    ': PING\n\n',
    frame({ role: 'assistant', content: '' }),
    frame({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'finish', arguments: '' } }] }),
    frame({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }),
    'data: [DONE]\n\n',
  ]
  const { out, reported } = await runTap(['read', 'shell'], input)

  assert.equal(out, input.join(''), '观测 tap 不得改动任何字节')
  assert.deepEqual(reported, ['finish'], '同一个越界名只报一次')
})

test('声明的名字不报告；分片跨 chunk 也能识别', async () => {
  const event = frame({ tool_calls: [{ index: 0, function: { name: 'finish' } }] })
  const boundary = Math.floor(event.length / 2)
  const { reported } = await runTap(['read', 'finish'], [
    event.slice(0, boundary),
    event.slice(boundary),
  ])
  assert.deepEqual(reported, [])
})

test('坏 JSON 与心跳不抛错、不报告', async () => {
  const { out, reported } = await runTap(['read'], ['data: {not json\n\n', ': PING\n\n'])
  assert.equal(out, 'data: {not json\n\n: PING\n\n')
  assert.deepEqual(reported, [])
})

test('日志行写清模型、越界名、声明名与 requestId', () => {
  const line = formatUndeclaredToolNameLine({
    model: 'cline/nvidia/nemotron-3.5-lightning-free',
    offending: ['finish'],
    declared: new Set(['read', 'shell']),
    requestId: 'chatcmpl-1',
  })
  assert.match(line, /nemotron-3\.5-lightning-free/)
  assert.match(line, /finish/)
  assert.match(line, /read, shell/)
  assert.match(line, /chatcmpl-1/)
})

test('节流器按 (模型, 名字) 冷却', () => {
  const limiter = new ToolNameAuditLimiter(1_000)
  assert.equal(limiter.claim('m|finish', 10_000), true)
  assert.equal(limiter.claim('m|finish', 10_500), false, '冷却期内不重复告警')
  assert.equal(limiter.claim('m|other', 10_500), true, '不同越界名各自独立')
  assert.equal(limiter.claim('m|finish', 11_001), true, '冷却期过后重新放行')
})