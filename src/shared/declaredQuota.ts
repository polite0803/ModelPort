/**
 * 用户声明的额度窗口（第五层额度证据）。
 *
 * 为什么需要它：目录里 20 个订阅套餐条目（`AGGREGATE_PLAN_ENTRIES`）**全部**是
 * `undocumented`，一个可执行的数字都没有。于是 `smart` / `pace` 这两条「先把快过期的
 * 额度用掉」的策略，恰好在用户最关心的那几家上退回 fill-first —— 不是策略不灵，是
 * 手里没有数字。官方不公布的 5 小时 / 每周窗口，只有用户自己知道。
 *
 * 它与既有四层**并列、不可折算**：
 * - `aggregateQuota.ts`：厂商文档公布的静态帽（token 口径）；
 * - `quota/ledger.ts`：本应用自己数出来的用量（本模块的用量来源）；
 * - `aggregateCredit.ts`：问上游要回来的余额（USD / CNY，钱的单位）；
 * - `aggregateQuotaExhaustion.ts`：上游亲口拒过的现场证据。
 *
 * 这里是第五层：**用户自己写下的上限**。三条纪律：
 *
 * 1. **声明的是上限，不是换算率。** 单位只有「请求数」与「token 数」两种，二者永不
 *    互换；不提供「$5 等于多少 token」这种字段。
 * 2. **窗口先定义清楚，才谈用量。** 滚动窗口（5 小时 / 24 小时）走账本的分钟桶；
 *    自然窗口（周 / 月）对齐 **UTC** 边界走日桶。算不出来就不给读数，不猜。
 * 3. **它真的会挡发车**（`quotaBlockReason` 的 `declared-exhausted`）。用户写下这个数
 *    就是为了不被上游 429 打回来；只展示不执行，等于把声明当注释。
 */

/** 声明窗口的四种粒度。前两种是滚动窗口，后两种是 UTC 自然窗口。 */
export type DeclaredQuotaWindow = 'fiveHour' | 'day' | 'week' | 'month'

/** 计量单位：与既有五指标的「请求 / token」二分一致，永不互相折算。 */
export type DeclaredQuotaUnit = 'tokens' | 'requests'

export interface DeclaredQuotaLimit {
  window: DeclaredQuotaWindow
  unit: DeclaredQuotaUnit
  /** 该窗口内的上限（正整数）。0 / 负数 / 非整数一律视为无效声明。 */
  limit: number
}

/** 界面按这个顺序列窗口：由短到长。 */
export const DECLARED_QUOTA_WINDOWS: readonly DeclaredQuotaWindow[] = ['fiveHour', 'day', 'week', 'month']
export const DECLARED_QUOTA_UNITS: readonly DeclaredQuotaUnit[] = ['tokens', 'requests']

/** 每个账号最多几条声明：够同时挂「5 小时 token + 每周请求」，又不让存档键无界增长。 */
export const DECLARED_QUOTA_MAX_WINDOWS = 4
/** 单个上限的合法上界：这个数已经远超任何套餐。 */
export const DECLARED_QUOTA_MAX_LIMIT = 1_000_000_000_000

/**
 * 用户自定义的声明额度模板（2026-11-20 拍板）。
 *
 * 为什么模板由用户建、而不是产品内置档位：套餐数字随订阅变化、各家口径不同，
 * 把某一刻官方页上的 `6000 / 45000 / 90000` 写进代码，等于把第三方文档的某一版
 * 变成产品承诺 —— 平台改口径时产品得跟着发版，而用户其实只需要抄一次。
 *
 * 模板**只是填表助手**：它不参与任何判定。选中模板只是把 `limits` 填进当前表单，
 * 用户仍可改；真正挡发车的永远只有落盘在账号上的 `declaredQuota`。
 * 删除模板也不碰任何账号已有的声明。
 */
export interface DeclaredQuotaTemplate {
  /** 稳定 id（归一器生成，用户不可见；用于下拉的键与删除定位）。 */
  id: string
  /** 用户起的名字（如「百炼 Coding Pro」）；同一份库里按名字去重。 */
  name: string
  limits: DeclaredQuotaLimit[]
}

/** 模板库条数上限：够覆盖常见的几档订阅，又不让配置无限膨胀。 */
export const DECLARED_QUOTA_MAX_TEMPLATES = 20
/** 模板名长度上限：界面上是一行下拉，再长也没法读。 */
export const DECLARED_QUOTA_MAX_TEMPLATE_NAME = 40

/** 模板的 id 规则：名字前缀哈希不够稳，直接用序号 + 名字，重名时归一器去重。 */
function templateIdOf(name: string, index: number): string {
  return `tpl-${index}-${name.slice(0, 16)}`
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

/** 滚动窗口的长度；`week` / `month` 走 UTC 自然边界，不用这个表。 */
export const DECLARED_ROLLING_MS: Partial<Record<DeclaredQuotaWindow, number>> = {
  fiveHour: 5 * HOUR_MS,
  day: DAY_MS,
}

export function isDeclaredQuotaWindow(value: unknown): value is DeclaredQuotaWindow {
  return typeof value === 'string' && (DECLARED_QUOTA_WINDOWS as readonly string[]).includes(value)
}

export function isDeclaredQuotaUnit(value: unknown): value is DeclaredQuotaUnit {
  return typeof value === 'string' && (DECLARED_QUOTA_UNITS as readonly string[]).includes(value)
}

/**
 * 边界校验：存档里的值来自渲染层 / 旧备份，什么都可能是。
 *
 * 只保留合法条目（窗口与单位在白名单里、上限是正整数且不超过上界），同一
 * `(窗口, 单位)` 重复时**取更小的那个** —— 与实测帽同一套「只下调、只填空」的口径，
 * 免得一份重复的旧声明把用户刚改小的帽又顶回去。
 */
export function normalizeDeclaredQuota(value: unknown): DeclaredQuotaLimit[] {
  if (!Array.isArray(value)) return []

  const merged = new Map<string, DeclaredQuotaLimit>()
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as Partial<DeclaredQuotaLimit>
    if (!isDeclaredQuotaWindow(entry.window)) continue
    if (!isDeclaredQuotaUnit(entry.unit)) continue
    const limit = entry.limit
    if (typeof limit !== 'number' || !Number.isFinite(limit)) continue
    const floored = Math.floor(limit)
    if (floored <= 0 || floored > DECLARED_QUOTA_MAX_LIMIT) continue
    const key = `${entry.window}\u0000${entry.unit}`
    const current = merged.get(key)
    if (current === undefined || floored < current.limit) {
      merged.set(key, { window: entry.window, unit: entry.unit, limit: floored })
    }
  }

  return [...merged.values()]
    .sort((a, b) =>
      DECLARED_QUOTA_WINDOWS.indexOf(a.window) - DECLARED_QUOTA_WINDOWS.indexOf(b.window)
      || DECLARED_QUOTA_UNITS.indexOf(a.unit) - DECLARED_QUOTA_UNITS.indexOf(b.unit))
    .slice(0, DECLARED_QUOTA_MAX_WINDOWS)
}

/**
 * 模板库的边界校验。
 *
 * 三条：名字规范化（去空白、截断、空名字丢弃）、`limits` 走 `normalizeDeclaredQuota`
 * （同一个归一器，不另立一套白名单）、同一名字只留**第一条**（后面的丢弃而不是合并：
 * 合并两份模板等于替用户决定「哪几个窗口该合并」，而下拉里同名两项用户无法分辨）。
 *
 * id 在这里重新生成而不是信任入参：id 只是下拉的键与删除定位，但它一旦重复，
 * React 的键与「删哪一条」都会同时错位。重名去重之后 id 自然唯一。
 */
export function normalizeDeclaredQuotaTemplates(value: unknown): DeclaredQuotaTemplate[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const out: DeclaredQuotaTemplate[] = []
  for (const raw of value) {
    if (out.length >= DECLARED_QUOTA_MAX_TEMPLATES) break
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as Partial<DeclaredQuotaTemplate>
    const name = typeof entry.name === 'string'
      ? entry.name.trim().slice(0, DECLARED_QUOTA_MAX_TEMPLATE_NAME)
      : ''
    if (name.length === 0) continue
    if (seen.has(name)) continue
    const limits = normalizeDeclaredQuota(entry.limits)
    // 没有任何合法窗口的模板填进表单等于什么都不做，直接丢弃而不是留一个空壳。
    if (limits.length === 0) continue
    seen.add(name)
    out.push({ id: templateIdOf(name, out.length), name, limits })
  }
  return out
}

/** 一个窗口的用量读数：请求数与 token 数各一份，调用方按 `unit` 取用。 */
export interface DeclaredQuotaUsage {
  requests: number
  tokens: number
}

export function declaredUsageOf(usage: DeclaredQuotaUsage, unit: DeclaredQuotaUnit): number {
  return unit === 'tokens' ? usage.tokens : usage.requests
}

/** UTC 下一个自然月的第一毫秒。 */
export function nextUtcMonthStart(nowMs: number): number {
  const now = new Date(nowMs)
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
}

/** UTC 本周起点（周一 00:00）。 */
export function utcWeekStart(nowMs: number): number {
  const day = new Date(nowMs)
  const weekday = (day.getUTCDay() + 6) % 7 // 周一 = 0
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - weekday * DAY_MS
}

/** 自然窗口的起点（含）与下一次复位时刻。只有 `week` / `month` 走这条。 */
export function anchoredWindow(window: 'week' | 'month', nowMs: number): { startMs: number; resetAt: number } {
  if (window === 'month') {
    const now = new Date(nowMs)
    return {
      startMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      resetAt: nextUtcMonthStart(nowMs),
    }
  }
  const startMs = utcWeekStart(nowMs)
  return { startMs, resetAt: startMs + WEEK_MS }
}

/**
 * 滚动窗口的复位时刻：**最老一笔仍在窗口内的用量**滑出窗口的那一刻。
 *
 * `quotaPacing.nextRollingBoundary` 是按窗口长度对齐到纪元格子的上界，对 5 小时这种
 * 非 24 整除的窗口会偏移好几个小时。账本手里有真实桶时间，所以这里给的是「按现有
 * 用量算，最早何时能重新放行」——它仍是估算（新流量会把窗口继续推后），展示时必须
 * 标成估算，不能当成上游的复位时刻。
 */
export function rollingResetAt(fiveHourOrDay: 'fiveHour' | 'day', oldestUsageAt: number | undefined, nowMs: number): number | undefined {
  const span = DECLARED_ROLLING_MS[fiveHourOrDay]
  if (span === undefined) return undefined
  if (oldestUsageAt === undefined) return undefined
  const at = oldestUsageAt + span
  return at > nowMs ? at : undefined
}

export interface DeclaredQuotaDecision {
  allowed: boolean
  /** 判出「打满了」的那条声明 */
  limit?: DeclaredQuotaLimit
  used?: number
  /** 该窗口复位时刻（毫秒）。算不出来就缺席，不编。 */
  resetAt?: number
}

/**
 * 判定：任一声明窗口用满即挡住这一笔。
 *
 * 顺序与 `REASON_ORDER` 同一套思路 —— 难恢复的先说：月 > 周 > 日 > 5 小时。声明本身
 * 极少（≤ 4 条），线性扫即可。
 */
export function evaluateDeclaredQuota(
  limits: readonly DeclaredQuotaLimit[],
  usageOf: (window: DeclaredQuotaWindow) => DeclaredQuotaUsage,
  resetAtOf: (window: DeclaredQuotaWindow) => number | undefined,
): DeclaredQuotaDecision {
  if (limits.length === 0) return { allowed: true }

  const order: DeclaredQuotaWindow[] = ['month', 'week', 'day', 'fiveHour']
  for (const window of order) {
    // 同一窗口可能同时声明了 token 与请求两种上限：哪一种先到都算打满。
    for (const entry of limits) {
      if (entry.window !== window) continue
      const used = declaredUsageOf(usageOf(window), entry.unit)
      if (used < entry.limit) continue
      const resetAt = resetAtOf(window)
      return {
        allowed: false,
        limit: entry,
        used,
        ...(resetAt === undefined ? {} : { resetAt }),
      }
    }
  }
  return { allowed: true }
}