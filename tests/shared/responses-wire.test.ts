import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  chatToResponsesRequest,
  responsesEventToChatChunks,
  responsesBodyToChat,
} from '../../src/shared/responsesWire.ts'

/**
 * 出向 responses：把本应用的 chat 请求翻成 Responses API，再把上游的事件流
 * 翻回 OpenAI chat 形状。
 *
 * 这套翻译只在**出向**用（供应商只支持 /responses 时）。入向（客户端打
 * /v1/responses）在 `responsesInbound.ts`，方向相反、编解码各一套。
 *
 * 三条纪律：
 * 1. `usage` 上游没报就是 `null`，绝不编数字（项目既有契约）；
 * 2. 流里恰好一个结尾，且失败必须是错误帧而不是 assistant 正文；
 * 3. 不认识的模型能力不改写请求 —— 翻译只搬运 `messages` / `tools` / 采样参数。
 */

const MESSAGES = [
  { role: 'system', content: 'You are terse.' },
  { role: 'user', content: 'Say hi.' },
  { role: 'assistant', content: 'hi' },
  { role: 'user', content: 'Again.' },
]

test('messages become a Responses `input` array, system becomes `instructions`', () => {
  const body = chatToResponsesRequest({ model: 'gpt-5', messages: MESSAGES })

  // Responses 把 system 放在顶层 instructions，混在 input 里会被上游忽略
  assert.equal(body.instructions, 'You are terse.')
  assert.deepEqual(
    body.input.map((item: { role: string }) => item.role),
    ['user', 'assistant', 'user'],
    'the system turn must not be repeated inside input'
  )
  assert.equal(body.model, 'gpt-5')
  // 非流式默认不带 stream，避免上游按流回而调用方按 json 解析
  assert.equal(body.stream, undefined)
})

test('streaming flips `stream` on, and sampling parameters are carried through', () => {
  const body = chatToResponsesRequest({
    model: 'gpt-5',
    messages: MESSAGES,
    stream: true,
    temperature: 0.3,
    max_tokens: 64,
    prompt_cache_key: 'sess-42',
  })

  assert.equal(body.stream, true)
  assert.equal(body.temperature, 0.3)
  // chat 的 max_tokens 在 responses 里叫 max_output_tokens
  assert.equal(body.max_output_tokens, 64)
  assert.equal(body.max_tokens, undefined, 'the chat name must not leak into the responses body')
  // 缓存亲和键两边同名：不搬就等于替客户端放弃它自己的 prompt caching。
  assert.equal(body.prompt_cache_key, 'sess-42')
})

test('tools are translated, and tool_choice only when chat named one', () => {
  const body = chatToResponsesRequest({
    model: 'gpt-5',
    messages: MESSAGES,
    tools: [{ type: 'function', function: { name: 'read', description: 'Read a file', parameters: { type: 'object' } } }],
    tool_choice: 'auto',
  })

  assert.equal(body.tools[0].type, 'function')
  assert.equal(body.tools[0].name, 'read', 'responses flattens function.{name,description,parameters}')
  assert.equal(body.tools[0].function, undefined)
  assert.equal(body.tool_choice, 'auto')
})

test('a non-stream Responses body becomes a chat completion, usage null when absent', () => {
  const chat = responsesBodyToChat({
    id: 'resp_1',
    model: 'gpt-5',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hello' }],
      },
    ],
  }, 'gpt-5')

  assert.equal(chat.object, 'chat.completion')
  assert.equal(chat.choices[0].message.role, 'assistant')
  assert.equal(chat.choices[0].message.content, 'hello')
  assert.equal(chat.choices[0].finish_reason, 'stop')
  // 上游没报 usage 时必须是 null，不能补 0
  assert.equal(chat.usage, null)
})

test('reported usage is mapped, including cached tokens', () => {
  const chat = responsesBodyToChat({
    id: 'resp_2',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x' }] }],
    usage: { input_tokens: 10, output_tokens: 4, input_tokens_details: { cached_tokens: 6 } },
  }, 'gpt-5')

  assert.equal(chat.usage.prompt_tokens, 10)
  assert.equal(chat.usage.completion_tokens, 4)
  assert.equal(chat.usage.total_tokens, 14)
  assert.equal(chat.usage.prompt_tokens_details.cached_tokens, 6)
})

test('a refusal/function_call output does not become assistant text', () => {
  const chat = responsesBodyToChat({
    id: 'resp_3',
    output: [
      { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"p":"a"}' },
    ],
  }, 'gpt-5')

  assert.equal(chat.choices[0].message.content, null, 'a tool call carries no assistant text')
  assert.equal(chat.choices[0].message.tool_calls.length, 1)
  assert.equal(chat.choices[0].message.tool_calls[0].function.name, 'read')
  assert.equal(chat.choices[0].message.tool_calls[0].id, 'call_1')
})

test('stream events become chat chunks, one [DONE] at the end', () => {
  const lines = [
    { type: 'response.created', response: { id: 'resp_4', model: 'gpt-5' } },
    { type: 'response.output_text.delta', delta: 'he' },
    { type: 'response.output_text.delta', delta: 'llo' },
    { type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 2 } } },
  ]

  const chunks = responsesEventToChatChunks(lines, 'gpt-5', 'req-1')

  const parsed = chunks
    .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map(line => JSON.parse(line.slice(6)))
  assert.deepEqual(
    parsed.map(chunk => chunk.choices?.[0]?.delta?.content).filter(Boolean),
    ['he', 'llo'],
    'text deltas must be preserved in order and not merged'
  )
  assert.equal(chunks.filter(line => line.includes('[DONE]')).length, 1, 'exactly one [DONE]')
  const finish = parsed.find(chunk => chunk.choices?.[0]?.finish_reason)
  assert.equal(finish.choices[0].finish_reason, 'stop')
  assert.equal(finish.usage.prompt_tokens, 3)
  assert.equal(finish.usage.completion_tokens, 2)
})

test('an upstream error event becomes an error frame, never assistant text', () => {
  const chunks = responsesEventToChatChunks(
    [{ type: 'response.failed', response: { error: { code: 'server_error', message: 'boom' } } }],
    'gpt-5',
    'req-2'
  )

  const frames = chunks
    .filter(line => line.startsWith('data: ') && !line.startsWith('data: [DONE]'))
    .map(line => JSON.parse(line.slice(6)))
  const errorFrame = frames.find(frame => frame.error)
  assert.ok(errorFrame, 'a failed response must surface as an error frame')
  assert.equal(errorFrame.error.message, 'boom')
  assert.equal(
    frames.some(frame => frame.choices?.[0]?.delta?.content),
    false,
    'the failure text must not be emitted as assistant content'
  )
})
