/**
 * 路由内硬比例配额的纯决策层契约。
 *
 * 证明的层次：`autoRouting.ts::rankCandidates` 的缺陷排序与 `dispatchLedger` 的
 * 路由作用域读数。不碰 store / Electron / 上游网络（那条路径由 routes 集成测试证明）。
 *
 * 三条不变量：
 * - 配额只在**通过冷却与能力硬筛之后**改变次序，不把不可用的模型拉回来；
 * - 未列入的模型共享残额，重点模型全挂时残额放大到 100%；
 * - 没配配额时原有 score → fairnessLead 路径逐字节不变。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  profileRequest,
  rankCandidates,
  type PoolStrategyCandidate,
  type RankCandidate,
} from '../../src/main/proxy/autoRouting.ts'
import {
  DISPATCH_WINDOW_MS,
  dispatchKeyOf,
  dispatchLedger,
} from '../../src/main/proxy/dispatchLedger.ts'

const NOW = 1_800_000_000_000
const PROFILE = profileRequest({
  model: 'auto',
  messages: [{ role: 'user', content: 'short question' }],
})

function candidate(providerId: string, displayName: string, overrides: Partial<RankCandidate> = {}): PoolStrategyCandidate {
  return {
    providerId,
    providerName: providerId,
    displayName,
    actualModelId: displayName.toLowerCase(),
    accountId: `${providerId}-acct`,
    providerType: 'custom',
    ...overrides,
  }
}

/** 用账本里的次数跑一次排序：账本是「已经派了多少」，返回值是「下一个该派谁」。 */
function nextPick(
  candidates: PoolStrategyCandidate[],
  shares: Record<string, number>,
  counts: Record<string, number>,
  unlistedShare = 20,
): string {
  const sharesByName = new Map(Object.entries(shares))
  const countsByName = new Map(Object.entries(counts))
  const ranked = rankCandidates(PROFILE, candidates, {
    now: NOW,
    limit: 1,
    weightedDispatch: { shares: sharesByName, counts: countsByName, unlistedShare },
  })
  return ranked[0]?.displayName ?? ''
}

beforeEach(() => {
  dispatchLedger.reset()
})

test('账本按路由分开记：全局快照只见全局账，路由快照只见自己那条', () => {
  dispatchLedger.record('pa', 'model-a', NOW, 'route-a')
  dispatchLedger.record('pa', 'model-a', NOW, 'route-b')
  dispatchLedger.record('pa', 'model-a', NOW)

  const global = dispatchLedger.snapshot(NOW)
  const routeA = dispatchLedger.snapshot(NOW, 'route-a')
  assert.equal(global.total, 1)
  assert.equal(global.counts.get(dispatchKeyOf('pa', 'model-a')), 1)
  assert.equal(routeA.total, 1)
  assert.equal(routeA.counts.get(dispatchKeyOf('pa', 'model-a')), 1)
  assert.equal(dispatchLedger.snapshot(NOW, 'route-c').total, 0)

  // 路由账也按 30 分钟窗口过期，不能让上小时的欠债跟到今天。
  dispatchLedger.record('pa', 'model-a', NOW + DISPATCH_WINDOW_MS, 'route-a')
  assert.equal(dispatchLedger.snapshot(NOW + DISPATCH_WINDOW_MS + 1, 'route-a').total, 1)
})

test('权重压过分差：欠得最多的重点模型排到队首', () => {
  const a = candidate('pa', 'model-a')
  const b = candidate('pb', 'model-b')
  const c = candidate('pc', 'model-c')
  const all = [a, b, c]

  // a 已经派了 8 次，b 1 次，c 3 次。a/b 的相对份额 16:16 被归一到重点合计
  // 80%，c 拿 20%；b 的缺陷明显更大，即使自然分更低也应该先派 b。
  const pick = nextPick(all, { 'pa\u0000model-a': 16, 'pb\u0000model-b': 16 }, {
    'pa\u0000model-a': 8,
    'pb\u0000model-b': 1,
    'pc\u0000model-c': 3,
  })
  assert.equal(pick, 'model-b')
})

test('未列入的候选共享残额：重点模型都派过时由备用模型接手', () => {
  const all = [
    candidate('pa', 'model-a'),
    candidate('pb', 'model-b'),
    candidate('pc', 'model-c'),
    candidate('pd', 'model-d'),
  ]
  const pick = nextPick(all, { 'pa\u0000model-a': 16, 'pb\u0000model-b': 16 }, {
    'pa\u0000model-a': 16,
    'pb\u0000model-b': 16,
    'pc\u0000model-c': 3,
    'pd\u0000model-d': 3,
  })
  // 两个未列入模型平分 20%；重点合计归一到 80%，总派发 38 次时备用各欠 3.8，
  // 同缺陷组按原分数 tiebreak。
  assert.ok(['model-c', 'model-d'].includes(pick))
})

test('重点模型不可用时不占份额：剩余重点重新归一化，残额保持固定', () => {
  const all = [
    candidate('pa', 'model-a'),
    candidate('pb', 'model-b', { coolingUntil: NOW + 60_000 }),
    candidate('pc', 'model-c'),
  ]
  const ranked = rankCandidates(PROFILE, all, {
    now: NOW,
    limit: 3,
    weightedDispatch: {
      shares: new Map([['pa\u0000model-a', 16], ['pb\u0000model-b', 16]]),
      counts: new Map([['pa\u0000model-a', 10], ['pc\u0000model-c', 0]]),
      unlistedShare: 20,
    },
  })
  // 冷却的 b 不在池里；剩下的 a 按原份额吸收到重点合计 80%，目标 8，实际 10，
  // 缺陷为负；c 拿固定的 20% 残额，目标 2，实际 0，必须排在 a 前面。
  assert.deepEqual(ranked.map(entry => entry.displayName), ['model-c', 'model-a'])
})

test('重点模型部分冷却时，剩余重点吸收份额而残额仍是 20%', () => {
  // 四个重点里两个冷却，池里只剩 a/d 与一个未列入的 e。若剩余重点不重新归一，
  // 未列入的会拿到 20/(20+20+20)≈33%；正确行为是 40% / 40% / 20%。
  const all = [
    candidate('pa', 'model-a'),
    candidate('pb', 'model-b', { coolingUntil: NOW + 60_000 }),
    candidate('pc', 'model-c', { coolingUntil: NOW + 60_000 }),
    candidate('pd', 'model-d'),
    candidate('pe', 'model-e'),
  ]
  const shares = new Map([
    ['pa\u0000model-a', 20],
    ['pb\u0000model-b', 20],
    ['pc\u0000model-c', 20],
    ['pd\u0000model-d', 20],
  ])
  const counts = new Map<string, number>()
  const picks: Record<string, number> = {}
  for (let i = 0; i < 60; i += 1) {
    const ranked = rankCandidates(PROFILE, all, {
      now: NOW,
      limit: 1,
      weightedDispatch: { shares, counts, unlistedShare: 20 },
    })
    const key = `${ranked[0]!.providerId}\u0000${ranked[0]!.displayName}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    picks[ranked[0]!.displayName] = (picks[ranked[0]!.displayName] ?? 0) + 1
  }
  assert.deepEqual(Object.keys(picks).sort(), ['model-a', 'model-d', 'model-e'])
  assert.ok(picks['model-a']! >= 22 && picks['model-a']! <= 26, JSON.stringify(picks))
  assert.ok(picks['model-d']! >= 22 && picks['model-d']! <= 26, JSON.stringify(picks))
  assert.ok(picks['model-e']! >= 9 && picks['model-e']! <= 15, JSON.stringify(picks))
})

test('重点模型全挂时残额放大到 100%，空分母不产生 NaN 排序', () => {
  const all = [candidate('pc', 'model-c'), candidate('pd', 'model-d')]
  const ranked = rankCandidates(PROFILE, all, {
    now: NOW,
    limit: 2,
    weightedDispatch: {
      shares: new Map([['pa\u0000model-a', 16]]),
      counts: new Map([['pc\u0000model-c', 20], ['pd\u0000model-d', 0]]),
      unlistedShare: 0,
    },
  })
  assert.deepEqual(ranked.map(entry => entry.displayName), ['model-d', 'model-c'])
})

test('没有配额入参时保持原排序：星级/分数/fairness 路径一行不变', () => {
  const all = [candidate('pa', 'model-a'), candidate('pb', 'model-b')]
  const plain = rankCandidates(PROFILE, all, { now: NOW, limit: 2, strategy: 'fill-first' })
  const withUnusedLedger = rankCandidates(PROFILE, all, {
    now: NOW,
    limit: 2,
    strategy: 'fill-first',
    fairness: { lead: 2 },
  })
  assert.deepEqual(plain.map(entry => entry.displayName), withUnusedLedger.map(entry => entry.displayName))
})
