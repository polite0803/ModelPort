/**
 * `/v1/completions` 也必须把 `max_completion_tokens` 折进 `max_tokens`。
 *
 * 两种拼法在网关里是**一个**上限：聊天入口（`routes/chat.ts`）在进门第一件事就折，
 * 下游每一处（转发体白名单、Anthropic wire、responses wire）只读 `max_tokens`。
 * 这条路由原先只声明 `max_tokens`，于是用现名写法的客户端发到 `/v1/completions`
 * 时上限被**静默丢弃** —— 不是报错，而是上游按自己的默认值截断（同 AGENTS 的
 * output-cap 不变量）。
 *
 * 证明层次：真 `ProxyServer` → 真 `routes/completions.ts` → 真转发器 → 本地替身上游
 * 收到的**请求体**。断言读的是上游实际收到的那一格，不是源码文本；最后一条负控
 * 钉住「客户端没给上限就不发明一个」。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, startProxy } from './harness.mjs'

const PORT = 18948
const UPSTREAM_PORT = 18949

type Forwarded = Record<string, unknown>
const forwarded: Forwarded[] = []

const upstream = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    forwarded.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Forwarded)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      created: 1,
      model: 'cap-upstream',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
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
      retryCount: 0,
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

sm.addProvider({
  id: 'cap-provider',
  name: 'Cap Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Test-A'],
  modelMappings: { 'Test-A': 'cap-upstream' },
} as never)
sm.addAccount({
  id: 'cap-acct',
  providerId: 'cap-provider',
  name: 'cap account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

await listening
const proxy = await startProxy(PORT)

beforeEach(() => {
  forwarded.length = 0
})

after(async () => {
  await proxy.stop()
  upstream.close()
  harness.dispose()
})

const postCompletions = (body: Record<string, unknown>) =>
  proxy.request('POST', '/v1/completions', { body })

test('现名写法在 completions 入口同样到达上游：上限不被静默丢弃', async () => {
  const response = await postCompletions({ model: 'Test-A', prompt: 'ping', max_completion_tokens: 77 })

  assert.equal(response.status, 200)
  assert.equal(forwarded.length, 1)
  assert.equal(forwarded[0].max_tokens, 77, '折叠后上游必须读到上限')
  assert.equal(forwarded[0].max_completion_tokens, undefined, '别名不出现在转发体里')
})

test('两把都给时别名优先 —— 与 chat 入口、渠道 worker 同一优先级', async () => {
  const response = await postCompletions({
    model: 'Test-A',
    prompt: 'ping',
    max_tokens: 11,
    max_completion_tokens: 77,
  })

  assert.equal(response.status, 200)
  assert.equal(forwarded[0].max_tokens, 77)
})

test('客户端没给上限就不发明一个：转发体里没有 max_tokens 这一格', async () => {
  const response = await postCompletions({ model: 'Test-A', prompt: 'ping' })

  assert.equal(response.status, 200)
  assert.equal('max_tokens' in forwarded[0], false, '不补默认值，交给上游自己的口径')
})