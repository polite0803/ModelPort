import { test } from 'node:test'
import assert from 'node:assert/strict'

import { streamHandler } from '../../src/main/proxy/stream.ts'

function run(frames: string[]): Promise<string> {
  const transform = streamHandler.createTransformStream('m', 'req-finish')
  let text = ''
  transform.on('data', (chunk: Buffer) => { text += chunk.toString() })
  for (const frame of frames) transform.write(frame)
  transform.end()
  return new Promise<string>((resolve) => {
    transform.once('end', () => resolve(text))
  })
}

const content = (value: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: value } }] })}\n\n`
const finish = (reason: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`
const DONE = 'data: [DONE]\n\n'

test('散文流里出现单独的 "[" 后，结束帧仍然到达且正文顺序不变', async () => {
  const text = await run([
    content('相关文件：'),
    content('['),
    content('stream.ts](file:///x)'),
    finish('stop'),
    DONE,
  ])

  assert.match(text, /"finish_reason":"stop"/, '上游的结束原因必须转发给客户端')
  assert.match(text, /stream\.ts\]\(file:\/\/\/x\)/, '缓冲过的正文必须逐帧给出，不能丢')
  assert.ok(
    text.indexOf('stream.ts](file:///x)') < text.indexOf('"finish_reason":"stop"'),
    '正文必须在结束帧之前到达',
  )
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})

test('正文里的 [function_calls] 字面量按原文透传，不再被改写成 tool_calls', async () => {
  const literal = '[function_calls][call:x]{}[/call][/function_calls]'
  const text = await run([
    content('示例：'),
    content(literal),
    finish('stop'),
    DONE,
  ])

  assert.doesNotMatch(text, /"tool_calls"/, '没有原生 tool_calls 就不能凭空造一个')
  assert.ok(text.includes('示例：'))
  assert.ok(text.includes(literal.slice(0, 20)), '标记文本属于模型原文，必须完整交付')
  assert.match(text, /"finish_reason":"stop"/)
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})

test('原生 tool_calls 流不受影响：工具调用与 finish_reason 都保留', async () => {
  const text = await run([
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'read', arguments: '{}' },
          }],
        },
      }],
    })}\n\n`,
    finish('tool_calls'),
    DONE,
  ])

  assert.match(text, /"tool_calls":\[\{/)
  assert.match(text, /"name":"read"/)
  assert.match(text, /"finish_reason":"tool_calls"/)
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})

test('上游只给 reasoning 时，收尾仍用 reasoning 补一帧正文', async () => {
  const text = await run([
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '只有思考' } }] })}\n\n`,
    DONE,
  ])

  assert.match(text, /"content":"只有思考"/, '正文为空的推理流需要兜底，否则客户端读成空响应')
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})

test('空流只补一个 [DONE]，不产生多余正文帧', async () => {
  const text = await run([DONE])

  const contentFrames = text.match(/"content":/g)?.length ?? 0
  assert.equal(contentFrames, 0)
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})

test('reasoning 流命中 max_tokens 时，回填正文必须排在结束帧之前', async () => {
  const text = await run([
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '只有思考' } }] })}\n\n`,
    finish('max_tokens'),
    DONE,
  ])

  assert.match(text, /"finish_reason":"max_tokens"/)
  assert.ok(
    text.indexOf('"content":"只有思考"') < text.indexOf('"finish_reason":"max_tokens"'),
    '结束帧之后再来正文会被 strict 客户端判成 content_after_finish，整轮拒收',
  )
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})

test('结束帧立即下发，不等 [DONE]；上游之后补发的正文照原文转发', async () => {
  const seen: string[] = []
  const transform = streamHandler.createTransformStream('m', 'req-no-hold')
  transform.on('data', (chunk: Buffer) => { seen.push(chunk.toString()) })

  transform.write(content('答案'))
  transform.write(finish('stop'))
  assert.match(seen.join(''), /"finish_reason":"stop"/, '结束帧不能为了排后面可能的正文而被扣住')

  transform.write(content('尾注'))
  transform.end()
  await new Promise<void>((resolve) => transform.once('end', () => resolve()))

  const text = seen.join('')
  assert.ok(text.includes('"content":"尾注"'), '上游补发的正文属于模型原文，不能丢')
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})

test('结束帧之后才到的 reasoning 不再补成正文帧', async () => {
  const text = await run([
    finish('max_tokens'),
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '迟到的思考' } }] })}\n\n`,
    DONE,
  ])

  assert.doesNotMatch(text, /"content":"迟到的思考"/, '结束帧之后的正文同样会被 strict 客户端整轮拒收')
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})

test('结束帧之后的 usage 尾帧跟随结束帧，且不丢 usage', async () => {
  const usage = `data: ${JSON.stringify({
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  })}\n\n`
  const text = await run([content('答案'), finish('stop'), usage, DONE])

  assert.match(text, /"total_tokens":3/)
  assert.ok(text.indexOf('"finish_reason":"stop"') < text.indexOf('"total_tokens":3'))
  assert.equal(text.match(/data: \[DONE\]/g)?.length, 1)
})