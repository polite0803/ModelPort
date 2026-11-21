/**
 * Auto mode 服务端审核（`safeguards`）透传的**端到端**验收。
 *
 * 客户端（Claude Desktop / Claude Code）在网关部署下把审核现场交给上游执行：
 * 请求里带 `safeguards`，上游在 `message_delta.delta.safeguard_results` 里回判决。
 * 网关这条链要证明三件事，缺一条客户端就拿不到判决、静默退回自己的内置
 * classifier（每一次受审动作都多打一笔按 token 计费的请求）：
 *
 * 1. **成对**：`anthropic-beta: dangerous-tool-use-2026-09-03` 与 body 顶层
 *    `safeguards` 必须一起上线，只发一个在原生上游是非法形状；
 * 2. **只在能执行审核的一方**：目录里只有 Anthropic 原生条目真的跑这项审核
 *    （`serverSideSafeguards`）。别的 anthropic-wire 端点（z.ai / minimax）收到
 *    这一格既不认、也不审 —— 把它搬过去只是白送会话现场（目录路径、用户名、
 *    git 状态）；
 * 3. **回程还原**：判决从 chat chunk 顶层（网关内部位置）回到
 *    `message_delta.delta`，且 `tool_use` 块的 id 一个字节都不改 —— 客户端按 id
 *    对齐判决，改了就等于判决作废。
 *
 * 证明的层次：真 `ProxyServer` → 真 `routes/messages.ts` → 回环真
 * `routes/chat.ts` → 真 forwarder → 真 `AnthropicAdapter` → 本机 `node:http`
 * 替身上游。纯函数那一层在 `tests/shared/anthropic-safeguards.test.ts`，不重复。
 *
 * 不在本层证明：真 Claude Desktop 客户端按判决执行的完整回路（本机安装只读了
 * 它的解析代码）；接上真的 Anthropic 账号（本仓库没有，也不该有）。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, startProxy } from './harness.mjs'

// 18974/18975 未被同批其它路由用例占用（node --test 并行时端口互撞过一次）。
const PORT = 18974

const SAFEGUARDS = {
  rules: ['never delete files outside the workspace'],
  workspace: { folders: ['/home/polit/projects/ModelPort'], user: 'polit' },
  git: { branch: 'main', dirty: true },
}

const VERDICT = [{
  type: 'dangerous_tool_use',
  status: { type: 'available', tool_uses: { toolu_01: 'allowed' } },
}]

type Seen = { headers: Record<string, any>; body: any }
let seen: Seen[] = []
/** 上游是否在 `message_delta` 里回判决（非 capable 的用例拿它证明「给了也不透」）。 */
let upstreamReturnsVerdict = true

const upstream = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf-8')
    const body = raw.trim() === '' ? {} : JSON.parse(raw)
    seen.push({ headers: req.headers, body })

    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const send = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      send('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [],
          usage: { input_tokens: 12, output_tokens: 0 },
        },
      })
      send('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_01', name: 'write_file', input: {} },
      })
      send('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"path":"a.txt"}' },
      })
      send('content_block_stop', { type: 'content_block_stop', index: 0 })
      send('message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason: 'tool_use',
          stop_sequence: null,
          ...(upstreamReturnsVerdict ? { safeguard_results: VERDICT } : {}),
        },
        usage: { output_tokens: 9 },
      })
      send('message_stop', { type: 'message_stop' })
      res.end()
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 3 },
      ...(upstreamReturnsVerdict ? { safeguard_results: VERDICT } : {}),
    }))
  })
})

const upstreamPort = await new Promise<number>(resolve => {
  upstream.listen(0, '127.0.0.1', () => {
    const address = upstream.address()
    resolve(typeof address === 'object' && address !== null ? address.port : 0)
  })
})

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

/**
 * 两个 `anthropic-messages` 聚合条目，只差「能不能执行审核」这一格：
 * - `anthropic`：目录里唯一声明了 `serverSideSafeguards` 的条目 —— 原生上游；
 * - `glm`：同样的 wire、同样的形状，但不跑这项审核 —— 第三方。
 */
function addAnthropicWireProvider(id: string, displayName: string): void {
  const aggregateId = id
  sm.addProvider({
    id,
    name: displayName,
    type: 'aggregate',
    authType: 'token',
    apiEndpoint: `http://127.0.0.1:${upstreamPort}/v1`,
    chatPath: '/messages',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [`${id}/test-model`],
    aggregateId,
    wire: 'anthropic-messages',
  } as never)
  sm.addAccount({
    id: `${id}-acct`,
    providerId: id,
    name: `${displayName} key`,
    credentials: { apiKey: `sk-${id}-test` },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  } as never)
}

addAnthropicWireProvider('anthropic', 'Anthropic')
addAnthropicWireProvider('glm', 'Z.ai (Anthropic wire)')

const proxy = await startProxy(PORT)

beforeEach(() => {
  seen = []
  upstreamReturnsVerdict = true
})

after(async () => {
  await proxy.stop()
  upstream.close()
  harness.dispose()
})

const body = (model: string, extra: Record<string, unknown> = {}) => ({
  model,
  max_tokens: 64,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'write a file' }] }],
  ...extra,
})

/** 从一段 anthropic SSE 文本里按事件名取所有 data 载荷。 */
function eventsOf(text: string): Array<{ event: string; data: any }> {
  const out: Array<{ event: string; data: any }> = []
  for (const frame of text.split('\n\n')) {
    if (frame.trim() === '') continue
    let event = ''
    const payloads: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) payloads.push(line.slice(5).trim())
    }
    if (payloads.length === 0) continue
    out.push({ event, data: JSON.parse(payloads.join('\n')) })
  }
  return out
}

test('能执行审核的上游：beta 头与 body 字段成对上线，判决回到 message_delta.delta', async () => {
  const response = await proxy.request('POST', '/v1/messages', {
    body: body('anthropic/test-model', { safeguards: SAFEGUARDS, stream: true }),
  })
  assert.equal(response.status, 200, response.text)

  // 出站：两样东西一起到，一样都不能少。
  const sent = seen[0]!
  assert.deepEqual(sent.body.safeguards, SAFEGUARDS, 'safeguards 原样透传，内部结构一个键都不解释')
  assert.match(String(sent.headers['anthropic-beta']), /dangerous-tool-use-2026-09-03/)
  assert.equal(sent.headers['x-api-key'], 'sk-anthropic-test', '原有鉴权头不能被 beta 头挤掉')

  // 回程：判决在 message_delta.delta 里，与 stop_reason 同层。
  const events = eventsOf(response.text)
  const messageDelta = events.filter(event => event.event === 'message_delta')
  assert.equal(messageDelta.length, 1)
  assert.deepEqual(messageDelta[0]!.data.delta.safeguard_results, VERDICT)
  assert.equal(messageDelta[0]!.data.delta.stop_reason, 'tool_use')

  // 工具块 id 原样：客户端按 id 对齐判决，改了判决就作废。
  const toolStart = events.find(event => event.event === 'content_block_start')
  assert.equal(toolStart!.data.content_block.id, 'toolu_01')
  assert.equal(toolStart!.data.content_block.name, 'write_file')
})

test('能执行审核的上游、非流式：判决在 message 顶层', async () => {
  const response = await proxy.request('POST', '/v1/messages', {
    body: body('anthropic/test-model', { safeguards: SAFEGUARDS }),
  })
  assert.equal(response.status, 200, response.text)
  assert.deepEqual(response.json.safeguard_results, VERDICT)
  assert.deepEqual(response.json.content, [{ type: 'text', text: 'done' }])
})

test('第三方 anthropic-wire 端点：两个都不发，回程判决也不透', async () => {
  const response = await proxy.request('POST', '/v1/messages', {
    body: body('glm/test-model', { safeguards: SAFEGUARDS, stream: true }),
  })
  assert.equal(response.status, 200, response.text)

  // 会话现场（目录、用户名、git 状态）一个字节都不许送到不审它的地方。
  const sent = seen[0]!
  assert.equal('safeguards' in sent.body, false, '不能执行审核的上游不该收到审核现场')
  assert.equal(sent.headers['anthropic-beta'], undefined, '不成对就不发头')

  // 上游即便回了判决（它不会真的回），也不该被当成有效判决交给客户端。
  const events = eventsOf(response.text)
  const delta = events.find(event => event.event === 'message_delta')!
  assert.equal('safeguard_results' in delta.data.delta, false)
})

test('客户端没带 safeguards：capable 上游也不会收到 beta 头（不许半对）', async () => {
  const response = await proxy.request('POST', '/v1/messages', {
    body: body('anthropic/test-model', { stream: true }),
  })
  assert.equal(response.status, 200, response.text)
  const sent = seen[0]!
  assert.equal('safeguards' in sent.body, false)
  assert.equal(sent.headers['anthropic-beta'], undefined, '头与字段成对，只有字段在场才发头')
  // 回程用**同一个**判据（这一发到底有没有请求审核），而不是「上游这条链能不能审」。
  // 没有请求审核的一发里出现判决只可能是上游串话或网关自己错配 —— 把它当有效判决
  // 交给客户端，等于让一次未经请求的审核结果去放行（或拦下）动作。
  const delta = eventsOf(response.text).find(event => event.event === 'message_delta')!
  assert.equal('safeguard_results' in delta.data.delta, false)
})

test('上游没给判决：message_delta 里不出现这一格，也不写 null', async () => {
  upstreamReturnsVerdict = false
  const response = await proxy.request('POST', '/v1/messages', {
    body: body('anthropic/test-model', { safeguards: SAFEGUARDS, stream: true }),
  })
  assert.equal(response.status, 200, response.text)
  // 上游确实收到了（成对那一步没坏），只是它自己没给判决。
  assert.deepEqual(seen[0]!.body.safeguards, SAFEGUARDS)
  const delta = eventsOf(response.text).find(event => event.event === 'message_delta')!
  // 客户端判据是 `"safeguard_results" in delta`：写 null 会被读成「给了个空判决」。
  assert.equal('safeguard_results' in delta.data.delta, false)
})