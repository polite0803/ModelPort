/**
 * PLAN-auto-routing-freellmapi P1-3/P1-4/P2-5 的回归测试。
 *
 * - P1-3 配额余量降权：账本（quota/ledger.ts）、429 学习（learnQuotaCaps）、
 *   前置剔除（quotaBlockReason）都是既有能力，本轮只补「余量进打分」这一环；
 * - P1-4 工具能力位：与 maxTools 同一循环，fail-open（缺省不限）；
 * - P2-5 Bandit：滚动 24h 成功率 + latency p50 加减分，冷启动乐观先验；
 *   第二步把成功率项换成可播种的 Beta 后验采样，安全罚项保持确定性。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BANDIT_MIN_SAMPLES,
  aggregateBanditStats,
  banditAdjustment,
  banditKeyOf,
  createBanditRandom,
  latencyP50,
  sampleBanditSuccessRate,
} from '../../src/main/proxy/autoBandit.ts'
import { rankCandidates, type RankCandidate } from '../../src/main/proxy/autoRouting.ts'

const NOW = 1_800_000_000_000

const autoRoutingSource = readFileSync('src/main/proxy/autoRouting.ts', 'utf-8')
const autoRouterSource = readFileSync('src/main/proxy/autoRouter.ts', 'utf-8')
const autoBanditSource = readFileSync('src/main/proxy/autoBandit.ts', 'utf-8')
const channelsSource = readFileSync('src/shared/channels.ts', 'utf-8')

/* ---------------- P2-5：Bandit 统计与加减分 ---------------- */

function entry(overrides: Partial<{
  timestamp: number
  status: 'success' | 'error'
  latency: number
  providerId: string
  actualModel: string
  finishReason: string
  maxTokens: number
  attempts: Array<{
    providerId: string
    model: string
    outcome: 'success' | 'failover' | 'fatal' | 'capability' | 'client_abort'
    status?: number
    errorCode?: string | number | null
    latencyMs?: number
  }>
}>): {
  timestamp: number
  status: 'success' | 'error'
  latency: number
  providerId?: string
  actualModel?: string
  finishReason?: string
  maxTokens?: number
  attempts?: Array<{
    providerId: string
    model: string
    outcome: 'success' | 'failover' | 'fatal' | 'capability' | 'client_abort'
    status?: number
    errorCode?: string | number | null
    latencyMs?: number
  }>
} {
  return {
    timestamp: NOW - 1000,
    status: 'success',
    latency: 1000,
    providerId: 'loomy',
    actualModel: 'loomy/spark-x2.6',
    ...overrides,
  }
}

test('aggregateBanditStats：滚动 24h 窗口、键聚合、成功率', () => {
  const stats = aggregateBanditStats([
    entry({}),
    entry({}),
    entry({ status: 'error' }),
    // 窗口外：不计入
    entry({ timestamp: NOW - 25 * 60 * 60_000 }),
    // 无法归因：不计入
    entry({ providerId: undefined }),
    entry({ actualModel: undefined }),
  ], NOW)

  const key = banditKeyOf('loomy', 'loomy/spark-x2.6')
  assert.equal(stats.get(key)?.total, 3)
  assert.equal(stats.get(key)?.successes, 2)
})

test('aggregateBanditStats：latency p50（奇偶样本）', () => {
  assert.equal(latencyP50([]), undefined)
  assert.equal(latencyP50([300, 100, 200]), 200)
  assert.equal(latencyP50([400, 100, 300, 200]), 250)
})

test('banditAdjustment：冷启动乐观先验 —— 无样本/样本不足不调整', () => {
  assert.equal(banditAdjustment(undefined), 0)
  assert.equal(banditAdjustment({ total: BANDIT_MIN_SAMPLES - 1, successes: 0 }), 0)
  assert.equal(
    banditAdjustment({ total: BANDIT_MIN_SAMPLES - 1, successes: 0 }, createBanditRandom(123)),
    0,
    'Thompson 只作用于有足够战绩的候选，不让新候选被先验噪声压住',
  )
})

test('Thompson：后验采样可复现，强/弱候选的期望分界保留', () => {
  const strong = { total: 20, successes: 20 }
  const weak = { total: 20, successes: 0 }
  const strongFirst = banditAdjustment(strong, createBanditRandom(42))
  assert.equal(strongFirst, banditAdjustment(strong, createBanditRandom(42)), '同 seed 必须可复现')
  assert.ok(strongFirst > 0)
  assert.ok(banditAdjustment(weak, createBanditRandom(42)) < 0)

  const rate = sampleBanditSuccessRate(strong, createBanditRandom(42))
  assert.equal(rate, sampleBanditSuccessRate(strong, createBanditRandom(42)))
  assert.ok(rate > 0.5)
  assert.ok(sampleBanditSuccessRate(weak, createBanditRandom(42)) < 0.5)
})

test('Thompson：degraded 成功从后验分子移出，等同失败证据', () => {
  const clean = sampleBanditSuccessRate({ total: 10, successes: 8 }, createBanditRandom(7))
  const degraded = sampleBanditSuccessRate(
    { total: 10, successes: 8, degraded: 4 },
    createBanditRandom(7),
  )
  assert.ok(clean > degraded, '不可用成功必须比干净成功更不像可用候选')
})

test('Thompson：安全罚项确定性执行，不随 seed 抖动', () => {
  const seeds = [1, 7, 42, 991, 0x7fffffff]
  const cases = [
    { total: 2, successes: 2, degraded: 2, consecutiveDegraded: 2 },
    { total: 0, successes: 0, attemptTotal: 2, attemptFailures: 2, consecutiveFailures: 2 },
  ] as const
  for (const stats of cases) {
    const expected = banditAdjustment(stats, createBanditRandom(42))
    for (const seed of seeds) {
      assert.equal(banditAdjustment(stats, createBanditRandom(seed)), expected)
    }
  }

  const sampled = { total: 10, successes: 0 }
  const base = banditAdjustment(sampled, createBanditRandom(42))
  const slow = banditAdjustment(
    { ...sampled, latencyP50Ms: 31_000 },
    createBanditRandom(42),
  )
  assert.equal(slow - base, -0.05, '慢 p50 罚项加在采样后的成功率项上，但本身不随机')
})

test('banditAdjustment：成功率说话，显著慢再轻罚', () => {
  // 全成 → +0.075；全败 → -0.075
  assert.ok(banditAdjustment({ total: 10, successes: 10 }) > 0.07)
  assert.ok(banditAdjustment({ total: 10, successes: 0 }) < -0.07)
  // 半成半败 → 0
  assert.equal(banditAdjustment({ total: 10, successes: 5 }), 0)
  // 显著慢（p50 > 30s）再扣 0.05
  const fast = banditAdjustment({ total: 10, successes: 0 })
  const slow = banditAdjustment({ total: 10, successes: 0, latencyP50Ms: 31_000 })
  assert.equal(slow - fast, -0.05)
})

test('degraded：未请求上限却 finish_reason=length 记为不可用成功，客户端主动截断不算', () => {
  const key = banditKeyOf('loomy', 'loomy/spark-x2.6')
  const stats = aggregateBanditStats([
    // 输入按最新在前；聚合内部按时间升序算连续次数。
    entry({ timestamp: NOW - 1000, finishReason: 'length' }),
    entry({ timestamp: NOW - 2000, finishReason: 'length' }),
    entry({ timestamp: NOW - 3000, finishReason: 'stop' }),
  ], NOW).get(key)

  assert.deepEqual(stats, {
    total: 3,
    successes: 3,
    degraded: 2,
    consecutiveDegraded: 2,
    latencyP50Ms: 1000,
  })

  const capped = aggregateBanditStats([
    entry({ timestamp: NOW - 1000, finishReason: 'length', maxTokens: 4096 }),
  ], NOW).get(key)
  assert.equal(capped?.degraded, 0, '客户端显式 max_tokens 的 length 是预期截断，不降权')
})

test('degraded：连续两次不可用成功直接重罚，正常一轮会重置连续计数', () => {
  assert.equal(
    banditAdjustment({ total: 2, successes: 2, degraded: 2, consecutiveDegraded: 2 }),
    -0.3,
    '样本不足 5 也要立刻降权',
  )

  const key = banditKeyOf('loomy', 'loomy/spark-x2.6')
  const reset = aggregateBanditStats([
    entry({ timestamp: NOW - 1000, finishReason: 'stop' }),
    entry({ timestamp: NOW - 2000, finishReason: 'length' }),
    entry({ timestamp: NOW - 3000, finishReason: 'length' }),
  ], NOW).get(key)
  assert.equal(reset?.degraded, 2)
  assert.equal(reset?.consecutiveDegraded, 0, '随后一次 stop 必须重置连续计数')

  const mixed = banditAdjustment({ total: 10, successes: 8, degraded: 2, consecutiveDegraded: 0 })
  const clean = banditAdjustment({ total: 10, successes: 8, degraded: 0, consecutiveDegraded: 0 })
  assert.ok(mixed < clean, '混有截断成功的模型必须比干净模型分低')
})

test('attempt health：成功行里的失败尝试也要记到失败候选头上', () => {
  const failed = 'opencode/nemotron-3-ultra-free'
  const winner = 'gpt-oss-120b'
  const stats = aggregateBanditStats([
    entry({
      timestamp: NOW - 1000,
      providerId: 'ovh',
      actualModel: winner,
      attempts: [
        { providerId: 'opencode', model: failed, outcome: 'capability', status: 404, latencyMs: 200 },
        { providerId: 'ovh', model: winner, outcome: 'success', status: 200, latencyMs: 2000 },
      ],
    }),
  ], NOW)

  const bad = stats.get(banditKeyOf('opencode', failed))
  assert.equal(bad?.attemptTotal, 1)
  assert.equal(bad?.attemptFailures, 1)
  assert.equal(bad?.consecutiveFailures, 1)
  assert.equal(banditAdjustment(bad), 0, '单次 404 可能只是目录漂移，不能立刻踢出候选')

  const good = stats.get(banditKeyOf('ovh', winner))
  assert.equal(good?.attemptTotal, 1)
  assert.equal(good?.attemptFailures, undefined)
  assert.equal(banditAdjustment(good), 0)

  const twice = aggregateBanditStats([
    entry({
      timestamp: NOW - 1000,
      attempts: [
        { providerId: 'opencode', model: failed, outcome: 'capability', status: 404 },
        { providerId: 'ovh', model: winner, outcome: 'success', status: 200 },
      ],
    }),
    entry({
      timestamp: NOW - 2000,
      attempts: [
        { providerId: 'opencode', model: failed, outcome: 'capability', status: 404 },
        { providerId: 'ovh', model: winner, outcome: 'success', status: 200 },
      ],
    }),
  ], NOW).get(banditKeyOf('opencode', failed))
  assert.equal(twice?.consecutiveFailures, 2)
  assert.equal(banditAdjustment(twice), -0.5, '连续两次失败才显著降权')
})

test('attempt health：连续两次失败立即重罚，成功一次会重置连续计数', () => {
  const model = 'workbuddy/hy3'
  const twoFails = aggregateBanditStats([
    entry({
      timestamp: NOW - 1000,
      attempts: [
        { providerId: 'workbuddy', model, outcome: 'failover', status: 502 },
        { providerId: 'workbuddy', model, outcome: 'failover', status: 502 },
      ],
    }),
  ], NOW).get(banditKeyOf('workbuddy', model))
  assert.equal(twoFails?.consecutiveFailures, 2)
  assert.equal(banditAdjustment(twoFails), -0.5)

  const recovered = aggregateBanditStats([
    entry({
      timestamp: NOW - 1000,
      attempts: [
        { providerId: 'workbuddy', model, outcome: 'failover', status: 502 },
        { providerId: 'workbuddy', model, outcome: 'success', status: 200 },
      ],
    }),
  ], NOW).get(banditKeyOf('workbuddy', model))
  assert.equal(recovered?.consecutiveFailures, 0)
  assert.equal(banditAdjustment(recovered), 0, '最近一次已成功，不再按硬失败惩罚')
})

test('attempt health：风控/重登属于硬失败，客户端自身 400 与 abort 不计', () => {
  const risk = aggregateBanditStats([
    entry({
      timestamp: NOW - 1000,
      attempts: [
        { providerId: 'workbuddy', model: 'workbuddy/hy3', outcome: 'fatal', status: 400, errorCode: 'channel_risk_control' },
        { providerId: 'workbuddy', model: 'workbuddy/hy3', outcome: 'fatal', status: 400, errorCode: 'channel_risk_control' },
        { providerId: 'client', model: 'client/model', outcome: 'fatal', status: 400 },
        { providerId: 'client', model: 'client/model', outcome: 'client_abort' },
      ],
    }),
  ], NOW)

  const risky = risk.get(banditKeyOf('workbuddy', 'workbuddy/hy3'))
  assert.equal(risky?.attemptFailures, 2)
  assert.equal(banditAdjustment(risky), -0.5)

  assert.equal(risk.get(banditKeyOf('client', 'client/model')), undefined, '客户端错误不能算到模型头上')
})

test('rankCandidates：有失败尝试的候选要排在同分健康候选之后', () => {
  const base = {
    providerId: 'p',
    providerName: 'P',
    displayName: 'm',
    actualModelId: 'm',
    contractCapable: true,
    costBucket: 'unknown' as const,
  }
  const failed: RankCandidate = {
    ...base,
    accountId: 'failed',
    live: {
      total: 0,
      successes: 0,
      attemptTotal: 2,
      attemptFailures: 2,
      consecutiveFailures: 2,
    },
  }
  const fresh: RankCandidate = { ...base, accountId: 'fresh' }

  const ranked = rankCandidates(
    { complexity: 'standard', needsTools: false, needsVision: false, estimatedTokens: 0 },
    [failed, fresh],
    { now: NOW, limit: 2, seed: 0, strategy: 'round-robin', prefer: 'balanced' }
  )
  assert.equal(ranked[0]?.accountId, 'fresh')
})

test('rankCandidates：Bandit 战绩要能改写同分候选的排序', () => {
  const base = {
    providerId: 'p',
    providerName: 'P',
    displayName: 'm',
    actualModelId: 'm',
    contractCapable: true,
    costBucket: 'unknown' as const,
  }
  const good: RankCandidate = {
    ...base,
    accountId: 'a1',
    live: { total: 10, successes: 10 },
  }
  const bad: RankCandidate = {
    ...base,
    accountId: 'a2',
    live: { total: 10, successes: 0 },
  }

  const ranked = rankCandidates(
    { complexity: 'standard', needsTools: false, needsVision: false, estimatedTokens: 0 },
    [bad, good],
    { now: NOW, limit: 2, seed: 0, strategy: 'round-robin', prefer: 'balanced' }
  )
  assert.equal(ranked[0]?.accountId, 'a1', '高成功率候选应排前')
})

test('rankCandidates：Thompson 采样必须由候选身份 + 每请求 seed 派生', () => {
  // 负控：如果接线退回第一步的点估计，这里会红。
  assert.match(
    autoRoutingSource,
    /createBanditRandom\(\r?\n\s*\(seed \^ hashString\(/,
    'Thompson seed must combine the per-request seed and candidate identity',
  )
  assert.match(
    autoRoutingSource,
    /banditAdjustment\(candidate\.live, liveRandom\)/,
    'the live score must consume the sampled posterior',
  )
  // 负控：如果实现丢掉采样器或随机化安全罚项，这里会红。
  assert.match(autoBanditSource, /sampleBanditSuccessRate\(/)
  assert.match(
    autoBanditSource,
    /const sampled = random !== undefined/,
    'cold-start and deterministic penalties must remain outside Thompson',
  )
  assert.match(
    autoBanditSource,
    /if \(consecutiveDegraded >= 2\)/,
    'repeated unusable successes must stay an immediate deterministic penalty',
  )
  assert.match(
    autoBanditSource,
    /if \(consecutive >= 2\) return -0\.5/,
    'attempt failure streaks must stay deterministic',
  )
})

/* ---------------- P1-3：配额余量降权 ---------------- */

test('rankCandidates：余量 <10% 的候选要被降权（耗尽的早被前置剔除）', () => {
  const base = {
    providerId: 'p',
    providerName: 'P',
    displayName: 'm',
    actualModelId: 'm',
    contractCapable: true,
    costBucket: 'unknown' as const,
  }
  const fresh: RankCandidate = { ...base, accountId: 'a1', quotaHeadroom: 1 }
  const nearly: RankCandidate = { ...base, accountId: 'a2', quotaHeadroom: 0.05 }

  const ranked = rankCandidates(
    { complexity: 'standard', needsTools: false, needsVision: false, estimatedTokens: 0 },
    [nearly, fresh],
    { now: NOW, limit: 2, seed: 0, strategy: 'round-robin', prefer: 'balanced' }
  )
  assert.equal(ranked[0]?.accountId, 'a1', '余量充足的候选应排前')

  // 无帽（0.5 中性）不扣分：与余量充足者同分时按稳定序并列，不因 headroom 落后。
  // 用 fill-first 而不是 round-robin：后者的按账号抖动（dispersion，≤0.00086）
  // 会让严格同分的两个候选顺序随 accountId 的哈希翻转，这里的断言考的是
  // quotaPenalty 语义，不该被轮转噪声劫持。
  const uncaped: RankCandidate = { ...base, accountId: 'a3', quotaHeadroom: 0.5 }
  const ranked2 = rankCandidates(
    { complexity: 'standard', needsTools: false, needsVision: false, estimatedTokens: 0 },
    [uncaped, fresh],
    { now: NOW, limit: 2, seed: 0, strategy: 'fill-first', prefer: 'balanced' }
  )
  assert.equal(ranked2[0]?.accountId, fresh.accountId, '中性 0.5 不得比余量 1.0 排前')
})

test('autoRouter 必须把账本余量与 Bandit 战绩喂进打分（源码钉点）', () => {
  // Bandit 表每请求聚合一次
  assert.match(
    autoRouterSource,
    /aggregateBanditStats\(storeManager\.getRequestLogs\(\), now\)/,
    'select must aggregate the 24h bandit table from the request-log memory copy',
  )
  // 余量只对聚合目录候选计算（账号渠道的帽在渠道 worker 内部）
  assert.match(
    autoRouterSource,
    /provider\.type === 'aggregate'\r?\n\s*\? aggregateHeadroom\(provider\.id, model\.actualModelId, gateContext\)/,
    'quota headroom must come from the existing gate, only for aggregate candidates',
  )
  // 闸门读取按一次选号复用：加密 store 每次 get 都整份解密，逐候选问会把主进程钉在同步 I/O 上
  assert.match(
    autoRouterSource,
    /const gateContext = createQuotaGateContext\(\)/,
    'select must build one gate context per candidate pass',
  )
  assert.match(
    autoRouterSource,
    /quotaBlockReason\(provider, account\.id, model\.actualModelId, gateContext\)/,
    'quotaBlockReason must use the shared gate context',
  )
  // 打分函数的两个新因子要进总分（钉 balanced 主路径与 fill-first）
  assert.match(autoRoutingSource, /- penalty - quotaPenalty - operationalPenalty \+ costBonus \+ stickyBonus \+ liveBonus/)
  assert.match(autoRoutingSource, /0\.1 \* \(1 - candidate\.quotaHeadroom \/ 0\.1\)/)
  assert.match(autoRoutingSource, /candidate\.ewmaFirstTokenMs \/ 60_000/)
  assert.match(autoRoutingSource, /candidate\.rateLimitedRate \?\? 0/)
  assert.match(autoRoutingSource, /candidate\.modelInFlight \?\? candidate\.inFlight \?\? 0/)
})

/* ---------------- P1-4：工具能力位（与 maxTools 同一循环） ---------------- */

test('ChannelDefinition 必须有 capabilities.tools 能力位（fail-open 语义）', () => {
  assert.match(
    channelsSource,
    /capabilities\?: \{\r?\n\s*tools\?: boolean\r?\n\s*\}/,
    'ChannelDefinition must carry the tools capability flag',
  )
})

test('autoRouter 的能力位过滤必须与 maxTools 同一循环且 fail-open（源码钉点）', () => {
  assert.match(
    autoRouterSource,
    /channelDefinition\?\.capabilities\?\.tools === false && toolCount > 0/,
    'only tool-carrying requests are blocked by tools:false; others route normally',
  )
  assert.match(
    autoRouterSource,
    /skipped\.add\(`\$\{provider\.id\}:tools_unsupported`\)/,
    'capability-excluded channels must be recorded as skipped',
  )
})

test('rankCandidates：短窗口首字延迟 / 429 / 超时 / 饱和会把候选压后', () => {
  const base = {
    providerId: 'p',
    providerName: 'P',
    displayName: 'm',
    actualModelId: 'm',
    contractCapable: true,
    costBucket: 'unknown' as const,
  }
  const healthy: RankCandidate = {
    ...base,
    accountId: 'healthy',
    modelInFlight: 0,
    modelLimit: 4,
    ewmaFirstTokenMs: 800,
    rateLimitedRate: 0,
    timeoutRate: 0,
    degradedRate: 0,
  }
  const slow: RankCandidate = {
    ...base,
    accountId: 'slow',
    modelInFlight: 0,
    modelLimit: 4,
    ewmaFirstTokenMs: 60_000,
  }
  const unhealthy: RankCandidate = {
    ...base,
    accountId: 'unhealthy',
    modelInFlight: 0,
    modelLimit: 4,
    ewmaFirstTokenMs: 800,
    rateLimitedRate: 1,
    timeoutRate: 1,
    degradedRate: 1,
  }
  const saturated: RankCandidate = {
    ...base,
    accountId: 'saturated',
    modelInFlight: 4,
    modelLimit: 4,
  }

  const ranked = rankCandidates(
    { complexity: 'standard', needsTools: false, needsVision: false, estimatedTokens: 0 },
    [slow, unhealthy, saturated, healthy],
    { now: NOW, limit: 4, seed: 0, strategy: 'fill-first', prefer: 'balanced' },
  )
  assert.equal(ranked[0]?.accountId, 'healthy')
  assert.ok(ranked.findIndex(c => c.accountId === 'slow') > 0)
  assert.ok(ranked.findIndex(c => c.accountId === 'unhealthy') > 0)
  assert.ok(ranked.findIndex(c => c.accountId === 'saturated') > 0)
})
