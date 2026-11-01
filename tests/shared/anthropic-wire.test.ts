/**
 * 入向 anthropic 协议（`/v1/messages`）的编解码契约测试。
 *
 * 为什么必须成套（而不是只测我这次改的三格）：`src/shared/anthropicWire.ts` 是
 * 650 行、有状态的协议翻译层，此前**一条测试都没有**，而它的失败形态全部是
 * 「客户端把错误当回答读」或「骨架不配对导致 SDK 解析炸」这一类静默故障。
 * 既有 `tests/shared/responses-wire.test.ts` 对出向那半边立的规矩，这里照同一套
 * 对入向半边立一遍：四条纪律逐条断言，每条都配坏样本。
 *
 * 1. 上游没报 usage 就不发 usage（非流）／估算值必须能被认出来（流）；
 * 2. 一条流恰好一套骨架，块start/stop 配对、索引单调；
 * 3. 失败是 `error` 事件，不是正文，且发过 error 就不再补 message_stop；
 * 4. 只做一一对应的字段搬运，不认识的块丢掉而不是猜。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  anthropicErrorBody,
  anthropicErrorTypeOf,
  anthropicToChatRequest,
  chatResponseToAnthropicMessage,
  createAnthropicStreamTranslator,
  estimateAnthropicInputTokens,
  modelsToAnthropicList,
  stopReasonOf,
} from '../../src/shared/anthropicWire.ts'

/** 把一段 anthropic SSE 文本按事件拆开（`event:` + `data:` 成对）。 */
function eventsOf(text: string): Array<{ event: string, data: any }> {
  const out: Array<{ event: string, data: any }> = []
  for (const frame of text.split('\n\n')) {
    if (frame.trim() === '') continue
    let event = ''
    let data = ''
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data = line.slice(5).trim()
    }
    if (event === '') continue
    out.push({ event, data: JSON.parse(data) })
  }
  return out
}

/** 一条最小可用的 chat SSE 流文本。 */
function chatSse(...payloads: string[]): string {
  return payloads.map((payload) => `data: ${payload}\n\n`).join('')
}

/* ------------------------------------------------------------------ 请求方向 */

test('system 的两种形态都落到第一条 system 消息', () => {
  const asText = anthropicToChatRequest(
    { model: 'claude-x', system: 'be brief', messages: [{ role: 'user', content: 'hi' }] },
    { model: 'auto', stream: false },
  )
  assert.deepEqual(asText.messages, [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }])

  const asBlocks = anthropicToChatRequest(
    {
      model: 'claude-x',
      system: [{ type: 'text', text: 'A', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'B' }],
      messages: [{ role: 'user', content: 'hi' }],
    },
    { model: 'auto', stream: false },
  )
  // 块数组按顺序拼接，`cache_control` 不额外产生消息（它只影响上游缓存，不影响文本）。
  assert.equal(asBlocks.messages[0].content, 'AB')
  assert.equal(asBlocks.messages.length, 2)
})

test('assistant 的 tool_use 历史翻成 tool_calls，参数序列化成字符串', () => {
  const request = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'checking' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '22C' }] }],
        },
      ],
    },
    { model: 'auto', stream: false },
  )

  const assistant = request.messages[1]
  assert.equal(assistant.role, 'assistant')
  assert.equal(assistant.content, 'checking')
  assert.deepEqual(assistant.tool_calls, [{
    id: 'toolu_1',
    type: 'function',
    function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
  }])
  // tool 结果必须紧跟在产生它的 assistant 之后，否则上游判「没有对应调用的工具结果」。
  assert.deepEqual(request.messages[2], { role: 'tool', tool_call_id: 'toolu_1', content: '22C' })
})

test('纯工具调用的 assistant 轮 content 是 null 而不是空串', () => {
  const request = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [{
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'f', input: {} }],
      }],
    },
    { model: 'auto', stream: false },
  )
  assert.equal(request.messages[0].content, null)
})

test('图片块的 base64 与 url 两种 source 都能变成 image_url，且该轮保持数组形态', () => {
  const request = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '看这张' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
          { type: 'image', source: { type: 'url', url: 'https://x/y.png' } },
        ],
      }],
    },
    { model: 'auto', stream: false },
  )
  const content = request.messages[0].content
  assert.ok(Array.isArray(content))
  assert.deepEqual(content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } })
  assert.deepEqual(content[2], { type: 'image_url', image_url: { url: 'https://x/y.png' } })
})

test('缺 media_type 的 base64 图片按 png 走，缺 data 的图片整块丢掉而不是发出坏 URL', () => {
  const request = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', data: 'BBBB' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
        ],
      }],
    },
    { model: 'auto', stream: false },
  )
  const content = request.messages[0].content
  assert.equal(content.length, 1)
  assert.equal(content[0].image_url.url, 'data:image/png;base64,BBBB')
})

test('tools 与 tool_choice 的形态一一对应，input_schema 缺失补空对象', () => {
  const request = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        { name: 'a', description: 'desc', input_schema: { type: 'object', properties: {} } },
        { name: 'b' },
        { name: '' },
      ],
      tool_choice: { type: 'tool', name: 'a' },
    },
    { model: 'auto', stream: false },
  )
  assert.equal(request.tools.length, 2, '无名工具不进列表')
  assert.deepEqual(request.tools[0], { type: 'function', function: { name: 'a', parameters: { type: 'object', properties: {} }, description: 'desc' } })
  assert.deepEqual(request.tools[1].function.parameters, { type: 'object', properties: {} })
  assert.deepEqual(request.tool_choice, { type: 'function', function: { name: 'a' } })

  const anyChoice = anthropicToChatRequest(
    { model: 'x', messages: [], tool_choice: { type: 'any' } },
    { model: 'auto', stream: false },
  )
  assert.equal(anyChoice.tool_choice, 'required')
  for (const [type, expected] of [['auto', 'auto'], ['none', 'none']] as const) {
    assert.equal(anthropicToChatRequest({ model: 'x', messages: [], tool_choice: { type } }, { model: 'a', stream: false }).tool_choice, expected)
  }
})

test('采样参数、stop_sequences 与 metadata.user_id 直通到对应字段', () => {
  const request = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [{ role: 'user', content: 'go' }],
      max_tokens: 1024,
      temperature: 0.2,
      top_p: 0.9,
      stop_sequences: ['END'],
      metadata: { user_id: 'u-1' },
    },
    { model: 'auto', stream: false },
  )
  assert.equal(request.max_tokens, 1024)
  assert.equal(request.temperature, 0.2)
  assert.equal(request.top_p, 0.9)
  assert.deepEqual(request.stop, ['END'])
  assert.equal(request.user, 'u-1')
  // 模型名用解析后的网关名，不是客户端发来的 anthropic 名。
  assert.equal(request.model, 'auto')
})

test('流式必须主动要 usage，否则客户端的上下文余量永远算错', () => {
  const streaming = anthropicToChatRequest(
    { model: 'claude-x', messages: [{ role: 'user', content: 'go' }] },
    { model: 'auto', stream: true },
  )
  assert.equal(streaming.stream, true)
  assert.deepEqual(streaming.stream_options, { include_usage: true })

  const plain = anthropicToChatRequest(
    { model: 'claude-x', messages: [{ role: 'user', content: 'go' }] },
    { model: 'auto', stream: false },
  )
  assert.equal(plain.stream_options, undefined, '非流式不该带 stream_options')
})

test('不认识的块（thinking / document）丢掉而不猜成文本', () => {
  const request = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '私密推理' },
          { type: 'document', data: 'x' },
          { type: 'text', text: '答案' },
        ],
      }],
    },
    { model: 'auto', stream: false },
  )
  assert.equal(request.messages[0].content, '答案')
})

/* ------------------------------------------------------------------ 响应方向 */

test('finish_reason 到 stop_reason 的映射覆盖四种真实取值', () => {
  assert.equal(stopReasonOf('stop'), 'end_turn')
  assert.equal(stopReasonOf('length'), 'max_tokens')
  assert.equal(stopReasonOf('tool_calls'), 'tool_use')
  assert.equal(stopReasonOf('content_filter'), 'refusal')
  // 上游没给 finish_reason 时说 end_turn，而不是留 null 让 SDK 解析失败。
  assert.equal(stopReasonOf(undefined), 'end_turn')
})

test('chat 响应体翻成 anthropic message：文本块在前、tool_use 在后', () => {
  const message = chatResponseToAnthropicMessage(
    {
      id: 'chatcmpl-9',
      choices: [{ message: { role: 'assistant', content: '先看', tool_calls: [{ id: 'c1', function: { name: 'f', arguments: '{"a":1}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 11, completion_tokens: 5 },
    },
    { model: 'claude-sonnet-x', fallbackId: 'req-1' },
  )
  assert.equal(message.id, 'chatcmpl-9')
  assert.equal(message.model, 'claude-sonnet-x', '回显客户端点名的模型，否则它认为模型被换了')
  assert.equal(message.stop_reason, 'tool_use')
  assert.deepEqual(message.content, [
    { type: 'text', text: '先看' },
    { type: 'tool_use', id: 'c1', name: 'f', input: { a: 1 } },
  ])
  assert.deepEqual(message.usage, { input_tokens: 11, output_tokens: 5 })
})

test('上游没报 usage 就整格省略，绝不填 0', () => {
  const message = chatResponseToAnthropicMessage(
    { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] },
    { model: 'm', fallbackId: 'r' },
  )
  assert.equal('usage' in message, false)
  assert.equal(message.id, 'msg_r', '上游没给 id 时用调用方的请求 id 兜住')
})

test('坏的参数 JSON 翻成空对象，而不是把字符串塞进 input', () => {
  const message = chatResponseToAnthropicMessage(
    { choices: [{ message: { content: null, tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{oops' } }] }, finish_reason: 'tool_calls' }] },
    { model: 'm' },
  )
  assert.deepEqual(message.content[0].input, {})
  assert.equal(message.content[0].type, 'tool_use')
})

/* ------------------------------------------------------------------ 流方向 */

test('一条流恰好一套骨架，块 start/stop 配对且索引单调递增', () => {
  const translator = createAnthropicStreamTranslator({ model: 'm', fallbackId: 'r' })
  const text = translator.push(chatSse(
    '{"choices":[{"delta":{"content":"你"}}]}',
    '{"choices":[{"delta":{"content":"好"}}]}',
    '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
    '[DONE]',
  )) + translator.end()

  const list = eventsOf(text)
  const names = list.map((e) => e.event)
  assert.deepEqual(names, [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ])
  assert.equal(list[0].data.message.model, 'm')
  assert.deepEqual(list.slice(1, 5).map((e) => e.data.index), [0, 0, 0, 0])
  assert.equal(list.filter((e) => e.event === 'message_stop').length, 1)
  assert.equal(list[list.length - 2].data.delta.stop_reason, 'end_turn')
})

test('文本之后转工具调用要关旧块再开新块，并行工具各占一个索引', () => {
  const translator = createAnthropicStreamTranslator({ model: 'm', fallbackId: 'r' })
  const text = translator.push(chatSse(
    '{"choices":[{"delta":{"content":"先说一句"}}]}',
    '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"f1","arguments":"{\\"x\\":1}"}}]}}]}',
    '{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"f2","arguments":"{}"}}]}}]}',
    '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  )) + translator.end()

  const list = eventsOf(text)
  const starts = list.filter((e) => e.event === 'content_block_start')
  const stops = list.filter((e) => e.event === 'content_block_stop')
  assert.deepEqual(starts.map((e) => e.data.index), [0, 1, 2])
  assert.equal(starts[1].data.content_block.type, 'tool_use')
  assert.equal(starts[1].data.content_block.id, 'a')
  assert.equal(starts[2].data.content_block.name, 'f2')
  // 每个开块都配一个关块，索引一致。
  assert.deepEqual(stops.map((e) => e.data.index), [0, 1, 2])
  assert.equal(list[list.length - 2].data.delta.stop_reason, 'tool_use')
})

test('工具参数逐片段转发，绝不拼完再一次性发', () => {
  const translator = createAnthropicStreamTranslator({ model: 'm', fallbackId: 'r' })
  translator.push(chatSse('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"f","arguments":"{\\"a\\""}}]}}]}'))
  const second = translator.push(chatSse('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]}}]}'))

  const deltas = eventsOf(second)
  assert.equal(deltas.length, 1)
  assert.equal(deltas[0].event, 'content_block_delta')
  assert.deepEqual(deltas[0].data.delta, { type: 'input_json_delta', partial_json: ':1}' })
})

test('帧被 TCP 分片截断时不丢内容也不重复发', () => {
  const translator = createAnthropicStreamTranslator({ model: 'm', fallbackId: 'r' })
  const full = chatSse('{"choices":[{"delta":{"content":"分段也要完整"}}]}')
  const half = Math.floor(full.length / 2)
  const out = translator.push(full.slice(0, half)) + translator.push(full.slice(half))

  const list = eventsOf(out)
  const joined = list.filter((e) => e.event === 'content_block_delta')
    .map((e) => e.data.delta.text)
    .join('')
  assert.equal(joined, '分段也要完整')
  assert.equal(list.filter((e) => e.event === 'message_start').length, 1)
})

test('上游错误帧翻成 error 事件，且之后不再补 message_stop', () => {
  const translator = createAnthropicStreamTranslator({ model: 'm', fallbackId: 'r' })
  const text = translator.push(chatSse('{"error":{"message":"渠道凭据失效"}}')) + translator.end()
  const list = eventsOf(text)
  assert.deepEqual(list.map((e) => e.event), ['error'])
  assert.equal(list[0].data.error.message, '渠道凭据失效')
  // 发过 error 再补 message_stop，客户端会把这次失败读成一次成功的短回答。
  assert.equal(text.includes('message_stop'), false)
})

test('传输层异常只发一条 error，重复调用不再发第二套', () => {
  const translator = createAnthropicStreamTranslator({ model: 'm', fallbackId: 'r' })
  const first = translator.fail('stream idle timeout')
  const second = translator.fail('again')
  assert.deepEqual(eventsOf(first).map((e) => e.event), ['error'])
  assert.equal(second, '')
  assert.equal(translator.push(chatSse('{"choices":[{"delta":{"content":"晚到的正文"}}]}')), '')
})

test('message_start 用估算的 input_tokens，真数到达后在 message_delta 覆盖', () => {
  const translator = createAnthropicStreamTranslator({ model: 'm', fallbackId: 'r', estimatedInputTokens: 777 })
  const head = eventsOf(translator.push(chatSse('{"choices":[{"delta":{"content":"hi"}}]}')))
  assert.deepEqual(head[0].data.message.usage, { input_tokens: 777, output_tokens: 0 })

  const tail = eventsOf(translator.push(chatSse('{"usage":{"prompt_tokens":900,"completion_tokens":12}}')) + translator.end())
  const delta = tail.find((e) => e.event === 'message_delta')
  assert.deepEqual(delta.data.usage, { output_tokens: 12, input_tokens: 900 })
})

test('没要估算值时 message_start 保持 0，不编造输入消耗', () => {
  const translator = createAnthropicStreamTranslator({ model: 'm', fallbackId: 'r' })
  const head = eventsOf(translator.push(chatSse('{"choices":[{"delta":{"content":"hi"}}]}')))
  assert.deepEqual(head[0].data.message.usage, { input_tokens: 0, output_tokens: 0 })
})

test('[DONE] 与无法解析的帧都不产生事件', () => {
  const translator = createAnthropicStreamTranslator({ model: 'm', fallbackId: 'r' })
  assert.equal(translator.push(chatSse('[DONE]', '{not json')), '')
})

/* ------------------------------------------------------------------ 清单与错误 */

test('网关模型清单按 anthropic 形状导出，空清单也用 null 游标而不是空串', () => {
  const list = modelsToAnthropicList([
    { id: 'agnes/agnes-3.0-flash', created: 1700000000 },
    { id: 'auto' },
  ])
  assert.equal(list.data[0].type, 'model')
  assert.equal(list.data[0].id, 'agnes/agnes-3.0-flash')
  assert.equal(list.data[0].display_name, 'agnes/agnes-3.0-flash')
  assert.equal(list.data[0].created_at, new Date(1700000000 * 1000).toISOString())
  assert.equal(list.has_more, false)
  assert.equal(list.first_id, 'agnes/agnes-3.0-flash')

  const empty = modelsToAnthropicList([])
  assert.deepEqual(empty.data, [])
  assert.equal(empty.first_id, null)
  assert.equal(empty.last_id, null)
})

test('错误信封用 anthropic 认识的 type，状态码决定它', () => {
  assert.deepEqual(anthropicErrorBody('密钥不对', 'authentication_error'), {
    type: 'error',
    error: { type: 'authentication_error', message: '密钥不对' },
  })
  assert.equal(anthropicErrorTypeOf(401), 'authentication_error')
  assert.equal(anthropicErrorTypeOf(403), 'authentication_error')
  assert.equal(anthropicErrorTypeOf(400), 'invalid_request_error')
  assert.equal(anthropicErrorTypeOf(429), 'overloaded_error')
  assert.equal(anthropicErrorTypeOf(529), 'overloaded_error')
  assert.equal(anthropicErrorTypeOf(500), 'api_error')
  assert.equal(anthropicErrorTypeOf(502), 'api_error')
})

/* ------------------------------------------------------------------ count_tokens */

test('count_tokens 的粗估把 system、正文与工具 schema 都算进去', () => {
  const small = estimateAnthropicInputTokens({ messages: [{ role: 'user', content: 'abc' }] })
  const withSystem = estimateAnthropicInputTokens({
    system: 'a'.repeat(400),
    messages: [{ role: 'user', content: 'abc' }],
  })
  assert.ok(withSystem > small, 'system 必须计入')

  const withTools = estimateAnthropicInputTokens({
    messages: [],
    tools: [{ name: 'f', description: 'd', input_schema: { type: 'object', properties: { p: { type: 'string' } } } }],
  })
  assert.ok(withTools > small, 'agent 客户端里工具 schema 往往比对话本身还大')

  // 空请求至少报 1，不给客户端「零成本」的假信号。
  assert.equal(estimateAnthropicInputTokens({}), 1)
})
