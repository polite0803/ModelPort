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
 */
export function shouldRevokeStickyAfterStream(
  trace: Pick<RequestStreamTrace, 'endReason' | 'repetition'>,
): boolean {
  if (trace.endReason === 'timeout' || trace.endReason === 'error') return true
  return trace.repetition?.degraded === true
}
