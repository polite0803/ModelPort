/**
 * 「这一轮的请求体量 vs 这一家的窗口」的唯一算法。
 *
 * 存在的理由：`/v1/models` 广告的是**已公布**窗口的下界，没公布就省略键（不再有
 * 64K 兜底猜测）。于是「装不下」这件事只剩两个可信来源：
 *
 * 1. 候选公布了窗口，估算入量超过它 —— 这是判定，不是上游说出来的；
 * 2. 上游直接回了 context 类错误（`failover.ts::isContextOverflowError`）—— 这是
 *    实测，来源标 `measured`，优先级高于 1。
 *
 * ⚠️ `inputTokensEstimate` 是**估算**：它绝不写进 `usage`，也不参与计费口径。
 * 上游没报 usage 仍然按既有不变量返回 null。
 */

export type ContextFitValue = 'fits' | 'overflow' | 'unknown'

export interface RequestContextReadingInput {
  /** 本次请求的估算入量（token） */
  estimatedTokens: number
  /** 该候选**已公布**的上下文窗口；未公布传 undefined */
  contextWindow?: number
  /** 上游本轮就回了上下文超限 */
  measuredOverflow?: boolean
}

export interface RequestContextReading {
  inputTokensEstimate: number
  /** 已公布的窗口；没公布就省略键，不写猜测值 */
  modelContextWindow?: number
  contextFit: ContextFitValue
  /** 只有实测（上游报错）才有这个标记，判定值不冒充实测 */
  contextFitSource?: 'measured'
}

export function readRequestContextFit(
  input: RequestContextReadingInput
): RequestContextReading {
  const estimatedTokens = Math.max(0, Math.round(input.estimatedTokens))
  const window = typeof input.contextWindow === 'number' && input.contextWindow > 0
    ? input.contextWindow
    : undefined
  if (input.measuredOverflow === true) {
    return {
      inputTokensEstimate: estimatedTokens,
      ...(window === undefined ? {} : { modelContextWindow: window }),
      contextFit: 'overflow',
      contextFitSource: 'measured',
    }
  }
  if (window === undefined) {
    return { inputTokensEstimate: estimatedTokens, contextFit: 'unknown' }
  }
  return {
    inputTokensEstimate: estimatedTokens,
    modelContextWindow: window,
    contextFit: estimatedTokens > window ? 'overflow' : 'fits',
  }
}
