/**
 * 额度账本：跨重启仍然有效的「这个账号在这个模型上已经用了多少」记录。
 *
 * 窗口口径是**滚动**的（分钟 / 24 小时）而月度按 **UTC 自然月**：
 * 滚动窗口相对上游的自然日只会更早判定用尽，宁可少发一个请求，
 * 也不把已经撞过墙的请求当成还有余量。
 *
 * 落盘沿用 requestLogs 的形态：目录 + 防抖批量写 + 临时文件 rename，
 * 读不到就按空账本起——账本丢了只劣化一次窗口内的选路，不碰任何凭据。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { TokenUsage } from './usage.ts'
import type { QuotaMetric } from './limits.ts'
import {
  DECLARED_ROLLING_MS,
  anchoredWindow,
  type DeclaredQuotaWindow,
} from '../../../shared/declaredQuota.ts'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
/** 多留 5 分钟的桶，避免刚好卡在 24 小时边缘把日窗算少 */
const MINUTE_RETENTION_MS = DAY_MS + 5 * MINUTE_MS
/**
 * 日桶保留多少天。
 *
 * 用户声明的「每周 / 自然月」窗口要按天累加，而分钟桶只留 24 小时 —— 只靠分钟桶，
 * 周窗在第二天就会算成 0，声明等于失效。日桶一天一条、每条只带当天活跃的键，
 * 40 天足够覆盖一个自然月加一天，体量与一个月的分钟桶不可同日而语。
 */
const DAY_RETENTION_MS = 40 * DAY_MS

export interface QuotaBucket {
  requests: number
  tokens: number
}

/** 分钟桶：键是 `YYYY-MM-DDTHH:MM`（UTC），内层键是 `QuotaLedger.key(...)` */
export type MinuteBuckets = Record<string, Record<string, QuotaBucket>>
/** 日桶：键是 `YYYY-MM-DD`（UTC），内层键同上。周/月声明窗口的用量来源。 */
export type DayBuckets = Record<string, Record<string, QuotaBucket>>
/** 月度桶：键是 `YYYY-MM`（UTC） */
export type MonthBuckets = Record<string, Record<string, QuotaBucket>>

export interface LedgerSnapshot {
  providerId: string
  accountId: string
  modelId: string
  rpm: number
  rpd: number
  tpm: number
  tpd: number
  monthlyTokens: number
}

/** provider 级帽用的聚合名：同一账号下所有模型合到一起。 */
export const ALL_MODELS = '*'

export function minuteKey(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 16)
}

export function dayKey(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10)
}

export function monthKey(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 7)
}

/** 空桶相加还是空桶，所以这里不需要区分「没用过」和「用了 0」。 */
function addBucket(target: Record<string, QuotaBucket>, key: string, requests: number, tokens: number): void {
  const current = target[key]
  if (current) {
    current.requests += requests
    current.tokens += tokens
    return
  }
  target[key] = { requests, tokens }
}

/** 分别求请求数与 token 数：一个窗口两件事，不能只回一个数。 */
function readWindow(
  minutes: MinuteBuckets,
  key: string,
  windowMs: number,
  nowMs: number
): { requests: number; tokens: number } {
  const from = nowMs - windowMs
  let requests = 0
  let tokens = 0

  for (const [stamp, buckets] of Object.entries(minutes)) {
    const at = Date.parse(`${stamp}:00Z`)
    if (Number.isNaN(at) || at < from || at > nowMs) continue
    const bucket = buckets[key]
    if (!bucket) continue
    requests += bucket.requests
    tokens += bucket.tokens
  }

  return { requests, tokens }
}

/**
 * 跨天数的用量合计（声明窗口的周 / 月要走这里）。
 *
 * 与 `readWindow` 的分工：那个按「现在往前推一个窗口长度」扫分钟桶；这个从**给定起点**
 * 扫日桶（自然周 / 自然月）。`oldestAt` 只对滚动窗口有意义，跨天窗口的复位时刻由
 * 自然边界给出，不从这里推。
 */
function readSpan(
  buckets: Record<string, Record<string, QuotaBucket>>,
  parseStamp: (stamp: string) => number,
  key: string,
  fromMs: number,
  nowMs: number,
): { requests: number; tokens: number; oldestAt?: number } {
  let requests = 0
  let tokens = 0
  let oldestAt: number | undefined

  for (const [stamp, rows] of Object.entries(buckets)) {
    const at = parseStamp(stamp)
    if (Number.isNaN(at) || at < fromMs || at > nowMs) continue
    const bucket = rows[key]
    if (!bucket) continue
    requests += bucket.requests
    tokens += bucket.tokens
    if (oldestAt === undefined || at < oldestAt) oldestAt = at
  }

  return { requests, tokens, ...(oldestAt === undefined ? {} : { oldestAt }) }
}

function parseMinuteStamp(stamp: string): number {
  return Date.parse(`${stamp}:00Z`)
}

function parseDayStamp(stamp: string): number {
  return Date.parse(`${stamp}T00:00:00Z`)
}

/** 一个声明窗口的读数：请求数与 token 数各一份，外加滚动窗口「最老一笔」的时刻。 */
export interface DeclaredWindowReading {
  requests: number
  tokens: number
  /**
   * 窗口内仍在计数的最早一笔用量时刻（只有滚动窗口给）。
   *
   * 声明窗口的复位时刻按它推：最老那一笔滑出窗口时，窗口才真正松口。这是**估算**
   * ——新流量会把放行时刻继续推后，展示时必须标成估算，不得当成上游的复位时刻。
   */
  oldestAt?: number
}

export class QuotaLedger {
  private readonly filePath: string
  private readonly now: () => number
  private minutes: MinuteBuckets = {}
  /**
   * 日桶：只服务用户声明的「每周 / 自然月」窗口。
   *
   * 分钟桶按 24 小时裁，周窗在第二天就会读成 0；这里一天一条，`DAY_RETENTION_MS`
   * 兜住一个自然月加一天。旧账本没有这个键时按空表起（`version` 仍是 1，
   * 只是多一个可缺省的字段）。
   */
  private days: DayBuckets = {}
  private months: MonthBuckets = {}
  /** 实测帽：按家存，只填空、只下调。官方帽存在与否由 shared/aggregateQuota 决定，这里只记观测值。 */
  private learned: Record<string, Partial<Record<QuotaMetric, number>>> = {}
  private initialized = false
  private dirty = false
  private persistTimer: NodeJS.Timeout | null = null
  private readonly persistDelayMs = 2000

  /** 时钟可注入：窗口与保留策略全靠时刻，不注入就只能按真实墙钟测。 */
  constructor(storageDir: string, now: () => number = () => Date.now()) {
    this.filePath = join(storageDir, 'quota-ledger.json')
    this.now = now
  }

  static key(providerId: string, accountId: string, modelId: string): string {
    return `${providerId}|${accountId}|${modelId}`
  }

  initialize(): void {
    if (this.initialized) return

    mkdirSync(dirname(this.filePath), { recursive: true })
    const loaded = this.load()
    if (loaded) {
      this.minutes = loaded.minutes
      this.days = loaded.days
      this.months = loaded.months
      this.learned = loaded.learned
      this.prune(this.now())
    }
    this.initialized = true
  }

  /** 文件损坏时按空账本起，并把坏文件留下证——绝不静默覆盖真实数据。 */
  private load(): {
    minutes: MinuteBuckets
    days: DayBuckets
    months: MonthBuckets
    learned: Record<string, Partial<Record<QuotaMetric, number>>>
  } | null {
    if (!existsSync(this.filePath)) return null

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as {
        version?: number
        minutes?: unknown
        days?: unknown
        months?: unknown
        learned?: unknown
      }
      if (parsed.version !== 1 || typeof parsed.minutes !== 'object' || typeof parsed.months !== 'object') {
        return null
      }
      return {
        minutes: parsed.minutes as MinuteBuckets,
        // 日桶是本版新增的可缺省字段：旧账本没有它就是空表，不用迁移也不用升 version。
        days: (typeof parsed.days === 'object' && parsed.days !== null ? parsed.days : {}) as DayBuckets,
        months: parsed.months as MonthBuckets,
        learned: (parsed.learned ?? {}) as Record<string, Partial<Record<QuotaMetric, number>>>,
      }
    } catch {
      const corrupt = join(
        dirname(this.filePath),
        `quota-ledger.corrupted.${Date.now()}.json`
      )
      try {
        renameSync(this.filePath, corrupt)
      } catch {
        /* 改名失败也只按空账本起，不阻断启动 */
      }
      return null
    }
  }

  record(providerId: string, accountId: string, modelId: string, usage: TokenUsage, atMs = this.now()): void {
    this.ensureInitialized()

    const requests = 1
    const tokens = Math.max(0, Math.floor(usage.totalTokens || 0))
    const stamp = minuteKey(atMs)
    const day = dayKey(atMs)
    const month = monthKey(atMs)

    this.minutes[stamp] ??= {}
    this.days[day] ??= {}
    this.months[month] ??= {}

    addBucket(this.minutes[stamp], QuotaLedger.key(providerId, accountId, modelId), requests, tokens)
    addBucket(this.minutes[stamp], QuotaLedger.key(providerId, accountId, ALL_MODELS), requests, tokens)
    addBucket(this.days[day], QuotaLedger.key(providerId, accountId, modelId), requests, tokens)
    addBucket(this.days[day], QuotaLedger.key(providerId, accountId, ALL_MODELS), requests, tokens)
    addBucket(this.months[month], QuotaLedger.key(providerId, accountId, modelId), requests, tokens)
    addBucket(this.months[month], QuotaLedger.key(providerId, accountId, ALL_MODELS), requests, tokens)

    this.dirty = true
    this.schedulePersist()
  }

  snapshot(providerId: string, accountId: string, modelId: string, nowMs = this.now()): LedgerSnapshot {
    this.ensureInitialized()

    const modelKey = QuotaLedger.key(providerId, accountId, modelId)
    const minute = readWindow(this.minutes, modelKey, MINUTE_MS, nowMs)
    const day = readWindow(this.minutes, modelKey, DAY_MS, nowMs)
    const month = this.months[monthKey(nowMs)]?.[modelKey]

    return {
      providerId,
      accountId,
      modelId,
      rpm: minute.requests,
      tpm: minute.tokens,
      rpd: day.requests,
      tpd: day.tokens,
      monthlyTokens: month?.tokens ?? 0,
    }
  }

  /** 同一账号在一家里所有模型的合计，provider 级帽用它。 */
  providerSnapshot(providerId: string, accountId: string, nowMs = this.now()): Omit<LedgerSnapshot, 'modelId'> {
    this.ensureInitialized()

    const key = QuotaLedger.key(providerId, accountId, ALL_MODELS)
    const minute = readWindow(this.minutes, key, MINUTE_MS, nowMs)
    const day = readWindow(this.minutes, key, DAY_MS, nowMs)
    const month = this.months[monthKey(nowMs)]?.[key]

    return {
      providerId,
      accountId,
      rpm: minute.requests,
      tpm: minute.tokens,
      rpd: day.requests,
      tpd: day.tokens,
      monthlyTokens: month?.tokens ?? 0,
    }
  }

  /**
   * 一个账号在某家、某个**声明窗口**上的用量。
   *
   * 用 `ALL_MODELS` 聚合键：用户声明的「5 小时 / 每周」是套餐级限制，不是逐模型限制 ——
   * 按模型分开数会让同一份额度在十个模型上各放行一次。
   *
   * 窗口口径（与 `shared/declaredQuota.ts` 一致）：
   * - `fiveHour` / `day`：滚动窗口，扫分钟桶（保留 `DAY_RETENTION_MS`，够 5 小时）；
   * - `week`：UTC 自然周，扫日桶；
   * - `month`：UTC 自然月，读月度桶。
   */
  declaredWindow(
    providerId: string,
    accountId: string,
    window: DeclaredQuotaWindow,
    nowMs = this.now(),
  ): DeclaredWindowReading {
    this.ensureInitialized()

    const key = QuotaLedger.key(providerId, accountId, ALL_MODELS)

    if (window === 'week') {
      const { startMs } = anchoredWindow('week', nowMs)
      const span = readSpan(this.days, parseDayStamp, key, startMs, nowMs)
      return { requests: span.requests, tokens: span.tokens }
    }

    if (window === 'month') {
      const month = this.months[monthKey(nowMs)]?.[key]
      return { requests: month?.requests ?? 0, tokens: month?.tokens ?? 0 }
    }

    const span = DECLARED_ROLLING_MS[window]
    if (span === undefined) return { requests: 0, tokens: 0 }
    const read = readSpan(this.minutes, parseMinuteStamp, key, nowMs - span, nowMs)
    return {
      requests: read.requests,
      tokens: read.tokens,
      ...(read.oldestAt === undefined ? {} : { oldestAt: read.oldestAt }),
    }
  }

  /** 只填空、只下调：已有更小的观测值时，更大的观测不得顶替。 */
  learn(providerId: string, metric: QuotaMetric, limit: number): boolean {
    this.ensureInitialized()
    if (!(limit > 0)) return false

    const current = this.learned[providerId]?.[metric]
    if (current !== undefined && current <= limit) return false

    this.learned[providerId] = { ...(this.learned[providerId] ?? {}), [metric]: limit }
    this.dirty = true
    this.schedulePersist()
    return true
  }

  learnedFor(providerId: string): Partial<Record<QuotaMetric, number>> {
    this.ensureInitialized()
    return { ...(this.learned[providerId] ?? {}) }
  }

  prune(nowMs: number): void {
    const from = nowMs - MINUTE_RETENTION_MS
    for (const stamp of Object.keys(this.minutes)) {
      const at = Date.parse(`${stamp}:00Z`)
      if (Number.isNaN(at) || at < from) delete this.minutes[stamp]
    }

    // 日桶只服务声明窗口（周 / 自然月）：留到 40 天即可覆盖一个自然月加一天。
    const dayFrom = nowMs - DAY_RETENTION_MS
    for (const stamp of Object.keys(this.days)) {
      const at = parseDayStamp(stamp)
      if (Number.isNaN(at) || at < dayFrom) delete this.days[stamp]
    }

    const currentMonth = monthKey(nowMs)
    const previousMonth = monthKey(nowMs - 32 * DAY_MS)
    for (const month of Object.keys(this.months)) {
      if (month !== currentMonth && month !== previousMonth) delete this.months[month]
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) this.initialize()
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.prune(this.now())
      this.persistNow()
    }, this.persistDelayMs)
    this.persistTimer.unref?.()
  }

  private persistNow(): void {
    if (!this.dirty) return

    const temp = `${this.filePath}.tmp`
    writeFileSync(
      temp,
      JSON.stringify({
        version: 1,
        minutes: this.minutes,
        days: this.days,
        months: this.months,
        learned: this.learned,
      }),
      'utf-8'
    )
    renameSync(temp, this.filePath)
    this.dirty = false
  }

  /** 退出前调用，避免丢掉最后 2 秒内的计数。 */
  flushSync(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (!this.initialized) return
    this.prune(this.now())
    this.persistNow()
  }
}
