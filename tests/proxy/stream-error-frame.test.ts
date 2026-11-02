import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SSEParser, extractStreamErrorFrame, streamHandler } from '../../src/main/proxy/stream.ts'

test('错误帧解析：保留 message/type/code/param/status', () => {
  assert.deepEqual(
    extractStreamErrorFrame({
      choices: [],
      error: { message: 'boom', type: 'server_error', code: 'SERVER', param: 'tools', statusCode: 400 },
    }),
    { message: 'boom', type: 'server_error', code: 'SERVER', param: 'tools', status: 400 },
  )
  assert.deepEqual(extractStreamErrorFrame({ error: 'plain' }), { message: 'plain' })
  assert.equal(extractStreamErrorFrame({ choices: [{ delta: { content: 'hi' } }] }), null)
})

test('默认转换器遇到上游错误帧时以错误浮现，而不是当空帧丢掉', async () => {
  const transform = streamHandler.createTransformStream('m', 'req-1')
  const output: string[] = []
  transform.on('data', chunk => output.push(chunk.toString()))

  const error = await new Promise<Error>((resolve) => {
    transform.once('error', resolve)
    transform.write(
      'data: {"choices":[],"error":{"message":"upstream failed","type":"server_error","code":"SERVER","statusCode":400}}\n\n',
    )
  })

  assert.equal(error.message, 'upstream failed')
  assert.equal((error as Error & { status?: number }).status, 400)
  assert.equal((error as Error & { code?: string }).code, 'SERVER')
  assert.equal(output.join(''), '', '错误帧不能变成一条正常 chunk')
})

test('正常内容帧仍然通过，flush 恰好补一个 [DONE]', async () => {
  const transform = streamHandler.createTransformStream('m', 'req-1')
  let text = ''
  transform.on('data', chunk => { text += chunk.toString() })
  transform.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')
  transform.end()

  await new Promise<void>(resolve => transform.once('end', resolve))
  assert.match(text, /"content":"hi"/)
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})

test('错误帧跨块到达（半帧）也能识别', async () => {
  const transform = streamHandler.createTransformStream('m', 'req-1')
  const error = new Promise<Error>((resolve) => transform.once('error', resolve))
  transform.write('data: {"error":{"message":"split')
  transform.write(' failure","status":502}}\n\n')
  const err = await error
  assert.equal(err.message, 'split failure')
  assert.equal((err as Error & { status?: number }).status, 502)
})

test('直通流使用的 SSEParser：正常帧不会被误判为错误', () => {
  const parser = new SSEParser()
  const events = parser.parse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
  assert.equal(events.length, 2)
  assert.equal(extractStreamErrorFrame(JSON.parse(events[0].data)), null)
  assert.equal(events[1].data, '[DONE]')
})
