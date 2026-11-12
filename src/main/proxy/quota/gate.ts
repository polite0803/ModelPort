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
import { findExhaustion } from '../../../shared/aggregateQuotaExhaustion.ts'
import type { AggregateQuotaExhaustionRecord } from '../../../shared/aggregateQuotaExhaustion.ts'
import type { Account } from '../../store/types'
import { evaluateQuota, resolveCaps, type QuotaBlockReason } from './limits.ts'

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
 * 这个 `(账号, 模型)` 是否被上游亲口拒过且还没过期。
 *
 * 与 `creditExhausted` 的区别是证据来源：那条看的是我们问回来的余额（整家、钱的单位），
 * 这条看的是"刚才这一笔确实被拒"的现场记录（逐账号逐模型、由一次真实调用证伪）。
 * 读不出来同样放行 —— 一条读盘失败不能变成"这家不能用"。
 */
function exhaustionExhausted(
  entryId: string,
  accountId: string,
  actualModel: string,
  context?: QuotaGateContext
): boolean {
  try {
    const records = context === undefined
      ? storeManager.getAggregateQuotaExhaustionsOf(entryId)
      : context.exhaustionsByProvider(entryId)
    return findExhaustion(records, accountId, actualModel) !== undefined
  } catch (error) {
    console.error('[QuotaGate] quota exhaustion records unavailable:', error)
    return false
  }
}

export function quotaBlockReason(
  provider: { id: string; type: string },
  accountId: string,
  actualModel: string,
  context?: QuotaGateContext
): QuotaBlockReason | undefined {
  if (provider.type !== 'aggregate') return undefined

  // 没钱比"这个窗口打满了"更难恢复：窗口自己会复位，余额要用户去充。所以先说它。
  if (creditExhausted(provider.id, context)) return 'no-credit'

  // 上游刚亲口说没额度：与"窗口打满"同一层语义（跳过这个候选，过期自动放行），
  // 但只挡这一把 Key 与这一个模型 —— 同家别的 Key/模型不受牵连。
  if (exhaustionExhausted(provider.id, accountId, actualModel, context)) return 'quota-exhausted'

  try {
    const ledger = storeManager.getQuotaLedger()
    const caps = resolveCaps(provider.id, actualModel, ledger.learnedFor(provider.id))
    const decision = evaluateQuota(caps, ledger.snapshot(provider.id, accountId, actualModel))
    return decision.allowed ? undefined : decision.reason
  } catch (error) {
    console.error('[QuotaGate] quota preflight skipped:', error)
    return undefined
  }
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
