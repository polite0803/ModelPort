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
 */
export function shouldRevokeStickyAfterStream(
  trace: Pick<RequestStreamTrace, 'endReason' | 'repetition' | 'emptyTurn'>,
): boolean {
  if (trace.endReason === 'timeout' || trace.endReason === 'error') return true
  return trace.repetition?.degraded === true
    || isEmptyTurnAfterStream(trace)
    || isAnnouncedStopAfterStream(trace)
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
