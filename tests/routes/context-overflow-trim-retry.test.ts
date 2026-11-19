/**
 * 「装不下」的第二层救场：池里没有别的候选时，按上游亲口给的上界裁一次再发。
 *
 * 证明的层次：真 `ProxyServer` → 真 `routes/chat.ts` 的换模型循环 → 真
 * `forwarder.ts` 的 `forceContextTrim` 接线 → 上游替身**实际收到的请求体**。
 *
 * 两条用例覆盖 `chat.ts` 循环里的 ② 与它之后的收口：
 * 1. 400 报文里写了 `Range of input length should be [1, 258048]`，第二次请求
 *    确实被裁小并成功 —— 证明「裁一次重发」真的接上了，不只是记了笔账；
 * 2. 同样第二发仍被判超限，客户端拿到的是**本地** 400（`code: context_overflow`，
 *    文案带上界与「已裁一次」），且只打两次上游 —— 同一个上界不重复裁。
 *
 * 不在本层证明：
 * - ① 换模型：由 `tests/routes/context-overflow-failover.test.ts` 从池语义那侧钉住
 *   （能力类 400 换下一家并成功）；
 * - 预算里的工具扣减与 2% 余量：`tests/proxy/context-overflow-recovery.test.ts`（纯函数）。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

const PORT = 18995
const UPSTREAM_PORT = 18996
const MEASURED_LIMIT = 258_048
/** 上游「真实」判决的替身：按请求体字符数判。1M 字符 ≈ 33 万估算 token。 */
const ACCEPT_BELOW_CHARS = 900_000

type UpstreamMode = 'trim-then-ok' | 'always-overflow'
let mode: UpstreamMode = 'trim-then-ok'
const calls: Array<{ chars: number; messages: number }> = []

function messageChars(messages: unknown): number {
  if (!Array.isArray(messages)) return 0
  return messages.reduce((sum: number, message: Record<string, unknown>) => {
    const content = message.content
    return sum + (typeof content === 'string' ? content.length : 0)
  }, 0)
}

const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
      model?: string
      messages?: unknown
    }
    const chars = messageChars(body.messages)
    calls.push({ chars, messages: Array.isArray(body.messages) ? body.messages.length : 0 })

    if (mode === 'always-overflow' || chars > ACCEPT_BELOW_CHARS) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: {
          message: `InternalError.Algo.InvalidParameter: Range of input length should be [1, ${MEASURED_LIMIT}]`,
          type: 'invalid_request_error',
        },
      }))
      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      created: 1,
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 21, completion_tokens: 3, total_tokens: 24 },
    }))
  })
})
const listening = new Promise<void>(resolve => server.listen(UPSTREAM_PORT, '127.0.0.1', resolve))

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
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'cheap', poolStrategies: [] },
      // 裁剪总开关：`enabled: true` 才轮到 tokenLimit；`channelIds` 留空是刻意的 ——
      // 本文件证明的正是「不靠白名单」那条入口。
      contextManagement: {
        enabled: true,
        channelIds: [],
        strategies: {
          slidingWindow: { enabled: true, maxMessages: 20 },
          tokenLimit: { enabled: true, maxTokens: 65_536 },
        },
        executionOrder: ['slidingWindow', 'tokenLimit'],
      },
    },
  },
})
const sm = harness.storeManager

sm.addProvider({
  id: 'bigp',
  name: 'Big Declared',
  type: 'custom',
  authType: 'token',
  apiEndpoint: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Big-Declared'],
  modelMappings: { 'Big-Declared': 'bigp-upstream' },
  // 目录说 1M，上游实际只认 258,048：目录是转述，报文才是判决。
  modelCapabilities: { 'Big-Declared': { contextTokens: 1_000_000 } },
} as never)
sm.addAccount({
  id: 'bigp-acct',
  providerId: 'bigp',
  name: 'bigp account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

await listening
const proxy = await startProxy(PORT)
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')
const { clearMeasuredContextLimits, recordMeasuredContextLimit } = await loadModule(
  'main/proxy/contextOverflowLimits.ts'
)

/** ≈ 33 万估算 token（3 字符/token）：80 条各 1.25 万 ASCII 字符 + 最新指令。 */
function oversizedConversation() {
  const history: Array<{ role: string; content: string }> = []
  for (let i = 0; i < 80; i += 1) {
    history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(12_500) })
  }
  history.push({ role: 'user', content: '现在把剩下的活干完，保留这一条指令。' })
  return history
}

beforeEach(() => {
  mode = 'trim-then-ok'
  calls.length = 0
  clearMeasuredContextLimits()
  autoRouter.reset()
})

after(async () => {
  await proxy.stop()
  autoRouter.reset()
  clearMeasuredContextLimits()
  server.close()
  harness.dispose()
})

test('池里没有别的候选：按报文上界裁一次、同一候选重发并成功', async () => {
  const response = await proxy.request('POST', '/v1/chat/completions', {
    body: { model: 'auto', messages: oversizedConversation() },
  })

  assert.equal(response.status, 200, `裁一次之后必须真的装得下：${response.text.slice(0, 300)}`)
  assert.equal(calls.length, 2, '一发原样、一发裁剪后 —— 不多打第三枪')
  const first = calls[0]
  const second = calls[1]
  assert.ok(first !== undefined && second !== undefined)
  assert.ok(first.chars > ACCEPT_BELOW_CHARS, `第一发必须是完整历史，实测 ${first.chars} 字符`)
  assert.ok(second.chars < first.chars, `第二发必须真的变小：${second.chars} < ${first.chars}`)
  assert.ok(
    second.chars <= ACCEPT_BELOW_CHARS,
    `第二发必须落在上游接受范围内，实测 ${second.chars}`,
  )
  assert.ok(second.messages > 0, '裁剪不许把历史清空')
})

test('裁一次仍超限：客户端拿本地 400（context_overflow），不再第三次打上游', async () => {
  mode = 'always-overflow'

  const response = await proxy.request('POST', '/v1/chat/completions', {
    body: { model: 'auto', messages: oversizedConversation() },
  })

  assert.equal(response.status, 400)
  assert.equal(response.json?.error?.code, 'context_overflow', '机读码要说明这是窗口问题，不是账号故障')
  const message = String(response.json?.error?.message ?? '')
  assert.match(message, new RegExp(String(MEASURED_LIMIT)), '文案里要带上实际裁过的上界')
  assert.match(message, /trimmed retry/, '文案要说明「已经裁过一次」')
  assert.equal(calls.length, 2, '同一个上界只裁一次：第二发之后必须停手')
})

test('实测上界远高于本次体量：只按 token 预算判，不按条数丢历史', async () => {
  // 这是「按条数丢」的反向负控：同一个 (provider, 模型) 已经记过 258,048 的上界，
  // 于是每轮都会走 token 预算那条路。历史只有 101 条短消息（≈3.5K token），
  // 预算装得下 —— 条数一条都不许少。滑窗（maxMessages 20）若在这条路上生效，
  // 这里就会只剩 20 条，前缀缓存也会每轮全价重读。
  recordMeasuredContextLimit('bigp', 'bigp-upstream', MEASURED_LIMIT)

  const messages: Array<{ role: string; content: string }> = []
  for (let i = 0; i < 100; i += 1) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `第 ${i} 条很短的记录` })
  }
  messages.push({ role: 'user', content: '继续。' })

  const response = await proxy.request('POST', '/v1/chat/completions', {
    body: { model: 'auto', messages },
  })

  assert.equal(response.status, 200)
  assert.equal(calls.length, 1, '装得下就不该有第二次往返')
  assert.equal(calls[0]?.messages, messages.length, '条数必须原样保留：预算装得下就不裁历史')
})