/**
 * 渠道页账号行的限流徽章投影（2026-11-16 WorkBuddy 四号免费额度全打满的呈现缺口）。
 *
 * 证明两件事：
 * 1. `channels:list` 把 worker 账号条目上仍在期的 `modelRateLimits` 原样投影成
 *    `rateLimits`（上游声明的解禁时刻，事实口径）——不丢、不改值；
 * 2. 过期条目在投影层就被滤掉：worker 池的 sweep 有时差，面板不许画出已解禁的徽章。
 *
 * 替身只有 `bridgeOrThrow`（worker 内存 rpc）；`account.list` 返回的条目形状与
 * `account-pool.ts::listAccounts` 一致。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const harness = await bootstrapStore({ initialData: { providers: [], accounts: [] } })
const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')
const { markChannelRuntimeRunning } = await loadModule('main/providers/accountChannels/runtimeState.ts')
markChannelRuntimeRunning()

const NOW = Date.now()
const FUTURE = NOW + 6 * 60 * 60 * 1000
const PAST = NOW - 1_000

accountChannelManager.bridgeOrThrow = async () => ({
  models: async () => [],
  rpc: async (method: string, payload: { provider?: string }) => {
    if (method === 'account.list') {
      const limits = payload.provider === 'opencode'
        ? { 'hy4flash-free': FUTURE, 'expired-model': PAST }
        : {}
      return {
        ok: true,
        value: {
          accounts: [{
            id: `${payload.provider}-acct`,
            nickname: 'acct-1',
            enabled: true,
            refreshable: false,
            modelRateLimits: limits,
          }],
        },
      }
    }
    if (method === 'provider.status') {
      return { ok: true, value: { accounts: { total: 1, enabled: 1 }, models: { total: 1, disabled: 0 } } }
    }
    return { ok: true, value: {} }
  },
} as never)

after(() => harness.dispose())

test('channels:list 投影在期限流、滤掉过期条目', async () => {
  const views = await accountChannelManager.list()
  const opencode = views.find(view => view.id === 'opencode')
  assert.ok(opencode !== undefined, '渠道视图要包含账号渠道')
  const account = opencode.accounts.list[0]
  assert.ok(account !== undefined)
  assert.equal(account.rateLimits?.['hy4flash-free'], FUTURE, '在期条目原样投影（事实时刻）')
  assert.equal(account.rateLimits?.['expired-model'], undefined, '过期条目不投影（免得画出已解禁的徽章）')
})

test('空限流表不写 rateLimits 键（缺省 = 没有徽章，不渲染空对象）', async () => {
  // buddy 替身返回空 limits ⇒ 视图缺省该键。
  const views = await accountChannelManager.list()
  const buddy = views.find(view => view.id === 'buddy')
  assert.ok(buddy !== undefined)
  const buddyAccount = buddy.accounts.list[0]
  assert.ok(buddyAccount !== undefined)
  assert.equal(buddyAccount.rateLimits, undefined, '空表必须缺省，不投影空对象')
})
