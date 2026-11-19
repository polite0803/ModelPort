/**
 * 「上游 429 被 cline.bot 包进 5xx」的识别与解禁时长（纯函数，零 import）。
 *
 * 独立成模块的原因同 `raccoon-rate-limit.ts` / `queue-wait.ts`：
 * 判据必须能被 `node --test` 直接以 TS 源加载做真实单测
 *（`cline-adapter.ts` 拖着整条 LLM 契约依赖链，拉不动）。
 *
 * ## 背景（2026-11-19 现网 `chatcmpl-mwn9hlta-u1alis`）
 *
 * OpenRouter 的 Particle AI 共享算力池瞬时打满（`fleet_capacity_exhausted`，
 * `retry_after_seconds: 1`），cline.bot 把它包成 5xx，正文保留
 * `request failed with status 429`。适配器按 `httpErrorCode(5xx)` 归成
 * `SERVER` → 客户端看到 502 把「1 秒后就好」当服务端故障硬撞（8 分钟 14 笔，
 * 同一模型同期 24 笔 200 交错），宿主也不会进恢复轮
 * （`isRecoverableChainExhaustion` 只认 429/402）。
 *
 * ## 判据为什么这么窄
 *
 * 只认「包装句 + 内嵌 429」这个形状：正文必须出现
 * `request failed with status 429`。**不认**泛化的 `429` 数字或 `rate limit`
 * 词 —— 正常正文里夹带的排障信息会因此把账号误挂上冷却。
 *
 * 解禁时长只读上游自己写的 `retry_after_seconds` / `Retry-After` 字段
 * （JSON 原文与转义串两种形态都算），读不到就不给 —— 宿主用出厂退避。
 *
 * 与 `recordsClineRateLimit` 的分工：那是**额度窗徽章**（只认真 429）；
 * 本函数说的是一次**瞬时容量**，不该给 1 小时标记。
 */

/** 内嵌解禁时长的上限：共享池的提示通常只有几秒，再长就该交给客户端自己退避。 */
const EMBEDDED_UPSTREAM_RATE_LIMIT_MAX_MS = 60_000

/**
 * @param body - cline.bot 的 5xx 响应正文（可能是 JSON 里再套一段转义 JSON）。
 * @returns `undefined` = 不是被包装的上游 429；`{}` = 命中但没有解禁时长；
 *   带 `retryAfterMs` = 命中且读到了时长。
 */
export function parseEmbeddedUpstreamRateLimit(body: string): { retryAfterMs?: number } | undefined {
  if (!/request failed with status 429/i.test(body)) return undefined
  const matched = /retry_after_seconds\\?"\s*:\s*\\?"?(\d+(?:\.\d+)?)/i.exec(body)
    ?? /retry-after\\?"\s*:\s*\\?"?(\d+(?:\.\d+)?)/i.exec(body)
  if (matched === null) return {}
  const seconds = Number.parseFloat(matched[1])
  if (!Number.isFinite(seconds) || seconds < 0) return {}
  return { retryAfterMs: Math.min(EMBEDDED_UPSTREAM_RATE_LIMIT_MAX_MS, Math.round(seconds * 1000)) }
}