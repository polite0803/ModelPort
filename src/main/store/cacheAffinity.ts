/**
 * 会话 → 上一次成功的缓存亲和坐标，跨重启保留。
 *
 * 只存「回哪一家、哪个模型、哪个账号」三个选路身份与到期时刻，不含任何对话
 * 内容 —— 网关不需要、也不允许替用户记住对话。它的全部作用是：进程重启后
 * （部署、崩溃），活跃会话的下一轮仍然回到同一个缓存域，而不是重新选路把整段
 * 前缀按新账号的缓存域重读一遍。
 *
 * 为什么不是「把改写产物存下来」：DeepSeek 系（`readDiscount: 0.02`）上
 * `isCacheSensitive` 为真，压缩在 `resolveCompressionConfig` 就被整条关闭，
 * 裁剪只走白名单/实测上界，客户端自己的压缩发生在客户端、原文到不了网关。
 * 也就是说这条线上网关本来就不改写字节，没有产物可固化；能跨重启掉的只有
 * 这份内存里的亲和读数。
 */

export interface CacheAffinityRecord {
  providerId: string
  displayName: string
  accountId: string
  /** Epoch ms. */
  expiresAt: number
}

export type CacheAffinityMap = Record<string, CacheAffinityRecord>

/** 与选路侧的粘性表同量级；落盘多一份同样的上限，防止手改文件把它撑大。 */
const MAX_RECORDS = 500

function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * 把磁盘上（可能被手改、可能是旧形状）的对象折成可用表。
 *
 * 任何一格不成立的记录整条丢弃 —— 半条亲和会把会话钉到一个不存在的账号上，
 * 那比没有亲和更糟。过期记录在这里就过滤掉，读取侧不必再判。
 */
export function normalizeCacheAffinity(input: unknown, now: number): CacheAffinityMap {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: CacheAffinityMap = {}
  let count = 0
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_RECORDS) break
    if (key.length === 0 || key.length > 512) continue
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const providerId = textOf(entry.providerId)
    const displayName = textOf(entry.displayName)
    const accountId = textOf(entry.accountId)
    const expiresAt = countOf(entry.expiresAt)
    if (providerId === undefined || displayName === undefined || accountId === undefined) continue
    if (expiresAt === undefined || expiresAt <= now) continue
    out[key] = { providerId, displayName, accountId, expiresAt }
    count++
  }
  return out
}