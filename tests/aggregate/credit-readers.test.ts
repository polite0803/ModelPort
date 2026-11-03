/**
 * 账号级额度**解析层**的纯函数门。
 *
 * 这一层是唯一能把"上游到底长什么样"钉住的地方：本轮没有真机报文，字段名来自
 * `docs/plan/PLAN-port-freellmapi-free-token.md` §1 的转录记录，所以形状对不上必须是
 * 一等状态（`unexpected-shape`），而不是挑一个看起来像的字段填上。
 *
 * 同时钉一条结构性的事：这个文件不发出网络请求、也不写盘 —— 网络在 manager 的抓取层，
 * 落盘在 store；解析函数被界面、测试、将来的批处理复用时必须处处无副作用。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildCreditSnapshot,
  creditUnitOfReader,
  parseQuotaProbe,
  readOpenRouterKey,
  readSiliconFlowUserInfo,
  summarizePayload,
} from '../../src/main/providers/aggregate/quotaProbe.ts'
import { creditSnapshotExhausted, creditSnapshotLive } from '../../src/shared/aggregateCredit.ts'
import { AGGREGATE_REGISTRY } from '../../src/main/providers/aggregate/registry.ts'

const OPENROUTER_DOC_SHAPE = { data: { limit: 50, limit_remaining: 12.5 } }
const SILICONFLOW_DOC_SHAPE = { data: { balance: 3.5 } }

test('the openrouter /key shape yields remaining, limit, unit and unlimited as documented', () => {
  const reading = readOpenRouterKey(OPENROUTER_DOC_SHAPE)
  assert.equal(reading.ok, true)
  if (!reading.ok) return
  assert.equal(reading.remaining, 12.5)
  assert.equal(reading.limit, 50)
  assert.equal(reading.unit, 'USD')
  assert.equal(reading.unlimited, false)
})

test('limit: null means "no cap" - never 0, never a balance, and never a gate', () => {
  const reading = readOpenRouterKey({ data: { limit: null, limit_remaining: 120 } })
  assert.equal(reading.ok, true)
  if (!reading.ok) return
  assert.equal(reading.unlimited, true, 'the docs use null for "no spending limit"')
  assert.equal(reading.remaining, undefined, 'a null cap makes limit_remaining "spent so far", not a balance')
  assert.equal(reading.limit, undefined)

  // 这条是整个功能的落点：无上限不得被读成"没钱"，也不得被读成"还有很多钱"。
  const snapshot = buildCreditSnapshot({
    asOf: new Date().toISOString(),
    unit: 'USD',
    rows: [{ keyId: 'k', keyName: 'k', maskedKey: 'sk-••••', reading }],
    accounts: 1,
    skipped: 0,
  })
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.unlimited, true)
  assert.equal(creditSnapshotExhausted(snapshot), false)
})

test('a response without the transcribed field names is reported as an unknown shape', () => {
  const noKeys = readOpenRouterKey({ data: { monthly_spend: 1 } })
  assert.deepEqual(
    { ok: noKeys.ok, reason: noKeys.ok ? undefined : noKeys.reason },
    { ok: false, reason: 'unexpected-shape' },
    'no fuzzy near-name substitution is allowed'
  )
  assert.equal(readOpenRouterKey({ limit: 50, limit_remaining: 1 }).ok, false, 'the numbers must sit under "data"')
  assert.equal(readOpenRouterKey('openrouter').reason, 'unexpected-shape')
  assert.equal(readOpenRouterKey({ data: { limit: 'unlimited', limit_remaining: 1 } }).reason, 'unexpected-shape')
})

test('the siliconflow /user/info balance is CNY and only the balance field is read', () => {
  const reading = readSiliconFlowUserInfo(SILICONFLOW_DOC_SHAPE)
  assert.equal(reading.ok, true)
  if (!reading.ok) return
  assert.equal(reading.remaining, 3.5)
  assert.equal(reading.unit, 'CNY')
  assert.equal(reading.unlimited, false)
  assert.equal(reading.limit, undefined, 'this endpoint publishes a balance, not a cap')

  // 同一字段的两种信封（嵌在 data 里 / 顶层）都认；数字写成字符串也认。
  const topLevel = readSiliconFlowUserInfo({ balance: '12.00' })
  assert.equal(topLevel.ok, true)
  if (!topLevel.ok) return
  assert.equal(topLevel.remaining, 12, 'a balance written as a decimal string is still that number')

  // 相邻名字一律不读：没有证据说 total_balance 就是同一条余额。
  const neighbours = readSiliconFlowUserInfo({ data: { total_balance: 9, recharge_amount: 9, gift_amount: 9 } })
  assert.equal(neighbours.ok, false, 'near-name guessing would turn an unverified field into a routing decision')
  assert.equal(neighbours.ok ? '' : neighbours.reason, 'unexpected-shape')
})

test('the dispatcher separates "did not answer JSON" from "answered JSON we do not know"', () => {
  assert.deepEqual(
    (() => { const r = parseQuotaProbe('openrouter-key', '{"data":{"limit":10,"limit_remaining":0}}'); return r.ok })(),
    true,
    'a JSON string body is parsed'
  )
  const html = parseQuotaProbe('openrouter-key', '<html><body>502 Bad Gateway</body></html>')
  assert.equal(html.ok, false)
  assert.equal(html.ok ? '' : html.reason, 'not-json')

  const unknownShape = parseQuotaProbe('siliconflow-user-info', { code: 0, data: { name: 'x' } })
  assert.equal(unknownShape.ok ? 'ok' : unknownShape.reason, 'unexpected-shape')
})

test('the raw summary is truncated and never carries the key', () => {
  const key = 'sk-or-v1-supersecret-value-1234567890'
  const ok = readOpenRouterKey({ data: { limit: 10, limit_remaining: 0, note: key, padding: 'x'.repeat(400) } }, [key])
  assert.equal(ok.ok, true, 'a real zero balance is a valid reading')
  if (!ok.ok) return
  assert.equal(ok.remaining, 0, 'zero stays zero - it is the one number the gate acts on')
  assert.ok(!ok.raw.includes(key), 'the summary reaching the UI and the log must be redacted')
  assert.ok(ok.raw.length <= 241, `summary stays short, got ${ok.raw.length}`)
  assert.match(summarizePayload({ a: key }, [key]), /•{4}/)
  assert.match(summarizePayload({ a: 'x'.repeat(500) }), /…$/, 'an oversized body is cut, not dumped')
})

test('one entry row folds several keys without ever inventing a shared budget', () => {
  const ok = (remaining: number) => ({
    ok: true as const,
    remaining,
    unit: 'USD' as const,
    unlimited: false,
    raw: '',
  })
  const rows = (readings: Array<ReturnType<typeof ok>>) =>
    readings.map((reading, index) => ({ keyId: `k${index}`, keyName: `k${index}`, maskedKey: `m${index}`, reading }))

  const allBroke = buildCreditSnapshot({
    asOf: '2026-11-01T00:00:00.000Z',
    unit: 'USD',
    rows: rows([ok(0), ok(0)]),
    accounts: 2,
    skipped: 0,
  })
  assert.equal(allBroke.ok, true)
  assert.equal(allBroke.remaining, 0, 'the best-funded key is still 0, so every key is out')
  assert.equal(creditSnapshotExhausted(allBroke, Date.parse('2026-11-01T00:10:00.000Z')), true)

  const oneHealthy = buildCreditSnapshot({
    asOf: '2026-11-01T00:00:00.000Z',
    unit: 'USD',
    rows: rows([ok(0), ok(4)]),
    accounts: 2,
    skipped: 0,
  })
  assert.equal(oneHealthy.remaining, 4, 'one key with credit must not let the entry look exhausted')
  assert.equal(creditSnapshotExhausted(oneHealthy, Date.parse('2026-11-01T00:10:00.000Z')), false)

  const partial = buildCreditSnapshot({
    asOf: '2026-11-01T00:00:00.000Z',
    unit: 'USD',
    rows: [...rows([ok(0)]), { keyId: 'bad', keyName: 'bad', maskedKey: 'b', reading: { ok: false, reason: 'not-json', detail: '' } as const }],
    accounts: 2,
    skipped: 0,
  })
  assert.equal(partial.ok, false, 'an unanswered key means the entry row is not evidence')
  assert.equal(partial.reason, 'not-json')
  assert.equal(creditSnapshotExhausted(partial, Date.parse('2026-11-01T00:10:00.000Z')), false)

  const skippedOnly = buildCreditSnapshot({ asOf: '2026-11-01T00:00:00.000Z', unit: 'USD', rows: [], accounts: 0, skipped: 3 })
  assert.equal(skippedOnly.ok, false, 'no rows at all is not "out of credit"')

  // 12 把 Key 只问成前 10 把：这一行不能拿去停用后两把没问过的账号。
  const partialCoverage = buildCreditSnapshot({
    asOf: '2026-11-01T00:00:00.000Z',
    unit: 'USD',
    rows: rows([ok(0), ok(0)]),
    accounts: 2,
    skipped: 10,
  })
  assert.equal(partialCoverage.ok, false, 'unqueried keys are "unknown", not "exhausted"')
  assert.equal(partialCoverage.reason, undefined, 'and the reason is not a parse failure either')
  assert.equal(creditSnapshotExhausted(partialCoverage, Date.parse('2026-11-01T00:05:00.000Z')), false)
})

test('a row is only ordering evidence while it is inside the 15 minute window', () => {
  const asOf = '2026-11-01T00:00:00.000Z'
  const snapshot = { asOf, unit: 'USD' as const, unlimited: false, remaining: 0, ok: true, accounts: 1, skipped: 0 }
  assert.equal(creditSnapshotLive(snapshot, Date.parse('2026-11-01T00:14:59.000Z')), true)
  assert.equal(creditSnapshotLive(snapshot, Date.parse('2026-11-01T00:15:01.000Z')), false)
  assert.equal(creditSnapshotExhausted(snapshot, Date.parse('2026-11-01T00:15:01.000Z')), false)
  assert.equal(creditSnapshotExhausted(snapshot, Date.parse('2025-10-31T23:59:00.000Z')), false, 'a future timestamp is not "just asked"')
  assert.equal(creditSnapshotExhausted(undefined), false, 'no row at all never blocks')
  assert.equal(creditUnitOfReader('openrouter-key'), 'USD')
  assert.equal(creditUnitOfReader('siliconflow-user-info'), 'CNY')
})

/**
 * 结构门：解析层不许出网、不许写盘、不许碰 store。
 * 这三条只能这样钉 —— 纯函数被调用时不产生副作用，靠"读了什么模块"证明比靠
 * 一次调用没抛异常证明得多。
 */
test('the parse layer imports no transport, no store and no filesystem', () => {
  const source = readFileSync('src/main/providers/aggregate/quotaProbe.ts', 'utf-8')
  const banned = ['axios', 'node:http', 'node:https', 'node:fs', 'electron', 'storeManager', 'fetch(', 'AccountManager']
  for (const needle of banned) {
    assert.ok(!source.includes(needle), `quotaProbe.ts must not reference ${needle}`)
  }
  // 每个 reader 都是同步返回，不是 Promise：调用方 await 不到任何东西，也就没有任何 I/O 藏在这里。
  for (const reading of [readOpenRouterKey(OPENROUTER_DOC_SHAPE), readSiliconFlowUserInfo(SILICONFLOW_DOC_SHAPE)]) {
    assert.equal(typeof reading.then, 'undefined', 'a reading must not be a promise')
  }
})

/**
 * 目录侧的声明：只有取证记录里真实存在的配额端点才配。
 * SiliconFlow 曾声明 `/user/info`（freellmapi 转录），但官方已于 2026-08-14 停止服务
 * （真机探测返回 HTTP 410 "This endpoint is deprecated"，官方公告见
 * https://docs.siliconflow.cn/cn/release-notes/overview），声明已撤下；
 * 替代端点"后续将适时提供"，上线前不许发明新端点。
 */
test('only entries with a recorded credit endpoint declare one', () => {
  const declared = AGGREGATE_REGISTRY.filter(entry => entry.quotaProbe !== undefined).map(entry => entry.id).sort()
  assert.deepEqual(declared, ['open_router'], 'no invented endpoints')

  const openRouter = AGGREGATE_REGISTRY.find(entry => entry.id === 'open_router')
  assert.equal(openRouter?.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(openRouter?.quotaProbe?.path, '/key', 'relative to the configured base, not a second absolute host')
  assert.equal(openRouter?.quotaProbe?.reader, 'openrouter-key')
  assert.equal(creditUnitOfReader(openRouter?.quotaProbe?.reader ?? 'openrouter-key'), 'USD')
  assert.ok(openRouter?.quotaProbe?.docUrl?.startsWith('https://'), 'the declaration carries its provenance')
  assert.match(openRouter?.quotaProbe?.asOf ?? '', /^\d{4}-\d{2}-\d{2}$/, 'and the date it was checked')

  // SiliconFlow 的声明撤下不是因为字段名猜错，而是官方把端点关了：
  // 任何 Key 都不会成功（410 是服务端对端点本身的拒绝），所以不配 quotaProbe 是唯一诚实的做法。
  const siliconFlow = AGGREGATE_REGISTRY.find(entry => entry.id === 'siliconflow')
  assert.equal(siliconFlow?.baseUrl, 'https://api.siliconflow.com/v1')
  assert.equal(siliconFlow?.quotaProbe, undefined, '/user/info was retired by the provider on 2026-08-14; no replacement yet')
  assert.equal(`${openRouter?.baseUrl ?? ''}${openRouter?.quotaProbe?.path ?? ''}`, 'https://openrouter.ai/api/v1/key')
})
