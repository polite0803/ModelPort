import type { RequestStreamTrace } from '../../shared/types'

/**
 * 首块之后判出来的失败，是否应当撤销这一轮的粘性锚点。
 *
 * 粘性锚点在响应头阶段就写下了（`rememberRoute`），而「这一轮其实不健康」要到
 * 流结束才算得出来。原先只认「内容重复退化」一种：协议成功、内容塌掉的会话会被
 * 一直钉在同一家（2026-11-03 那个会话 24 行里 23 行 `reason=sticky`）。
 *
 * 2026-11-06 WSL 日志暴露了同一形状的第二类：`qodercn/dmodel` 在 09:13、09:15、
 * 09:19 连续三笔都是 `reason:"sticky"`，每笔都在首块之后静默 60s 被看门狗中止
 * （`streamTrace.totalMs` 132s/182s/156s）。超时已经通过 `recordStreamOutcome`
 * 计入账号失败，但锚点没撤，于是下一轮又把会话送回同一家 —— 用户连续等了三次
 * 两三分钟。上游流错误（`endReason === 'error'`）同理。
 *
 * 客户端主动断开（`client_gone`）不算失败，按 AGENTS 的口径既不加分也不扣分，
 * 因此不撤锚点。
 *
 * 2026-11-12 补上第三类：`openrouter/free` 对 Codex 的一发返回 176 KB、`[DONE]`
 * 正常收尾、正文与工具调用皆空（1108 个 output token 全是思考）。客户端把这一轮
 * 当「已完成」就地结束，界面停在上一句「先确认当前 shell 位置」的承诺上，而日志
 * 记的是 `success` —— 锚点不撤、Bandit 记胜，下一轮继续派给同一台空转机。
 *
 * 2026-11-12 第 2 条再补第六类：**首字慢于池内 p75 的完成流**。用户的第一条
 * 反馈就是「走路由比直连慢一个数量级」，而当时的机制恰好让慢模型永远不让位
 * （首字延迟只是封顶 0.2 的罚分，硬粘性无条件提前）。门槛由选路阶段算好
 * 传进来（`AutoRouteDecision.latencyGateMs`），两条判据同源，不各算一遍。
 */
export function shouldRevokeStickyAfterStream(
  trace: Pick<RequestStreamTrace, 'endReason' | 'repetition' | 'emptyTurn' | 'firstTokenMs'>,
  truncated = false,
  latencyGateMs?: number,
  /**
   * 这一轮的服务者是**换家换来的**（`auto.attempts > 1`）。见第七类：
   * 首选没答上来、替补只给了一句正文就收尾时，不该把会话钉在替补上。
   */
  servedByFallback = false,
): boolean {
  // 第五类：被上游输出上限截断（`finish_reason=length`）且客户端没给上限。
  // Codex 把这一轮读成 `response.incomplete (max_output_tokens)` 并**就地结束
  // 任务**；锚点不撤的话，下一轮又把同一个会话送回同一家，用户每轮都读到同一句
  // Incomplete（2026-11-12 现网：103 条 Codex 记录的 `maxTokens` 全为空；日志里
  // 唯一一条 `length` 是 `raccoon/sn-sensenova-6-8-flash-lite`，completion 3769
  // 时被掐断）。
  //
  // 判据与 `recordStreamOutcome` 里那条 degraded 完全同源，由调用方算好传进来：
  // 「客户端自己点了上限」是显式截断，不撤、不罚。
  if (truncated) return true
  if (trace.endReason === 'timeout' || trace.endReason === 'error') return true
  return trace.repetition?.degraded === true
    || isEmptyTurnAfterStream(trace)
    || isAnnouncedStopAfterStream(trace)
    || isSlowTurnAfterStream(trace, latencyGateMs)
    || (servedByFallback && isProseOnlyStopAfterStream(trace))
}

/**
 * 渠道包合成的「本步不完整」错误码（`openai-gateway/stream.ts` 的投影出口）。
 *
 * 七种与输出上限无关的条件（工具参数残缺、无名调用被丢、连接被掐断…）此前一律
 * 折成 `finish_reason:'length'`，客户端读到 `incomplete/max_output_tokens` 就
 * 就地结束回合。现在它们带成因走错误帧，码就是这个 —— 它是**模型级**缺陷，
 * 不是账号容量故障，也不是上游输出上限。
 */
export const INCOMPLETE_STEP_CODE = 'incomplete_step'

/**
 * 模型级退化判据 —— 架构 A 的熔断票来源（2026-11-13）。
 *
 * 只有「这个模型自己没把活干完」的五类算在内：内容重复、空转、宣布即停、只说话
 * 不做事、合成不完整。截断（第五类）是上游输出上限、慢首字（第六类）是排队，
 * 两者都可能只发生在这一次，换掉模型并不比留在原地更正确 —— 它们只撤锚点，
 * 不上熔断票。
 *
 * 返回原因就是为了让日志能回答「这个模型为什么被跳过」，而不是只留一个布尔值。
 */
export function modelQualityDegradation(
  trace: Pick<RequestStreamTrace, 'endReason' | 'repetition' | 'emptyTurn'>,
  servedByFallback = false,
  /** 流内错误帧的 `code`（直通路径扫出来的那一个）。 */
  errorCode?: string | null,
): 'repetition' | 'empty-turn' | 'announced-stop' | 'prose-only-stop' | 'incomplete-step' | undefined {
  if (errorCode === INCOMPLETE_STEP_CODE) return 'incomplete-step'
  if (trace.repetition?.degraded === true) return 'repetition'
  if (isEmptyTurnAfterStream(trace)) return 'empty-turn'
  if (isAnnouncedStopAfterStream(trace)) return 'announced-stop'
  if (servedByFallback && isProseOnlyStopAfterStream(trace)) return 'prose-only-stop'
  return undefined
}

/**
 * 第七类（2026-11-13 现网 `chatcmpl-mwdt3j2s-d8em3q`）：**换家之后替补只说话、不做事**。
 *
 * 那一轮形状：粘性把会话放在 `minimax/MiniMax-M3.1-Flash`，它在 20s 首块切片内
 * 没产出任何字节（504），循环换到 `loomy/spark-x2.6`；替补 29s 才吐首字，正文 35 个
 * 字符、零工具调用、`finish_reason=stop`，客户端读到「一句计划」就结束了回合。
 * 三道既有判据全放过它：有正文（③ 不成立）、只有一行（去重率 `too_short`）、
 * 正文以「。」收尾（④ 只认冒号）。
 *
 * **只在换家来的那一轮判**：一句话正文在单轮里无法与「任务正常收尾」区分 ——
 * 后者同样是零工具调用、同样以句号结束，把它判退化会罚到每一次成功的收尾。
 * 但「首选没答上来、替补给了一句就停」有额外的信息量：池子没被试对。这一格
 * 不罚账号、不进 AIMD/Bandit，只**撤锚点**，让下一轮重新排序 —— 与第六类同口径。
 */
export function isProseOnlyStopAfterStream(
  trace: Pick<RequestStreamTrace, 'endReason' | 'emptyTurn'>,
): boolean {
  if (trace.endReason !== 'done') return false
  const reading = trace.emptyTurn
  if (reading === undefined) return false
  return reading.toolsOffered === true
    && reading.toolCallDeltas === 0
    && reading.contentChars > 0
}

/**
 * 第六类退化：「协议完成，但这第一字等得太久」。
 *
 * 只在 `done` 上判，与空回合/宣布即停止同一口径：`client_gone` 是客户端主动走
 * （既不加分也不扣分），`timeout` / `error` 上面已经撤了。门槛是选路阶段算的
 * 池内 p75 —— 绝对毫秒数没法跨上游通用（直连 p50 1.9s、路由 p50 15.3s），
 * 而 p75 的含义是「慢于这一池四分之三的候选」。
 */
export function isSlowTurnAfterStream(
  trace: Pick<RequestStreamTrace, 'endReason' | 'firstTokenMs'>,
  latencyGateMs: number | undefined,
): boolean {
  if (latencyGateMs === undefined) return false
  if (trace.endReason !== 'done') return false
  return trace.firstTokenMs !== undefined && trace.firstTokenMs > latencyGateMs
}

/**
 * 「协议完成、内容空转」的判据：流正常收尾（`done`）、客户端本轮带了工具，
 * 却既没有正文也没有工具调用。
 *
 * 只在 `done` 上判：`client_gone` / `timeout` / `error` 的零内容是**被掐掉**造成的，
 * 不是模型没东西可给，按既有口径那些既不加分也不扣分。
 */
export function isEmptyTurnAfterStream(
  trace: Pick<RequestStreamTrace, 'endReason' | 'emptyTurn'>,
): boolean {
  return trace.endReason === 'done' && trace.emptyTurn?.empty === true
}

/**
 * 「宣布要做、然后就地结束」的判据 —— 第四类退化（2026-11-12 现网）。
 *
 * `codex` 线路的强候选全部不可用（cline 的 Claude Opus 全系 402 额度用尽、
 * ppio/siliconflow 余额不足、bailian 欠费、comate 限额、opencode_go 无订阅），
 * 于是会话被粘在 `cline/nvidia/nemotron-3.5-lightning-free` 上。那一轮它连发三句
 * 「现在我将修改 `UiModeSelector.kt`：」「首先，让我看一下 appearanceSections()
 * 的当前结构：」，`finish_reason=stop`、84 个 output token、**零工具调用**，
 * 回合就地结束 —— 用户读到的就是「只承诺不执行」。
 *
 * 为什么前两类盖不住它：去重率要 12 行才有得判（这轮 1 行，`notJudged: too_short`）；
 * 空回合判据要**正文字符为 0**（这轮有 84 token 正文）。两个判据都算它健康，于是
 * 锚点不撤、Bandit 记胜，下一轮继续派给同一台 —— 这正是「为什么连着问三次都停」
 * 的机制，不是模型单次表现问题。
 *
 * 只在 `done` 上判，与空回合同一口径。误判的代价是**撤一次粘性**（换一家重派），
 * 不剔除候选、不记账号失败，所以判据取四条同时成立：本轮给了工具、零工具调用、
 * 有正文、正文以冒号收尾。
 */
export function isAnnouncedStopAfterStream(
  trace: Pick<RequestStreamTrace, 'endReason' | 'emptyTurn'>,
): boolean {
  return trace.endReason === 'done' && trace.emptyTurn?.announcedStop === true
}
