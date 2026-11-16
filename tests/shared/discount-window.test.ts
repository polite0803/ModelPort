/**
 * `shared/discountWindow.ts` —— 时变折价的唯一一把尺。
 *
 * 这套测试盯的是**两侧不能分叉**：渠道页印的价、选路计分用的价、星级投影用的
 * 价都读这一个文件，所以这里每一条断言都是「同一个瞬间两个界面会不会给两个数」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  costScoreOfWeight,
  discountWindowLabel,
  effectiveWeightOf,
  isDiscountWindowActive,
  nextDiscountBoundary,
  parseSlotBoundary,
  zonedMinutes,
  type DiscountWindow,
} from '../../src/shared/discountWindow.ts'

/** 上海 2026-11-16 23:30 的 epoch ms（夜间折扣窗口内）。 */
const SHANGHAI_NIGHT = Date.parse('2026-11-16T15:30:00Z')
/** 上海 2026-11-16 12:00 的 epoch ms（窗口外）。 */
const SHANGHAI_NOON = Date.parse('2026-11-16T04:00:00Z')

test('slot boundaries tolerate an unpadded hour and reject anything else', () => {
  // 实测 buddy 下发的是 `7:50`，不是 `07:50`。
  assert.equal(parseSlotBoundary('7:50'), 470)
  assert.equal(parseSlotBoundary('07:50'), 470)
  assert.equal(parseSlotBoundary('22:00'), 1320)
  assert.equal(parseSlotBoundary('00:00'), 0)
  // 读不懂的一律 undefined —— 调用方据此丢时段，而不是当成整天。
  assert.equal(parseSlotBoundary('24:00'), undefined)
  assert.equal(parseSlotBoundary('7:60'), undefined)
  assert.equal(parseSlotBoundary(''), undefined)
  assert.equal(parseSlotBoundary(750), undefined)
  assert.equal(parseSlotBoundary(undefined), undefined)
})

test('zoned minutes follow the named zone, not a hardcoded +8', () => {
  // 同一瞬间在三个时区是三个钟点：这正是「硬编码 +8」会整天算错的来路。
  assert.equal(zonedMinutes(SHANGHAI_NIGHT, 'Asia/Shanghai'), 23 * 60 + 30)
  assert.equal(zonedMinutes(SHANGHAI_NIGHT, 'UTC'), 15 * 60 + 30)
  assert.equal(zonedMinutes(SHANGHAI_NIGHT, 'America/New_York'), 10 * 60 + 30)
  // 缺失按 UTC；非法时区返回 undefined（调用方读成「无法判定」）。
  assert.equal(zonedMinutes(SHANGHAI_NIGHT, undefined), 15 * 60 + 30)
  assert.equal(zonedMinutes(SHANGHAI_NIGHT, 'Not/AZone'), undefined)
})

test('a cross-midnight slot is open on both sides of midnight', () => {
  const window: DiscountWindow = {
    daily: [{ start: '23:00', end: '7:50' }],
    timezone: 'Asia/Shanghai',
  }
  assert.equal(isDiscountWindowActive(window, SHANGHAI_NIGHT), true)
  // 23:00 整点算开（含起点），7:50 整点算关（不含终点）。
  assert.equal(isDiscountWindowActive(window, Date.parse('2026-11-16T15:00:00Z')), true)
  assert.equal(isDiscountWindowActive(window, Date.parse('2026-11-16T23:50:00Z')), false)
  assert.equal(isDiscountWindowActive(window, Date.parse('2026-11-16T23:49:00Z')), true)
  assert.equal(isDiscountWindowActive(window, SHANGHAI_NOON), false)
})

test('validity spans gate the window even without daily slots', () => {
  const from = Date.parse('2026-11-16T00:00:00Z')
  const until = Date.parse('2026-11-17T00:00:00Z')
  const window: DiscountWindow = { validFrom: from, validUntil: until }
  assert.equal(isDiscountWindowActive(window, from), true)
  assert.equal(isDiscountWindowActive(window, from - 1), false)
  assert.equal(isDiscountWindowActive(window, until), false)
  assert.equal(isDiscountWindowActive(window, until - 1), true)
})

test('the failure direction is the cheaper price, never the dearer one', () => {
  // 时区读不懂 → 读成「生效」。把折扣的缺失当成「没有折扣」会按两倍价收费，
  // 而显示渠道自己客户端显示的折扣是可恢复的错。方向是不对称的，故意的。
  const brokenZone: DiscountWindow = {
    daily: [{ start: '23:00', end: '7:50' }],
    timezone: 'Mars/Olympus',
  }
  assert.equal(isDiscountWindowActive(brokenZone, SHANGHAI_NOON), true)
  // 时段本身读不懂 → 同理（这里 daily 为空数组等价于「整天」）。
  assert.equal(isDiscountWindowActive({ daily: [] }, SHANGHAI_NOON), true)
})

test('effectiveWeightOf switches sides exactly on the boundary', () => {
  const entry = {
    weight: 0.2,
    baseWeight: 0.5,
    promoWeight: 0.2,
    discountWindow: {
      daily: [{ start: '23:00', end: '7:50' }],
      timezone: 'Asia/Shanghai',
    } satisfies DiscountWindow,
  }
  assert.equal(effectiveWeightOf(entry, SHANGHAI_NIGHT), 0.2)
  assert.equal(effectiveWeightOf(entry, SHANGHAI_NOON), 0.5)
})

test('no window means the fetched price stands, and unknown stays unknown', () => {
  // 没有窗口 = 这个渠道没报时变价，采集价就是唯一答案。
  assert.equal(effectiveWeightOf({ weight: 0.3 }, SHANGHAI_NOON), 0.3)
  // 完全没有价 = 未知，**不是 0**（0 会被读成免费）。
  assert.equal(effectiveWeightOf({}, SHANGHAI_NOON), undefined)
  // 窗口报了但窗口内/外缺一侧：各自回落到采集价，不编造。
  assert.equal(effectiveWeightOf({ weight: 0.3, discountWindow: {} }, SHANGHAI_NOON), 0.3)
  assert.equal(
    effectiveWeightOf({ weight: 0.3, baseWeight: 1, discountWindow: {} }, SHANGHAI_NOON),
    0.3,
  )
})

test('the cost curve passes through the old bucket anchors', () => {
  // 三个锚点必须与 `COST_SCORE` 完全一致，否则基准价上的行为会变。
  assert.equal(costScoreOfWeight(0), 1)
  assert.equal(costScoreOfWeight(1), 0.5)
  assert.equal(costScoreOfWeight(2), 0.25)
  // 旧表的 below-base 是 0.75 —— 曲线在 w≈0.42 处取到同一个值。
  assert.ok(Math.abs(costScoreOfWeight(Math.log2(4 / 3)) - 0.75) < 1e-9)
})

test('the curve separates depths the five buckets collapsed', () => {
  // 五档把 x0.02 与 x0.9 都算 below-base、同分；曲线上它们差 0.45 —— 这才是
  // 「打折 50 倍能换来一次改派」的来路。
  const deep = costScoreOfWeight(0.02)
  const shallow = costScoreOfWeight(0.9)
  assert.ok(deep > 0.98, `x0.02 should be nearly free-weight, got ${deep}`)
  assert.ok(shallow < 0.55 && shallow > 0.52, `x0.9 should read near base, got ${shallow}`)
  assert.ok(deep - shallow > 0.4)
})

test('the curve is clamped at both ends instead of overflowing', () => {
  assert.equal(costScoreOfWeight(0), 1)
  assert.equal(costScoreOfWeight(-5), 1)
  assert.equal(costScoreOfWeight(16), 2 ** -16)
  // 超过 x16 不再继续变小：它已经是「买不起」，任何更小的数都没有信息量。
  assert.equal(costScoreOfWeight(1e6), 2 ** -16)
  // 非有限数取中性，不产生 NaN 污染打分。
  assert.equal(costScoreOfWeight(Number.NaN), 0.5)
})

test('nextDiscountBoundary points at the next slot edge, tomorrow included', () => {
  const window: DiscountWindow = {
    daily: [{ start: '23:00', end: '7:50' }],
    timezone: 'Asia/Shanghai',
  }
  // 23:30 现在 → 下一个边界是次日 7:50（上海），即 8 小时 20 分后。
  const next = nextDiscountBoundary(window, SHANGHAI_NIGHT)
  assert.ok(next !== undefined)
  assert.equal(next! - SHANGHAI_NIGHT, (8 * 60 + 20) * 60_000)
  // 正好踩在边界上时取**下一个**，不是 0（否则定时器原地空转）。
  const atNoon = nextDiscountBoundary(window, SHANGHAI_NOON)
  assert.ok(atNoon !== undefined && atNoon > SHANGHAI_NOON)
})

test('nextDiscountBoundary prefers the earlier validity edge', () => {
  const until = SHANGHAI_NOON + 90 * 60_000
  const window: DiscountWindow = { validUntil: until }
  assert.equal(nextDiscountBoundary(window, SHANGHAI_NOON), until)
  // 已经过去的截止时间不产生边界（否则会算出过去时刻，定时器立刻醒、空转）。
  assert.equal(nextDiscountBoundary(window, until + 1), undefined)
  assert.equal(nextDiscountBoundary({}, SHANGHAI_NOON), undefined)
})

test('the badge label shows the clock for a slot and a date for a span', () => {
  const slot = discountWindowLabel(
    { daily: [{ start: '23:00', end: '7:50' }], timezone: 'Asia/Shanghai' },
    SHANGHAI_NOON,
  )
  assert.equal(slot, '23:00–7:50 Asia/Shanghai')
  // 一次性活动没有钟点，只有截止时刻 —— 印「整天」会是假话。
  const span = discountWindowLabel({ validUntil: SHANGHAI_NOON }, SHANGHAI_NOON)
  assert.ok(span !== undefined && /^\d{2}-\d{2} \d{2}:\d{2}$/.test(span))
  // 无可显示内容时省略徽标，而不是渲染一个空框。
  assert.equal(discountWindowLabel({}, SHANGHAI_NOON), undefined)
})