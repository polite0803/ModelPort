/**
 * 压缩后的前缀预热判定。
 *
 * 实测（2026-11-20，`opencode_go/deepseek-v4.1-flash` 同一会话逐轮）：
 *
 *   turn 87  input=159978 cached=159872  99.9%
 *   turn 88  input=185789 cached=0        0.0%   ← 客户端把整段历史发去生成摘要
 *   turn 89  input=28910  cached=4480    15.5%   ← 压缩完成，前缀变了
 *   turn 90  input=44082  cached=28800   65.3%   ← 新前缀逐步变长，每轮重读
 *   turn 91  输入 46103 命中 42112 91.3%
 *
 * 压缩本身那次请求无法命中（它的输入与上一轮不同），这是压缩的固有代价；但
 * **压缩之后的前缀**在头几轮里每轮重读一遍，这部分是可以省掉的：压缩产物一旦
 * 出现，用同一份前缀发一次最小请求把它写进缓存，后续轮次就直接命中。
 *
 * 这里只做判定，不做网络调用 —— 发不发、发什么由调用方决定，便于单测与关停。
 */

/** 判定「这一轮之后发生了压缩」需要的最小输入落差比例。 */
export const COMPACTION_SHRINK_RATIO = 0.5
/** 压缩后输入低于这个量时不值得预热：缓存写入门槛通常在这个量级以上。 */
export const WARM_MIN_TOKENS = 8_000
/** 同一条会话两次预热之间的最短间隔，避免连续压缩把请求数打上去。 */
export const WARM_COOLDOWN_MS = 5 * 60 * 1_000

export interface CompactionReading {
  /** 上一轮发给上游的 prompt token 数。 */
  previousPromptTokens: number
  /** 这一轮的 prompt token 数。 */
  currentPromptTokens: number
}

/**
 * 这一轮是不是「压缩之后的第一轮」。
 *
 * 判据只有一条：输入比上一轮少了一半以上，且上一轮本身不小。压缩是客户端行为，
 * 它把长历史换成一份摘要，输入随之骤降 —— 这是唯一可靠的信号，不去猜内容。
 */
export function isPostCompactionTurn(reading: CompactionReading): boolean {
  const { previousPromptTokens, currentPromptTokens } = reading
  if (previousPromptTokens < WARM_MIN_TOKENS) return false
  if (currentPromptTokens <= 0) return false
  return currentPromptTokens < previousPromptTokens * COMPACTION_SHRINK_RATIO
}

export interface WarmDecision {
  warm: boolean
  reason: 'not_compaction' | 'too_small' | 'cooldown' | 'unsupported_cache' | 'disabled' | 'ok'
}

/**
 * 决定是否预热。
 *
 * `cacheMode` 只认 `implicit-prefix` 与 `explicit-breakpoints` 两种：上游没有可验证
 * 的缓存能力时（`unknown`），发一次请求既不能证明缓存被写入，也只是白花额度。
 */
export function shouldWarmAfterCompaction(
  reading: CompactionReading,
  options: {
    cacheMode: 'implicit-prefix' | 'explicit-breakpoints' | 'unknown'
    enabled: boolean
    lastWarmAt?: number
    now?: number
  },
): WarmDecision {
  if (!options.enabled) return { warm: false, reason: 'disabled' }
  if (options.cacheMode === 'unknown') return { warm: false, reason: 'unsupported_cache' }
  if (!isPostCompactionTurn(reading)) return { warm: false, reason: 'not_compaction' }
  if (reading.currentPromptTokens < WARM_MIN_TOKENS) return { warm: false, reason: 'too_small' }
  const now = options.now ?? Date.now()
  if (options.lastWarmAt !== undefined && now - options.lastWarmAt < WARM_COOLDOWN_MS) {
    return { warm: false, reason: 'cooldown' }
  }
  return { warm: true, reason: 'ok' }
}

/**
 * 预热请求体：**逐字复用**这一轮的 messages 前缀，只把输出压到最小。
 *
 * 缓存按前缀字节匹配，所以前缀必须与真实请求一致 —— 多一句说明、少一条消息都会
 * 让写入的缓存对不上后续轮次。`max_tokens` 取 1：这次调用只为了把前缀写进上游
 * 缓存，不需要它产出内容。
 */
export function warmRequestOf<T extends Record<string, unknown>>(body: T): T {
  const { tools: _tools, tool_choice: _toolChoice, parallel_tool_calls: _parallel, ...rest } = body
  return { ...rest, max_tokens: 1, stream: false } as unknown as T
}