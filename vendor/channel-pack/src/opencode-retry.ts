/**
 * OpenCode 通道的「受限时长」策略（纯函数，与适配器解耦以便单测）。
 *
 * ## 为什么上游给的 `retry-after` 不能封顶
 *
 * 2026-11-13 实测（本机出口）：匿名免费通道的日额度耗尽时上游回
 * `429 FreeUsageLimitError` + `retry-after: 75411`（≈20.9 小时），
 * 恰好指向次日 `00:00 UTC`（= 08:00 CST）的日窗口复位 —— 与桌面客户端里
 * 「每天可用」的观感一致。
 *
 * 旧实现把这个值一律钳到 30 分钟，后果是三重的：
 *   ① 池里那条通道每 30 分钟被放出来重撞一次，每次都必然 429（自维持空转）；
 *   ② 面板与客户端被告知「约 30 分钟后恢复」，而真实复位在 21 小时后；
 *   ③ 宿主按「30 分钟」记冷却，客户端拿不到真实 `Retry-After`。
 *
 * ⇒ 上游给的是**权威事实**，只保留一个防畸形头的上界（7 天）。
 * 30 分钟封顶只留给**我们自己推**的指数退避（没有上游依据的那一支）。
 */
import type { OpencodeErrorKind } from './opencode-product.js'

/** 自我退避的上界：没有上游依据时，单次阻塞不超过 30 分钟。 */
export const BACKOFF_CAP_MS = 30 * 60_000
/** 上游 `retry-after` 的上界：只防畸形头（7 天），不按业务推断。 */
export const UPSTREAM_RETRY_AFTER_CAP_MS = 7 * 24 * 60 * 60_000
/** 额度穷尽（日额度 / 余额）且上游没给等待时长时的默认标记。 */
export const QUOTA_DEFAULT_MS = 24 * 60 * 60_000
/** 首次 429 的默认冷却。 */
export const RATE_LIMIT_BASE_MS = 60_000

/**
 * 把「错误语义 + 服务端给的延迟」换算成该槽该模型的受限时长（相对 now 的毫秒数）。
 *
 * ⚠️ **服务端给了就用它的**，且 **0 是合法值**（「立即解除」而非「未知」）：
 * 必须用 `retryAfterMs === undefined` 判空，写成 `?? default` 之外的任何
 * falsy 判据都会把 0 静默换成 1 小时 —— 那会让刚恢复的账号继续被跳过。
 * ⚠️ 没给才退避：`free_usage_limit` 按当日 24h（与 qoder 的「当日额度」同思路），
 * `rate_limit` 指数退避并封顶 30 分钟。
 */
export function opencodeRetryAfterMs(
  kind: OpencodeErrorKind,
  retryAfterMs: number | undefined,
  attempt: number,
): number {
  if (retryAfterMs !== undefined) {
    return Math.max(0, Math.min(retryAfterMs, UPSTREAM_RETRY_AFTER_CAP_MS))
  }
  if (kind === 'free_usage_limit') return QUOTA_DEFAULT_MS
  // ⚠️ 余额不足（402）：按**当日**标记，而不是短冷却 —— 钱不会在 60 秒内到账，
  // 短冷却会让同一个空钱包账号被反复选中、反复 402。
  if (kind === 'quota') return QUOTA_DEFAULT_MS
  if (kind === 'auth') return RATE_LIMIT_BASE_MS
  return Math.min(RATE_LIMIT_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_CAP_MS)
}