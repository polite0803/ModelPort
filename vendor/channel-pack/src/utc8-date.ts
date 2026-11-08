/**
 * UTC+8 日界工具（零依赖叶子模块）。
 *
 * ## 为什么单独一个文件
 *
 * 这条规则被两处后台任务共用（`auto-checkin.ts` 的签到记账、`auto-growth.ts` 的领取记账），
 * 而两者都不能「复制一份算术」——日界错一小时就会把当天记成已处理（真的漏领）。
 * 放在这里是因为 `auto-checkin.ts` 有大量运行时依赖（模型队列、渠道存储、日志），
 * 任何 import 它的模块都无法被 `node --test` 直接加载（Node 的类型擦除不解析
 * `./x.js` → `x.ts` 的改写），而本文件零 import，两侧都取得动。
 *
 * ## 偏移量
 *
 * 与 `model-queue.ts:109` 的 `QODER_BILLING_UTC_OFFSET_MS` 同值（`8 * 3_600_000`）。
 * 不直接 import 那个常量，是因为 `model-queue.ts` 属于计费路径、牵一发动全身；
 * 一致性由 `tests/channels/auto-growth.test.ts` 的对拍用例守住（两处算出的日期串必须相同）。
 *
 * ⚠️ 必须用**算术平移**而不是本机时区：各渠道的每日额度按 UTC+8 结算，
 * 取本机时区会在用户出差/改系统时区时得到错的「今天」—— 偏东会把当天提前记为已跑
 *（真的漏领），偏西会一天跑两次。
 */

/** UTC+8 相对 UTC 的毫秒偏移。 */
export const UTC8_OFFSET_MS = 8 * 3_600_000

/** 取「UTC+8 的当天日期」（`YYYY-MM-DD`）。 */
export function utc8DateString(nowMs: number = Date.now()): string {
  return new Date(nowMs + UTC8_OFFSET_MS).toISOString().slice(0, 10)
}