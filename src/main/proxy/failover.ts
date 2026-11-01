/**
 * 换家（failover）的共享纯函数：工具数超限识别 + 流首事件等待。
 *
 * 单独成模块的原因与 `retryPolicy.ts` 同：forwarder.ts 背着 electron 侧的
 * store / 渠道管理器，node --test 拉不动；这两个判据是 auto 换家语义的核心，
 * 必须能被真实单测钉住，不能只靠源码文本断言。
 */
import type { PassThrough } from 'stream'
import type { AutoAttemptFailure } from '../../shared/types'
import { DEFAULT_FIRST_EVENT_TIMEOUT_MS } from './retryPolicy.ts'

/**
 * 工具数量超限类 400 的识别。
 *
 * ## 为什么这类 400 要允许「换下一家」（用户报障 2026-10-30）
 *
 * harness（内置工具 + MCP）一发就是上百个工具，部分上游网关（cline 背后的
 * Vercel AI Gateway）硬性限制 `tools ≤ 128`，直接 400：
 * `Invalid value for 'tools': maximum number of items is 128.`
 *
 * 这是**渠道能力不匹配**，不是客户端请求写错：同样的请求换一家没有该限制的
 * 渠道就能成。auto 候选逐个尝试本来就该跳过装不下的渠道，否则整个 auto
 * 会话被钉死在第一个撞上限的渠道上。
 *
 * ⚠️ 识别口径必须**窄**：要求文案同时出现 tools 语境与数量超限短语，避免把
 * 无关 400 误判成可换家。
 */
export function isToolOverflowError(message: string | undefined): boolean {
  if (!message) return false
  return /tools/i.test(message)
    && (/maximum number of items/i.test(message) || /too many (tools|items)/i.test(message))
}

/**
 * 「历史 assistant 消息缺 reasoning_content」类 400 的识别（用户报障 2026-10-31）。
 *
 * ## 为什么这类 400 也要允许「换下一家」
 *
 * cline 背后的 Vercel AI Gateway 对部分推理模型（`reflection/beam-free`）强制
 * 校验：多轮对话的**每一条历史 assistant 消息**都必须回传当轮的思考内容，缺任一
 * 即 400：`Missing required parameter: 'messages[6].reasoning_content'. This
 * model needs the reasoning of every earlier assistant message…`。
 *
 * 历史里之所以会缺，是无解的：思考内容由**上一轮响应方**产出，客户端不存
 * （reasoning_content 是 DeepSeek 风格的非标字段，多数客户端不回传）、上一轮由
 * 非推理模型/其它渠道响应、或思考被 max_tokens 截断 —— 任何一种都凑不齐
 * beam-free 要的全套历史。重试同一家只会原样再撞一次，上游自己也只能建议
 * 「consider starting a new session」。
 *
 * 这是**模型特性与客户端历史的不匹配**（与工具数超限同类：换一家没有该要求的
 * 渠道就能成），不是账号故障：不记冷却、不计账号失败，换下一家继续试。
 *
 * ⚠️ 识别口径必须**窄**：要求文案同时出现 `reasoning_content` 字段名与
 * `Missing required parameter` 短语 —— 正常正文不会同时带这两者。
 */
export function isMissingReasoningHistoryError(message: string | undefined): boolean {
  if (!message) return false
  return /reasoning_content/i.test(message)
    && /missing required parameter/i.test(message)
}

/**
 * 「渠道目录里没有这个模型」类 404 的识别（用户报障 2026-11-01，`auto` 命中
 * `opencode/qwen3.8-max` 后整场 404）。
 *
 * ## 为什么这一类也必须「换下一家」
 *
 * 宿主侧的可路由名单来自渠道包的 `model.list`，而它优先取适配器的
 * `listAllModels()` —— **不套身份档**（`opencode-adapter.ts`：只有匿名槽时
 * `listModels` 只放免费模型，全量表里 6 条付费模型照样在 `model.list` 里）。
 * 渠道 worker 的请求前校验读的却是**分档后**的 `listModels`
 * （`src/main/channelPack/worker.ts`），于是宿主把「目录说有、请求时不认」的
 * 模型广告成候选，`auto` 给它打了最高分（窗口大、tools/reasoning 齐全）。
 *
 * 后果原先是致命的而不是可绕的：404 不属于 `isFailoverEligibleStatus`，换家
 * 循环在第一个候选就 `return last`，同池另外 4 家一次都没被试到，客户端把
 * 「这一家供不了」读成「`auto` 不可用」。
 *
 * 判据与工具数超限同类：**这一家供不了这个模型，换一家就能成**，而账号本身
 * 是健康的（请求在生成之前就被自己的进程拒掉，零上游调用、不烧积分）——
 * 所以换下一家继续试，同时不记冷却、不计账号故障。
 *
 * ⚠️ 识别口径必须**窄**：这句文案是渠道 worker 自己抛出的原文
 * （`模型不存在或已停用`），不是上游文本；按普通 404 的语义继续直接失败。
 */
export function isChannelModelUnavailableError(message: string | undefined): boolean {
  if (!message) return false
  return message.includes('模型不存在或已停用')
}

/**
 * 「这一家的凭据已经不能用，要人来处理」类失败的识别
 * （2026-11-01 192.168.85.131 实测：27 笔失败属于这一类）。
 *
 * ## 为什么它必须与普通 502 分开
 *
 * 普通 5xx 走 15s 起的指数退避（`accountRuntime`），意图是「过一会儿再试同一类
 * 故障」。但凭据类故障**不会自己好**：
 * - `qoder: no usable credential; log in first`（登录态过期/被登出）；
 * - `凭据未配置，请先登录`（渠道有占位账号但没有可用凭据）；
 * - `opencode: 没有可用通道`（匿名槽按出口 IP 限，本机这一档已耗尽）。
 *
 * 短退避的实际后果是每一笔新请求都再撞一遍，而每一遍都要先付一次完整加密
 * prefill + 排队等待 —— 实测这三条各自的等待是 214s / 244s / 245s，`auto` 更被
 * 一笔拖到 **525s**。所以：换下一家照做（502 本来就 eligible），但冷却按
 * 「需要人工介入」那一档给（`accountRuntime.recordCredentialFailure`），宿主层
 * 也不再重试第二次。
 *
 * ⚠️ 识别口径必须**窄**：三条都是渠道包/适配器抛出的原文短语
 * （`account-pool.ts` / `opencode-adapter.ts` / 各家 `*-adapter.ts` 的
 * `MISSING_CREDENTIAL`），正常正文不会出现「no usable credential」「凭据未配置」
 * 「没有可用通道」这类字样。
 */
export function isChannelCredentialFailure(message: string | undefined): boolean {
  if (!message) return false
  return /no usable credential/i.test(message)
    || message.includes('凭据未配置')
    || message.includes('没有可用通道')
}

/**
 * 「这一家不接受强制 tool_choice」类 400 的识别（2026-11-01 实测 3 笔，`att=1`
 * 直接整场失败）。
 *
 * `tool_choice: "required"`（或指名某个函数）撞上只支持 `auto`/`none` 的网关
 * （Cline 背后的 Vercel AI Gateway、MiniMax 的 `MiniMax-M3.1-Flash`）会得到
 * `only tool_choice auto and none are supported`。这与工具数超限同类：**换一个
 * 候选就能成**，而请求在生成之前就被拒，账号健康、不烧积分 —— 所以按 capability
 * 类换下一家，不记冷却、不计账号失败。
 *
 * 单模型路径**保持原样直接 400**：用户点名了这一家，换成别家等于替他改需求。
 *
 * ⚠️ 识别口径必须**窄**：要求文案同时出现 `tool_choice` 与「只支持 auto/none」
 * 短语，正常正文不会同时带这两者。
 */
export function isForcedToolChoiceUnsupported(message: string | undefined): boolean {
  if (!message) return false
  return /tool_choice/i.test(message)
    && /only\s+.{0,40}auto\s+and\s+none\s+are\s+supported/i.test(message)
}

/**
 * 429 / 5xx / 无状态码（网络错误、超时）才值得换目标；4xx 换目标没有意义。
 *
 * 例外是「渠道能力不匹配」类 400（工具数超限、历史缺 reasoning_content）与
 * 「渠道目录不认这个模型」类 404：那三类由调用方在状态码判定**之前**单独放行
 * （forwarder.ts 的 `forwardFirstReachable`），本函数保持纯状态码语义。
 */
export function isFailoverEligibleStatus(status?: number): boolean {
  if (status === undefined) return true
  return status === 429 || status >= 500
}

/**
 * 可恢复类失败的识别：渠道/模型**暂时不可服务**（排队、当日额度用尽、限流），
 * 但请求本身没问题 —— 换下一家候选往往就能成。
 *
 * ## 为什么它决定换家上限（PLAN-auto-routing-freellmapi P0-1）
 *
 * 换家按错误类分级：
 * - **账号故障类**（5xx / 网络错误）：撞满基础上限（autoRouting.maxAttempts，
 *   默认 3 家）就收手 —— 积分账号每次失败都可能烧钱，5xx 通常意味着系统性问题，
 *   多试只是多烧；
 * - **可恢复类**（本函数命中的排队/额度/限流，外加工具数超限）：请求被上游
 *   在生成**之前**拒绝，几乎不烧积分，且换家命中率真实存在 —— 上限放宽
 *   {@link AUTO_RECOVERABLE_EXTRA_ATTEMPTS} 家。
 *
 * ⚠️ 识别口径必须**窄**（与 {@link isToolOverflowError} 同一纪律）。渠道错误
 * 跨桥时只带 `message`/`status`（bridge.ts 只透传这两个字段，LlmError 的 code
 * 到不了宿主），所以只能按文案匹配 —— 关键词取各家适配器实际抛出的原文：
 * - 排队：`ModelQueuedError` 的 message 是「模型排队中」；排队 JSON 体
 *   （`10605`/`isQueued`）可能原样出现在 message 里；
 * - 额度：qoder 110「Billing daily count exceeded」、buddy「所有账号均受限」、
 *   其余上游的 quota 字样（错误文案里出现 quota 几乎必然是配额问题，正常
 *   内容不会进 error 字段）。
 */
export function isRecoverableChannelFailure(message: string | undefined): boolean {
  if (!message) return false
  return /排队|isQueued|10605/.test(message)
    || /quota/i.test(message)
    || /billing\s+daily\s+count\s+exceeded/i.test(message)
    || /所有账号均受限/.test(message)
    // 渠道包在**发请求之前**就报「该模型全部启用账号都在限流中」（`index.ts` 的
    // `QUOTA_EXCEEDED`，状态码落成 502）。它自己写着「无需重新登录」，所以这是
    // 定时限流而不是人工介入：零上游调用、不烧积分，换下一家就能成。
    // 按普通 502 计入账号故障上限的话，三家限流就把整条链判死，而池里其余候选
    // 其实都活着（2026-11-01 远程日志：这一类在真流量里排第 2 多）。
    || /均在限流中|频率超限/.test(message)
    || isChannelCredentialFailure(message)
}

/**
 * 「这一家的账号被上游风控挡住，要人或时间去处理」类失败的识别。
 *
 * 腾讯系（CodeBuddy / WorkBuddy）的安全策略拦截：业务码 `11140`、
 * `msg: "request illegal"`、`displayMsg` 的「安全审核」文案。渠道包 2026-09-27 的
 * 逐账号实测已经推翻「这是内容问题」的初判 —— **同一份请求体**发往池里 7 个账号
 * 得到 2×200 / 4×403 / 1×429，拦截按**账号**生效。所以：
 * - 它不是「客户端请求写错」：换一个候选就能成 ⇒ `auto` 必须继续往下试，
 *   而不是在第一个候选就 `return last`（2026-11-01 实测 3 笔 `auto` 因此整场 400）；
 * - 它也不会自己好得快：渠道包内部就给它定了 30 分钟的账号冷却 ⇒ 宿主侧用
 *   「人工介入」那一档，而不是 15s 起（`accountRuntime.recordCredentialFailure`）。
 *
 * 状态码两边都有（远程日志里 400 与 502 各 7 / 2 笔），所以判据只看文案。
 */
export function isChannelRiskControlFailure(message: string | undefined): boolean {
  if (!message) return false
  return /request illegal/i.test(message)
    || message.includes('请求被拦截')
    || /安全审核|safety review/i.test(message)
}

/**
 * 「要人来处理或要时间恢复」的渠道级故障：凭据类与风控类的并集。
 *
 * 两者共同点决定了宿主该做的三件事一致：重试无意义（同一家同一笔等待再付一遍）、
 * 换下一家能成、冷却按人工介入档给。区别只在给客户端的 `code`
 * （`channel_relogin_required` / `channel_risk_control`），所以那个仍在
 * `errorMapping.ts` 里分开判。
 */
export function isChannelHumanRequiredFailure(message: string | undefined): boolean {
  return isChannelCredentialFailure(message) || isChannelRiskControlFailure(message)
}

/** 可恢复类失败在账号故障类上限之外额外放行的候选数（默认 3 + 3 = 6 家）。 */
export const AUTO_RECOVERABLE_EXTRA_ATTEMPTS = 3

/** 换家的墙钟总预算（毫秒）：整条候选链耗掉这么多时间就不再继续换家。 */
export const AUTO_WALL_CLOCK_BUDGET_MS = 90_000

/** 上游文案进日志时的截断长度（一条日志里最多 8 次失败，各 200 字符封顶）。 */
export const ATTEMPT_REASON_MAX_CHARS = 200

/**
 * 把一次「被跳过的候选」写成日志记录（分类判据与 forwarder 循环用的完全是
 * 同一批谓词，所以日志里的 `kind` 就是当时换家逻辑实际走的分支）。
 *
 * 为什么要单独记：请求日志只有**最终赢家**，`attempts: 4` 说明试了四家，
 * 但前三家各自答了什么无处可查 —— 一个天天全错的通道（目录不认模型、
 * 凭据过期）与一个只是暂时排队的通道，在日志里长得一模一样。
 */
export function describeAttemptFailure(input: {
  candidate: string
  error?: string
  status?: number
}): AutoAttemptFailure {
  const reason = (input.error ?? '').trim().slice(0, ATTEMPT_REASON_MAX_CHARS)
  const kind: AutoAttemptFailure['kind'] = isToolOverflowError(input.error)
    || isMissingReasoningHistoryError(input.error)
    || isChannelModelUnavailableError(input.error)
    || isForcedToolChoiceUnsupported(input.error)
    ? 'capability'
    : isChannelHumanRequiredFailure(input.error)
      // 风控类落的是 400，按纯状态码会被记成 `fatal`，而换家循环实际是**继续往下试**
      // （见 forwarder 的人工介入分支）—— 日志里的 kind 必须与当时走的分支一致。
      ? 'failover'
      : isFailoverEligibleStatus(input.status)
      ? 'failover'
      : 'fatal'
  return {
    candidate: input.candidate,
    kind,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(reason.length > 0 ? { reason } : { reason: '上游未给出错误文本' }),
  }
}

/**
 * 等流首事件的超时（毫秒）。
 *
 * ## 为什么必须有它（用户报障 2026-10-30「auto 假死空转」）
 *
 * qoder/qfmodel 三次请求 HTTP 200 但**零字节**（无首块、无首错），分别挂了
 * 165s / 285s / 625s。墙钟预算 {@link AUTO_WALL_CLOCK_BUDGET_MS} 只在换家循环
 * 的**尝试之间**检查 —— 单次尝试永不返回时预算形同虚设。渠道包的流是延迟流
 * （`openStream` 立刻可用，成败要等首个事件），而上游假死时首个事件永远不来，
 * `firstStreamEvent` 原先无限等下去。给「等首事件」本身加上时间上限：超时按
 * 失败处理（forwarder 转 504 参与换家），并销毁源流让 worker 中止上游请求。
 * 60s 的取值：正常渠道首帧零延迟（首帧即 role delta），而推理模型静默思考
 * 很少超过 30s —— 再长的沉默就该按假死对待了。
 */
// 取值本体在 `retryPolicy.DEFAULT_FIRST_EVENT_TIMEOUT_MS`（等待侧的唯一决策点）；
// 实际等待另受 `planRequestDeadlines()` 的 `min(本值, 请求超时)` 收窄。
export const FIRST_EVENT_TIMEOUT_MS = DEFAULT_FIRST_EVENT_TIMEOUT_MS


/** 是否还该尝试下一个候选（纯函数，供单测钉住分级语义；forwarder 循环调用）。 */
export function shouldTryNextAutoCandidate(input: {
  /** 已完成的尝试次数（含成功与失败） */
  attempts: number
  /** 其中账号故障类（5xx/网络）失败的次数 */
  accountFailures: number
  /** 账号故障类的尝试上限（autoRouting.maxAttempts） */
  baseCap: number
  /** 总尝试上限（候选列表长度，select 已裁剪为基础上限 + 可恢复余量） */
  extendedCap: number
  /** 距请求开始的已耗时（毫秒） */
  elapsedMs: number
  /** 墙钟预算（毫秒） */
  budgetMs: number
}): boolean {
  // 首个候选永远要试：预算被预检等前置步骤耗光时，零尝试会变成莫名 503
  if (input.attempts <= 0) return true
  // 账号故障类撞满基础上限就收手 —— 哪怕中间夹过可恢复类失败
  if (input.accountFailures >= input.baseCap) return false
  if (input.attempts >= input.extendedCap) return false
  if (input.elapsedMs >= input.budgetMs) return false
  return true
}

/**
 * 块间静默看门狗（流式**首块之后**的停摆检测）。
 *
 * ## 为什么单独成函数
 *
 * 判据本体要能被真实单测钉住：装它的 `channelPack/bridge.ts` import 了 electron，
 * `node --test` 拉不动；而这条时间轴（每一帧续一次、静默到点才炸）恰恰是
 * 「首块一到就记成功、之后停摆的流永远不返回」这类假死的唯一防线（2026-11-01
 * 实测两笔 `auto` 流式请求各挂 120s 零字节）。
 *
 * 语义三条，逐条有断言：
 * - **只在被 arm 之后计时**：首块到达前归 `firstStreamEvent` 管，两处都炸只会
 *   让错误文案变模糊；
 * - **每一帧续期**：量的是相邻两帧之间的静默，长回答永远不会被掐；
 * - **到点只炸一次**，之后必须显式 `arm()` 才会重新计时（不会自己连发）。
 */
export interface IdleWatchdog {
  /** 续期（也可用于首次装载） */
  arm(): void
  /** 撤掉计时器并禁止后续触发（结算/失败时调用） */
  clear(): void
}

export function createIdleWatchdog(timeoutMs: number, onTimeout: () => void): IdleWatchdog {
  let timer: NodeJS.Timeout | undefined
  let cleared = false

  const cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  return {
    arm(): void {
      if (cleared || timeoutMs <= 0) return
      cancel()
      timer = setTimeout(() => {
        timer = undefined
        if (!cleared) onTimeout()
      }, timeoutMs)
    },
    clear(): void {
      cleared = true
      cancel()
    },
  }
}

/** 一条流的首个事件：首块 / 首错 / 未产出任何数据就关闭 / 等待超时。 */
export type FirstStreamEvent =
  | { kind: 'data'; chunk: Buffer | string }
  | { kind: 'error'; error: Error }
  | { kind: 'closed' }
  | { kind: 'timeout' }

/**
 * 流头嗅探结果：`ok`（见到实质内容帧，`buffered` 是已读出的全部块，必须先于
 * pipe 原样补发给客户端）或 `error`（帧里报了错误，`message` 是错误文案）。
 */
export type SseProbeResult =
  | { kind: 'ok'; buffered: Array<Buffer | string> }
  | { kind: 'error'; message: string }

/** 头部嗅探的安全网上限：触顶按 ok 放行，宁可漏判也不拖死正常流。 */
const PROBE_MAX_BYTES = 64 * 1024
const PROBE_MAX_FRAMES = 200
const PROBE_TIMEOUT_MS = 10_000

/**
 * 嗅探一条 OpenAI 形状 SSE 流的头部：错误帧判失败，实质内容帧判成功。
 *
 * ## 为什么需要它（用户报障 2026-10-30「错误依旧」的直接原因）
 *
 * cline 的上游是 HTTP 200 的 SSE 流：cline 后端先接下流、再转发 Vercel 网关，
 * 工具数超限的 400 **以流内错误帧浮现**（`data: {"error":{...}}`，HTTP 层全是
 * 200）。于是「等首块再定成败」拿到首块就判成功、账号记 success，auto 的换家
 * 机制依旧看不到失败。这里在首块之后继续读，按帧解析：
 * - 见到 `{"error":...}`（**无论是否带 choices 键**——OpenAI 规范错误帧就是
 *   `choices: [] + error`，见 2026-10-31 修复）→ 报错误（交给换家循环）；
 * - 见到任何带 `choices` 的帧 → 立刻 ok（正常流第一帧就是 role delta，零延迟）；
 * - 注释帧（`: ping`）/无法解析的帧跳过；流在见到内容前关闭 → 报错误；
 * - 安全网（64KB / 200 帧 / 10s）触顶按 ok 放行——宁可漏判也不能拖死正常流。
 */
export function probeSseHead(
  stream: PassThrough,
  firstChunk: Buffer | string
): Promise<SseProbeResult> {
  return new Promise((resolve) => {
    const buffered: Array<Buffer | string> = [firstChunk]
    let text = typeof firstChunk === 'string' ? firstChunk : firstChunk.toString('utf-8')
    let pending = ''
    let timer: NodeJS.Timeout | undefined
    let settled = false

    const finish = (result: SseProbeResult): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      stream.removeListener('readable', onData)
      stream.removeListener('error', onError)
      stream.removeListener('end', onClosed)
      stream.removeListener('close', onClosed)
      resolve(result)
    }

    /** 解析一行 data 载荷；true=内容帧，string=错误帧文案，null=跳过。 */
    const inspectDataLine = (payload: string): true | string | null => {
      const trimmed = payload.trim()
      if (trimmed === '' || trimmed === '[DONE]') return null
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        return null
      }
      if (parsed === null || typeof parsed !== 'object') return null
      const record = parsed as Record<string, unknown>
      // ⚠️ 错误判据必须**先**于 choices 判据（2026-10-31 用户报障「Qoder 又出错」）：
      // OpenAI 中流错误帧的规范形状是 `choices: [] + error`（见 openai-gateway/stream.ts
      // 与 adapters/anthropic.ts），带 choices 键 —— 先判 choices 会把自家错误帧
      // 当成内容帧，嗅探放行，auto 换家机制对整类流内错误失明。内容帧绝不带
      // error 键，先判 error 零误伤。
      if (record.error !== undefined) {
        const error = record.error
        if (typeof error === 'string') return error
        if (error !== null && typeof error === 'object') {
          const message = (error as Record<string, unknown>).message
          if (typeof message === 'string' && message !== '') return message
          return JSON.stringify(error)
        }
        return String(error)
      }
      if ('choices' in record) return true
      return null
    }

    const inspectText = (): true | string | null => {
      // SSE 帧以空行分隔；最后一段可能是半帧，留到下一块再判。
      const segments = text.split('\n\n')
      pending = segments.pop() ?? ''
      let frames = 0
      for (const segment of segments) {
        frames += 1
        if (frames > PROBE_MAX_FRAMES) return null
        for (const line of segment.split('\n')) {
          if (!line.startsWith('data:')) continue
          const verdict = inspectDataLine(line.slice(5))
          if (verdict !== null) return verdict
        }
      }
      // 半帧里已经出现完整 data 行的情况（帧边界恰好没落在 data 行中）：
      // 上面只查完整帧，半帧保守不查 —— 下一块到达或安全网兜底。
      return null
    }

    const onData = (): void => {
      for (;;) {
        const chunk = stream.read() as Buffer | string | null
        if (chunk === null) break
        buffered.push(chunk)
        text = pending + (typeof chunk === 'string' ? chunk : chunk.toString('utf-8'))
        const verdict = inspectText()
        if (typeof verdict === 'string') {
          finish({ kind: 'error', message: verdict })
          return
        }
        if (verdict === true) {
          finish({ kind: 'ok', buffered })
          return
        }
        let bytes = 0
        for (const part of buffered) bytes += typeof part === 'string' ? part.length : part.length
        if (bytes > PROBE_MAX_BYTES) {
          finish({ kind: 'ok', buffered })
          return
        }
      }
    }
    const onError = (error: Error): void => {
      // 已缓冲的块里若见过内容帧（unlikely here）按 ok；否则按错误上报。
      const message = text !== '' ? inspectText() : null
      finish(typeof message === 'string' ? { kind: 'error', message } : { kind: 'ok', buffered })
    }
    const onClosed = (): void => {
      // 流在产出内容帧之前就结束：错误帧流（只报错就关）或空流，都按失败处理。
      const verdict = text !== '' ? inspectText() : null
      if (typeof verdict === 'string') {
        finish({ kind: 'error', message: verdict })
      } else {
        finish({ kind: 'error', message: '渠道流在产出任何内容之前就结束了' })
      }
    }

    timer = setTimeout(() => finish({ kind: 'ok', buffered }), PROBE_TIMEOUT_MS)
    stream.once('readable', onData)
    stream.once('error', onError)
    stream.once('end', onClosed)
    stream.once('close', onClosed)
    // 首块可能已经带上了完整判断依据，先查一次再挂监听。
    {
      const verdict = inspectText()
      if (typeof verdict === 'string') {
        finish({ kind: 'error', message: verdict })
        return
      }
      if (verdict === true) {
        finish({ kind: 'ok', buffered })
        return
      }
    }
  })
}

/**
 * 等一条流的第一个事件（首块、首错、提前关闭或超时）。
 *
 * 渠道包的完成流是**延迟流**——`openStream()` 立刻可用，上游真正的成败只能
 * 等首个事件才知道。用 `readable` + `read()`（而不是 `data` 事件）保持暂停态，
 * 读到首块后原样交还，调用方再 `pipe` 接管，中间不会丢块。
 *
 * 超时见 {@link FIRST_EVENT_TIMEOUT_MS}：到点按 `{ kind: 'timeout' }` 结算并
 * 摘掉全部监听（流不被消费、不破坏 —— 处置权在调用方）。不设超时的话，上游
 * 假死会让这次尝试永远不返回，换家循环的墙钟预算永远等不到检查点。
 */
export function firstStreamEvent(
  stream: PassThrough,
  timeoutMs: number = FIRST_EVENT_TIMEOUT_MS
): Promise<FirstStreamEvent> {
  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (value: FirstStreamEvent): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      stream.removeListener('readable', onData)
      stream.removeListener('error', onError)
      stream.removeListener('end', onClosed)
      stream.removeListener('close', onClosed)
      resolve(value)
    }
    const onData = (): void => {
      const chunk = stream.read() as Buffer | string | null
      if (chunk === null) return
      finish({ kind: 'data', chunk })
    }
    const onError = (error: Error): void => finish({ kind: 'error', error })
    const onClosed = (): void => finish({ kind: 'closed' })
    timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs)
    stream.once('readable', onData)
    stream.once('error', onError)
    stream.once('end', onClosed)
    stream.once('close', onClosed)
  })
}
