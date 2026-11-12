/**
 * 池语义下「400」不是一个身份，而是三种，必须按**谁说的**分档，不能只看状态码：
 *
 * 1. 聚合条目的不透明 400（空错误体 / `Unknown error`）——「这一家供不了」，
 *    换下一家且不罚账号，**不占**「请求写坏了」的两次上限；
 * 2. 裸 400（这一家不认请求体，例如不认 `temperature`）——池里换家，两次封顶；
 * 3. 裸名链的 400 —— 客户端点名的那个名字就在这几家之间，400 说明请求本身有问题，
 *    第一家就收口。
 *
 * ## 被钉住的回归（2026-11-12，1.8.7 池式换家上线当天）
 *
 * `rejectedRequest` 只排除了能力不符，没排除不透明 400，于是第 1 类被数进第 2 类的
 * 计数器：池里两家抖一次空体 400 就把整条链终止在第 2 家，而 `opaqueAggregateBadRequest`
 * 那条专属分支（不冷却、不计账号故障、继续换家）从此不可达 —— 1.8.6 的判据被悄悄推翻。
 *
 * 证明层次：真 `RequestForwarder.forwardAutoCompletion` / `forwardChainCompletion`
 * 换家循环 + 真 `describeAttemptFailure` 记账。上游替身钉在循环**之下**
 * （`forwardChatCompletion`），所以本文件只证明归类，不碰各家适配器。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const harness = await bootstrapStore({
  initialData: {
    providers: [],
    accounts: [],
    config: {
      proxyPort: 18997,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 3, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
after(() => harness.dispose())

const { requestForwarder } = await loadModule('main/proxy/forwarder.ts')
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

/** 候选只需要循环真正读的几格：`provider.id/name/type`、`account.id`、`actualModel`。 */
function candidate(providerType: string, id: string) {
  return {
    provider: {
      id,
      name: `P ${id}`,
      type: providerType,
      authType: 'token',
      apiEndpoint: 'https://upstream.invalid/v1',
      chatPath: '/chat/completions',
      headers: {},
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      supportedModels: [`${id}/m`],
      modelMappings: { [`${id}/m`]: 'm' },
    },
    account: {
      id: `${id}-acct`,
      providerId: id,
      name: `${id} account`,
      credentials: {},
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    },
    displayName: `${id}/m`,
    actualModel: 'm',
  }
}

const REQUEST = {
  model: 'auto',
  messages: [{ role: 'user', content: 'ping' }],
  requestId: 'req-pool-400',
} as never

const CONTEXT = { requestId: 'req-pool-400', startTime: Date.now() } as never

/** 每一发的回答；用完后一律 200（「第三家会成」这类断言靠它）。 */
let answers: Array<{ status: number; error?: string }> = []
let calls: string[] = []

beforeEach(() => {
  answers = []
  calls = []
  // 换家失败会记账号冷却；下一轮若还是同一批 id，冷却会把候选剔掉。
  autoRouter.reset()
  requestForwarder.forwardChatCompletion = (async (request: { model: string }) => {
    calls.push(request.model)
    const next = answers.shift()
    if (next === undefined) return { success: true, status: 200, body: { ok: true } }
    return { success: false, status: next.status, error: next.error, latency: 1 }
  }) as never
})

test('聚合的不透明 400 不占「请求写坏了」的两次上限：第三家照常被试且成功', async () => {
  answers = [
    { status: 400, error: '' },
    { status: 400, error: 'Unknown error' },
  ]

  const outcome = await requestForwarder.forwardAutoCompletion(
    REQUEST,
    [candidate('aggregate', 'a1'), candidate('aggregate', 'a2'), candidate('aggregate', 'a3')],
    CONTEXT,
    { baseCap: 3 },
  )

  assert.ok(outcome, '循环必须给出结果')
  assert.equal(outcome.result.success, true, '两家供不了不等于整池供不了')
  assert.equal(outcome.attempts, 3, '不透明 400 若被数进两次上限，这里只有 2')
  assert.deepEqual(calls, ['a1/m', 'a2/m', 'a3/m'])
  for (const failure of outcome.failures) {
    assert.equal(failure.status, 400)
    assert.equal(failure.kind, 'failover', '「这一家供不了」不是 fatal')
  }
})

test('裸 400 仍然是「请求写坏了」：两次之后收口，不再空耗整池', async () => {
  answers = [
    { status: 400, error: 'invalid temperature: 2' },
    { status: 400, error: 'invalid temperature: 2' },
  ]

  const outcome = await requestForwarder.forwardAutoCompletion(
    REQUEST,
    [candidate('custom', 'c1'), candidate('custom', 'c2'), candidate('custom', 'c3')],
    CONTEXT,
    { baseCap: 3 },
  )

  assert.ok(outcome)
  assert.equal(outcome.result.success, false)
  assert.equal(outcome.result.status, 400)
  assert.equal(outcome.attempts, 2, '第二次拒收就该承认请求本身有问题')
  assert.equal(outcome.failures[0]?.kind, 'failover')
})

test('裸名链的 400 是终局：点名的那个名字就在这几家之间', async () => {
  answers = [{ status: 400, error: 'invalid temperature: 2' }]

  const outcome = await requestForwarder.forwardChainCompletion(
    REQUEST,
    [candidate('custom', 'c1'), candidate('custom', 'c2'), candidate('custom', 'c3')],
    CONTEXT,
  )

  assert.ok(outcome)
  assert.equal(outcome.result.status, 400)
  assert.equal(outcome.attempts, 1, '裸名链不换家')
  assert.deepEqual(calls, ['c1/m'])
})