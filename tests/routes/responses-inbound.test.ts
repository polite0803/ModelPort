/**
 * `/v1/responses` 入站协议的路由级验收（真 `ProxyServer` → 真 `routes/responses.ts`
 * → 回环真 `routes/chat.ts` → 真 forwarder/stream → 本机 `node:http` 替身上游）。
 *
 * 这一层证明编解码之外的那四件事：
 * 1. 回环真的把请求交到了 chat 那条链（上游收到的是投影后的 chat 体，模型名解析、
 *    路由与换家全按既有那条路走）；
 * 2. `X-Request-Id` 不变量与 chat 那侧的诊断头在这个入口也透得出去（不透就等于
 *    「看得见答案、看不见依据」）；
 * 3. 流式端到端恰好一套 responses 骨架，正文不被帧边界吃掉，上游报到的 usage 真的
 *    到达客户端；
 * 4. 本代理做不到的语义（`previous_response_id` 之类）在这里被点名拒绝并且**留痕**，
 *    未知模型名也不被偷偷换成别的模型跑。
 *
 * 纯函数那一层在 `tests/shared/responses-inbound.test.ts`，两边不重复。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, startProxy } from './harness.mjs'

const PORT = 18971
const UPSTREAM_PORT = 18972

type Payload = Record<string, any>

let seenBodies: Payload[] = []
let upstreamMode: 'ok' | 'stream' | 'tool' | 'patch' | 'error' = 'ok'

const upstream = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Payload
    seenBodies.push(body)

    if (upstreamMode === 'error') {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'upstream exploded', type: 'api_error', param: null, code: null } }))
      return
    }

    if (upstreamMode === 'stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"id":"chatcmpl-s","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"你好"}}]}\n\n')
      res.write('data: {"id":"chatcmpl-s","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"，世界"}}]}\n\n')
      res.write('data: {"id":"chatcmpl-s","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":900,"completion_tokens":17}}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    if (upstreamMode === 'tool') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-tool',
        object: 'chat.completion',
        created: 2,
        model: body.model ?? '',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_7', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: null,
      }))
      return
    }

    if (upstreamMode === 'patch') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-patch',
        object: 'chat.completion',
        created: 3,
        model: body.model ?? '',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            // 上游按 chat 的形状回：自由文本工具的原文装在 `input` 这个参数里。
            tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'apply_patch', arguments: JSON.stringify({ input: PATCH_TEXT }) } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: null,
      }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      created: 1,
      model: body.model ?? '',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'hello from upstream' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 },
    }))
  })
})
const listening = new Promise<void>(resolve => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve))

const harness = await bootstrapStore({
  // 这一份要的就是真实播种行为（默认夹具会写记档键跳过它，见 harness.mjs）。
  seedPresetRoutes: true,
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: {
      proxyPort: PORT,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

sm.addProvider({
  id: 'resp',
  name: 'Responses Test Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Test-Model'],
  modelMappings: { 'Test-Model': 'resp-upstream' },
} as never)
sm.addAccount({
  id: 'resp-acct',
  providerId: 'resp',
  name: 'resp account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

await listening
const proxy = await startProxy(PORT)

/** responses 客户端的最小请求体。 */
const responsesBody = (model: string, extra: Payload = {}): Payload => ({
  model,
  input: 'hi',
  ...extra,
})

/** Codex 的 `apply_patch` 是自由文本工具：参数是一段补丁原文，不是 JSON 对象。 */
const PATCH_TEXT = '*** Begin Patch\n*** Update File: markers.ts\n@@\n+export const X = 1\n*** End Patch'

/**
 * 成功那笔的请求日志行是在响应送达之后才落进内存表的（拒绝行才是同步写的），
 * 按「发完就读」的顺序查会偶发查不到。给它有限重试，判据本身不变。
 */
const findLogRow = async (predicate: (entry: Payload) => boolean, tries = 40): Promise<Payload | undefined> => {
  for (let attempt = 0; attempt < tries; attempt++) {
    const hit = sm.getRequestLogs().find(predicate)
    if (hit !== undefined) return hit as Payload
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return undefined
}

beforeEach(() => {
  seenBodies = []
  upstreamMode = 'ok'
})

after(async () => {
  await proxy.stop()
  upstream.close()
  harness.dispose()
})

test('非流式：200 返回 response 对象，回显客户端的模型名，且带 X-Request-Id', async () => {
  const response = await proxy.request('POST', '/v1/responses', { body: responsesBody('auto') })

  assert.equal(response.status, 200)
  assert.equal(response.json.object, 'response')
  assert.equal(response.json.status, 'completed')
  assert.equal(response.json.model, 'auto', '回显客户端点名的名字，不是上游真名')
  assert.deepEqual(response.json.output[0].content, [{ type: 'output_text', text: 'hello from upstream', annotations: [] }])
  assert.deepEqual(response.json.usage, { input_tokens: 21, output_tokens: 7, total_tokens: 28 })

  // 不变量：每个 `/v1/*` 响应都有 `X-Request-Id`，且它是产生日志行那一笔的 id。
  assert.match(response.headers['x-request-id'] ?? '', /^chatcmpl-[0-9a-z]+-[0-9a-z]+$/)
  // 回环那一笔真按投影后的 chat 体出站，模型名走的是既有解析链。
  assert.deepEqual(seenBodies[0].messages, [{ role: 'user', content: 'hi' }])
  assert.equal(seenBodies[0].model, 'resp-upstream')
})

test('chat 那条链算好的诊断头透得出来（路由名不是只能在面板上看）', async () => {
  const response = await proxy.request('POST', '/v1/responses', { body: responsesBody('auto') })

  assert.equal(response.status, 200)
  assert.equal(response.headers['x-modelport-route-name'], 'auto')
})

test('具名模型经回环解析到映射后的上游名', async () => {
  const response = await proxy.request('POST', '/v1/responses', { body: responsesBody('Test-Model') })

  assert.equal(response.status, 200)
  assert.equal(seenBodies[0].model, 'resp-upstream')
  assert.equal(response.json.model, 'Test-Model')
})

test('流式：恰好一套 responses 骨架，正文完整，上游 usage 真的到达', async () => {
  upstreamMode = 'stream'
  const response = await proxy.request('POST', '/v1/responses', { body: responsesBody('auto', { stream: true }) })

  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'] ?? '', /text\/event-stream/)

  const names = response.text.split('\n\n')
    .filter(frame => frame.startsWith('event:'))
    .map(frame => frame.split('\n')[0].slice(6).trim())

  assert.deepEqual(names, [
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
  assert.ok(response.text.includes('你好'))
  assert.ok(response.text.includes('，世界'))
  assert.ok(!response.text.includes('[DONE]'), 'Responses 客户端不认 [DONE]')

  const lastFrame = response.text.split('\n\n').filter(frame => frame.includes('data: ')).at(-1)!
  const completed = JSON.parse(lastFrame.slice(lastFrame.indexOf('data: ') + 6)) as Payload
  assert.deepEqual(completed.response.usage, { input_tokens: 900, output_tokens: 17, total_tokens: 917 })
  // 回环那笔主动要了 usage —— 没有这一句上游根本不会发那个块。
  assert.deepEqual(seenBodies[0].stream_options, { include_usage: true })
  assert.match(response.headers['x-request-id'] ?? '', /^chatcmpl-/)
})

test('客户端的原生 tools 出站（flat 形态嵌回 chat 的 function）', async () => {
  const response = await proxy.request('POST', '/v1/responses', {
    body: responsesBody('Test-Model', {
      input: 'weather?',
      tools: [{ type: 'function', name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} } }],
      tool_choice: 'auto',
    }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(seenBodies[0].tools, [
    { type: 'function', function: { name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} } } },
  ], 'flat 的工具必须嵌回 chat 形状再出站')
  assert.equal(seenBodies[0].tool_choice, 'auto')
})

test('一轮工具往返：上游的 tool_calls 出去是 function_call 项，usage 报 null 而不是 0', async () => {
  upstreamMode = 'tool'
  const response = await proxy.request('POST', '/v1/responses', {
    body: responsesBody('Test-Model', { input: [{ role: 'user', content: [{ type: 'input_text', text: 'weather?' }] }] }),
  })

  assert.equal(response.status, 200)
  assert.equal(response.json.status, 'completed')
  assert.deepEqual(response.json.output, [
    { id: 'fc_7', type: 'function_call', status: 'completed', call_id: 'call_7', name: 'get_weather', arguments: '{"city":"SF"}' },
  ])
  assert.equal(response.json.usage, null, '上游没报 usage 就是 null，补 0 等于申报这次没消耗')
})

test('自由文本工具的一轮写盘：声明带 input 契约、历史里的补丁到得了上游、回来的项是 custom_tool_call', async () => {
  upstreamMode = 'patch'
  const response = await proxy.request('POST', '/v1/responses', {
    body: responsesBody('Test-Model', {
      tools: [{ type: 'custom', name: 'apply_patch', description: 'Apply a patch', format: { type: 'text' } }],
      input: [
        { type: 'custom_tool_call', call_id: 'c9', name: 'apply_patch', input: PATCH_TEXT },
        { type: 'custom_tool_call_output', call_id: 'c9', output: 'Success. updated 1 file' },
        { role: 'user', content: [{ type: 'input_text', text: 'continue' }] },
      ],
    }),
  })

  assert.equal(response.status, 200)
  const sent = seenBodies[0]
  // 1) 出站声明：chat 侧唯一的参数契约位置要给出 input，否则模型只能猜（实测猜出 4 次空 `{}`）。
  const declared = (sent.tools as Payload[]).find(tool => tool.function.name === 'apply_patch') as Payload
  assert.deepEqual(declared.function.parameters.required, ['input'])
  // 2) 历史：补丁原文必须出现在发给上游的消息里。丢了它，模型看不到自己已经写过，
  //    就会一轮一轮重新宣布「我现在直接落盘」——用户读到的正是那种反复。
  const history = JSON.stringify(sent.messages)
  assert.ok(history.includes('Begin Patch'), '补丁原文没进发给上游的历史')
  assert.ok(history.includes('Success. updated 1 file'), '写盘结果没进历史')
  // 3) 回来的调用项：类型必须是客户端声明的那种，否则它根本不执行。
  assert.deepEqual(response.json.output, [
    { id: 'fc_9', type: 'custom_tool_call', status: 'completed', call_id: 'call_9', name: 'apply_patch', input: PATCH_TEXT },
  ])
})

test('客户端把工具结果发回来时，上游看到的仍是相邻的调用与结果', async () => {
  const response = await proxy.request('POST', '/v1/responses', {
    body: responsesBody('Test-Model', {
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'weather?' }] },
        { type: 'function_call', call_id: 'call_7', name: 'get_weather', arguments: '{"city":"SF"}' },
        { type: 'function_call_output', call_id: 'call_7', output: 'sunny' },
      ],
    }),
  })

  assert.equal(response.status, 200)
  const sent = seenBodies[0].messages as Payload[]
  const callIndex = sent.findIndex(m => m.role === 'assistant' && Array.isArray(m.tool_calls))
  assert.ok(callIndex >= 0, 'function_call 必须投影成 assistant 的 tool_calls')
  assert.equal(sent[callIndex].content, null, '只有调用时 content 是 null')
  assert.deepEqual(sent[callIndex].tool_calls, [
    { id: 'call_7', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } },
  ])
  assert.equal(sent[callIndex + 1].role, 'tool', '结果必须紧跟产生它的调用')
  assert.equal(sent[callIndex + 1].tool_call_id, 'call_7')

  // 网关不替用户造句子（2026-11-03 裁定）：末条是工具结果的出站序列原样发出，
  // 既不在调用与结果之间插东西，也不在尾巴上追加合成的 user。
  assert.equal(sent.length, callIndex + 2, '尾巴上不得出现网关造的 user')
  assert.equal(sent[sent.length - 1].role, 'tool')
})

test('prompt_cache_key 一路到上游（入向翻译 → chat → 转发白名单）', async () => {
  const response = await proxy.request('POST', '/v1/responses', {
    body: responsesBody('Test-Model', { prompt_cache_key: 'sess-42' }),
  })

  assert.equal(response.status, 200)
  assert.equal(seenBodies[0].prompt_cache_key, 'sess-42', '转发白名单不转这一格就等于替客户端放弃缓存')
})

test('走回环的入口把调用方归到真实客户端，不是网关自己', async () => {
  const response = await proxy.request('POST', '/v1/responses', {
    body: responsesBody('Test-Model'),
    headers: { 'User-Agent': 'codex_cli_rs/0.49.0 (Windows 11; x86_64; zh-CN)' },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers['x-modelport-client'], 'codex/0.49.0')

  // 日志那一行归的也是客户端：不透 UA 的话，它看到的是回环那笔的 undici，
  // 「这是谁发来的」这条排障线索在入站协议入口就断了。
  const row = await findLogRow((entry) => entry.client?.id === 'codex')
  assert.ok(row, '请求日志里要能看到 codex 这一类')
  assert.equal(row.client.label, 'Codex')
  assert.equal(row.client.version, '0.49.0')
})

test('previous_response_id 点名拒绝，并且这条拒绝进请求日志', async () => {
  const response = await proxy.request('POST', '/v1/responses', {
    body: responsesBody('auto', { previous_response_id: 'resp_123' }),
  })

  assert.equal(response.status, 400)
  assert.equal(response.json.error.code, 'unsupported_parameter')
  assert.equal(response.json.error.param, 'previous_response_id')
  assert.match(response.json.error.message, /does not store responses/)

  const logged = sm.getRequestLogs().filter((entry: Payload) => entry.errorMessage?.startsWith('unsupported_parameter:'))
  assert.equal(logged.length, 1, '到不了供应商的拒绝必须留痕，否则面板读作「无流量」')
  assert.equal(logged[0].statusCode, 400)
  assert.equal(logged[0].model, 'auto')
  assert.equal(logged[0].requestId, response.headers['x-request-id'], '拒绝行必须带响应头那把 id，否则客户端拿着 id 查不到')
})

test('上游报错：错误体里的 request_id 是有日志行的那把，不是认领前的外层 id', async () => {
  upstreamMode = 'error'
  const response = await proxy.request('POST', '/v1/responses', { body: responsesBody('Test-Model') })

  assert.equal(response.status, 502)
  const headerId = response.headers['x-request-id'] ?? ''
  assert.match(headerId, /^chatcmpl-/, '日志行归回环那笔 chat，响应头必须是它的 id')
  const ids = [...response.json.error.message.matchAll(/\[request_id: ([^\]]+)\]/g)].map(m => m[1])
  assert.deepEqual(ids, [headerId], '错误体里的 id 必须唯一且等于响应头那把')
  const row = await findLogRow(entry => entry.requestId === headerId)
  assert.ok(row, '客户端引用的 id 必须在请求日志里查得到')
  assert.equal(row.statusCode, 502)
})

test('回环不可达：本入口自己的 502 也落日志行，行 id 就是响应头那把', async () => {
  const live = sm.getConfig()
  sm.setConfig({ ...live, proxyPort: 18999 })
  try {
    const response = await proxy.request('POST', '/v1/responses', { body: responsesBody('Test-Model') })

    assert.equal(response.status, 502)
    const headerId = response.headers['x-request-id'] ?? ''
    assert.match(headerId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.equal(response.json.error.code, 'internal_relay_failed')
    const row = await findLogRow(entry => entry.requestId === headerId)
    assert.ok(row, '到不了 chat 泳道的拒绝必须自己留痕')
    assert.equal(row.statusCode, 502)
    assert.match(row.errorMessage ?? '', /^internal_relay_failed:/)
  } finally {
    sm.setConfig(live)
  }
})

test('background 与 item_reference 同样拒绝，各点名自己的参数', async () => {
  const background = await proxy.request('POST', '/v1/responses', { body: responsesBody('auto', { background: true }) })
  assert.equal(background.status, 400)
  assert.equal(background.json.error.param, 'background')

  const referenced = await proxy.request('POST', '/v1/responses', {
    body: responsesBody('auto', { input: [{ type: 'item_reference', id: 'item_1' }] }),
  })
  assert.equal(referenced.status, 400)
  assert.equal(referenced.json.error.param, 'input[].item_reference')

  assert.equal(seenBodies.length, 0, '拒绝的请求不该有一个打到上游')
})

test('空 input 报的是客户端自己那个字段名，不是内部的 messages', async () => {
  const response = await proxy.request('POST', '/v1/responses', { body: { model: 'auto', input: [] } })

  assert.equal(response.status, 400)
  assert.equal(response.json.error.param, 'input')
  assert.match(response.json.error.message, /'input'/)
})

test('store:true 不拒绝，但声明这里没有留存', async () => {
  const response = await proxy.request('POST', '/v1/responses', { body: responsesBody('auto', { store: true }) })

  assert.equal(response.status, 200)
  assert.equal(response.headers['x-modelport-responses-store'], 'not-retained')
})

test('网关不认识的模型名不被偷偷换成别的模型跑', async () => {
  const response = await proxy.request('POST', '/v1/responses', { body: responsesBody('gpt-5-codex-not-configured') })

  assert.notEqual(response.status, 200, 'anthropic 入口有兜底是因为 Claude Code 改不了模型名；这里没有这个理由')
  assert.equal(response.json.error.code, 'no_available_account')
  assert.equal(seenBodies.length, 0)
})

test('GET /v1/responses 是 405，不是 404（路由确实挂载了，只是不收 GET）', async () => {
  const response = await proxy.request('GET', '/v1/responses')

  assert.equal(response.status, 405)
  assert.match(response.headers['allow'] ?? '', /POST/)
})

test('GET / 的端点清单里有 /v1/responses', async () => {
  const response = await proxy.request('GET', '/')

  assert.deepEqual(
    (response.json.endpoints as string[]).filter((entry: string) => entry.includes('/v1/responses')),
    ['POST /v1/responses'],
  )
})

test('R2 之后 Codex 在清单里挑得到属于它自己的那条路由，并且点名它就能跑', async () => {
  // 播种出的那条（`store.seedPresetRoutes`）在这里兑现成端到端：客户端从
  // `/v1/models` 里看得见这个名字，点它名字真的按路由走（不是撞进具名模型路径）。
  const list = await proxy.request('GET', '/v1/models')
  const names = (list.json.data as Payload[]).map((entry) => entry.id)
  assert.ok(names.includes('codex'), `清单里没有 codex，实际是：${names.join(', ')}`)

  const run = await proxy.request('POST', '/v1/responses', { body: responsesBody('codex') })
  assert.equal(run.status, 200)
  assert.equal(run.headers['x-modelport-route-name'], 'codex')
})
