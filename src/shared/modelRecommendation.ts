import { ROUTE_RATING_MAX_STARS } from './types.ts'

/**
 * 分数 → 星级。**只有这一条换算，没有第二套推导。**
 *
 * 推荐星不是另行发明的评分，而是选路打分（`autoRouting.ts::scoreFactors` 那张因子表）
 * 在一个参考画像下的求值，再经这里压到 1..5。求值在 `autoRouting.ts::recommendModelStars`
 * —— 因为读数（档位、成本档、延迟、健康、Bandit 战绩）全在主进程侧。本文件只保留尺子
 * 本身：一条线性映射，两端写死，任何一处改动都会平移所有星。
 *
 * 为什么端点取 0.5 / 1：
 * - 基础因子的份量之和恒为 1（四种口径都如此），所以「按参考画像老老实实派发」的分数
 *   天然落在 0..1 的这个区间里；0.5 是「什么都不占优」的中线，1 是「每一项都拿满」。
 * - 端点取整后**恰好复现**档位直觉：strong=4 / balanced=3 / fast=2（见测试）。
 *   这不是凑出来的：能力档在参考画像下相差 0.15（=1.2 星），一个免费模型值 0.1
 *   （=0.8 星）—— 「免费抵得上差半档的模型」这句话就是这两个常数说的。
 * - 扣分能把分数压到 0.5 以下（延迟、健康、Bandit 连败），加分也能顶到 1 以上
 *   （免费 + 好战绩），两端都夹住，不制造 6 星也不制造 0 星。
 */
export const STAR_SCORE_FLOOR = 0.5
export const STAR_SCORE_CEILING = 1

/**
 * 一星值多少分。**所有「扣几颗星」的说法都要经这里换成分数**，不许在别处直接减星：
 * 同一个读数在打分与星级里必须是同一个量，否则两套口径又长回来了。
 */
export const STAR_SCORE_STEP = (STAR_SCORE_CEILING - STAR_SCORE_FLOOR) / (ROUTE_RATING_MAX_STARS - 1)

/**
 * 一个分数落在几星。超出两端夹住；非有限数按最低星（宁可说小，不说大）。
 *
 * 单调不减是硬约束：星级优先的排序必须与打分排序同向，否则页面上的顺序会与
 * 真实派发顺序打架 —— 那正是这一步要消灭的东西。
 */
export function starsFromScore(score: number): number {
  if (!Number.isFinite(score)) return 1
  const span = STAR_SCORE_CEILING - STAR_SCORE_FLOOR
  const fraction = Math.min(1, Math.max(0, (score - STAR_SCORE_FLOOR) / span))
  const stars = 1 + Math.round(fraction * (ROUTE_RATING_MAX_STARS - 1))
  return Math.min(ROUTE_RATING_MAX_STARS, Math.max(1, stars))
}