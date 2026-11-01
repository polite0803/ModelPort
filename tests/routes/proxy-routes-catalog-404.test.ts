/**
 * 「这一家供不了这个模型」必须换成下一家，而不是让整条 `auto` 请求 404
 * （用户报障 2026-11-01 08:06/08:11：`auto` → `opencode/qwen3.8-max` → 404
 * 「模型不存在或已停用」，同池另外 4 家一次都没被试到）。
 *
 * 证明的层次（与 `proxy-routes-request.test.ts` 同一层，但上游是真的本地服务）：
 * 真 `ProxyServer` → 真 `routes/chat.ts` → 真 `forwarder.forwardAutoCompletion`
 * 的换家循环 → 客户端看到的**状态码 / 路由头 / 尝试次数**。
 * 上游用本机 `node:http` 替身：不碰 `worker.ts` 的文案来源（那是渠道目录漂移，
 * 本文件负责的是**宿主拿到这个失败之后的处置**），只把它的失败形状原样回给宿主。
 *
 * 三条用例的顺序不是随便排的：第一条先把「谁排在第一位」**测出来**（而不是
 * 假设），后两条才有资格按「试了几家」下断言。
 *
 * 不在本层证明：判据本身的窄口径（`failover.test.ts`）、粘性/池语义
 * （`routes-pool-and-sticky.test.ts`）、renderer UI。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { bootstrapStore, loadModule, startProxy } from './harness.mjs'

const PORT = 18941
const UPSTREAM_PORT = 18942

/**
 * 替身上游的行为：
 * - `ok` —— 两家都能答，用来先证明候选顺序；
 * - `unavailable` —— 只有 `badp-upstream` 报渠道 worker 的那句 404（目录漂移）；
 * - `generic` —— 只有 `badp-upstream` 报普通的上游 404（客户端写了个不存在的名字）。
 * 两条 404 的状态码相同、只有文案不同，正是「窄判据」的分水岭。
 */
type UpstreamMode = 'ok' | 'unavailable' | 'generic'
let mode: UpstreamMode = 'ok'
const seenModels: string[] = []

const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { model?: string }
    const actualModel = body.model ?? ''
    seenModels.push(actualModel)
    const isBad = actualModel === 'badp-upstream'

    if (isBad && mode !== 'ok') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: {
          message: mode === 'unavailable' ? '模型不存在或已停用' : 'The model `badp-upstream` does not exist',
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      }))
      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      created: 1,
      model: actualModel,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
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
      // 故意**不写** `routes` 键：让升级首读的迁移造出 `auto`（键存在即永不重放，
      // 写了空表就等于这条装机上根本没有 `auto` 可路由）。
      autoRouting: {
        enabled: true,
        maxAttempts: 2,
        stickyMinutes: 0,
        prefer: 'balanced',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager

const upstreamBase = `http://127.0.0.1:${UPSTREAM_PORT}/v1`

function providerFixture(id: string, displayName: string, capabilities: Record<string, unknown> = {}) {
  return {
    id,
    name: `Upstream Provider ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: upstreamBase,
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [displayName],
    modelMappings: { [displayName]: `${id}-upstream` },
    ...(Object.keys(capabilities).length === 0 ? {} : { modelCapabilities: { [displayName]: capabilities } }),
  }
}

// Bad 故意标成免费：`prefer:'cheap'` 下 free 的成本档是 +0.3，远大于 bandit 的
// ±0.075 摆动 —— 第一条用例把这份顺序**测出来**，后两条就无需假设谁先谁后。
sm.addProvider(providerFixture('badp', 'Bad-Channel', { free: true, contextTokens: 200000 }) as never)
sm.addProvider(providerFixture('goodp', 'Good-Model', { contextTokens: 200000 }) as never)
for (const id of ['badp', 'goodp']) {
  sm.addAccount({
    id: `${id}-acct`,
    providerId: id,
    name: `${id} account`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  } as never)
}

await listening

const proxy = await startProxy(PORT)
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

const postAuto = () => proxy.request('POST', '/v1/chat/completions', {
  body: { model: 'auto', messages: [{ role: 'user', content: 'ping' }] },
  headers: { 'X-Auto-Prefer': 'cheap' },
})

beforeEach(() => {
  mode = 'ok'
  seenModels.length = 0
  // 换家失败会给账号打冷却，冷却里的候选下一轮直接被剔除 —— 用例之间只由 mode 决定结果
  autoRouter.reset()
})

after(async () => {
  await proxy.stop()
  autoRouter.reset()
  server.close()
  harness.dispose()
})

test('前置：候选顺序是可复现的 —— `cheap` 下免费的 Bad 排第一，两家都答得好好的', async () => {
  const response = await postAuto()

  assert.equal(response.status, 200)
  // `X-ModelPort-Route` 是 `<actualModel> (<provider name>)`，不是候选的展示名
  assert.match(response.headers['x-modelport-route'], /Upstream Provider badp/)
  assert.equal(response.headers['x-modelport-auto-attempts'], '1', '第一家就成了，不该有多余尝试')
  assert.deepEqual(seenModels, ['badp-upstream'], 'Bad 确实先被上游调用')
})

test('目录漂移类 404：换成下一家并成功，账号不被记冷却/记故障', async () => {
  mode = 'unavailable'

  const response = await postAuto()

  assert.equal(response.status, 200, '这一家供不了不等于 auto 不可用')
  assert.match(response.headers['x-modelport-route'], /Upstream Provider goodp/)
  assert.equal(response.headers['x-modelport-auto-attempts'], '2')
  assert.deepEqual(seenModels, ['badp-upstream', 'goodp-upstream'], '先撞 404，再换下一家')

  // 不记冷却是这条修复的另一半：Bad 的账号是健康的（请求在自己的进程里就被拒），
  // 记了冷却它就从**后续所有**请求的池里消失，把一次目录漂移放大成整家停摆。
  const after = autoRouter.select(
    { model: 'auto', messages: [{ role: 'user', content: 'ping' }] } as never,
    'round-robin',
    'cheap',
  )
  assert.deepEqual([...new Set(after.candidates.map(candidate => candidate.displayName))].sort(),
    ['Bad-Channel', 'Good-Model'], '失败之后 Bad 仍必须在池里（没有冷却）')
  assert.deepEqual([...after.skipped], [], 'Bad 的账号没有因为这次 404 被记故障')
})

test('普通上游 404：判据是窄的 —— 仍然直接失败，不把三家都试一遍', async () => {
  mode = 'generic'

  const response = await postAuto()

  assert.equal(response.status, 404, '「客户端写了个不存在的模型」这类 404 换家没有意义')
  assert.match(String(response.json.error.message), /does not exist/, '上游原文要透出去')
  assert.deepEqual(seenModels, ['badp-upstream'], '只打了第一家，没有连带去试 Good')
})
