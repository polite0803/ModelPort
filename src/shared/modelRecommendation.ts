import { ROUTE_RATING_MAX_STARS, type AutoModelTier } from './types.ts'

/**
 * 系统给池内模型的默认星级推荐（1–5）。
 *
 * 只作展示：不参与选路排序、不写回配置。手动 `routes:rate` 的评分优先显示，
 * 清除手动评分后回落到这里的推导值，而不是空星。
 *
 * 推导口径（透明、可复算，全部来自已有客观读数，不引入新数据源）：
 * - 档位基线：strong=4 / balanced=3 / fast=2（能力档，与「档」列同源）。
 * - 首字延迟：有 EWMA 读数时 ≤1s +1、≥4s -1；没有读数不加分也不扣分（不猜）。
 * - 当前健康：熔断中 -2；可派发账号为 0 -2（此刻不可用）。
 * 结果夹到 1..5。上下文窗口是能力而非质量，刻意不参与。
 */
export interface ModelRecommendationInput {
  tier: AutoModelTier
  /** 该模型各账号 EWMA 首字的最小值；没有读数时缺省。 */
  ewmaFirstTokenMs?: number
  accountCount: number
  /** 模型断路器是否正在生效（熔断中）。 */
  circuitActive: boolean
}

const TIER_BASE: Record<AutoModelTier, number> = {
  fast: 2,
  balanced: 3,
  strong: 4,
}

const FAST_FIRST_TOKEN_MS = 1000
const SLOW_FIRST_TOKEN_MS = 4000

export function recommendModelStars(input: ModelRecommendationInput): number {
  let stars = TIER_BASE[input.tier]
  if (input.ewmaFirstTokenMs !== undefined) {
    if (input.ewmaFirstTokenMs <= FAST_FIRST_TOKEN_MS) stars += 1
    else if (input.ewmaFirstTokenMs >= SLOW_FIRST_TOKEN_MS) stars -= 1
  }
  if (input.circuitActive) stars -= 2
  if (input.accountCount === 0) stars -= 2
  return Math.min(ROUTE_RATING_MAX_STARS, Math.max(1, stars))
}