/**
 * 末条工具结果兜底的端到端验收：真 `ProxyServer` → 真 `forwardChatCompletion`
 * → 本机 `node:http` 替身上游，看**上游实际收到的 `messages` 尾部**长什么样。
 *
 * 为什么不能只靠纯函数与源码门：这条修复的全部价值在于「出站字节真的变了」。
 * 纯函数过了、挂点顺序对了，但如果在 `buildRequestBody` / 渠道分派之前被别处
 * 覆盖掉，客户端症状照旧。所以两条：
 * - 开（默认）→ 上游收到的末条是我们那句 user；
 * - 关（`trailingUserGuard: false`）→ 末条仍是 `tool`，一字不改（证明可回退且
 *   关闭态零副作用）。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, startProxy } from './harness.mjs'

const PORT = 18961
const UPSTREAM_PORT = 18962

let seenMessages: Array<{ role?: string, content?: unknown }> = []

const upstream = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { messages?: unknown }
    seenMessages = Array.isArray(body.messages) ? body.messages as typeof seenMessages : []
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-guard',
      object: 'chat.completion',
      created: 1,
      model: 'up-guard',
      choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
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
    config: { proxyPort: PORT, proxyHost: '127.0.0.1', loadBalanceStrategy: 'round-robin' },
  },
})
const sm = harness.storeManager

sm.addProvider({
  id: 'guardp',
  name: 'Guard Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Guard-Model'],
  modelMappings: { 'Guard-Model': 'up-guard' },
} as never)
sm.addAccount({
  id: 'guard-acct',
  providerId: 'guardp',
  name: 'guard account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

await listening
const proxy = await startProxy(PORT)

/** agent 第 2 轮的真实形状：任务 → 工具调用 → 工具结果，末条是 tool。 */
const agentTurn2 = [
  { role: 'user', content: '评估仓库完成度，中途不要问我' },
  {
    role: 'assistant',
    content: '先探测。',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'powershell', arguments: '{"command":"ls"}' } }],
  },
  { role: 'tool', tool_call_id: 'c1', content: 'src/ docs/ package.json' },
]

const post = () => proxy.request('POST', '/v1/chat/completions', {
  body: { model: 'Guard-Model', messages: agentTurn2 },
})

beforeEach(() => {
  seenMessages = []
})

after(async () => {
  await proxy.stop()
  upstream.close()
  harness.dispose()
})

test('默认（没配过这一格）出站末条被补成 user', async () => {
  const response = await post()
  assert.equal(response.status, 200)
  assert.equal(seenMessages.length, 4, '上游应多收到一条兜底 user')
  const last = seenMessages[seenMessages.length - 1]
  assert.equal(last.role, 'user')
  assert.match(String(last.content), /继续执行上一条消息中的任务/)
  // 前三条原样不动：兜底只加不减，历史字节不被改写（否则上游前缀缓存会打掉）。
  assert.deepEqual(seenMessages.slice(0, 3).map(m => m.role), ['user', 'assistant', 'tool'])
})

test('兜底句不进请求日志的 userInput（它不是用户本轮说的话）', async () => {
  const response = await post()
  assert.equal(response.status, 200)
  // 出站末条确实变了，否则这条断言是恒真的。
  assert.equal(seenMessages[seenMessages.length - 1].role, 'user')

  const row = sm.getRequestLogs(1)[0]
  assert.ok(row, '请求日志默认开启，这一笔必须落一行')
  assert.equal(row.userInput, '评估仓库完成度，中途不要问我')
  assert.equal(String(row.userInput).includes('继续执行上一条消息中的任务'), false)
})

test('关掉开关后出站一字不改，末条仍是 tool', async () => {
  sm.updateConfig({ trailingUserGuard: false } as never)
  try {
    const response = await post()
    assert.equal(response.status, 200)
    assert.equal(seenMessages.length, 3, '关闭态不得有副作用')
    assert.equal(seenMessages[seenMessages.length - 1].role, 'tool')
  } finally {
    sm.updateConfig({ trailingUserGuard: undefined } as never)
  }
})

test('末条不是 tool 的第 1 轮请求完全不变', async () => {
  const response = await proxy.request('POST', '/v1/chat/completions', {
    body: { model: 'Guard-Model', messages: [{ role: 'user', content: '你好' }] },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(seenMessages, [{ role: 'user', content: '你好' }])
})
