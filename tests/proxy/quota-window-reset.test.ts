/**
 * 额度窗复位时刻（2026-11-15 现网）。
 *
 * 现象：`auto` 路由硬钉 `volcengine_ark_agent_plan/deepseek-v4.1-flash`，20 分钟内
 * 45 笔 `model_temporarily_unavailable`，每笔报「retry in 42s」这类分钟级倒计时。
 * 上游原文是 `You have exceeded the 5-hour usage quota. It will reset at
 * 2026-11-15 17:56:06 +0800 CST.` —— 真实解禁在约 2 小时后。
 *
 * 两个缺陷各由一组对照钉住：
 * 1. `QUOTA_WINDOW_EXHAUSTED_PATTERN` 不认「N-hour usage quota」这个措辞 ⇒ 1 小时
 *    档 never fires，落到 60s→10min 指数。对照 B（只有额度文案、无复位时刻）必须
 *    ≥1h；旧判据在这一格只会给 60s。
 * 2. 上游明写的复位时刻从不解析 ⇒ 冷却每到期一次就放一笔真请求去撞同一堵墙再翻倍。
 *    对照 A（额度文案 + 2h 后的复位时刻）必须报到 ~2h，而不是 1h 档。
 *
 * 窄判据不许松：对照 C（裸 429 / rate limit）仍是分钟级，否则就是把限流误判成额度耗尽。
 *
 * 3. 终局档（1h/6h）是**没有事实时的估计**，不许与上游写明的复位时刻取更晚者 ——
 *    否则客户端白等最多一整档。对照 E（复位在 45 分钟后）必须报 ~2700s 而不是 3600s；
 *    对照 B 证明没有时刻时终局档仍然兜底。
 */
import { test, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'
import type { ChatCompletionRequest } from '../../src/main/proxy/types.ts'
import type { ModelRoute } from '../../src/shared/types.ts'
import {
  permanentRefusalCooldownMs,
  quotaWindowResetMs,
  QUOTA_WINDOW_COOLDOWN_MS,
} from '../../src/main/proxy/failover.ts'

const HOUR = 60 * 60 * 1000

/** 现网原文（app-logs 2026-11-15T08:03:58.855Z / 08:12:28.499Z），逐字。 */
const LIVE_MESSAGE =
  'You have exceeded the 5-hour usage quota. It will reset at 2026-11-15 17:56:06 +0800 CST. ' +
  'We recommend upgrading your plan for more quota, or waiting for the reset.'

test('现网措辞命中额度窗档（旧判据在这一格返回 undefined）', () => {
  assert.equal(permanentRefusalCooldownMs({ status: 429, message: LIVE_MESSAGE }), QUOTA_WINDOW_COOLDOWN_MS)
  for (const wording of [
    'You have exceeded the 5-hour usage quota.',
    'You have exceeded the 24 hour usage quota.',
    'weekly usage quota exhausted',
    'monthly usage quota reached',
  ]) {
    assert.equal(permanentRefusalCooldownMs({ message: wording }), QUOTA_WINDOW_COOLDOWN_MS, wording)
  }
})

test('判据仍然窄：限流不是额度耗尽', () => {
  assert.equal(permanentRefusalCooldownMs({ status: 429 }), undefined)
  assert.equal(permanentRefusalCooldownMs({ status: 429, message: 'rate limit exceeded' }), undefined)
  assert.equal(
    permanentRefusalCooldownMs({ status: 429, message: '5-hour rate limit exceeded, slow down' }),
    undefined,
    '「5 小时限流」是限流措辞，不是额度窗耗尽',
  )
})

test('复位时刻解析：带偏移才认，过期与超远都丢弃', () => {
  // 08:00:14Z → 09:56:06Z = 1h55m52s
  const now = Date.parse('2026-11-15T08:00:14Z')
  assert.equal(quotaWindowResetMs(LIVE_MESSAGE, now), 6_952_000)
  assert.equal(
    quotaWindowResetMs('It will reset at 2026-11-15T17:56:06+08:00.', now),
    6_952_000,
    'ISO 的 T 分隔与带冒号偏移同样认',
  )
  assert.equal(quotaWindowResetMs(undefined, now), undefined)
  assert.equal(quotaWindowResetMs('quota exceeded', now), undefined)
  assert.equal(
    quotaWindowResetMs('It will reset at 2026-11-15 17:56:06 CST.', now),
    undefined,
    'CST 在中国/美国中部之间歧义：无显式偏移不猜',
  )
  assert.equal(
    quotaWindowResetMs(LIVE_MESSAGE, Date.parse('2026-11-15T10:00:00Z')),
    undefined,
    '复位时刻已过去 ⇒ 不产生冷却',
  )
  assert.equal(
    quotaWindowResetMs('It will reset at 2027-06-01 00:00:00 +0000.', now),
    undefined,
    '超过 31 天（月窗上界）按坏数据丢弃',
  )
})

const harness = await bootstrapStore({ initialData: { providers: [], accounts: [] } })
const sm = harness.storeManager
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

sm.addProvider({
  id: 'qwr',
  name: 'Agent Plan',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Plan-Flash'],
  modelMappings: { 'Plan-Flash': 'qwr-upstream' },
  modelCapabilities: { 'Plan-Flash': { tier: 'balanced' } },
} as never)
sm.addAccount({
  id: 'qwr-acct1',
  providerId: 'qwr',
  name: 'plan key 1',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Plan-Flash'],
} as never)

// 池里必须另有一个热候选：`rankCandidates` 只在「还有热的」时才把冷却账号摘掉
// （冷却不清空池，AGENTS.md）。单账号夹具会让它被保留并直接派发，pinCooling 永不触发
// —— 现网那条路由有 14 个模型，所以才会报 `model_temporarily_unavailable`。
sm.addProvider({
  id: 'qwr2',
  name: 'Sibling',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Sibling-Mid'],
  modelMappings: { 'Sibling-Mid': 'qwr2-upstream' },
  modelCapabilities: { 'Sibling-Mid': { tier: 'balanced' } },
} as never)
sm.addAccount({
  id: 'qwr2-acct1',
  providerId: 'qwr2',
  name: 'sibling key',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Sibling-Mid'],
} as never)

const REQUEST = {
  model: 'auto',
  messages: [{ role: 'user', content: '继续' }],
} as ChatCompletionRequest

let routeCounter = 0
function pinnedRoute(): ModelRoute {
  const created = sm.createRoute({
    name: `qwr${routeCounter++}`,
    enabled: true,
    strategy: 'round-robin',
    prefer: 'fast',
    maxAttempts: 3,
    stickyMinutes: 30,
    modelScope: 'single',
    preferredModel: { providerId: 'qwr', displayName: 'Plan-Flash' },
  })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  return created.route as ModelRoute
}

const retrySeconds = (route: ModelRoute): number => {
  const decision = autoRouter.select(REQUEST, 'round-robin', undefined, route)
  assert.equal(decision.pinStale, undefined, '冷却不是失效：不许退役用户的钉')
  assert.deepEqual(decision.candidates, [], '钉是硬闸：零候选，不派别的模型顶上')
  assert.equal(decision.pinCooling?.displayName, 'Plan-Flash')
  return decision.pinCooling?.retryAfterSeconds ?? 0
}

/** 把时刻写成上游那种 `YYYY-MM-DD HH:MM:SS +0000` 形状（UTC，避免宿主时区影响）。 */
function upstreamStamp(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace('T', ' ')} +0000`
}

afterEach(() => {
  autoRouter.reset()
})
after(() => harness.dispose())

test('A 落库：上游写明 2h 后复位 ⇒ 客户端读到的 Retry-After 是 ~2h，不是 1h 档', () => {
  const route = pinnedRoute()
  const message =
    'You have exceeded the 5-hour usage quota. It will reset at ' +
    upstreamStamp(new Date(Date.now() + 2 * HOUR)) +
    ' CST. We recommend upgrading your plan for more quota, or waiting for the reset.'
  autoRouter.markAccountCooldown('qwr-acct1', 429, 'qwr-upstream', { message })

  const retry = retrySeconds(route)
  assert.ok(retry > 1.5 * 3600 && retry <= 2 * 3600, `应报 ~7200s（复位时刻），实际 ${retry}s`)
})

test('B 对照：只有额度文案、没有复位时刻 ⇒ 1 小时档（旧判据在这一格只给 60s）', () => {
  const route = pinnedRoute()
  autoRouter.markAccountCooldown('qwr-acct1', 429, 'qwr-upstream', {
    message: 'You have exceeded the 5-hour usage quota.',
  })

  const retry = retrySeconds(route)
  assert.ok(retry > 3500 && retry <= 3600, `应报 ~3600s（额度窗档），实际 ${retry}s`)
})

test('C 对照：裸 429 限流仍是分钟级，不被升成小时级', () => {
  const route = pinnedRoute()
  autoRouter.markAccountCooldown('qwr-acct1', 429, 'qwr-upstream', {
    message: 'rate limit exceeded, slow down',
  })

  const retry = retrySeconds(route)
  assert.ok(retry > 50 && retry <= 60, `应报 ~60s（指数退避首档），实际 ${retry}s`)
})

test('D 复位时刻与 Retry-After 取更晚者：上游头更晚时以头为准', () => {
  const route = pinnedRoute()
  autoRouter.markAccountCooldown('qwr-acct1', 429, 'qwr-upstream', {
    message:
      'You have exceeded the 5-hour usage quota. It will reset at ' +
      upstreamStamp(new Date(Date.now() + 2 * HOUR)) +
      ' CST.',
    retryAfterMs: 4 * HOUR,
  })

  const retry = retrySeconds(route)
  assert.ok(retry > 3.5 * 3600 && retry <= 4 * 3600, `应报 ~14400s（Retry-After 更晚），实际 ${retry}s`)
})

test('E 事实压过估计：复位在 45 分钟后 ⇒ 报 ~2700s，不被 1h 档抬到 3600s', () => {
  const route = pinnedRoute()
  autoRouter.markAccountCooldown('qwr-acct1', 429, 'qwr-upstream', {
    message:
      'You have exceeded the 5-hour usage quota. It will reset at ' +
      upstreamStamp(new Date(Date.now() + 45 * 60 * 1000)) +
      ' CST.',
  })

  const retry = retrySeconds(route)
  assert.ok(retry > 2600 && retry <= 2700, `应报 ~2700s（上游写明的复位时刻），实际 ${retry}s`)
  // 2026-11-15 现网：真实复位 09:56Z，旧修法把 1h 估计档与事实取更晚者 ⇒ 睡到 10:11Z，
  // 客户端白等 15 分钟。终局档只在没有事实时刻时兜底（对照 B）。
  assert.ok(retry < 3500, '1 小时终局档是估计值，不得压过上游写明的事实时刻')
})