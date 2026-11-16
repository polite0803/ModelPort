/**
 * 第五层额度证据：**用户自己声明的窗口**（`shared/declaredQuota.ts`）真的会挡发车。
 *
 * 用真 store + 真账本（`tests/routes/harness.mjs`），因为要证的是三件只能靠行为看出的事：
 *
 * 1. 声明**不只对聚合目录的家成立**。官方帽只对 aggregate 有旁表，用户声明跟着账号走
 *    —— 在一个 `builtin` 账号上写「每天 200 次」，`quotaBlockDetail` 就该按它拒。
 * 2. 判据与读数必须是**同一个窗口**。日窗口打满时给出的复位时刻必须来自日窗口，
 *    不是周/月窗口的（差了就是几个小时到几天的谎）。
 * 3. 没声明 = **不读账本、不挡**（热路径上一个字节都不多花），声明归一化后再判
 *    （重复条目取更小的上限）。
 *
 * 账本窗口的时刻口径单列一组：滚动窗口（5 小时 / 日）扫分钟桶、自然周扫日桶、
 * 自然月读月度桶 —— 如果周窗口在第二天就读成 0，「每周 N 次」会变成「每天 N 次」。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'
import { QuotaLedger } from '../../src/main/proxy/quota/ledger.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const T0 = Date.UTC(2026, 10, 16, 12, 0, 0) // 2026-11-16 12:00 UTC，周一
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const AGGREGATE_PROVIDER = {
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
const AGGREGATE_ACCOUNT = {
  id: 'or-declared',
  providerId: 'open_router',
  name: 'declared key',
  credentials: { apiKey: 'sk-or-declared' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
  declaredQuota: [{ window: 'day', unit: 'requests', limit: 3 }],
}

// 一个 builtin 家：官方帽的旁表不存在，只有用户声明这一层能挡它。
const BUILTIN_PROVIDER = {
  id: 'groq',
  name: 'Groq',
  type: 'builtin',
  authType: 'token',
  apiEndpoint: 'https://groq.invalid/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['llama-declared'],
  modelMappings: { 'llama-declared': 'llama-3.3-70b' },
}
const BUILTIN_ACCOUNT = {
  id: 'groq-declared',
  providerId: 'groq',
  name: 'builtin key with a declared window',
  credentials: { apiKey: 'gsk-declared' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
  declaredQuota: [{ window: 'fiveHour', unit: 'requests', limit: 2 }],
}

const harness = await bootstrapStore({
  initialData: {
    providers: [AGGREGATE_PROVIDER, BUILTIN_PROVIDER],
    accounts: [AGGREGATE_ACCOUNT, BUILTIN_ACCOUNT],
  },
})
after(() => harness.dispose())

const gate = await loadModule('main/proxy/quota/gate.ts')
const sm = harness.storeManager

function spend(providerId: string, accountId: string, modelId: string, requests: number, atMs: number): void {
  const ledger = sm.getQuotaLedger()
  for (let i = 0; i < requests; i += 1) {
    ledger.record(providerId, accountId, modelId, { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, atMs)
  }
}

// —— 环 1：声明跟着账号走，任何 provider 类型都成立。
test('a declared window blocks a builtin account, which has no official cap table at all', () => {
  const provider = { id: 'groq', type: 'builtin' }
  // 没有官方帽可读（builtin 没有旁表）—— 挡它的只能是那句声明。
  assert.equal(gate.quotaBlockDetail(provider, 'groq-declared', 'llama-3.3-70b', undefined, T0), undefined,
    'nothing spent yet, so the declaration is not triggered')

  spend('groq', 'groq-declared', 'llama-3.3-70b', 2, T0)
  const blocked = gate.quotaBlockDetail(provider, 'groq-declared', 'llama-3.3-70b', undefined, T0 + MINUTE)
  assert.equal(blocked?.reason, 'declared-exhausted',
    'the user wrote "2 per 5 hours", so the third request must not be dispatched')
  assert.equal(blocked?.untilSource, 'estimated', 'a rolling window reset is our estimate, never an upstream fact')
  assert.equal(blocked?.until, T0 + 5 * HOUR,
    'the reset comes from the oldest usage sliding out of the five-hour window')

  // 窗口滑出之后自动松口：没有清理动作，判据跟着账本走。
  assert.equal(
    gate.quotaBlockDetail(provider, 'groq-declared', 'llama-3.3-70b', undefined, T0 + 5 * HOUR + MINUTE),
    undefined,
    'the same declaration lets the request through once the window has slid past',
  )
})

test('a declaration on an aggregate account is judged alongside the official caps', () => {
  const provider = { id: 'open_router', type: 'aggregate' }
  spend('open_router', 'or-declared', 'openrouter/free', 3, T0)
  const blocked = gate.quotaBlockDetail(provider, 'or-declared', 'openrouter/free', undefined, T0 + MINUTE)
  assert.ok(blocked !== undefined, 'three requests against a declared ceiling of three must refuse')
  // 官方帽（RPM 20）此刻没满，所以被挡住的原因只能是声明，不能是别的。
  assert.equal(blocked?.reason, 'declared-exhausted')
})

test('the reset instant belongs to the window that decided the refusal', () => {
  // 月窗口打满 → 复位时刻是下个 UTC 自然月起点（`local`，我们自己的记账边界），
  // 不是日窗口的滚动估算。
  const provider = { id: 'groq', type: 'builtin' }
  const accountId = 'groq-monthly'
  sm.addAccount({
    id: accountId,
    providerId: 'groq',
    name: 'monthly declared',
    credentials: { apiKey: 'gsk-monthly' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    declaredQuota: [{ window: 'month', unit: 'tokens', limit: 10 }],
  } as never)

  spend('groq', accountId, 'llama-3.3-70b', 5, T0) // 每次 2 token → 10，刚好打满
  const blocked = gate.quotaBlockDetail(provider, accountId, 'llama-3.3-70b', undefined, T0 + MINUTE)
  assert.equal(blocked?.reason, 'declared-exhausted')
  assert.equal(blocked?.untilSource, 'local', 'a UTC calendar boundary is our own rule, not an upstream statement')
  assert.equal(blocked?.until, Date.UTC(2026, 11, 1), 'the next UTC month start')
})

test('a week-declared window reads the day buckets from the UTC week start', () => {
  const provider = { id: 'groq', type: 'builtin' }
  const accountId = 'groq-weekly'
  sm.addAccount({
    id: accountId,
    providerId: 'groq',
    name: 'weekly declared',
    credentials: { apiKey: 'gsk-weekly' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    declaredQuota: [{ window: 'week', unit: 'requests', limit: 4 }],
  } as never)

  // 周一 3 次 + 周二 1 次：周窗口必须把两天加起来（4/4 打满），而不是只看今天。
  spend('groq', accountId, 'llama-3.3-70b', 3, T0)
  spend('groq', accountId, 'llama-3.3-70b', 1, T0 + DAY)
  const blocked = gate.quotaBlockDetail(provider, accountId, 'llama-3.3-70b', undefined, T0 + DAY + HOUR)
  assert.equal(blocked?.reason, 'declared-exhausted', 'the week window sums the whole week, not one day')
  assert.equal(blocked?.untilSource, 'local')
  assert.equal(blocked?.until, Date.UTC(2026, 10, 23), 'next Monday 00:00 UTC')

  // 下周一之后，同一份用量不再计入这个窗口。
  assert.equal(
    gate.quotaBlockDetail(provider, accountId, 'llama-3.3-70b', undefined, Date.UTC(2026, 10, 23, 0, 30)),
    undefined,
    'a new UTC week starts with a clean window',
  )
})

test('no declaration means no refusal', () => {
  // 一个没有声明的账号 id：账本里同样的用量也不该被声明层挡 —— 没有数字就没有判据。
  assert.deepEqual(gate.declaredQuotaOf('nobody', 'groq'), [], 'an unknown account simply has no declaration')
  assert.equal(
    gate.quotaBlockDetail({ id: 'groq', type: 'builtin' }, 'nobody', 'llama-3.3-70b', undefined, T0),
    undefined,
    'a builtin provider with no official caps and no declaration has nothing to judge',
  )
})

test('duplicate declarations fold to the smaller ceiling before they are judged', () => {
  const provider = { id: 'groq', type: 'builtin' }
  const accountId = 'groq-dupes'
  sm.addAccount({
    id: accountId,
    providerId: 'groq',
    name: 'duplicate declarations',
    credentials: { apiKey: 'gsk-dupes' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    // 同一 (窗口, 单位) 两条：归一化取更小的那个（与实测帽同一套「只下调」口径）。
    declaredQuota: [
      { window: 'day', unit: 'requests', limit: 50 },
      { window: 'day', unit: 'requests', limit: 4 },
    ],
  } as never)

  assert.deepEqual(gate.declaredQuotaOf(accountId, 'groq'), [{ window: 'day', unit: 'requests', limit: 4 }])
  spend('groq', accountId, 'llama-3.3-70b', 4, T0)
  assert.equal(
    gate.quotaBlockDetail(provider, accountId, 'llama-3.3-70b', undefined, T0 + MINUTE)?.reason,
    'declared-exhausted',
    'the smaller of the two ceilings is the one that runs',
  )
})

test('a declared token window counts tokens, and a request window counts requests', () => {
  const provider = { id: 'groq', type: 'builtin' }
  const accountId = 'groq-tokens'
  sm.addAccount({
    id: accountId,
    providerId: 'groq',
    name: 'token declared',
    credentials: { apiKey: 'gsk-tokens' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    declaredQuota: [{ window: 'day', unit: 'tokens', limit: 6 }],
  } as never)

  spend('groq', accountId, 'llama-3.3-70b', 2, T0) // 4 token，未到 6
  assert.equal(gate.quotaBlockDetail(provider, accountId, 'llama-3.3-70b', undefined, T0 + MINUTE), undefined)
  spend('groq', accountId, 'llama-3.3-70b', 1, T0 + MINUTE) // 6 token，打满
  assert.equal(
    gate.quotaBlockDetail(provider, accountId, 'llama-3.3-70b', undefined, T0 + 2 * MINUTE)?.reason,
    'declared-exhausted',
  )
})

// —— 环 2：账本窗口的时刻口径（纯账本层，不经 store）。
test('declared windows read the right bucket family and roll over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelport-declared-'))
  const ledger = new QuotaLedger(dir, () => T0)
  const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
  const add = (atMs: number) => ledger.record('groq', 'a1', 'llama', usage, atMs)

  add(T0)
  add(T0 + HOUR)

  assert.equal(ledger.declaredWindow('groq', 'a1', 'fiveHour', T0 + 2 * HOUR).requests, 2)
  assert.equal(ledger.declaredWindow('groq', 'a1', 'fiveHour', T0 + 2 * HOUR).tokens, 20)
  assert.equal(ledger.declaredWindow('groq', 'a1', 'fiveHour', T0 + 5 * HOUR + MINUTE).requests, 1,
    'the oldest record has slid out of the five-hour window')
  assert.equal(ledger.declaredWindow('groq', 'a1', 'fiveHour', T0 + 6 * HOUR + MINUTE).requests, 0)
  assert.equal(ledger.declaredWindow('groq', 'a1', 'day', T0 + 23 * HOUR).requests, 2)
  // 日窗口是 24 小时滚动：T0 那笔在 T0+24h 滑出。
  assert.equal(ledger.declaredWindow('groq', 'a1', 'day', T0 + 24 * HOUR + MINUTE).requests, 1)

  // 自然周：周一的两笔，在周二仍算同一周；跨到下周一时归零。
  assert.equal(ledger.declaredWindow('groq', 'a1', 'week', T0 + DAY).requests, 2)
  assert.equal(ledger.declaredWindow('groq', 'a1', 'week', Date.UTC(2026, 10, 23, 0, 30)).requests, 0)

  // 自然月：读月度桶。
  assert.equal(ledger.declaredWindow('groq', 'a1', 'month', T0 + 7 * DAY).requests, 2)
  assert.equal(ledger.declaredWindow('groq', 'a1', 'month', Date.UTC(2026, 11, 1, 0, 30)).requests, 0)
})

test('the declared reading is per account and per provider, never global', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelport-declared-scope-'))
  const ledger = new QuotaLedger(dir, () => T0)
  const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
  ledger.record('groq', 'a1', 'llama', usage, T0)
  ledger.record('groq', 'a2', 'llama', usage, T0)
  ledger.record('other', 'a1', 'llama', usage, T0)

  assert.equal(ledger.declaredWindow('groq', 'a1', 'day', T0 + MINUTE).requests, 1)
  assert.equal(ledger.declaredWindow('groq', 'a2', 'day', T0 + MINUTE).requests, 1)
  assert.equal(ledger.declaredWindow('other', 'a1', 'day', T0 + MINUTE).requests, 1)
})

test('a declared window sums every model of one account (the plan level is not per model)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelport-declared-models-'))
  const ledger = new QuotaLedger(dir, () => T0)
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
  ledger.record('groq', 'a1', 'llama', usage, T0)
  ledger.record('groq', 'a1', 'qwen', usage, T0)

  assert.equal(ledger.declaredWindow('groq', 'a1', 'day', T0 + MINUTE).requests, 2,
    'splitting the count per model would let one plan be spent once per model')
})

test('a declared window survives a reload (the day buckets are persisted)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelport-declared-persist-'))
  const ledger = new QuotaLedger(dir, () => T0)
  const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
  ledger.record('groq', 'a1', 'llama', usage, T0)
  ledger.flushSync()

  const reloaded = new QuotaLedger(dir, () => T0 + HOUR)
  assert.equal(reloaded.declaredWindow('groq', 'a1', 'week', T0 + DAY).requests, 1,
    'the week window is read from day buckets, which must be on disk')
  assert.equal(reloaded.declaredWindow('groq', 'a1', 'fiveHour', T0 + HOUR).requests, 1)
})