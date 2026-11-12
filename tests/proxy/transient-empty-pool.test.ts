/**
 * 瞬时空池的判据：候选全被**会自己复位**的状态挡掉时，决策必须写明「等一会儿会
 * 回来」，而不是把这条路由报成「没有模型」。
 *
 * 层：真 store（真落盘）+ 真 `autoRouter.select()`。HTTP 层的 429 投影见
 * `tests/routes/transient-empty-pool-http.test.ts`。
 *
 * 两类瞬时原因各一例，外加一条负控：把日期键挪到昨天，同一个账号必须重新进池 ——
 * 那条负控钉的是 `todayUsed` 按日派生，而不是只钉「有个字段叫 retryAfterSeconds」。
 */
import { test, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'
import { localDayKey } from '../../src/shared/localDay.ts'

const CUSTOM_PROVIDER = {
  id: 'daily',
  name: 'Daily Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Daily-A'],
  modelMappings: { 'Daily-A': 'daily-a' },
}
const CUSTOM_ACCOUNT = {
  id: 'daily-acct',
  providerId: 'daily',
  name: 'daily account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}
const AGG_PROVIDER = {
  id: 'open_router',
  name: 'OpenRouter',
  type: 'aggregate',
  authType: 'token',
  apiEndpoint: 'https://openrouter.invalid/api/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['open_router/openrouter/free'],
  modelMappings: { 'open_router/openrouter/free': 'openrouter/free' },
}
const AGG_ACCOUNT = {
  id: 'open_router-acct-1',
  providerId: 'open_router',
  name: 'test key',
  credentials: { apiKey: 'sk-or-test' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}

const harness = await bootstrapStore({
  initialData: {
    providers: [CUSTOM_PROVIDER, AGG_PROVIDER],
    accounts: [CUSTOM_ACCOUNT, AGG_ACCOUNT],
  },
})
const sm = harness.storeManager
const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

afterEach(() => {
  autoRouter.reset()
})
after(() => harness.dispose())

const request = { model: 'auto', messages: [{ role: 'user', content: 'ping' }] }

test('额度耗尽标记挡住全部候选：transientUnavailable(quota)，Retry-After 取标记的 until', () => {
  sm.updateProvider('daily', { enabled: false })
  const now = Date.now()
  sm.recordAggregateQuotaExhaustion('open_router', {
    accountId: AGG_ACCOUNT.id,
    modelId: 'openrouter/free',
    reason: 'quota-exhausted',
    message: 'quota exceeded for this key',
    asOf: new Date(now).toISOString(),
    until: new Date(now + 5 * 60_000).toISOString(),
  })

  const decision = autoRouter.select(request)

  assert.equal(decision.candidates.length, 0, '全部候选都被额度标记挡住')
  assert.equal(decision.missing.length, 0, '空池不是能力不符 —— 不许借 missing 解释')
  assert.ok(
    decision.skipped.some(marker => String(marker).endsWith(':quota-exhausted')),
    '剔除原因仍然进 skipped（X-ModelPort-Auto-Skipped 的诊断面不变）',
  )
  assert.equal(decision.transientUnavailable?.cause, 'quota')
  assert.equal(decision.transientUnavailable?.skipped, 1)
  const retryAfter = decision.transientUnavailable?.retryAfterSeconds ?? 0
  assert.ok(retryAfter > 280 && retryAfter <= 300, `Retry-After 应从 until 派生（5 分钟），实际 ${retryAfter}s`)
})

test('当日上限挡住全部候选：transientUnavailable(daily_limit)，日期键挪到昨天即重新进池', () => {
  sm.updateProvider('open_router', { enabled: false })
  sm.updateProvider('daily', { enabled: true })
  sm.updateAccount(CUSTOM_ACCOUNT.id, {
    dailyLimit: 3,
    todayUsed: 3,
    todayUsedDay: localDayKey(Date.now()),
  })

  const blocked = autoRouter.select(request)
  assert.equal(blocked.candidates.length, 0)
  assert.equal(blocked.transientUnavailable?.cause, 'daily_limit')
  const retryAfter = blocked.transientUnavailable?.retryAfterSeconds ?? 0
  assert.ok(retryAfter >= 1 && retryAfter <= 86_400, `重试时刻是下一个本地午夜，实际 ${retryAfter}s`)

  // 负控：昨天的计数不算今天 —— 复位是派生量，不靠任何定时任务
  sm.updateAccount(CUSTOM_ACCOUNT.id, { todayUsedDay: '2000-01-01' })
  const reopened = autoRouter.select(request)
  assert.equal(reopened.candidates.length, 1, '日期键对不上即读作 0，账号重新进池')
  assert.equal(reopened.candidates[0].displayName, 'Daily-A')
  assert.equal(reopened.transientUnavailable, undefined)
})