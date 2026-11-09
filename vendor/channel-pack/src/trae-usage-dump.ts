/**
 * TRAE 上游**原始用量帧**取证（2026-11-09 用户指令：区分「SOLO 不报缓存」
 * 与「报了但我们不认识字段名」）。
 *
 * ## 为什么必须另开一条取证通道
 *
 * 请求日志记的是网关投影后的 OpenAI 形状，SOLO 的 `token_usage` 原帧在
 * `trae-adapter.ts` 里被读成 DSH 用量后就丢了。1360 轮 / 1.428 亿 token 从没
 * 出现过我们认识的三种缓存写法 —— 但「从没见过正数」只是推断，逐字段枚举
 * 原帧才能把「上游不报」与「读取面漏一格」分开。
 *
 * ## 开关
 *
 * `MODELPORT_TRAE_USAGE_DUMP`，约定与 `MODELPORT_CHANNEL_PACK_DUMP` 相同：
 * 未设置 / `0` 关闭；`1` / `true` / `on` 写
 * `<dataDir>/channel-pack/trae-usage-dump.ndjson`；其它值按文件路径处理。
 *
 * ⚠️ 标志值 → 路径的解析发生在宿主 `channelPack/worker.ts`（它才知道
 * dataDir），解析后**写回 worker 的 env**；本模块在 vendor 侧只认路径。
 * 因此未经 worker 解析的标志值（例如测试里直接设 `1`）按关闭处理 ——
 * 绝不猜一个相对路径往 cwd 里写文件。
 *
 * ## 落盘内容
 *
 * 只有 ts、模型 id、**原样**的 usage 对象（帧到了但没 usage 记 null）。
 * 用量帧不含用户正文；原样落盘是刻意的 —— 取证的目的就是看见我们没读过的键。
 * 写失败只警告一次，绝不抛：取证开关不许把一次正常聊天变成 500。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface TraeUsageDumpRecord {
  ts: number
  /** 本轮请求的模型 id（`options.model`）。 */
  model: string
  /** SOLO `token_usage` 事件里的 usage 原对象；null = 帧到了但没带 usage。 */
  usage: unknown
}

/** 每个路径只警告一次，避免磁盘满时每条用量帧刷一行日志。 */
const warnedPaths = new Set<string>()

/**
 * 追加一行。`envValue` 直接传 `process.env.MODELPORT_TRAE_USAGE_DUMP`：
 * 关闭值与未解析的标志值都是空操作，只有具体路径才写盘。
 */
export function appendTraeUsageDump(envValue: string | undefined, record: TraeUsageDumpRecord): void {
  const path = envValue?.trim()
  if (!path || path === '0' || /^(1|true|on|yes)$/i.test(path)) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf-8')
  } catch (error) {
    if (!warnedPaths.has(path)) {
      warnedPaths.add(path)
      console.warn(`[trae-usage-dump] 写入失败（不影响本次请求）：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}