/**
 * `/v1/completions` 的 `prompt: []` 必须在代理本地被拒，而不是变成上游那句
 * `messages must be a non-empty array`。
 *
 * 起因（实测 2026-11-01）：账号渠道的网关按 OpenAI 规范拒空 `messages` 数组
 * （`vendor/channel-pack/src/openai-gateway/messages.ts`），而 completions 入口原先
 * 只查 `prompt === undefined` —— `prompt: []` 过得了那道检查，投影后就是
 * `messages: []`。于是客户端发的明明是 `prompt`，收到的报错却指向一个它从没发过的
 * 字段名，读起来像「代理没把我任何东西发出去」。
 *
 * 证明的层次（与 `proxy-routes-request.test.ts` 同层）：
 * 真 `ProxyServer` → 真 `routes/completions.ts` 处理器 → 客户端看到的**状态码 / 错误体**。
 * 上游是 `http://127.0.0.1:1/v1`（TCPMUX，本机不监听）：连接立刻被拒，既不出网也不需要
 * 替身服务 —— 所以「走到了转发」的可观测样貌是稳定的 500 `api_error`，而「被本地拦下」是
 * 400。这个差集就是本文件的主证据形式，四条用例两两成对。
 *
 * 四条用例各钉一件事：
 * 1. 空数组 → 400，且报错指向 `prompt` 这个**客户端真的发过的字段**（不是那句网关文案）；
 * 2. 非空数组 → 同一个模型名不再是 400，而是真转发后的 500（右半边差集）；
 * 3. 空数组 + 一个**不存在**的模型 → 仍是 400，钉住校验排在选账号之前：不存在的字段
 *    错误不该被一个更晚的 503 盖掉；
 * 4. `prompt: ''` → **不是** 400。空字符串投影成一条 `content: ''` 的消息，数组非空，
 *    与 chat 入口对空 content 的口径一致（那边也不拒）。这条是故意留的边界，
 *    将来要收紧就得两条入口一起收，本用例负责让「只收一边」变成一次红的测试。
 *
 * 不在本层证明：投影成 `messages` 之后各供应商适配器怎么处理空 content、
 * 本地拒绝为何不进请求日志（与 chat 路由的 `messages` 校验同口径，见该文件）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, startProxy } from './harness.mjs'

const PORT = 18947

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
      // 两条「确实转发了」的用例只需要**一次** ECONNREFUSED 就能证明；留着默认的
      // 3 次 × 5s 退避只会让本文件白等 30 秒，而重试次数不是这里要证的东西。
      retryCount: 0,
      autoRouting: {
        enabled: true,
        maxAttempts: 2,
        stickyMinutes: 30,
        prefer: 'balanced',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager

// 一个在服的自定义供应商：模型 `Test-A` 有账号可选，所以非空 prompt 一定能走到转发。
sm.addProvider({
  id: 'rp1',
  name: 'Route Provider rp1',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  supportedModels: ['Test-A'],
  modelMappings: { 'Test-A': 'rp1-upstream' },
} as never)
sm.addAccount({
  id: 'rp1-acct',
  providerId: 'rp1',
  name: 'rp1 account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

const proxy = await startProxy(PORT)

const postCompletions = (body: Record<string, unknown>) =>
  proxy.request('POST', '/v1/completions', { body })

after(async () => {
  await proxy.stop()
  harness.dispose()
})

test('prompt: [] 在本地就是 400，且报错说的是 prompt 而不是内部的 messages', async () => {
  const response = await postCompletions({ model: 'Test-A', prompt: [] })

  assert.equal(response.status, 400)
  assert.equal(response.json.error.type, 'invalid_request_error')
  assert.equal(response.json.error.param, 'prompt')
  assert.doesNotMatch(
    response.json.error.message,
    /messages/,
    '网关那句 `messages must be a non-empty array` 指向的是代理内部的字段名',
  )
})

test('同一个模型名，非空 prompt 会走到转发（500 api_error）——差集的右半边', async () => {
  const response = await postCompletions({ model: 'Test-A', prompt: ['ping'] })

  assert.notEqual(response.status, 400, '非空 prompt 不该被本地拦下')
  assert.equal(response.status, 500, '端口 1 不监听：ECONNREFUSED 就是「确实转发了」的样貌')
  assert.equal(response.json.error.type, 'api_error')
})

test('校验排在选账号之前：空 prompt + 不存在的模型仍是 400，不是 503', async () => {
  const response = await postCompletions({ model: 'No-Such-Model', prompt: [] })

  assert.equal(response.status, 400)
  assert.equal(response.json.error.code, undefined)
  assert.equal(response.json.error.param, 'prompt')
})

test('prompt: "" 不属本条校验的范围：数组非空，照旧走到转发', async () => {
  const response = await postCompletions({ model: 'Test-A', prompt: '' })

  assert.notEqual(response.status, 400)
  assert.equal(response.status, 500, '与 chat 入口同口径：空 content 由供应商自己答')
})
