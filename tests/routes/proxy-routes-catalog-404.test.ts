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
 * 前半段的顺序不是随便排的：第一条先把「谁排在第一位」**测出来**（而不是
 * 假设），后两条才有资格按「试了几家」下断言。后半段的池语义用例反过来不依赖
 * 顺序：替身按「第一发失败、之后成功」作答，谁排第一都一样。
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
type UpstreamMode =
  | 'ok'
  | 'unavailable'
  | 'generic'
  | 'catalog-miss'
  | 'all-unavailable'
  | 'all-forbidden'
  /** 只有第一发报上游风控（400 `request illegal`），之后都 200 —— 与哪家先跑无关 */
  | 'human-first'
  /** 只有第一发报凭据失效（502 `no usable credential`），之后都 200 */
  | 'credential-first'
  /** 每一发都是 5xx：账号故障，按 maxAttempts 收口 */
  | 'server-error-all'
  /** 只有第一发报裸 400（这一家不认这份请求体），之后都 200 */
  | 'bad-request-first'
  /** 每一发都是同一种裸 400：请求本身写坏了 */
  | 'bad-request-all'
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

    // 池语义用例用「第一发失败、之后成功」而不是「某一家失败」：池里谁排第一取决于
    // 前置用例留下的派发计数，不能让断言依赖那个顺序。
    if (mode === 'human-first' && seenModels.length === 1) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: { message: 'request illegal', type: 'invalid_request_error', code: '11140' },
      }))
      return
    }

    if (mode === 'credential-first' && seenModels.length === 1) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: { message: 'test-channel: no usable credential; log in first', type: 'api_error' },
      }))
      return
    }

    // 裸 400：既不是能力不符（工具超限/上下文/目录），也不是账号故障 —— 池语义下
    // 它照样换下一家，但换两次就收口（见 forwarder 的 MAX_REJECTED_REQUEST_SWITCHES）。
    if (mode === 'bad-request-all' || (mode === 'bad-request-first' && seenModels.length === 1)) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: { message: 'invalid temperature: 2', type: 'invalid_request_error' },
      }))
      return
    }

    if (mode === 'server-error-all') {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: { message: 'upstream internal failure', type: 'api_error' },
      }))
      return
    }

    if (mode === 'all-unavailable') {
      // 不管谁被选中都答「这一家供不了」：池里每一家都必须被试到。哪家先跑取决于
      // 前置用例留下的派发计数，所以不能只让 Bad 一家失败。
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: { message: '模型不存在或已停用', type: 'invalid_request_error', code: 'model_not_found' },
      }))
      return
    }

    if (mode === 'all-forbidden') {
      // 账号事实：这一家不让用（不是「供不了这个模型」）。池语义下照样换下一家，
      // 但每一次都记账号故障，由 baseCap 收口。
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: { message: 'forbidden', type: 'permission_error', code: 'forbidden' },
      }))
      return
    }

    // 只有这三个模式让 `badp` 单独失败；「第一发失败」那组用例（`human-first` /
    // `credential-first` / `bad-request-first`）的后续调用必须按健康上游回答，
    // 否则「第二发会不会成」就取决于它落在谁身上。
    const badpOnlyFailure = mode === 'unavailable' || mode === 'generic' || mode === 'catalog-miss'
    if (isBad && badpOnlyFailure) {
      // catalog-miss 是聚合目录的 400（ModelScope/BazaarLink 原文），与渠道
      // worker 的 404 是两类：前者要进 (provider, model) 冷却，后者不进。
      const catalogMiss = mode === 'catalog-miss'
      res.writeHead(catalogMiss ? 400 : 404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: {
          message: mode === 'unavailable'
            ? '模型不存在或已停用'
            : catalogMiss
              ? 'Model id : badp-upstream , has no provider supported'
              : 'The model `badp-upstream` does not exist',
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

// 架构 A 的缺省换家范围是 `single`：一轮只试一个模型，换模型发生在回合之间。本文件
// 证明的「这一家供不了这个模型 ⇒ 换下一家」是**同回合跨模型**换家，属于 `pool` 这一档，
// 所以显式声明，不靠缺省值。
assert.equal(sm.updateRoute('auto', { modelScope: 'pool' }).ok, true, '迁移必须造出 auto 路由')

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
  // 查的是「池里还有谁」，所以显式带上这条 `pool` 路由（不传 route 走的是缺省 `single`）。
  const after = autoRouter.select(
    { model: 'auto', messages: [{ role: 'user', content: 'ping' }] } as never,
    'round-robin',
    'cheap',
    sm.getModelRoutes().auto,
  )
  assert.deepEqual([...new Set(after.candidates.map(candidate => candidate.displayName))].sort(),
    ['Bad-Channel', 'Good-Model'], '失败之后 Bad 仍必须在池里（没有冷却）')
  assert.deepEqual([...after.skipped], [], 'Bad 的账号没有因为这次 404 被记故障')
})

test('上游目录缺失 400：换下一家，且同模型在冷却期内不再进池', async () => {
  mode = 'catalog-miss'

  const first = await postAuto()
  assert.equal(first.status, 200, '目录缺失不等于 auto 不可用')
  assert.match(first.headers['x-modelport-route'], /Upstream Provider goodp/)
  assert.equal(first.headers['x-modelport-auto-attempts'], '2')
  assert.deepEqual(seenModels, ['badp-upstream', 'goodp-upstream'])

  // 第二笔：Bad 仍在目录里，但 (provider, model) 已被冷却剔除，不再付
  // 一次必败的往返（WSL 日志里 modelscope 每小时重撞十几次的就是这一步）。
  seenModels.length = 0
  const second = await postAuto()
  assert.equal(second.status, 200)
  assert.equal(second.headers['x-modelport-auto-attempts'], '1')
  assert.deepEqual(seenModels, ['goodp-upstream'], '冷却期内的 Bad 不该再被上游调用')
})

test('普通上游 404 也换下一家（2026-11-02 对齐 new-api）', async () => {
  mode = 'generic'

  const response = await postAuto()

  // 同一个路由里两家对「这个模型在不在」可以给出不同答案：一家 404 不代表
  // 路由不可用。仍由 autoExhaustedResponse 在**多家都 404** 时收口成 503。
  assert.equal(response.status, 200)
  assert.match(response.headers['x-modelport-route'], /Upstream Provider goodp/)
  assert.equal(response.headers['x-modelport-auto-attempts'], '2')
  assert.deepEqual(seenModels, ['badp-upstream', 'goodp-upstream'])
})

/**
 * 池语义（2026-11-12 策略改）：`auto` 是一个池，不是泳道。
 *
 * 排序决定先试谁，一家失败就换下一家 —— **包括下一个模型**。原先「默认停在队首
 * 模型」的栅栏让客户端在第一发硬故障后当场中断，而池里还有几十个候选从未被试。
 * 下面这组用例逐条钉住「另一个模型真的会被调用」，以及各种失败类在池里走到哪一步。
 */
function createPoolRoute(name: string) {
  return sm.createRoute({
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
    // 这一组用例证明的就是池语义本身（同回合跨模型换家），显式要 `pool`。
    modelScope: 'pool',
  })
}

function postRoute(name: string) {
  return proxy.request('POST', '/v1/chat/completions', {
    body: { model: name, messages: [{ role: 'user', content: 'ping' }] },
    headers: { 'X-Auto-Prefer': 'cheap' },
  })
}

function autoRow(response: { headers: Record<string, string> }) {
  return sm.getRequestLogs().find(
    (entry: Record<string, unknown>) => entry.requestId === response.headers['x-request-id']
  ) as Record<string, any> | undefined
}

test('池里每一家都会被试：全部供不了才收口成可重试的 503', async () => {
  // 2026-11-12 的策略改：池里另一个模型必须真的被调用。原先栅栏在，第一发 404
  // 就 break，客户端看到的是「这条路由坏了」，而池里还有活着的家。
  assert.equal(createPoolRoute('whole-pool').ok, true)

  mode = 'all-unavailable'
  const response = await postRoute('whole-pool')

  assert.equal(response.status, 503, '多家都 404 ⇒「此刻没有可服务候选」，503 才是可重试的语义')
  assert.equal(seenModels.length, 2, '池里另一家必须被试到 —— 泳道栅栏已退役')

  const row = autoRow(response)
  assert.equal(row?.auto.failures.length, 2, '每一次被跳过的候选都要在日志里留下理由')
  assert.deepEqual(
    row?.auto.failures.map((failure: { kind: string }) => failure.kind),
    ['capability', 'capability'],
    '目录类失败按能力不符记账，不是账号故障',
  )
  assert.equal(row?.auto.lane, undefined, '泳道字段已退役：池里没有「钉住的模型」')
})

test('风控按账号生效：换下一家（可以是下一个模型）', async () => {
  // 2026-11-12 报障：`auto` 钉在国际版 Hy4（唯一账号被 11140 拦死），同池国内版
  // Hy4 的两个在线账号一次都没被试到，整场 400。风控按**账号**生效且要人/时间
  // 恢复，池里换一家可能当场就成。
  assert.equal(createPoolRoute('human-pool').ok, true)

  mode = 'human-first'
  const response = await postRoute('human-pool')

  assert.equal(response.status, 200, '这一家的账号被风控拦死不等于这条路由不可用')
  assert.equal(response.headers['x-modelport-auto-attempts'], '2')
  assert.equal(seenModels.length, 2)
  assert.notEqual(seenModels[0], seenModels[1], '第二发必须换到另一个模型')

  const row = autoRow(response)
  assert.equal(row?.auto.failures[0]?.kind, 'failover', '日志里的 kind 必须与「实际换下去了」一致')
})

test('凭据失效同样换下一家', async () => {
  // 与风控同一档（`isChannelHumanRequiredFailure`）：这一家的凭据要人来补，
  // 换账号换不出新凭据，换一家模型可能当场就成。
  assert.equal(createPoolRoute('cred-pool').ok, true)

  mode = 'credential-first'
  const response = await postRoute('cred-pool')

  assert.equal(response.status, 200)
  assert.equal(response.headers['x-modelport-auto-attempts'], '2')
  assert.notEqual(seenModels[0], seenModels[1])
})

test('5xx 是账号故障：按 maxAttempts 收口，收口后是可重试的 503', async () => {
  // 5xx 是「系统性问题、多试只是多烧」的那一档，仍由 baseCap 收口（本用例路由
  // maxAttempts: 2）。但收口发生在**池里两家都试过之后**，不是第一家的失败。
  assert.equal(createPoolRoute('server-pool').ok, true)

  mode = 'server-error-all'
  const response = await postRoute('server-pool')

  assert.equal(response.status, 503, '链被账号故障耗尽：503 + Retry-After 才是「等一会再来」')
  assert.equal(seenModels.length, 2, 'baseCap=2：池里两家都试过才收口')

  const row = autoRow(response)
  assert.deepEqual(
    row?.auto.failures.map((failure: { kind: string }) => failure.kind),
    ['failover', 'failover'],
  )
})

test('403 也换下一家：账号的事实可能因家而异，耗尽后收口 503', async () => {
  assert.equal(createPoolRoute('forbidden-pool').ok, true)

  mode = 'all-forbidden'
  const response = await postRoute('forbidden-pool')

  assert.equal(response.status, 503, '池里两家都 403：这一笔此刻没有可服务候选')
  assert.equal(seenModels.length, 2, '第一家 403 不是整条路由的结局')
})

test('裸 400 在池语义下也换下一家：一家不认请求体不等于整池不认', async () => {
  assert.equal(createPoolRoute('reject-pool').ok, true)

  mode = 'bad-request-first'
  const response = await postRoute('reject-pool')

  assert.equal(response.status, 200, '第二家接受同一份请求体，这一笔就该成')
  assert.equal(seenModels.length, 2)

  const row = autoRow(response)
  assert.equal(row?.auto.failures[0]?.kind, 'failover',
    '它按 `fatal` 记的话，日志会和实际分支（继续换下去了）互相矛盾')
})

test('接连两家都拒收同一份请求：第二次就收口，不把池子刷完', async () => {
  // 一家 400 可能是接入怪癖，接连两家都拒收更可能是请求本身写坏了。继续换下去
  // 只是把同一次拒绝在池里重演，还先把客户端的时间耗光。
  assert.equal(createPoolRoute('reject-twice').ok, true)

  mode = 'bad-request-all'
  const response = await postRoute('reject-twice')

  assert.equal(response.status, 400, '请求形状是客户端的责任：原样透传，不伪装成可重试')
  assert.equal(seenModels.length, 2, '换两次就承认这是请求本身的问题')
})
