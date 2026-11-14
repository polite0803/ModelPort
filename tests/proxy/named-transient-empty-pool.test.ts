/**
 * 具名模型空池的瞬时诊断（`loadBalancer.transientEmptyPoolSkips`）：与
 * `getAvailableAccounts` 同一套判据，只有空池完全由会自己复位的状态造成时才返回
 * 剔除清单。它是 chat/completions 把 503 翻成 429 + Retry-After 的唯一依据，
 * 所以这里钉的是「什么时候可以翻、什么时候不许翻」。
 *
 * 层：真 store（真落盘）+ 真 `loadBalancer`。HTTP 层的 429 投影见
 * `tests/routes/named-transient-empty-pool-http.test.ts`；auto 路径的同源判据见
 * `tests/proxy/transient-empty-pool.test.ts`。
 */
import { test, after } from 'node:test'
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
const AGG_ACCOUNT_2 = {
  id: 'open_router-acct-2',
  providerId: 'open_router',
  name: 'test key 2',
  credentials: { apiKey: 'sk-or-test-2' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}

const harness = await bootstrapStore({
  initialData: {
    providers: [CUSTOM_PROVIDER, AGG_PROVIDER],
    accounts: [CUSTOM_ACCOUNT, AGG_ACCOUNT, AGG_ACCOUNT_2],
  },
})
const sm = harness.storeManager
const { loadBalancer } = await loadModule('main/proxy/loadbalancer.ts')
const { summarizeTransientSkips } = await loadModule('main/proxy/autoRouter.ts')

after(() => harness.dispose())

test('额度耗尽标记挡住唯一账号：返回 quota-exhausted 剔除，Retry-After 取标记的 until', () => {
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
  // 第二把 Key 停用：池子里只剩被标记的那一个（停用账号与 auto 同口径，不算跳过）
  sm.updateAccount(AGG_ACCOUNT_2.id, { status: 'disabled' })

  assert.equal(loadBalancer.selectAccount('open_router/openrouter/free'), null, '选号与诊断必须同判据')
  const skips = loadBalancer.transientEmptyPoolSkips('open_router/openrouter/free')
  assert.ok(skips, '空池完全由额度标记造成时必须给出剔除清单')
  assert.equal(skips.length, 1)
  assert.equal(skips[0].reason, 'quota-exhausted')
  assert.equal(skips[0].accountId, AGG_ACCOUNT.id)
  assert.equal(skips[0].model, 'openrouter/free', '剔除按上游真实模型名记，不是 displayName')

  const summary = summarizeTransientSkips(skips, now)
  assert.equal(summary?.cause, 'quota')
  assert.equal(summary?.skipped, 1)
  const retryAfter = summary?.retryAfterSeconds ?? 0
  assert.ok(retryAfter > 280 && retryAfter <= 300, `Retry-After 应从 until 派生（5 分钟），实际 ${retryAfter}s`)
})

test('当日上限挡住唯一账号：返回 daily_limit 剔除；日期键挪到昨天即重新进池', () => {
  sm.updateProvider('open_router', { enabled: false })
  sm.updateProvider('daily', { enabled: true })
  sm.updateAccount(CUSTOM_ACCOUNT.id, {
    dailyLimit: 3,
    todayUsed: 3,
    todayUsedDay: localDayKey(Date.now()),
  })

  assert.equal(loadBalancer.selectAccount('Daily-A'), null)
  const skips = loadBalancer.transientEmptyPoolSkips('Daily-A')
  assert.ok(skips)
  assert.equal(skips.length, 1)
  assert.equal(skips[0].reason, 'daily_limit')
  assert.equal(skips[0].model, 'daily-a')
  const summary = summarizeTransientSkips(skips, Date.now())
  assert.equal(summary?.cause, 'daily_limit')
  const retryAfter = summary?.retryAfterSeconds ?? 0
  assert.ok(retryAfter >= 1 && retryAfter <= 86_400, `重试时刻是下一个本地午夜，实际 ${retryAfter}s`)

  // 负控：昨天的计数不算今天 —— 账号重新进池，诊断随之收回（不许再报 429）
  sm.updateAccount(CUSTOM_ACCOUNT.id, { todayUsedDay: '2000-01-01' })
  assert.ok(loadBalancer.selectAccount('Daily-A'), '日期键对不上即读作 0，账号重新进池')
  assert.equal(loadBalancer.transientEmptyPoolSkips('Daily-A'), undefined)
})

test('永久成因不许翻 429：账号停用、模型不存在都返回 undefined', () => {
  sm.updateProvider('daily', { enabled: true })
  sm.updateAccount(CUSTOM_ACCOUNT.id, { status: 'disabled' })
  assert.equal(loadBalancer.selectAccount('Daily-A'), null)
  assert.equal(
    loadBalancer.transientEmptyPoolSkips('Daily-A'),
    undefined,
    '停用不是会自己复位的状态 —— 保持 503'
  )

  assert.equal(loadBalancer.transientEmptyPoolSkips('No-Such-Model'), undefined, '没有供应商服务这个名字')
})

test('失败冷却掺进来就不算纯瞬时：excludeFailed 时返回 undefined，不排除时仍报额度', () => {
  sm.updateProvider('open_router', { enabled: true })
  sm.updateAccount(AGG_ACCOUNT_2.id, { status: 'active' })
  // 两把 Key 都被额度标记（第一把沿用第一个测试的记录）；第二把再进失败冷却
  sm.recordAggregateQuotaExhaustion('open_router', {
    accountId: AGG_ACCOUNT_2.id,
    modelId: 'openrouter/free',
    reason: 'quota-exhausted',
    message: 'quota exceeded for this key too',
    asOf: new Date().toISOString(),
  })
  for (let i = 0; i < 3; i++) loadBalancer.markAccountFailed(AGG_ACCOUNT_2.id)

  assert.equal(loadBalancer.selectAccount('open_router/openrouter/free', 'failover'), null)
  assert.equal(
    loadBalancer.transientEmptyPoolSkips('open_router/openrouter/free', undefined, true),
    undefined,
    '冷却 + 额度混合：空池不纯由瞬时状态造成，保持 503'
  )
  assert.equal(loadBalancer.selectAccount('open_router/openrouter/free'), null)
  const skips = loadBalancer.transientEmptyPoolSkips('open_router/openrouter/free', undefined, false)
  assert.ok(skips, '不排冷却时（非 failover 策略）冷却不参与判据，只剩额度剔除')
  assert.equal(skips.length, 2)
  assert.ok(skips.every(skip => skip.reason === 'quota-exhausted'))
  loadBalancer.clearAccountFailure(AGG_ACCOUNT_2.id)
})