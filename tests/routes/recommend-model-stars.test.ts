/**
 * 系统默认星级推荐：**选路打分的投影**（2026-11-16 合并两套排序）。
 *
 * 这里钉的不是几个手挑的数字，而是三件事：
 *
 * 1. **同尺**：星级由 `scoreFactors` 那张因子表在参考画像下求值再压到 1..5，与
 *    真实派发同一组权重。改权重则两处一起动 —— 所以下面直接对拍分数，而不是复述
 *    公式（复述一份就等于又写了一套）。
 * 2. **单调**：分数涨，星不可能跌。「星级优先」的显示排序因此与打分排序同向，
 *    不会再出现「推荐第一、派发第五」。
 * 3. **资格事实与钱**：熔断 / 零账号 / 这一轮被跳过 / 余量见底按 `STAR_SCORE_STEP`
 *    扣分（一颗星在两种口径里是同一个量）；余额（`no-credit`）不改星。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  recommendModelStars,
  scoreFactors,
  sumScoreFactors,
  STAR_REFERENCE_PROFILE,
  STAR_REFERENCE_PREFER,
  STAR_REFERENCE_STRATEGY,
} from '../../src/main/proxy/autoRouting.ts'
import {
  STAR_SCORE_CEILING,
  STAR_SCORE_FLOOR,
  STAR_SCORE_STEP,
  starsFromScore,
} from '../../src/shared/modelRecommendation.ts'
import { ROUTE_RATING_MAX_STARS } from '../../src/shared/types.ts'

const healthy = { accountCount: 1, circuitActive: false }

/** 同一个候选在参考画像下的原始分数：星级必须是它的映射，不是另算的。 */
function referenceScore(input: {
  tier: 'fast' | 'balanced' | 'strong'
  costBucket?: 'free' | 'below-base' | 'base' | 'above-base' | 'unknown'
  ewmaFirstTokenMs?: number
}): number {
  const factors = scoreFactors(
    STAR_REFERENCE_PROFILE,
    {
      providerId: 'p',
      providerName: 'P',
      displayName: 'm',
      actualModelId: 'm',
      accountId: 'a',
      ...(input.costBucket === undefined ? {} : { costBucket: input.costBucket }),
      ...(input.ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs: input.ewmaFirstTokenMs }),
    },
    { tier: input.tier, tools: 'unknown', reasoning: 'unknown' },
    0,
    0,
    STAR_REFERENCE_STRATEGY,
    0,
    STAR_REFERENCE_PREFER
  )
  return sumScoreFactors(factors.filter(factor => factor.id !== 'dispersion' && factor.id !== 'sticky'))
}

test('星级就是参考分数的映射：不是第二套公式', () => {
  for (const tier of ['fast', 'balanced', 'strong'] as const) {
    for (const costBucket of [undefined, 'free', 'below-base', 'base', 'above-base'] as const) {
      for (const ewmaFirstTokenMs of [undefined, 800, 4000, 20000]) {
        const score = referenceScore({
          tier,
          ...(costBucket === undefined ? {} : { costBucket }),
          ...(ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs }),
        })
        const projected = starsFromScore(score)
        const actual = recommendModelStars({
          tier,
          ...healthy,
          ...(costBucket === undefined ? {} : { costBucket }),
          ...(ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs }),
        })
        assert.equal(actual, projected, `${tier}/${costBucket}/${ewmaFirstTokenMs}: 星与分数脱钩了`)
      }
    }
  }
})

test('档位在参考画像下仍读出 4/3/2：尺子的两端与档位直觉对齐', () => {
  assert.equal(recommendModelStars({ tier: 'strong', ...healthy }), 4)
  assert.equal(recommendModelStars({ tier: 'balanced', ...healthy }), 3)
  assert.equal(recommendModelStars({ tier: 'fast', ...healthy }), 2)
  // 三个分数都在 0.5..1 之内（基础因子份量之和为 1），端点因此不是随手取的。
  for (const tier of ['fast', 'balanced', 'strong'] as const) {
    const score = referenceScore({ tier })
    assert.ok(score > STAR_SCORE_FLOOR && score < STAR_SCORE_CEILING,
      `${tier} 的参考分数 ${score} 落在尺子外，端点假设已失效`)
  }
})

test('单调：参考分数高的候选，星只会相等或更多', () => {
  const rows: { score: number, stars: number }[] = []
  for (const tier of ['fast', 'balanced', 'strong'] as const) {
    for (const costBucket of [undefined, 'free', 'below-base', 'base', 'above-base'] as const) {
      for (const ewmaFirstTokenMs of [undefined, 800, 4000, 20000, 60000]) {
        rows.push({
          score: referenceScore({ tier, ...(costBucket === undefined ? {} : { costBucket }), ...(ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs }) }),
          stars: recommendModelStars({ tier, ...healthy, ...(costBucket === undefined ? {} : { costBucket }), ...(ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs }) }),
        })
      }
    }
  }
  rows.sort((a, b) => a.score - b.score)
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i]!.stars >= rows[i - 1]!.stars,
      `分数 ${rows[i - 1]!.score} → ${rows[i]!.score} 涨了，星却从 ${rows[i - 1]!.stars} 掉到 ${rows[i]!.stars}`)
  }
})

test('成本档进星：免费 +1 星，高于基准 -1 星，未知中性', () => {
  assert.equal(recommendModelStars({ tier: 'balanced', costBucket: 'free', ...healthy }), 4)
  assert.equal(recommendModelStars({ tier: 'balanced', costBucket: 'above-base', ...healthy }), 2)
  // 未知与基准价同分：没有倍率不等于免费，也不等于贵。
  assert.equal(
    recommendModelStars({ tier: 'balanced', costBucket: 'unknown', ...healthy }),
    recommendModelStars({ tier: 'balanced', costBucket: 'base', ...healthy }),
  )
  // 最强 + 免费顶到 5，但不会越过上限。
  assert.equal(recommendModelStars({ tier: 'strong', costBucket: 'free', ...healthy }), ROUTE_RATING_MAX_STARS)
})

test('首字延迟：越慢越少星，没有读数不猜', () => {
  const none = recommendModelStars({ tier: 'strong', ...healthy })
  const fast = recommendModelStars({ tier: 'strong', ewmaFirstTokenMs: 800, ...healthy })
  const slow = recommendModelStars({ tier: 'strong', ewmaFirstTokenMs: 60_000, ...healthy })
  assert.equal(fast, none, '快读数只抵得上一小截罚分，不改一整颗星')
  assert.ok(slow < none, '明显更慢必须更少星')
  assert.equal(recommendModelStars({ tier: 'balanced', ewmaFirstTokenMs: 60_000, ...healthy }), 1)
})

test('健康与资格：熔断 -2 星、零账号 -2 星，可叠加', () => {
  assert.equal(recommendModelStars({ tier: 'strong', circuitActive: true, accountCount: 1 }), 2)
  assert.equal(recommendModelStars({ tier: 'strong', circuitActive: false, accountCount: 0 }), 2)
  assert.equal(recommendModelStars({ tier: 'strong', circuitActive: true, accountCount: 0 }), 1)
})

test('夹到 1..5：最强最快不超 5，最慢最弱不低于 1', () => {
  assert.equal(
    recommendModelStars({ tier: 'strong', costBucket: 'free', ewmaFirstTokenMs: 100, ...healthy }),
    ROUTE_RATING_MAX_STARS,
  )
  assert.equal(recommendModelStars({ tier: 'fast', ewmaFirstTokenMs: 9000, circuitActive: true, accountCount: 0 }), 1)
  // 极端分数也只在 1..5 里：非有限数按最低星（宁可说小，不说大）。
  assert.equal(starsFromScore(Number.NaN), 1)
  assert.equal(starsFromScore(99), ROUTE_RATING_MAX_STARS)
  assert.equal(starsFromScore(-99), 1)
})

// —— 推荐队列：这一轮能不能派，与余量档，是两个正交的读数。
test('这一轮会被跳过：非钱的原因扣 2 星，与零账号同强度', () => {
  assert.equal(recommendModelStars({ tier: 'strong', blocked: 'quota-exhausted', ...healthy }), 2)
  assert.equal(recommendModelStars({ tier: 'strong', blocked: 'declared-exhausted', ...healthy }), 2)
  assert.equal(recommendModelStars({ tier: 'strong', blocked: 'daily_limit', ...healthy }), 2)
  assert.equal(recommendModelStars({ tier: 'strong', blocked: 'rate_limited', ...healthy }), 2)
  assert.equal(recommendModelStars({ tier: 'balanced', blocked: 'rpd_exhausted', ...healthy }), 1)
  // 与「熔断」「零账号」叠加，但最终仍夹在 1..5。
  assert.equal(recommendModelStars({ tier: 'fast', blocked: 'tpm_exhausted', circuitActive: true, accountCount: 0 }), 1)
})

test('钱不改星：余额是 USD/CNY，换算成减几颗星就是替厂商发明换算率', () => {
  assert.equal(
    recommendModelStars({ tier: 'strong', blocked: 'no-credit', ...healthy }),
    recommendModelStars({ tier: 'strong', ...healthy }),
    'a credit block leaves the star count alone — it shows as a "go top up" line instead',
  )
})

test('余量见底只扣一颗：还能派，不吞掉它的质量优势', () => {
  assert.equal(recommendModelStars({ tier: 'strong', quotaBand: 'tight', ...healthy }), 3)
  assert.equal(recommendModelStars({ tier: 'balanced', quotaBand: 'tight', ...healthy }), 2)
  // 不知道（undocumented）与充裕（ample）都不扣：不知道不等于不够。
  assert.equal(recommendModelStars({ tier: 'strong', quotaBand: 'undocumented', ...healthy }), 4)
  assert.equal(recommendModelStars({ tier: 'strong', quotaBand: 'ample', ...healthy }), 4)
})

test('被跳过 与 余量见底 同时成立时各自计一次，钱仍然免责', () => {
  assert.equal(recommendModelStars({ tier: 'strong', blocked: 'quota-exhausted', quotaBand: 'tight', ...healthy }), 1)
  assert.equal(recommendModelStars({ tier: 'strong', blocked: 'no-credit', quotaBand: 'tight', ...healthy }), 3)
})

test('Bandit 战绩进星：好战绩抬星、连败压星、样本不足不动', () => {
  const base = recommendModelStars({ tier: 'strong', ...healthy })
  const good = recommendModelStars({
    tier: 'strong', ...healthy, live: { total: 40, successes: 40 },
  })
  const bad = recommendModelStars({
    tier: 'strong', ...healthy, live: { total: 40, successes: 0, attemptTotal: 40, attemptFailures: 40 },
  })
  const cold = recommendModelStars({ tier: 'strong', ...healthy, live: { total: 2, successes: 2 } })
  assert.ok(good > base, '24h 全胜的模型该比没战绩的高')
  assert.ok(bad < base, '24h 连败的模型该比没战绩的低')
  assert.equal(cold, base, '冷启动乐观先验：样本不足不做调整')
})

test('资格事实的扣分走同一把尺子：2 星 = 2 × STAR_SCORE_STEP', () => {
  // 这条钉的是「不许在别处直接减星」：星级扣分与打分扣分必须是同一个单位。
  assert.equal(recommendModelStars({ tier: 'strong', circuitActive: true, accountCount: 1 }),
    starsFromScore(referenceScore({ tier: 'strong' }) - 2 * STAR_SCORE_STEP))
  assert.equal(recommendModelStars({ tier: 'strong', quotaBand: 'tight', ...healthy }),
    starsFromScore(referenceScore({ tier: 'strong' }) - STAR_SCORE_STEP))
})