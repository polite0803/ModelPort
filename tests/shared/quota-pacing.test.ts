import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  nextRollingBoundary,
  nextUtcMonthStart,
  pickBestPace,
  pickSoonestReset,
  projectReset,
  type AccountQuotaFacts,
} from '../../src/shared/quotaPacing.ts'

const T0 = Date.UTC(2026, 9, 29, 12, 0, 0) // 2026-10-29T12:00:00Z

function facts(
  accountId: string,
  limit: AccountQuotaFacts['limit'],
  used: AccountQuotaFacts['used']
): AccountQuotaFacts {
  return { accountId, limit, used }
}

test('rolling boundaries snap to whole windows', () => {
  assert.equal(nextRollingBoundary(T0, 60_000), T0 + 60_000)
  assert.equal(nextRollingBoundary(T0 + 12_345, 60_000), T0 + 60_000, 'mid-window snaps to the same edge')
  assert.equal(nextRollingBoundary(T0, 24 * 3_600_000), Date.UTC(2026, 9, 30, 0, 0, 0))
})

test('the UTC month rolls over at the first of next month', () => {
  assert.equal(nextUtcMonthStart(T0), Date.UTC(2026, 10, 1, 0, 0, 0))
  // 月末最后一毫秒仍然指向下个月
  assert.equal(nextUtcMonthStart(Date.UTC(2026, 9, 31, 23, 59, 59, 999)), Date.UTC(2026, 10, 1, 0, 0, 0))
})

test('no enforceable cap means no projection at all', () => {
  // 推不出来就返回 undefined —— 绝不默认成"无限额度"或"立刻重置"
  assert.equal(projectReset(facts('a', {}, { rpm: 10, rpd: 99 }), T0), undefined)
  assert.equal(projectReset(facts('a', { rpm: 0 }, { rpm: 5 }), T0), undefined)
})

test('a full window wins over a healthy one and reports its own reset', () => {
  const projection = projectReset(
    facts('a', { rpm: 10, rpd: 1000 }, { rpm: 10, rpd: 5 }),
    T0
  )
  assert.ok(projection)
  assert.equal(projection!.metric, 'rpm')
  assert.equal(projection!.remaining, 0)
  assert.equal(projection!.resetAt, T0 + 60_000, 'the minute window is the one that frees this account first')
})

test('smart prefers the account that frees soonest, and pushes full ones back', () => {
  const now = T0
  const soon = facts('soon', { rpm: 10 }, { rpm: 3 })          // 有余量，1 分钟后重置
  const later = facts('later', { rpd: 100 }, { rpd: 10 })      // 有余量，24 小时后重置
  const full = facts('full', { rpm: 10 }, { rpm: 10 })         // 打满，1 分钟后重置

  // 打满的账号虽然也快重置，但此刻已经不能用，必须排在有余量的之后
  assert.equal(pickSoonestReset([full, soon, later], now), 'soon')
  assert.equal(pickSoonestReset([later, soon], now), 'soon')
})

test('smart has nothing to say when no candidate carries a cap', () => {
  assert.equal(pickSoonestReset([facts('a', {}, {}), facts('b', {}, {})], T0), undefined)
})

test('pace prefers the most remaining allowance per hour until reset', () => {
  // A：1 分钟窗口，还剩 5 → 每小时 300
  const rapid = facts('rapid', { rpm: 10 }, { rpm: 5 })
  // B：24 小时窗口，还剩 900 → 每小时 37.5
  const slow = facts('slow', { rpd: 1000 }, { rpd: 100 })

  assert.equal(pickBestPace([rapid, slow], T0), 'rapid')
  assert.equal(pickBestPace([slow, rapid], T0), 'rapid', 'order of input must not decide')
})

test('pace ignores exhausted candidates instead of picking a doomed one', () => {
  const exhausted = facts('exhausted', { rpd: 100 }, { rpd: 100 })
  const usable = facts('usable', { rpd: 100 }, { rpd: 40 })
  assert.equal(pickBestPace([exhausted, usable], T0), 'usable')
  assert.equal(pickBestPace([exhausted], T0), undefined, 'all full means no opinion, not a forced pick')
})

test('an unknown-usage account is not treated as unlimited', () => {
  // used 缺失按 0 计（= 还没用），这是账本的真实语义；但它仍然要有上限才能参与排序
  const unknownUsage = facts('u', { rpm: 10 }, {})
  const projection = projectReset(unknownUsage, T0)
  assert.equal(projection!.remaining, 10)
  assert.equal(pickBestPace([unknownUsage], T0), 'u')
})

// —— 第五层：用户声明的窗口（`shared/declaredQuota.ts`）。套餐页一个数字都不公布的
// 家里，`smart` / `pace` 手里只有这一份证据；它必须真的进来参与排序。

test('a declared window projects on its own reset instant', () => {
  const projection = projectReset(
    {
      accountId: 'declared',
      used: {},
      limit: {},
      declared: [{ window: 'day', unit: 'requests', used: 40, limit: 100, resetAt: T0 + 6 * 3_600_000 }],
    },
    T0,
  )
  assert.ok(projection)
  assert.equal(projection!.metric, 'day', 'the window is reported by its own name, not folded into an official metric')
  assert.equal(projection!.remaining, 60)
  assert.equal(projection!.resetAt, T0 + 6 * 3_600_000)
})

test('a declared window with no derivable reset is skipped, not guessed', () => {
  // 窗口里还没有用量 = 推不出复位时刻。给一个假的边界会把这家的 waiting 说小。
  const factsNoReset: AccountQuotaFacts = {
    accountId: 'nodate',
    used: {},
    limit: {},
    declared: [{ window: 'fiveHour', unit: 'requests', used: 0, limit: 10 }],
  }
  assert.equal(projectReset(factsNoReset, T0), undefined)
  assert.equal(pickSoonestReset([factsNoReset], T0), undefined)
  assert.equal(pickBestPace([factsNoReset], T0), undefined)
})

test('declared windows compete with official caps inside the same account', () => {
  // 官方分钟窗口已打满（解封在 1 分钟后），声明的月窗口还有余量。
  // 打满的窗口决定"最早何时能接活" —— 声明的余量不能把它盖掉。
  const projection = projectReset(
    {
      accountId: 'mixed',
      used: { rpm: 10 },
      limit: { rpm: 10 },
      declared: [{ window: 'month', unit: 'tokens', used: 1000, limit: 1_000_000, resetAt: nextUtcMonthStart(T0) }],
    },
    T0,
  )
  assert.equal(projection!.metric, 'rpm', 'a full official window is still the binding one')
  assert.equal(projection!.remaining, 0)
})

test('declared-only accounts get a real opinion out of smart and pace', () => {
  // 两家都没有官方帽：一家只有声明，另一家什么数字都没有。
  const declared: AccountQuotaFacts = {
    accountId: 'declared',
    used: {},
    limit: {},
    declared: [{ window: 'day', unit: 'requests', used: 10, limit: 100, resetAt: T0 + 6 * 3_600_000 }],
  }
  const silent: AccountQuotaFacts = { accountId: 'silent', used: {}, limit: {} }

  assert.equal(pickSoonestReset([silent, declared], T0), 'declared', 'smart has evidence for exactly one of them')
  assert.equal(pickBestPace([silent, declared], T0), 'declared', 'and pace agrees')
  assert.equal(pickBestPace([silent], T0), undefined, 'with no evidence at all it says nothing and the caller falls back')
})

test('pace spreads a declared rolling window by its own remaining per hour', () => {
  // 同为日窗口、6 小时后复位：A 还剩 60，B 还剩 6 —— A 每小时能花 10 次，B 只有 1 次。
  const roomy: AccountQuotaFacts = {
    accountId: 'roomy',
    used: {},
    limit: {},
    declared: [{ window: 'day', unit: 'requests', used: 40, limit: 100, resetAt: T0 + 6 * 3_600_000 }],
  }
  const tight: AccountQuotaFacts = {
    accountId: 'tight',
    used: {},
    limit: {},
    declared: [{ window: 'day', unit: 'requests', used: 94, limit: 100, resetAt: T0 + 6 * 3_600_000 }],
  }
  assert.equal(pickBestPace([tight, roomy], T0), 'roomy')
})
