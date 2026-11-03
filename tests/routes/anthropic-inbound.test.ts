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
 * 4. 客户端的原生 tools 必须真的出站（此前 `buildRequestBody` 的白名单里根本没有
 *    `tools` 这一格；工具现在也只有原生这一条通路 —— 托管提示词层已退役）；
 * 5. 带 `anthropic-version` 来列模型时返回 anthropic 形状；不带时保持 OpenAI 形状；
 *    单条检索 `/v1/models/:model` 同一分派（含 `modelMap` 键必须答话、档位沿用列表同一
 *    判据、单查那一行与列表那一行逐字段同源 —— 两处共用一个构造处）；
 * 6. 未翻译的入向块（`document` 附件、`thinking`）在响应头与 warn 日志里各留一条，且
 *    「丢」确实发生在翻译层（上游报文里查不到那个词）；
 * 7. anthropic 形状的清单把申报过的 claude 面向名排在最前、窗口取映射目标的池下界、
 *    映射目标不认识就不广告 —— 客户端逐行筛名的判据取自本机那份 Claude Desktop 4.4212
 *    安装里的 `/v1/models` 解析代码（纯网关内部名会被筛成「0 usable models」），不是照
 *    教程或想象写的；
 * 8. 「生成可发现的 Anthropic 路由」这条链端到端成立：路由名出现在清单里、请求按
 *    `as-requested` 直接命中、上游收到的是 Anthropic 的写法 —— 靠的是路由的
 *    `pinModels` 钉池；同时钉空的路由（现存所有路由）行为逐字不变。
 *
 * 不在本层证明：真 Claude Desktop 客户端的完整会话（本机那份安装只读了它的请求构造与
 * 清单解析代码，端点与鉴权头是实证；多轮工具循环与文件工作流还没实机跑过）、账号渠道
 * （那条路径不经回环，工具与 usage 由渠道包自己处理）。
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

test('defaultModel / modelMap 不落到停用或断引用路由，回落到可路由项', () => {
  const route = (name: string, overrides: Payload = {}) => ({
    name,
    enabled: true,
    strategy: 'round-robin',
    prefer: 'balanced',
    maxAttempts: 2,
    stickyMinutes: 0,
    poolStrategies: [],
    pinModels: [],
    includeModels: [],
    excludeModels: [],
    ...overrides,
  })
  const live = sm.getConfig()
  const routes = {
    off: route('off', { enabled: false }),
    broken: route('broken', { basedOnRoute: 'missing' }),
    on: route('on'),
  }

  // defaultModel 指向停用路由：不能解析成功（否则内层 chat 立刻 404）。
  assert.deepEqual(
    resolveAnthropicModel('claude-x', {
      ...live,
      routes,
      modelMappings: {},
      anthropicInbound: { defaultModel: 'off' },
    } as never),
    { model: 'on', source: 'fallback' },
  )

  // modelMap 指向断引用路由：跳过它，继续走 defaultModel。
  assert.deepEqual(
    resolveAnthropicModel('claude-x', {
      ...live,
      routes,
      modelMappings: {},
      anthropicInbound: { modelMap: { 'claude-': 'broken' }, defaultModel: 'on' },
    } as never),
    { model: 'on', source: 'default' },
  )

  // fallback 也只从 routable 路由里选：on 之外全不可路由时仍能拿到 on。
  assert.deepEqual(
    resolveAnthropicModel('claude-x', {
      ...live,
      routes,
      modelMappings: {},
      anthropicInbound: {},
    } as never),
    { model: 'on', source: 'fallback' },
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

  // 流生命周期与尝试链必须真的落到请求日志里，而不只是代码里有字段。
  const row = await findLogRow(
    entry => entry.requestId === response.headers['x-request-id'] && entry.streamTrace !== undefined,
  )
  assert.ok(row, '流式请求日志行必须带 streamTrace')
  assert.equal(row.streamTrace.endReason, 'done')
  assert.equal(row.streamTrace.sawDone, true)
  assert.ok((row.streamTrace.bytesOut ?? 0) > 0)
  assert.ok(Array.isArray(row.attempts) && row.attempts.length > 0, '成功请求也要记尝试链')
  assert.equal(row.attempts.at(-1).outcome, 'success')
})

test('回环的 chat 流式响应自己也带 usage（本批修掉的 transformChunk 丢帧缺陷）', async () => {
  const response = await proxy.request('POST', '/v1/chat/completions', {
    body: { model: 'Test-Model', messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { include_usage: true } },
  })

  assert.equal(response.status, 200)
  assert.ok(response.text.includes('"usage":{"prompt_tokens":900,"completion_tokens":17}'),
    `上游报了数就必须转出去，实际流：\n${response.text}`)
})

test('工具只走原生字段：上游收到 tools 与 tool_choice，消息里没有网关写的工具描述', async () => {
  const tools = [{ type: 'function', function: { name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} } } }]
  const response = await proxy.request('POST', '/v1/chat/completions', {
    body: { model: 'Test-Model', messages: [{ role: 'user', content: 'weather?' }], tools, tool_choice: 'auto' },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(seenBodies[0].tools, tools, '原生 tools 必须原样到达上游')
  assert.equal(seenBodies[0].tool_choice, 'auto')
  // 托管层（把工具描述写进 system、再把回复文本解析回 tool_calls）已于 2026-11-03 退役，
  // 原生透传是唯一通路。下面两句是那条裁定的门：工具名不得再出现在消息里，
  // 也不得多出一个网关造的 system 块。
  assert.equal(
    JSON.stringify(seenBodies[0].messages).includes('get_weather'),
    false,
    '消息里出现工具名 = 网关又在替客户端描述工具',
  )
  assert.equal(seenBodies[0].messages.filter((message: Payload) => message.role === 'system').length, 0,
    '这条请求没有 system，出站就不该有')
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

/**
 * 成功那笔的请求日志行是在响应送达之后才落进内存表的（拒绝行才是同步写的），
 * 所以按「发完就读」的顺序查会偶发查不到。这里给它有限的重试次数，判据不变。
 */
const findLogRow = async (predicate: (entry: Payload) => boolean, tries = 40): Promise<Payload | undefined> => {
  for (let attempt = 0; attempt < tries; attempt++) {
    const hit = sm.getRequestLogs().find(predicate)
    if (hit !== undefined) return hit as Payload
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return undefined
}

test('走回环的 anthropic 入口：日志里的 client 归的是客户端，不是网关自己', async () => {
  const response = await proxy.request('POST', '/v1/messages', {
    body: messagesBody('auto'),
    headers: { 'User-Agent': 'claude-cli/1.0.3 (external, cli)' },
  })

  assert.equal(response.status, 200)

  // `claude-cli` 不在识别表里，所以它是 `other` + UA 里的原始产品名。关键是这个名字只
  // 能来自被透进回环的 UA：不透的话这一格是回环那笔自己的 UA（实测 'node'），
  // 「这是谁发来的」这条排障线索在入站协议入口就断了。
  const row = await findLogRow((entry) => entry.client?.label === 'claude-cli')
  assert.ok(row, '日志里找不到归给 claude-cli 的那一行')
  assert.equal(row.client.id, 'other')
  assert.equal(row.client.version, '1.0.3')
})

test('走回环的 anthropic 入口把 chat 算好的诊断头透到外层（与 /v1/responses 同一格）', async () => {
  const buffered = await proxy.request('POST', '/v1/messages', {
    body: messagesBody('auto'),
    headers: { 'User-Agent': 'claude-cli/1.0.3 (external, cli)' },
  })
  assert.equal(buffered.status, 200)
  assert.equal(buffered.headers['x-modelport-route-name'], 'auto')
  assert.equal(buffered.headers['x-modelport-client'], 'other/1.0.3')

  // 流式那一格也要有：诊断头必须在首字节之前写好，发出去就补不上。
  const streamed = await proxy.request('POST', '/v1/messages', { body: messagesBody('auto', { stream: true }) })
  assert.equal(streamed.status, 200)
  assert.equal(streamed.headers['x-modelport-route-name'], 'auto')
  assert.match(streamed.text, /event: message_start/)
})

/* ------------------------------------------------------------------ 可发现名端到端 */

/**
 * 可发现的 Anthropic 路由：列得到 + 发得出 + 上游收到 Anthropic 的写法。
 *
 * 这条判据原本是 todo（清单名字域已收成「只有路由」，而路由钉不住池）。现在路由有了
 * `pinModels`（`shared/types.ts::ModelRoute.pinModels`，折叠在 `autoRouting.ts::applyModelNamePin`），
 * 一条叫 `claude-opus-5` 的路由可以诚实地只服务真正服务它的那几家，于是三件事一起钉：
 * 名字出现在 `/v1/models` 的 anthropic 形状里、请求按 `as-requested` 直接命中（不落兜底）、
 * 上游收到的模型名是 Anthropic 的写法而不是网关展示名。
 */
test('生成的可发现路由：列得到、发得出、上游收到的就是那个 Anthropic id', async () => {
  // 第二家：目录名带条目前缀（客户端那一筛过不去），上游 id 才是 Anthropic 的写法。
  sm.addProvider({
    id: 'llm7',
    name: 'LLM7 Test Entry',
    type: 'custom',
    authType: 'token',
    apiEndpoint: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: ['llm7/claude-opus-5'],
    modelMappings: { 'llm7/claude-opus-5': 'claude-opus-5' },
  } as never)
  sm.addAccount({
    id: 'llm7-acct',
    providerId: 'llm7',
    name: 'llm7 account',
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  } as never)

  const { applyAnthropicRoutes } = await loadModule('main/store/anthropicRoutes.ts')
  const applied = applyAnthropicRoutes()
  if (!applied.ok) assert.fail(`建路由不该失败：${applied.error.message}`)
  assert.deepEqual(applied.created.map(route => route.name), ['claude-opus-5'])
  assert.deepEqual(applied.failed, [])

  // 1. 列得到：路由名进 `/v1/models` 的 anthropic 形状（客户端那一筛只认 claude/anthropic 前缀）。
  const list = await proxy.request('GET', '/v1/models', { headers: { 'anthropic-version': '2023-06-01' } })
  const rows = (list.json.data as Array<Record<string, any>>).filter(row => row.id === 'claude-opus-5')
  assert.equal(rows.length, 1, `清单里应当恰好一条：${JSON.stringify(list.json.data)}`)
  // 窗口是**池里已公布窗口的下界**，不是上游声明的上限：这两家都没公布窗口，
  // 所以没有可承诺的数，键整个省略（原先这里报的是兜底常量 64000，客户端会拿它
  // 当真实窗口安排压缩时机）。纯函数层那条判据在
  // `tests/proxy/models-context-window.test.ts`。
  assert.equal('max_input_tokens' in rows[0], false,
    `未公布的窗口不该变成一个承诺值：${JSON.stringify(rows[0])}`)

  // 2. 发得出：客户端原样发回这个名字，它被**直接解析**成这条路由。
  const response = await proxy.request('POST', '/v1/messages', { body: messagesBody('claude-opus-5') })
  assert.equal(response.status, 200)
  assert.equal(response.headers['x-modelport-anthropic-resolved'], undefined,
    '这个名字应当被 as-requested 直接命中，而不是靠兜底')

  // 3. 上游收到的是 Anthropic 的写法（池被 pinModels 收在这家，展示名再由目录映射换成上游 id）。
  assert.equal(seenBodies[0].model, 'claude-opus-5')
  assert.equal(response.json.model, 'claude-opus-5')
})

test('未钉定的路由照旧是全目录池：pinModels 为空时行为逐字不变', async () => {
  // 这条是回归护栏：新字段对现存路由必须是 no-op，否则「不钉 = 全目录」的原义会被改坏。
  const routes = sm.getConfig().routes ?? {}
  const auto = routes.auto
  assert.ok(auto !== undefined, '默认迁移应给出 auto 路由')
  assert.deepEqual(auto.pinModels, [], '读侧同形')

  const response = await proxy.request('POST', '/v1/messages', { body: messagesBody('auto') })
  assert.equal(response.status, 200)
  assert.ok(['antp-upstream', 'claude-opus-5'].includes(seenBodies[0].model),
    `auto 仍应从整张目录里挑：${JSON.stringify(seenBodies[0])}`)
})

test('count_tokens 用本机估算答复，不报 0，并把数不出价的格子明说', async () => {
  const response = await proxy.request('POST', '/v1/messages/count_tokens', {
    body: { model: 'auto', system: 'a'.repeat(400), messages: [{ role: 'user', content: 'hi' }] },
  })
  assert.equal(response.status, 200)
  assert.equal(typeof response.json.input_tokens, 'number')
  assert.ok(response.json.input_tokens > 0)
  assert.equal(response.json.uncounted_blocks, undefined, '全都计得进去时不发这一格')

  // 图片按 (w×h)/750 定价，base64 里读不到宽高 ⇒ 不计入。不声明的话客户端会把这个
  // 下界当准数安排字节，到上游才被硬拒 —— 那是最贵的一种沉默。
  const withImage = await proxy.request('POST', '/v1/messages/count_tokens', {
    body: {
      model: 'auto',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ] }],
    },
  })
  assert.equal(withImage.status, 200)
  assert.deepEqual(withImage.json.uncounted_blocks, ['image'])
})

/* --------------------------------------------- 入向缺席的可辨认性（Claude Desktop） */

test('附件默认真的发出去；显式关掉才回到「丢掉但响应头与 warn 日志各留一条」', async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n').toString('base64')
  const attachmentBody = () => ({
    model: 'auto',
    max_tokens: 64,
    thinking: { type: 'enabled', budget_tokens: 1024 },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '读这份 PDF' },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
      ],
    }],
  })

  // 附件在契约层算视觉需求（`file` 在 `autoRouting.ts` 的 `VISION_PART_TYPES` 里），所以
  // 转发之后只有标了 vision 的候选接得住。先给夹具的一家补上标注 —— 不补就会 503，
  // 而那个 503 是「转发而非丢弃」的真实选路后果，不是测试写坏了。
  sm.updateProvider('antp', { modelCapabilities: { 'Test-Model': { vision: 'yes' } } } as never)

  // 默认开：附件进上游报文，缺席清单里不该出现 document（`thinking` 仍然没搬运，照旧要报）。
  const forwarded = await proxy.request('POST', '/v1/messages', { body: attachmentBody() })
  assert.equal(forwarded.status, 200)
  const forwardedHeader = forwarded.headers['x-modelport-anthropic-dropped'] ?? ''
  assert.ok(!forwardedHeader.includes('document'), `附件已转发，缺席清单里不该有它：${forwardedHeader}`)
  assert.match(forwardedHeader, /body:thinking/)
  const withFile = JSON.stringify(seenBodies[0])
  assert.ok(withFile.includes('"type":"file"'), `上游报文里应当带 file 块：${withFile}`)
  assert.match(withFile, /读这份 PDF/, '文本那半照旧要到上游')

  // 显式 `false`：回到旧行为 —— 请求照发，但这一格缺席必须在响应头与日志里看得见。
  sm.updateConfig({ anthropicInbound: { documentPassThrough: false } })
  try {
    const warnBefore = sm.getLogs({ level: 'warn' }).length
    const dropped = await proxy.request('POST', '/v1/messages', { body: attachmentBody() })
    assert.equal(dropped.status, 200, '拒掉整个请求对客户端更糟')
    assert.match(dropped.headers['x-modelport-anthropic-dropped'] ?? '', /document/)
    // `beforeEach` 只在建用例前清一次，本用例内有两次请求 ⇒ 要看**最后一笔**。
    const lastOutbound = JSON.stringify(seenBodies[seenBodies.length - 1])
    assert.ok(!lastOutbound.includes('"type":"file"'), `关掉后不该把 file 块塞给上游：${lastOutbound}`)

    const warns = sm.getLogs({ level: 'warn' })
    assert.ok(warns.length > warnBefore, '缺席必须进日志，不能只活在响应头里')
    assert.match(warns.map((entry) => entry.message).join('\n'), /Anthropic inbound not translated/)
  } finally {
    sm.updateConfig({ anthropicInbound: undefined })
    sm.updateProvider('antp', { modelCapabilities: {} } as never)
  }
})

test('列模型时申报过的 claude 名排在最前、带目标路由的广告下界，且不认识的目标不广告', async () => {
  // R2 之后清单只有路由，所以 `anthropicInbound.modelMap` 的**目标今后必须是路由名**：
  // 指向一个单模型时那一行不再发出（模型名已不在名字域里），Claude 就挑不到它。
  // 窗口走真实管线：这一条证明的是 `context_window` → `max_input_tokens` 的通路，
  // 纯函数层那条测的是映射本身，两边不重复。
  sm.updateProvider('antp', { modelCapabilities: { 'Test-Model': { contextTokens: 128000 } } } as never)
  sm.updateConfig({
    anthropicInbound: { modelMap: { 'claude-sonnet-4-6': 'auto', 'claude-ghost': 'not-here' } },
  })
  try {
    // 对照值现取：同一条路由在 OpenAI 形状里广告的下界，anthropic 那一行必须带同一个数
    const plain = await proxy.request('GET', '/v1/models')
    const autoEntry = (plain.json as { data: Array<Record<string, unknown>> }).data
      .find(row => row.id === 'auto')
    const floor = autoEntry?.context_window

    const response = await proxy.request('GET', '/v1/models', {
      headers: { 'anthropic-version': '2023-06-01' },
    })
    assert.equal(response.status, 200)
    const rows = response.json.data as Array<Record<string, any>>
    const ids = rows.map((row) => row.id)

    assert.equal(ids[0], 'claude-sonnet-4-6', '客户端认识的面向名必须在表最前，否则 Desktop 逐行筛完什么都不剩')
    assert.equal(rows[0].display_name, 'claude-sonnet-4-6')
    if (floor === undefined) {
      assert.equal('max_input_tokens' in rows[0], false, '路由池没窗口时两边一起省略，不兜底成默认值')
    } else {
      assert.equal(rows[0].max_input_tokens, floor, '窗口取映射目标那条路由广告的下界')
    }
    assert.ok(!ids.includes('claude-ghost'), '映射目标网关不认识就不发这一行，别让客户端选中一条必死的')
    assert.ok(!ids.includes('Test-Model'), '单模型不再进清单：这一张表的名字域只有路由')
  } finally {
    sm.updateProvider('antp', { modelCapabilities: {} } as never)
    sm.updateConfig({ anthropicInbound: undefined })
  }
})

test('清单只有「能被发现在、但选不中」的行时，日志把这一格单独报出来', async () => {
  // 客户端那边还有第二道名称关（档位不作数），所以「发了 N 行」与「下拉里有几项」是两个数。
  // 不分开记，用户就只能拿「测连说找到 3 个模型」去对「界面上只有默认模型」，然后靠猜。
  const WARN = 'Anthropic model list: no row can appear in the Claude model picker'
  // 那条计数明细是 debug 级（默认日志级别下不落库），可选中的行数挂在 warn 那一行上：
  // 它才是「用户说下拉空了」时唯一会被留痕的一格。
  const warnRow = () => {
    const rows = sm.getLogs().filter((row) => row.message === WARN)
    return rows[rows.length - 1]
  }
  const warnRows = () => sm.getLogs().filter((row) => row.message === WARN).length

  // 路由表本条自己钉死：播种预设里只要有一条名字像 Anthropic 的路由，「全都选不中」就假了。
  const live = sm.getConfig()
  const auto = Object.values(live.routes ?? {}).find((route) => route.name === 'auto')
  assert.ok(auto, '夹具里该有播种的 auto 路由')

  sm.updateConfig({ routes: { auto } as never, anthropicInbound: { routeTiers: { auto: 'sonnet' } } })
  try {
    const before = warnRows()
    const response = await proxy.request('GET', '/v1/models', {
      headers: { 'anthropic-version': '2023-06-01' },
    })
    const ids = (response.json.data as Array<{ id: string }>).map((row) => row.id)
    assert.deepEqual(ids, ['auto'], '档位让这一行过得了发现那一关')
    assert.equal(warnRows(), before + 1, '一行都选不中时必须新增一条 warn')
    assert.deepEqual(warnRow()?.data?.rows, ['auto'], 'warn 要带上报的到底是哪几个名字')
    assert.equal(warnRow()?.data?.advertisedRows, 1)

    // 负控（同一张路由表、只差一个 claude 开头的映射键）：那一行可选，warn 就不该再加。
    sm.updateConfig({
      routes: { auto } as never,
      anthropicInbound: { routeTiers: { auto: 'sonnet' }, modelMap: { 'claude-sonnet-4-6': 'auto' } },
    })
    const settled = warnRows()
    const mapped = await proxy.request('GET', '/v1/models', {
      headers: { 'anthropic-version': '2023-06-01' },
    })
    assert.deepEqual(
      (mapped.json.data as Array<{ id: string }>).map((row) => row.id),
      ['claude-sonnet-4-6', 'auto'],
    )
    assert.equal(warnRows(), settled, '有一行可选就不许再报「全都选不中」')
  } finally {
    sm.updateConfig({ routes: live.routes as never, anthropicInbound: undefined })
  }
})

/* -------------------------------------------------- 单条检索 /v1/models/:model */

const ANTHROPIC_HEADERS = { 'anthropic-version': '2023-06-01' }

/**
 * 一致性判据：单查那一行必须能在**同一配置**的列表响应里逐字段找到。
 *
 * 这条防的是「两份构造逻辑漂移」——`modelsToAnthropicList` 与 `modelToAnthropicItem`
 * 若各写一份字面量，早晚会一边有 `display_name` 一边没有。先比键集（缺键/多键都是漂移），
 * 再逐字段比；`created_at` 只比到秒级容差：那一格取的是各自请求的 `Date.now()`，
 * 两次 HTTP 之间跨过一次秒边界纯属正常，不是形状问题。
 */
function assertRowMatchesList(listRows: Array<Record<string, any>>, item: Record<string, any>, label: string): void {
  const match = listRows.find((row) => row.id === item.id)
  assert.ok(match, `${label}：列表里没有 id=${String(item.id)} 的那一行`)
  assert.deepEqual(Object.keys(match).sort(), Object.keys(item).sort(),
    `${label}：键集与列表那一行不同\n列表=${JSON.stringify(match)}\n单查=${JSON.stringify(item)}`)
  for (const key of Object.keys(match)) {
    if (key === 'created_at') {
      assert.ok(Math.abs(Date.parse(String(match.created_at)) - Date.parse(String(item.created_at))) <= 1000,
        `${label}：created_at 相差超过一秒 ${match.created_at} vs ${item.created_at}`)
      continue
    }
    assert.deepEqual(match[key], item[key], `${label}：字段 ${key} 与列表那一行不一致`)
  }
}

test('单条检索带 anthropic-version 时回 anthropic 形状；不带时 OpenAI 形状一字不变', async () => {
  // `auto` 的池下界走真实管线：只有 antp 那家标了窗口，llm7 未标注、不参与下界。
  sm.updateProvider('antp', { modelCapabilities: { 'Test-Model': { contextTokens: 128000 } } } as never)
  const created = sm.createRoute({
    name: 'antempty',
    enabled: true,
    strategy: 'round-robin',
    prefer: 'balanced',
    maxAttempts: 2,
    stickyMinutes: 0,
    // 聚合池策略：本夹具里没有聚合供应商 ⇒ 空池 ⇒ 没有可承诺的窗口（与
    // `tests/routes/route-context-floor.test.ts` 的 `emptied` 同一手法）。
    poolStrategies: [{ id: 'aggregate-only', operator: 'and' }],
  })
  assert.equal(created.ok, true, JSON.stringify(created.error))

  try {
    const anthAuto = await proxy.request('GET', '/v1/models/auto', { headers: ANTHROPIC_HEADERS })
    assert.equal(anthAuto.status, 200)
    assert.equal(anthAuto.json.type, 'model')
    assert.equal(anthAuto.json.id, 'auto')
    assert.equal(anthAuto.json.display_name, 'auto', 'display_name 恒等于 id：客户端筛的和发回来的是同一个名字')
    assert.match(anthAuto.json.created_at, /T.*Z/, 'anthropic 这一版是 ISO 字符串，不是秒数')
    assert.equal(anthAuto.json.max_input_tokens, 128000, '有窗口才发：与列表那一行同一个数')
    assert.equal(anthAuto.json.object, undefined, 'anthropic 形状里没有 object/owned_by')
    assert.equal(anthAuto.json.owned_by, undefined)
    assert.equal('anthropic_family_tier' in anthAuto.json, false, '没标档位就省略键')

    // 没窗口的一侧：键整个省略，而不是编一个 0 或兜底常量。
    const anthEmpty = await proxy.request('GET', '/v1/models/antempty', { headers: ANTHROPIC_HEADERS })
    assert.equal(anthEmpty.status, 200)
    assert.equal(anthEmpty.json.type, 'model')
    assert.equal('max_input_tokens' in anthEmpty.json, false,
      `池里没有公布的窗口就不该有这一格：${JSON.stringify(anthEmpty.json)}`)

    // 不带该头：OpenAI 形状一字不变。
    const plain = await proxy.request('GET', '/v1/models/auto')
    assert.equal(plain.status, 200)
    assert.equal(plain.json.object, 'model')
    assert.equal(plain.json.owned_by, 'auto-router')
    assert.equal(plain.json.context_window, 128000)
    assert.equal(plain.json.type, undefined)
    assert.equal('display_name' in plain.json, false)
    assert.equal('created_at' in plain.json, false)

    // 名字域还是只有一个：单模型名与别名带不带这个头都查不到。
    const bareModel = await proxy.request('GET', '/v1/models/Test-Model', { headers: ANTHROPIC_HEADERS })
    assert.equal(bareModel.status, 404)
    assert.equal(bareModel.json.type, 'error')
    assert.equal(bareModel.json.error.type, 'not_found_error', '沿用仓里既有的 anthropic 错误信封')
    assert.equal(bareModel.json.error.message, "Model 'Test-Model' not found")
  } finally {
    sm.updateProvider('antp', { modelCapabilities: {} } as never)
    sm.deleteRoute('antempty')
  }
})

test('列表广告过的 modelMap 键单查必须答话，且与列表那一行逐字段同源', async () => {
  sm.updateProvider('antp', { modelCapabilities: { 'Test-Model': { contextTokens: 128000 } } } as never)
  const off = sm.createRoute({
    name: 'antoff',
    enabled: false,
    strategy: 'round-robin',
    prefer: 'balanced',
    maxAttempts: 2,
    stickyMinutes: 0,
  })
  assert.equal(off.ok, true, JSON.stringify(off.error))

  sm.updateConfig({
    anthropicInbound: {
      modelMap: { 'claude-mapped': 'auto', 'claude-off': 'antoff', 'claude-ghost': 'not-a-route' },
      routeTiers: { auto: 'sonnet' },
    },
  })
  try {
    const list = await proxy.request('GET', '/v1/models', { headers: ANTHROPIC_HEADERS })
    assert.equal(list.status, 200)
    const rows = list.json.data as Array<Record<string, any>>

    // 1. 映射键：客户端下一轮原样发回来的名字，单查不许否认。
    const mapped = await proxy.request('GET', '/v1/models/claude-mapped', { headers: ANTHROPIC_HEADERS })
    assert.equal(mapped.status, 200, `列表广告了这个名字，单查不能 404：${JSON.stringify(mapped.json)}`)
    assert.equal(mapped.json.id, 'claude-mapped')
    assert.equal(mapped.json.max_input_tokens, 128000, '窗口取映射目标那条路由的下界')
    assert.equal(mapped.json.anthropic_family_tier, 'sonnet', '映射键行继承目标路由的档位（与列表同一判据）')
    assertRowMatchesList(rows, mapped.json, '映射键')

    // 2. 路由名同样逐字段一致。
    const byRoute = await proxy.request('GET', '/v1/models/auto', { headers: ANTHROPIC_HEADERS })
    assert.equal(byRoute.status, 200)
    assertRowMatchesList(rows, byRoute.json, '路由名')

    // 3. 映射目标停用 / 不存在 ⇒ 404（发出去就是让客户端选中一条必然失败的模型）。
    const disabledTarget = await proxy.request('GET', '/v1/models/claude-off', { headers: ANTHROPIC_HEADERS })
    assert.equal(disabledTarget.status, 404, '停用的路由不许冒充在服')
    assert.equal(disabledTarget.json.type, 'error')
    assert.equal(disabledTarget.json.error.type, 'not_found_error')
    const ghostTarget = await proxy.request('GET', '/v1/models/claude-ghost', { headers: ANTHROPIC_HEADERS })
    assert.equal(ghostTarget.status, 404)
    const ids = rows.map((row) => row.id)
    assert.ok(!ids.includes('claude-off') && !ids.includes('claude-ghost'),
      `列表也不该广告这两行：${JSON.stringify(ids)}`)

    // 4. 不带该头时映射键**不算**命中：OpenAI 形状的清单里没有这个名字，
    //    单查答话就是比列表多答话（名字域裂成两套）。
    const noHeader = await proxy.request('GET', '/v1/models/claude-mapped')
    assert.equal(noHeader.status, 404)
    assert.equal(noHeader.json.error.code, 'model_not_found')
    assert.equal(noHeader.json.type, undefined, '没有 anthropic-version 就还是 OpenAI 信封')

    // 5. 前缀通配键不在这一格：列表广告的是键的原样形，没广告的名字单查也不答。
    sm.updateConfig({ anthropicInbound: { modelMap: { 'claude-': 'auto' } } })
    const prefixHit = await proxy.request('GET', '/v1/models/claude-anything', { headers: ANTHROPIC_HEADERS })
    assert.equal(prefixHit.status, 404, '请求期允许前缀兜底，广告面不允许 —— 否则清单里没有的名字单查认')
  } finally {
    sm.updateProvider('antp', { modelCapabilities: {} } as never)
    sm.updateConfig({ anthropicInbound: undefined })
    sm.deleteRoute('antoff')
  }
})
