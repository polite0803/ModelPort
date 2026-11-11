/**
 * 「协议完成、内容空转」必须在**请求行**上留读数，并把这一轮算成退化。
 *
 * ## 被证明的缺陷（真实流量，2026-11-12 用户报障「Codex 只承诺不执行」）
 *
 * `chatcmpl-mwcghqtq-td1xm6`：Codex 的第二发（工具结果回填后的那一轮）由
 * `open_router/openrouter/free` 服务，HTTP 200、`[DONE]` 正常收尾、176 KB 出站，
 * 但正文与工具调用都是空 —— 客户端 usage 里 `output_tokens` 1108 与
 * `reasoning_output_tokens` 1108 相等，即零个非思考 token，回合以
 * `last_agent_message: null` 结束。网关这行记的是 `status: success`，粘性锚点不撤、
 * Bandit 记胜，于是下一轮继续派给同一台空转机。
 *
 * 去重率判据对这一发结构性失明：思考走 `reasoning_details` 对象数组，
 * `extractStreamText` 只认三个字符串字段，于是 `repetition.lines = 0` →
 * `notJudged: too_short`（看着像健康）。本测试钉的是补上的那一格读数。
 *
 * 证明层次：真 `ProxyServer` → 真 `routes/chat.ts` 流式结算 → 真请求日志行。
 * 替身只有上游 HTTP 服务（它要扮演 OpenRouter 的 `reasoning_details` 形状）。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

const PORT = 18961
const UPSTREAM_PORT = 18963

type Payload = Record<string, any>

const frame = (delta: Record<string, unknown>, finish?: string): string =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gen-fake',
    choices: [{ index: 0, delta, ...(finish === undefined ? {} : { finish_reason: finish }) }],
  })}\n\n`

const upstream = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Payload
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    // 上游收到的是映射后的 actualModel，不是展示名。
    if (body.model === 'empty-turn') {
      // 现网那一发的形状：思考以对象数组下行，正文与 tool_calls 始终为空。
      res.write(frame({ role: 'assistant' }))
      res.write(frame({ reasoning_details: [{ type: 'reasoning.text', text: 'I should inspect the workspace first. '.repeat(40) }] }))
      res.write(frame({}, 'stop'))
    } else {
      res.write(frame({ role: 'assistant' }))
      res.write(frame({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'exec_command', arguments: '{"cmd":"uname -s"}' } }] }))
      res.write(frame({}, 'tool_calls'))
    }
    res.write('data: [DONE]\n\n')
    res.end()
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
      autoRouting: { enabled: false, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

sm.addProvider({
  id: 'orf',
  name: 'OpenRouter Free Test',
  type: 'custom',
  authType: 'token',
  apiEndpoint: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Empty-Turn', 'Acts-Turn'],
  modelMappings: { 'Empty-Turn': 'empty-turn', 'Acts-Turn': 'acts-turn' },
} as never)
sm.addAccount({
  id: 'orf-acct',
  providerId: 'orf',
  name: 'orf account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

await listening
const proxy = await startProxy(PORT)
const { accountRuntime } = await loadModule('main/proxy/accountRuntime.ts')

const TOOLS = [{
  type: 'function',
  function: {
    name: 'exec_command',
    description: 'Run a shell command.',
    parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
  },
}]

/** 日志行是异步定时落盘的，读之前按 requestId 轮询到可见为止。 */
async function rowOf(requestId: string): Promise<Payload> {
  for (let i = 0; i < 40; i++) {
    const hit = sm.getRequestLogs().find(entry => entry.requestId === requestId)
    if (hit !== undefined) return hit as Payload
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`row not found: ${requestId}`)
}

async function streamOnce(model: string): Promise<Payload> {
  const res = await proxy.request('POST', '/v1/chat/completions', {
    body: {
      model,
      messages: [{ role: 'user', content: 'ping' }],
      tools: TOOLS,
      stream: true,
    },
  })
  assert.equal(res.status, 200, '这一发的协议是成功的 —— 缺陷恰恰在于空内容被当成成功')
  // harness 的 request() 已经把整条流读干（res.text 是 SSE 原文），网关的结算路径走完了。
  assert.ok(res.text.includes('data: [DONE]'), '客户端确实收到了唯一一个 [DONE]')
  return rowOf(res.headers['x-request-id'] as string)
}

beforeEach(() => {
  sm.clearRequestLogs()
})

after(async () => {
  await proxy.stop()
  upstream.close()
})

test('带工具、零正文、零工具调用的完成流：请求行留下 emptyTurn 读数', async () => {
  const row = await streamOnce('Empty-Turn')
  const trace = row.streamTrace as Payload

  assert.equal(trace.endReason, 'done')
  assert.equal(trace.sawDone, true)
  assert.ok((trace.bytesOut as number) > 0, '确实出站了字节 —— 不是断流，是空转')
  assert.deepEqual(trace.emptyTurn, { contentChars: 0, toolCallDeltas: 0, toolsOffered: true, empty: true })
  assert.equal(trace.repetition.degraded, false, '去重率判据对这一发失明：读数必须是 notJudged')
  assert.equal(trace.repetition.notJudged, 'too_short')
  // 读数不只是一行日志：它必须进 AIMD/Bandit 的退化计数，否则下一轮照样派给同一台空转机。
  assert.ok(
    (accountRuntime.snapshot('orf-acct', Date.now(), 'empty-turn').degradedRate ?? 0) > 0,
    '空转要按 degraded 记进这一家的运行时窗口',
  )
})

test('同一形状但交付了工具调用：不判空转（正文为零也不算）', async () => {
  const row = await streamOnce('Acts-Turn')
  const trace = row.streamTrace as Payload

  assert.equal(trace.emptyTurn.contentChars, 0)
  assert.equal(trace.emptyTurn.toolCallDeltas, 1)
  assert.equal(trace.emptyTurn.empty, false, '工具调用就是这一轮要交付的东西')
  assert.equal(
    accountRuntime.snapshot('orf-acct', Date.now(), 'acts-turn').degradedRate ?? 0,
    0,
    '正常交付的一发不许被记成退化',
  )
})
