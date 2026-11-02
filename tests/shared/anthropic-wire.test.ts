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
  estimateAnthropicInputTokensDetailed,
  anthropicNameShape,
  clientNamesForTieredRoutes,
  modelsToAnthropicList,
  routesAbsentFromClaudePicker,
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
  const { request: asText } = anthropicToChatRequest(
    { model: 'claude-x', system: 'be brief', messages: [{ role: 'user', content: 'hi' }] },
    { model: 'auto', stream: false },
  )
  assert.deepEqual(asText.messages, [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }])

  const { request: asBlocks } = anthropicToChatRequest(
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
  const { request } = anthropicToChatRequest(
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
  const { request } = anthropicToChatRequest(
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
  const { request } = anthropicToChatRequest(
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
  const { request } = anthropicToChatRequest(
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
  const { request } = anthropicToChatRequest(
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

  const { request: anyChoice } = anthropicToChatRequest(
    { model: 'x', messages: [], tool_choice: { type: 'any' } },
    { model: 'auto', stream: false },
  )
  assert.equal(anyChoice.tool_choice, 'required')
  for (const [type, expected] of [['auto', 'auto'], ['none', 'none']] as const) {
    const { request } = anthropicToChatRequest({ model: 'x', messages: [], tool_choice: { type } }, { model: 'a', stream: false })
    assert.equal(request.tool_choice, expected)
  }
})

test('采样参数与 stop_sequences 直通到对应字段；metadata 整格报名而不透传', () => {
  const { request, dropped } = anthropicToChatRequest(
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
  // 模型名用解析后的网关名，不是客户端发来的 anthropic 名。
  assert.equal(request.model, 'auto')
  // `metadata.user_id` 是客户端自己的会话身份串（device_id / session_id），对上游没有
  // 用处；透传成 chat 的 `user` 会让 OVH 这类家整笔 400（2026-11-02 实测），所以既不搬、也不静默。
  assert.equal(request.user, undefined, '不得把客户端的会话身份透给上游')
  assert.deepEqual(dropped, ['body:metadata'])
})

test('流式必须主动要 usage，否则客户端的上下文余量永远算错', () => {
  const { request: streaming } = anthropicToChatRequest(
    { model: 'claude-x', messages: [{ role: 'user', content: 'go' }] },
    { model: 'auto', stream: true },
  )
  assert.equal(streaming.stream, true)
  assert.deepEqual(streaming.stream_options, { include_usage: true })

  const { request: plain } = anthropicToChatRequest(
    { model: 'claude-x', messages: [{ role: 'user', content: 'go' }] },
    { model: 'auto', stream: false },
  )
  assert.equal(plain.stream_options, undefined, '非流式不该带 stream_options')
})

test('thinking 映射为 reasoning_content；仍翻不出去的 document 留下清单', () => {
  const { request, dropped } = anthropicToChatRequest(
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
  assert.equal(request.messages[0].reasoning_content, '私密推理')
  // 「丢掉」与「丢掉并且看得见」是两件事：客户端附件没生效时，这条清单是唯一线索。
  assert.deepEqual(dropped, ['document'])
})

test('请求体里没搬运的键逐个报名，搬运了的键一个都不报', () => {
  const { dropped } = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [{ role: 'user', content: 'go' }],
      max_tokens: 64,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      top_k: 40,
      service_tier: 'max',
      mcp_servers: [{ type: 'url', name: 's', url: 'https://x' }],
      container: { type: 'code_execution_20250825' },
      metadata: { user_id: 'u-1' },
    },
    { model: 'auto', stream: false },
  )
  assert.deepEqual(dropped, ['body:thinking', 'body:top_k', 'body:service_tier', 'body:mcp_servers', 'body:container', 'body:metadata'])
})

test('一条全认识的请求 dropped 是空数组（证明上面几条不是恒真）', () => {
  const { dropped } = anthropicToChatRequest(
    {
      model: 'claude-x',
      system: 'be brief',
      messages: [{ role: 'user', content: 'go' }],
      max_tokens: 64,
      temperature: 0.3,
      top_p: 0.9,
      stop_sequences: ['END'],
      stream: true,
      tools: [{ name: 'a', input_schema: { type: 'object' } }],
      tool_choice: { type: 'auto' },
    },
    { model: 'auto', stream: true },
  )
  assert.deepEqual(dropped, [])
})

test('连续 user 轮按 anthropic 语义合并：Claude Desktop 3P 的环境说明在后时，任务不再被吞掉', () => {
  const { request } = anthropicToChatRequest(
    {
      model: 'claude-x',
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '<system-reminder>context</system-reminder>' },
            { type: 'text', text: '分析项目的技术架构' },
          ],
        },
        { role: 'user', content: '# Environment\nYou have been invoked in the following environment: ...' },
      ],
    },
    { model: 'auto', stream: false },
  )
  assert.equal(request.messages.length, 2, 'system + 合并后的一条 user')
  assert.equal(request.messages[1].role, 'user')
  assert.deepEqual(request.messages[1].content, [
    { type: 'text', text: '<system-reminder>context</system-reminder>' },
    { type: 'text', text: '分析项目的技术架构' },
    { type: 'text', text: '# Environment\nYou have been invoked in the following environment: ...' },
  ])
})

test('两段纯文本的连续 user 轮并成一条字符串，不改成数组', () => {
  const { request } = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [
        { role: 'user', content: '第一段' },
        { role: 'user', content: '第二段' },
      ],
    },
    { model: 'auto', stream: false },
  )
  assert.equal(request.messages.length, 1)
  assert.equal(request.messages[0].content, '第一段\n\n第二段')
})

test('被 assistant 轮隔开的 user 轮不合并', () => {
  const { request } = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'next' },
      ],
    },
    { model: 'auto', stream: false },
  )
  assert.deepEqual(request.messages.map((message: any) => message.role), ['user', 'assistant', 'user'])
})

test('tool 结果保持独立，只有其后的连续 user 轮合并', () => {
  const { request } = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'f', input: {} }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't', content: 'r' },
            { type: 'text', text: 'continue' },
          ],
        },
        { role: 'user', content: 'env' },
      ],
    },
    { model: 'auto', stream: false },
  )
  assert.deepEqual(request.messages.map((message: any) => message.role), ['user', 'assistant', 'tool', 'user'])
  assert.equal(request.messages[3].content, 'continue\n\nenv')
})

test('assistant 轮混进的工具结果、以及发不出去的坏图片，都逐条计数', () => {
  const { request, dropped } = anthropicToChatRequest(
    {
      model: 'claude-x',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_result', tool_use_id: 't', content: '不该出现在 assistant 轮' },
          { type: 'tool_use', id: 't', name: 'f', input: {} },
        ],
      }, {
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }],
      }],
    },
    { model: 'auto', stream: false },
  )
  assert.equal(request.messages.length, 1, '坏图片那一轮什么都不发，而不是发一条空消息')
  assert.deepEqual(dropped, ['tool_result', 'image'])
})

test('认不出的 tool_choice 形态报名，而不是静默当成没要求', () => {
  const { request, dropped } = anthropicToChatRequest(
    { model: 'x', messages: [], tool_choice: { type: 'future_forced' } },
    { model: 'auto', stream: false },
  )
  assert.equal(request.tool_choice, undefined)
  assert.deepEqual(dropped, ['body:tool_choice'])
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

test('申报过的 anthropic 面向名排在最前，窗口取目标模型的真值、未知就省略键', () => {
  const list = modelsToAnthropicList(
    [
      { id: 'auto', created: 1700000000 },
      { id: 'zai/glm-5', created: 1700000100, context_window: 200000 },
      { id: 'no-window' },
    ],
    { 'claude-sonnet-4-6': 'zai/glm-5', 'claude-ghost': 'not-a-model' },
  )
  const rows = list.data as any[]

  // 客户端会按自己的 Anthropic 名字表逐行筛（本机装的 Desktop 4.4212 就是这么写的），
  // 所以面向客户端的名字必须出现在清单里，否则整张表会被筛成「0 usable models」。
  assert.equal(rows[0].id, 'claude-sonnet-4-6')
  assert.equal(rows[0].display_name, 'claude-sonnet-4-6')
  assert.equal(rows[0].max_input_tokens, 200000, '窗口取自映射目标，不是客户端名')
  assert.equal(rows[0].created_at, new Date(1700000100 * 1000).toISOString())

  assert.ok(!rows.some((row) => row.id === 'claude-ghost'), '映射目标网关不认识 ⇒ 这一行不发，别让它可选')
  assert.equal(rows[1].id, 'auto')
  assert.equal(rows[1].max_input_tokens, undefined, '未知窗口省略键，不编 0')
  assert.equal(list.first_id, 'claude-sonnet-4-6')
  assert.equal(list.last_id, rows[rows.length - 1].id)

  const dedup = modelsToAnthropicList([{ id: 'Auto' }], { auto: 'Auto' })
  assert.equal(dedup.data.length, 1, '面向名与网关名只差大小写时不发两条同名的')

  // 负控（同一函数、少传一个参数即改动前的行为）：不申报面向名时表里一个 claude 名都没有。
  // 这正是 Desktop 把整张表筛空的场景，不是「改动前后的行数差」那种恒真对照。
  const legacy = modelsToAnthropicList([{ id: 'auto' }, { id: 'zai/glm-5', context_window: 200000 }])
  assert.ok(!legacy.data.some((row: any) => String(row.id).startsWith('claude-')),
    '少传映射参数就不该凭空造出 claude 面向名')
  assert.equal(legacy.data[0].id, 'auto')
})

test('档位是清单行的第二条活路：名字不被客户端认识时靠 tier 保留，非法值不发', () => {
  const list = modelsToAnthropicList(
    [{ id: 'stable', context_window: 200000 }, { id: 'daily' }, { id: 'Off' }],
    { 'claude-sonnet-4-6': 'stable' },
    { stable: 'opus', daily: 'not-a-tier', off: 'haiku' },
  )
  const rows = list.data as any[]
  const byId = new Map(rows.map(row => [row.id as string, row]))

  assert.equal(byId.get('stable').anthropic_family_tier, 'opus', '标了档位就要发出去')
  assert.equal(byId.get('claude-sonnet-4-6').anthropic_family_tier, 'opus', '映射键继承其目标路由的档位')
  assert.equal(byId.get('Off').anthropic_family_tier, 'haiku', '路由名按大小写不敏感匹配')
  assert.ok(!('anthropic_family_tier' in byId.get('daily')), '非法档位宁可不发，也别发一个让客户端整行丢弃的值')

  // 负控：不传第三、四个参数就是改动前的行为，既没有档位也没有自定义显示名。
  const withoutTiers = modelsToAnthropicList([{ id: 'stable' }])
  assert.ok(!(withoutTiers.data as any[]).some(row => 'anthropic_family_tier' in row))
  assert.equal((withoutTiers.data as any[])[0].display_name, 'stable')

  // `display_name` 恒等于 id：这里没有第二份名字可填。客户端筛的是 id、下一轮发回来的也是
  // id，另开一格「只显示别的字」只会让人把名字填进那里而客户端照旧筛掉（实测踩过）。
  for (const row of rows) {
    assert.equal(row.display_name, row.id, `${row.id} 的显示名不许与 id 分家`)
  }
})

test('错误信封用 anthropic 认识的 type，状态码决定它', () => {
  assert.deepEqual(anthropicErrorBody('密钥不对', 'authentication_error'), {
    type: 'error',
    error: { type: 'authentication_error', message: '密钥不对' },
  })
  assert.equal(anthropicErrorTypeOf(401), 'authentication_error')
  // 403 是 permission_error：凭据有效但没权限，客户端不该去换 Key。
  assert.equal(anthropicErrorTypeOf(403), 'permission_error')
  assert.equal(anthropicErrorTypeOf(404), 'not_found_error')
  assert.equal(anthropicErrorTypeOf(400), 'invalid_request_error')
  assert.equal(anthropicErrorTypeOf(429), 'rate_limit_error')
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
/* ------------------------------------------------ 附件（document）与输入估算 */

const PDF_TWO_PAGES = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj << /Type /Page /Parent 2 0 R >> endobj\n' +
  '2 0 obj << /Type /Pages /Kids [1 0 R 3 0 R] /Count 2 >> endobj\n' +
  '3 0 obj << /Type/Page /Contents 4 0 R >> endobj\n',
).toString('base64')

// 页树在压缩的对象流里时数不出 `/Type /Page` —— 那种必须登记为未计入，而不是报 1 页。
const PDF_NO_PAGE_OBJECTS = Buffer.from('%PDF-1.4\n/ObjStm compressed page tree\n').toString('base64')

const documentBody = (blocks: any[]) => ({
  model: 'claude-x',
  messages: [{ role: 'user', content: blocks }],
})

test('document 块默认翻成 file 块真的发出，那一轮保持数组形态', () => {
  const { request, dropped } = anthropicToChatRequest(
    documentBody([
      { type: 'text', text: '读这份' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_TWO_PAGES }, title: 'spec.pdf' },
    ]),
    { model: 'auto', stream: false },
  )

  assert.deepEqual(dropped, [])
  const content = request.messages[0].content
  assert.ok(Array.isArray(content), '带附件的那一轮不能折回纯字符串')
  assert.deepEqual(content[1], {
    type: 'file',
    file: { filename: 'spec.pdf', file_data: `data:application/pdf;base64,${PDF_TWO_PAGES}` },
  })
})

test('开关显式关掉才回到「丢掉但报名」，两种状态在 dropped 上分得开', () => {
  const { request, dropped } = anthropicToChatRequest(
    documentBody([
      { type: 'text', text: '读这份' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_TWO_PAGES } },
    ]),
    { model: 'auto', stream: false, documentsAsFileParts: false },
  )

  assert.deepEqual(dropped, ['document'])
  assert.equal(request.messages[0].content, '读这份', '关掉后那一轮退回纯文本')
})

test('没给标题时后缀由 media_type 反推；text/plain 走同一条路', () => {
  const pdf = anthropicToChatRequest(
    documentBody([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_TWO_PAGES } }]),
    { model: 'auto', stream: false },
  )
  assert.match(pdf.request.messages[0].content[0].file.filename, /^document-\d+\.pdf$/, '上游普遍靠后缀判类型')

  const txt = Buffer.from('hello world').toString('base64')
  const note = anthropicToChatRequest(
    documentBody([{ type: 'document', source: { type: 'base64', media_type: 'text/plain', data: txt } }]),
    { model: 'auto', stream: false },
  )
  assert.equal(note.request.messages[0].content[0].file.file_data, `data:text/plain;base64,${txt}`)
  assert.match(note.request.messages[0].content[0].file.filename, /\.txt$/)
})

test('缺 source 或缺 data 的 document 不许变成空壳块', () => {
  const { request, dropped } = anthropicToChatRequest(
    documentBody([
      { type: 'document' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: '' } },
    ]),
    { model: 'auto', stream: false },
  )

  assert.deepEqual(dropped, ['document', 'document'])
  assert.equal(request.messages.length, 0, '两个都翻不出去时一条消息都不发，而不是发一条空的')
})

test('count_tokens 把数得出页数的 PDF 按每页 1590 计入，数不出的登记为下界', () => {
  const twoPages = estimateAnthropicInputTokensDetailed({
    system: 'x'.repeat(400),
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'abcdefgh' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_TWO_PAGES } },
    ] }],
  })
  assert.deepEqual(twoPages.uncounted, [])
  // 408 字符 /4 = 102，加两页 PDF。字符与整块分开累加，混在一起就会重算或漏算。
  assert.equal(twoPages.tokens, 102 + 2 * 1590)

  const unreadable = estimateAnthropicInputTokensDetailed(
    documentBody([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_NO_PAGE_OBJECTS } }]),
  )
  assert.deepEqual(unreadable.uncounted, ['document'], '数不出页数就不拍一个数充数')

  const withImage = estimateAnthropicInputTokensDetailed(
    documentBody([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]),
  )
  assert.deepEqual(withImage.uncounted, ['image'], '读不到宽高就不按 (w×h)/750 拍数')
})

/* ------------------------------------------- 客户端选择器那道独立的名称关 */

test('名字形态判据按 Claude Desktop 4.4212 那份实现的四条规则走', () => {
  // 子串命中 claude / anthropic / 档位词都算 Anthropic 名（它的 `Cwe`）。
  assert.equal(anthropicNameShape('claude-daily'), 'selectable')
  assert.equal(anthropicNameShape('anthropic-pool'), 'selectable')
  assert.equal(anthropicNameShape('Claude-Daily'), 'selectable', '判据不看大小写')
  // 整名恰好是档位词、后面最多跟版本号也算（它的 `xwe`）。
  assert.equal(anthropicNameShape('sonnet'), 'selectable')
  assert.equal(anthropicNameShape('haiku-4.5'), 'selectable')
  assert.equal(anthropicNameShape('mythos'), 'selectable')

  // 都不命中就是「网关内部名」：发现那一关靠档位能过，选择器这一关过不了。
  assert.equal(anthropicNameShape('daily'), 'missing-anthropic-name')
  assert.equal(anthropicNameShape('auto'), 'missing-anthropic-name')
  assert.equal(anthropicNameShape(''), 'missing-anthropic-name')

  // 别家供应商的词优先级最高，命中即丢 —— 即使同时带着 claude 字样。
  assert.equal(anthropicNameShape('glm-5'), 'other-vendor-name')
  assert.equal(anthropicNameShape('codex'), 'other-vendor-name', '播种的 codex 路由名也在这一档')
  assert.equal(anthropicNameShape('qwen-claude'), 'other-vendor-name', '别家词要在 claude 之前判掉')
})

test('档位只救「发现」，救不了「选择器」：三条内部名路由两处读数是分开的', () => {
  const routeNames = ['auto', 'daily', 'stable', 'performance']
  const tiers = { daily: 'sonnet', stable: 'opus', performance: 'fable' }

  // 发现那一关：三行都发得出去（带合法档位）。
  const list = modelsToAnthropicList(
    routeNames.map((id) => ({ id })),
    undefined,
    tiers,
  )
  assert.deepEqual((list.data as Array<{ id: string }>).map((row) => row.id), routeNames)

  // 选择器那一关：除 `auto`（没标档位、本来就不参与）外全部点不到。
  assert.deepEqual(
    routesAbsentFromClaudePicker({ routeNames, routeTiers: tiers }).map((gap) => gap.route),
    ['daily', 'stable', 'performance'],
  )

  // 一个 claude 开头的映射键指向某条路由，就把那一条从缺口里摘掉（那一行用键当 id）。
  assert.deepEqual(
    routesAbsentFromClaudePicker({
      routeNames,
      routeTiers: tiers,
      modelMap: { 'claude-sonnet-4-6': 'Daily ' },
    }).map((gap) => gap.route),
    ['stable', 'performance'],
    '映射键两侧的空格与大小写都要归一，否则用户填对了却仍被报成缺口',
  )

  // 负控（少传档位这一参数就是「没标档位」）：一条都不报，缺口判据不是恒真。
  assert.deepEqual(routesAbsentFromClaudePicker({ routeNames, routeTiers: {} }), [])

  // 「不广告」哨兵值与非法档位都不该进这一节：它们过不了发现那一关，另有文案管着。
  assert.deepEqual(
    routesAbsentFromClaudePicker({
      routeNames: ['daily', 'glm-5'],
      routeTiers: { daily: '__none__', 'glm-5': 'turbo' },
    }),
    [],
  )
  // 撞了别家供应商词的那条要点名「是这一档」，不能统一说成「少了 claude」。
  assert.deepEqual(
    routesAbsentFromClaudePicker({ routeNames: ['glm-5'], routeTiers: { 'glm-5': 'sonnet' } }),
    [{ route: 'glm-5', shape: 'other-vendor-name' }],
  )
})

test('按档位补客户端名：一条一个名字、同档加序号、不带版本号', () => {
  const routeNames = ['auto', 'daily', 'stable', 'performance']
  const tiers = { daily: 'sonnet', stable: 'opus', performance: 'fable' }

  assert.deepEqual(clientNamesForTieredRoutes({ routeNames, routeTiers: tiers }), {
    add: [
      { from: 'claude-sonnet', to: 'daily' },
      { from: 'claude-opus', to: 'stable' },
      { from: 'claude-fable', to: 'performance' },
    ],
    blocked: [],
  })

  // 同档两条：第二条排到 -2，而不是把第一条的映射顶掉。
  assert.deepEqual(
    clientNamesForTieredRoutes({
      routeNames: ['daily', 'weekly'],
      routeTiers: { daily: 'sonnet', weekly: 'sonnet' },
    }).add,
    [{ from: 'claude-sonnet', to: 'daily' }, { from: 'claude-sonnet-2', to: 'weekly' }],
  )

  // 键已被占用（哪怕指向别的路由）就换下一格；名字与路由名撞车也算占用。
  assert.deepEqual(
    clientNamesForTieredRoutes({
      routeNames: ['daily', 'claude-sonnet'],
      routeTiers: { daily: 'sonnet' },
      modelMap: { 'claude-sonnet': 'other-route' },
    }).add,
    [{ from: 'claude-sonnet-2', to: 'daily' }],
  )

  // 已经能选中的（自己名字像 Anthropic，或已有 claude 键指向它）不补第二条。
  assert.deepEqual(
    clientNamesForTieredRoutes({
      routeNames: ['claude-daily', 'stable'],
      routeTiers: { 'claude-daily': 'sonnet', stable: 'opus' },
      modelMap: { 'claude-opus-4-1': 'stable' },
    }),
    { add: [], blocked: [] },
  )

  // 十个槽位全被占时不猜：报成 blocked，让用户自己改名。
  const takenKeys = Object.fromEntries(
    ['claude-sonnet', 'claude-sonnet-2', 'claude-sonnet-3', 'claude-sonnet-4', 'claude-sonnet-5',
      'claude-sonnet-6', 'claude-sonnet-7', 'claude-sonnet-8', 'claude-sonnet-9', 'claude-sonnet-10']
      .map((key) => [key, 'someone-else']),
  )
  assert.deepEqual(
    clientNamesForTieredRoutes({ routeNames: ['daily'], routeTiers: { daily: 'sonnet' }, modelMap: takenKeys }),
    { add: [], blocked: ['daily'] },
  )
})

/* ---------------- 2026-11-02：工具结果附件、is_error、thinking 与 cache usage ---------------- */

test('tool_result 的图片与 is_error 不再静默丢失', () => {
  const { request, dropped } = anthropicToChatRequest({
    messages: [{
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        is_error: true,
        content: [
          { type: 'text', text: 'command failed' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        ],
      }],
    }],
  }, { model: 'auto', stream: false })

  const tool = request.messages.find((message: any) => message.role === 'tool')
  assert.equal(tool?.content, '[tool_error] command failed')
  // 图片放进随后的 user 消息，而不是被 textOfContent 吃掉。
  const user = request.messages.find(
    (message: any) => message.role === 'user' && Array.isArray(message.content),
  )
  assert.ok(user?.content.some((part: any) => part.type === 'image_url'))
  assert.equal(dropped.includes('tool_result:image'), false)
})

test('assistant 历史的 thinking 映射为 reasoning_content', () => {
  const { request } = anthropicToChatRequest({
    messages: [{
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'let me plan' },
        { type: 'text', text: 'here is the answer' },
      ],
    }],
  }, { model: 'auto', stream: false })

  const assistant = request.messages.find((message: any) => message.role === 'assistant')
  assert.equal(assistant?.content, 'here is the answer')
  assert.equal(assistant?.reasoning_content, 'let me plan')
})

test('redacted_thinking 只报缺席，不伪造内容', () => {
  const { dropped } = anthropicToChatRequest({
    messages: [{
      role: 'assistant',
      content: [
        { type: 'redacted_thinking', data: 'encrypted' },
        { type: 'text', text: 'ok' },
      ],
    }],
  }, { model: 'auto', stream: false })
  assert.ok(dropped.includes('redacted_thinking'))
})

test('cache token 从 OpenAI usage 拆回 Anthropic 的 input/cache 字段', () => {
  const message = chatResponseToAnthropicMessage({
    id: 'chatcmpl-1',
    choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 40, cache_creation_tokens: 10 },
    },
  }, { model: 'claude-sonnet' })

  assert.deepEqual(message.usage, {
    input_tokens: 50,
    output_tokens: 10,
    cache_read_input_tokens: 40,
    cache_creation_input_tokens: 10,
  })
})
