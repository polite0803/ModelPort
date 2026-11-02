import type { ProviderType } from '../store/types'

/**
 * 转发层重试预算的**唯一决策点**（纯函数，可脱离 electron 与网络单测）。
 *
 * ## 为什么按 provider 分类，而不是全局一套
 *
 * 旧实现在这里对所有 provider 一视同仁：失败后 `await delay(5000)`，最多
 * `config.retryCount`（默认 3）次。对内建 / 聚合端点这是合理的 —— 它们的
 * 重试语义就归本进程管。但**账号渠道不是**：上游协议、排队、额度与换号的
 * 重试全部在渠道 Worker 里（见 `forwarder.forwardAccountChannel` 的模块注释
 * 与 `vendor/channel-pack/src/qoder-adapter.ts` 的 `retryQueuedRequest` /
 * `retryUpstreamTimeout`）。宿主在此之上再叠一层，得到的是**双重退避**：
 *
 * | 层 | 旧预算 |
 * |---|---|
 * | 渠道内 504 首字超时 | 2s + 8s（已实测与官方 0.5s 的差异并刻意放宽） |
 * | 渠道内排队 10605 | 服务端声明值，单次 ≤ 10s，总预算 30 分钟 |
 * | 宿主 5xx | **每次 5s × 3** |
 *
 * 而账号渠道的一发失败请求不是免费的：它重新解析凭据（跨线程取 safeStorage
 * 解密）、重新用 WASM 加密**整个历史**、再打一次上游。用户体感就是「同一个
 * 提示转很久」。
 *
 * ## 为什么不干脆取消账号渠道的重试
 *
 * 渠道自己**不覆盖**两类瞬时故障：worker 刚崩溃重启、以及 `TRANSPORT`
 * （连接被重置）。这两类只能由宿主重发一次才有救。所以是**降到一次 + 短退避**，
 * 不是清零 —— 清零会把可自愈的故障变成必然失败，那是矫枉过正。
 *
 * ## 调用方显式给的预算优先
 *
 * `forwardAutoCompletion` 之类的路径会传 `{ maxRetries: 0 }`（候选链上每个
 * 供应商只打一次，失败就换下一个）。那是一句**指令**，不是一句默认值：本函数
 * 只会**下调**、绝不上调，`0` 永远得到 `0`。
 */

/** 非账号渠道的重试间隔（毫秒）—— 历史值，保持不变。 */
export const DEFAULT_FORWARD_RETRY_DELAY_MS = 5_000

/**
 * 账号渠道的重试间隔（毫秒）。
 *
 * 取 500ms 而不是 0：`TRANSPORT` 类故障（连接重置、worker 刚重建）在同一毫秒
 * 重打往往仍然失败；也不是 5s：那一档已经被渠道内部退避覆盖，宿主再等 5 秒
 * 只是把用户体感的等待累加，而不是把成功率提高。
 */
export const ACCOUNT_CHANNEL_RETRY_DELAY_MS = 500

/** 账号渠道在宿主层最多**额外**尝试几次。 */
export const ACCOUNT_CHANNEL_MAX_RETRIES = 1

/**
 * 等待侧的**唯一决策点**（与 {@link planForwardRetries} 对偶：一个管重试次数，
 * 一个管每笔等多久）。
 *
 * ## 为什么必须有一个
 *
 * `config.requestTimeout`（高级设置里的「请求超时」，默认 60s、校验 1s–300s）此前
 * 全仓零调用者，而真正在用的两处各有自己的字面量：HTTP 转发读
 * `proxyStatusManager.getConfig().timeout`（出厂 120s，且 `updateConfig()` 无人调用），
 * 账号渠道的非流式完成读 `bridge.ts` 里写死的 `0`（永不超时）。于是用户在 UI 上调
 * 旋钮没有任何效果，而渠道包内部的排队预算（`DSH_QODER_QUEUE_TIMEOUT_MS`，未覆盖时
 * 是 30 分钟）可以单独把一笔请求挂 525s —— 2026-11-01 在 192.168.85.131 实测到的
 * 正是这一格（`docs/plan/PLAN-channel-auto-stability.md` R1/R2）。
 *
 * ## 四条值各自的职责
 *
 * - `completeMs`：单次非流式上游请求在宿主侧的最长等待。到点**中止并换下一家**，
 *   而不是让客户端干等。取 `max(请求超时, COMPLETE_FLOOR_MS)` —— 下限那半句是
 *   为了不砍掉今天已经能成的请求，见下面的取值理由；
 * - `firstEventMs`：流式等首个事件。取 `min(默认 60s, 请求超时)`，所以默认配置下
 *   流式行为与本改动前**完全一致**；
 * - `idleMs`：流式**首块之后**两块之间的最长静默，`clamp(请求超时, 15s, 60s)`。
 *   没有这一格，首块一到就记成功，之后停摆的流永远不返回（实测两笔 120s 零字节）；
 * - `packQueueMs`：注入渠道 worker 的排队总预算，故意**小于** `completeMs` ——
 *   让渠道自己先答「模型排队中」（那条错误带着服务端的等待语义），比宿主造一个
 *   504 更诚实，也更便宜（宿主中止会让渠道白烧一次加密 prefill）。
 *
 * 另外：`auto` 与裸名链会把每次尝试的截止时间**再收紧**到剩余墙钟预算
 * （见 `forwarder.forwardFirstReachable` → `ChatCompletionRequest.attemptDeadlineMs`），
 * 否则「90s 墙钟」仍然只在尝试之间生效 —— 一笔 120s 的等待就能吃掉整条链。
 *
 * ## 代价（写在案上）
 *
 * 默认配置（请求超时 60s）下：渠道非流式最多等 120s、渠道内部排队最多 110s。
 * 于是「排队 8 分钟后才成功」的那类请求（2026-11-01 实测 525s 一笔）会变成
 * 「约 110s 时判排队失败并换下一家」。这是**明知故取**：一个多线路由代理的价值
 * 在于换家能成，而不是让用户盯着一个转圈的输入框。要等满队列就把请求超时调到
 * 300s（上限），`packQueueMs` 随之走到 290s。
 */

/** 「请求超时」缺省值（毫秒）—— 与 `DEFAULT_CONFIG.requestTimeout` 同值。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

/** 该值的合法区间，与 `store/config.ts` 对 `requestTimeout` 的校验保持一致。 */
const REQUEST_TIMEOUT_MIN_MS = 1_000
const REQUEST_TIMEOUT_MAX_MS = 300_000

/** 流式等首事件的默认上限（毫秒）；`failover.FIRST_EVENT_TIMEOUT_MS` 即本值。 */
export const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 60_000

/** 块间静默的下限：推理模型的长思考可以合理地沉默几十秒，别把 1s 当停摆。 */
const IDLE_MIN_MS = 15_000

/**
 * 非流式等待的**下限**（毫秒）：等于 HTTP 转发今天实际在用的那一格
 * （`proxy/status.ts` 的 `timeout: 120000`）。
 *
 * 为什么要有这个下限而不是直接照抄「请求超时」：已安装的实例里存着的都是 60s
 * （`DEFAULT_CONFIG.requestTimeout`），接上去就会把 HTTP 侧从 120s **砍到** 60s ——
 * 实测 `ovh/Qwen3.5-397B-A17B` 一笔非流式就是 44.9s，长回答再慢一点就会新增一批
 * 「以前能成、现在超时」的失败。修的是「无界等待」，不是把成功变失败。
 */
const COMPLETE_FLOOR_MS = 120_000

/** 渠道排队预算相对宿主截止时间的提前量（毫秒）。 */
const PACK_QUEUE_HEADROOM_MS = 10_000

/** 渠道排队预算的下限：再短就等于「不允许排队」，会把正常高峰全判死。 */
const PACK_QUEUE_MIN_MS = 10_000

/** 一次上游请求的等待计划。 */
export interface RequestDeadlinePlan {
  /** 非流式：单次上游请求的最长等待 */
  completeMs: number
  /** 流式：等首个事件的最长等待 */
  firstEventMs: number
  /** 流式：首块之后两块之间的最长静默 */
  idleMs: number
  /** 注入渠道 worker 的排队总预算（`DSH_QODER_QUEUE_TIMEOUT_MS`） */
  packQueueMs: number
}

/** 夹进 `[min, max]`；非有限数按 `fallback` 处理（`NaN` / `Infinity` / 非数字）。 */
function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * 由「请求超时」算出四条等待值。
 *
 * @param requestTimeoutMs - `config.requestTimeout`；缺失或非法按 60s 处理。
 */
export function planRequestDeadlines(requestTimeoutMs: number | undefined): RequestDeadlinePlan {
  const knob = clamp(requestTimeoutMs, REQUEST_TIMEOUT_MIN_MS, REQUEST_TIMEOUT_MAX_MS, DEFAULT_REQUEST_TIMEOUT_MS)
  const completeMs = Math.max(COMPLETE_FLOOR_MS, knob)
  return {
    completeMs,
    firstEventMs: Math.min(DEFAULT_FIRST_EVENT_TIMEOUT_MS, knob),
    idleMs: clamp(knob, IDLE_MIN_MS, DEFAULT_FIRST_EVENT_TIMEOUT_MS, DEFAULT_FIRST_EVENT_TIMEOUT_MS),
    packQueueMs: Math.max(PACK_QUEUE_MIN_MS, completeMs - PACK_QUEUE_HEADROOM_MS),
  }
}

/** 单次尝试的截止下限（毫秒）：再紧就不如不试这一家。 */
export const ATTEMPT_DEADLINE_FLOOR_MS = 5_000

/**
 * 换家循环里**这一次尝试**能占多久。
 *
 * `AUTO_WALL_CLOCK_BUDGET_MS` 只在尝试之间检查，所以它必须被折算成单次截止才真正
 * 生效：一笔永不返回的渠道请求（实测 525s）能把整条链吃干，而循环要到它返回以后
 * 才有机会说「预算用完了」。
 *
 * @param completeMs - 出厂计划的单次上限（不该被放宽）。
 * @param elapsedMs - 距整笔请求开始的毫秒数（含已试掉的候选）。
 * @param budgetMs - 整条候选链的墙钟预算。
 * @param floorMs - 下限，默认 {@link ATTEMPT_DEADLINE_FLOOR_MS}；预算已经用完时
 *   也返回下限（调用方决定是否还试下一家），而不是返回 0 让单次等待立刻假超时。
 */
export function planAttemptDeadline(input: {
  completeMs: number
  elapsedMs: number
  budgetMs: number
  floorMs?: number
}): number {
  const floor = input.floorMs ?? ATTEMPT_DEADLINE_FLOOR_MS
  const remaining = input.budgetMs - input.elapsedMs
  return Math.min(input.completeMs, Math.max(floor, remaining))
}

/** 一次转发重试的预算（次数不含首次尝试）。 */
export interface ForwardRetryProfile {
  /** 额外重试次数；`0` = 只打一次（此时宿主不会睡任何一秒）。 */
  maxRetries: number
  /** 每次重试前的等待（毫秒）。 */
  retryDelayMs: number
}

/** 读成非负整数；非法值（`NaN` / 负数 / 非数字）按 **0** 处理，而不是按默认。 */
function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

/**
 * 算出某次转发该重试几次、每次等多久。
 *
 * @param type - provider 类型（只需类型字段，不要求整条记录）。
 * @param configuredRetries - 调用方给的预算：`options.maxRetries ?? config.retryCount`。
 *   **只下调不上调**：显式的 `0` 得到 `0`。
 */
export function planForwardRetries(
  type: ProviderType,
  configuredRetries: number,
): ForwardRetryProfile {
  const budget = toCount(configuredRetries)
  if (type === 'account') {
    return {
      maxRetries: Math.min(budget, ACCOUNT_CHANNEL_MAX_RETRIES),
      retryDelayMs: ACCOUNT_CHANNEL_RETRY_DELAY_MS,
    }
  }
  return { maxRetries: budget, retryDelayMs: DEFAULT_FORWARD_RETRY_DELAY_MS }
}
