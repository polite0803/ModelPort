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
  /**
   * 首轮切片上限（毫秒）。只在第一次尝试上给，作用见 {@link FIRST_ATTEMPT_CAP_MS}。
   */
  capMs?: number
}): number {
  const floor = input.floorMs ?? ATTEMPT_DEADLINE_FLOOR_MS
  const remaining = input.budgetMs - input.elapsedMs
  const granted = Math.min(input.completeMs, Math.max(floor, remaining))
  return input.capMs === undefined ? granted : Math.min(granted, input.capMs)
}

/**
 * 第一次尝试的墙钟切片上限（2026-11-12 用户裁定「不提高总预算，但要降低第一轮的
 * 尝试预算」）。
 *
 * 出厂的 `firstEventMs` 是 60s，而整条链的预算只有 {@link AUTO_WALL_CLOCK_BUDGET_MS}
 * = 90s：一发慢首块就能吃掉 2/3 预算，后面 9 个候选连一次像样的等待都分不到
 * （现网 `chatcmpl-mwceepbp-zsfoaf` 就是 `tried=1` + 池里 10 家 + 文案承诺换家却没换）。
 * 首轮压到 20s 的依据：今天 Codex 流量的首帧实测 p50 3–5s、最大 ~12s
 * （`streamTrace.firstTokenMs`），20s 已经覆盖正常推理模型的首帧，超出就是异常慢，
 * 让它先让位给下一家比继续等更符合「不中断任务」。
 *
 * ⚠️ 这是**单个常量**，要调就调它；不要把它做成配置项 —— 没有证据支持逐路由不同值。
 */
export const FIRST_ATTEMPT_CAP_MS = 20_000

/**
 * 没有换家空间的流式请求，等首块的上限（2026-11-12）。
 *
 * 具名 provider 模型不走 `forwardFirstReachable`，没有 `attemptDeadlineMs`：换家循环
 * 的预算概念不存在，`firstEventMs` 只能落到出厂的 60s。而客户端自己的耐心通常也在
 * 60s 上下 —— 实测华为云码道 39 笔 codearts 失败全部落在 57.3–61.1s，网关的 60s 与
 * 客户端的 60s 打平，客户端先走：用户看到「客户端已断开」，网关既没换家（这条模型
 * 只有一家候选），也没把这次记成渠道故障（`client_abort` 不计分），下一轮原样重演。
 *
 * 30s 的依据与 {@link FIRST_ATTEMPT_CAP_MS} 同源：同一窗口里 codearts 成功请求的
 * 首块 1.9–5.5s（另有三笔 30.8–32.7s 的慢样本）。30s 覆盖正常首帧，超出就该把
 * 结论交给客户端，而不是陪它一起等到双双超时。
 *
 * ⚠️ 它是**地板**，不是定值：对该账号自己有成功首字读数的情形，上限按
 * {@link SINGLE_CANDIDATE_SLOW_FACTOR} 放宽（见 `planFirstEventWait`）。
 */
export const SINGLE_CANDIDATE_FIRST_EVENT_CAP_MS = 30_000

/**
 * 「没有下家」时，用该 (账号, 模型) 自己的首字实测把 30s 地板放宽到 `实测 × 2`。
 *
 * 2026-11-13 窗口（11:34–13:11）把一刀切的代价量出来了：codearts 成功首字
 * p50 **28.5s** / p90 30.5s / max 33.1s（早一小时的读数是 p50 30.4s / max 37.2s，
 * 日志滚动所以区间随读数移动），而 30s 上限正好压在分布的屁股上 ——
 * 同一窗口 11 笔成功 vs 80 笔 30s 超时，成功的那些只是「刚好在 30s 前落下」。
 * 对这种「排队三十秒才开口」的账号，多等十几秒是省一次失败，不是浪费。
 *
 * 倍数 2 的推导：该账号 long-run 首字均值（α=0.1）约 22–25s，观测上界 33–37s，
 * 2× 后落在 45–50s：覆盖实测上界，同时仍在客户端 ~60s 耐心之内 —— 11-12 那次
 * 「客户端先走、网关既没换家也没记故障」的收尾条件不能重演。
 * 实测值只用来**放宽**：快账号的 2× 远低于 30s，地板仍然生效；没有成功读数
 * （EWMA 尚未建立）的账号仍按 30s 判死，那才是真假死。
 */
export const SINGLE_CANDIDATE_SLOW_FACTOR = 2

/** 首块等待被谁截断：超时文案按它归因，不能一律写成「剩余墙钟预算」。 */
export type FirstEventClamp = 'none' | 'attempt-budget' | 'single-candidate'

export interface FirstEventWaitPlan {
  /** 实际等待上限（毫秒） */
  waitMs: number
  /** 被压短的原因；`none` = 就是出厂 `firstEventMs` */
  clampedBy: FirstEventClamp
}

/**
 * 等首块实际能等多久。
 *
 * - 换家链里（`attemptDeadlineMs` 已给）：`min(出厂 firstEventMs, 本次尝试截止)`，
 *   被压短时归因 `attempt-budget`；
 * - 不在链里：`min(出厂 firstEventMs, 截止, max(30s, 实测首字 × 2))`，归因
 *   `single-candidate`。实测只放宽地板：没有读数时仍是 30s。
 *
 * 换家链不读 `measuredFirstTokenMs` —— 链里有下家，换一家比等一个慢账号便宜。
 */
export function planFirstEventWait(input: {
  firstEventMs: number
  deadlineMs: number
  attemptDeadlineMs?: number
  /** 该 (账号, 模型) 的首字实测（毫秒）；无读数时不给这个键。 */
  measuredFirstTokenMs?: number
}): FirstEventWaitPlan {
  const measuredCeiling = input.measuredFirstTokenMs === undefined
    ? 0
    : Math.round(input.measuredFirstTokenMs * SINGLE_CANDIDATE_SLOW_FACTOR)
  const ceiling = input.attemptDeadlineMs
    ?? Math.max(SINGLE_CANDIDATE_FIRST_EVENT_CAP_MS, measuredCeiling)
  const waitMs = Math.min(input.firstEventMs, input.deadlineMs, ceiling)
  if (waitMs >= input.firstEventMs) return { waitMs, clampedBy: 'none' }
  return {
    waitMs,
    clampedBy: input.attemptDeadlineMs === undefined ? 'single-candidate' : 'attempt-budget',
  }
}

/**
 * 剩余预算低于这个线就不再新开一次尝试（2026-11-12）。
 *
 * `planAttemptDeadline` 在预算归零时返回**下限**而不是 0，于是换家循环会照常用
 * 5s 开一发注定假超时的尝试：客户端多等 5s、拿回一个「渠道未产出首块」的错误，
 * 而这一发本来就不可能成功。预算已经花完就该直接收口（回 503 + `Retry-After`，
 * 让客户端退避），而不是再烧一次注定失败的往返。
 */
export const MIN_REMAINING_FOR_NEXT_ATTEMPT_MS = ATTEMPT_DEADLINE_FLOOR_MS

/**
 * 换家链被**可恢复类**失败耗尽后，网关自己等一次再走一遍链的等待计划。
 *
 * ## 为什么需要（2026-11-12 用户裁定）
 *
 * 池子里全是限流/额度类失败时，原先直接回 503 让客户端中断任务。协议上 503 +
 * `Retry-After` 叫「等一会再来」，但 Codex 不会自动重试 agent 回合 —— 对用户就是
 * 任务断了。所以等待必须由网关自己兑现，而不是甩给客户端。
 *
 * ## 预算从哪来
 *
 * 只用 **A2 腾出的那部分**：`AUTO_WALL_CLOCK_BUDGET_MS` 不提高（用户明确「不提高」），
 * 首轮切片压到 20s 之后剩下的墙钟就是恢复轮的额度。等待时长受三重夹住：
 * 剩余预算、上游给的解禁时刻（没有则用出厂退避）、以及 {@link RECOVERY_MAX_WAIT_MS}。
 *
 * ## 等待不占 AIMD 并发槽
 *
 * 槽在每次尝试返回时就 `endAttempt` 释放了（`forwarder.ts`），本等待发生在**整条链
 * 走完之后**，所以结构上不可能持有槽 —— 不需要为此改持有期语义。
 *
 * @returns 要等待的毫秒数；`undefined` = 不该恢复（预算不够、或这不是可恢复类耗尽）。
 */
export function planRecoveryWaitMs(input: {
  /** 上游给的解禁秒数（渠道包/`Retry-After`）；聚合 429 常常没有。 */
  retryAfterSeconds?: number
  /** 距整笔请求起点已花掉的毫秒数。 */
  elapsedMs: number
  /** 整条链的墙钟预算。 */
  budgetMs: number
}): number | undefined {
  const remaining = input.budgetMs - input.elapsedMs
  if (remaining < RECOVERY_MIN_BUDGET_MS) return undefined
  const backoffMs = input.retryAfterSeconds === undefined
    ? RECOVERY_DEFAULT_BACKOFF_MS
    : Math.max(1_000, Math.round(input.retryAfterSeconds * 1000))
  return Math.min(RECOVERY_MAX_WAIT_MS, backoffMs, remaining)
}

/** 恢复轮的等待上限：再长就该让客户端自己重试，而不是把连接挂着。 */
export const RECOVERY_MAX_WAIT_MS = 15_000
/** 上游没给解禁时刻时的出厂退避（聚合 429 全部走这条）。 */
export const RECOVERY_DEFAULT_BACKOFF_MS = 5_000
/** 剩余预算低于这个线就不值得再等一轮。 */
export const RECOVERY_MIN_BUDGET_MS = 2_000

/**
 * 一次等待的睡眠。抽出来是为了让换家循环的恢复轮可被单测注入假计时器钉住，
 * 而不是真的挂 5 秒。
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
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
