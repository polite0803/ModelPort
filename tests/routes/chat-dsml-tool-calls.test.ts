/**
 * `/v1/chat/completions` 泳道的 DSML 还原（端到端）。
 *
 * 真 ProxyServer → 真 routes/chat.ts 流式管线 → 真 tap；替身只有上游 HTTP 服务，
 * 它扮演 OpenCode Go 的 deepseek-v4.1-flash：工具调用以 DSML 文本写进正文、
 * 结束帧是 `stop`；另有一路给完 `[DONE]` 却不发 `finish_reason`。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, startProxy } from './harness.mjs'

const PORT = 18983
const UPSTREAM_PORT = 18984

const DSML = [
  '',
  '<｜DSML｜ calls>',
  '<｜DSML｜ invoke name="exec_command">',
  '<｜DSML｜ parameter name="cmd" string="true">git status --short</｜DSML｜ parameter>',
  '</｜DSML｜ invoke>',
  '</｜DSML｜ calls>',
  '',
].join('\n')

const frame = (delta: Record<string, unknown>, finish?: string): string =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-upstream',
    object: 'chat.completion.chunk',
    created: 11,
    model: 'dsml-turn',
    choices: [{ index: 0, delta, ...(finish === undefined ? {} : { finish_reason: finish }) }],
  })}\n\n`

const upstream = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, any>
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (body.model === 'dsml-turn') {
      res.write(frame({ role: 'assistant' }))
      // 按 11 个字符切帧，模拟真实 SSE 分片。
      for (let i = 0; i < DSML.length; i += 11) res.write(frame({ content: DSML.slice(i, i + 11) }))
      res.write(frame({}, 'stop'))
    } else {
      // 上游给了 [DONE]，整条流却没有 finish_reason。
      res.write(frame({ role: 'assistant' }))
      res.write(frame({ content: '正在处理。' }))
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
  id: 'dsml-src',
  name: 'DSML Source Test',
  type: 'custom',
  authType: 'token',
  apiEndpoint: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Dsml-Turn', 'NoFinish-Turn'],
  modelMappings: { 'Dsml-Turn': 'dsml-turn', 'NoFinish-Turn': 'nofinish-turn' },
} as never)
sm.addAccount({
  id: 'dsml-acct',
  providerId: 'dsml-src',
  name: 'dsml account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

await listening
const proxy = await startProxy(PORT)

after(async () => {
  await proxy.stop()
  await new Promise<void>(resolve => upstream.close(() => resolve()))
})

const TOOLS = [{
  type: 'function',
  function: {
    name: 'exec_command',
    description: 'Run a shell command.',
    parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
  },
}]

const dataFrames = (text: string): Array<Record<string, any>> => text
  .split('\n\n')
  .filter(block => block.startsWith('data: {'))
  .map(block => JSON.parse(block.slice('data: '.length)))

test('带工具：DSML 正文还原成 tool_calls，标记不落客户端', async () => {
  const res = await proxy.request('POST', '/v1/chat/completions', {
    body: {
      model: 'Dsml-Turn',
      messages: [{ role: 'user', content: '看一下 git 状态' }],
      tools: TOOLS,
      stream: true,
    },
  })
  assert.equal(res.status, 200)
  assert.equal(res.text.includes('｜DSML｜'), false)
  const frames = dataFrames(res.text)
  const call = frames
    .flatMap(entry => entry.choices[0].delta.tool_calls ?? [])
    .find(entry => entry.function?.name === 'exec_command')
  assert.ok(call, '客户端必须收到结构化的 exec_command')
  assert.deepEqual(JSON.parse(call.function.arguments), { cmd: 'git status --short' })
  const finish = frames.find(entry => entry.choices[0].finish_reason != null)
  assert.equal(finish!.choices[0].finish_reason, 'tool_calls')
  assert.equal(res.text.match(/data: \[DONE\]/g)?.length, 1)
})

test('不带工具：整块丢弃而不是把标记交付给用户', async () => {
  const res = await proxy.request('POST', '/v1/chat/completions', {
    body: {
      model: 'Dsml-Turn',
      messages: [{ role: 'user', content: '把这段格式念给我听' }],
      stream: true,
    },
  })
  assert.equal(res.status, 200)
  // 这一轮没有执行器，还原成调用也没人执行；留着只会把标记渲染进对话。
  assert.equal(res.text.includes('｜DSML｜'), false, '标记不能交付')
  assert.equal(dataFrames(res.text).some(entry => entry.choices[0].delta.tool_calls !== undefined), false)
})

test('上游缺 finish_reason：客户端仍收到一个结束帧', async () => {
  const res = await proxy.request('POST', '/v1/chat/completions', {
    body: {
      model: 'NoFinish-Turn',
      messages: [{ role: 'user', content: 'ping' }],
      tools: TOOLS,
      stream: true,
    },
  })
  assert.equal(res.status, 200)
  const finish = dataFrames(res.text).find(entry => entry.choices[0].finish_reason != null)
  assert.ok(finish, '缺结束帧的流必须被补齐')
  assert.equal(finish!.choices[0].finish_reason, 'stop')
  assert.equal(res.text.match(/data: \[DONE\]/g)?.length, 1)
})