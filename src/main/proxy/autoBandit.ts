/**
 * Bandit 实时评分（PLAN-auto-routing-freellmapi P2-5）。
 *
 * 数据源是 request-logs.ndjson 的内存副本：按 `(providerId, actualModel)` 滚动
 * 24h 统计成功率、延迟 p50 与「不可用成功」（HTTP 200 但未请求上限却
 * `finish_reason=length`），作为 auto 打分的加减分因子，替换"候选只能靠静态
 * 启发式排序"的盲区。连续两次不可用成功立即重罚，不等时间窗内的 5 个样本。
 * 第一步用确定性点估计观察真实事故并校准了安全罚项；第二步把「成功率加减
 * 分」换成 Beta 后验采样（Thompson sampling）：强候选大概率得高分，弱候选
 * 仍保留被探索的概率。安全罚项（连续退化、attempt 连败、显著慢）继续
 * 确定性执行，不让随机性稀释事故证据。
 *
 * 设计约束：
 * - **纯函数**：与 autoRouting.ts 同一纪律，node --test 直测，不碰 electron；
 * - **冷启动乐观先验**：无样本或样本过少（< 5 笔）不调整 —— 新账号/新模型
 *   不会被统计空窗永远压住，轮不到就没有数据、没数据就永远轮不到；
 * - **口径诚实**：日志里没有 TTFT 字段，速度用整笔 latency 的 p50 近似
 *   （流式请求含生成时长，噪声大，所以只对显著慢的候选轻惩罚）。
 * - **可复现随机**：Thompson 的后验采样由每请求 seed 派生，同一请求内的
 *   排序可复现；候选身份也进 seed，避免候选在输入数组里的位置改变它自己的
 *   采样。
 * - **两类不可用成功**：`finish_reason=length` 且客户端未请求上限，以及流内重复
 *   退化读数命中（`shared/streamRepetition.ts`）。后者是 2026-11-03 补的：那一类
 *   流 HTTP 200、`finish_reason=tool_calls`，被客户端掐掉后在我们这边只是
 *   `client_abort`，评分上等于没发生。
 */

import type { StreamRepetitionReading } from '../../shared/streamRepetition.ts'

/** One upstream attempt as it appears in a request log row. */
export interface BanditAttemptLogEntry {
  providerId: string
  model: string
  outcome: 'success' | 'failover' | 'fatal' | 'capability' | 'client_abort'
  status?: number
  errorCode?: string | number | null
  latencyMs?: number
}

/** 参与 Bandit 统计的日志最小切片（RequestLogEntry 的相关字段）。 */
export interface BanditLogEntry {
  timestamp: number
  status: 'success' | 'error'
  latency: number
  providerId?: string
  actualModel?: string
  /**
   * `length` means the upstream stopped at its own (or the client's) output cap.
   * Only an unrequested cap is a quality signal; see `isDegradedSuccess`.
   */
  finishReason?: string
  /** Client-requested output cap. Absent when the client sent neither spelling. */
  maxTokens?: number
  /**
   * 流内重复退化读数（`shared/streamRepetition.ts`）。
   *
   * 这是第二类 degraded：协议上一切正常（`finish_reason=tool_calls`、HTTP 200），
   * 但输出内容在尾部窗口里塌成重复行。2026-11-03 的 WorkBuddy 会话就是这一类：
   * 客户端用自己的 REASONING_LOOP 守卫掐掉流 ⇒ 我们这边记成 `client_abort` 并被
   * 评分跳过，粘性于是继续把会话锚在同一家。
   */
  repetition?: StreamRepetitionReading
  /**
   * Per-candidate attempts. A successful row only names the winner at the top
   * level, so without this a candidate that failed earlier in the chain looks
   * like it has no record at all — the 2026-11-02 Codex incident: OpenCode 404
   * and WorkBuddy risk-control were invisible while OVH/Spark kept winning.
   */
  attempts?: readonly BanditAttemptLogEntry[]
}

/** 一个 (provider, model) 的滚动窗口战绩。 */
export interface BanditStats {
  total: number
  successes: number
  latencyP50Ms?: number
  /**
   * Successful HTTP responses that hit an unrequested output cap. They are not
   * usable agent turns even though the transport layer recorded success.
   */
  degraded?: number
  /** Trailing degraded streak, used for immediate demotion without waiting for samples. */
  consecutiveDegraded?: number
  /** All attempts against this candidate (successes + counted failures). */
  attemptTotal?: number
  /** Failed attempts against this candidate in the window. */
  attemptFailures?: number
  /** Trailing failure streak, reset by a successful attempt. */
  consecutiveFailures?: number
}

/** 默认统计窗口：24 小时（与 PLAN 的滚动 24h 口径一致）。 */
export const BANDIT_WINDOW_MS = 24 * 60 * 60_000

/** 样本量下限：低于它的键不参与调整（乐观先验，见模块头注释）。 */
export const BANDIT_MIN_SAMPLES = 5

/** 可播种的 32-bit PRNG；供 Thompson sampling 与测试复现。 */
export type BanditRandom = () => number

/** mulberry32：小而快、可播种，输出 [0,1)。 */
export function createBanditRandom(seed: number): BanditRandom {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

/** Bandit 表的键：与请求日志里的 (providerId, actualModel) 同形。 */
export function banditKeyOf(providerId: string, actualModel: string): string {
  return `${providerId}|${actualModel}`
}

/** p50：偶数样本取中间两数的均值（与常规中位数定义一致）。 */
export function latencyP50(latenciesMs: number[]): number | undefined {
  if (latenciesMs.length === 0) return undefined
  const sorted = [...latenciesMs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 把请求日志折成 Bandit 表：单遍扫描，只保留窗口内的记录。
 * `providerId`/`actualModel` 缺失的条目无法归因，直接跳过。
 */
/**
 * An HTTP-success response that is not a usable agent turn:
 * the upstream stopped at an output cap the **client did not ask for**.
 *
 * A client-requested `max_tokens` is an explicit truncation and must not
 * penalize the model; a missing cap means the model/provider chose a short
 * default (the 2026-11-02 Codex incident: `finish_reason=length`, zero content,
 * 4/5 samples "successful").
 */
export function isDegradedSuccess(entry: BanditLogEntry): boolean {
  if (entry.status !== 'success') return false
  if (entry.repetition?.degraded === true) return true
  if (entry.finishReason !== 'length') return false
  return entry.maxTokens === undefined || entry.maxTokens <= 0
}

export function aggregateBanditStats(
  entries: readonly BanditLogEntry[],
  nowMs: number,
  windowMs: number = BANDIT_WINDOW_MS
): Map<string, BanditStats> {
  const from = nowMs - windowMs
  const latencies = new Map<string, number[]>()
  const table = new Map<string, BanditStats>()

  // Consecutive streaks need chronological order; request logs arrive newest-first.
  const windowed = entries
    .filter(entry => entry.timestamp >= from && entry.timestamp <= nowMs)
    .filter(entry => entry.providerId && entry.actualModel)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)

  for (const entry of windowed) {
    const key = banditKeyOf(entry.providerId!, entry.actualModel!)
    const stats = table.get(key) ?? { total: 0, successes: 0, degraded: 0, consecutiveDegraded: 0 }
    stats.total += 1
    if (entry.status === 'success') stats.successes += 1

    if (isDegradedSuccess(entry)) {
      stats.degraded = (stats.degraded ?? 0) + 1
      stats.consecutiveDegraded = (stats.consecutiveDegraded ?? 0) + 1
    } else {
      stats.consecutiveDegraded = 0
    }
    table.set(key, stats)

    if (typeof entry.latency === 'number' && entry.latency >= 0) {
      const bucket = latencies.get(key) ?? []
      bucket.push(entry.latency)
      latencies.set(key, bucket)
    }
  }

  aggregateAttemptStats(windowed, table)

  for (const [key, bucket] of latencies) {
    const p50 = latencyP50(bucket)
    if (p50 !== undefined) {
      const stats = table.get(key)
      if (stats) stats.latencyP50Ms = p50
    }
  }

  return table
}

/**
 * 从 Beta(successes + 1, failures + 1) 后验采样成功率。
 *
 * degraded 是「HTTP 成功但不可用」，因此从分子移出并计入分母；两个 1 是
 * Beta 先验（等价于观察到一次成败），把 0/0 与 5/5 拉向保守中间值。
 */
export function sampleBanditSuccessRate(
  stats: BanditStats,
  random: BanditRandom
): number {
  const degraded = Math.max(0, Math.min(stats.degraded ?? 0, stats.successes))
  const successes = Math.max(0, stats.successes - degraded)
  const failures = Math.max(0, stats.total - stats.successes) + degraded
  const alpha = sampleGamma(successes + 1, random)
  const beta = sampleGamma(failures + 1, random)
  const denominator = alpha + beta
  return denominator === 0 ? 0.5 : alpha / denominator
}

/**
 * Marsaglia-Tsang gamma sampler。Node 没有 Beta 采样器；两条 Gamma 的商就是
 * Beta。shape >= 1 走 rejection loop，shape < 1 用幂变换折到上一段。
 */
function sampleGamma(shape: number, random: BanditRandom): number {
  if (shape < 1) {
    return sampleGamma(shape + 1, random) * Math.pow(random(), 1 / shape)
  }

  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      // Box-Muller；mulberry32 不会返回 1，0 则由 exp/log 侧安全处理。
      const u1 = random()
      const u2 = random()
      x = Math.sqrt(-2 * Math.log(Math.max(u1, Number.MIN_VALUE)))
        * Math.cos(2 * Math.PI * u2)
      v = Math.pow(1 + c * x, 3)
    } while (v <= 0)

    const u = random()
    if (Math.log(Math.max(u, Number.MIN_VALUE)) < 0.5 * x * x / d) {
      return d * v
    }
  }
}

interface AttemptRecord {
  timestamp: number
  order: number
  providerId: string
  actualModel: string
  status: 'success' | 'error'
}

/**
 * 失败尝试也必须进入候选健康分。请求行的顶层 provider/actualModel 只记最终
 * 赢家；一次成功行里前面的 404/502 不进这张表，失败候选就会永远冷启动、
 * 一直靠静态能力/免费加分留在前排。
 */
function aggregateAttemptStats(
  entries: readonly BanditLogEntry[],
  table: Map<string, BanditStats>
): void {
  const records: AttemptRecord[] = []
  let order = 0
  for (const entry of entries) {
    if (entry.attempts === undefined) continue
    for (const attempt of entry.attempts) {
      order += 1
      if (attempt.outcome === 'client_abort') continue
      if (!attempt.providerId || !attempt.model) continue
      const hard = isHardCandidateFailure(attempt.status, attempt.errorCode)
      // A plain fatal 400 is the client's contract problem; counting it would
      // penalize every model for one malformed request.
      if (attempt.outcome === 'fatal' && !hard) continue
      records.push({
        timestamp: entry.timestamp,
        order,
        providerId: attempt.providerId,
        actualModel: attempt.model,
        status: attempt.outcome === 'success' ? 'success' : 'error',
      })
    }
  }

  records.sort((a, b) => a.timestamp - b.timestamp || a.order - b.order)
  for (const record of records) {
    const key = banditKeyOf(record.providerId, record.actualModel)
    const stats = table.get(key) ?? { total: 0, successes: 0, degraded: 0, consecutiveDegraded: 0 }
    stats.attemptTotal = (stats.attemptTotal ?? 0) + 1
    if (record.status === 'success') {
      stats.consecutiveFailures = 0
    } else {
      stats.attemptFailures = (stats.attemptFailures ?? 0) + 1
      stats.consecutiveFailures = (stats.consecutiveFailures ?? 0) + 1
    }
    table.set(key, stats)
  }
}

function isHardCandidateFailure(status: number | undefined, code: string | number | null | undefined): boolean {
  if (status === 404) return true
  const normalized = String(code ?? '').toLowerCase()
  return normalized === 'channel_relogin_required'
    || normalized === 'channel_risk_control'
    || normalized === 'channel_model_unavailable'
}

/** 显著慢的门槛：p50 超过它的候选轻惩罚（噪声大，只罚显著的）。 */
const SLOW_P50_MS = 30_000

/**
 * Bandit 加减分（进 auto 打分的总分，量级与 uncertainTools 扣分同级）：
 * - 无数据 / 样本 < 5 → 0（乐观先验，见模块头）；
 * - 第二步：成功率项从 Beta 后验采样；同 seed 可复现，候选身份参与 seed，
 *   强候选大概率得高分，弱候选仍保留被探索的机会；
 * - p50 显著慢（> 30s）再扣 0.05。
 */
export function banditAdjustment(
  stats: BanditStats | undefined,
  random?: BanditRandom
): number {
  if (stats === undefined) return 0

  const failurePenalty = attemptFailurePenalty(stats)
  // Immediate demotion for repeated unusable successes. This deliberately runs
  // before the cold-start minimum: two consecutive `length` responses with no
  // client cap are enough evidence, even if the model has only 2-4 samples.
  const consecutiveDegraded = stats.consecutiveDegraded ?? 0
  if (consecutiveDegraded >= 2) {
    return Math.max(-0.8, -0.3 + failurePenalty)
  }

  if (stats.total < BANDIT_MIN_SAMPLES) return failurePenalty

  // Degraded successes do not count as clean successes (a fully failed model and
  // a model that answers with empty/truncated turns end up on the same side).
  const sampled = random !== undefined
  const degraded = stats.degraded ?? 0
  const effectiveSuccesses = Math.max(0, stats.successes - degraded)
  const successRate = sampled
    ? sampleBanditSuccessRate(stats, random)
    : effectiveSuccesses / stats.total
  let adjustment = 0.15 * (successRate - 0.5)
  if (degraded > 0) {
    // A smaller additional drag for a mixed record, so one recurring bad model
    // cannot hide behind a few good turns.
    adjustment -= 0.1 * (degraded / stats.total)
  }
  if (stats.latencyP50Ms !== undefined && stats.latencyP50Ms > SLOW_P50_MS) {
    adjustment -= 0.05
  }
  return adjustment + failurePenalty
}

/**
 * Per-attempt failure penalty. A single 404 can be catalog drift and must not
 * evict a healthy candidate; two consecutive failures or a majority-failure
 * record are the evidence that the target is actually unusable.
 */
function attemptFailurePenalty(stats: BanditStats): number {
  const total = stats.attemptTotal ?? 0
  const failures = stats.attemptFailures ?? 0
  const consecutive = stats.consecutiveFailures ?? 0
  if (consecutive >= 2) return -0.5
  if (total >= 3 && failures / total >= 0.5) {
    return -0.3 * (failures / total)
  }
  return 0
}
