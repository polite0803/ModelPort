/**
 * 账号运行时指标：在途并发、分钟级 RPM、失败冷却（指数退避）
 *
 * 纯内存状态，不依赖 electron / electron-store，便于单测。
 * 数据只服务于路由打分，不写回 store，进程重启即清零。
 *
 * 冷却分两个键域，这是本文件唯一需要记住的一件事：
 * - **账号级**：网络错误 / 5xx / 凭据失效。它们的成因是「这个出口本身出了问题」，
 *   与请求哪个模型无关，所以整条账号一起避。
 * - **(账号, 模型) 级**：429 限流。上游的限流窗是按模型计的（渠道包那句原文就是
 *   「模型 sn-deepseek-v4-1-flash-1017 的可用账号均在限流中」），而账号渠道在宿主侧
 *   只有一个本机占位账号、整条线路共用它。若 429 也记在账号上，同一渠道**别的模型**
 *   成功一次就会把这个模型的退避清零，连击翻倍永远攒不起来：实测表现为每隔约 60s
 *   再付一次完整 prefill 去撞墙，10 分钟封顶那一档永远够不到。
 */

export interface AccountRuntimeSnapshot {
  /** 当前在途请求数 */
  inFlight: number
  /** 最近 60 秒内的尝试次数 */
  rpmUsed: number
  /** 连续失败次数，成功后清零 */
  consecutiveFailures: number
  /** 冷却截止时间戳（仅当仍在冷却期内才返回） */
  coolingUntil?: number
  /** (account, model) 的短窗口指标；只有查询时给了 model 且已有流量才返回。 */
  modelInFlight?: number
  modelLimit?: number
  ewmaFirstTokenMs?: number
  rateLimitedRate?: number
  timeoutRate?: number
  degradedRate?: number
}

/** 一次上游尝试的完成信号，用于 AIMD 与短窗口统计（不参与冷却判定）。 */
export interface AttemptOutcomeInput {
  success: boolean
  status?: number
  /** 首字/首字节耗时；流式由路由层在流结束时补报。 */
  firstTokenMs?: number
  /** 整笔耗时；非流式由 forwarder 直接给，流式由路由层在流结束时补报。 */
  totalMs?: number
  /** HTTP 200 但内容被截断/不可用，只影响质量分，不当作拥塞降温。 */
  degraded?: boolean
  clientAborted?: boolean
  timedOut?: boolean
}

/** 流结束时补报的传输层事实。 */
export interface StreamOutcomeInput {
  firstTokenMs?: number
  totalMs?: number
  endReason?: 'done' | 'eof' | 'timeout' | 'client_gone' | 'error'
  /** 未请求输出上限却 finish_reason=length（由路由层判定）。 */
  degraded?: boolean
  /**
   * 这一笔的失败是**模型没把活干完**（渠道包合成的 incomplete_step），不是账号
   * 接不住。按架构 A 它只上模型熔断票：AIMD 不降速（降的是「账号能不能接」），
   * 但成功连击要清零，否则一次退化还被当成「干净成功」去加并发。
   */
  modelQuality?: boolean
}

/**
 * 每个 (账号, 模型) 的 AIMD 流控状态。
 *
 * 为什么不只看 429：限流真正先表现为首字延迟上升，429 只是队列已经满出来的
 * 结果。这里用短窗口 EWMA（首字）和失败率做闭环，慢下来先降并发，而不是等到
 * 429 再冷却。
 */
interface ModelFlowState {
  inFlight: number
  limit: number
  successStreak: number
  lastDecreaseAt: number
  windowStartedAt: number
  windowAttempts: number
  windowRateLimited: number
  windowTimeouts: number
  windowDegraded: number
  ewmaFirstTokenMs?: number
  ewmaTotalMs?: number
  fastFirstTokenMs?: number
  slowFirstTokenMs?: number
  firstTokenSamples: number
}

const FLOW_WINDOW_MS = 60 * 1000
const DEFAULT_MODEL_CONCURRENCY = 4
/**
 * 下限 2 而不是 1：乘性降速把 4 打到 1 后，一条卡首字的慢流就占死唯一名额，
 * 同模型的其余请求全部本地 429（2026-11-11 codearts 429 风暴实测：10:59:45
 * 起 23s 内四连 502 把 4→2→1，此后 57–102s 的假死流轮流独占，恢复条件
 * ——5 连净成功且距上次降速 30s——要数分钟才够得到）。保底 2 让收缩态始终
 * 留一条并行活路，代价只是上游真限流时多打一路。
 */
const MIN_MODEL_CONCURRENCY = 2
const MAX_MODEL_CONCURRENCY = 16
/** 最多保留多少个 (账号, 模型) 流控档；自定义模型名不能把表撑大。 */
const MAX_MODEL_FLOWS = 512
/**
 * 两次乘性下降至少隔这么久。5s 太密：一波渠道故障（同上实测 23s 内四连
 * 502）就够把 4→2→1 一路打穿，而恢复要数分钟。30s 与 INCREASE_COOLDOWN_MS
 * 对齐 —— 一波故障只降一次，冷却窗过后仍拥塞才继续降。
 */
const DECREASE_COOLDOWN_MS = 30 * 1000
/** 连续成功达到这个数、且距上次降速足够久，才加一档。 */
const INCREASE_STREAK = 5
const INCREASE_COOLDOWN_MS = 30 * 1000
/** 快/慢 EWMA 的比值超过它，且绝对值超过下限，视为“队列开始变慢”。 */
const LATENCY_SPIKE_FACTOR = 1.6
const LATENCY_SPIKE_FLOOR_MS = 3_000
const EWMA_FAST_ALPHA = 0.5
const EWMA_SLOW_ALPHA = 0.1
const EWMA_ALPHA = 0.3

function ema(previous: number | undefined, sample: number, alpha: number): number {
  return previous === undefined ? sample : previous + alpha * (sample - previous)
}

const RPM_WINDOW_MS = 60 * 1000

/** 429 的退避基数与上限：60s 起步，逐次翻倍，最多 10 分钟 */
const RATE_LIMIT_BASE_MS = 60 * 1000
const RATE_LIMIT_MAX_MS = 10 * 60 * 1000

/** 网络错误 / 5xx 的退避基数与上限：15s 起步，最多 2 分钟 */
const ERROR_BASE_MS = 15 * 1000
const ERROR_MAX_MS = 2 * 60 * 1000

/**
 * 凭据类故障（要人重新登录/补 Key）的退避基数与上限：5 分钟起，最多 30 分钟。
 * 取值理由见 {@link AccountRuntime.recordCredentialFailure}。
 */
const CREDENTIAL_BASE_MS = 5 * 60 * 1000
const CREDENTIAL_MAX_MS = 30 * 60 * 1000

interface AccountRuntimeState {
  inFlight: number
  attempts: number[]
  consecutiveFailures: number
  coolingUntil?: number
}

/** 一个 (账号, 模型) 的限流档：`failures` 只数这一档的连续 429 */
interface RateLimitTier {
  until: number
  failures: number
}

/**
 * 每账号最多记多少个模型的限流档。
 *
 * 上限不是洁癖：`actualModel` 里含有用户自定义供应商能接受的任意模型名，不设上限
 * 就是一张随请求增长、永不清理的表。超限时先摘已到期的，仍满再按插入序摘最旧的
 * —— 最旧的那批同时也是最不可能再次命中的。
 */
const RATE_LIMIT_TIERS_PER_ACCOUNT = 64

export class AccountRuntime {
  private states = new Map<string, AccountRuntimeState>()
  private rateLimits = new Map<string, Map<string, RateLimitTier>>()
  private flows = new Map<string, ModelFlowState>()

  private state(accountId: string): AccountRuntimeState {
    let state = this.states.get(accountId)
    if (!state) {
      state = { inFlight: 0, attempts: [], consecutiveFailures: 0 }
      this.states.set(accountId, state)
    }
    return state
  }

  /** 记录一次上游尝试：在途 +1，并写入 RPM 窗口。带 model 时同时进入该模型流控。 */
  beginAttempt(accountId: string, now: number = Date.now(), model?: string): void {
    const state = this.state(accountId)
    state.inFlight += 1
    state.attempts.push(now)
    this.prune(state, now)

    if (model !== undefined) {
      const flow = this.flowOf(accountId, model, now)
      flow.inFlight += 1
      flow.windowAttempts += 1
    }
  }

  /**
   * 准入门：某个 (账号, 模型) 的 AIMD 并发已满时返回 false。
   *
   * 调用方（forwarder）拿不到槽位时应换下一家或返回可重试的 429，而不是继续
   * 把请求压给同一个模型 —— 那正是“限流延时”越等越长的来源。
   */
  tryBeginAttempt(
    accountId: string,
    model: string,
    now: number = Date.now(),
  ): { ok: true } | { ok: false; retryAfterMs: number } {
    const flow = this.flowOf(accountId, model, now)
    if (flow.inFlight >= flow.limit) {
      const estimated = flow.ewmaTotalMs ?? 2_000
      return {
        ok: false,
        retryAfterMs: Math.max(100, Math.min(1_000, Math.round(estimated / Math.max(1, flow.limit)))),
      }
    }
    this.beginAttempt(accountId, now, model)
    return { ok: true }
  }

  endAttempt(accountId: string, model?: string): void {
    const state = this.states.get(accountId)
    if (state) state.inFlight = Math.max(0, state.inFlight - 1)

    if (model !== undefined) {
      const flow = this.flows.get(this.flowKey(accountId, model))
      if (flow) flow.inFlight = Math.max(0, flow.inFlight - 1)
    }
  }

  /**
   * 一次上游尝试的结果。只更新 AIMD/短窗口，不写冷却档（冷却仍由
   * `recordFailure`/`recordSuccess` 负责）。
   */
  recordAttemptOutcome(
    accountId: string,
    model: string,
    outcome: AttemptOutcomeInput,
    now: number = Date.now(),
  ): void {
    const flow = this.flowOf(accountId, model, now)
    if (outcome.clientAborted) return

    if (outcome.success) {
      flow.successStreak += 1
      if (outcome.degraded) {
        flow.windowDegraded += 1
        flow.successStreak = 0
      }
      this.observeLatency(flow, outcome, now)
      if (!outcome.degraded) this.maybeIncrease(flow, now)
      return
    }

    flow.successStreak = 0
    if (outcome.status === 429) flow.windowRateLimited += 1
    if (
      outcome.timedOut
      || outcome.status === 408
      || outcome.status === 504
      || outcome.status === 524
    ) {
      flow.windowTimeouts += 1
    }
    // 只对“拥塞类”失败降速：400/401/403/404/422 是请求或能力问题，
    // 拿它们降并发会让一次客户端写错把所有请求都拖慢。
    if (this.isCongestionFailure(outcome)) {
      this.decrease(flow, now)
    }
  }

  /** 流结束时补报首字/整笔耗时与 degraded；不重复计 successStreak。 */
  recordStreamOutcome(
    accountId: string,
    model: string,
    outcome: StreamOutcomeInput,
    now: number = Date.now(),
  ): void {
    const flow = this.flowOf(accountId, model, now)
    if (outcome.endReason === 'client_gone') return

    // 模型级退化走错误帧收尾（endReason=error），但它不是账号故障：按 degraded
    // 记（清零连击、不降并发），不进 recordAttemptOutcome 的拥塞降速。
    const degraded = outcome.degraded === true || outcome.modelQuality === true
    if ((outcome.endReason === 'error' || outcome.endReason === 'timeout') && outcome.modelQuality !== true) {
      this.recordAttemptOutcome(accountId, model, {
        success: false,
        timedOut: outcome.endReason === 'timeout',
      }, now)
      return
    }

    if (degraded) {
      flow.windowDegraded += 1
      flow.successStreak = 0
    }
    this.observeLatency(flow, {
      firstTokenMs: outcome.firstTokenMs,
      totalMs: outcome.totalMs,
    }, now)
    if (!degraded) this.maybeIncrease(flow, now)
  }

  /**
   * 成功一次就解除冷却。
   *
   * 带 `model` 时只清「这个模型自己的限流档」+ 账号级退避；**不带 model 时清该账号
   * 全部限流档**，那是池子变化/重新登录/重启的语义（上游窗口跟着新凭据重开）。
   * 反过来写就是本文件头部记的那条缺陷：同渠道别的模型成功一次，把这个模型的
   * 退避连同连击计数一起抹掉，限流就永远只是 60s 一轮。
   */
  recordSuccess(accountId: string, model?: string): void {
    const state = this.state(accountId)
    state.consecutiveFailures = 0
    state.coolingUntil = undefined

    if (model === undefined) {
      this.rateLimits.delete(accountId)
      return
    }
    const tiers = this.rateLimits.get(accountId)
    if (tiers === undefined) return
    tiers.delete(model)
    if (tiers.size === 0) this.rateLimits.delete(accountId)
  }

  /**
   * 记录一次失败并计算冷却时长（指数退避）。
   *
   * 429 且给了 `model` ⇒ 记进 (账号, 模型) 档；其余（含不带 model 的老调用，为了
   * 不改变既有行为）按账号档：429 用分钟级退避，其余错误用秒级退避。
   */
  recordFailure(
    accountId: string,
    status?: number,
    now: number = Date.now(),
    model?: string,
    retryAfterMs?: number,
  ): number {
    if (status === 429 && model !== undefined) {
      return this.recordRateLimitFailure(accountId, model, now, retryAfterMs)
    }

    const state = this.state(accountId)
    state.consecutiveFailures += 1

    const base = status === 429 ? RATE_LIMIT_BASE_MS : ERROR_BASE_MS
    const max = status === 429 ? RATE_LIMIT_MAX_MS : ERROR_MAX_MS
    const ttl = Math.min(max, base * 2 ** (state.consecutiveFailures - 1))

    state.coolingUntil = now + ttl
    return ttl
  }

  /** 限流档的指数退避：与账号档同一套基数/上限，只是键多一维、清零互不影响 */
  private recordRateLimitFailure(accountId: string, model: string, now: number, retryAfterMs?: number): number {
    const tiers = this.tiersOf(accountId, now)
    const previous = tiers.get(model)
    const failures = (previous?.failures ?? 0) + 1
    const baseTtl = Math.min(RATE_LIMIT_MAX_MS, RATE_LIMIT_BASE_MS * 2 ** (failures - 1))
    // 渠道包上报的上游真实解禁时刻（providerRetryAfterMs）：与自己的指数退避取更晚，
    // 避免「冷却到期→放一笔→又 429→再冷却」的自维持循环（PLAN-channel-auto-stability 第五批）。
    const ttl = retryAfterMs !== undefined ? Math.max(baseTtl, retryAfterMs) : baseTtl

    // 重新 set 而非就地改：Map 的插入序因此跟着刷新，被摘的一定是最久没碰的模型
    tiers.set(model, { until: now + ttl, failures })
    return ttl
  }

  private tiersOf(accountId: string, now: number): Map<string, RateLimitTier> {
    let tiers = this.rateLimits.get(accountId)
    if (tiers === undefined) {
      tiers = new Map<string, RateLimitTier>()
      this.rateLimits.set(accountId, tiers)
    }
    if (tiers.size < RATE_LIMIT_TIERS_PER_ACCOUNT) return tiers

    for (const [key, tier] of tiers) {
      if (tier.until <= now) tiers.delete(key)
    }
    while (tiers.size >= RATE_LIMIT_TIERS_PER_ACCOUNT) {
      const oldest = tiers.keys().next()
      if (oldest.done) break
      tiers.delete(oldest.value)
    }
    return tiers
  }

  /** 该模型这档还在冷却就返回到期时刻，到期即顺手摘掉（不堆历史模型） */
  private rateLimitedUntil(accountId: string, model: string, now: number): number | undefined {
    const tiers = this.rateLimits.get(accountId)
    if (tiers === undefined) return undefined
    const tier = tiers.get(model)
    if (tier === undefined) return undefined
    if (tier.until <= now) {
      tiers.delete(model)
      if (tiers.size === 0) this.rateLimits.delete(accountId)
      return undefined
    }
    return tier.until
  }

  private flowKey(accountId: string, model: string): string {
    return `${accountId}\u0000${model}`
  }

  private flowOf(accountId: string, model: string, now: number): ModelFlowState {
    const key = this.flowKey(accountId, model)
    let flow = this.flows.get(key)
    if (flow === undefined) {
      if (this.flows.size >= MAX_MODEL_FLOWS) this.evictFlows(now)
      flow = {
        inFlight: 0,
        limit: DEFAULT_MODEL_CONCURRENCY,
        successStreak: 0,
        lastDecreaseAt: 0,
        windowStartedAt: now,
        windowAttempts: 0,
        windowRateLimited: 0,
        windowTimeouts: 0,
        windowDegraded: 0,
        firstTokenSamples: 0,
      }
      this.flows.set(key, flow)
    } else {
      // LRU：最近用过的放到末尾，超限时先摘最久没碰的
      this.flows.delete(key)
      this.flows.set(key, flow)
    }
    this.pruneFlowWindow(flow, now)
    return flow
  }

  private evictFlows(now: number): void {
    for (const [key, flow] of this.flows) {
      if (now - flow.windowStartedAt > FLOW_WINDOW_MS * 60) this.flows.delete(key)
    }
    while (this.flows.size >= MAX_MODEL_FLOWS) {
      const oldest = this.flows.keys().next()
      if (oldest.done) break
      this.flows.delete(oldest.value)
    }
  }

  private pruneFlowWindow(flow: ModelFlowState, now: number): void {
    if (now - flow.windowStartedAt < FLOW_WINDOW_MS) return
    flow.windowStartedAt = now
    flow.windowAttempts = 0
    flow.windowRateLimited = 0
    flow.windowTimeouts = 0
    flow.windowDegraded = 0
  }

  private observeLatency(
    flow: ModelFlowState,
    outcome: Pick<AttemptOutcomeInput, 'firstTokenMs' | 'totalMs'>,
    now: number,
  ): void {
    const first = outcome.firstTokenMs
    if (typeof first === 'number' && Number.isFinite(first) && first >= 0) {
      flow.ewmaFirstTokenMs = ema(flow.ewmaFirstTokenMs, first, EWMA_ALPHA)
      flow.fastFirstTokenMs = ema(flow.fastFirstTokenMs, first, EWMA_FAST_ALPHA)
      flow.slowFirstTokenMs = ema(flow.slowFirstTokenMs, first, EWMA_SLOW_ALPHA)
      flow.firstTokenSamples += 1

      // 快 EWMA 明显高于慢 EWMA：队列刚开始变长，而不是已经报 429。
      if (
        flow.firstTokenSamples >= 3
        && flow.fastFirstTokenMs !== undefined
        && flow.slowFirstTokenMs !== undefined
        && flow.fastFirstTokenMs > LATENCY_SPIKE_FLOOR_MS
        && flow.fastFirstTokenMs > flow.slowFirstTokenMs * LATENCY_SPIKE_FACTOR
      ) {
        this.decrease(flow, now)
      }
    }

    const total = outcome.totalMs
    if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
      flow.ewmaTotalMs = ema(flow.ewmaTotalMs, total, EWMA_ALPHA)
    }
  }

  private maybeIncrease(flow: ModelFlowState, now: number): void {
    if (flow.successStreak < INCREASE_STREAK) return
    if (now - flow.lastDecreaseAt < INCREASE_COOLDOWN_MS) return
    flow.limit = Math.min(MAX_MODEL_CONCURRENCY, flow.limit + 1)
    flow.successStreak = 0
  }

  private decrease(flow: ModelFlowState, now: number): void {
    if (now - flow.lastDecreaseAt < DECREASE_COOLDOWN_MS) return
    flow.lastDecreaseAt = now
    flow.limit = Math.max(MIN_MODEL_CONCURRENCY, Math.floor(flow.limit * 0.7))
    flow.successStreak = 0
  }

  private isCongestionFailure(outcome: AttemptOutcomeInput): boolean {
    if (outcome.timedOut) return true
    if (outcome.status === undefined) return true
    return outcome.status === 429
      || outcome.status === 408
      || outcome.status === 504
      || outcome.status === 524
      || (outcome.status >= 500 && outcome.status <= 599)
  }

  /**
   * 记录一次**需要人工介入**的失败（凭据失效 / 未登录 / 匿名槽耗尽）。
   *
   * 与 {@link recordFailure} 的区别只在退避档位：普通 5xx 假设「过一会儿就好」，
   * 15s 起步；凭据类故障不会自己好，短退避等于让每一笔新请求都再付一次完整的
   * 加密 prefill 与排队等待（实测单家 214s–245s，`auto` 一笔被拖到 525s）。
   * 所以按 5 分钟起、30 分钟封顶，连续失败仍逐次翻倍。
   *
   * 渠道池发生变化（重新登录、账号增删）后由 {@link recordSuccess} 一侧解除，用户
   * 不必等冷却自然到期。
   */
  recordCredentialFailure(accountId: string, now: number = Date.now()): number {
    const state = this.state(accountId)
    state.consecutiveFailures += 1
    const ttl = Math.min(
      CREDENTIAL_MAX_MS,
      CREDENTIAL_BASE_MS * 2 ** (state.consecutiveFailures - 1),
    )
    state.coolingUntil = now + ttl
    return ttl
  }

  /**
   * 取运行时快照。
   *
   * 给了 `model` 时，`coolingUntil` 取「账号级冷却」与「该模型限流档」里**更晚**的那个：
   * 两条都算「现在别派我」，报早了会让路由把请求再送去撞一次。
   */
  snapshot(accountId: string, now: number = Date.now(), model?: string): AccountRuntimeSnapshot {
    const state = this.states.get(accountId)
    const accountCooling =
      state?.coolingUntil !== undefined && state.coolingUntil > now ? state.coolingUntil : undefined
    const modelCooling = model === undefined ? undefined : this.rateLimitedUntil(accountId, model, now)
    const coolingUntil =
      accountCooling === undefined
        ? modelCooling
        : modelCooling === undefined
          ? accountCooling
          : Math.max(accountCooling, modelCooling)

    // 没有冷却就不发这个键（而不是发 `undefined`）：消费点按「有没有这一格」判断
    const availability = coolingUntil === undefined ? {} : { coolingUntil }

    const flow = model === undefined ? undefined : this.flows.get(this.flowKey(accountId, model))
    if (flow !== undefined) this.pruneFlowWindow(flow, now)
    const flowFields = flow === undefined
      ? {}
      : {
          modelInFlight: flow.inFlight,
          modelLimit: flow.limit,
          ...(flow.ewmaFirstTokenMs === undefined ? {} : { ewmaFirstTokenMs: flow.ewmaFirstTokenMs }),
          rateLimitedRate: flow.windowAttempts > 0 ? flow.windowRateLimited / flow.windowAttempts : 0,
          timeoutRate: flow.windowAttempts > 0 ? flow.windowTimeouts / flow.windowAttempts : 0,
          degradedRate: flow.windowAttempts > 0 ? flow.windowDegraded / flow.windowAttempts : 0,
        }

    if (!state) {
      return {
        inFlight: 0,
        rpmUsed: 0,
        consecutiveFailures: 0,
        ...availability,
        ...flowFields,
      }
    }

    this.prune(state, now)

    return {
      inFlight: state.inFlight,
      rpmUsed: state.attempts.length,
      consecutiveFailures: state.consecutiveFailures,
      ...availability,
      ...flowFields,
    }
  }

  /**
   * 是否处于冷却。`model` 给了就连带查该模型的限流档——路由问的是「这个账号跑这个
   * 模型现在能不能派」，不是「这个账号整体健不健康」。
   */
  isCooling(accountId: string, now: number = Date.now(), model?: string): boolean {
    const state = this.states.get(accountId)
    if (state?.coolingUntil !== undefined && state.coolingUntil > now) return true
    return model !== undefined && this.rateLimitedUntil(accountId, model, now) !== undefined
  }

  rpmUsed(accountId: string, now: number = Date.now()): number {
    return this.snapshot(accountId, now).rpmUsed
  }

  reset(): void {
    this.states.clear()
    this.rateLimits.clear()
    this.flows.clear()
  }

  private prune(state: AccountRuntimeState, now: number): void {
    if (state.attempts.length === 0) return

    const cutoff = now - RPM_WINDOW_MS
    let index = 0
    while (index < state.attempts.length && state.attempts[index] <= cutoff) {
      index += 1
    }
    if (index > 0) {
      state.attempts.splice(0, index)
    }
  }
}

export const accountRuntime = new AccountRuntime()
export default accountRuntime
