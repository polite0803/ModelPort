/**
 * 账号「当日用量」的按日复位。
 *
 * `todayUsed` 只增不减：`resetDailyUsage()` 的注释写着「应由午夜调用」，而全仓
 * 没有任何调用方。于是 `dailyLimit` 实际上是**终身上限** —— 哪一天打满，这个账号
 * 从此不再进候选池；在单模型作用域下，这正是「这条路由没有模型」的成因之一。
 *
 * 复位做成**派生量**而不是定时任务：计数旁边带一个本地日期键，读的时候日期对不上
 * 就是 0。定时器在休眠、重启、用户改时区时都会漏，派生不会。
 *
 * 缺日期键的历史数据按「不是今天」处理：它的日期无从证明，而沿用旧值恰恰就是这条
 * 永久屏蔽本身。代价是一次升级后当天可能多放几笔（下一笔递增就会把日期键写上）。
 */
import { localDayKey } from './localDay.ts'

export interface DailyUsageFields {
  /** 累计请求数中属于 `todayUsedDay` 那一天的数目 */
  todayUsed?: number
  /** `todayUsed` 属于哪个本地日期（`YYYY-MM-DD`） */
  todayUsedDay?: string
}

/** 该账号**今天**的请求数；计数属于别的日子（或没有日期键）读作 0。 */
export function dailyUsageOf(account: DailyUsageFields, nowMs: number = Date.now()): number {
  if (account.todayUsedDay === localDayKey(nowMs)) return account.todayUsed ?? 0
  return 0
}

/** 递增那一格：当日计数 +1，日期键一起写上。 */
export function nextDailyUsage(
  account: DailyUsageFields,
  nowMs: number = Date.now()
): { todayUsed: number; todayUsedDay: string } {
  return { todayUsed: dailyUsageOf(account, nowMs) + 1, todayUsedDay: localDayKey(nowMs) }
}