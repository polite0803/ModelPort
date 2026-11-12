/**
 * 「上游亲口说没额度」这条证据的判据、落库与闸门行为门。
 *
 * 它证明四件事：
 * 1. 判据只认上游明确措辞：402 / 欠费 / 余额 / 额度用尽；限流（裸 429、rate limit、
 *    本地并发闸门）一律不标 —— 宁可漏标一次，也不让一次限流把整家渠道停半小时；
 * 2. 存活期是派生量：`until` 优先，否则 `asOf + TTL`；过期行既不算条数也不挡候选；
 * 3. 落库按 `(渠道, 账号, 模型)` 覆盖写、逐条目有上限、只在动作真的改变表时写盘；
 * 4. 闸门与展示读的是同一张表：命中则 `quotaBlockReason` 给 `quota-exhausted`，
 *    只挡这一个账号与这一个模型。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'
import {
  QUOTA_EXHAUSTION_MAX_ROWS,
  QUOTA_EXHAUSTION_TTL_MS,
  classifyQuotaExhaustion,
  exhaustionExpiresAt,
  exhaustionSummaries,
  findExhaustion,
  liveExhaustions,
  recordLive,
  removeExhaustion,
  truncateExhaustionMessage,
  upsertExhaustion,
  type AggregateQuotaExhaustionRecord,
} from '../../src/shared/aggregateQuotaExhaustion.ts'

// 闸门读真实时钟，所以基准时刻必须贴着真实"现在"；纯函数的断言都显式传 `NOW`，仍然确定。
const NOW = Date.now() - 1_000
const iso = (ms: number): string => new Date(ms).toISOString()

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
const marks = await loadModule('main/proxy/quota/exhaustionMarks.ts')
const manager = await loadModule('main/providers/aggregate/manager.ts')

const record = (patch: Partial<AggregateQuotaExhaustionRecord> = {}): AggregateQuotaExhaustionRecord => ({
  accountId: KEY_ID,
  accountName: 'test key',
  modelId: 'm-1',
  reason: 'quota-exhausted',
  status: 429,
  message: 'insufficient quota',
  asOf: iso(NOW),
  ...patch,
})

// ---------------------------------------------------------------------------
// 1. 判据
// ---------------------------------------------------------------------------

test('upstream wording that means "no quota" is classified, and the reason picks the user action', () => {
  assert.equal(
    classifyQuotaExhaustion({ status: 429, errorMessage: 'You exceeded your current quota' }),
    'quota-exhausted'
  )
  assert.equal(classifyQuotaExhaustion({ status: 429, errorMessage: 'billing daily count exceeded' }), 'quota-exhausted')
  assert.equal(classifyQuotaExhaustion({ status: 429, errorMessage: '套餐额度已用尽，请升级套餐' }), 'quota-exhausted')
  assert.equal(classifyQuotaExhaustion({ status: 403, errorMessage: '配额不足' }), 'quota-exhausted')

  // 402 协议层就是"要钱"，不必等文案。
  assert.equal(classifyQuotaExhaustion({ status: 402 }), 'balance-insufficient')
  assert.equal(classifyQuotaExhaustion({ status: 429, errorMessage: '账户余额不足' }), 'balance-insufficient')

  // 欠费最要人处理，同时出现时先说它。
  assert.equal(classifyQuotaExhaustion({ status: 403, errorMessage: '账户欠费，请处理' }), 'arrears')
  assert.equal(classifyQuotaExhaustion({ status: 403, errorMessage: 'account overdue payment' }), 'arrears')
})

test('rate limiting is never read as "no quota"', () => {
  assert.equal(classifyQuotaExhaustion({ status: 429 }), undefined, 'a bare 429 says nothing')
  assert.equal(classifyQuotaExhaustion({ status: 429, errorMessage: 'rate limit exceeded' }), undefined)
  assert.equal(classifyQuotaExhaustion({ status: 429, errorMessage: 'Too many requests, requests per minute' }), undefined)
  assert.equal(classifyQuotaExhaustion({ status: 429, errorMessage: '频率超限，请稍后再试' }), undefined)
  assert.equal(
    classifyQuotaExhaustion({ status: 429, errorMessage: 'daily quota exhausted; rate limit 60 rpm' }),
    'quota-exhausted',
    'a quota noun plus an exhaustion word wins over the rate-limit veto'
  )

  // 本地 AIMD 闸门拒的是我们自己门口的那一笔，不是上游说的话。
  assert.equal(
    classifyQuotaExhaustion({ status: 429, errorCode: 'local_concurrency_limit', errorMessage: 'Local per-model concurrency limit reached' }),
    undefined
  )
  assert.equal(classifyQuotaExhaustion({ status: 429, localAdmissionRejected: true, errorMessage: 'quota exceeded' }), undefined)
  assert.equal(classifyQuotaExhaustion({ status: 200, errorMessage: 'quota exceeded', outcome: 'success' }), undefined)
  assert.equal(classifyQuotaExhaustion({ status: 429, errorMessage: 'quota exceeded', outcome: 'client_abort' }), undefined)

  // 欠费落在 `capability` 这一档（`isAccountArrearsError`），必须照判。
  assert.equal(
    classifyQuotaExhaustion({ status: 403, errorMessage: '账号欠费', outcome: 'capability' }),
    'arrears'
  )

  // "quota" 出现但没有任何用尽语义：正常的能力说明，不得标。
  assert.equal(classifyQuotaExhaustion({ status: 400, errorMessage: 'quota: 1000 requests per day' }), undefined)
})

test('the message is flattened and truncated, never carrying credentials of its own', () => {
  assert.equal(truncateExhaustionMessage('a\n\nb\tc'), 'a b c')
  const long = 'x'.repeat(500)
  const cut = truncateExhaustionMessage(long)
  assert.equal(cut.length, 240)
  assert.ok(cut.endsWith('…'))
})

// ---------------------------------------------------------------------------
// 2. 存活期与折叠
// ---------------------------------------------------------------------------

test('expiry is derived: explicit until wins, otherwise asOf + TTL, and a broken timestamp falls back to the TTL', () => {
  assert.equal(exhaustionExpiresAt(record()), NOW + QUOTA_EXHAUSTION_TTL_MS)
  assert.equal(exhaustionExpiresAt(record({ until: iso(NOW + 5 * 60_000) })), NOW + 5 * 60_000)
  assert.equal(exhaustionExpiresAt(record({ until: 'not-a-date' })), NOW + QUOTA_EXHAUSTION_TTL_MS)
  assert.equal(recordLive(record(), NOW + QUOTA_EXHAUSTION_TTL_MS - 1), true)
  assert.equal(recordLive(record(), NOW + QUOTA_EXHAUSTION_TTL_MS), false)
  assert.equal(recordLive(record({ asOf: 'garbage' }), NOW), false, 'a row that cannot be dated is never live')
})

test('the same (account, model) is overwritten, expired rows are dropped, and one entry keeps at most 50 rows', () => {
  const first = record({ message: 'old' })
  const second = record({ message: 'new', asOf: iso(NOW + 60_000) })
  const kept = upsertExhaustion([first], second, NOW + 60_000)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].message, 'new', 'the newer refusal replaces the older one for the same pair')

  const stale = record({ asOf: iso(NOW - QUOTA_EXHAUSTION_TTL_MS - 1) })
  assert.deepEqual(liveExhaustions([stale, first], NOW).map(r => r.message), ['old'])

  const many = Array.from({ length: QUOTA_EXHAUSTION_MAX_ROWS + 10 }, (_, index) =>
    record({ modelId: `m-${index}` })
  )
  assert.equal(upsertExhaustion(many, record({ modelId: 'fresh' }), NOW).length, QUOTA_EXHAUSTION_MAX_ROWS)
})

test('clearing touches exactly one (account, model) pair', () => {
  const rows = [record(), record({ modelId: 'm-2' }), record({ accountId: 'other' })]
  const left = removeExhaustion(rows, KEY_ID, 'm-1')
  assert.deepEqual(left.map(r => `${r.accountId}/${r.modelId}`), [`${KEY_ID}/m-2`, 'other/m-1'])
  assert.equal(findExhaustion(rows, KEY_ID, 'm-1', NOW)?.modelId, 'm-1')
  assert.equal(findExhaustion(rows, KEY_ID, 'm-404', NOW), undefined)
})

test('list summaries count only live rows and pick the newest by asOf', () => {
  const summaries = exhaustionSummaries(
    {
      open_router: [record({ asOf: iso(NOW - QUOTA_EXHAUSTION_TTL_MS - 1) }), record({ modelId: 'm-2', asOf: iso(NOW - 60_000) })],
      stale_only: [record({ asOf: iso(NOW - QUOTA_EXHAUSTION_TTL_MS - 1) })],
    },
    NOW
  )
  assert.deepEqual(Object.keys(summaries), ['open_router'])
  assert.equal(summaries.open_router.count, 1)
  assert.equal(summaries.open_router.latest.modelId, 'm-2')
  assert.deepEqual(exhaustionSummaries(undefined, NOW), {})
})

// ---------------------------------------------------------------------------
// 3. 落库 + 闸门（真 store）
// ---------------------------------------------------------------------------

const trace = (patch: Record<string, unknown>) => ({
  providerId: 'open_router',
  providerName: 'OpenRouter',
  accountId: KEY_ID,
  accountName: 'test key',
  model: 'm-gate',
  outcome: 'failover' as const,
  retryIndex: 0,
  ...patch,
})

test('a refused attempt lands on disk keyed by entry, and the gate skips exactly that (account, model)', () => {
  marks.applyQuotaExhaustions(
    [trace({ status: 429, errorMessage: 'You exceeded your current quota' })],
    undefined,
    NOW
  )

  const onDisk = harness.dataFile().aggregateQuotaExhaustions
  assert.deepEqual(Object.keys(onDisk), ['open_router'])
  assert.equal(onDisk.open_router.length, 1)
  assert.equal(onDisk.open_router[0].modelId, 'm-gate')
  assert.equal(onDisk.open_router[0].reason, 'quota-exhausted')
  assert.equal(onDisk.open_router[0].accountName, 'test key')
  assert.equal(onDisk.open_router[0].message, 'You exceeded your current quota')

  const ENTRY = { id: 'open_router', type: 'aggregate' }
  assert.equal(gate.quotaBlockReason(ENTRY, KEY_ID, 'm-gate'), 'quota-exhausted')
  assert.equal(gate.quotaBlockReason(ENTRY, KEY_ID, 'm-other'), undefined, 'another model is untouched')
  assert.equal(gate.quotaBlockReason(ENTRY, 'other-key', 'm-gate'), undefined, 'another key is untouched')
})

test('a rate-limit row and a local admission rejection never create a mark', () => {
  const before = harness.storeManager.getAggregateQuotaExhaustionsOf('open_router').length
  marks.applyQuotaExhaustions(
    [
      trace({ model: 'm-rate', status: 429, errorMessage: 'rate limit exceeded' }),
      trace({ model: 'm-local', status: 429, errorCode: 'local_concurrency_limit', errorMessage: 'Local per-model concurrency limit reached' }),
      trace({ model: 'm-ok', status: 200, outcome: 'success' }),
    ],
    undefined,
    NOW
  )
  const rows = harness.storeManager.getAggregateQuotaExhaustionsOf('open_router')
  assert.equal(rows.length, before, 'nothing new was recorded')
})

test('a success on the same (account, model) clears the mark, and the final Retry-After sets the unlock time', () => {
  marks.applyQuotaExhaustions(
    [trace({ status: 429, errorMessage: 'insufficient quota', errorCode: 'insufficient_quota' })],
    60_000,
    NOW
  )
  const [withUntil] = harness.storeManager.getAggregateQuotaExhaustionsOf('open_router')
  assert.equal(withUntil.until, iso(NOW + 60_000), 'the client-facing retry hint is the unlock time')

  marks.applyQuotaExhaustions([trace({ status: 200, outcome: 'success' })], undefined, NOW + 1_000)
  assert.deepEqual(
    harness.storeManager.getAggregateQuotaExhaustionsOf('open_router').filter(row => row.modelId === 'm-gate'),
    [],
    'the first successful call after a top-up clears the badge'
  )
  assert.equal(gate.quotaBlockReason({ id: 'open_router', type: 'aggregate' }, KEY_ID, 'm-gate'), undefined)
})

test('an expired mark stops blocking without anyone clearing it', () => {
  marks.applyQuotaExhaustions([trace({ status: 429, errorMessage: '配额不足' })], undefined, NOW)
  assert.equal(gate.quotaBlockReason({ id: 'open_router', type: 'aggregate' }, KEY_ID, 'm-gate', undefined), 'quota-exhausted')
  // 直接把时刻挪到 TTL 之外：闸门读的是记录自己的 asOf，不依赖任何定时器。
  harness.storeManager.recordAggregateQuotaExhaustion(
    'open_router',
    record({ modelId: 'm-gate', asOf: iso(Date.now() - QUOTA_EXHAUSTION_TTL_MS - 1) })
  )
  assert.equal(gate.quotaBlockReason({ id: 'open_router', type: 'aggregate' }, KEY_ID, 'm-gate'), undefined)
})

test('non-aggregate providers are never marked', () => {
  marks.applyQuotaExhaustions(
    [trace({ providerId: 'custom-anything', status: 403, errorMessage: 'insufficient quota' })],
    undefined,
    NOW
  )
  assert.equal(harness.storeManager.getAggregateQuotaExhaustions()['custom-anything'], undefined)
})

test('list folds live rows into count + latest, detail carries the rows, and the manual clear empties one entry only', () => {
  marks.applyQuotaExhaustions(
    [
      trace({ model: 'm-a', status: 403, errorMessage: '账户欠费' }),
      trace({ model: 'm-b', status: 429, errorMessage: 'quota exhausted' }),
    ],
    undefined,
    Date.now()
  )
  harness.storeManager.recordAggregateQuotaExhaustion(
    'siliconflow',
    record({ accountId: 'sf-acct', modelId: 'm-sf' })
  )

  const list = manager.aggregateProviderManager.list()
  assert.equal(list.quotaExhaustions.open_router.count, 2)
  assert.ok(list.quotaExhaustions.open_router.latest.modelId === 'm-a' || list.quotaExhaustions.open_router.latest.modelId === 'm-b')

  const detail = manager.aggregateProviderManager.detail('open_router')
  assert.ok(detail.quotaExhaustions.length >= 2)

  const cleared = manager.aggregateProviderManager.clearQuotaExhaustions('open_router')
  assert.equal(cleared.success, true)
  assert.equal(harness.storeManager.getAggregateQuotaExhaustions().open_router, undefined)
  assert.equal(harness.storeManager.getAggregateQuotaExhaustionsOf('siliconflow').length, 1, 'another entry survived')
})