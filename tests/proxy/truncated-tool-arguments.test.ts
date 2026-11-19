/**
 * 2026-11-19：上游在 `finish_reason:"length"` 上收尾时，工具参数会停在 JSON 中间。
 * 三条交付路径都拿它没辙：`sanitizeClientToolArguments` 原样返回、
 * `freeformInputOf` 把半截串当补丁原文、chat 非流式直接透传。于是客户端读到的是一条
 * 能过语法检查、内容被砍掉一半的补丁。
 *
 * 这里锁住三件事：判据只认「外壳在、内容断」；非流式整条摘掉；流式在收尾帧标注。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { looksLikeTruncatedToolArguments } from '../../src/shared/truncatedToolArguments.ts'
import { pruneTruncatedToolCalls } from '../../src/main/proxy/utils/truncatedToolCalls.ts'
import { createTruncatedToolArgsTap } from '../../src/main/proxy/utils/truncatedToolArgsTap.ts'
import { safeClientToolArguments } from '../../src/shared/clientToolArguments.ts'
import { chatResponseToResponseBody } from '../../src/shared/responsesInbound.ts'

test('判据：外壳在、内容断才算截断', () => {
  assert.equal(looksLikeTruncatedToolArguments('{"input":"Begin Patch'), true)
  assert.equal(looksLikeTruncatedToolArguments('[1, 2'), true)
  assert.equal(looksLikeTruncatedToolArguments('  {"a": '), true)
})

test('判据不误伤：合法空参数、纯文本补丁、解析得动的完整 JSON', () => {
  assert.equal(looksLikeTruncatedToolArguments('{}'), false)
  assert.equal(looksLikeTruncatedToolArguments('[]'), false)
  assert.equal(looksLikeTruncatedToolArguments('{"input":"*** Begin Patch"}'), false)
  // 上游把补丁当纯文本回：不以括号开头，原文就是 input。
  assert.equal(looksLikeTruncatedToolArguments('*** Begin Patch\n*** End Patch'), false)
  assert.equal(looksLikeTruncatedToolArguments(''), false)
  assert.equal(looksLikeTruncatedToolArguments(undefined), false)
  assert.equal(looksLikeTruncatedToolArguments({ input: 'x' }), false)
})

test('非流式：截断的 function 调用整条摘掉，完整的保留', () => {
  const body = {
    choices: [{
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_ok', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
          { id: 'call_cut', type: 'function', function: { name: 'apply_patch', arguments: '{"input":"Begin Patch' } },
        ],
      },
    }],
  }

  const pruned = pruneTruncatedToolCalls(body)
  assert.equal(pruned.dropped, 1)
  const calls = (pruned.body as any).choices[0].message.tool_calls
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, 'call_ok')
  // 入参不许被就地修改：日志与审计还在读原始 body。
  assert.equal((body as any).choices[0].message.tool_calls.length, 2)
})

test('非流式：全部被摘掉时删键，不留空数组', () => {
  const body = {
    choices: [{
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_cut', type: 'function', function: { name: 'apply_patch', arguments: '{"input":"Beg' } },
        ],
      },
    }],
  }

  const pruned = pruneTruncatedToolCalls(body)
  assert.equal(pruned.dropped, 1)
  const message = (pruned.body as any).choices[0].message
  assert.equal('tool_calls' in message, false)
  assert.equal(message.content, '')
})

test('非流式：没有截断时原样返回，不动对象结构', () => {
  const body = {
    choices: [{
      message: {
        role: 'assistant',
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
        ],
      },
    }],
  }
  const pruned = pruneTruncatedToolCalls(body)
  assert.equal(pruned.dropped, 0)
  assert.equal(pruned.body, body)
})

test('交付前的兜底：截断参数换成空对象，完整参数照常校正', () => {
  assert.equal(safeClientToolArguments('apply_patch', '{"input":"Begin Patch'), '{}')
  assert.equal(
    safeClientToolArguments('read_file', '{"path":"a.ts"}'),
    '{"path":"a.ts"}',
  )
})

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    stream.on('data', (chunk: Buffer) => { text += chunk.toString() })
    stream.on('end', () => resolve(text))
    stream.on('error', reject)
  })
}

test('流式：分片拼出的截断参数在收尾帧上标注条数', async () => {
  const tap = createTruncatedToolArgsTap()
  const done = collect(tap)

  tap.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function",'
    + '"function":{"name":"apply_patch","arguments":"{\\"input\\":\\"Begin Pat"}}]}}]}\n\n')
  tap.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ch"}}]}}]}\n\n')
  tap.write('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')
  tap.end()

  const text = await done
  const finishLine = text.split('\n\n').find(line => line.includes('"finish_reason":"length"'))
  assert.ok(finishLine, '收尾帧必须被转发')
  const frame = JSON.parse(finishLine!.slice('data: '.length))
  assert.equal(frame.x_modelport_tool_args_truncated, 1)
  assert.equal(frame.choices[0].finish_reason, 'length')
})

test('流式：完整参数不标注', async () => {
  const tap = createTruncatedToolArgsTap()
  const done = collect(tap)

  tap.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function",'
    + '"function":{"name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\n\n')
  tap.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
  tap.end()

  const text = await done
  assert.equal(text.includes('x_modelport_tool_args_truncated'), false)
  assert.ok(text.includes('"finish_reason":"stop"'))
})

test('流式：跨 chunk 拆开的一帧也能判', async () => {
  const tap = createTruncatedToolArgsTap()
  const done = collect(tap)

  const chunk = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1",'
    + '"function":{"name":"apply_patch","arguments":"{\\"input\\":\\"Beg"}}]}}]}\n\n'
  // 在 JSON 中间切断，模拟 TCP 分片不按事件边界到达。
  tap.write(chunk.slice(0, 40))
  tap.write(chunk.slice(40))
  tap.write('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')
  tap.end()

  const text = await done
  const finishLine = text.split('\n\n').find(line => line.includes('"finish_reason":"length"'))
  const frame = JSON.parse(finishLine!.slice('data: '.length))
  assert.equal(frame.x_modelport_tool_args_truncated, 1)
})

test('responses 泳道：截断的自由文本补丁交付成空 input，不是一个半截补丁', () => {
  const out = chatResponseToResponseBody({
    choices: [{
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'apply_patch', arguments: '{"input":"*** Begin Patch\\n*** Update File: a.ts' },
        }],
      },
    }],
  }, { model: 'gpt-5', fallbackId: 'req_1', freeformTools: ['apply_patch'] })

  const item = (out as any).output.find((entry: any) => entry.type === 'custom_tool_call')
  assert.ok(item, '自由文本工具必须回成 custom_tool_call')
  assert.equal(item.input, '')
})

test('responses 泳道：完整的自由文本补丁照常还原', () => {
  const out = chatResponseToResponseBody({
    choices: [{
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'apply_patch', arguments: JSON.stringify({ input: '*** Begin Patch\n*** End Patch' }) },
        }],
      },
    }],
  }, { model: 'gpt-5', fallbackId: 'req_1', freeformTools: ['apply_patch'] })

  const item = (out as any).output.find((entry: any) => entry.type === 'custom_tool_call')
  assert.equal(item.input, '*** Begin Patch\n*** End Patch')
})