/**
 * 「自动领取已完成的成长任务」—— 独立开关、默认关、只领不接单。
 *
 * ## 为什么不并进 `auto-checkin.ts`
 *
 * 两者共用「按渠道、按 UTC+8 日」的记账形状，但**动作代价不同**：签到是每号每天一次
 * 固定请求；成长任务的领取是「服务端认定已完成」之后的写请求，且**接单**会改变账号
 * 状态（本执行体明确不接单）。并进同一个开关会让用户以为打开的是同一件事，
 * 而这条开关的默认值必须是关（与 2026-11-05 对自动签到的同一条理由：
 * 无人值守地替用户敲账号，是上游判「非官方客户端」时唯一完全可避免的那部分流量）。
 *
 * ## 记账口径
 *
 * 与 `auto-checkin.ts` 完全同构：**逐渠道**记 `YYYY-MM-DD`（UTC+8 算术平移，不用本机时区），
 * 只有「今天已处理」的渠道跳过；有失败账号或整号失败的渠道留在 `pendingProviders` 里由
 * 重试定时器补；跨日后记账自然失效，下一轮全部重跑。全部完成时一轮零上游请求。
 *
 * ## 什么算「今天已处理」
 *
 * 该渠道本轮 `summary.errors === 0 && summary.failedTasks === 0`。
 * ⚠️ **不看 `notClaimableTasks`**：那些是「还没做完」的项，今天没做完不等于明天没做完，
 * 但当天再跑也不会有结果 —— 与签到里「活动未开启」同档，记完成、留给明天。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { utc8DateString } from './utc8-date.js'
import { resolveChannelPackHome } from './channel-pack-store.js'
import type { BadgeRpcResult } from './usage-badge.js'
import type { RpcOnboardingClaimAllResponse, RpcUsageAutoGrowthState } from './types.js'

/** 独立文档（与 `auto-checkin.json` 并列，互不覆盖）。 */
export const AUTO_GROWTH_FILE = 'auto-growth.json'

const SCHEMA = 'channel-pack/auto-growth/v1'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 是否为**真实存在**的 `YYYY-MM-DD`。
 *
 * ⚠️ 只验形状不够：`2026-13-99` / `2026-02-31` 都能过正则。把它当「今天已跑」的凭据
 * 虽然几乎不可能恰好等于今天，但脏值进文档后会在界面上显示成一个不存在的日期，
 * 而且排查时会把「没跑」误读成「跑过」。
 */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

export interface AutoGrowthDoc {
  /** 开关。**默认关**：只有显式 `true` 才算开（缺键落在关）。 */
  enabled: boolean
  /** 是否用户亲手拨过（`'user'`）。没有该标记的老文档一律按关处理。 */
  decidedBy?: 'user'
  /** 上次**完成**的 UTC+8 日期；空串 = 从未跑过。 */
  lastDate: string
  /** 上次结果摘要（中文短句）。 */
  lastResult: string
  /** 上次跑完的时刻（毫秒）；0 = 从未跑过。 */
  lastAt: number
  /** 逐渠道记账：provider -> YYYY-MM-DD。 */
  providerDates: Record<string, string>
  /** 今天仍未处理完的渠道 id。 */
  pendingProviders: string[]
  /** 用户点过关闭的那一轮（存 lastAt 值）；0 = 未关闭过。 */
  dismissedRunAt: number
}

export const DEFAULT_AUTO_GROWTH: AutoGrowthDoc = {
  enabled: false,
  lastDate: '',
  lastAt: 0,
  lastResult: '',
  providerDates: {},
  pendingProviders: [],
  dismissedRunAt: 0,
}

/** 归一化：脏数据一律回落默认值（**不抛错** —— 这是后台任务）。 */
export function sanitizeAutoGrowth(raw: unknown): AutoGrowthDoc {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_AUTO_GROWTH }
  const record = raw as Record<string, unknown>
  const dates: Record<string, string> = {}
  const rawDates = record.providerDates
  if (typeof rawDates === 'object' && rawDates !== null && !Array.isArray(rawDates)) {
    for (const [provider, value] of Object.entries(rawDates as Record<string, unknown>)) {
      if (provider.length === 0 || provider.length > 64) continue
      if (isCalendarDate(value)) dates[provider] = value
    }
  }
  const pending = Array.isArray(record.pendingProviders)
    ? record.pendingProviders.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 64)
    : []
  const ms = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
  return {
    // 缺键 / 无 `decidedBy` 一律按关：旧默认值的 `true` 不算用户选择。
    enabled: record.decidedBy === 'user' && record.enabled === true,
    ...(record.decidedBy === 'user' ? { decidedBy: 'user' as const } : {}),
    lastDate: isCalendarDate(record.lastDate) ? record.lastDate : '',
    lastResult: typeof record.lastResult === 'string' ? record.lastResult.slice(0, 200) : '',
    lastAt: ms(record.lastAt),
    providerDates: dates,
    pendingProviders: [...new Set(pending)].slice(0, 24),
    dismissedRunAt: ms(record.dismissedRunAt),
  }
}

export interface AutoGrowthStore {
  readonly kind: 'file' | 'memory'
  load(): AutoGrowthDoc
  save(doc: AutoGrowthDoc): Promise<void>
}

class MemoryAutoGrowthStore implements AutoGrowthStore {
  readonly kind = 'memory' as const
  private doc: AutoGrowthDoc = { ...DEFAULT_AUTO_GROWTH }
  load(): AutoGrowthDoc { return { ...this.doc } }
  async save(doc: AutoGrowthDoc): Promise<void> { this.doc = { ...doc } }
}

class FileAutoGrowthStore implements AutoGrowthStore {
  readonly kind = 'file' as const
  // ⚠️ 不用「参数属性」（`constructor(private readonly path: string)`）：Node 的
  // strip-only 类型擦除不支持它，模块就无法被 `node --test` 直接加载（本项目
  // 共享盘上不能跑 esbuild，见 tests/channels/buddy-growth.test.ts 的文件头）。
  private readonly path: string
  private readonly logger: { warn(message: string): void } | undefined

  constructor(path: string, logger: { warn(message: string): void } | undefined) {
    this.path = path
    this.logger = logger
  }
  load(): AutoGrowthDoc {
    try {
      if (!existsSync(this.path)) return { ...DEFAULT_AUTO_GROWTH }
      return sanitizeAutoGrowth(JSON.parse(readFileSync(this.path, 'utf-8')) as unknown)
    } catch (error) {
      // 读不到就按默认（关）：后果是「今天不自动领」，而不是替用户去敲账号。
      this.logger?.warn(`[channel-pack] 读取 ${this.path} 失败，自动领取按默认设置（关闭）处理: ${String(error)}`)
      return { ...DEFAULT_AUTO_GROWTH }
    }
  }
  async save(doc: AutoGrowthDoc): Promise<void> {
    mkdirSync(join(this.path, '..'), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify({
      schema: SCHEMA,
      enabled: doc.enabled,
      // ⚠️ 必须落盘：`sanitizeAutoGrowth` 只认 `decidedBy === 'user' && enabled === true`。
      ...(doc.decidedBy === 'user' ? { decidedBy: 'user' as const } : {}),
      lastDate: doc.lastDate,
      lastResult: doc.lastResult,
      lastAt: doc.lastAt,
      providerDates: doc.providerDates,
      pendingProviders: doc.pendingProviders,
      dismissedRunAt: doc.dismissedRunAt,
    }, null, 2), 'utf-8')
    renameSync(tmp, this.path)
  }
}

export function createAutoGrowthStore(ctx: Context): AutoGrowthStore {
  const home = resolveChannelPackHome(ctx)
  if (home === undefined) {
    ctx.logger?.warn?.('[channel-pack] 无法定位 DSH home，自动领取开关仅存在于内存中')
    return new MemoryAutoGrowthStore()
  }
  return new FileAutoGrowthStore(join(home, 'channel-pack', AUTO_GROWTH_FILE), ctx.logger)
}

/** 启动后延迟多久再跑第一轮（毫秒）。 */
export const DSH_CHANNEL_PACK_AUTO_GROWTH_DELAY_MS = 'DSH_CHANNEL_PACK_AUTO_GROWTH_DELAY_MS'
/** 默认 90s：比自动签到晚一点，避免启动瞬间和续期/签到抢上游。 */
export const AUTO_GROWTH_DELAY_MS = 90_000
/** 当天未完成渠道的重试间隔（毫秒）。 */
export const DSH_CHANNEL_PACK_AUTO_GROWTH_RETRY_MS = 'DSH_CHANNEL_PACK_AUTO_GROWTH_RETRY_MS'
/** 默认 60 分钟：领取是一次性动作，比签到的 30 分钟更慢就够。 */
export const AUTO_GROWTH_RETRY_MS = 60 * 60_000

export function autoGrowthDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[DSH_CHANNEL_PACK_AUTO_GROWTH_DELAY_MS]
  if (typeof raw !== 'string' || raw.trim().length === 0) return AUTO_GROWTH_DELAY_MS
  const parsed = Number(raw.trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : AUTO_GROWTH_DELAY_MS
}

export function autoGrowthRetryMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[DSH_CHANNEL_PACK_AUTO_GROWTH_RETRY_MS]
  if (typeof raw !== 'string' || raw.trim().length === 0) return AUTO_GROWTH_RETRY_MS
  const parsed = Number(raw.trim())
  // ⚠️ 与签到同理：`0` 会变成死循环，非法值回落默认。
  return Number.isFinite(parsed) && parsed > 0 ? parsed : AUTO_GROWTH_RETRY_MS
}

/** 把一轮结果拼成一句中文摘要。 */
export function describeGrowthRun(summary: {
  accounts: number
  claimedTasks: number
  failedTasks: number
  alreadyClaimedTasks: number
  notClaimableTasks: number
  errors: number
  gained: { credit: number; energy: number }
}): string {
  const parts: string[] = []
  if (summary.claimedTasks > 0) {
    const gains: string[] = []
    if (summary.gained.credit > 0) gains.push(`+${summary.gained.credit}积分`)
    if (summary.gained.energy > 0) gains.push(`+${summary.gained.energy}能量`)
    parts.push(`领到 ${summary.claimedTasks} 项${gains.length > 0 ? `（${gains.join('，')}）` : ''}`)
  }
  if (summary.alreadyClaimedTasks > 0) parts.push(`${summary.alreadyClaimedTasks} 项此前已领`)
  if (summary.notClaimableTasks > 0) parts.push(`${summary.notClaimableTasks} 项还没做完`)
  if (summary.failedTasks > 0) parts.push(`${summary.failedTasks} 项领取失败`)
  if (summary.errors > 0) parts.push(`${summary.errors} 个账号没问出结果`)
  if (parts.length === 0) return `${summary.accounts} 个渠道：没有可领取的任务`
  return `${summary.accounts} 个渠道：${parts.join('，')}`
}

export interface AutoGrowthDeps {
  store: AutoGrowthStore
  /** 列出**账号池里有账号**的渠道 id。 */
  listProviderIds(): Promise<string[]>
  /** 调 `onboarding.claimAll`（**只领已完成**，绝不接单）。 */
  claim(provider: string): Promise<BadgeRpcResult<RpcOnboardingClaimAllResponse>>
  now?(): number
  delayMs?: number
  retryMs?: number
  schedule?(fn: () => void, ms: number): { cancel(): void }
  warn?(message: string): void
}

export interface AutoGrowth {
  state(): RpcUsageAutoGrowthState
  setEnabled(enabled: boolean): Promise<RpcUsageAutoGrowthState>
  dismiss(): Promise<RpcUsageAutoGrowthState>
  start(): void
  runIfDue(): Promise<void>
  stop(): void
}

/** 该渠道今天算不算处理完：没有失败项、没有整号失败。 */
function isSettled(summary: RpcOnboardingClaimAllResponse['summary'] | undefined): boolean {
  if (summary === undefined) return false
  return summary.failedTasks === 0 && summary.errors === 0
}

export function createAutoGrowth(deps: AutoGrowthDeps): AutoGrowth {
  const now = deps.now ?? (() => Date.now())
  const schedule = deps.schedule ?? defaultSchedule
  let doc = deps.store.load()
  let running = false
  let inflight: Promise<void> | null = null
  let pending: { cancel(): void } | null = null
  let retryTimer: { cancel(): void } | null = null
  let nextRetryAt = 0
  const today = (): string => utc8DateString(now())

  function state(): RpcUsageAutoGrowthState {
    return {
      enabled: doc.enabled,
      lastDate: doc.lastDate,
      ranToday: doc.lastDate !== '' && doc.lastDate === today(),
      running,
      lastResult: doc.lastResult,
      lastAt: doc.lastAt,
      pending: doc.pendingProviders.length,
      pendingProviders: [...doc.pendingProviders],
      nextRetryAt,
      dismissed: doc.lastAt > 0 && doc.dismissedRunAt === doc.lastAt,
    }
  }

  async function performRun(): Promise<void> {
    const runDate = today()
    let providers: string[] = []
    try {
      providers = [...new Set(await deps.listProviderIds())].sort()
    } catch (error) {
      deps.warn?.(`[channel-pack] 自动领取任务：读取账号池失败，本次跳过: ${String(error)}`)
      return
    }
    if (providers.length === 0) return

    const dates: Record<string, string> = {}
    for (const [provider, date] of Object.entries(doc.providerDates)) {
      if (date === runDate) dates[provider] = date
    }
    const totals = {
      accounts: 0, claimedTasks: 0, failedTasks: 0,
      alreadyClaimedTasks: 0, notClaimableTasks: 0, errors: 0,
      gained: { credit: 0, energy: 0 },
    }
    let changed = false
    for (const provider of providers) {
      if (dates[provider] === runDate) continue
      changed = true
      let result: BadgeRpcResult<RpcOnboardingClaimAllResponse>
      try {
        result = await deps.claim(provider)
      } catch (error) {
        totals.errors += 1
        deps.warn?.(`[channel-pack] 自动领取任务：${provider} 调用异常: ${String(error)}`)
        continue
      }
      if (!result.ok) {
        totals.errors += 1
        deps.warn?.(`[channel-pack] 自动领取任务：${provider} 失败: ${result.error?.message ?? '未知错误'}`)
        continue
      }
      const summary = result.value?.summary
      if (summary === undefined) {
        dates[provider] = runDate
        continue
      }
      totals.accounts += summary.accounts
      totals.claimedTasks += summary.claimedTasks
      totals.failedTasks += summary.failedTasks
      totals.alreadyClaimedTasks += summary.alreadyClaimedTasks
      totals.notClaimableTasks += summary.notClaimableTasks
      totals.errors += summary.errors
      totals.gained.credit += Number(summary.gained?.credit) || 0
      totals.gained.energy += Number(summary.gained?.energy) || 0
      if (isSettled(summary)) dates[provider] = runDate
    }

    const pendingProviders = providers.filter((provider) => dates[provider] !== runDate)
    const allSettled = pendingProviders.length === 0
    if (!changed && !(allSettled && doc.lastDate !== runDate)) return

    doc = {
      ...doc,
      providerDates: dates,
      pendingProviders,
      ...(changed
        ? { lastResult: describeGrowthRun(totals), lastAt: now(), dismissedRunAt: 0 }
        : {}),
      ...(allSettled ? { lastDate: runDate } : {}),
    }
    try {
      await deps.store.save(doc)
    } catch (error) {
      deps.warn?.(`[channel-pack] 自动领取任务结果写入失败（可能重复一轮）: ${String(error)}`)
    }
  }

  function armRetry(): void {
    retryTimer?.cancel()
    retryTimer = null
    nextRetryAt = 0
    if (!doc.enabled) return
    const ms = deps.retryMs ?? autoGrowthRetryMs()
    if (!(ms > 0)) return
    nextRetryAt = now() + ms
    retryTimer = schedule(() => {
      retryTimer = null
      nextRetryAt = 0
      void runIfDue()
    }, ms)
  }

  function runIfDue(): Promise<void> {
    if (inflight !== null) return inflight
    if (!doc.enabled) return Promise.resolve()
    running = true
    const task = performRun().catch((error: unknown) => {
      deps.warn?.(`[channel-pack] 自动领取任务异常: ${String(error)}`)
    }).finally(() => {
      running = false
      inflight = null
      armRetry()
    })
    inflight = task
    return task
  }

  return {
    state,
    async setEnabled(enabled) {
      doc = { ...doc, enabled, decidedBy: 'user' }
      await deps.store.save(doc)
      if (enabled) {
        void runIfDue()
      } else {
        retryTimer?.cancel()
        retryTimer = null
        nextRetryAt = 0
      }
      return state()
    },
    async dismiss() {
      doc = { ...doc, dismissedRunAt: doc.lastAt }
      try {
        await deps.store.save(doc)
      } catch (error) {
        deps.warn?.(`[channel-pack] 自动领取状态文字关闭标记写入失败: ${String(error)}`)
      }
      return state()
    },
    start() {
      if (pending !== null) return
      const ms = deps.delayMs ?? autoGrowthDelayMs()
      const fire = (): void => { pending = null; void runIfDue() }
      if (ms <= 0) { fire(); return }
      pending = schedule(fire, ms)
    },
    runIfDue,
    stop() {
      pending?.cancel()
      pending = null
      retryTimer?.cancel()
      retryTimer = null
      nextRetryAt = 0
    },
  }
}

/** `setTimeout` + `unref()`：待执行的定时器不能拖住宿主进程退出。 */
function defaultSchedule(fn: () => void, ms: number): { cancel(): void } {
  const timer = setTimeout(fn, ms)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}