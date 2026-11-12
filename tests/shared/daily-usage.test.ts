/**
 * 「当日用量」按日期键派生：同一天原样、跨日读作 0、递增时把日期键写上。
 *
 * 为什么需要这条门：`resetDailyUsage()` 曾经写着「应由午夜调用」但全仓没有调用方，
 * 于是 `dailyLimit` 实际上是终身上限（一天打满，账号从此不再进池）。复位改成派生量
 * 之后，判据变成这两个函数的日期比较 —— 它必须有自己的钉点。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dailyUsageOf, nextDailyUsage } from '../../src/shared/dailyUsage.ts'
import { localDayKey } from '../../src/shared/localDay.ts'

const NOW = new Date(2026, 10, 13, 15, 30, 0).getTime()
const YESTERDAY = new Date(2026, 10, 12, 23, 59, 0).getTime()

test('同一天的计数原样返回', () => {
  assert.equal(dailyUsageOf({ todayUsed: 7, todayUsedDay: localDayKey(NOW) }, NOW), 7)
})

test('日期键属于别的日子读作 0（跨日复位）', () => {
  assert.equal(dailyUsageOf({ todayUsed: 400, todayUsedDay: localDayKey(YESTERDAY) }, NOW), 0)
})

test('没有日期键的老数据读作 0：沿用旧值正是那条永久屏蔽本身', () => {
  assert.equal(dailyUsageOf({ todayUsed: 400 }, NOW), 0)
})

test('递增把日期键一起写上，跨日的第一笔从 1 开始', () => {
  assert.deepEqual(
    nextDailyUsage({ todayUsed: 9, todayUsedDay: localDayKey(NOW) }, NOW),
    { todayUsed: 10, todayUsedDay: localDayKey(NOW) },
  )
  assert.deepEqual(
    nextDailyUsage({ todayUsed: 400, todayUsedDay: localDayKey(YESTERDAY) }, NOW),
    { todayUsed: 1, todayUsedDay: localDayKey(NOW) },
  )
})