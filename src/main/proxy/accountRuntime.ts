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

  private state(accountId: string): AccountRuntimeState {
    let state = this.states.get(accountId)
    if (!state) {
      state = { inFlight: 0, attempts: [], consecutiveFailures: 0 }
      this.states.set(accountId, state)
    }
    return state
  }

  /** 记录一次上游尝试：在途 +1，并写入 RPM 窗口 */
  beginAttempt(accountId: string, now: number = Date.now()): void {
    const state = this.state(accountId)
    state.inFlight += 1
    state.attempts.push(now)
    this.prune(state, now)
  }

  endAttempt(accountId: string): void {
    const state = this.states.get(accountId)
    if (!state) return
    state.inFlight = Math.max(0, state.inFlight - 1)
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
  ): number {
    if (status === 429 && model !== undefined) {
      return this.recordRateLimitFailure(accountId, model, now)
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
  private recordRateLimitFailure(accountId: string, model: string, now: number): number {
    const tiers = this.tiersOf(accountId, now)
    const previous = tiers.get(model)
    const failures = (previous?.failures ?? 0) + 1
    const ttl = Math.min(RATE_LIMIT_MAX_MS, RATE_LIMIT_BASE_MS * 2 ** (failures - 1))

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

    if (!state) {
      return { inFlight: 0, rpmUsed: 0, consecutiveFailures: 0, ...availability }
    }

    this.prune(state, now)

    return {
      inFlight: state.inFlight,
      rpmUsed: state.attempts.length,
      consecutiveFailures: state.consecutiveFailures,
      ...availability,
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
