/**
 * 选号策略的纯逻辑（无 electron / store / axios 依赖，可直接单测）。
 *
 * 两种新策略都建立在同一个问题上：**这个账号什么时候能恢复**。
 * magpie 的 `smart` / `pace` 就是用它分账的，而本仓库的账本
 * （`proxy/quota/ledger.ts`）只存用量、不存重置时刻 —— 所以这里全部由
 * "滚动窗口"的定义反推，不新增任何落盘字段，账本格式不动。
 *
 * 三条纪律：
 *
 * 1. **推不出来就不猜。** 没有上限、没有用量、账本读不到的账号，`resetAt` 返回
 *    `undefined`，策略必须按"未知"处理而不是当成"立刻重置"。
 * 2. **两种策略都不许踢掉候选。** 它们只改**顺序**；能不能用由 `selectAccount`
 *    之外的过滤（失败账号、额度闸门）决定。算不出来就退回 `fill-first` 的顺序。
 * 3. **重置时刻只对"当前这个窗口"有意义。** 已经打满的账号 `resetAt` 是它解封的
 *    那一刻；没打满的账号报的是窗口边界，不能拿它当"还能用多久"。
 */

import type { DeclaredQuotaUnit, DeclaredQuotaWindow } from './declaredQuota.ts'

export type QuotaWindowMetric = 'rpm' | 'rpd' | 'tpm' | 'tpd' | 'monthlyTokens'

/** 各窗口的长度（毫秒）。月度按 UTC 自然月，单独算。 */
export const WINDOW_MS: Record<Exclude<QuotaWindowMetric, 'monthlyTokens'>, number> = {
  rpm: 60_000,
  tpm: 60_000,
  rpd: 24 * 60 * 60_000,
  tpd: 24 * 60 * 60_000,
}

/**
 * 一条**用户声明**的窗口（`shared/declaredQuota.ts`）。
 *
 * 与五个官方指标分开列，因为两者的窗口口径不同：官方指标只有分钟 / 日 / 月三种，
 * 复位时刻一向由 `WINDOW_MS` 反推；声明的 5 小时 / 自然周在 `WINDOW_MS` 里根本没有
 * 对应项，复位时刻由账本与实际账号配置给出。混进同一张表就得替它编一个窗口长度。
 *
 * `resetAt` 缺席 = 算不出来（窗口里还没有用量），策略按「未知」处理，不猜。
 */
export interface DeclaredQuotaFact {
  window: DeclaredQuotaWindow
  unit: DeclaredQuotaUnit
  used: number
  limit: number
  resetAt?: number
}

/** 一个账号在某一家的用量与上限，策略只看这些。 */
export interface AccountQuotaFacts {
  accountId: string
  /** 该窗口已用；`undefined` = 这家没有这个窗口的计量 */
  used: Partial<Record<QuotaWindowMetric, number>>
  /** 该窗口上限；`undefined` = 没有可执行的帽 */
  limit: Partial<Record<QuotaWindowMetric, number>>
  /**
   * 用户声明的窗口。它是第五层额度证据：套餐页一个数字都不公布的家（20 个订阅
   * 条目全是 `undocumented`）在此之前只能退回 fill-first —— 不是策略不灵，是手里
   * 没有数字。声明在这里，`smart` / `pace` 就有得算。
   */
  declared?: readonly DeclaredQuotaFact[]
}

export interface ResetProjection {
  /** 官方指标，或用户声明的窗口名。两者不互换：单位与复位口径都不同。 */
  metric: QuotaWindowMetric | DeclaredQuotaWindow
  /** 该窗口解封的时刻（毫秒时间戳） */
  resetAt: number
  /** 该窗口还剩多少（非负） */
  remaining: number
  /** 该窗口总量（上限） */
  limit: number
}

/** UTC 下一个自然月的第一毫秒。 */
export function nextUtcMonthStart(nowMs: number): number {
  const now = new Date(nowMs)
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
}

/**
 * 滚动窗口的下一个边界：窗口长度按 `now` 对齐到整数格。
 * 秒级取整避免毫秒抖动让同一个账号在两次请求间算出不同的 resetAt。
 */
export function nextRollingBoundary(nowMs: number, windowMs: number): number {
  const floored = Math.floor(nowMs / windowMs) * windowMs
  return floored + windowMs
}

/**
 * 按最"紧迫"的窗口给出该账号的恢复时刻。
 *
 * 紧迫的判定：先看**已经打满**的窗口（它有真正的解封时刻），取其中最早解封的那个 ——
 * 因为它决定了这个账号最早何时能重新接活；没有打满的窗口时，返回最快结束的那个边界，
 * 供 `pace` 估算"每小时还剩多少"。
 */
export function projectReset(facts: AccountQuotaFacts, nowMs: number): ResetProjection | undefined {
  let best: ResetProjection | undefined
  let bestIsFull = false

  const consider = (projection: ResetProjection): void => {
    const isFull = projection.remaining <= 0
    // 打满的窗口优先；同为打满时取最早解封；都没打满时取最近的边界。
    const better = best === undefined
      ? true
      : isFull && !bestIsFull
        ? true
        : isFull === bestIsFull && projection.resetAt < best.resetAt
    if (better) {
      best = projection
      bestIsFull = isFull
    }
  }

  for (const metric of Object.keys(facts.limit) as QuotaWindowMetric[]) {
    const limit = facts.limit[metric]
    const used = facts.used[metric] ?? 0
    if (limit === undefined || limit <= 0) continue

    consider({
      metric,
      resetAt: metric === 'monthlyTokens'
        ? nextUtcMonthStart(nowMs)
        : nextRollingBoundary(nowMs, WINDOW_MS[metric]),
      remaining: Math.max(0, limit - used),
      limit,
    })
  }

  // 用户声明的窗口同台竞技。复位时刻由调用方按窗口性质给（滚动估算 / UTC 自然边界），
  // 这里不替它编一个窗口长度；算不出来的（`resetAt` 缺席）直接跳过 —— 「推不出来就不猜」。
  for (const entry of facts.declared ?? []) {
    if (!(entry.limit > 0) || entry.resetAt === undefined) continue
    consider({
      metric: entry.window,
      resetAt: entry.resetAt,
      remaining: Math.max(0, entry.limit - entry.used),
      limit: entry.limit,
    })
  }

  return best
}

/**
 * `smart`：在候选里挑"最早能恢复"的那个，把快重置的额度先用掉。
 *
 * 反例要点：一个**已经打满**的候选解封最晚时，不该被选；一个没有任何额度信息的
 * 候选（`undefined`）不能因为"算不出"就被当成无限可用，排在已知有余量之后。
 */
export function pickSoonestReset(candidates: AccountQuotaFacts[], nowMs: number): string | undefined {
  let winner: { accountId: string; resetAt: number } | undefined

  for (const facts of candidates) {
    const projection = projectReset(facts, nowMs)
    if (!projection) continue
    // 打满的账号只能作为最后手段；`remaining > 0` 的按恢复时刻排序。
    const key = projection.remaining > 0 ? projection.resetAt : projection.resetAt + 1e12
    if (!winner || key < winner.resetAt) winner = { accountId: facts.accountId, resetAt: key }
  }

  return winner?.accountId
}

/**
 * `pace`：挑"每小时剩余额度最多"的那个，把额度平摊到重置前。
 *
 * 只对**还有余量**的候选有意义；全部打满时返回 `undefined`，让调用方退回既有行为，
 * 而不是硬选一个注定 429 的账号。
 */
export function pickBestPace(candidates: AccountQuotaFacts[], nowMs: number): string | undefined {
  let winner: { accountId: string; rate: number } | undefined

  for (const facts of candidates) {
    const projection = projectReset(facts, nowMs)
    if (!projection || projection.remaining <= 0) continue

    const hours = Math.max((projection.resetAt - nowMs) / 3_600_000, 1 / 3600)
    const rate = projection.remaining / hours
    if (!winner || rate > winner.rate) winner = { accountId: facts.accountId, rate }
  }

  return winner?.accountId
}
