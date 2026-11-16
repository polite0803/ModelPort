/**
 * 「即将过期的配额」与「这一轮为什么跳过它」的展示投影（纯函数层）。
 *
 * 被证明的是 `src/shared/routeQuotaView.ts` 的口径，四条都有代价，所以逐条钉：
 *
 * 1. **原因枚举不许漂移**：`RouteQuotaBlockReason` 是 `main/proxy/quota/limits.ts::QuotaBlockReason`
 *    的镜像（shared 不能反向依赖 main）。镜错一个词，界面就会对一个真实原因显示
 *    兜底文案 —— 而且编译期不会报。
 * 2. **`band` 取最好的账号，`rows` 取最紧的那一行**：两个问题（能不能派 / 哪笔快过期）
 *    答案不同。取平均两种谎都撒，这里用「一把打满 + 一把空着」把两种折叠分开钉住。
 * 3. **没有可执行上限 = `undocumented`**，不是 `ample`、更不是 `0`。官方没公布就是没公布。
 * 4. **钱的时刻缺席**：`no-credit` 没有倒计时（要不要恢复取决于用户去不去充值），
 *    且它在展示优先级里永远排第一；单行只写一个原因。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ROUTE_QUOTA_ROWS,
  ROUTE_WINDOW_OF_METRIC,
  blockReasonKey,
  blockReasonRank,
  declaredQuotaRows,
  describeDelay,
  documentedQuotaRows,
  emptyQuotaSummary,
  isMoneyBlock,
  preferBlock,
  summarizeQuotaRows,
  type RouteBlockReason,
  type RouteQuotaBlockReason,
  type RouteQuotaWindowRow,
} from '../../src/shared/routeQuotaView.ts'
import type { QuotaBlockReason } from '../../src/main/proxy/quota/limits.ts'

/** 只填展示关心的字段，其余给确定的默认值。 */
function row(overrides: Partial<RouteQuotaWindowRow> & Pick<RouteQuotaWindowRow, 'window' | 'unit' | 'limit' | 'used'>): RouteQuotaWindowRow {
  const used = Math.max(0, overrides.used)
  return {
    remaining: Math.max(0, overrides.limit - used),
    resetSource: 'estimated',
    source: 'documented',
    usedRatio: overrides.limit > 0 ? used / overrides.limit : 0,
    ...overrides,
  }
}

// —— 环 1：两个枚举是同一份，谁也不能单方面加词。
test('the shared reason mirror and the gate reason set are the same set of words', () => {
  // 双向可赋值才算同一份；任一侧多一个词，下面这两个函数签名就会编译失败（tsc 是
  // gate 的一环），这比在运行时数一遍字符串更早报错。
  const toShared = (reason: QuotaBlockReason): RouteQuotaBlockReason => reason
  const toGate = (reason: RouteQuotaBlockReason): QuotaBlockReason => reason

  const reasons: RouteQuotaBlockReason[] = [
    'no-credit',
    'quota-exhausted',
    'declared-exhausted',
    'rpm_exhausted',
    'rpd_exhausted',
    'tpm_exhausted',
    'tpd_exhausted',
    'monthly_exhausted',
  ]
  for (const reason of reasons) {
    assert.equal(toGate(reason), reason, `${reason} survives the round trip unchanged`)
    assert.equal(toShared(toGate(reason)), reason)
    // 每一个闸门原因都必须有一个人话键，且键名是扁平的 `routes.block_<reason>`。
    assert.equal(blockReasonKey(reason), `routes.block_${reason}`)
  }
})

test('the window of every documented metric is the one the catalogue view uses', () => {
  assert.deepEqual(ROUTE_WINDOW_OF_METRIC, {
    rpm: 'minute',
    tpm: 'minute',
    rpd: 'day',
    tpd: 'day',
    monthlyTokens: 'month',
  })
})

// —— 环 2：两个折叠问题不许用同一个答案。
test('the band is the best account while the rows are the tightest, one window', () => {
  // 两把账号：一把日窗口打满、一把只用了一成。模型此刻仍派得出去（band 不 exhausted），
  // 但「最容易撞墙的那个数」是打满那一把 —— 两行会折叠成一行（同一窗口/单位/出处/上限）。
  const tight = [
    row({ window: 'day', unit: 'requests', limit: 100, used: 100 }),
  ]
  const loose = [
    row({ window: 'day', unit: 'requests', limit: 100, used: 10 }),
  ]

  const summary = summarizeQuotaRows([tight, loose])
  assert.equal(summary.band, 'ample', 'one account still has room, so the model can dispatch')
  assert.equal(summary.rows.length, 1, 'same window/unit/source/limit folds into one line')
  assert.equal(summary.rows[0].used, 100, 'and that line carries the tightest reading, not the average')
  assert.equal(summary.rows[0].remaining, 0)
  assert.equal(summary.windows, 1)
})

test('a model whose every account is full reports the exhausted band', () => {
  const full = [row({ window: 'day', unit: 'requests', limit: 100, used: 100 })]
  const alsoFull = [row({ window: 'day', unit: 'requests', limit: 100, used: 150 })]
  assert.equal(summarizeQuotaRows([full, alsoFull]).band, 'exhausted')
})

test('a tight-but-not-full pool is tight, and 80% is the boundary', () => {
  const at = (used: number) => [[row({ window: 'day', unit: 'requests', limit: 100, used })]]
  assert.equal(summarizeQuotaRows(at(79)).band, 'ample')
  assert.equal(summarizeQuotaRows(at(80)).band, 'tight')
  assert.equal(summarizeQuotaRows(at(99)).band, 'tight')
  assert.equal(summarizeQuotaRows(at(100)).band, 'exhausted')
})

test('different limits are different windows and stay separate lines', () => {
  const a = [row({ window: 'day', unit: 'requests', limit: 100, used: 50 })]
  const b = [row({ window: 'day', unit: 'requests', limit: 200, used: 50 })]
  const summary = summarizeQuotaRows([a, b])
  assert.equal(summary.rows.length, 2, 'two accounts declared two different upper bounds')
  assert.equal(summary.windows, 2)
})

// —— 环 3：「没公布」不是「充裕」。
test('an account with no enforceable cap contributes nothing to the band', () => {
  // 一个账号完全没有读数（官方未公布、用户也没声明）：band 不能因此变成 ample。
  assert.deepEqual(summarizeQuotaRows([[], []]), emptyQuotaSummary())
  assert.equal(summarizeQuotaRows([[], []]).band, 'undocumented')

  // 掺一个真有读数的账号：结论由有读数的那个说，空的那个不参与。
  const summary = summarizeQuotaRows([[row({ window: 'day', unit: 'requests', limit: 10, used: 9 })], []])
  assert.equal(summary.band, 'tight')
  assert.equal(summary.windows, 1, 'the empty account adds no row')
})

test('an empty summary advertises no expiry instant', () => {
  const empty = emptyQuotaSummary()
  assert.equal(empty.band, 'undocumented')
  assert.deepEqual(empty.rows, [])
  assert.equal(empty.windows, 0)
  assert.equal(empty.soonestExpiryAt, undefined, 'nothing to expire, so no instant')
})

// —— 环 4：即将过期 —— 有余额 + 知道复位时刻里最近的那一笔。
test('the soonest expiry is the nearest reset among windows that still have room', () => {
  const now = 1_700_000_000_000
  const summary = summarizeQuotaRows([[
    row({ window: 'minute', unit: 'requests', limit: 20, used: 20, resetAt: now + 30_000 }),
    row({ window: 'day', unit: 'requests', limit: 50, used: 5, resetAt: now + 3_600_000 }),
    row({ window: 'month', unit: 'tokens', limit: 1_000_000, used: 400_000, resetAt: now + 86_400_000 }),
  ]])
  assert.equal(summary.soonestExpiryAt, now + 3_600_000,
    'the full minute window has no room to spend, so it is not "about to expire unused"')
})

test('rows sort full-first, then by reset instant, and windows without one go last', () => {
  const now = 1_700_000_000_000
  const summary = summarizeQuotaRows([[
    row({ window: 'minute', unit: 'requests', limit: 20, used: 1, resetAt: now + 90_000 }),
    row({ window: 'month', unit: 'tokens', limit: 100, used: 10 }), // 没有复位时刻
    row({ window: 'day', unit: 'requests', limit: 10, used: 10, resetAt: now + 90_000_000 }),
    row({ window: 'week', unit: 'tokens', limit: 900, used: 100, resetAt: now + 60_000 }),
  ]], 4)
  assert.deepEqual(summary.rows.map(r => r.window), ['day', 'week', 'minute', 'month'],
    'full first, then nearest reset, then the one we cannot predict')
})

test('the row limit keeps the tightest lines and still counts every window', () => {
  const rows = [
    row({ window: 'day', unit: 'requests', limit: 10, used: 10 }),
    row({ window: 'week', unit: 'requests', limit: 10, used: 9 }),
    row({ window: 'month', unit: 'tokens', limit: 10, used: 8 }),
    row({ window: 'fiveHour', unit: 'tokens', limit: 10, used: 7 }),
  ]
  const summary = summarizeQuotaRows([rows], 2)
  assert.equal(summary.rows.length, 2)
  assert.equal(summary.windows, 4, 'the count is what was folded, not what fits on screen')
  assert.equal(summary.rows[0].window, 'day', 'the full one leads')
  assert.ok(ROUTE_QUOTA_ROWS >= 2)
})

test('a limit of zero or a negative used is never a fake 100%', () => {
  const summary = summarizeQuotaRows([[
    row({ window: 'day', unit: 'requests', limit: 0, used: 5 }),
  ]])
  assert.equal(summary.rows[0].usedRatio, 0, 'limit <= 0 means "no upper bound", not "full"')
})

// —— 环 5：优先一条原因，钱的时刻缺席。
test('money outranks every other reason and carries no countdown', () => {
  const reasons: RouteBlockReason[] = [
    'no-credit',
    'quota-exhausted',
    'declared-exhausted',
    'monthly_exhausted',
    'tpd_exhausted',
    'rpd_exhausted',
    'tpm_exhausted',
    'rpm_exhausted',
    'daily_limit',
    'rate_limited',
  ]
  // 排名随数组严格递增：钱第一、限流最后。
  for (let i = 1; i < reasons.length; i += 1) {
    assert.ok(blockReasonRank(reasons[i - 1]) < blockReasonRank(reasons[i]),
      `${reasons[i - 1]} ranks ahead of ${reasons[i]}`)
  }
  assert.equal(blockReasonRank('no-credit'), 0)
  assert.ok(isMoneyBlock('no-credit'))
  assert.ok(!isMoneyBlock('quota-exhausted'))
  assert.ok(!isMoneyBlock('declared-exhausted'))
})

test('preferBlock takes the higher-priority reason, then the earlier instant', () => {
  const money = { reason: 'no-credit' as const }
  const quota = { reason: 'quota-exhausted' as const, until: 5_000, untilSource: 'upstream' as const }
  assert.deepEqual(preferBlock(undefined, quota), quota, 'nothing to compare against yet')
  assert.deepEqual(preferBlock(quota, money), money, 'money wins even without an instant')
  assert.deepEqual(preferBlock(money, quota), money, 'and it stays winning')

  const later = { reason: 'rate_limited' as const, until: 9_000, untilSource: 'upstream' as const }
  const sooner = { reason: 'rate_limited' as const, until: 1_000, untilSource: 'upstream' as const }
  assert.deepEqual(preferBlock(later, sooner), sooner, 'same reason: the earlier recovery is the one to show')
  assert.deepEqual(preferBlock(sooner, later), sooner)

  const open = { reason: 'daily_limit' as const }
  assert.deepEqual(preferBlock(open, { reason: 'daily_limit' as const, until: 1_000 }), { reason: 'daily_limit' as const, until: 1_000 },
    'an instant beats no instant at the same rank')
  assert.deepEqual(preferBlock({ reason: 'daily_limit' as const, until: 1_000 }, open), { reason: 'daily_limit' as const, until: 1_000 })
})

test('a delay rounds up so "it is back" is never said a minute early', () => {
  assert.deepEqual(describeDelay(0), { unit: 'minutes', n: 1 })
  assert.deepEqual(describeDelay(59_000), { unit: 'minutes', n: 1 })
  assert.deepEqual(describeDelay(60_000), { unit: 'minutes', n: 1 })
  assert.deepEqual(describeDelay(61_000), { unit: 'minutes', n: 2 })
  assert.deepEqual(describeDelay(59 * 60_000), { unit: 'minutes', n: 59 })
  assert.deepEqual(describeDelay(60 * 60_000), { unit: 'hours', n: 1 })
  assert.deepEqual(describeDelay(47 * 3_600_000), { unit: 'hours', n: 47 })
  assert.deepEqual(describeDelay(48 * 3_600_000), { unit: 'days', n: 2 })
  assert.deepEqual(describeDelay(30 * 24 * 3_600_000), { unit: 'days', n: 30 })
})

// —— 环 6：两种来源各自成行，出处不许混。
test('documented and declared rows are both produced, each with its own source', () => {
  const documented = documentedQuotaRows(
    { rpd: 50, monthlyTokens: 1_000_000 },
    { rpd: 'documented', monthlyTokens: 'learned' },
    { rpm: 0, rpd: 25, tpm: 0, tpd: 0, monthlyTokens: 100 },
    metric => (metric === 'monthlyTokens' ? 42 : undefined),
    'estimated',
  )
  assert.equal(documented.length, 2)
  const day = documented.find(r => r.window === 'day')
  assert.equal(day?.unit, 'requests')
  assert.equal(day?.source, 'documented')
  assert.equal(day?.resetAt, undefined, 'a rolling window with no bucket time gives no instant')
  const month = documented.find(r => r.window === 'month')
  assert.equal(month?.source, 'learned', 'a learned cap says so')
  assert.equal(month?.unit, 'tokens')
  assert.equal(month?.resetAt, 42)

  const declared = declaredQuotaRows(
    [{ window: 'fiveHour', unit: 'tokens', limit: 5_000_000 }],
    () => ({ requests: 7, tokens: 2_500_000 }),
    () => ({ resetAt: 99, resetSource: 'estimated' as const }),
  )
  assert.equal(declared.length, 1)
  assert.equal(declared[0].source, 'declared')
  assert.equal(declared[0].used, 2_500_000, 'tokens unit reads the token reading')
  assert.equal(declared[0].resetSource, 'estimated')
  assert.equal(declared[0].usedRatio, 0.5)
})

test('a declared request window reads the request count, never the token count', () => {
  const [rowOut] = declaredQuotaRows(
    [{ window: 'day', unit: 'requests', limit: 200 }],
    () => ({ requests: 50, tokens: 9_999_999 }),
    () => ({ resetSource: 'local' as const }),
  )
  assert.equal(rowOut.used, 50, 'requests unit must not be fed the token number')
  assert.equal(rowOut.unit, 'requests')
  assert.equal(rowOut.resetAt, undefined, 'an unknown reset instant stays absent rather than zero')
})