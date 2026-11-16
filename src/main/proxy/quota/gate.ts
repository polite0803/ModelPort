/**
 * 额度闸门：给选号阶段用的一句判断。
 *
 * 三处调用方（auto 候选枚举、命名模型的账号过滤、裸名跨家链）共用这一份，
 * 免得同一个判据各写一遍之后开始漂移。
 *
 * 两条不可让步的规则：
 * - 只对聚合目录的家生效：别的类型没有额度旁表，判了也是凭空拒绝。
 * - 账本读不出来时放行并记日志：保护层的缺席不能变成"这家不能服务"。
 *
 * 第三条（实时余量那一层）同样不可让步：上游问回来的余额是**钱**（USD / CNY），
 * 账本里的是 token，两者互不可比，所以实时余量**只当闸门、不当数字** ——
 * 它唯一能做的是把"每一把被问过的 Key 都一分钱不剩"这家排到最后（`-1`，既有语义），
 * 任何情况下都不把美元/人民币折进 token 比例里。
 */

import { storeManager } from '../../store/store'
import {
  creditSnapshotExhausted,
  type AggregateCreditSnapshots,
} from '../../../shared/aggregateCredit.ts'
import { exhaustionExpiresAt, findExhaustion } from '../../../shared/aggregateQuotaExhaustion.ts'
import type { AggregateQuotaExhaustionRecord } from '../../../shared/aggregateQuotaExhaustion.ts'
import {
  anchoredWindow,
  evaluateDeclaredQuota,
  normalizeDeclaredQuota,
  rollingResetAt,
  type DeclaredQuotaLimit,
  type DeclaredQuotaWindow,
} from '../../../shared/declaredQuota.ts'
import type { Account } from '../../store/types'
import { evaluateQuota, resolveCaps, type QuotaBlockReason } from './limits.ts'
import { nextRollingBoundary, nextUtcMonthStart } from '../../../shared/quotaPacing.ts'
import {
  declaredQuotaRows,
  documentedQuotaRows,
  summarizeQuotaRows,
  type RouteQuotaResetSource,
  type RouteQuotaSummary,
  type RouteQuotaWindowRow,
} from '../../../shared/routeQuotaView.ts'

/**
 * 一次选号内复用的 store 读取上下文。
 *
 * `electron-store` 带 encryptionKey 时没有内存缓存：每次 `get` 都要把整份
 * `data.json` 读盘、跑一遍 PBKDF2 再 AES 解密。选号循环按 (账号, 模型) 逐条问
 * 闸门，一次请求能把同一张余额快照读几百遍 —— 主进程因此被同步 I/O 钉住，
 * 其它请求的首字节只能排队等它。
 *
 * 上下文的范围就是这一次选号：余额快照是人手点出来的读数，选号途中不会变；
 * 账号表同理。两者各只读一次，后续都是对象/数组查找。
 */
export interface QuotaGateContext {
  /** 实时余额快照；首次使用时读一次 store。 */
  snapshots(): AggregateCreditSnapshots
  /** `entryId → 账号`；同一上下文内同一家只查一次 store。 */
  accountsByProvider(entryId: string): Account[]
  /** `entryId → 上游拒绝记录`；同一上下文内同一家也只读一次。 */
  exhaustionsByProvider(entryId: string): AggregateQuotaExhaustionRecord[]
}

export function createQuotaGateContext(): QuotaGateContext {
  let snapshots: AggregateCreditSnapshots | undefined
  const accounts = new Map<string, Account[]>()
  const exhaustions = new Map<string, AggregateQuotaExhaustionRecord[]>()

  return {
    snapshots() {
      if (snapshots !== undefined) return snapshots
      try {
        snapshots = storeManager.getAggregateCreditSnapshots()
      } catch (error) {
        // 与 creditExhausted 同一条 fail-open：读不出来 = 没有证据，按空表放行。
        console.error('[QuotaGate] live credit snapshots unavailable:', error)
        snapshots = {}
      }
      return snapshots
    },
    accountsByProvider(entryId) {
      const cached = accounts.get(entryId)
      if (cached !== undefined) return cached
      const loaded = storeManager.getAccountsByProviderId(entryId)
      accounts.set(entryId, loaded)
      return loaded
    },
    exhaustionsByProvider(entryId) {
      const cached = exhaustions.get(entryId)
      if (cached !== undefined) return cached
      try {
        const loaded = storeManager.getAggregateQuotaExhaustionsOf(entryId)
        exhaustions.set(entryId, loaded)
        return loaded
      } catch (error) {
        console.error('[QuotaGate] quota exhaustion records unavailable:', error)
        exhaustions.set(entryId, [])
        return []
      }
    },
  }
}

/**
 * 实时余额快照是否构成"这家已超"。
 *
 * 判据全在 `shared/aggregateCredit.ts::creditSnapshotExhausted` 里：整行成立、明确不是
 * 无上限、问到了一个数、这个数 <= 0，并且 `asOf` 在 15 分钟内。TTL 之所以是 15 分钟：
 * 这一行是人手点出来的，用户不再点就不该继续影响路由；超时后界面照实展示并标"已过期"，
 * 只是这里返回 false。回退成本：改那一个常量。
 */
function creditExhausted(entryId: string, context?: QuotaGateContext): boolean {
  try {
    const snapshot = context === undefined
      ? storeManager.getAggregateCreditSnapshot(entryId)
      : context.snapshots()[entryId]
    return creditSnapshotExhausted(snapshot)
  } catch (error) {
    // 读不出快照 = 没有这条证据，闸门随之不生效；它绝不能变成"这家不能服务"。
    console.error('[QuotaGate] live credit snapshot unavailable:', error)
    return false
  }
}

/**
 * 这个 `(账号, 模型)` 被上游亲口拒过的现场记录（没有就是 `undefined`）。
 *
 * 与 `creditExhausted` 的区别是证据来源：那条看的是我们问回来的余额（整家、钱的单位），
 * 这条看的是"刚才这一笔确实被拒"的现场记录（逐账号逐模型、由一次真实调用证伪）。
 * 读不出来同样放行 —— 一条读盘失败不能变成"这家不能用"。
 */
function liveExhaustion(
  entryId: string,
  accountId: string,
  actualModel: string,
  context?: QuotaGateContext,
  nowMs = Date.now(),
): AggregateQuotaExhaustionRecord | undefined {
  try {
    const records = context === undefined
      ? storeManager.getAggregateQuotaExhaustionsOf(entryId)
      : context.exhaustionsByProvider(entryId)
    return findExhaustion(records, accountId, actualModel, nowMs)
  } catch (error) {
    console.error('[QuotaGate] quota exhaustion records unavailable:', error)
    return undefined
  }
}

/**
 * 额度闸门的判定结果：原因 + 解禁时刻 + 时刻出处。
 *
 * 与 `shared/routeQuotaView.ts::RouteModelBlock` 结构相同，`reason` 更窄（只有额度
 * 闸门说得出的那几种，不含采集阶段的 `daily_limit` / `rate_limited`）。窄的一侧
 * 放在这里，是因为闸门**不许**替采集阶段宣布原因；宽的一侧在 shared，给展示层用。
 */
export interface QuotaBlockDetail {
  reason: QuotaBlockReason
  until?: number
  untilSource?: RouteQuotaResetSource
}

/**
 * 这个 `(账号, 模型)` 为什么这一轮被挡下 —— 连同**什么时候能放行**。
 *
 * 与只回一个原因的区别：菜单要把「这一轮跳过它、约 N 小时后回来」写出来，而那个时刻
 * 有四种出处，混成一个数字就是编造。**时刻的出处与原因一起给**，界面据此决定写不写
 * 「约」：
 * - 上游亲口给的解禁时刻（`Retry-After` / 记录里的 `until`）→ `upstream`；
 * - 上游拒了但没给时刻，按 `QUOTA_EXHAUSTION_TTL_MS` 派生 → `local`（我们的记账规则）；
 * - UTC 自然月 / 用户声明的自然周月边界 → `local`；
 * - 滚动窗口按「最老一笔滑出」或窗口上界推算 → `estimated`。
 *
 * 钱（`no-credit`）**没有**时刻：能不能恢复取决于用户去不去充值，不给倒计时。
 */
export function quotaBlockDetail(
  provider: { id: string; type: string },
  accountId: string,
  actualModel: string,
  context?: QuotaGateContext,
  nowMs = Date.now(),
): QuotaBlockDetail | undefined {
  // 前四层（实时余额 / 上游亲口拒 / 官方帽 / 实测帽）只对聚合目录的家成立：别家
  // 没有额度旁表，判了也是凭空拒绝。**用户声明**是第五层，跟着账号走，任何类型都适用
  // —— 用户在一个 builtin 账号上写下「每天 200 次」就该按它执行。
  if (provider.type === 'aggregate') {
    // 没钱比"这个窗口打满了"更难恢复：窗口自己会复位，余额要用户去充。所以先说它。
    if (creditExhausted(provider.id, context)) return { reason: 'no-credit' }

    // 上游刚亲口说没额度：与"窗口打满"同一层语义（跳过这个候选，过期自动放行），
    // 但只挡这一把 Key 与这一个模型 —— 同家别的 Key/模型不受牵连。
    const record = liveExhaustion(provider.id, accountId, actualModel, context, nowMs)
    if (record !== undefined) {
      const until = exhaustionExpiresAt(record)
      return {
        reason: 'quota-exhausted',
        ...(until > 0 ? { until } : {}),
        // 上游给了 `until` 就是它说的；没给时这个时刻来自我们的 30 分钟存活期。
        untilSource: record.until === undefined ? 'local' : 'upstream',
      }
    }

    try {
      const ledger = storeManager.getQuotaLedger()
      const caps = resolveCaps(provider.id, actualModel, ledger.learnedFor(provider.id))
      const decision = evaluateQuota(caps, ledger.snapshot(provider.id, accountId, actualModel))
      const reason = decision.allowed ? undefined : decision.reason
      if (reason !== undefined) {
        const estimate = decision.metric === undefined
          ? undefined
          : windowResetEstimate(decision.metric, nowMs)
        return {
          reason,
          ...(estimate === undefined ? {} : { until: estimate }),
          // 月度是 UTC 自然边界（我们的记账规则）；分钟/日窗口是滚动估算。
          untilSource: decision.metric === 'monthlyTokens' ? 'local' : 'estimated',
        }
      }
    } catch (error) {
      console.error('[QuotaGate] quota preflight skipped:', error)
      return undefined
    }
  }

  return declaredBlock(provider.id, accountId, context, nowMs)
}

export function quotaBlockReason(
  provider: { id: string; type: string },
  accountId: string,
  actualModel: string,
  context?: QuotaGateContext
): QuotaBlockReason | undefined {
  return quotaBlockDetail(provider, accountId, actualModel, context)?.reason
}

/**
 * 用户声明的窗口（5 小时 / 日 / 周 / 月）是否已用满。
 *
 * 与官方帽**并列**而非替代：两套判据谁先满谁挡，因为它们是不同来源的两条事实。
 * 读不到账本时放行（与前四层同一个 fail-open）—— 保护层的缺席不能变成「这个账号
 * 不能服务」。没有任何声明时**不读账本**，热路径上不多付一次扫描。
 */
function declaredBlock(
  providerId: string,
  accountId: string,
  context?: QuotaGateContext,
  nowMs = Date.now(),
): QuotaBlockDetail | undefined {
  const declared = declaredQuotaOf(accountId, providerId, context)
  if (declared.length === 0) return undefined

  try {
    const ledger = storeManager.getQuotaLedger()
    const readingOf = (window: DeclaredQuotaWindow) =>
      ledger.declaredWindow(providerId, accountId, window, nowMs)
    const verdict = evaluateDeclaredQuota(
      declared,
      readingOf,
      window => declaredResetAt(readingOf(window), window, nowMs).resetAt,
    )
    if (verdict.allowed) return undefined
    // 复位时刻按**判出打满的那条声明的窗口**给：判据与读数必须是同一个窗口，
    // 否则「日窗口打满、却报周窗口的复位时刻」会把等待时间说小或说大。
    const window = verdict.limit?.window
    if (window === undefined) return { reason: 'declared-exhausted' }
    const { resetAt, resetSource } = declaredResetAt(readingOf(window), window, nowMs)
    return {
      reason: 'declared-exhausted',
      ...(resetAt === undefined ? {} : { until: resetAt }),
      untilSource: resetSource,
    }
  } catch (error) {
    console.error('[QuotaGate] declared quota preflight skipped:', error)
    return undefined
  }
}

/**
 * 这个账号在某家的声明额度（已归一）。
 *
 * 读的是账号记录本身，所以读不到也只是「没有声明」，不是「不能服务」—— 与其余
 * 几层的 fail-open 一致。`context` 里的账号缓存让一轮选号只读一次 store。
 */
export function declaredQuotaOf(
  accountId: string,
  providerId: string,
  context?: QuotaGateContext
): DeclaredQuotaLimit[] {
  try {
    const accounts = context === undefined
      ? storeManager.getAccountsByProviderId(providerId)
      : context.accountsByProvider(providerId)
    const account = accounts.find(candidate => candidate.id === accountId)
    return normalizeDeclaredQuota(account?.declaredQuota)
  } catch (error) {
    console.error('[QuotaGate] declared quota unavailable:', error)
    return []
  }
}

/**
 * 声明窗口的复位时刻与出处。
 *
 * 三种窗口给三种答案，**不许混**：
 * - 滚动（5 小时 / 日）：最老一笔用量滑出窗口的时刻 —— 我们按账本推的，`estimated`；
 * - UTC 自然周 / 月：我们自己定的记账边界，`local`；
 * - 窗口里还没有任何用量：不给复位时刻（不猜）。
 */
export function declaredResetAt(
  reading: { requests: number; tokens: number; oldestAt?: number },
  window: DeclaredQuotaWindow,
  nowMs: number,
): { resetAt?: number; resetSource: 'local' | 'estimated' } {
  if (window === 'week' || window === 'month') {
    return { resetAt: anchoredWindow(window, nowMs).resetAt, resetSource: 'local' }
  }
  const resetAt = rollingResetAt(window, reading.oldestAt, nowMs)
  return resetAt === undefined
    ? { resetSource: 'estimated' }
    : { resetAt, resetSource: 'estimated' }
}

/** 1 = 完全空；0 = 刚好打满；-1 = 已超（排最后）。没有官方数字的家给 0.5 的中性分。 */
export function aggregateHeadroom(
  entryId: string,
  modelId: string,
  context?: QuotaGateContext
): number {
  try {
    if (creditExhausted(entryId, context)) return -1

    const ledger = storeManager.getQuotaLedger()
    const caps = resolveCaps(entryId, modelId, ledger.learnedFor(entryId))
    if (!caps.enforceable) return 0.5

    const accounts = context === undefined
      ? storeManager.getAccountsByProviderId(entryId)
      : context.accountsByProvider(entryId)
    let worst = 0
    for (const account of accounts) {
      const usage = ledger.snapshot(entryId, account.id, modelId)
      for (const [metric, limit] of Object.entries(caps.limits) as Array<[keyof typeof usage, number]>) {
        if (limit > 0 && typeof usage[metric] === 'number') {
          worst = Math.max(worst, usage[metric] / limit)
        }
      }
    }
    return worst >= 1 ? -1 : 1 - worst
  } catch (error) {
    console.error('[QuotaGate] aggregate headroom unavailable:', error)
    return 0.5
  }
}

/**
 * 一个模型此刻的额度概况（按模型聚合、多账号取最紧）。
 *
 * 与 `aggregateHeadroom` 的分工：那个给打分一个 0..1 的数（1 空 / -1 已超），
 * 这个给界面一行「哪个窗口、还剩多少、什么时候复位、这个数哪来的」。两处读同一份
 * 账本，但**互不换算**：展示行里没有「综合余量百分比」，因为把请求窗口与 token 窗口
 * 折成一个数正是本仓禁止的事。
 *
 * 复位时刻一律按两种性质给：月度给下一个 UTC 自然月起点（我们自己的记账边界），
 * 分钟/日窗口给「最老一笔用量滑出窗口」的估算 —— 账本只有桶时间，这里不假装知道
 * 上游的复位时刻。上游声明的时刻由 `terminal_unlock` 另一条路径给出（`blocked.until`）。
 */
export function quotaSummaryOf(
  entryId: string,
  modelId: string,
  context?: QuotaGateContext,
  nowMs = Date.now(),
): RouteQuotaSummary {
  try {
    const ledger = storeManager.getQuotaLedger()
    const accounts = context === undefined
      ? storeManager.getAccountsByProviderId(entryId)
      : context.accountsByProvider(entryId)
    const caps = resolveCaps(entryId, modelId, ledger.learnedFor(entryId))

    // 逐账号取一组行，再交给纯函数折叠。账号之间不取平均：一把 Key 打满就是这个
    // 模型此刻派不出去，而平均值会把「有一把撞墙」和「有一把空着」揉成同一个数。
    const groups: RouteQuotaWindowRow[][] = []
    for (const account of accounts) {
      const rows: RouteQuotaWindowRow[] = []
      if (caps.enforceable) {
        const usage = ledger.snapshot(entryId, account.id, modelId)
        rows.push(...documentedQuotaRows(
          caps.limits,
          caps.provenance,
          usage,
          // 月度是 UTC 自然边界（我们的记账规则，`local`）；分钟 / 日窗口是滚动窗口，
          // 账本只有桶时间，退回窗口上界并标估算 —— 界面据此写「约」。
          metric => windowResetEstimate(metric, nowMs),
        ))
      }

      const declared = normalizeDeclaredQuota(account.declaredQuota)
      if (declared.length > 0) {
        rows.push(...declaredQuotaRows(
          declared,
          window => ledger.declaredWindow(entryId, account.id, window, nowMs),
          window => declaredResetAt(
            ledger.declaredWindow(entryId, account.id, window, nowMs),
            window,
            nowMs,
          ),
        ))
      }
      groups.push(rows)
    }

    return summarizeQuotaRows(groups)
  } catch (error) {
    console.error('[QuotaGate] quota summary unavailable:', error)
    return { band: 'undocumented', rows: [], windows: 0 }
  }
}

/**
 * 官方帽窗口的复位估算。
 *
 * 月度按 **UTC 自然月**（我们自己的记账边界）；分钟 / 日窗口是滚动窗口，账本只存
 * 分钟桶、不存「最老那一笔」的逐模型时刻，所以退回窗口上界（与
 * `quotaPacing.nextRollingBoundary` 同一口径）。两处都不假装那是上游的复位时刻：
 * `documentedQuotaRows` 把出处标成 `estimated`，界面写「约」。
 */
function windowResetEstimate(
  metric: 'rpm' | 'rpd' | 'tpm' | 'tpd' | 'monthlyTokens',
  nowMs: number,
): number {
  if (metric === 'monthlyTokens') return nextUtcMonthStart(nowMs)
  const windowMs = metric === 'rpm' || metric === 'tpm' ? 60_000 : 24 * 60 * 60_000
  return nextRollingBoundary(nowMs, windowMs)
}
