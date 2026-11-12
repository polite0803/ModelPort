/**
 * 把一次请求的最终尝试轨迹（`attemptTrace`）折成配额不足标记的落库动作。
 *
 * 选在 `routes/chat.ts` 三条分支（auto / 跨家链 / 单发+同家换 Key）汇合之后调用一次，
 * 所以三个入口共用同一份判据，不会各写一遍之后开始漂移。
 *
 * 三条纪律：
 * - 只处理聚合目录的家：内置与自定义供应商没有额度旁表，判记了也是凭空的。
 * - 同一 `(渠道, 账号, 模型)` 在一条轨迹里可能出现多次（失败→换 Key→成功），按出现顺序
 *   折叠成**最后一次**动作：先记后清是"充值后第一笔就成功"的正常路径，结果必须是清掉。
 * - 写盘只在动作真的改变表时发生；一条轨迹里没有额度证据时这里不产生任何 I/O。
 */

import type { RequestAttemptTrace } from '../../../shared/types'
import {
  classifyQuotaExhaustion,
  truncateExhaustionMessage,
  type AggregateQuotaExhaustionRecord,
  type AggregateQuotaExhaustionReason,
} from '../../../shared/aggregateQuotaExhaustion.ts'
import { getAggregateEntry } from '../../providers/aggregate/registry.ts'
import { storeManager } from '../../store/store'

interface MarkAction {
  providerId: string
  accountId: string
  accountName?: string
  modelId: string
  /** 缺席 = 清除这个 `(账号, 模型)`；有值 = 记一条。 */
  record?: {
    reason: AggregateQuotaExhaustionReason
    status?: number
    message: string
  }
}

const actionKey = (row: Pick<RequestAttemptTrace, 'providerId' | 'accountId' | 'model'>): string =>
  `${row.providerId}\u0000${row.accountId}\u0000${row.model}`

/**
 * 默认 `retryAfterMs` 只作用于**最后一行**：那才是客户端这一笔最终拿到的结果，
 * 中间被换掉的候选没有可供客户端读的解禁时刻。上游没给就退回 TTL（`until` 缺席）。
 */
export function applyQuotaExhaustions(
  trace: readonly RequestAttemptTrace[],
  retryAfterMs?: number,
  nowMs: number = Date.now()
): void {
  if (trace.length === 0) return

  const actions = new Map<string, MarkAction>()
  for (const row of trace) {
    if (getAggregateEntry(row.providerId) === undefined) continue
    // 标记的键就是这一把 Key：没有账号 id 的轨迹行证明不了"哪把 Key 被拒"，
    // 记成整家会把一条别人的证据摊到所有 Key 上。
    if (row.accountId === undefined) continue
    const key = actionKey(row)

    if (row.outcome === 'success') {
      actions.set(key, {
        providerId: row.providerId,
        accountId: row.accountId,
        accountName: row.accountName,
        modelId: row.model,
      })
      continue
    }

    const reason = classifyQuotaExhaustion({
      status: row.status,
      errorType: row.errorType,
      errorCode: row.errorCode === undefined || row.errorCode === null ? undefined : String(row.errorCode),
      errorMessage: row.errorMessage,
      outcome: row.outcome,
    })
    // 不是额度证据的行不覆盖更早的动作：同一 `(账号, 模型)` 上一发被判成"没额度"，
    // 这一发只是限流/400，说明不了额度回来了 —— 标记留到过期或下一次成功。
    if (reason === undefined) continue

    actions.set(key, {
      providerId: row.providerId,
      accountId: row.accountId,
      accountName: row.accountName,
      modelId: row.model,
      record: {
        reason,
        status: row.status,
        message: truncateExhaustionMessage(row.errorMessage ?? ''),
      },
    })
  }

  const lastKey = actionKey(trace[trace.length - 1])
  for (const [key, action] of actions) {
    try {
      if (!action.record) {
        storeManager.clearAggregateQuotaExhaustion(action.providerId, action.accountId, action.modelId)
        continue
      }
      const asOf = new Date(nowMs).toISOString()
      const until =
        key === lastKey && retryAfterMs !== undefined && retryAfterMs > 0
          ? new Date(nowMs + retryAfterMs).toISOString()
          : undefined
      const record: AggregateQuotaExhaustionRecord = {
        accountId: action.accountId,
        ...(action.accountName === undefined ? {} : { accountName: action.accountName }),
        modelId: action.modelId,
        reason: action.record.reason,
        ...(action.record.status === undefined ? {} : { status: action.record.status }),
        message: action.record.message,
        asOf,
        ...(until === undefined ? {} : { until }),
      }
      storeManager.recordAggregateQuotaExhaustion(action.providerId, record)
    } catch (error) {
      // 标记是旁证，不是请求的一部分：写盘失败只记日志，绝不让一次成功/失败的请求变形。
      console.error('[QuotaExhaustion] failed to persist mark:', error)
    }
  }
}