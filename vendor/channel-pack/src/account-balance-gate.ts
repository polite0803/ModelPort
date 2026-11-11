/**
 * 账号余额门控（选号前的「积分检查」）。
 *
 * 背景：除 loomy / buddy 外，其余渠道选号只看 `enabled` + 限流标记 + 手动顺序，
 * 完全不知道账号还剩多少积分。排第一的号积分烧光后，若服务端的失败**不**被
 * 识别为限流（计费类错误按设计不写 `modelRateLimits`），这个号就一直是候选
 * 第一名，请求反复砸在 0 积分号上，有积分的号永远轮不到。
 *
 * 本模块在 `AccountPool.getAvailableAccount` 的候选循环里插入一道闸门：
 * 解析凭据后先查一次余额，**确认余额为 0** 的账号判为不可用。处置权在选号方：
 * 自 2026-11-11 起 `AccountPool` 把它们**降级排到最后**而不是剔除 —— 只有汇总数字的
 * 0 分不清「烧光」和「本计划不发积分」，剔除会把候选踢空（见 `account-pool.ts` 的
 * `demoted`）。核心语义：
 *
 * - **fail-open**：探针失败 / 超时 / 结构不认识 → 返回 `undefined`（未知），
 *   照常选它。门控只拦截「确认为 0」，绝不因查询抖动把有积分的号排掉。
 * - **TTL 缓存**：成功结果 60 秒、失败结果 5 秒，同一账号的并发查询去重，
 *   选号热路径上基本零网络开销（对应 loomy-balance-selector 的缓存预算）。
 * - **环境开关**：`DSH_ACCOUNT_BALANCE_GATE=0/false/no/off` 整体停用，
 *   默认开启（对齐 `resolveHideWithoutAccountFlag` 的开关风格）。
 *
 * 本文件**零 import**（纯算术 + 定时），可直接被 node --test 以 TS 源加载。
 */

/**
 * 余额探针：由 index.ts 按渠道包一层（把各渠道的 fetch 签名归一化）。
 *
 * 返回值约定：
 * - `number > 0`：确认有余额；
 * - `number <= 0`：确认余额为 0（会被门控拦截）；
 * - `null | undefined`：查不到 / 结构不认识 → 未知，门控放行。
 */
export type BalanceProbe = (
  credential: unknown,
) => Promise<number | null | undefined>

export interface AccountBalanceGateOptions {
  probe: BalanceProbe
  /** 确定性结果（有余额 / 确认为 0）的缓存时长，默认 60_000 毫秒。 */
  ttlMs?: number
  /** 不确定结果（查询失败 / 超时）的缓存时长，默认 5_000 毫秒。 */
  errorTtlMs?: number
  /** 单次探针超时，默认 10_000 毫秒；超时按「查不到」处理（fail-open）。 */
  probeTimeoutMs?: number
  /** 测试注入的时钟；默认 `Date.now`。 */
  now?: () => number
}

type GateState = 'usable' | 'empty' | 'unknown'

interface GateEntry {
  state: GateState
  expiresAt: number
}

function classifyProbeValue(value: number | null | undefined): GateState {
  if (value === null || value === undefined) return 'unknown'
  if (Number.isFinite(value)) return value > 0 ? 'usable' : 'empty'
  // NaN / ±Infinity 是「读不懂的数」，不能当成 0（fail-open）。
  return 'unknown'
}

function stateToUsable(state: GateState): boolean | undefined {
  if (state === 'usable') return true
  if (state === 'empty') return false
  return undefined
}

export class AccountBalanceGate {
  private readonly probe: BalanceProbe
  private readonly ttlMs: number
  private readonly errorTtlMs: number
  private readonly probeTimeoutMs: number
  private readonly now: () => number
  private readonly cache = new Map<string, GateEntry>()
  private readonly inFlight = new Map<string, Promise<GateState>>()

  constructor(options: AccountBalanceGateOptions) {
    this.probe = options.probe
    this.ttlMs = options.ttlMs ?? 60_000
    this.errorTtlMs = options.errorTtlMs ?? 5_000
    this.probeTimeoutMs = options.probeTimeoutMs ?? 10_000
    this.now = options.now ?? Date.now
  }

  /**
   * 该账号是否可用。`false` = 确认余额为 0（拦截）；
   * `true` / `undefined`（未知）都放行。
   */
  async usable(accountId: string, credential: unknown): Promise<boolean | undefined> {
    const cached = this.cache.get(accountId)
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return stateToUsable(cached.state)
    }

    let pending = this.inFlight.get(accountId)
    if (pending === undefined) {
      pending = this.probeWithTimeout(credential).then((state) => {
        this.inFlight.delete(accountId)
        const ttl = state === 'unknown' ? this.errorTtlMs : this.ttlMs
        this.cache.set(accountId, { state, expiresAt: this.now() + ttl })
        return state
      }, () => {
        this.inFlight.delete(accountId)
        this.cache.set(accountId, {
          state: 'unknown',
          expiresAt: this.now() + this.errorTtlMs,
        })
        return 'unknown' as GateState
      })
      this.inFlight.set(accountId, pending)
    }

    return stateToUsable(await pending)
  }

  /**
   * Hot-path read: **never** starts a probe inline.
   *
   * Selection runs once per request, so awaiting a probe here turns every
   * account pick into an upstream call - on top of the request itself, against
   * an account the vendor does not authorise this client for. The deferred
   * probe still runs (deduped by `inFlight`), so the next request within the
   * TTL gates on a real reading; this one proceeds ungated, which is the same
   * fail-open contract as a probe that timed out.
   */
  usableFromCache(accountId: string, credential: unknown): boolean | undefined {
    const cached = this.cache.get(accountId)
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return stateToUsable(cached.state)
    }
    void this.usable(accountId, credential).catch(() => undefined)
    return undefined
  }

  /** 让指定账号（或全部）的缓存立刻失效；换号/标记限流后可调用。 */
  invalidate(accountId?: string): void {
    if (accountId === undefined) this.cache.clear()
    else this.cache.delete(accountId)
  }

  /** 测试 / 诊断用。 */
  stats(): { cached: number; inFlight: number } {
    return { cached: this.cache.size, inFlight: this.inFlight.size }
  }

  private async probeWithTimeout(credential: unknown): Promise<GateState> {
    if (this.probeTimeoutMs === Infinity) {
      return classifyProbeValue(await this.probe(credential))
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('balance probe timeout')), this.probeTimeoutMs)
    })
    try {
      const value = await Promise.race([this.probe(credential), timeout])
      return classifyProbeValue(value)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/**
 * 环境开关：默认开启；`0 / false / no / off`（不区分大小写）停用。
 * 与 `resolveHideWithoutAccountFlag` 同一风格。
 */
export function isBalanceGateEnabled(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase()
  if (value === undefined || value === '') return true
  return !(value === '0' || value === 'false' || value === 'no' || value === 'off')
}
