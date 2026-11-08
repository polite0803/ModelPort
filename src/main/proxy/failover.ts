/**
 * 换家（failover）的共享纯函数：工具数超限识别 + 流首事件等待。
 *
 * 单独成模块的原因与 `retryPolicy.ts` 同：forwarder.ts 背着 electron 侧的
 * store / 渠道管理器，node --test 拉不动；这两个判据是 auto 换家语义的核心，
 * 必须能被真实单测钉住，不能只靠源码文本断言。
 */
import type { Readable } from 'stream'
import type { AutoAttemptFailure } from '../../shared/types'
import { DEFAULT_FIRST_EVENT_TIMEOUT_MS } from './retryPolicy.ts'
import { extractStreamErrorFrame, type StreamErrorFrame } from './stream.ts'

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
 * 「这次的请求装不进这一家的上下文窗口」类 400 的识别（2026-11-03 排查 Codex
 * 长会话时确认的缺口）。
 *
 * ## 为什么这类 400 也必须「换下一家」
 *
 * 长上下文请求撞上的 400 说的是**这一家的窗口**，不是客户端写错了什么：
 * OpenAI 侧 `This model's maximum context length is 8192 tokens ...`（code
 * `context_length_exceeded`），Anthropic 侧 `prompt is too long: 1000000 tokens >
 * 200000 maximum`，各家自研网关侧 `上下文长度超限`。同一份请求发给窗口更大的
 * 候选就能成。
 *
 * 原先 400 一律终止（AGENTS.md 的换家状态口径），所以第一个候选装不下时，
 * `auto` 整场失败，客户端读到「这个路由不可用」，而真正的事实是「这一家装不下,
 * 池里还有装得下的」。这与工具数超限、目录里没有这个模型是同一类：**这一家
 * 供不了这次请求，账号本身健康**，所以不记冷却、不计账号失败，换下一家。
 *
 * 与 new-api 的差别：它把 `context_length_exceeded` 归进 perf 的
 * `OutcomeIgnored`（`pkg/perf_metrics/outcome.go:119`，明确不影响重试/禁用），
 * 也就是分类但不行动；这里要的是行动。
 *
 * ⚠️ 识别口径必须**窄**：只认成串的上下文超限说法，不认单独的 `token` /
 * `too long` —— 正常正文与别的错误里都可能出现这两个词。
 */
const CONTEXT_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /context_length_exceeded/i,
  /maximum context length/i,
  /context (?:length|window)[^.\n]{0,40}?\b(?:exceed|too long|larger than|over)/i,
  /\bexceeded[^.\n]{0,40}?context (?:length|window)/i,
  /prompt is too long/i,
  /input[^.\n]{0,30}tokens[^.\n]{0,30}exceed/i,
  /上下文(?:长度|窗口)?[^.\n]{0,12}(?:超出|超过|过长|不足)/,
  /(?:超过|超出)(?:了)?(?:该?模型)?(?:的)?(?:上下文|窗口)(?:长度)?/,
]

export function isContextOverflowError(message: string | undefined): boolean {
  if (!message) return false
  return CONTEXT_OVERFLOW_PATTERNS.some(pattern => pattern.test(message))
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
 * `Missing required parameter` 短语 —— 正常正文不会同时带这两者。DeepSeek 官方
 * 只说「必须回传」，所以第二种句式单独认（同样要求字段名，见函数内注释）。
 */
export function isMissingReasoningHistoryError(message: string | undefined): boolean {
  if (!message) return false
  // 两种上游文案：Vercel AI Gateway 的 `Missing required parameter:
  // 'messages[6].reasoning_content'`，以及 DeepSeek 官方的
  // `The reasoning_content in the thinking mode must be passed back to the API.`
  // （2026-11-07 实测，聚合 deepseek 线）。两句都同时带字段名，口径不变。
  return /reasoning_content/i.test(message)
    && (/missing required parameter/i.test(message) || /must be passed back/i.test(message))
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
 * 「这一家的上游目录里没有这个模型」类 400 的识别（用户报障 2026-11-03，
 * 192.168.85.131 的 `daily` 路由实测两笔）。
 *
 * ## 为什么这一类必须「换下一家」
 *
 * 与 {@link isChannelModelUnavailableError} 同一性质，但**文案来自上游本身**，
 * 不是渠道 worker 抛的：聚合条目（ModelScope / BazaarLink 这类多厂商网关）的
 * 静态目录是编译期快照，上游下架或改名模型后它不会自己跟着变，于是宿主把
 * 「目录说有、请求时不认」的模型广告成候选并给了高分。真机实测两笔：
 *
 * - `modelscope/Tencent-Hunyuan/Hy3` → `Model id : Tencent-Hunyuan/Hy3 , has no
 *   provider supported`（上游 2026-11-03 的 `/v1/models` 只有 37 个模型，
 *   `Tencent-Hunyuan/*` 一条都没有）；
 * - `bazaarlink/mimo-v2.5-pro` → `Unknown model: mimo-v2.5-pro. This model is
 *   not in our catalog.`（上游已改成 `mimo-v2.6-pro` / `mimo-v2.6-flash`）。
 *
 * 后果原先是致命的而不是可绕的：400 不属于 `isFailoverEligibleStatus`，换家
 * 循环在第一个候选就 `return last`，同池另外 4 家一次都没被试到（真机日志里
 * `auto.failures` 只有一个 `kind: fatal`），客户端把「这一家供不了这个模型」
 * 读成「整条路由不可用」。
 *
 * 判据与工具数超限同类：**这一家供不了这个模型，换一家就能成**，而账号本身
 * 是健康的（请求在生成之前就被拒，零上游调用、不烧积分）—— 所以换下一家继续试，
 * 同时不记冷却、不计账号故障。
 *
 * ⚠️ 识别口径必须**窄**：只认「目录里没有这个模型」这一个语义，且要求文案里
 * **点名了模型**（否则「你传的参数不对」之类也会命中）。`model not found`
 * 这类**客户端写错名字**的说法不在此列 —— 换家没有意义，客户端点名了一个
 * 不存在的模型，该由客户端自己改。
 */
const UPSTREAM_CATALOG_MISS_PATTERNS: readonly RegExp[] = [
  // ModelScope：`Model id : Tencent-Hunyuan/Hy3 , has no provider supported`
  /has\s+no\s+provider\s+supported/i,
  // BazaarLink：`Unknown model: mimo-v2.5-pro. This model is not in our catalog.`
  /(?:unknown|invalid)\s+model\b/i,
  /\bnot\s+in\s+(?:our|the)\s+catalog\b/i,
]

export function isUpstreamCatalogMissError(message: string | undefined): boolean {
  if (!message) return false
  return UPSTREAM_CATALOG_MISS_PATTERNS.some(pattern => pattern.test(message))
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
 * 「这一家不接受 `reasoning_effort`」类 400 的识别（2026-11-03 实测：`daily` 路由把
 * WorkBuddy 的请求派给 OVH 的 `Meta-Llama-3_3-70B-Instruct`，上游回
 * `feature 'reasoning_effort for this model' is not currently supported`，`att=1`
 * 整轮终止）。
 *
 * 与强制 `tool_choice`、工具数超限同一类：**换一个候选就能成**，请求死在生成之前，
 * 账号健康。而这类模型常常**没有推理标注**（OVH 那条就是 `reasoning:'unknown'`），
 * 所以路由侧的硬筛拦不住它 —— 只有认这条文案才能把整轮救回来。
 *
 * ⚠️ 识别口径必须**窄**：要求文案同时出现 `reasoning_effort` 与「不支持」短语。
 * 单模型路径仍按原样把 400 交回客户端：用户点名了这一家，换家等于替他改需求。
 */
export function isReasoningEffortUnsupportedError(message: string | undefined): boolean {
  if (!message) return false
  return /reasoning[_ ]effort/i.test(message)
    && /(not\s+currently\s+supported|not\s+supported|unsupported|does\s+not\s+support)/i.test(message)
}

/**
 * 哪些状态码值得**换下一家**。
 *
 * 对齐 new-api 的 `AutomaticRetryStatusCodeRanges`（`1xx/3xx/401-407/409-499/
 * 500-503/505-523/525-599` 可重试；`400/408/504/524` 例外），但保留本仓的
 * 「换一家」语义：
 *
 * - **400 不换**：通常是请求本身写错；能力不匹配类 400（工具超限、历史缺
 *   reasoning、强制 tool_choice）由调用方在状态码判定之前单独放行。
 * - **401/403/404/409-499 换**：这些错误在不同账号/渠道之间确实不同
 *   （凭据失效、权限/地区限制、目录漂移、冲突/限流）。旧口径只在 429/5xx
 *   换家，多账号池在第一个 401/403/404 上就整条链终止 —— 这是「错误太多」
 *   最直接的一类来源。
 * - **408/504/524 换，但不重试同一目标**：超时类故障重打同一家只会再赔一次
 *   等待；换一家才有意义（见 {@link isSameTargetRetryableStatus}）。
 * - 无状态码（网络错误、DNS、连接重置）继续换。
 */
export function isFailoverEligibleStatus(status?: number): boolean {
  if (status === undefined) return true
  if (status === 400) return false
  if (status === 408) return true
  if (status >= 401 && status <= 407) return true
  if (status >= 409 && status <= 499) return true
  return status >= 500 && status <= 599
}

/**
 * 同一个目标是否值得**原地重试**（不换家）。
 *
 * 与 {@link isFailoverEligibleStatus} 分开的原因：4xx 换家有意义（另一家的
 * 凭据/目录不同），但原地重试同一条请求没有意义；408/504/524 则是「换家有用、
 * 原地重试只会再等一遍」。`undefined`（网络错误）原地重试一次仍可能自愈。
 */
export function isSameTargetRetryableStatus(status?: number): boolean {
  if (status === undefined) return true
  if (status === 408 || status === 504 || status === 524) return false
  return status >= 500 && status <= 599
}

/**
 * 这次失败是否该记到**账号**头上。
 *
 * 旧实现（`chat.ts`）对任何 `>=400` 都 `markAccountFailed`：客户端自己写错一个
 * 400、点名一个不存在的 404，都会把健康账号打进失败池，后续请求被无理由绕开。
 * 只有「换账号可能解决」的故障才记账：401/403（凭据/权限）、408/429（超时/限流）、
 * 5xx、网络错误；400/404/409-499 的其余状态与 422 不记。
 */
export function isAccountFaultStatus(status?: number): boolean {
  if (status === undefined) return true
  return status === 401
    || status === 403
    || status === 408
    || status === 429
    || (status >= 500 && status <= 599)
}

/** 账号本身有故障：状态码属于上一条，或文案命中「要人处理」的凭据/风控类。 */
export function isAccountFault(status: number | undefined, message: string | undefined): boolean {
  return isAccountFaultStatus(status) || isChannelHumanRequiredFailure(message)
}

/**
 * 同一供应商换 Key 是否可能有用。
 *
 * 只有账号级故障（凭据/权限/超时/限流/5xx/网络）才轮换 Key。404 是模型目录问题，
 * 同一供应商的其它 Key 看到的目录通常一样，轮换只是白打；这类交给跨供应商的
 * 换家循环。
 */
export function isSameProviderRotationStatus(status?: number): boolean {
  return isAccountFaultStatus(status)
}

/**
 * 聚合条目（keyless 公共池）返回的 400，且错误体为空或只有 `Unknown error`：
 * 这是**这一家**拒绝，不是请求本身写错（OVH 2026-11-02 实测：同一路由里
 * OpenCode 404 后命中 OVH 400 Unknown error，链在第二家直接终止）。
 *
 * ⚠️ 只对 `type === 'aggregate'` 生效：账号渠道/custom 的 400 仍按普通 4xx
 * 直接失败 —— 那两类通常是请求本身有问题，或用户点名了那一家。
 */
export function isOpaqueAggregateBadRequest(
  status: number | undefined,
  message: string | undefined,
  providerType: string | undefined,
): boolean {
  if (status !== 400 || providerType !== 'aggregate') return false
  const text = (message ?? '').trim()
  return text === '' || /^unknown error$/i.test(text)
}

/** 自动路由候选耗尽时的收口形状（chat 路由直接拿去回客户端）。 */
export interface AutoExhaustedResponse {
  status: 503
  type: 'service_unavailable_error'
  code: 'no_available_model'
  message: string
}

/**
 * 自动路由的最后一个候选报 404 时，不能把「候选供不了」原样透传成
 * 「这条路由/模型不存在」：客户端（Claude 等）会把 404 当模型被删，后续
 * 整段会话不再请求。路由确实存在时统一收口成可重试的 503。
 *
 * ⚠️ 只在**确实试过多家**（`attempts > 1`）时收口。普通上游 404 在第一家就是
 * fatal（「客户端写了个不存在的模型」），原样透传才准确 —— 见
 * `tests/routes/proxy-routes-catalog-404.test.ts` 的窄判据。
 */
export function autoExhaustedResponse(
  status: number | undefined,
  routeName: string,
  lastError: string | undefined,
  attempts: number,
): AutoExhaustedResponse | null {
  if (status !== 404 || attempts <= 1) return null
  return {
    status: 503,
    type: 'service_unavailable_error',
    code: 'no_available_model',
    message: `Route '${routeName}' exhausted all candidates (last: ${lastError ?? '404'})`,
  }
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
 *   在生成**之前**拒绝，几乎不烧积分，且换家命中率真实存在 —— 不受基础上限约束，
 *   由**整条候选链走完**与墙钟预算 {@link AUTO_WALL_CLOCK_BUDGET_MS} 收口。
 *   2026-11-04 起候选链不再在选号阶段裁成「基础上限 + 3 家」，所以这里没有另一个
 *   家数常量了：链有多长，可恢复类就能换多长，最长不超过墙钟。
 *
 * ⚠️ 识别口径必须**窄**（与 {@link isToolOverflowError} 同一纪律）。渠道错误
 * 跨桥时只带 `message`/`status`（bridge.ts 只透传这两个字段，LlmError 的 code
 * 到不了宿主），所以只能按文案匹配 —— 关键词取各家适配器实际抛出的原文：
 * - 排队：`ModelQueuedError` 的 message 是「模型排队中」；排队 JSON 体
 *   （`10605`/`isQueued`）可能原样出现在 message 里；
 * - 额度：qoder 110「Billing daily count exceeded」、buddy「所有账号均受限」、
 *   BazaarLink「requires more credits … can only afford 0」、其余上游的 quota/credits
 *   字样（错误文案里出现 quota/credits 几乎必然是配额问题，正常内容不会进 error 字段）。
 */
/**
 * 「额度用尽」类文案：积分/credits/余额类上游（BazaarLink 的 402 等）。
 *
 * 口径要窄：光看 `credit` 这个词不够（"credit card" 与额度毫无关系），
 * 必须同时出现「不足」语义。所以拆成两支：
 * - `不足词 + credits`：insufficient credits / not enough credits / out of credits /
 *   exhausted credits / requires more credits …
 * - `can only afford N`：BazaarLink 402 的原话（2026-11-03 用户报障）。
 */
const CREDIT_EXHAUSTED_PATTERN = new RegExp(
  [
    '(insufficient|not\\s+(?:have\\s+|has\\s+)?enough|out\\s+of|exhausted|depleted'
      + '|no\\s+more|requires?\\s+more|lack(?:s|ing)?|too\\s+low)'
      + '\\s*[\\w-]*\\s*credits?',
    'credits?\\s+(?:balance\\s+)?(?:is\\s+)?(?:exhausted|depleted|insufficient|empty|zero|too\\s+low)',
    'credit\\s+balance\\s+(?:is\\s+)?(?:too\\s+low|insufficient|exhausted|empty|zero)',
    'can\\s+only\\s+afford',
  ].join('|'),
  'i',
)

export function isRecoverableChannelFailure(message: string | undefined): boolean {
  if (!message) return false
  return /排队|isQueued|10605/.test(message)
    || /quota/i.test(message)
    || CREDIT_EXHAUSTED_PATTERN.test(message)
    || /billing\s+daily\s+count\s+exceeded/i.test(message)
    || /所有账号均受限/.test(message)
    // 渠道包在**发请求之前**就报「该模型全部启用账号都在限流中」（`index.ts` 的
    // `QUOTA_EXCEEDED`，状态码落成 502）。它自己写着「无需重新登录」，所以这是
    // 定时限流而不是人工介入：零上游调用、不烧积分，换下一家就能成。
    // 按普通 502 计入账号故障上限的话，三家限流就把整条链判死，而池里其余候选
    // 其实都活着（2026-11-01 远程日志：这一类在真流量里排第 2 多）。
    || /均在限流中|频率超限/.test(message)
    // opencode 匿名槽的同义文案：「所有通道对该模型均受限（…(free_usage_limit)）」。
    // 与 buddy 的「所有账号均受限」同义，只是多了「通道」二字 —— 原先只认
    // 「所有账号均受限」这一支，于是它被当成普通 502 账号故障，白白吃掉
    // 账号故障上限的一家（2026-11-03 DSH 那笔 402 的链就是这样在第 3 家收手的）。
    || /所有通道.*均受限/.test(message)
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

/**
 * 换家的墙钟总预算（毫秒）：整条候选链耗掉这么多时间就不再继续换家。
 *
 * 自 2026-11-04 起它是可恢复类失败的**唯一**家数之外的收口：候选链不再在选号阶段
 * 裁短（原先的 `maxAttempts + 3` 上限把几百个模型的池折叠成 6 家），所以一条全在
 * 排队/额度里的长链最坏会跑到这里为止，而不是跑到某个家数上限。
 */
export const AUTO_WALL_CLOCK_BUDGET_MS = 90_000

/** 上游文案进日志时的截断长度（一条日志里最多 20 次失败，各 200 字符封顶）。 */
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
  /** 只有聚合条目会把「不透明 400」当可换家；缺省按账号渠道处理 */
  providerType?: string
}): AutoAttemptFailure {
  const reason = (input.error ?? '').trim().slice(0, ATTEMPT_REASON_MAX_CHARS)
  const kind: AutoAttemptFailure['kind'] = isToolOverflowError(input.error)
    || isMissingReasoningHistoryError(input.error)
    || isChannelModelUnavailableError(input.error)
    || isUpstreamCatalogMissError(input.error)
    || isForcedToolChoiceUnsupported(input.error)
    // 这两条漏在这里就会让日志说谎：换家循环实际往下试了，`kind` 却记成 `fatal`
    // （本函数的口径就是「kind 必须与当时实际走的分支一致」）。
    || isContextOverflowError(input.error)
    || isReasoningEffortUnsupportedError(input.error)
    ? 'capability'
    : isChannelHumanRequiredFailure(input.error)
      // 风控类落的是 400，按纯状态码会被记成 `fatal`，而换家循环实际是**继续往下试**
      // （见 forwarder 的人工介入分支）—— 日志里的 kind 必须与当时走的分支一致。
      ? 'failover'
      : isOpaqueAggregateBadRequest(input.status, input.error, input.providerType)
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
  /** 总尝试上限（整条候选链的长度；选号阶段不再裁短） */
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
  | { kind: 'error'; message: string; details?: StreamErrorFrame }

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
  stream: Readable,
  firstChunk: Buffer | string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
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

    /** 解析一行 data 载荷；true=内容帧，错误帧=结构化对象，null=跳过。 */
    const inspectDataLine = (payload: string): true | StreamErrorFrame | null => {
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
        return extractStreamErrorFrame(record) ?? { message: String(record.error) }
      }
      if ('choices' in record) return true
      return null
    }

    const inspectText = (): true | StreamErrorFrame | null => {
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
        if (verdict !== null && verdict !== true) {
          finish({ kind: 'error', message: verdict.message, details: verdict })
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
      const verdict = text !== '' ? inspectText() : null
      finish(verdict !== null && verdict !== true
        ? { kind: 'error', message: verdict.message, details: verdict }
        : { kind: 'ok', buffered })
    }
    const onClosed = (): void => {
      // 流在产出内容帧之前就结束：错误帧流（只报错就关）或空流，都按失败处理。
      const verdict = text !== '' ? inspectText() : null
      if (verdict !== null && verdict !== true) {
        finish({ kind: 'error', message: verdict.message, details: verdict })
      } else {
        finish({ kind: 'error', message: '渠道流在产出任何内容之前就结束了' })
      }
    }

    timer = setTimeout(() => finish({ kind: 'ok', buffered }), timeoutMs)
    stream.once('readable', onData)
    stream.once('error', onError)
    stream.once('end', onClosed)
    stream.once('close', onClosed)
    // 首块可能已经带上了完整判断依据，先查一次再挂监听。
    {
      const verdict = inspectText()
      if (verdict !== null && verdict !== true) {
        finish({ kind: 'error', message: verdict.message, details: verdict })
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
  stream: Readable,
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
