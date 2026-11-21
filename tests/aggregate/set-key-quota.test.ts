/**
 * 聚合详情页就地写声明额度（`aggregateProviderManager.setKeyQuota`）。
 *
 * 钉三件会被静默做错的事：
 * 1. **写入口只有 `AccountManager.update`** —— 声明额度落在 Account 上，与供应商页
 *    账号弹窗同一入口；另开一条凭据通路就会在「留空=不修改」上分叉。
 * 2. **空数组成 `undefined`** —— 用户清空全部声明是「不再限制」，不是留下一行 `[]`
 *    让下游多判一次（`AccountManager.update` 负责这条，这里钉住它真的生效）。
 * 3. **非聚合账号被拒** —— 这条通路由聚合详情页发起，给错 id 时报未知账号，
 *    绝不悄悄改掉别的供应商的账号。
 *
 * 同时钉住「改额度不碰 Key」：写完之后凭据必须逐字不变。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const KEY = 'sk-or-v1-quota-000000000000000000'

const handle = await bootstrapStore({
  initialData: {
    providers: [
      {
        id: 'open_router',
        name: 'OpenRouter',
        type: 'aggregate',
        authType: 'token',
        apiEndpoint: 'https://openrouter.ai/api/v1',
        chatPath: '/chat/completions',
        headers: {},
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        supportedModels: ['open_router/free'],
        modelMappings: { 'open_router/free': 'openrouter/free' },
      },
      {
        id: 'custom_thing',
        name: 'Custom',
        type: 'custom',
        authType: 'token',
        apiEndpoint: 'https://example.invalid/v1',
        headers: {},
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    accounts: [
      {
        id: 'acct-agg',
        providerId: 'open_router',
        name: 'agg key',
        credentials: { apiKey: KEY },
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'acct-custom',
        providerId: 'custom_thing',
        name: 'custom key',
        credentials: { token: 'not-a-plan-key' },
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  },
})

const { aggregateProviderManager } = await loadModule('main/providers/aggregate/manager.ts')
const { AccountManager } = await loadModule('main/store/accounts.ts')

test('setKeyQuota stores the normalized windows on the account', () => {
  const result = aggregateProviderManager.setKeyQuota('acct-agg', [
    { window: 'fiveHour', unit: 'requests', limit: 6000 },
    { window: 'week', unit: 'requests', limit: 45000 },
  ])
  assert.equal(result.success, true)
  const account = AccountManager.getById('acct-agg', false)
  assert.equal(account?.declaredQuota?.length, 2)
  // 详情里也能读到（聚合详情的 Key 行靠它渲染只读行）
  const keyRow = result.detail?.keys.find(key => key.id === 'acct-agg')
  assert.equal(keyRow?.declaredQuota?.length, 2)
})

test('changing the quota never touches the credential', () => {
  const before = AccountManager.getById('acct-agg', true)?.credentials.apiKey
  aggregateProviderManager.setKeyQuota('acct-agg', [{ window: 'day', unit: 'tokens', limit: 1000 }])
  const after = AccountManager.getById('acct-agg', true)?.credentials.apiKey
  assert.equal(after, before, 'the key is a different field; rewriting quota must not re-encrypt or drop it')
})

test('an empty list clears the field instead of leaving an empty array', () => {
  aggregateProviderManager.setKeyQuota('acct-agg', [])
  const account = AccountManager.getById('acct-agg', false)
  assert.equal(account?.declaredQuota, undefined, 'clearing everything means "no limit", not a zero-length declaration')
})

test('illegal windows are dropped rather than stored', () => {
  const result = aggregateProviderManager.setKeyQuota('acct-agg', [
    { window: 'fortnight', unit: 'requests', limit: 10 },
    { window: 'day', unit: 'requests', limit: -1 },
  ] as never)
  assert.equal(result.success, true)
  assert.equal(AccountManager.getById('acct-agg', false)?.declaredQuota, undefined)
})

test('a non-aggregate account is refused, and left untouched', () => {
  const result = aggregateProviderManager.setKeyQuota('acct-custom', [
    { window: 'day', unit: 'requests', limit: 7 },
  ])
  assert.equal(result.success, false)
  assert.equal(result.reason, 'not_configured')
  assert.equal(AccountManager.getById('acct-custom', false)?.declaredQuota, undefined)
})

test('an unknown account id is refused with its own reason', () => {
  const result = aggregateProviderManager.setKeyQuota('no-such-account', [])
  assert.equal(result.success, false)
  assert.equal(result.reason, 'unknown_account')
})

test('cleanup', () => {
  handle.cleanup?.()
})
