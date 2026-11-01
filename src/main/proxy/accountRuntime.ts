/**
 * 账号运行时指标：在途并发、分钟级 RPM、失败冷却（指数退避）
 *
 * 纯内存状态，不依赖 electron / electron-store，便于单测。
 * 数据只服务于路由打分，不写回 store，进程重启即清零。
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

export class AccountRuntime {
  private states = new Map<string, AccountRuntimeState>()

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

  recordSuccess(accountId: string): void {
    const state = this.state(accountId)
    state.consecutiveFailures = 0
    state.coolingUntil = undefined
  }

  /**
   * 记录一次失败并计算冷却时长（指数退避）。
   * 429 用分钟级退避，其余错误用秒级退避；连续失败次数在成功后清零。
   */
  recordFailure(accountId: string, status?: number, now: number = Date.now()): number {
    const state = this.state(accountId)
    state.consecutiveFailures += 1

    const base = status === 429 ? RATE_LIMIT_BASE_MS : ERROR_BASE_MS
    const max = status === 429 ? RATE_LIMIT_MAX_MS : ERROR_MAX_MS
    const ttl = Math.min(max, base * 2 ** (state.consecutiveFailures - 1))

    state.coolingUntil = now + ttl
    return ttl
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

  snapshot(accountId: string, now: number = Date.now()): AccountRuntimeSnapshot {
    const state = this.states.get(accountId)
    if (!state) {
      return { inFlight: 0, rpmUsed: 0, consecutiveFailures: 0 }
    }

    this.prune(state, now)

    return {
      inFlight: state.inFlight,
      rpmUsed: state.attempts.length,
      consecutiveFailures: state.consecutiveFailures,
      coolingUntil:
        state.coolingUntil !== undefined && state.coolingUntil > now ? state.coolingUntil : undefined,
    }
  }

  isCooling(accountId: string, now: number = Date.now()): boolean {
    const state = this.states.get(accountId)
    return state?.coolingUntil !== undefined && state.coolingUntil > now
  }

  rpmUsed(accountId: string, now: number = Date.now()): number {
    return this.snapshot(accountId, now).rpmUsed
  }

  reset(): void {
    this.states.clear()
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
