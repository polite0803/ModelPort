/**
 * 额度判据：把「官方帽 + 逐模型帽 + 实测帽」折成一个可比较的上限集，再判断当前是否超限。
 *
 * 三条不可让步的规则：
 * 1. `undocumented` 不参与判定 —— 官方没公布就一律放行。否则 60 家当场全部不可用，
 *    而那不是"保护额度"，是把不知道伪装成没有。
 * 2. 实测帽**只填空、只下调，从不上调**，且必须与来源同级比较（日帽不会被分钟观测抬高）。
 * 3. 判定返回的是"哪个窗口满了 + 什么时候复位"，不是一个布尔。面板要按这个说人话，
 *    不得把多种缺席收敛成"不可用"一句。
 */

import { getAggregateQuota, type AggregateEntryQuota } from '../../../shared/aggregateQuota.ts'
import type { QuotaMetric } from '../../../shared/aggregateQuotaView.ts'

export type { QuotaMetric }

/** 六字段里参与预检的五个：contextWindow 属于能力，不是额度。 */
export const ENFORCEABLE_METRICS: QuotaMetric[] = ['rpm', 'rpd', 'tpm', 'tpd', 'monthlyTokens']

export interface QuotaWindowUsage {
  rpm: number
  rpd: number
  tpm: number
  tpd: number
  monthlyTokens: number
}

export interface Caps {
  enforceable: boolean
  limits: Partial<Record<QuotaMetric, number>>
  /** 每个生效上限的出处，面板要能指出这个数是从哪来的 */
  provenance: Partial<Record<QuotaMetric, 'documented' | 'learned' | 'documented-model'>>
  asOf?: string
  docUrl?: string
}

/** 五个 token/请求计数域里"哪个窗口满了"。 */
export type QuotaWindowBlockReason = 'rpm_exhausted' | 'rpd_exhausted' | 'tpm_exhausted' | 'tpd_exhausted' | 'monthly_exhausted'

/**
 * 消费方看到的完整枚举。`no-credit` 不属于上面任何一个窗口：它是"问上游问回来这把 Key
 * 一分钱不剩"，单位是钱不是 token，所以既没有对应的 `QuotaMetric`、也永不参与
 * `evaluateQuota` 的窗口比较（把美元折进 token 比例是被禁止的）。
 */
export type QuotaBlockReason = QuotaWindowBlockReason | 'no-credit'

export interface QuotaDecision {
  allowed: boolean
  reason?: QuotaBlockReason
  metric?: QuotaMetric
  used?: number
  limit?: number
}

function lowerOnly(
  target: Partial<Record<QuotaMetric, number>>,
  provenance: Partial<Record<QuotaMetric, 'documented' | 'learned' | 'documented-model'>>,
  metric: QuotaMetric,
  value: number | undefined | null,
  source: 'documented' | 'learned' | 'documented-model'
): void {
  if (value === undefined || value === null || !(value > 0)) return
  const current = target[metric]
  if (current === undefined || value < current) {
    target[metric] = value
    provenance[metric] = source
  }
}

/**
 * 逐模型帽压过条目级帽（两家都公布时取更小的那个），实测帽再压过官方帽——
 * 但只会更小，永不更大。
 */
export function resolveCaps(
  entryId: string,
  modelId: string,
  learned: Partial<Record<QuotaMetric, number>> = {}
): Caps {
  const quota: AggregateEntryQuota | undefined = getAggregateQuota(entryId)
  const limits: Partial<Record<QuotaMetric, number>> = {}
  const provenance: Partial<Record<QuotaMetric, 'documented' | 'learned' | 'documented-model'>> = {}

  if (quota) {
    for (const metric of ENFORCEABLE_METRICS) {
      lowerOnly(limits, provenance, metric, quota[metric], 'documented')
    }
    const perModel = quota.perModel?.find(row => row.modelId === modelId)
    for (const metric of ENFORCEABLE_METRICS) {
      lowerOnly(limits, provenance, metric, perModel?.[metric], 'documented-model')
    }
  }

  for (const metric of ENFORCEABLE_METRICS) {
    lowerOnly(limits, provenance, metric, learned[metric], 'learned')
  }

  // 判定资格只看"手里有没有一个真实上限"：官方帽或实测帽都算。
  // 反过来，两者都没有的（目录里 60 家）绝不可判定 —— 把"不知道"当成"没有额度"会让这些家当场全不可用。
  const enforceable = Object.keys(limits).length > 0

  return {
    enforceable,
    limits: enforceable ? limits : {},
    provenance: enforceable ? provenance : {},
    asOf: quota?.asOf,
    docUrl: quota?.docUrl,
  }
}

const METRIC_FOR_REASON: Record<QuotaWindowBlockReason, QuotaMetric> = {
  rpm_exhausted: 'rpm',
  rpd_exhausted: 'rpd',
  tpm_exhausted: 'tpm',
  tpd_exhausted: 'tpd',
  monthly_exhausted: 'monthlyTokens',
}

/** 按"先拒贵窗口"的顺序判：月度 > 日 > 分钟，越难恢复的越先说。 */
const REASON_ORDER: QuotaWindowBlockReason[] = [
  'monthly_exhausted',
  'rpd_exhausted',
  'tpd_exhausted',
  'rpm_exhausted',
  'tpm_exhausted',
]

export function evaluateQuota(caps: Caps, usage: QuotaWindowUsage): QuotaDecision {
  if (!caps.enforceable) return { allowed: true }

  for (const reason of REASON_ORDER) {
    const metric = METRIC_FOR_REASON[reason]
    const limit = caps.limits[metric]
    if (limit === undefined) continue
    const used = usage[metric]
    if (used >= limit) {
      return { allowed: false, reason, metric, used, limit }
    }
  }

  return { allowed: true }
}

/** 面板用：一家能不能被标成"受额度保护"。undocumented 必须显式说出来，不是留白。 */
export function quotaAvailability(entryId: string): 'documented' | 'undocumented' | 'absent' {
  const quota = getAggregateQuota(entryId)
  if (!quota) return 'absent'
  return quota.source
}
