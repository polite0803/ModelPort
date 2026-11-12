/**
 * 「这家、这把 Key、这个模型刚才被上游告知没额度了」——一条带时刻的现场记录。
 *
 * 它和另外三层额度判据是**并列**关系，不能互相折算：
 * - `aggregateQuota.ts`：厂商文档公布的静态帽（token 口径）；
 * - `quota/ledger.ts`：本应用自己数出来的用量；
 * - `aggregateCredit.ts`：问上游要回来的余额（USD / CNY，钱的单位）。
 *
 * 这里是第四层，也是唯一**由一次真实调用证伪**的证据：上游亲口说"额度/余额/欠费"，
 * 于是把 `(渠道, 账号, 模型)` 打上标记、跳过它直到过期。它与上面三层不合并显示 ——
 * 把「我们算出来打满了」和「上游说没有额度」揉成一个数，等于伪造一个双方都没给的结论。
 *
 * 三条判定纪律：
 * 1. **限流不是没额度。** 裸 429、`rate limit`、`频率超限`、本地并发闸门（`localAdmissionRejected`）
 *    一律不标 —— 宁可漏标一次，也不让一次限流把整家渠道停三十分钟。
 * 2. **只回过"没钱/欠费"的话不猜原因。** 三种原因分开是因为用户动作不同：
 *    `quota-exhausted` 等复位或升档，`balance-insufficient` 去充值，`arrears` 去处理账务。
 * 3. **过期是派生量。** 上游给了 `Retry-After` / 解禁时刻就用它，没给就 `QUOTA_EXHAUSTION_TTL_MS`。
 *    不存"是否有效"这种会自己说谎的布尔。
 */

export type AggregateQuotaExhaustionReason = 'quota-exhausted' | 'balance-insufficient' | 'arrears'

export interface AggregateQuotaExhaustionRecord {
  /** 命中的那把 Key（账号 id）；同一家的另一把 Key 不受影响 */
  accountId: string
  /** 账号备注名，界面直接用，免得再回查一次账号表 */
  accountName?: string
  modelId: string
  reason: AggregateQuotaExhaustionReason
  /** 上游 HTTP 状态；没有响应（网络错误）时缺席 */
  status?: number
  /** 上游原文摘要：截断、已剔除换行；不含任何凭据（转发器不往错误里放 Key） */
  message: string
  /** 记录的 ISO 时刻 */
  asOf: string
  /** 上游给出的解禁时刻（ISO）；缺席时按 `asOf + TTL` 过期 */
  until?: string
}

export type AggregateQuotaExhaustions = Record<string, AggregateQuotaExhaustionRecord[]>

/** 列表页用的折叠结果：只给条数和最近一条，不把整张表塞进每条目录项。 */
export interface AggregateQuotaExhaustionSummary {
  count: number
  latest: AggregateQuotaExhaustionRecord
}

/**
 * 没有上游解禁时刻时的存活期：30 分钟。
 *
 * 为什么不是更长：这类标记直接跳过候选，标错一次的代价是"这个模型半小时不用"。
 * 为什么不是更短：套餐额度按 5 小时滚动或按日/月复位，几秒内重试没有意义，
 * 30 分钟足以覆盖一次充值或一次速度波动。回退成本是一个常量。
 */
export const QUOTA_EXHAUSTION_TTL_MS = 30 * 60_000

/** 每条目保留多少行：覆盖"多把 Key × 多个模型"的常见规模，同时不让 data.json 无界增长。 */
export const QUOTA_EXHAUSTION_MAX_ROWS = 50

/** 上游原文摘要上限：够看清是哪一条限制，又不至于把整段 HTML 错误页存进存档。 */
export const QUOTA_EXHAUSTION_MESSAGE_MAX = 240

const ARREARS_PATTERN = /arrearage|overdue[-\s]?payment|in good standing|欠费|逾期未付|账务/i

const BALANCE_PATTERN =
  /insufficient[ _-]?(credit|funds|balance)|credit (balance|is) (too low|insufficient)|not enough (credit|balance|funds)|can only afford|balance is (too )?low|余额不足|账户余额|可用余额|余额已用尽/i

const QUOTA_PATTERN =
  /insufficient[ _-]?quota|exceeded your current quota|quota (exceeded|exhausted|reached)|usage limit|plan limit|billing (daily )?count exceeded|subscription (expired|exhausted)|额度|配额|积分|套餐/i

const EXHAUSTION_WORD = /不足|用尽|耗尽|用完|已用完|超限|超出|已满|exceeded|exhausted|insufficient|reached|exceed/i

const RATE_LIMIT_PATTERN =
  /rate[ _-]?limit|too many requests|requests per|频率超限|限流|并发(上限|超限)|QPS|TPM limit|RPM limit/i

export interface QuotaExhaustionInput {
  status?: number
  errorType?: string
  errorCode?: string
  errorMessage?: string
  /** 本地 AIMD 并发闸门拒绝：不是上游说的话，永不入账 */
  localAdmissionRejected?: boolean
  /**
   * attempt 的结果分类；`success` / `client_abort` 一律不判。
   * `capability` 不排除 —— 欠费正是落在这一档（`isAccountArrearsError`），
   * 按结果分类一刀切会把唯一确凿的欠费证据挡在门外。
   */
  outcome?: string
}

/**
 * 判定一次失败的尝试是否构成"上游说没额度"。返回原因，或 undefined（不标）。
 *
 * 判定顺序即优先级：欠费 > 余额 > 额度。三者同时出现时，更"要人去处理"的那个先报。
 */
export function classifyQuotaExhaustion(input: QuotaExhaustionInput): AggregateQuotaExhaustionReason | undefined {
  if (input.localAdmissionRejected) return undefined
  // 本地 AIMD 闸门的那条 429 是我们在自己门口拒的，不是上游说的任何一句话。
  if (input.errorCode === 'local_concurrency_limit') return undefined
  if (input.outcome === 'success' || input.outcome === 'client_abort') return undefined

  const text = `${input.errorType ?? ''} ${input.errorCode ?? ''} ${input.errorMessage ?? ''}`.trim()

  if (ARREARS_PATTERN.test(text)) return 'arrears'

  // 402 = Payment Required：协议层面就已经是"要钱"，不必等文案。
  if (input.status === 402) return 'balance-insufficient'

  if (BALANCE_PATTERN.test(text)) return 'balance-insufficient'

  // 限流 veto：只有当整段话里**一个额度名词都没有**时才生效。
  // 反过来「daily quota exhausted」虽然常配 429，但那是真的没额度，必须标。
  if (RATE_LIMIT_PATTERN.test(text) && !QUOTA_PATTERN.test(text)) return undefined

  if (QUOTA_PATTERN.test(text) && (EXHAUSTION_WORD.test(text) || input.status === 402)) return 'quota-exhausted'

  return undefined
}

export function truncateExhaustionMessage(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim()
  return flat.length <= QUOTA_EXHAUSTION_MESSAGE_MAX ? flat : `${flat.slice(0, QUOTA_EXHAUSTION_MESSAGE_MAX - 1)}…`
}

/** 一条记录还有效到哪一刻（毫秒）。`until` 解析不出来就退回 TTL —— 不因为一个坏时间戳就永久有效。 */
export function exhaustionExpiresAt(record: AggregateQuotaExhaustionRecord): number {
  const until = record.until ? Date.parse(record.until) : Number.NaN
  if (!Number.isNaN(until)) return until
  const at = Date.parse(record.asOf)
  return Number.isNaN(at) ? 0 : at + QUOTA_EXHAUSTION_TTL_MS
}

export function recordLive(record: AggregateQuotaExhaustionRecord, nowMs: number = Date.now()): boolean {
  return exhaustionExpiresAt(record) > nowMs
}

export function liveExhaustions(
  records: readonly AggregateQuotaExhaustionRecord[] | undefined,
  nowMs: number = Date.now()
): AggregateQuotaExhaustionRecord[] {
  if (!records || records.length === 0) return []
  return records.filter(record => recordLive(record, nowMs))
}

/** 该 `(账号, 模型)` 是否正被一条活记录挡着。 */
export function findExhaustion(
  records: readonly AggregateQuotaExhaustionRecord[] | undefined,
  accountId: string,
  modelId: string,
  nowMs: number = Date.now()
): AggregateQuotaExhaustionRecord | undefined {
  if (!records || records.length === 0) return undefined
  return records.find(
    record => record.accountId === accountId && record.modelId === modelId && recordLive(record, nowMs)
  )
}

/**
 * 覆盖写：同一 `(accountId, modelId)` 只留最新一条（新的失败时刻替换旧的），
 * 并顺手丢掉已过期行、按时间倒序截到上限。返回新数组，不原地改。
 */
export function upsertExhaustion(
  records: readonly AggregateQuotaExhaustionRecord[] | undefined,
  record: AggregateQuotaExhaustionRecord,
  nowMs: number = Date.now()
): AggregateQuotaExhaustionRecord[] {
  const kept = liveExhaustions(records, nowMs).filter(
    existing => !(existing.accountId === record.accountId && existing.modelId === record.modelId)
  )
  return [record, ...kept].slice(0, QUOTA_EXHAUSTION_MAX_ROWS)
}

/** 成功后清除：只清这一个人 `(账号, 模型)`，不碰同家别的 Key 或别的模型。 */
export function removeExhaustion(
  records: readonly AggregateQuotaExhaustionRecord[] | undefined,
  accountId: string,
  modelId: string
): AggregateQuotaExhaustionRecord[] {
  if (!records || records.length === 0) return []
  return records.filter(record => !(record.accountId === accountId && record.modelId === modelId))
}

/** 列表页折叠：只算还活着的行，过期的既不算条数也不当"最近一条"。 */
export function exhaustionSummaries(
  table: AggregateQuotaExhaustions | undefined,
  nowMs: number = Date.now()
): Record<string, AggregateQuotaExhaustionSummary> {
  const summaries: Record<string, AggregateQuotaExhaustionSummary> = {}
  if (!table) return summaries
  for (const [entryId, records] of Object.entries(table)) {
    const live = liveExhaustions(records, nowMs)
    if (live.length === 0) continue
    const latest = live.reduce((newest, record) =>
      Date.parse(record.asOf) >= Date.parse(newest.asOf) ? record : newest
    )
    summaries[entryId] = { count: live.length, latest }
  }
  return summaries
}