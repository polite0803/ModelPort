/**
 * 「每日首次启动自动签到」—— 开关、当日记录与执行体。
 *
 * ## 它做什么
 *
 * 渠道包启动后延迟一小段（默认 30 秒，见下），若这个开关开着，就串行遍历
 * 「账号池里真的有账号的渠道」，逐个调内部 `credits.claimAll`，并**按渠道**
 * 记录今天是否已经处理完。当天未完成的渠道（请求失败、Qoder 10:00 刷新前）
 * 由周期性重试定时器（默认 30 分钟）继续补领；已完成的渠道当天不再发请求。
 * 跨过 UTC+8 零点后，下一次重试会为新的一天重新跑一遍。
 * 用户手动点「全部渠道签到」不受此限（那是显式操作，永远放行）。
 *
 * ⚠️ **开关默认关闭**（2026-11-05 改；此前按 2026-10-02 的要求默认打开）。
 * 一轮是「渠道数 × 账号数」次无人值守的认证请求，而账号渠道的本质是以消费者
 * 账号直连官方接口 —— 上游按「非官方客户端」处置账号时，这批请求是唯一完全
 * 可以避免的那部分。要免费积分的用户仍可在状态灯上打开，或手动「一键领取」。
 * 判据是**只有显式 `true` 才算打开**（默认关，缺键必须落在关）。
 *
 * ## 为什么延迟 30 秒
 *
 * 两个理由，任一成立都不该立刻跑：
 * 1. **不跟启动抢资源**：一轮签到是「渠道数 × 账号数」次串行上游请求（反风控
 *    口径，见 `collectCreditBalances` 的顺序查询），启动瞬间打它会拖慢首屏；
 * 2. **等凭据续期先跑一轮**：宿主启动时的续期调度器**本身也要立刻跑一轮**
 *    （见 `index.ts` 的注释：短寿命 provider 的凭据在关机期间早就过期）。
 *    若抢在续期之前签到，过期凭据会让整轮变成失败。
 * 即便如此仍可能抢在续期完成前（多账号时续期本身就要几秒到几十秒），故**再加
 * 一道保险**：跑完时**没证明「今天已被处理」的渠道不记当天**，留给下一轮重试
 * 补上。延迟可用
 * `DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS` 覆盖，`0` 合法（表示立刻跑，单测用它）。
 *
 * ## 当天补领与跨日
 *
 * `start()` 排定首轮后，每次跑完都会按 `DSH_CHANNEL_PACK_AUTO_CHECKIN_RETRY_MS`
 *（默认 30 分钟）排下一次；每轮只处理「今天未完成」的渠道，全部完成时这一轮
 * 是零网络请求。跨日时逐渠道记账自然失效，下一轮会把所有渠道重新跑一遍，
 * 所以进程整天开着也不会漏掉第二天。
 *
 * ## 什么算「今天已被处理」（按渠道记账）
 *
 * ⚠️ **不是** `claimed + alreadyClaimed`，而是各渠道用
 * `ClaimOutcome.coversToday` 声明出来的 `summary.coversToday`
 * （真实缺陷，2026-10-02 审查 PR !33 定位：Qoder 活动每日 10:00（UTC+8）才刷新，
 * 上午那轮看到的 `CLAIMED` 属于**昨天**，拿它记账会让当天额度**整天漏领**）。
 *
 * 记账单位是**渠道**，不是整轮：某个渠道失败时，其余渠道照常记完成，失败的
 * 那个留在 `pendingProviders` 里由重试定时器继续补 —— 旧实现是整轮一个
 * `lastDate`，一个渠道成功就把当天记掉，失败的渠道整天不再重试。
 *
 * 渠道「今天已处理」的判据：
 * - `summary.failed === 0`（该渠道所有账号都没有失败）；且
 * - `summary.retryLater !== true`（渠道自己没声明「现在还不是今天的额度」）。
 *
 * 因此 Qoder 在 10:00 前跑的那轮（`retryLater`）不记完成，10:00 之后的重试
 * 会真正领到当天额度；失败账号也会在下一轮只重跑该渠道。
 *
 * ## 为什么单独一份文档，而不是塞进 ui-preferences.json
 *
 * `ui-preferences.json` 是**同 dsh home、多 profile 共享**的文档，而本仓库写盘
 * 是**整体替换**语义（见 `badge-preferences.ts` 的文件头对 state.json 记过的
 * 同一条理由）。同机上另一条工作区跑着**没有本功能**的旧版本插件时，它保存显示
 * 偏好会把这里的字段静默抹掉 —— 后果是「开关自己关了」或「今天又跑一次」。
 * 独立文档的读写者只有本文件，旧版本代码碰不到它。
 *
 * ## ⚠️ 不支持的渠道怎么判：**不建第二份能力名单**
 *
 * ## ⚠️「调用即判定」管不到的一类：签到**有代价**的渠道
 *
 * zcode 有签到，但每次领取都要现场产阿里云 captcha（web 版会拉起 headful
 * Chromium，且阿里云按设备限流 150 次/小时）。「等它返回错误再判定」来不及 ——
 * 代价发生在**调用期间**。故另有一张**排除表** `isAutoCheckinExcluded()`，
 * 在调 `claim` **之前**生效（详见那里的说明与维护口径）。用户仍可手动签到。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { QODER_BILLING_UTC_OFFSET_MS } from './model-queue.js'
import { resolveChannelPackHome } from './channel-pack-store.js'
import { formatClaimGains } from './credits.js'
import { ZCODE } from './zcode-product.js'
import type { BadgeRpcResult } from './usage-badge.js'
import type { RpcCreditsClaimAllResponse, RpcUsageAutoCheckinState } from './types.js'

/** 独立文档的文件名（与 state.json / ui-preferences.json 同目录）。 */
export const AUTO_CHECKIN_FILE = 'auto-checkin.json'

const SCHEMA = 'channel-pack/auto-checkin/v1'

/**
 * 文档内容。
 *
 * `lastDate` / `lastResult` 既是「当天不重复触发」的判据，也是状态灯提示的来源
 * （用户要求「记录签到状态，不多次重复触发」）。`channels` 是**逐渠道**结果，
 * 供面板上那行常驻的自动签到状态文字使用（用户 2026-10-02：「自动签到状态下，
 * 下方应该也显示文字状态，这样才能够知道各个渠道的签到状态」）。
 */
export interface AutoCheckinDoc {
  /**
   * 自动签到开关。**默认关闭**。
   *
   * 2026-10-02 曾按用户要求默认打开（`DSH` 桌面端的既有预期）。2026-11-05
   * 改为默认关闭：一轮自动签到是「渠道数 × 账号数」次**无人值守**的认证请求，
   * 而账号渠道的上游会按「非官方客户端」判定账号；在没有任何请求要发的时候
   * 替用户去敲一遍所有账号，是这类封禁里唯一完全可以避免的那部分流量。
   * 手动「一键领取」不受影响，仍在面板上。
   *
   * 判据是「只有显式 `true` 才算打开」，与账号 `enabled !== false` 的惯例相反
   * —— 因为这里的默认值是关，缺键必须落在关。
   */
  enabled: boolean
  /**
   * 这个开关是不是**用户亲手拨过的**（`'user'`）。
   *
   * 用于 2026-11-05 的默认值翻转：老文档里的 `enabled: true` 多半是旧默认值
   * 被 `save()` 顺手写下的，而不是用户的选择；只改默认常量无法关掉它。
   * 没有该标记的文档在加载时一律按**关**处理（一次性回到新默认），此后用户
   * 每次点开关都会写下本字段，选择被尊重。
   */
  decidedBy?: 'user'
  /** 上次**完成**自动签到的 UTC+8 日期（`YYYY-MM-DD`）；空串 = 从未跑过。 */
  lastDate: string
  /** 上次结果摘要（中文短句，展示在状态灯提示里）。 */
  lastResult: string
  /** 上次跑完的时刻（毫秒）；0 = 从未跑过。 */
  lastAt: number
  /** 逐渠道结果（顺序即遍历顺序）；空数组 = 没有可展示的逐渠道信息。 */
  channels: Array<{ provider: string; text: string }>
  /**
   * 逐渠道的「今天已处理」记账（`provider -> YYYY-MM-DD`）。
   *
   * 这是**补领**的判据：只有这里等于今天的渠道才会被跳过；其余渠道（失败 /
   * Qoder 刷新前）留给重试定时器。旧实现只有一个整轮的 `lastDate`，一个渠道
   * 成功就把当天记掉，失败的渠道当天再也不会重试。
   */
  providerDates: Record<string, string>
  /** 今天仍未处理完的渠道 id（供界面展示「还有几个渠道待重试」）。 */
  pendingProviders: string[]
  /**
   * 用户点过「关闭」的那一轮（存的是那一刻的 `lastAt`）。
   *
   * ⚠️ 存 `lastAt` 而不是布尔：新一轮跑出来 `lastAt` 变了，状态文字就会**重新出现**
   *（否则用户关过一次以后就再也看不到新的结果）。0 = 未曾关闭过。
   */
  dismissedRunAt: number
}

/** 默认：关闭 + 无记录。 */
export const DEFAULT_AUTO_CHECKIN: AutoCheckinDoc = {
  enabled: false,
  lastDate: '',
  lastResult: '',
  lastAt: 0,
  channels: [],
  providerDates: {},
  pendingProviders: [],
  dismissedRunAt: 0,
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 逐渠道条目的上限：渠道总数就 12 个，留一点余量即可（脏数据不该撑大文档）。 */
const MAX_CHANNEL_ENTRIES = 24

/** 归一化逐渠道结果（丢非法项、截断超长文本、限制条数）。 */
function sanitizeChannels(raw: unknown): Array<{ provider: string; text: string }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ provider: string; text: string }> = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.provider !== 'string' || record.provider.length === 0) continue
    if (typeof record.text !== 'string') continue
    out.push({ provider: record.provider, text: record.text.slice(0, 120) })
    if (out.length >= MAX_CHANNEL_ENTRIES) break
  }
  return out
}

/** 归一化逐渠道日期表：只保留「合法 provider id → 合法日期」。 */
function sanitizeProviderDates(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [provider, value] of Object.entries(raw as Record<string, unknown>)) {
    if (provider.length === 0 || provider.length > 64) continue
    if (typeof value !== 'string' || !DATE_RE.test(value)) continue
    out[provider] = value
  }
  return out
}

/** 归一化待重试渠道 id 列表（去重、限长）。 */
function sanitizePendingProviders(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 64) continue
    if (!out.includes(item)) out.push(item)
    if (out.length >= MAX_CHANNEL_ENTRIES) break
  }
  return out
}

/**
 * 归一化文档：非法值一律回落默认值（**不抛错**）。
 *
 * ⚠️ 与 RPC 写入路径的严格校验**不冲突**：那条路径面对用户输入，要拒绝非法值；
 * 这条路径面对**磁盘上的脏数据**（手工编辑过、被旧版本写坏），回落比整机不可用
 * 更合理 —— 判据口径与 `sanitizeBadgePreference` 一致。
 * ⚠️ 缺新字段的**旧文档**（没有 `channels` / `lastAt` / `enabled`）必须照常读出来：
 * 前两个是本功能上线后追加的，而 `enabled` 缺失要按**默认打开**处理（不是关闭）。
 */
export function sanitizeAutoCheckin(raw: unknown): AutoCheckinDoc {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_AUTO_CHECKIN }
  const record = raw as Record<string, unknown>
  const ms = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
  return {
    // 默认是**关闭**（见 `AutoCheckinDoc.enabled`）：缺键必须落在关，否则
    // 升级后没人点过开关的安装会立刻开始无人值守地打所有账号。
    // 老文档里的 `true` 是旧默认值写的，没有 `decidedBy` 标记 ⇒ 同样按关处理
    // （一次性迁移）；用户亲手打开后该标记会落盘，此后按用户选择执行。
    enabled: record.decidedBy === 'user' && record.enabled === true,
    ...(record.decidedBy === 'user' ? { decidedBy: 'user' as const } : {}),
    lastDate: typeof record.lastDate === 'string' && DATE_RE.test(record.lastDate) ? record.lastDate : '',
    lastResult: typeof record.lastResult === 'string' ? record.lastResult : '',
    lastAt: ms(record.lastAt),
    channels: sanitizeChannels(record.channels),
    providerDates: sanitizeProviderDates(record.providerDates),
    pendingProviders: sanitizePendingProviders(record.pendingProviders),
    dismissedRunAt: ms(record.dismissedRunAt),
  }
}

/**
 * 取「UTC+8 的当天日期」（`YYYY-MM-DD`）。
 *
 * ⚠️ 必须用**算术平移**而不是本机时区：日界归服务端（各渠道的每日额度按 UTC+8
 * 结算），取本机时区会在用户出差/改系统时区时得到错的「今天」—— 偏东会提前把
 * 当天记为已跑（真的漏签），偏西会一天跑两次。偏移量复用 `model-queue.ts` 的
 * `QODER_BILLING_UTC_OFFSET_MS`（同一口径，不另立常量）。
 */
export function utc8DateString(nowMs: number = Date.now()): string {
  return new Date(nowMs + QODER_BILLING_UTC_OFFSET_MS).toISOString().slice(0, 10)
}

/** 环境变量：启动后延迟多久再尝试自动签到（毫秒）。 */
export const DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS = 'DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS'

/** 默认延迟（毫秒）。理由见文件头「为什么延迟 30 秒」。 */
export const AUTO_CHECKIN_DELAY_MS = 30_000

/**
 * 读延迟配置。
 *
 * ⚠️ 不能写成 `Number(env.X) || 默认值`：`0` 是**合法**值（立刻执行），
 * 而 `0` 是 falsy 会被静默换成 30 秒 —— 与本仓库 `DSH_CHANNEL_PACK_BADGE_TTL_MS`、
 * `DSH_QODER_QUEUE_TIMEOUT_MS` 记过的是同一个坑。
 */
export function autoCheckinDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS]
  if (typeof raw !== 'string' || raw.trim().length === 0) return AUTO_CHECKIN_DELAY_MS
  const parsed = Number(raw.trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : AUTO_CHECKIN_DELAY_MS
}

/** 环境变量：当天未完成渠道的重试间隔（毫秒）。 */
export const DSH_CHANNEL_PACK_AUTO_CHECKIN_RETRY_MS = 'DSH_CHANNEL_PACK_AUTO_CHECKIN_RETRY_MS'

/** 默认重试间隔（毫秒）：30 分钟。整轮已完成时这一轮不发任何网络请求。 */
export const AUTO_CHECKIN_RETRY_MS = 30 * 60_000

/**
 * 读重试间隔。
 *
 * ⚠️ 与延迟不同，`0` **不合法**：那会让重试变成死循环。非法值一律回落默认值。
 */
export function autoCheckinRetryMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[DSH_CHANNEL_PACK_AUTO_CHECKIN_RETRY_MS]
  if (typeof raw !== 'string' || raw.trim().length === 0) return AUTO_CHECKIN_RETRY_MS
  const parsed = Number(raw.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : AUTO_CHECKIN_RETRY_MS
}

/** 文档后端：文件（正常）或内存（定位不到 dsh home 时的显式降级）。 */
export type AutoCheckinStoreKind = 'file' | 'memory'

/** 文档读写接口（同步读、异步写，与 `BadgePreferenceStore` 同款约定）。 */
export interface AutoCheckinStore {
  readonly kind: AutoCheckinStoreKind
  /** 载入文档；不存在 / 损坏 / 字段非法时返回默认值。 */
  load(): AutoCheckinDoc
  /** 整份写入（原子写）。 */
  save(doc: AutoCheckinDoc): Promise<void>
}

class MemoryAutoCheckinStore implements AutoCheckinStore {
  readonly kind = 'memory' as const
  private doc: AutoCheckinDoc = { ...DEFAULT_AUTO_CHECKIN }

  load(): AutoCheckinDoc {
    return { ...this.doc }
  }

  async save(doc: AutoCheckinDoc): Promise<void> {
    this.doc = { ...doc }
  }
}

class FileAutoCheckinStore implements AutoCheckinStore {
  readonly kind = 'file' as const

  constructor(
    private readonly path: string,
    private readonly logger: { warn(message: string): void } | undefined,
  ) {}

  load(): AutoCheckinDoc {
    try {
      if (!existsSync(this.path)) return { ...DEFAULT_AUTO_CHECKIN }
      return sanitizeAutoCheckin(JSON.parse(readFileSync(this.path, 'utf-8')) as unknown)
    } catch (error) {
      // 损坏时回落默认值而不是抛错：这是后台任务，读不到文档不该让插件起不来。
      // 默认值是「**关闭**」（见 `DEFAULT_AUTO_CHECKIN`），所以回落的后果是
      // 「今天不自动签到」，而不是替用户去敲一遍账号。
      this.logger?.warn(`[channel-pack] 读取 ${this.path} 失败，自动签到按默认设置（关闭）处理: ${String(error)}`)
      return { ...DEFAULT_AUTO_CHECKIN }
    }
  }

  async save(doc: AutoCheckinDoc): Promise<void> {
    mkdirSync(join(this.path, '..'), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify({
      schema: SCHEMA,
      enabled: doc.enabled,
      // ⚠️ 必须落盘：`sanitizeAutoCheckin` 只认「`decidedBy === 'user'` 且
      // `enabled === true`」为开启。漏写本字段的后果是用户打开开关、下次启动
      // 又被读成关闭（`sanitizeAutoCheckin` 的一次性迁移判据），自动签到再也不会跑。
      ...(doc.decidedBy === 'user' ? { decidedBy: 'user' as const } : {}),
      lastDate: doc.lastDate,
      lastResult: doc.lastResult,
      lastAt: doc.lastAt,
      channels: doc.channels,
      providerDates: doc.providerDates,
      pendingProviders: doc.pendingProviders,
      dismissedRunAt: doc.dismissedRunAt,
    }, null, 2), 'utf-8')
    renameSync(tmp, this.path)
  }
}

/** 创建文档后端（home 与账号池 / 偏好文档用**同一个** `resolveChannelPackHome`）。 */
export function createAutoCheckinStore(ctx: Context): AutoCheckinStore {
  const home = resolveChannelPackHome(ctx)
  if (home === undefined) {
    ctx.logger?.warn?.('[channel-pack] 无法定位 DSH home，自动签到开关仅存在于内存中')
    return new MemoryAutoCheckinStore()
  }
  return new FileAutoCheckinStore(join(home, 'channel-pack', AUTO_CHECKIN_FILE), ctx.logger)
}

/** 一轮执行的累计口径（账号级计数来自各渠道的 `summary`）。 */
interface RunTotals {
  /** 真正跑过 `claimAll` 的渠道数（不含被跳过的）。 */
  providers: number
  claimed: number
  totalCredit: number
  /**
   * ★ **按单位分组**的合计（2026-10-04）。
   *
   * ⚠️ 展示路径**必须**用它而不是 {@link totalCredit}：后者跨单位求和，
   * 会把 ZCode 的 token 与其余渠道的积分加成一个数（真实缺陷，见
   * `RpcCreditsClaimSummary.totalByUnit`）。
   */
  totalByUnit: Record<'token' | 'credit', number>
  alreadyClaimed: number
  inactive: number
  failed: number
  /**
   * 其中**能证明「今天这一轮已被处理」**的账号数（来自 `summary.coversToday`）。
   *
   * ⚠️ 不能用 `claimed + alreadyClaimed`：那两项里混着「刷新前那一轮」的痕迹
   * （Qoder 活动 10:00 UTC+8 才刷新），拿它们记账会让当天新额度整天漏领。
   * 渠道是否算「今天已处理」另看 {@link isProviderSettled}（还要没有失败账号）。
   * 字段语义见 `src/credits.ts` 的 `ClaimOutcomeCommon.coversToday`。
   */
  coversToday: number
  /** 渠道级：不支持签到（`claimAll` 未发上游请求就返回的那些）。 */
  skipped: number
  /** 渠道级：其它错误（凭据、网络……）。 */
  errors: number
}

function emptyTotals(): RunTotals {
  return { providers: 0, claimed: 0, totalCredit: 0, totalByUnit: { token: 0, credit: 0 }, alreadyClaimed: 0, inactive: 0, failed: 0, coversToday: 0, skipped: 0, errors: 0 }
}

/**
 * ⚠️ 兜底认 `unsupported provider`：那是 `productById` 找不到产品时的文案，
 * 语义同样是「这个渠道没有可用的签到实现」，计成失败只会制造假警报。
 * ⚠️ 判据必须**窄**：只匹配这两个短语，不要泛化成「含 unsupported」之类，
 * 免得把真正的参数错误也吞掉。
 */
export function isUnsupportedCheckin(message: string): boolean {
  return message.includes('不支持每日签到') || message.includes('unsupported provider')
}

/**
 * ⚠️ **自动签到不适合**的渠道：领取过程需要**用户在场 / 外部程序**。
 *
 * ## 为什么不靠「错误文案」判（真实缺陷，2026-10-02 审查 PR !33 定位）
 *
 * 但**漏了一类**：zcode **有**签到，只是每次领取都要现场产一个阿里云
 * captcha param（`channel-pack-rpc.ts` 的 zcode 分支无条件调 `zcode.mintCaptcha`）。
 * web 版下它会**拉起 headful Chromium**（约 200–400MB），而阿里云按**设备**
 * 限流「同设备每小时 150 次」。默认开启的自动签到等于：用户什么都没点，
 * 开 DSH 就起一棵浏览器进程树、白耗设备级配额；一旦这轮失败又不写 `lastDate`
 * ⇒ **每次启动都重来**，一天开十次就是十轮 captcha。
 *
 * ## 判据与维护口径
 *
 * - 这张表是**第二份名单**，但它记的不是「谁有签到接口」（那仍由
 *   `claimAll` 的守卫 + 客户端能力表负责），而是「谁有签到**代价**」——
 *   后者无处可查，只能显式登记。**新增带 captcha / 外部浏览器的 provider 时，
 *   必须同时登记到这里**（`tests/unit/auto-checkin.spec.ts` 有反向守护用例：
 *   一旦 zcode 的 claim 分支又开始调 `mintCaptcha`，而本表没登记，用例会红）。
 * - 用户仍可在面板里**手动**点 zcode 的「一键领取积分」—— 那是有意行为，
 *   浏览器弹出来是用户自己能理解的交互。
 */
export function isAutoCheckinExcluded(provider: string): boolean {
  return provider === ZCODE.id
}

/** 把一轮结果拼成一句中文摘要（给状态灯提示与日志用）。 */
export function describeRun(totals: RunTotals): string {
  const parts: string[] = []
  if (totals.claimed > 0) {
    // ★ 按单位分别报（2026-10-04，真实缺陷）：原先写 `+${totals.totalCredit} 积分`，
    //   而 `totalCredit` 是**跨单位求和** —— ZCode 的 1 亿 token 与 100 积分会被
    //   加成 `100000100` 并标成「积分」。用户报障原文给的期望形态就是
    //   `+100Mtoken, +100积分`（见 `credits.ts` 的 `formatClaimGains`）。
    const amounts = formatClaimGains(totals.totalByUnit ?? { credit: totals.totalCredit })
    parts.push(`${totals.claimed} 个账号领取成功${amounts === null ? '' : `（${amounts}）`}`)
  }
  if (totals.alreadyClaimed > 0) parts.push(`${totals.alreadyClaimed} 个今天已领`)
  if (totals.failed > 0) parts.push(`${totals.failed} 个失败`)
  if (totals.errors > 0) parts.push(`${totals.errors} 个渠道出错`)
  if (totals.skipped > 0) parts.push(`${totals.skipped} 个渠道不支持签到`)
  if (parts.length === 0) return `${totals.providers} 个渠道：没有需要领取的账号`
  return `${totals.providers} 个渠道：${parts.join('，')}`
}

/**
 * 这个渠道今天算不算「已处理完」。
 *
 * 判据（缺一不可）：
 * - 本渠道没有失败账号（`summary.failed === 0`）；
 * - 渠道没有声明「现在还不是今天的额度」（`summary.retryLater !== true`）。
 *
 * ⚠️ 不能只看 `coversToday > 0`：一个有 2 个账号的渠道可能「1 个成功、1 个失败」，
 * 记成完成会让失败那个账号当天不再重试。反过来，全是「活动未开启 / 账号已停服」
 * 且没有 `retryLater` 时记完成是对的 —— 再试也不会有结果。
 */
function isProviderSettled(summary: RpcCreditsClaimAllResponse['summary'] | undefined): boolean {
  if (summary === undefined) return true
  if (summary.failed > 0) return false
  if (summary.retryLater === true) return false
  return true
}

/**
 * 单个渠道的短状态（面板上那行常驻文字用它逐渠道列出，用户要求「这样才能够知道
 * **各个渠道**的签到状态」）。
 *
 * ⚠️ 必须**短**：9 个渠道要挤在 280px 的面板里一行一个片段，长文案会撑成好几屏。
 * 故只给「几个账号 + 什么结果」，不带渠道名（渠道名由展示层补）。
 */
export function describeChannel(summary: {
  claimed: number
  totalCredit: number
  alreadyClaimed: number
  inactive: number
  failed: number
  /** 见 `RpcCreditsClaimSummary.coversToday`；缺省按 `claimed+alreadyClaimed` 兜底。 */
  coversToday?: number
  /** 见 `RpcCreditsClaimSummary.retryLater`：这一轮不算今天的渠道会标「稍后重试」。 */
  retryLater?: boolean
  /**
   * ★ 按单位分组的合计（2026-10-04）。**缺省回落到「全部按积分」**，
   * 以兼容尚未上报该字段的旧响应（与 `coversToday` 的兜底同思路）。
   */
  totalByUnit?: Partial<Record<'token' | 'credit', number>>
}): string {
  const parts: string[] = []
  if (summary.claimed > 0) {
    // ⚠️ 「领到了但 +0 分」与「今天已领」必须能分辨：前者写成「已领」会和
    // alreadyClaimed 撞词，用户无法判断这次到底有没有动作。
    //
    // ★ 单位感知（2026-10-04）：原先写裸数字 `+${summary.totalCredit}`，
    //   于是 ZCode 那行显示 `1 个 +100000000` —— 既看不出单位，量级也读不出来。
    //   用户给的期望形态是 `+100Mtoken`（见 `credits.ts` 的 `formatClaimGains`）。
    const amounts = formatClaimGains(summary.totalByUnit ?? { credit: summary.totalCredit })
    parts.push(amounts === null ? `${summary.claimed} 个领取成功` : `${summary.claimed} 个 ${amounts}`)
  }
  if (summary.alreadyClaimed > 0) parts.push(`${summary.alreadyClaimed} 个今天已领`)
  if (summary.failed > 0) parts.push(`${summary.failed} 个失败`)
  if (summary.inactive > 0) parts.push(`${summary.inactive} 个未开启`)
  if (parts.length === 0) return '无可领'
  // ⚠️ 声称「今天已领」之前先自问一句：这些痕迹是不是**今天这一轮**的？
  // Qoder 在 10:00（UTC+8）刷新前看到的 `CLAIMED` 属于昨天 —— 此时那句
  // 「今天已领」既不准确，又会让用户以为今天不必再领。
  const coversToday = summary.coversToday ?? (summary.claimed + summary.alreadyClaimed)
  if (coversToday === 0 && (summary.claimed + summary.alreadyClaimed) > 0) {
    parts.push('非今日轮次')
  }
  if (summary.failed > 0 || summary.retryLater === true) parts.push('稍后重试')
  return parts.join('，')
}

/** 装配层注入的依赖（全部可替换 ⇒ 单测零网络、零文件系统、零等待）。 */
export interface AutoCheckinDeps {
  store: AutoCheckinStore
  /**
   * 列出**账号池里有账号**的渠道 id。
   * 只遍历有账号的渠道：没有账号的渠道调 `claimAll` 只会拿到空结果，白白走一遍
   * 12 条分支。
   */
  listProviderIds(): Promise<string[]>
  /**
   * 调某个渠道的签到 —— **必须复用 `credits.claimAll` 的实现**（装配层直接调内部
   * `handleMethod`）。本模块不认任何具体渠道，只按返回的信封判「跳过 / 失败」。
   */
  claim(provider: string): Promise<BadgeRpcResult<RpcCreditsClaimAllResponse>>
  now?(): number
  /** 延迟毫秒数；默认读环境变量。 */
  delayMs?: number
  /** 当天未完成渠道的重试间隔（毫秒）；默认读环境变量。 */
  retryMs?: number
  /** 排定延迟执行（注入以便单测零等待）。返回值交给 `stop()` 取消。 */
  schedule?(fn: () => void, ms: number): { cancel(): void }
  warn?(message: string): void
}

/** 自动签到执行体。 */
export interface AutoCheckin {
  /** 实时状态（供 RPC 与状态灯；`enabled` 等取自内存，不重新读盘）。 */
  state(): RpcUsageAutoCheckinState
  /** 写开关；**打开时立刻跑一轮**（否则用户会以为开关没生效）。 */
  setEnabled(enabled: boolean): Promise<RpcUsageAutoCheckinState>
  /**
   * 关闭面板上那行**常驻的**自动签到状态文字（用户点它上方的小按钮时调用）。
   *
   * ⚠️ 与手动签到的结果提示不同：那条是**按时自动消失**；这一条是用户要求
   * 「不要自动取消、给我开放手动关闭」。关闭记的是**这一轮**（当前的 `lastAt`），
   * 故下一轮跑出新结果时它会重新出现。
   */
  dismiss(): Promise<RpcUsageAutoCheckinState>
  /** 启动时调用一次：延迟后排定首轮，之后按间隔重试当天未完成的渠道。 */
  start(): void
  /** 立刻跑一轮（只处理今天未完成的渠道；供「刚打开开关」与单测用）。 */
  runIfDue(): Promise<void>
  /** 取消尚未执行的延迟/重试任务（不打断已开始的一轮）。 */
  stop(): void
}

/** 创建自动签到执行体。 */
export function createAutoCheckin(deps: AutoCheckinDeps): AutoCheckin {
  const now = deps.now ?? (() => Date.now())
  let doc = deps.store.load()
  let running = false
  /** 在飞去重：`setEnabled(true)`、启动排定与重试定时器都可能同时想跑。 */
  let inflight: Promise<void> | null = null
  /** 首轮延迟任务。 */
  let pending: { cancel(): void } | null = null
  /** 当天未完成渠道的重试任务。 */
  let retryTimer: { cancel(): void } | null = null
  /** 下一次重试的时刻（供界面展示）；0 = 没有排定。 */
  let nextRetryAt = 0

  const today = (): string => utc8DateString(now())
  const schedule = deps.schedule ?? defaultSchedule

  function state(): RpcUsageAutoCheckinState {
    return {
      enabled: doc.enabled,
      lastDate: doc.lastDate,
      ranToday: doc.lastDate !== '' && doc.lastDate === today(),
      running,
      lastResult: doc.lastResult,
      lastAt: doc.lastAt,
      pending: doc.pendingProviders.length,
      pendingProviders: [...doc.pendingProviders],
      nextRetryAt,
      channels: doc.channels.map((entry) => ({ ...entry })),
      // 面板据它决定要不要渲染那行常驻状态文字
      dismissed: doc.lastAt > 0 && doc.dismissedRunAt === doc.lastAt,
    }
  }

  /** 只保留今天的逐渠道记账（跨日时旧记录自然失效）。 */
  function datesFor(runDate: string): Record<string, string> {
    const dates: Record<string, string> = {}
    for (const [provider, date] of Object.entries(doc.providerDates)) {
      if (date === runDate) dates[provider] = date
    }
    return dates
  }

  async function performRun(): Promise<void> {
    // 日期在**开跑时**固定：跨零点时本轮仍归开始那天，下一轮再领新的一天，
    // 不会用「写完时已经是第二天」的日期把新的一天提前记掉。
    const runDate = today()
    const totals = emptyTotals()
    let providers: string[] = []
    try {
      providers = [...new Set(await deps.listProviderIds())].sort()
    } catch (error) {
      // 账号池读不出来：不记日期，下一轮重试。
      deps.warn?.(`[channel-pack] 自动签到：读取账号池失败，本次跳过: ${String(error)}`)
      return
    }
    if (providers.length === 0) {
      // 没有任何账号：不记日期 —— 空池不该把「今天」记掉，否则新增账号要等到明天。
      return
    }

    const dates = datesFor(runDate)
    // 换天时旧文本属于昨天，不能当作今天的逐渠道状态展示。
    const previousText = new Map<string, string>()
    if (doc.lastDate === runDate) {
      for (const entry of doc.channels) previousText.set(entry.provider, entry.text)
    }
    const channels: Array<{ provider: string; text: string }> = []
    let changed = false

    for (const provider of providers) {
      if (dates[provider] === runDate) {
        // 今天已经处理完：不再发请求，沿用上一轮的文本。
        channels.push({ provider, text: previousText.get(provider) ?? '今日已处理' })
        continue
      }
      changed = true
      // ⚠️ 排除表先于**任何**上游请求生效（见 isAutoCheckinExcluded 的说明）：
      // zcode 的代价发生在**调用期间**（拉起浏览器产 captcha），事后再判断已经
      // 太晚 —— 必须在调 `claim` 之前就把它摘掉。
      if (isAutoCheckinExcluded(provider)) {
        totals.skipped += 1
        dates[provider] = runDate
        channels.push({ provider, text: '需手动签到' })
        continue
      }
      let result: BadgeRpcResult<RpcCreditsClaimAllResponse>
      try {
        result = await deps.claim(provider)
      } catch (error) {
        totals.errors += 1
        channels.push({ provider, text: '出错，稍后重试' })
        deps.warn?.(`[channel-pack] 自动签到：${provider} 调用异常: ${String(error)}`)
        continue
      }
      if (!result.ok) {
        const message = typeof result.error?.message === 'string' ? result.error.message : ''
        if (isUnsupportedCheckin(message)) {
          totals.skipped += 1
          dates[provider] = runDate
          channels.push({ provider, text: '无签到接口' })
          continue
        }
        totals.errors += 1
        channels.push({ provider, text: '出错，稍后重试' })
        deps.warn?.(`[channel-pack] 自动签到：${provider} 失败: ${message || '未知错误'}`)
        continue
      }
      totals.providers += 1
      const summary = result.value?.summary
      if (summary === undefined) {
        dates[provider] = runDate
        channels.push({ provider, text: '无可领' })
        continue
      }
      totals.claimed += summary.claimed
      totals.totalCredit += summary.totalCredit
      // ★ 按单位累加（2026-10-04）：`totalByUnit` 缺省时回落到「全部按积分」，
      //   兼容尚未上报该字段的旧宿主响应 —— 与 `coversToday` 的兜底同思路。
      const byUnit = summary.totalByUnit ?? { credit: summary.totalCredit, token: 0 }
      totals.totalByUnit.credit += Number(byUnit.credit) || 0
      totals.totalByUnit.token += Number(byUnit.token) || 0
      totals.alreadyClaimed += summary.alreadyClaimed
      totals.inactive += summary.inactive
      totals.failed += summary.failed
      // ⚠️ 记账口径**只认**这一项：渠道用 `coversToday` 自己声明「这条痕迹是不是
      // 今天这一轮的」。缺省回落到 `claimed + alreadyClaimed`，是为了兼容尚未
      // 上报该字段的旧响应（缺字段 ≠ 0，否则整轮会被判成「什么都没证明」）。
      totals.coversToday += summary.coversToday ?? (summary.claimed + summary.alreadyClaimed)
      // 该渠道今天是否处理完：没失败、且渠道没声明「现在还不是今天的额度」。
      // 不满足就留在 pending 里，下一轮只重跑它（其余渠道不再发请求）。
      if (isProviderSettled(summary)) dates[provider] = runDate
      channels.push({ provider, text: describeChannel(summary) })
    }

    const pendingProviders = providers.filter((provider) => dates[provider] !== runDate)
    const allSettled = pendingProviders.length === 0
    // 全部已处理且今天已经记过：这一轮什么都没变，不写盘。
    if (!changed && !(allSettled && doc.lastDate !== runDate)) return

    doc = {
      ...doc,
      providerDates: dates,
      pendingProviders,
      channels,
      ...(changed
        ? {
            lastResult: describeRun(totals),
            lastAt: now(),
            // ⚠️ 新一轮跑出结果要**清掉上一次的「已关闭」标记**：否则用户关过
            // 一次后，新结果会被旧标记静默藏住（`dismissed` 判据是 lastAt 相等）。
            dismissedRunAt: 0,
          }
        : {}),
      ...(allSettled ? { lastDate: runDate } : {}),
    }
    try {
      await deps.store.save(doc)
    } catch (error) {
      // 写盘失败 ⇒ 下一轮可能重复处理（幂等，代价是多发一轮请求），如实告警。
      deps.warn?.(`[channel-pack] 自动签到结果写入失败（可能重复触发一轮）: ${String(error)}`)
    }
    if (allSettled) {
      deps.warn?.(`[channel-pack] 自动签到完成（${runDate}）：${doc.lastResult}`)
    } else {
      deps.warn?.(
        `[channel-pack] 自动签到本轮完成，仍有 ${pendingProviders.length} 个渠道待重试（${pendingProviders.join(',')}）：${describeRun(totals)}`,
      )
    }
  }

  /** 排定下一轮重试；开关关闭或间隔非法时不排。 */
  function armRetry(): void {
    retryTimer?.cancel()
    retryTimer = null
    nextRetryAt = 0
    if (!doc.enabled) return
    const ms = deps.retryMs ?? autoCheckinRetryMs()
    if (!(ms > 0)) return
    nextRetryAt = now() + ms
    retryTimer = schedule(() => {
      retryTimer = null
      nextRetryAt = 0
      void runIfDue()
    }, ms)
  }

  function runIfDue(): Promise<void> {
    if (inflight !== null) return inflight
    if (!doc.enabled) return Promise.resolve()
    running = true
    const task = performRun().catch((error: unknown) => {
      deps.warn?.(`[channel-pack] 自动签到异常: ${String(error)}`)
    }).finally(() => {
      running = false
      inflight = null
      // 每轮跑完都重新排定：跨日后这一轮会为新的一天重新处理所有渠道；
      // 全部完成时每轮只剩一次本地账号池扫描，零上游请求。
      armRetry()
    })
    inflight = task
    return task
  }

  return {
    state,
    async setEnabled(enabled) {
      doc = { ...doc, enabled, decidedBy: 'user' }
      await deps.store.save(doc)
      if (enabled) {
        // 打开开关时立刻尝试一轮（今天已完成则由 performRun 内部跳过）。
        // ⚠️ 不 await：一轮要串行打十几个上游，让按钮等它会让界面像卡死；
        // `state()` 里的 `running` 会立刻变成 true，界面据此显示「进行中」。
        void runIfDue()
      } else {
        // 关闭只取消**尚未执行**的排定；已经开始的一轮让它跑完，避免半轮请求。
        retryTimer?.cancel()
        retryTimer = null
        nextRetryAt = 0
      }
      return state()
    },
    start() {
      if (pending !== null) return
      const ms = deps.delayMs ?? autoCheckinDelayMs()
      const fire = (): void => {
        pending = null
        void runIfDue()
      }
      // 延迟为 0 = 立刻跑（单测的默认形态，也是用户把环境变量设成 0 时的语义）。
      if (ms <= 0) {
        fire()
        return
      }
      pending = schedule(fire, ms)
    },
    runIfDue,
    async dismiss() {
      // 记「关闭的是哪一轮」（当前的 lastAt）：下一轮跑完 lastAt 会变，文字自动回来。
      doc = { ...doc, dismissedRunAt: doc.lastAt }
      try {
        await deps.store.save(doc)
      } catch (error) {
        // 写盘失败 ⇒ 重开面板时那行文字会再出现（还可再点一次关闭），如实告警。
        deps.warn?.(`[channel-pack] 自动签到状态文字关闭标记写入失败: ${String(error)}`)
      }
      return state()
    },
    stop() {
      pending?.cancel()
      pending = null
      retryTimer?.cancel()
      retryTimer = null
      nextRetryAt = 0
    },
  }
}

/**
 * 默认排定：`setTimeout` + `unref()`。
 *
 * ⚠️ `unref()` 是必须的：否则一个 30 秒的待执行定时器会**拖住宿主进程退出**
 *（用户关掉 DSH 后进程还要多活半分钟）。与 `index.ts` 的续期定时器同一处理。
 */
function defaultSchedule(fn: () => void, ms: number): { cancel(): void } {
  const timer = setTimeout(fn, ms)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}
