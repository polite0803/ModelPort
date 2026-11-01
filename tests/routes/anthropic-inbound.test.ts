/**
 * `/v1/messages` 入站协议的路由级验收（真 `ProxyServer` → 真 `routes/messages.ts`
 * → 回环真 `routes/chat.ts` → 真 forwarder/stream → 本机 `node:http` 替身上游）。
 *
 * 这一层证明的是**编解码之外**的东西（`tests/shared/anthropic-wire.test.ts` 证纯
 * 函数那一层，两边不重复）：
 * 1. `X-Request-Id` 不变量在入站这条路上也成立（每个 `/v1/*` 响应都带，且指向
 *    真正产生日志行的那一笔）；
 * 2. 客户端点名的模型在网关里不存在时，兜底落到哪个名字**必须能被看见**
 *    （响应回显客户端的名字是必要的，但只回显就等于骗）；
 * 3. 流式端到端恰好一套块骨架，正文不被帧边界吃掉，上游报到的 usage 真的能
 *    到达客户端（这条同时钉住本批修掉的两个通路缺陷：`stream_options` 与
 *    `StreamHandler.transformChunk` 把 usage 帧丢弃）；
 * 4. `toolCallingConfig` 关掉托管时，客户端的原生 tools 必须真的出站
 *    （此前 `buildRequestBody` 的白名单里根本没有 `tools` 这一格，那个开关
 *    等于「把工具静默丢掉」）；
 * 5. 带 `anthropic-version` 来列模型时返回 anthropic 形状。
 *
 * 不在本层证明：真 Claude Code 客户端、账号渠道（那条路径不经回环，工具与 usage
 * 由渠道包自己处理）。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

const PORT = 18951
const UPSTREAM_PORT = 18952

let seenBodies: Array<Payload> = []
type Payload = Record<string, any>

const upstream = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Payload
    seenBodies.push(body)

    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"id":"chatcmpl-s","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"你好"}}]}\n\n')
      res.write('data: {"id":"chatcmpl-s","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"，世界"}}]}\n\n')
      res.write('data: {"id":"chatcmpl-s","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":900,"completion_tokens":17}}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
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
  id: 'antp',
  name: 'Anthropic Test Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Test-Model'],
  modelMappings: { 'Test-Model': 'antp-upstream' },
} as never)
sm.addAccount({
  id: 'antp-acct',
  providerId: 'antp',
  name: 'antp account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

await listening
const proxy = await startProxy(PORT)
const { resolveAnthropicModel } = await loadModule('main/proxy/routes/messages.ts')

/** anthropic 客户端的最小请求体（`max_tokens` 在它们的 API 里是必填）。 */
const messagesBody = (model: string, extra: Payload = {}): Payload => ({
  model,
  max_tokens: 64,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  ...extra,
})

const MANAGED_TOOL_CALLING_OFF = {
  toolCallingConfig: {
    enabled: false,
    mode: 'auto',
    clientAdapterId: 'standard-openai-tools',
    advanced: {},
  },
}

beforeEach(() => {
  seenBodies = []
})

after(async () => {
  await proxy.stop()
  upstream.close()
  harness.dispose()
})

test('非流式：200 返回 anthropic message，并带上 X-Request-Id', async () => {
  const response = await proxy.request('POST', '/v1/messages', { body: messagesBody('auto') })

  assert.equal(response.status, 200)
  assert.equal(response.json.type, 'message')
  assert.equal(response.json.role, 'assistant')
  assert.equal(response.json.model, 'auto')
  assert.deepEqual(response.json.content, [{ type: 'text', text: 'hello from upstream' }])
  assert.equal(response.json.stop_reason, 'end_turn')
  assert.deepEqual(response.json.usage, { input_tokens: 21, output_tokens: 7 })

  // 不变量：每个 `/v1/*` 响应都有 `X-Request-Id`，且它是网关自己那把 id
  // （回环那笔 chat 才是日志行的归属，上游 body 里的 id 不作数）。
  assert.match(response.headers['x-request-id'] ?? '', /^chatcmpl-[0-9a-z]+-[0-9a-z]+$/)
  assert.deepEqual(seenBodies[0].model, 'antp-upstream')
})

test('客户端点名的模型在网关里不存在时落到 auto，且这件事必须看得见', async () => {
  const response = await proxy.request('POST', '/v1/messages', { body: messagesBody('claude-nope') })

  assert.equal(response.status, 200, '硬报 400 等于这个入口对只会发 claude-* 的客户端永远不可用')
  // 回显客户端的名字（否则它认为模型被换了），但真实名字与来源进响应头。
  assert.equal(response.json.model, 'claude-nope')
  assert.match(response.headers['x-modelport-anthropic-resolved'] ?? '', /auto \(default\)/)
})

test('modelMap 与 defaultModel 是读得到的设置，解析顺序按四类来源', () => {
  // 判据里「名字认不认识」要看**真目录**（供应商列表 + 路由表），所以夹具只能在
  // 真 config 上改 `anthropicInbound`/`routes`，凭空造一个空表会让 `auto` 变成
  // 「不认识的名字」，于是测出来的解析顺序与实际运行时的不是同一条。
  const live = sm.getConfig()
  const noTargets = { ...live, routes: {}, modelMappings: {} } as never

  assert.throws(
    () => resolveAnthropicModel('claude-x', noTargets),
    /cannot be resolved/,
    '四条来源全空才报错，且报的是「怎么修」',
  )

  assert.deepEqual(
    resolveAnthropicModel('Test-Model', noTargets),
    { model: 'Test-Model', source: 'as-requested' },
  )

  assert.deepEqual(
    resolveAnthropicModel('claude-sonnet-4-5', {
      ...live,
      anthropicInbound: { modelMap: { 'claude-': 'Test-Model' } },
    } as never),
    { model: 'Test-Model', source: 'model-map' },
  )

  // 精确键优先于前缀键。
  assert.deepEqual(
    resolveAnthropicModel('claude-f', {
      ...live,
      anthropicInbound: { modelMap: { 'claude-': 'Test-Model', 'claude-f': 'auto' } },
    } as never),
    { model: 'auto', source: 'model-map' },
  )

  assert.deepEqual(
    resolveAnthropicModel('claude-f', {
      ...live,
      routes: {},
      modelMappings: {},
      anthropicInbound: { defaultModel: 'Test-Model' },
    } as never),
    { model: 'Test-Model', source: 'default' },
  )

  // 映射指向一个网关不认识的名字时不算命中 —— 不能把请求交给一个必然失败的目标。
  assert.deepEqual(
    resolveAnthropicModel('claude-f', {
      ...live,
      routes: {},
      modelMappings: {},
      anthropicInbound: { modelMap: { 'claude-': 'ghost-model' }, defaultModel: 'Test-Model' },
    } as never),
    { model: 'Test-Model', source: 'default' },
  )
})

test('modelMap 经设置写入后真的影响路由', async () => {
  sm.updateConfig({ anthropicInbound: { modelMap: { 'claude-': 'Test-Model' } } })

  const response = await proxy.request('POST', '/v1/messages', { body: messagesBody('claude-anything') })

  assert.equal(response.status, 200)
  assert.equal(response.json.model, 'claude-anything')
  assert.equal(seenBodies[0].model, 'antp-upstream', '映射后的名字必须真的走到上游')
  assert.match(response.headers['x-modelport-anthropic-resolved'] ?? '', /Test-Model \(model-map\)/)

  sm.updateConfig({ anthropicInbound: undefined })
})

test('流式：端到端恰好一套块骨架，正文完整，上游 usage 真的到达', async () => {
  const response = await proxy.request('POST', '/v1/messages', {
    body: messagesBody('auto', { stream: true }),
  })

  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'] ?? '', /text\/event-stream/)

  const names = response.text.split('\n\n')
    .filter(frame => frame.startsWith('event:'))
    .map(frame => frame.split('\n')[0].slice(6).trim())

  assert.deepEqual(names, [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ])
  assert.ok(response.text.includes('你好'))
  assert.ok(response.text.includes('，世界'))

  // 上游报了 900/17，所以 `message_delta.usage` 必须带真数覆盖 `message_start` 的估算格。
  assert.ok(response.text.includes('"output_tokens":17'), '流式 usage 不能再被网关自己丢掉')
  assert.ok(response.text.includes('"input_tokens":900'))
  // 估算那一格可辨认（真数到达前客户端看到的就是它）。
  assert.equal(response.headers['x-modelport-usage-estimated'], 'message_start.input_tokens')
  // 回环那笔主动要了 usage —— 没有这一句上游根本不会发那个块。
  assert.deepEqual(seenBodies[0].stream_options, { include_usage: true })
  assert.match(response.headers['x-request-id'] ?? '', /^chatcmpl-/)
})

test('回环的 chat 流式响应自己也带 usage（本批修掉的 transformChunk 丢帧缺陷）', async () => {
  const response = await proxy.request('POST', '/v1/chat/completions', {
    body: { model: 'Test-Model', messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { include_usage: true } },
  })

  assert.equal(response.status, 200)
  assert.ok(response.text.includes('"usage":{"prompt_tokens":900,"completion_tokens":17}'),
    `上游报了数就必须转出去，实际流：\n${response.text}`)
})

test('关掉工具托管时，客户端的原生 tools 必须出站（开关不再是「静默丢掉工具」）', async () => {
  sm.updateConfig(MANAGED_TOOL_CALLING_OFF as never)
  try {
    const tools = [{ type: 'function', function: { name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} } } }]
    const response = await proxy.request('POST', '/v1/chat/completions', {
      body: { model: 'Test-Model', messages: [{ role: 'user', content: 'weather?' }], tools, tool_choice: 'auto' },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(seenBodies[0].tools, tools, '原生 tools 必须原样到达上游')
    assert.equal(seenBodies[0].tool_choice, 'auto')
  } finally {
    sm.updateConfig({ toolCallingConfig: undefined } as never)
  }
})

test('开着工具托管时不把原生 tools 再发一遍（否则工具描述被解释两次）', async () => {
  const tools = [{ type: 'function', function: { name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} } } }]
  await proxy.request('POST', '/v1/chat/completions', {
    body: { model: 'Test-Model', messages: [{ role: 'user', content: 'weather?' }], tools },
  })

  assert.equal(seenBodies[0].tools, undefined, '托管模式下工具走提示注入，不再原生发一遍')
  const injected = JSON.stringify(seenBodies[0].messages)
  assert.match(injected, /get_weather/, '提示里必须带上工具描述')
})

test('带 anthropic-version 列模型返回 anthropic 形状；不带时保持 OpenAI 形状', async () => {
  const anthropic = await proxy.request('GET', '/v1/models', { headers: { 'anthropic-version': '2023-06-01' } })
  assert.equal(anthropic.status, 200)
  assert.equal(anthropic.json.has_more, false)
  assert.equal(anthropic.json.data[0].type, 'model')
  assert.ok(anthropic.json.data[0].display_name)
  assert.match(anthropic.json.data[0].created_at, /T.*Z/)
  assert.equal(anthropic.json.object, undefined, 'anthropic 形状里没有 object: list')

  const openai = await proxy.request('GET', '/v1/models')
  assert.equal(openai.json.object, 'list')
  assert.equal(openai.json.data[0].type, undefined)
})

test('count_tokens 用本机估算答复，且不报 0', async () => {
  const response = await proxy.request('POST', '/v1/messages/count_tokens', {
    body: { model: 'auto', system: 'a'.repeat(400), messages: [{ role: 'user', content: 'hi' }] },
  })
  assert.equal(response.status, 200)
  assert.equal(typeof response.json.input_tokens, 'number')
  assert.ok(response.json.input_tokens > 0)
})
