/**
 * `retry-after` 响应头解析（秒数或 HTTP 日期）→ 毫秒。
 *
 * ## 为什么必须只有一份实现
 *
 * 同一份判据此前在本仓库有**两处私有实现**（`opencode-adapter.ts` 的
 * `parseRetryAfterHeader`、`opencode-product.ts` 的 `parseRetryAfterMs`），
 * 内容几乎逐字相同。现在 Cline 也要用它（服务端在 429 上会给出真实等待时长），
 * 若再抄一份就是第三份 —— 而它有两个**必须一致**的细节，抄漏任一个都会静默出错：
 *
 * ## 细节 1：`0` 是合法值（「立即解除」）
 *
 * 调用方必须用 `=== undefined` 判空。任何 falsy 判据（`if (!ms)`、`ms ?? 默认值`
 * 之外的花样）都会把 `0` 变成「未知」，再退避一小时 —— 那会让刚被限流的账号
 * 白白锁一小时。
 *
 * ## 细节 2：纯数字必须走「秒」分支，不能落到 `Date.parse`
 *
 * `Date.parse('900')` 会解析成 **1970 年**的某个时刻，于是 `at - now` 是个巨大负数，
 * 被 `Math.max(0, …)` 抹成 `0`（=「立即解除」）—— 额度刚用尽的账号会被马上重选，
 * 形成**无限空转**（`opencode-product.ts` 的注释里记着这个坑）。
 */

/**
 * 解析 `retry-after` 头值。
 *
 * @param raw 头部原文（`null` / 空串 / `undefined` 都表示「服务端没给」）。
 * @param nowMs 当前时刻（注入以便单测）。
 * @returns 等待毫秒数；`0` 表示「立即解除」；`undefined` 表示**服务端没有声明**
 *   （调用方必须与 `0` 区别对待）。
 */
export function parseRetryAfterMs(
  raw: string | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  // 先按「秒」判：只放行非负有限数（`Number('')` 已是 0，但空串在上面就返回了）。
  const seconds = Number(raw)
  // ⚠️ **负数按「无效」处理，不能落到 `Date.parse`**：`Date.parse('-5')` 是**合法**的
  // （被当成 ISO 年份），于是 `at - now` 是个巨大负数、被 `Math.max(0, …)` 抹成 0
  // （=「立即解除」）—— 一个畸形的头就能让刚被限流的账号立刻被重选。
  // 无效头一律返回 `undefined`（= 服务端没声明），由调用方退到保守的兜底。
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.ceil(seconds * 1000) : undefined
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : undefined
}

/**
 * 从 `fetch` 风格的响应头取（`headers.get('retry-after')`）。
 *
 * ⚠️ 参数类型刻意**不写 `Headers`**：本仓库同时被 DOM 与 undici 两套 `Headers`
 * 类型覆盖，写字面量类型会让其中一套编译不过。结构化的 `{ get() }` 两边都满足。
 */
export function retryAfterMsFromResponse(
  headers: { get(name: string): string | null } | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (headers === null || headers === undefined) return undefined
  return parseRetryAfterMs(headers.get('retry-after'), nowMs)
}

/**
 * 把「最早解禁时刻」写成人话（「约 25 分钟后恢复」/「11-14 08:00 恢复，约 20.9 小时后」）。
 *
 * ⚠️ 长等待**必须带绝对时刻**：2026-11-13 实测匿名免费通道的日额度耗尽时，
 * 上游回 `retry-after: 75411`（≈20.9 小时，正好指向次日 `00:00 UTC` 的窗口复位），
 * 而旧文案只会说「约 30 分钟后恢复」—— 用户与客户端都拿不到真实复位点。
 * 短等待只给相对时长（「21 小时」这种跨度上，读者还得自己再算一遍时钟）。
 *
 * 返回值可直接接在「最早」后面，两种长度共用一份措辞。
 */
export function formatRecoveryReset(resetAtMs: number, nowMs: number = Date.now()): string {
  const waitMs = Math.max(0, resetAtMs - nowMs)
  if (waitMs < 60_000) return `约 ${Math.max(1, Math.ceil(waitMs / 1000))} 秒后恢复`
  if (waitMs < 60 * 60_000) return `约 ${Math.ceil(waitMs / 60_000)} 分钟后恢复`
  const at = new Date(resetAtMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  const clock = `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  const hours = waitMs / 3_600_000
  return hours < 48
    ? `${clock} 恢复，约 ${hours.toFixed(1)} 小时后`
    : `${clock} 恢复，约 ${(hours / 24).toFixed(1)} 天后`
}

/**
 * 从普通记录形态取（大小写两种键都认）。
 *
 * `undici` 的 `Headers` 之外，有些调用方（单测替身、代理层）拿到的是
 * `Record<string, string>`，且键名大小写不保证。
 */
export function retryAfterMsFromRecord(
  headers: Readonly<Record<string, string>> | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (headers === undefined) return undefined
  return parseRetryAfterMs(headers['retry-after'] ?? headers['Retry-After'], nowMs)
}
