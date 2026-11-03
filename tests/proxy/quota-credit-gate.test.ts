/**
 * 实时余额进入选号排序的那道闸门（`proxy/quota/gate.ts`）的行为门。
 *
 * 用真 store + 真账本（`tests/routes/harness.mjs`），因为要证的是"排序时读到的那一句
 * 到底变了没有"，读源码文本证不了这件事。
 *
 * 钉的三件事：
 * 1. fresh + 每一把都没钱 → `aggregateHeadroom` 给 `-1`（既有语义里的"已超，排最后"），
 *    `quotaBlockReason` 给 `no-credit`；
 * 2. 同一行只是把 `asOf` 挪到 16 分钟前 → 两个函数**都退回既有的 token 计算**
 *    （TTL 的两侧都钉，否则改常量改不动）；
 * 3. 无快照 / 无上限 / 问得不全 → 与改动前逐值相同：这条是把"绝不把美元折进 token 比例"
 *    变成可执行的比较，期望值由账本 + 官方帽就地重算，不是抄一份实现常量。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const KEY_ID = 'open_router-acct-1'
const PROVIDER = {
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
const ACCOUNT = {
  id: KEY_ID,
  providerId: 'open_router',
  name: 'test key',
  credentials: { apiKey: 'sk-or-test' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}

const harness = await bootstrapStore({
  initialData: { providers: [PROVIDER], accounts: [ACCOUNT] },
})
after(() => harness.dispose())

const gate = await loadModule('main/proxy/quota/gate.ts')
const limits = await loadModule('main/proxy/quota/limits.ts')

const ENTRY = { id: 'open_router', type: 'aggregate' }
const minuteUsage = (modelId: string, requests: number) => {
  const ledger = harness.storeManager.getQuotaLedger()
  for (let i = 0; i < requests; i += 1) {
    ledger.record('open_router', KEY_ID, modelId, { promptTokens: 1, completionTokens: 1, totalTokens: 2 })
  }
}

/**
 * 改动前的那句计算，就地重算一遍当期望值：官方帽 + 实测帽 + 账本快照 → `1 - worst`
 * （打满给 -1，无帽给 0.5）。这条断言的价值在于"没有余额证据时，新代码必须逐值等于它"。
 */
function legacyHeadroom(modelId: string): number {
  const ledger = harness.storeManager.getQuotaLedger()
  const caps = limits.resolveCaps('open_router', modelId, ledger.learnedFor('open_router'))
  if (!caps.enforceable) return 0.5
  let worst = 0
  for (const account of harness.storeManager.getAccountsByProviderId('open_router')) {
    const usage = ledger.snapshot('open_router', account.id, modelId)
    for (const [metric, limit] of Object.entries(caps.limits)) {
      const value = usage[metric as keyof typeof usage]
      if ((limit as number) > 0 && typeof value === 'number') worst = Math.max(worst, value / (limit as number))
    }
  }
  return worst >= 1 ? -1 : 1 - worst
}

const exhaustedRow = (asOfMs: number) => ({
  asOf: new Date(asOfMs).toISOString(),
  unit: 'USD' as const,
  unlimited: false,
  remaining: 0,
  ok: true,
  accounts: 1,
  skipped: 0,
})

test('a fresh "no credit left" row pushes the entry to the exhausted slot and blocks its accounts', () => {
  minuteUsage('m-gate', 10)
  // 先确认基线：半满的账本给 0.5，账号不被任何理由挡下。
  assert.equal(gate.aggregateHeadroom('open_router', 'm-gate'), 0.5)
  assert.equal(legacyHeadroom('m-gate'), 0.5)
  assert.equal(gate.quotaBlockReason(ENTRY, KEY_ID, 'm-gate'), undefined)

  harness.storeManager.setAggregateCreditSnapshot('open_router', exhaustedRow(Date.now()))

  assert.equal(gate.aggregateHeadroom('open_router', 'm-gate'), -1, '-1 is the pre-existing "already over, sort last" slot')
  assert.equal(gate.quotaBlockReason(ENTRY, KEY_ID, 'm-gate'), 'no-credit')
  assert.notEqual(
    gate.aggregateHeadroom('open_router', 'm-gate'),
    legacyHeadroom('m-gate'),
    'the credit row must actually change the ordering, not just be displayed'
  )
})

test('the same row 16 minutes old stops being ordering evidence on both functions', () => {
  // 上一条留下的那行，只把时刻挪旧。
  harness.storeManager.setAggregateCreditSnapshot('open_router', exhaustedRow(Date.now() - 16 * 60_000))
  assert.equal(gate.aggregateHeadroom('open_router', 'm-gate'), 0.5, 'back to the token math exactly')
  assert.equal(gate.aggregateHeadroom('open_router', 'm-gate'), legacyHeadroom('m-gate'))
  assert.equal(gate.quotaBlockReason(ENTRY, KEY_ID, 'm-gate'), undefined, 'a stale row unblocks the account')
})

test('an unlimited row and a half-answered row never take part in ordering', () => {
  minuteUsage('m-unlimited', 10)
  const baseline = legacyHeadroom('m-unlimited')

  harness.storeManager.setAggregateCreditSnapshot('open_router', {
    asOf: new Date().toISOString(),
    unit: 'USD',
    unlimited: true,
    ok: true,
    accounts: 1,
    skipped: 0,
  })
  assert.equal(gate.aggregateHeadroom('open_router', 'm-unlimited'), baseline)
  assert.equal(gate.quotaBlockReason(ENTRY, KEY_ID, 'm-unlimited'), undefined)

  // 问得不全（ok:false）时闸门不成立：条目级 -1 会挡下这家所有账号，证据不齐时不能挡。
  harness.storeManager.setAggregateCreditSnapshot('open_router', {
    asOf: new Date().toISOString(),
    unit: 'USD',
    unlimited: false,
    ok: false,
    reason: 'network',
    accounts: 2,
    skipped: 0,
  })
  assert.equal(gate.aggregateHeadroom('open_router', 'm-unlimited'), baseline)
  assert.equal(gate.quotaBlockReason(ENTRY, KEY_ID, 'm-unlimited'), undefined)
})

test('with no row at all the gate is exactly what it was before this feature', () => {
  harness.storeManager.deleteAggregateCreditSnapshot('open_router')
  assert.equal(harness.storeManager.getAggregateCreditSnapshot('open_router'), undefined)

  minuteUsage('m-clean', 0)
  assert.equal(gate.aggregateHeadroom('open_router', 'm-clean'), 1)
  assert.equal(gate.aggregateHeadroom('open_router', 'm-clean'), legacyHeadroom('m-clean'))
  assert.equal(gate.quotaBlockReason(ENTRY, KEY_ID, 'm-clean'), undefined)

  // 窗口打满那条老路仍然照原样产出它自己的 reason（而不是被新枚举吃掉）。
  minuteUsage('m-full', 60)
  assert.equal(gate.aggregateHeadroom('open_router', 'm-full'), -1)
  assert.equal(gate.aggregateHeadroom('open_router', 'm-full'), legacyHeadroom('m-full'))
  assert.equal(gate.quotaBlockReason(ENTRY, KEY_ID, 'm-full'), 'rpd_exhausted')

  // 半满：逐值相同，包括那个小数。
  assert.equal(gate.aggregateHeadroom('open_router', 'm-gate'), legacyHeadroom('m-gate'))
  assert.ok(!Number.isNaN(gate.aggregateHeadroom('open_router', 'm-gate')))
})

test('the row lands in electron-store as one line per entry, with its own asOf', () => {
  const asOfMs = Date.parse('2026-11-01T00:00:00.000Z')
  harness.storeManager.setAggregateCreditSnapshot('open_router', exhaustedRow(asOfMs))

  const onDisk = harness.dataFile().aggregateCreditSnapshots
  assert.deepEqual(Object.keys(onDisk), ['open_router'], 'one entry one row, keyed by catalogue id')
  assert.equal(onDisk.open_router.asOf, new Date(asOfMs).toISOString())
  assert.equal(onDisk.open_router.remaining, 0)
  assert.equal(onDisk.open_router.ok, true)

  // 换一家只动那一行，别家原样保留（一个条目一行，不是整表覆盖）。
  harness.storeManager.setAggregateCreditSnapshot('siliconflow', {
    asOf: new Date().toISOString(),
    unit: 'CNY',
    unlimited: false,
    remaining: 8,
    ok: true,
    accounts: 1,
    skipped: 0,
  })
  const after = harness.dataFile().aggregateCreditSnapshots
  assert.equal(after.open_router.asOf, new Date(asOfMs).toISOString(), 'the other row survived')
  assert.equal(after.siliconflow.unit, 'CNY')
  assert.equal(after.siliconflow.remaining, 8, 'CNY stays CNY: nothing was folded into a token ratio')

  harness.storeManager.deleteAggregateCreditSnapshot('open_router')
  assert.equal(harness.dataFile().aggregateCreditSnapshots.open_router, undefined)
})
