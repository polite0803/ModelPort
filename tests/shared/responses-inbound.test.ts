/**
 * 入向 Responses API（客户端打 `/v1/responses`）的编解码契约测试。
 *
 * 只证纯函数这一层：投影对不对、缺席有没有被伪装成正常值、流的骨架配不配对。
 * 「回环真的打得通、头真的带得出去」那一层在 `tests/routes/responses-inbound.test.ts`，
 * 两边不重复。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  chatResponseToResponseBody,
  createResponsesStreamTranslator,
  freeformToolNamesOf,
  responsesHasInput,
  responsesToChatRequest,
  responsesUnsupportedParams,
} from '../../src/shared/responsesInbound.ts'

type Payload = Record<string, any>

/* ------------------------------------------------------------------ 请求投影 */

test('instructions 落回 system，input 字符串落回 user', () => {
  const request = responsesToChatRequest(
    { instructions: 'Be terse.', input: 'hi' },
    { model: 'auto', stream: false },
  )

  assert.deepEqual(request.messages, [
    { role: 'system', content: 'Be terse.' },
    { role: 'user', content: 'hi' },
  ])
  assert.equal(request.model, 'auto')
})

test('instructions 也接受分片数组形态', () => {
  const request = responsesToChatRequest(
    { instructions: [{ type: 'input_text', text: 'A' }, { type: 'input_text', text: 'B' }] },
    { model: 'auto', stream: false },
  )

  assert.deepEqual(request.messages, [{ role: 'system', content: 'AB' }])
})

test('developer 角色折成 system；reasoning 进 reasoning_content，不进正文', () => {
  const request = responsesToChatRequest(
    {
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: 'dev order' }] },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'private chain' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ],
    },
    { model: 'auto', stream: false },
  )

  assert.deepEqual(request.messages, [
    { role: 'system', content: 'dev order' },
    // 没有紧随其后的 assistant 时，思考项单独落成一条 assistant；content 仍为 null。
    { role: 'assistant', content: null, reasoning_content: 'private chain' },
    { role: 'user', content: 'hello' },
  ])
})

test('function_call 与 function_call_output 按原顺序投影，且调用与结果相邻', () => {
  const request = responsesToChatRequest(
    {
      input: [
        { role: 'user', content: 'weather?' },
        { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"SF"}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'sunny' },
      ],
    },
    { model: 'auto', stream: false },
  )

  // 工具结果一旦与产生它的调用分离，上游会当成「没有对应调用的工具结果」直接拒。
  assert.deepEqual(request.messages, [
    { role: 'user', content: 'weather?' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }],
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'sunny' },
  ])
})

test('function_call_output 的 output 也接受分片数组', () => {
  const request = responsesToChatRequest(
    { input: [{ type: 'function_call_output', call_id: 'c', output: [{ type: 'output_text', text: 'x' }] }] },
    { model: 'auto', stream: false },
  )

  assert.deepEqual(request.messages, [{ role: 'tool', tool_call_id: 'c', content: 'x' }])
})

test('input_image 折成 chat 的 image_url 分片，文本与图片混排时保留两样', () => {
  const request = responsesToChatRequest(
    {
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'what is in this?' },
            { type: 'input_image', image_url: 'https://example.test/a.png' },
          ],
        },
      ],
    },
    { model: 'auto', stream: false },
  )

  assert.deepEqual(request.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is in this?' },
        { type: 'image_url', image_url: { url: 'https://example.test/a.png' } },
      ],
    },
  ])
})

test('tools 的字段从 tool 自身嵌回 chat 的 function', () => {
  const request = responsesToChatRequest(
    {
      input: 'hi',
      tools: [{ type: 'function', name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} } }],
      tool_choice: { type: 'function', name: 'get_weather' },
    },
    { model: 'auto', stream: false },
  )

  assert.deepEqual(request.tools, [
    { type: 'function', function: { name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} } } },
  ])
  assert.deepEqual(request.tool_choice, { type: 'function', function: { name: 'get_weather' } })
})

test('tool_choice 的字符串形态直通', () => {
  assert.equal(responsesToChatRequest({ input: 'x', tool_choice: 'required' }, { model: 'auto', stream: false }).tool_choice, 'required')
})

test('参数改名与直通：max_output_tokens、text.format、reasoning.effort', () => {
  const request = responsesToChatRequest(
    {
      input: 'x',
      max_output_tokens: 512,
      temperature: 0.3,
      top_p: 0.9,
      prompt_cache_key: 'sess-42',
      text: { format: { type: 'json_schema', name: 'answer', schema: { type: 'object' }, strict: true } },
      reasoning: { effort: 'high' },
      parallel_tool_calls: false,
    },
    { model: 'auto', stream: false },
  )

  assert.equal(request.max_tokens, 512)
  assert.equal(request.temperature, 0.3)
  assert.equal(request.top_p, 0.9)
  // 缓存亲和键两边同名，必须原样带走：丢了客户端只会上游「变慢了」而查不出原因。
  assert.equal(request.prompt_cache_key, 'sess-42')
  assert.deepEqual(request.response_format, {
    type: 'json_schema',
    json_schema: { name: 'answer', schema: { type: 'object' }, strict: true },
  })
  assert.equal(request.reasoning_effort, 'high')
  assert.equal(request.parallel_tool_calls, false)
})

test('没发 prompt_cache_key 时不造一个空串', () => {
  const request = responsesToChatRequest({ input: 'x' }, { model: 'auto', stream: false })

  assert.equal(request.prompt_cache_key, undefined)
})

test('reasoning.effort=auto 没有 chat 对应值：丢掉而不是猜档位', () => {
  const request = responsesToChatRequest({ input: 'x', reasoning: { effort: 'auto' } }, { model: 'auto', stream: false })

  assert.equal(request.reasoning_effort, undefined)
})

test('流式主动要 usage，非流式不带', () => {
  const streaming = responsesToChatRequest({ input: 'x', stream: true }, { model: 'auto', stream: true })
  assert.equal(streaming.stream, true)
  assert.deepEqual(streaming.stream_options, { include_usage: true })

  const buffered = responsesToChatRequest({ input: 'x' }, { model: 'auto', stream: false })
  assert.equal(buffered.stream, undefined)
  assert.equal(buffered.stream_options, undefined)
})

/* ------------------------------------------------------------------ 拒绝与容忍 */

test('要求「网关记得上一次」的参数点名拒绝', () => {
  assert.deepEqual(responsesUnsupportedParams({ previous_response_id: 'resp_1' }), ['previous_response_id'])
  assert.deepEqual(responsesUnsupportedParams({ background: true }), ['background'])
  assert.deepEqual(responsesUnsupportedParams({ conversation: 'conv_1' }), ['conversation'])
  assert.deepEqual(
    responsesUnsupportedParams({ input: [{ type: 'item_reference', id: 'item_1' }] }),
    ['input[].item_reference'],
  )
  assert.deepEqual(
    responsesUnsupportedParams({ previous_response_id: 'resp_1', background: true }),
    ['previous_response_id', 'background'],
  )
})

test('可容忍的 responses 专有字段不拒绝（Codex 每次固定发 truncation）', () => {
  assert.deepEqual(
    responsesUnsupportedParams({
      input: 'x',
      truncation: 'disabled',
      store: true,
      metadata: { u: '1' },
      include: ['reasoning.encrypted_content'],
      service_tier: 'priority',
      background: false,
    }),
    [],
  )
})

test('空 input 判不出来不等于没有输入：instructions-only 也算有内容', () => {
  assert.equal(responsesHasInput({ instructions: 'only system' }), true)
  assert.equal(responsesHasInput({ input: '' }), false)
  assert.equal(responsesHasInput({ input: [] }), false)
  assert.equal(responsesHasInput({}), false)
  assert.equal(responsesHasInput({ input: 'hi' }), true)
})

/* ------------------------------------------------------------------ 非流式响应 */

const chatCompletion = (over: Payload = {}): Payload => ({
  id: 'chatcmpl-abc123',
  object: 'chat.completion',
  created: 1700000000,
  model: 'antp-upstream',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 },
  ...over,
})

test('chat completion → response 对象：正文进 output_text', () => {
  const response = chatResponseToResponseBody(chatCompletion(), { model: 'auto', fallbackId: 'req-1' }) as Payload

  assert.equal(response.object, 'response')
  assert.equal(response.id, 'resp_abc123')
  assert.equal(response.status, 'completed')
  assert.equal(response.model, 'auto', '回显客户端点名的模型，不是上游那个真名')
  assert.equal(response.created_at, 1700000000)
  assert.deepEqual(response.output, [
    {
      id: 'msg_abc123',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'hello', annotations: [] }],
    },
  ])
  assert.deepEqual(response.usage, { input_tokens: 21, output_tokens: 7, total_tokens: 28 })
})

test('usage 上游没报就是 null，不补 0', () => {
  const response = chatResponseToResponseBody(chatCompletion({ usage: null }), { model: 'auto', fallbackId: 'r' }) as Payload

  assert.equal(response.usage, null)
})

test('tool_calls 投影成 function_call 项，排在 message 之后', () => {
  const response = chatResponseToResponseBody(
    chatCompletion({
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'one moment',
          tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
    }),
    { model: 'auto', fallbackId: 'r' },
  ) as Payload

  assert.deepEqual(response.output.map(item => item.type), ['message', 'function_call'])
  assert.deepEqual(response.output[1], {
    id: 'fc_9',
    type: 'function_call',
    status: 'completed',
    call_id: 'call_9',
    name: 'get_weather',
    arguments: '{"city":"SF"}',
  })
})

test('refusal 不进 output_text', () => {
  const response = chatResponseToResponseBody(
    chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: null, refusal: 'no' }, finish_reason: 'stop' }] }),
    { model: 'auto', fallbackId: 'r' },
  ) as Payload

  assert.deepEqual(response.output[0].content, [{ type: 'refusal', refusal: 'no' }])
})

test('被截断报 incomplete + 原因，不是伪造一次成功', () => {
  const response = chatResponseToResponseBody(
    chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }] }),
    { model: 'auto', fallbackId: 'r' },
  ) as Payload

  assert.equal(response.status, 'incomplete')
  assert.deepEqual(response.incomplete_details, { reason: 'max_output_tokens' })
})

/* ------------------------------------------------------------------ 流式骨架 */

const frames = (text: string): string[] =>
  text
    .split('\n\n')
    .filter(frame => frame.startsWith('event:'))
    .map(frame => frame.split('\n')[0].slice(6).trim())

const decode = (text: string): Payload[] =>
  text
    .split('\n\n')
    .filter(frame => frame.includes('data: '))
    .map(frame => JSON.parse(frame.slice(frame.indexOf('data: ') + 6)) as Payload)

test('文本流：恰好一套骨架，一个结尾，没有 [DONE]', () => {
  const t = createResponsesStreamTranslator({ model: 'auto', fallbackId: 'r1' })
  let out = ''
  out += t.push('data: {"id":"chatcmpl-z","choices":[{"index":0,"delta":{"content":"你好"}}]}\n\n')
  out += t.push('data: {"id":"chatcmpl-z","choices":[{"index":0,"delta":{"content":"，世界"}}]}\n\n')
  out += t.push('data: {"id":"chatcmpl-z","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":900,"completion_tokens":17}}\n\n')
  out += t.push('data: [DONE]\n\n')
  out += t.end()

  assert.deepEqual(frames(out), [
    'response.created',
    'response.in_progress',
    'response.output_item.added',
    'response.content_part.added',
    'response.output_text.delta',
    'response.output_text.delta',
    'response.output_text.done',
    'response.content_part.done',
    'response.output_item.done',
    'response.completed',
  ])

  const events = decode(out)
  assert.deepEqual(events.filter(e => e.type === 'response.output_text.delta').map(e => e.delta), ['你好', '，世界'])
  assert.deepEqual(events.at(-1)?.response.usage, { input_tokens: 900, output_tokens: 17, total_tokens: 917 })
  assert.equal(events.at(-1)?.response.status, 'completed')
  assert.equal(events.at(-1)?.response.output[0].content[0].text, '你好，世界')
  assert.ok(!out.includes('[DONE]'), 'Responses 客户端不认 [DONE]')
  assert.deepEqual(
    events.map((_, i) => i).map(i => events[i].sequence_number),
    events.map((_, i) => i),
    'sequence_number 必须从 0 连续递增',
  )
})

test('工具分片：同 index 续在一个项上，arguments 逐段发', () => {
  const t = createResponsesStreamTranslator({ model: 'auto', fallbackId: 'r2' })
  let out = ''
  out += t.push('data: {"id":"chatcmpl-t","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}\n\n')
  out += t.push('data: {"id":"chatcmpl-t","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\""}}]}}]}\n\n')
  out += t.push('data: {"id":"chatcmpl-t","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"SF\\"}"}}]}}]}\n\n')
  out += t.push('data: {"id":"chatcmpl-t","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n')
  out += t.end()

  const events = decode(out)
  assert.equal(frames(out).filter(n => n === 'response.output_item.added').length, 1, '三次分片只能开一个项')
  assert.deepEqual(
    events.filter(e => e.type === 'response.function_call_arguments.delta').map(e => e.delta),
    ['{"city"', ':"SF"}'],
    '拼完再发会让客户端从逐段渲染退化成一次性出现',
  )

  const completed = events.at(-1) as Payload
  assert.equal(completed.response.status, 'completed')
  assert.deepEqual(completed.response.output, [
    { id: 'fc_a', type: 'function_call', status: 'completed', call_id: 'call_a', name: 'get_weather', arguments: '{"city":"SF"}' },
  ])
})

test('两个工具调用（index 0 与 1）开两个项，output_index 递增', () => {
  const t = createResponsesStreamTranslator({ model: 'auto', fallbackId: 'r3' })
  let out = ''
  out += t.push('data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"a","arguments":"{}"}}]}}]}\n\n')
  out += t.push('data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"c1","function":{"name":"b","arguments":"{}"}}]}}]}\n\n')
  out += t.end()

  const events = decode(out)
  assert.deepEqual(events.filter(e => e.type === 'response.output_item.added').map(e => e.output_index), [0, 1])
  assert.equal(t.end(), '', '结尾事件只发一次')
})

test('帧被截在半个 JSON 上也只开一个项', () => {
  const t = createResponsesStreamTranslator({ model: 'auto', fallbackId: 'r4' })
  const whole = 'data: {"id":"chatcmpl-x","choices":[{"index":0,"delta":{"content":"ab"}}]}\n\n'
  let out = ''
  out += t.push(whole.slice(0, 20))
  out += t.push(whole.slice(20))
  out += t.end()

  assert.equal(decode(out).filter(e => e.type === 'response.output_item.added').length, 1)
  assert.ok(out.includes('event: response.completed'))
})

test('上游没报 usage 时 completed 的 usage 是 null', () => {
  const t = createResponsesStreamTranslator({ model: 'auto', fallbackId: 'r5' })
  let out = ''
  out += t.push('data: {"choices":[{"index":0,"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n')
  out += t.end()

  assert.equal(decode(out).at(-1)?.response.usage, null)
})

test('finish_reason=length → response.incomplete（不是 completed）', () => {
  const t = createResponsesStreamTranslator({ model: 'auto', fallbackId: 'r6' })
  let out = ''
  out += t.push('data: {"choices":[{"index":0,"delta":{"content":"cut"},"finish_reason":"length"}]}\n\n')
  out += t.end()

  const events = decode(out)
  assert.equal(events.at(-1)?.type, 'response.incomplete')
  assert.deepEqual(events.at(-1)?.response.incomplete_details, { reason: 'max_output_tokens' })
})

test('上游错误帧 → response.failed，且不再补 completed', () => {
  const t = createResponsesStreamTranslator({ model: 'auto', fallbackId: 'r7' })
  let out = ''
  out += t.push('data: {"error":{"message":"boom","code":"server_error"}}\n\n')
  out += t.end()

  assert.deepEqual(frames(out), ['response.failed'])
  assert.equal(decode(out)[0].response.error.message, 'boom')
})

test('传输层异常：一条 response.failed，之后再 push 也不出正文', () => {
  const t = createResponsesStreamTranslator({ model: 'auto', fallbackId: 'r8' })
  const failed = t.fail('connection reset')

  assert.deepEqual(frames(failed), ['response.failed'])
  assert.equal(decode(failed)[0].response.error.message, 'connection reset')
  assert.equal(t.push('data: {"choices":[{"index":0,"delta":{"content":"late"}}]}\n\n'), '')
  assert.equal(t.end(), '')
})

test('上游一个字也没发就断线：仍给出 created 与唯一的 completed', () => {
  const t = createResponsesStreamTranslator({ model: 'auto', fallbackId: 'r9' })
  const out = t.end()

  assert.deepEqual(frames(out), [
    'response.created',
    'response.in_progress',
    'response.completed',
  ])
  assert.deepEqual(decode(out).at(-1)?.response.output, [])
})

/* ---------------- 2026-11-02：reasoning 项回灌为 assistant.reasoning_content ---------------- */

test('reasoning 项挂到紧随其后的 assistant 消息上', () => {
  const request = responsesToChatRequest({
    input: [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'think first' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] },
    ],
  }, { model: 'auto', stream: false })

  const assistant = request.messages.at(-1) as any
  assert.equal(assistant.role, 'assistant')
  assert.equal(assistant.content, 'done')
  assert.equal(assistant.reasoning_content, 'think first')
})

test('reasoning 项挂在 function_call 上，工具轮不丢思考', () => {
  const request = responsesToChatRequest({
    input: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'need a tool' }] },
      { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
    ],
  }, { model: 'auto', stream: false })

  const assistant = request.messages.at(-1) as any
  assert.equal(assistant.reasoning_content, 'need a tool')
  assert.equal(assistant.tool_calls?.[0]?.id, 'call_1')
})

test('只有 encrypted_content 时不伪造思考文本', () => {
  const request = responsesToChatRequest({
    input: [
      { type: 'reasoning', encrypted_content: 'ciphertext' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
    ],
  }, { model: 'auto', stream: false })

  const assistant = request.messages.at(-1) as any
  assert.equal(assistant.reasoning_content, undefined)
})

/* ---------------------------------------------------- 自由文本（custom）工具 */

// Codex 的 apply_patch 是 `type:'custom'` 的自由文本工具：参数是一段原文，不是 JSON。
// 这一族用例钉的是「写盘为什么没发生」：声明要给出 input 契约、历史里的补丁要能回到
// 上游眼前、回来的调用项必须是 custom_tool_call（发成 function_call 客户端不执行）。
const PATCH = '*** Begin Patch\n*** Update File: src/main/proxy/compression/ccr/markers.ts\n@@\n+export const X = 1\n*** End Patch'

test('freeformToolNamesOf 只认自由文本工具，带 schema 的函数与托管工具都不算', () => {
  assert.deepEqual(
    freeformToolNamesOf({
      tools: [
        { type: 'function', name: 'exec_command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } },
        { type: 'custom', name: 'apply_patch', format: { type: 'text' } },
        { name: 'web_search', type: 'web_search' },
        { type: 'function', name: 'no_schema_but_function' },
        { type: 'freeform', name: 'raw_prompt' },
      ],
    }),
    // 托管工具（web_search）没有「一段原文当参数」这回事，给它编造 input 契约等于
    // 替客户端改语义；只有 custom/freeform 或带 format 的才是自由文本。
    ['apply_patch', 'raw_prompt'],
  )
})

test('自由文本工具的声明折成 chat 的 input 契约：模型不再只能从 description 猜形状', () => {
  const request = responsesToChatRequest(
    {
      input: 'go',
      tools: [
        { type: 'function', name: 'exec_command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } },
        { type: 'custom', name: 'apply_patch', description: 'Apply a patch', format: { type: 'text' } },
      ],
    },
    { model: 'codex', stream: false },
  )

  const patch = (request.tools as Payload[]).find(tool => tool.function.name === 'apply_patch') as Payload
  assert.deepEqual(patch.function.parameters, {
    type: 'object',
    properties: { input: { type: 'string', description: 'Raw text payload for this tool, not JSON.' } },
    required: ['input'],
    additionalProperties: false,
  })
  assert.equal(patch.function.description, 'Apply a patch')
  // 函数工具自己的 schema 不被改写
  const exec = (request.tools as Payload[]).find(tool => tool.function.name === 'exec_command') as Payload
  assert.equal(exec.function.parameters.properties.cmd.type, 'string')
})

test('历史里的 custom_tool_call / custom_tool_call_output 折进消息：补丁不再从上游眼前消失', () => {
  const request = responsesToChatRequest(
    {
      input: [
        { type: 'custom_tool_call', call_id: 'c1', name: 'apply_patch', input: PATCH },
        { type: 'custom_tool_call_output', call_id: 'c1', output: 'Success. updated 1 file' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'next' }] },
      ],
    },
    { model: 'codex', stream: false },
  )

  const [call, result, next] = request.messages as Payload[]
  assert.equal(call.role, 'assistant')
  assert.equal(call.content, null)
  assert.equal(call.tool_calls[0].id, 'c1')
  assert.deepEqual(JSON.parse(call.tool_calls[0].function.arguments), { input: PATCH })
  assert.equal(result.role, 'tool')
  assert.equal(result.tool_call_id, 'c1')
  assert.equal(result.content, 'Success. updated 1 file')
  assert.equal(next.role, 'user')
})

test('回来的调用项按客户端声明的类型发：自由文本发 custom_tool_call + 原文 input', () => {
  const body = chatResponseToResponseBody(
    {
      id: 'chatcmpl-a',
      choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'apply_patch', arguments: JSON.stringify({ input: PATCH }) } }] }, finish_reason: 'tool_calls' }],
    },
    { model: 'codex', fallbackId: 'r1', freeformTools: ['apply_patch'] },
  )

  const item = (body.output as Payload[]).find(o => o.type === 'custom_tool_call') as Payload
  assert.equal(item.call_id, 'call_1')
  assert.equal(item.name, 'apply_patch')
  assert.equal(item.input, PATCH)
  assert.equal(item.arguments, undefined)
})

test('没声明成自由文本的照旧是 function_call（不替别的客户端改形状）', () => {
  const body = chatResponseToResponseBody(
    {
      id: 'chatcmpl-b',
      choices: [{ message: { tool_calls: [{ id: 'call_2', function: { name: 'exec_command', arguments: '{"cmd":"ls"}' } }] }, finish_reason: 'tool_calls' }],
    },
    { model: 'codex', fallbackId: 'r2', freeformTools: ['apply_patch'] },
  )

  const item = (body.output as Payload[])[0] as Payload
  assert.equal(item.type, 'function_call')
  assert.equal(item.arguments, '{"cmd":"ls"}')
})

test('流式：自由文本项的骨架是 custom_tool_call，input 在收尾一次给全，不转发半截 JSON', () => {
  const t = createResponsesStreamTranslator({ model: 'codex', fallbackId: 'r3', freeformTools: ['apply_patch'] })
  let out = ''
  const args = JSON.stringify({ input: PATCH })
  const frame = (payload: Payload): string => 'data: ' + JSON.stringify(payload) + '\n\n'
  out += t.push(frame({ id: 'chatcmpl-c', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_3', function: { name: 'apply_patch', arguments: args.slice(0, 12) } }] } }] }))
  out += t.push(frame({ id: 'chatcmpl-c', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(12) } }] } }], finish_reason: 'tool_calls' }))
  out += t.push('data: [DONE]\n\n')
  out += t.end()

  const events = decode(out)
  const added = events.find(e => e.type === 'response.output_item.added') as Payload
  assert.equal(added.item.type, 'custom_tool_call')
  assert.equal(added.item.input, '')
  assert.ok(!out.includes('response.function_call_arguments.delta'), '半截 JSON 不该作为 arguments 片段发给客户端')
  const done = events.find(e => e.type === 'response.custom_tool_call_input.done') as Payload
  assert.equal(done.input, PATCH)
  const item = events.find(e => e.type === 'response.output_item.done') as Payload
  assert.equal(item.item.type, 'custom_tool_call')
  assert.equal(item.item.input, PATCH)
})

test('流式：函数工具仍然逐段发 arguments.delta（自由文本的收紧不波及普通调用）', () => {
  const t = createResponsesStreamTranslator({ model: 'codex', fallbackId: 'r4', freeformTools: ['apply_patch'] })
  let out = ''
  out += t.push('data: {"id":"chatcmpl-d","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_4","function":{"name":"exec_command","arguments":"{\\"cmd\\":"}}]}}]}\n\n')
  out += t.push('data: {"id":"chatcmpl-d","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls\\"}"}}]}}],"finish_reason":"tool_calls"}\n\n')
  out += t.push('data: [DONE]\n\n')
  out += t.end()

  assert.ok(out.includes('response.function_call_arguments.delta'))
  const item = decode(out).find(e => e.type === 'response.output_item.done') as Payload
  assert.equal(item.item.type, 'function_call')
  assert.deepEqual(JSON.parse(item.item.arguments), { cmd: 'ls' })
})
