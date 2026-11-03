/**
 * 聚合目录的「实时账号级额度」读数与快照。
 *
 * 与 `aggregateQuota.ts`（官方文档转录的静态帽）、`quota/ledger.ts`（本应用自己计量的
 * 已用量）是三件不同的事，这里加第四件：**问上游要回来的、这把 Key 此刻还剩多少钱**。
 *
 * 一条不可让步的规则：美元额度、人民币余额与本应用的 token 账本是三个互不可比的计数域，
 * 所以这份读数**永远不折算成 token 比例**。它对选号的作用只有一个闸门（快照说「一分钱都不剩」
 * 且没过 TTL 时，把这家排到最后），其余一律沿用既有的 token 计算。折算等于替厂商发明汇率。
 */

export type AggregateCreditUnit = 'USD' | 'CNY'

/** 解析失败的四类。分开是因为界面的补救动作完全不同（换 Key / 认形状 / 看网络）。 */
export type AggregateCreditFailureReason = 'http-status' | 'not-json' | 'unexpected-shape' | 'network'

export interface AggregateCreditReadingOk {
  ok: true
  /** 剩余；上游没给就是 undefined，绝不补 0 */
  remaining?: number
  /** 上限；`unlimited` 时为 undefined（无上限不是一个数） */
  limit?: number
  unit: AggregateCreditUnit
  /** 上游明说「没有上限」。这不是 0，也不是「还有很多」——它只是不参与闸门 */
  unlimited: boolean
  /** 上游报文摘要：截断、已剔除 Key，用于「形状不认识时让人看见真报文」 */
  raw: string
}

export interface AggregateCreditReadingFail {
  ok: false
  reason: AggregateCreditFailureReason
  detail: string
}

export type AggregateCreditReading = AggregateCreditReadingOk | AggregateCreditReadingFail

/**
 * 落盘的一行（一个条目一行）。
 *
 * `ok` 的含义比"至少问成了一把"更强：**尝试过的每一把都答出了可解析的数，而且没有一把
 * 被跳过**。只要有一把没问出来（或有 Key 超出单次上限没去问），这一行就不落（`ok` 保持
 * false 甚至不写），闸门随之不生效。
 * 理由是聚合一家可能配多把 Key：拿「其中一把没钱了」去停用整个条目、连带停掉另一把
 * 还有钱的 Key，是能把网关自己饿死的误判；反过来「全部尝试过的 Key 都没钱」才是一条
 * 可以拿去排序的证据。`remaining` / `limit` 取余额最高的那把（"这家还能用多少"），
 * 于是 `remaining <= 0` 恰好等价于"每一把都是 0"。
 */
export interface AggregateCreditSnapshot {
  /** ISO 时间戳：这次是用户手点出来的，不是周期采集 */
  asOf: string
  unit: AggregateCreditUnit
  unlimited: boolean
  remaining?: number
  limit?: number
  ok: boolean
  /** 整行不成立时第一个失败读数的分类 */
  reason?: AggregateCreditFailureReason
  /** 尝试查询的 Key 把数 */
  accounts: number
  /** 超过单次上限而未查询的把数（上限见 `CREDIT_QUERY_KEY_CAP`） */
  skipped: number
}

export type AggregateCreditSnapshots = Record<string, AggregateCreditSnapshot>

/** 一把 Key 的一行界面读数：密钥只以掩码出现。 */
export interface AggregateCreditKeyRow {
  keyId: string
  keyName: string
  maskedKey: string
  reading: AggregateCreditReading
}

/** 接线级失败（与读数的 `reason` 分开：这类根本没发出请求）。 */
export type AggregateCreditQueryFailure = 'unknown_entry' | 'no_probe' | 'not_configured' | 'missing_api_key'

export interface AggregateCreditQueryResult {
  entryId: string
  /** 本次查询的时刻（ISO），与是否落盘无关 */
  asOf: string
  /** 尝试的每一把都问出了可解析的数 */
  ok: boolean
  failure?: AggregateCreditQueryFailure
  /** `ok` 为 false 时首个失败读数的分类 */
  reason?: AggregateCreditFailureReason
  rows: AggregateCreditKeyRow[]
  accounts: number
  skipped: number
  /** 本次写入的快照；未写入（问得不全）时缺席，界面继续显示旧的带 `asOf` 那一行 */
  snapshot?: AggregateCreditSnapshot
  /** 端点声明里的文档出处与核对日期，界面据此说明"这个路径是从哪抄来的" */
  docUrl?: string
  probeAsOf?: string
}

/**
 * 快照参与排序的有效期：15 分钟。
 *
 * 为什么是 15 分钟而不是"永久"：这一行是用户在详情页**手动点一次**问出来的，
 * 他不再点就没有新数据。让一个人工读数长期影响路由，等于让路由表停在他上次
 * 好奇的那一刻（上游充值、退款、月度复位都不会被看见）。超过 TTL 仍然照实展示
 * 并标"已过期"，只是不参与选号。回退成本是一个常量。
 */
export const CREDIT_SNAPSHOT_TTL_MS = 15 * 60_000

/** 单次查询最多问几把 Key：再多就把界面和上游配额拖长了，且必须显式说出没查的部分。 */
export const CREDIT_QUERY_KEY_CAP = 10

export function creditSnapshotLive(snapshot: AggregateCreditSnapshot | undefined, nowMs: number = Date.now()): boolean {
  if (!snapshot) return false
  const at = Date.parse(snapshot.asOf)
  if (Number.isNaN(at)) return false
  const age = nowMs - at
  // 未来的时间戳（时钟跳变）同样不算新鲜：闸门只认"确实刚问过"。
  return age >= 0 && age <= CREDIT_SNAPSHOT_TTL_MS
}

/**
 * 闸门判据：只有「整行成立 + 明说不是无上限 + 问到了一个数 + 这个数 <= 0 + 没过 TTL」
 * 才成立。其余一律 false（放行），与 `undocumented` 不参与预检是同一条纪律。
 */
export function creditSnapshotExhausted(
  snapshot: AggregateCreditSnapshot | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!snapshot || !snapshot.ok || snapshot.unlimited) return false
  if (typeof snapshot.remaining !== 'number' || !Number.isFinite(snapshot.remaining)) return false
  if (!creditSnapshotLive(snapshot, nowMs)) return false
  return snapshot.remaining <= 0
}
