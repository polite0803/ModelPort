/**
 * 系统默认星级推荐（`shared/modelRecommendation.ts`）的纯函数契约。
 *
 * 推导口径必须可复算：档位基线 + 首字延迟加减 + 当前健康扣分，夹到 1..5。
 * 没有延迟读数不加分也不扣分（不猜）；上下文是能力而非质量，刻意不参与。
 * 只作展示：投影与页面读它，选路排序不读它。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { recommendModelStars } from '../../src/shared/modelRecommendation.ts'
import { ROUTE_RATING_MAX_STARS } from '../../src/shared/types.ts'

const healthy = { accountCount: 1, circuitActive: false }

test('档位基线：strong=4 / balanced=3 / fast=2（无延迟读数、健康）', () => {
  assert.equal(recommendModelStars({ tier: 'strong', ...healthy }), 4)
  assert.equal(recommendModelStars({ tier: 'balanced', ...healthy }), 3)
  assert.equal(recommendModelStars({ tier: 'fast', ...healthy }), 2)
})

test('首字延迟：≤1s +1、≥4s -1、中间不动；没有读数不猜', () => {
  assert.equal(recommendModelStars({ tier: 'balanced', ewmaFirstTokenMs: 800, ...healthy }), 4)
  assert.equal(recommendModelStars({ tier: 'balanced', ewmaFirstTokenMs: 1000, ...healthy }), 4)
  assert.equal(recommendModelStars({ tier: 'balanced', ewmaFirstTokenMs: 2000, ...healthy }), 3)
  assert.equal(recommendModelStars({ tier: 'balanced', ewmaFirstTokenMs: 4000, ...healthy }), 2)
  assert.equal(recommendModelStars({ tier: 'balanced', ewmaFirstTokenMs: 9000, ...healthy }), 2)
  assert.equal(recommendModelStars({ tier: 'balanced', ...healthy }), 3)
})

test('健康扣分：熔断 -2、零账号 -2，可叠加', () => {
  assert.equal(recommendModelStars({ tier: 'strong', circuitActive: true, accountCount: 1 }), 2)
  assert.equal(recommendModelStars({ tier: 'strong', circuitActive: false, accountCount: 0 }), 2)
  assert.equal(recommendModelStars({ tier: 'strong', circuitActive: true, accountCount: 0 }), 1)
})

test('夹到 1..5：最快最强不超 5，最慢最弱不低于 1', () => {
  assert.equal(recommendModelStars({ tier: 'strong', ewmaFirstTokenMs: 100, ...healthy }), ROUTE_RATING_MAX_STARS)
  assert.equal(recommendModelStars({ tier: 'fast', ewmaFirstTokenMs: 9000, circuitActive: true, accountCount: 0 }), 1)
})