/**
 * 路由页「额度与推荐队列」的投影（纯函数，无 electron / store 依赖）。
 *
 * 这个模块回答两件事，且**只回答这两件**：
 *
 * 1. **哪些额度即将过期。** 一个窗口还剩多少、什么时候复位、这个数是哪来的
 *    （官方文档 / 实测帽 / 用户声明）、复位时刻是上游说的还是我们推的。
 * 2. **这一轮为什么跳过它。** 原因 + 解禁时刻 + 那个时刻的出处。
 *
 * 三条不许让步的口径：
 *
 * - **事实与估算分开写。** 上游给的 `Retry-After` / worker 的限流读数 / 上游声明的
 *   复位时刻是**事实**（`resetSource: 'upstream'`）；按滚动窗口推算的是**估算**
 *   （`'estimated'`），界面必须带「约」，不得伪装成上游的复位时刻。自然边界
 *   （本地午夜 / UTC 周与月起点）是我们自己的记账规则，记作 `'local'`。
 * - **钱不折成 token。** `aggregateCredit.ts` 的余额（USD / CNY）不参与任何比例、
 *   不进 `band`、不改推荐星。余额耗尽只作为一条「去充值」的原因出现。
 * - **官方没公布就是没公布。** 一个窗口上限都没有时 `band` 是 `'undocumented'`，
 *   不是 `'ample'`、也不是 `0`。
 *
 * 与 `shared/aggregateQuotaView.ts` 的分工：那个服务「这家有没有免费额度」的目录页，
 * 读的是静态目录；这个服务**某个模型此刻**的余量与排队，读的是账本 + 声明 + 现场证据。
 */

/** 参与展示的窗口粒度。`fiveHour` 只能由用户声明给出（官方表里没有这一档）。 */
export type RouteQuotaWindow = 'minute' | 'day' | 'fiveHour' | 'week' | 'month'

/** 额度读数/跳过原因的出处，界面按这个决定用不用「约」。 */
export type RouteQuotaResetSource = 'upstream' | 'local' | 'estimated'

/** 上限的出处：官方文档 / 我们自己学到的实测帽 / 用户声明。 */
export type RouteQuotaCapSource = 'documented' | 'learned' | 'declared'

/**
 * 额度闸门的原因（`main/proxy/quota/limits.ts::QuotaBlockReason` 的镜像）。
 *
 * shared 不能反向依赖 main，所以两边各写一份，由
 * `tests/routes/route-quota-view.test.ts` 钉住不许漂移。
 */
export type RouteQuotaBlockReason =
  | 'no-credit'
  | 'quota-exhausted'
  | 'declared-exhausted'
  | 'rpm_exhausted'
  | 'rpd_exhausted'
  | 'tpm_exhausted'
  | 'tpd_exhausted'
  | 'monthly_exhausted'

/**
 * 「这一轮会被跳过」的完整原因（展示层口径）。
 *
 * 前一组来自额度闸门；后两条来自采集阶段的瞬时剔除（`autoRouter.TransientSkip`）：
 * 账号当日上限、渠道 worker 的模型级限流。两者都会自己复位，所以都带一个解禁时刻
 * —— 差别只在那个时刻是谁给的（当日上限是本地午夜 `local`，worker 的读数是 `upstream`）。
 *
 * **进程内失败退避（`accountRuntime.coolingUntil`）刻意不在这里。** 菜单读的是
 * `preview`，而预览明确「不扣冷却」（它回答的是配置层的候选，不是某一次请求的最终
 * 候选）。把冷却也算进来，菜单就会在每次上游失败后抖一下，用户看到的是一行行自己
 * 闪进闪出的「被挡下」——那不是排队，那是噪声。
 */
export type RouteBlockReason = RouteQuotaBlockReason | 'daily_limit' | 'rate_limited'

/** 一行额度读数。 */
export interface RouteQuotaWindowRow {
  window: RouteQuotaWindow
  /** token 窗口还是请求窗口：两者永不互换。 */
  unit: 'tokens' | 'requests'
  limit: number
  used: number
  /** 非负；`limit - used` 的下界。 */
  remaining: number
  /** 复位时刻（毫秒）；算不出来就缺席。 */
  resetAt?: number
  resetSource: RouteQuotaResetSource
  source: RouteQuotaCapSource
  /** 已用比例（0..1，>1 表示已超）。便于排「谁最快见底」。 */
  usedRatio: number
}

/**
 * 余量档。`undocumented` = 一条可执行上限都没有（官方未公布、用户也没声明），
 * 不是「充裕」。
 */
export type RouteQuotaBand = 'ample' | 'tight' | 'exhausted' | 'undocumented'

/** 这个模型此刻的额度概况（多账号、多窗口折成一份）。 */
export interface RouteQuotaSummary {
  band: RouteQuotaBand
  /** 展示用的前几行：打满的在前，其余按复位时刻由近到远。 */
  rows: RouteQuotaWindowRow[]
  /** 还有余量、且知道复位时刻的窗口里**最近**的那个 —— 「即将过期」的那一笔。 */
  soonestExpiryAt?: number
  /** 参与折叠的读数总数（`rows` 只是其中前几行）。 */
  windows: number
}

/** 一个模型这一轮被跳过的原因与解禁时刻。 */
export interface RouteModelBlock {
  reason: RouteBlockReason
  /** 解禁时刻（毫秒）；钱不够这类没有时刻的原因缺席。 */
  until?: number
  /** `until` 的出处，界面按它决定写「」还是「约」。 */
  untilSource?: RouteQuotaResetSource
}

/** 每行最多展示几条窗口：够说清「哪个窗口、还剩多少、什么时候复位」。 */
export const ROUTE_QUOTA_ROWS = 3
/** `tight` 的门槛：已用 ≥ 80%。只用于分档，不参与选路。 */
export const ROUTE_QUOTA_TIGHT_RATIO = 0.8

/** 额度窗口在显示层的窗口归属（与 `aggregateQuotaView.WINDOW_OF_METRIC` 同口径）。 */
export const ROUTE_WINDOW_OF_METRIC: Record<'rpm' | 'tpm' | 'rpd' | 'tpd' | 'monthlyTokens', RouteQuotaWindow> = {
  rpm: 'minute',
  tpm: 'minute',
  rpd: 'day',
  tpd: 'day',
  monthlyTokens: 'month',
}

export function emptyQuotaSummary(): RouteQuotaSummary {
  return { band: 'undocumented', rows: [], windows: 0 }
}

/** 已用比例：`limit <= 0` 视为没有上限，返回 0（不制造一个假的 100%）。 */
function ratioOf(used: number, limit: number): number {
  if (!(limit > 0)) return 0
  return Math.max(0, used) / limit
}

/**
 * 把多账号、多来源的读数折成一行展示口径。
 *
 * 入参按**账号分组**（每个账号一组读数，`summarizeQuotaRows([acct1Rows, acct2Rows])`）。
 * 分组是必要的，因为两个问题问的不是同一件事：
 *
 * - **这个模型此刻能不能派？** 能 —— 只要**还有一把**账号在每个窗口上都没满。所以
 *   `band` 取各账号里**最宽**的那一个（最好的账号说了算）。
 * - **哪一笔配额最该赶紧用掉？** `rows` 按窗口折叠，逐个 `(窗口, 单位, 出处, 上限)`
 *   取**最紧**的那一份：一行只写一次，写的是「最容易撞墙的那个数」。
 *
 * 两组口径都不做平均：平均值会把「有一把已经撞墙」抹成「还挺宽裕」，也会把「有一把
 * 还空着」抹成「快满了」，两种谎都撒。
 *
 * 一条可执行上限都没有的账号（官方没公布、用户也没声明）**不参与 `band`**：它对
 * 「我们知不知道该不该省着用」没有贡献，所以「不知道」不会在这里变成「充裕」。
 * 全部账号都是这种时 `band` 就是 `undocumented`。
 *
 * **排序**：打满的在前（它解释本轮为什么被跳过），其余按 `resetAt` 由近到远 ——
 * 「即将过期」的那一笔就该排在最前面。没有 `resetAt` 的排最后（不猜）。
 */
export function summarizeQuotaRows(
  groups: readonly (readonly RouteQuotaWindowRow[])[],
  limit = ROUTE_QUOTA_ROWS,
): RouteQuotaSummary {
  if (groups.every(group => group.length === 0)) return emptyQuotaSummary()

  // 每把账号自己有多紧：任一窗口满 → 这把派不出去（1）；否则取最紧的那个窗口。
  let bestRatio = Number.POSITIVE_INFINITY
  for (const group of groups) {
    if (group.length === 0) continue
    let worst = 0
    for (const row of group) worst = Math.max(worst, row.usedRatio)
    bestRatio = Math.min(bestRatio, worst)
  }

  // 折叠：同 (window, unit, source, limit) 里取已用最高的那份。不同的 limit（比如两个
  // 账号声明了不同上限）各自保留，它们不是同一个窗口。
  const tightest = new Map<string, RouteQuotaWindowRow>()
  for (const group of groups) {
    for (const row of group) {
      const key = `${row.window}\u0000${row.unit}\u0000${row.source}\u0000${row.limit}`
      const current = tightest.get(key)
      if (current === undefined || row.used > current.used) tightest.set(key, row)
    }
  }
  const folded = [...tightest.values()]
  if (folded.length === 0) return emptyQuotaSummary()

  let soonestExpiryAt: number | undefined
  for (const row of folded) {
    if (row.remaining <= 0) continue
    if (row.resetAt === undefined) continue
    if (soonestExpiryAt === undefined || row.resetAt < soonestExpiryAt) soonestExpiryAt = row.resetAt
  }

  const band: RouteQuotaBand = bestRatio === Number.POSITIVE_INFINITY
    ? 'undocumented'
    : bestRatio >= 1
      ? 'exhausted'
      : bestRatio >= ROUTE_QUOTA_TIGHT_RATIO
        ? 'tight'
        : 'ample'

  const rows = [...folded].sort((a, b) => {
    const aFull = a.remaining <= 0 ? 0 : 1
    const bFull = b.remaining <= 0 ? 0 : 1
    if (aFull !== bFull) return aFull - bFull
    if (a.resetAt !== undefined && b.resetAt !== undefined && a.resetAt !== b.resetAt) {
      return a.resetAt - b.resetAt
    }
    if (a.resetAt === undefined && b.resetAt !== undefined) return 1
    if (a.resetAt !== undefined && b.resetAt === undefined) return -1
    // 最后按「越紧越前」，让同样没有复位时刻的两行有确定顺序。
    return b.usedRatio - a.usedRatio
  }).slice(0, Math.max(1, limit))

  return {
    band,
    rows,
    ...(soonestExpiryAt === undefined ? {} : { soonestExpiryAt }),
    windows: folded.length,
  }
}

/**
 * 官方 / 实测帽 → 展示行。
 *
 * `limits` 与 `provenance` 来自 `quota/limits.ts::resolveCaps`，`usage` 是
 * `ledger.snapshot`。复位时刻：分钟/日窗口是滚动窗口，只有账本知道最老一笔用量，
 * 所以由调用方通过 `resetAtOf` 给出；月度是 UTC 自然边界，`resetAtOf` 直接返回下月起点。
 */
export function documentedQuotaRows(
  limits: Partial<Record<'rpm' | 'rpd' | 'tpm' | 'tpd' | 'monthlyTokens', number>>,
  provenance: Partial<Record<'rpm' | 'rpd' | 'tpm' | 'tpd' | 'monthlyTokens', 'documented' | 'learned' | 'documented-model'>>,
  usage: { rpm: number; rpd: number; tpm: number; tpd: number; monthlyTokens: number },
  resetAtOf: (metric: 'rpm' | 'rpd' | 'tpm' | 'tpd' | 'monthlyTokens') => RouteQuotaWindowRow['resetAt'],
  resetSource: RouteQuotaResetSource = 'estimated',
): RouteQuotaWindowRow[] {
  const rows: RouteQuotaWindowRow[] = []
  for (const metric of ['monthlyTokens', 'rpd', 'tpd', 'rpm', 'tpm'] as const) {
    const limit = limits[metric]
    if (typeof limit !== 'number' || !(limit > 0)) continue
    const source = provenance[metric]
    const used = usage[metric] ?? 0
    const resetAt = resetAtOf(metric)
    rows.push({
      window: ROUTE_WINDOW_OF_METRIC[metric],
      unit: metric === 'rpm' || metric === 'rpd' ? 'requests' : 'tokens',
      limit,
      used,
      remaining: Math.max(0, limit - used),
      ...(resetAt === undefined ? {} : { resetAt }),
      // `documented-model` 是逐模型帽：界面上它就是「官方公布」的一种。
      resetSource,
      source: source === 'learned' ? 'learned' : 'documented',
      usedRatio: ratioOf(used, limit),
    })
  }
  return rows
}

/** 用户声明 → 展示行。复位时刻与出处由调用方按窗口性质给出。 */
export function declaredQuotaRows(
  declared: ReadonlyArray<{ window: 'fiveHour' | 'day' | 'week' | 'month'; unit: 'tokens' | 'requests'; limit: number }>,
  usageOf: (window: 'fiveHour' | 'day' | 'week' | 'month') => { requests: number; tokens: number },
  resetAtOf: (window: 'fiveHour' | 'day' | 'week' | 'month') => { resetAt?: number; resetSource: RouteQuotaResetSource },
): RouteQuotaWindowRow[] {
  return declared.map(entry => {
    const usage = usageOf(entry.window)
    const used = entry.unit === 'tokens' ? usage.tokens : usage.requests
    const { resetAt, resetSource } = resetAtOf(entry.window)
    return {
      window: entry.window,
      unit: entry.unit,
      limit: entry.limit,
      used,
      remaining: Math.max(0, entry.limit - used),
      ...(resetAt === undefined ? {} : { resetAt }),
      resetSource,
      source: 'declared' as const,
      usedRatio: ratioOf(used, entry.limit),
    }
  })
}

/**
 * 跳过原因的人话键（i18n 的 `routes.block_<reason>`）。
 *
 * 只做映射，不拼文案：文案走两个语言包，拼在代码里就没法翻译。用**扁平**键而不是
 * `routes.block.<reason>`：本仓的语言包全是扁平前缀（`routePoolStatus_kept` 那一套），
 * 混进一层嵌套会让两种风格在同一个人手里各写一遍。
 */
export function blockReasonKey(reason: RouteBlockReason): string {
  return `routes.block_${reason}`
}

/**
 * 一条原因在展示上的优先级：数字越小越靠前（同一行只能写一个原因时取它）。
 *
 * 排序不是「谁更严重」而是「谁更需要用户动手 / 谁更晚才会自己好」：钱要人去充、
 * 上游亲口拒过是现场证据、月窗口最晚复位、限流几秒就好。菜单一行只写一个原因，
 * 取最小的那个，别让一行同时挂着五种说法。
 */
const BLOCK_REASON_RANK: Record<RouteBlockReason, number> = {
  'no-credit': 0,
  'quota-exhausted': 1,
  'declared-exhausted': 2,
  monthly_exhausted: 3,
  tpd_exhausted: 4,
  rpd_exhausted: 5,
  tpm_exhausted: 6,
  rpm_exhausted: 7,
  daily_limit: 8,
  rate_limited: 9,
}

export function blockReasonRank(reason: RouteBlockReason): number {
  return BLOCK_REASON_RANK[reason] ?? 99
}

/**
 * 两条阻塞记录取哪一条显示。
 *
 * 先按原因优先级，同原因取**更早**解禁的那个（更早可恢复的先说，用户更早能指望它）。
 * 都没有 `until` 时保持先到的 —— 稳定、可复算。
 */
export function preferBlock(current: RouteModelBlock | undefined, next: RouteModelBlock): RouteModelBlock {
  if (current === undefined) return next
  const delta = blockReasonRank(next.reason) - blockReasonRank(current.reason)
  if (delta !== 0) return delta < 0 ? next : current
  if (current.until === undefined) return next
  if (next.until === undefined) return current
  return next.until < current.until ? next : current
}

/**
 * 一段时长的人话分段（`{ unit, n }`），由界面按语言拼。
 *
 * 只给单位与数量，不在 shared 里拼文案 —— 一句话要过两个语言包。取整方向上偏
 * **保守**（向上取整）：写「约 3 小时后复位」而不是「约 2 小时」，差一分钟就说
 * 放行了会让人以为它卡住了。
 */
export function describeDelay(ms: number): { unit: 'minutes' | 'hours' | 'days'; n: number } {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return { unit: 'minutes', n: minutes }
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return { unit: 'hours', n: hours }
  return { unit: 'days', n: Math.ceil(hours / 24) }
}

/**
 * 这一条原因是不是「钱」。
 *
 * 钱与 token 互不可比（本仓的硬口径）：余额耗尽可以是一条原因、一条「去充值」的提示，
 * 但**不许**进余量档、更不许改推荐星。UI 与星推导都读这一个判据，免得两处各写一份。
 */
export function isMoneyBlock(reason: RouteBlockReason): boolean {
  return reason === 'no-credit'
}