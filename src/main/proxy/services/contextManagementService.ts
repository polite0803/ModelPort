/**
 * Context Management Service
 * Manages conversation context with two deletion-only strategies:
 * 1. Sliding Window - Keep recent N messages
 * 2. Token Limit - Truncate by token count
 *
 * A third strategy (Summary Compression) was retired on 2026-11-03: it made its own model call with
 * a gateway-written prompt and re-inserted the result as a `system` turn, replacing user history.
 * Trimming is a shape transform; writing prose into the conversation is not, and the ruling in
 * `docs/AGENTS-full.md` §Gateway-Authored Text allows only the first.
 */

import type { ChatMessage } from '../types'

/**
 * Sliding Window Strategy Configuration
 */
export interface SlidingWindowConfig {
  enabled: boolean
  maxMessages: number
}

/**
 * Token Limit Strategy Configuration
 */
export interface TokenLimitConfig {
  enabled: boolean
  maxTokens: number
}

/**
 * Context Management Configuration
 */
export interface ContextManagementConfig {
  enabled: boolean
  strategies: {
    slidingWindow: SlidingWindowConfig
    tokenLimit: TokenLimitConfig
  }
  executionOrder: ('slidingWindow' | 'tokenLimit')[]
  /**
   * Providers whose traffic may be trimmed; absent or empty = trim nothing.
   *
   * A head cut rewrites the oldest context bytes, which invalidates the upstream
   * prefix cache for every later turn. The 2026-11-10 regression (PLAN-prompt-cache
   * §9.12) proved this costs 60–98% measured hit rates on channels that cache —
   * so trimming is opt-in per provider, never "whoever happens to be enabled".
   */
  channelIds?: string[]
}

/**
 * Strategy Execution Result
 */
export interface StrategyResult {
  messages: ChatMessage[]
  originalCount: number
  processedCount: number
  strategyName: string
  trimmed: boolean
}

/**
 * Context Processing Result
 */
export interface ContextProcessResult {
  messages: ChatMessage[]
  originalCount: number
  finalCount: number
  strategyResults: StrategyResult[]
}

/**
 * Default Configuration
 */
export const DEFAULT_SLIDING_WINDOW_CONFIG: SlidingWindowConfig = {
  enabled: true,
  maxMessages: 20,
}

export const DEFAULT_TOKEN_LIMIT_CONFIG: TokenLimitConfig = {
  enabled: false,
  maxTokens: 4000,
}

export const DEFAULT_CONTEXT_MANAGEMENT_CONFIG: ContextManagementConfig = {
  enabled: false,
  strategies: {
    slidingWindow: DEFAULT_SLIDING_WINDOW_CONFIG,
    tokenLimit: DEFAULT_TOKEN_LIMIT_CONFIG,
  },
  executionOrder: ['slidingWindow', 'tokenLimit'],
}

/**
 * Fold a stored (possibly older) config onto the shipped defaults.
 *
 * The `summary` branch is dropped on purpose: `data.json` written before 2026-11-03 carries
 * `strategies.summary` and names `summary` in `executionOrder`, and leaving those in place would put
 * a retired switch back in front of the management API and the settings panel.
 */
export function normalizeContextManagementConfig(
  config: Partial<ContextManagementConfig> = {}
): ContextManagementConfig {
  const merged: ContextManagementConfig = {
    ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
    ...config,
    strategies: {
      ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG.strategies,
      ...(config as { strategies?: Record<string, unknown> }).strategies,
    } as ContextManagementConfig['strategies'],
  }
  delete (merged.strategies as unknown as Record<string, unknown>).summary
  merged.executionOrder = (config.executionOrder ?? DEFAULT_CONTEXT_MANAGEMENT_CONFIG.executionOrder)
    .filter((name: string) => name === 'slidingWindow' || name === 'tokenLimit') as ('slidingWindow' | 'tokenLimit')[]
  // Trim scope is opt-in per provider: absent/malformed collapses to "trim
  // nothing", never to "trim everyone" — the 2026-11-10 regression showed what
  // the default-everyone shape costs (PLAN-prompt-cache §9.12).
  merged.channelIds = Array.isArray(config.channelIds)
    ? [...new Set(config.channelIds.map(id => String(id).trim()).filter(id => id.length > 0))]
    : []
  return merged
}

/**
 * Whether trimming may run for this provider.
 *
 * `channelIds` names the providers whose traffic may pay the head-cut cost:
 * trimming rewrites the oldest context bytes, which invalidates the upstream
 * prefix cache for every later turn — measured 60–98% hits on the channels we
 * accidentally trimmed on 2026-11-10 (PLAN-prompt-cache §9.12). Absent or empty
 * = trim nothing, whatever `enabled` says.
 */
export function trimAppliesToProvider(
  config: Pick<ContextManagementConfig, 'enabled' | 'channelIds'>,
  providerId: string
): boolean {
  if (!config.enabled) return false
  return (config.channelIds ?? []).some(id => id.trim() === providerId)
}

/**
 * Estimate token count for a message
 * Simple estimation: 1 token ≈ 3 characters (rough approximation)
 */
function estimateTokens(content: string | ChatMessage['content']): number {
  if (content === null || content === undefined) {
    return 0
  }

  if (typeof content === 'string') {
    return Math.ceil(content.length / 3)
  }

  if (Array.isArray(content)) {
    return content.reduce((total, part) => {
      if (part.type === 'text' && part.text) {
        return total + Math.ceil(part.text.length / 3)
      }
      return total
    }, 0)
  }

  return 0
}

/**
 * Get message content as string
 */
function getMessageContent(message: ChatMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter(part => part.type === 'text' && part.text)
      .map(part => part.text)
      .join('\n')
  }
  return ''
}

/**
 * Repair the two failure modes a head cut introduces, without writing a word
 * of its own:
 *
 * 1. **Tool-group split** — a kept tail that starts with `tool` results has lost
 *    the `assistant(tool_calls)` that produced them. OpenAI-shaped upstreams
 *    reject that pairing ("messages with role 'tool' must be a response to a
 *    preceding message with 'tool_calls'"), and the channel gateways turn it
 *    into a 400 the client reads as its own mistake. Pull the requesting
 *    assistant back in (plus any sibling tool results) so the group stays whole.
 * 2. **Lost task statement** — when the window no longer covers the first
 *    non-system `user` message, keep it at the front. Trimming should cost old
 *    tool output, never "what the user actually asked for".
 *
 * `kept` must be a contiguous suffix of `nonSystem` (both strategies build it
 * that way); the index math below relies on it.
 */
function keepToolGroupAndTask(nonSystem: ChatMessage[], kept: ChatMessage[]): ChatMessage[] {
  if (kept.length === 0) return kept

  let groupStart = nonSystem.length - kept.length
  if (kept[0]?.role === 'tool') {
    while (groupStart > 0 && nonSystem[groupStart - 1]?.role === 'tool') groupStart -= 1
    const parent = nonSystem[groupStart - 1]
    const toolCalls = (parent as { tool_calls?: unknown[] } | undefined)?.tool_calls
    if (parent?.role === 'assistant' && Array.isArray(toolCalls) && toolCalls.length > 0) {
      groupStart -= 1
    }
  }

  const withGroup = nonSystem.slice(groupStart)
  const task = nonSystem.find(message => message.role === 'user')
  if (task !== undefined && !withGroup.includes(task)) return [task, ...withGroup]
  return withGroup
}

/** The first user turn — the request the whole conversation exists for. */
function firstUserMessage(nonSystem: ChatMessage[]): ChatMessage | undefined {
  return nonSystem.find(message => message.role === 'user')
}

/**
 * Sliding Window Strategy
 * Keeps the most recent N messages, always preserving system messages
 */
export class SlidingWindowStrategy {
  private config: SlidingWindowConfig

  constructor(config: SlidingWindowConfig = DEFAULT_SLIDING_WINDOW_CONFIG) {
    this.config = { ...DEFAULT_SLIDING_WINDOW_CONFIG, ...config }
  }

  execute(messages: ChatMessage[]): StrategyResult {
    const originalCount = messages.length

    if (!this.config.enabled || originalCount <= this.config.maxMessages) {
      return {
        messages,
        originalCount,
        processedCount: originalCount,
        strategyName: 'slidingWindow',
        trimmed: false,
      }
    }

    const systemMessages = messages.filter(msg => msg.role === 'system')
    const nonSystemMessages = messages.filter(msg => msg.role !== 'system')

    const maxNonSystemMessages = Math.max(0, this.config.maxMessages - systemMessages.length)
    const kept = maxNonSystemMessages === 0
      ? []
      : nonSystemMessages.slice(-maxNonSystemMessages)
    // 非 system 全被裁光时保留最新一条：上游会把 `messages: []` 读成「你没传
    // 消息」而不是「历史太长」。与 TokenLimitStrategy 同一条不变量 ——
    // 裁剪永远不许把要回答的那句话裁没。
    const rescued = kept.length === 0 && nonSystemMessages.length > 0
      ? [nonSystemMessages[nonSystemMessages.length - 1]]
      : kept
    // 两处断点修复：tool 组被切开（上游 400）、任务原文被切走（模型失焦）。
    const keptNonSystemMessages = keepToolGroupAndTask(nonSystemMessages, rescued)

    const result = [...systemMessages, ...keptNonSystemMessages]

    console.log(
      `[SlidingWindowStrategy] Trimmed from ${originalCount} to ${result.length} messages ` +
        `(system: ${systemMessages.length}, non-system: ${keptNonSystemMessages.length})`
    )

    return {
      messages: result,
      originalCount,
      processedCount: result.length,
      strategyName: 'slidingWindow',
      trimmed: result.length < originalCount,
    }
  }
}

/**
 * Token Limit Strategy
 * Truncates history by token count, always preserving system messages
 */
export class TokenLimitStrategy {
  private config: TokenLimitConfig

  constructor(config: TokenLimitConfig = DEFAULT_TOKEN_LIMIT_CONFIG) {
    this.config = { ...DEFAULT_TOKEN_LIMIT_CONFIG, ...config }
  }

  /**
   * Budget held back for the first user turn when the tail no longer contains it.
   * Reserving here (instead of adding it after the loop) keeps the total near
   * `maxTokens`; the newest message is always kept anyway, so it is not reserved.
   */
  private taskReserve(nonSystemMessages: ChatMessage[]): number {
    const task = firstUserMessage(nonSystemMessages)
    const newest = nonSystemMessages[nonSystemMessages.length - 1]
    if (task === undefined || task === newest) return 0
    return estimateTokens(task.content)
  }

  execute(messages: ChatMessage[]): StrategyResult {
    const originalCount = messages.length

    if (!this.config.enabled) {
      return {
        messages,
        originalCount,
        processedCount: originalCount,
        strategyName: 'tokenLimit',
        trimmed: false,
      }
    }

    const systemMessages = messages.filter(msg => msg.role === 'system')
    const nonSystemMessages = messages.filter(msg => msg.role !== 'system')

    const systemTokens = systemMessages.reduce(
      (total, msg) => total + estimateTokens(msg.content),
      0
    )

    const availableTokens = this.config.maxTokens - systemTokens - this.taskReserve(nonSystemMessages)
    // 最新一条永远保留：裁到「一条都装不下」不是省 token，而是把请求变成
    // 没有要回答的话。账号渠道的网关会直接拒（`messages must be a non-empty
    // array`），内置供应商则回一句离题的话 —— 两种都比超预算的原文更难排查。
    const newestMessage = nonSystemMessages[nonSystemMessages.length - 1]

    if (availableTokens <= 0) {
      const kept = newestMessage === undefined ? [] : [newestMessage]
      const repaired = keepToolGroupAndTask(nonSystemMessages, kept)
      const result = [...systemMessages, ...repaired]
      console.warn(
        `[TokenLimitStrategy] System/task already exceed token limit ` +
          `(${systemTokens} + reserve > ${this.config.maxTokens}); keeping the newest message anyway`
      )
      return {
        messages: result,
        originalCount,
        processedCount: result.length,
        strategyName: 'tokenLimit',
        trimmed: result.length < originalCount,
      }
    }

    const keptNonSystemMessages: ChatMessage[] = []
    let currentTokens = 0

    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemMessages[i]
      const msgTokens = estimateTokens(msg.content)

      if (currentTokens + msgTokens <= availableTokens) {
        keptNonSystemMessages.unshift(msg)
        currentTokens += msgTokens
      } else {
        break
      }
    }

    // 最新一条自己就超预算时上面的循环一条也不留 —— 这时超的只是它，裁掉它
    // 也并不能让请求变短，只会把「压缩」变成「清空」。
    if (keptNonSystemMessages.length === 0 && newestMessage !== undefined) {
      keptNonSystemMessages.push(newestMessage)
      currentTokens = estimateTokens(newestMessage.content)
    }

    const repaired = keepToolGroupAndTask(nonSystemMessages, keptNonSystemMessages)
    const result = [...systemMessages, ...repaired]
    const totalTokens = systemTokens + repaired.reduce((sum, message) => sum + estimateTokens(message.content), 0)

    console.log(
      `[TokenLimitStrategy] Trimmed from ${originalCount} to ${result.length} messages ` +
        `(tokens: ${totalTokens}/${this.config.maxTokens})`
    )

    return {
      messages: result,
      originalCount,
      processedCount: result.length,
      strategyName: 'tokenLimit',
      trimmed: result.length < originalCount,
    }
  }
}

/**
 * Context Management Service
 * Orchestrates the deletion-only context strategies
 */
export class ContextManagementService {
  private config: ContextManagementConfig
  private slidingWindowStrategy: SlidingWindowStrategy
  private tokenLimitStrategy: TokenLimitStrategy

  constructor(config: ContextManagementConfig = DEFAULT_CONTEXT_MANAGEMENT_CONFIG) {
    this.config = normalizeContextManagementConfig(config)
    this.slidingWindowStrategy = new SlidingWindowStrategy(
      this.config.strategies.slidingWindow
    )
    this.tokenLimitStrategy = new TokenLimitStrategy(
      this.config.strategies.tokenLimit
    )
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextManagementConfig>): void {
    this.config = normalizeContextManagementConfig({
      ...this.config,
      ...config,
      strategies: {
        ...this.config.strategies,
        ...(config.strategies || {}),
      },
    })

    this.slidingWindowStrategy = new SlidingWindowStrategy(
      this.config.strategies.slidingWindow
    )
    this.tokenLimitStrategy = new TokenLimitStrategy(
      this.config.strategies.tokenLimit
    )
  }

  /**
   * Process messages through all enabled strategies
   */
  async process(messages: ChatMessage[]): Promise<ContextProcessResult> {
    const originalCount = messages.length
    const strategyResults: StrategyResult[] = []

    if (!this.config.enabled) {
      return {
        messages,
        originalCount,
        finalCount: originalCount,
        strategyResults: [],
      }
    }

    console.log(
      `[ContextManagementService] Processing ${originalCount} messages ` +
        `with order: ${this.config.executionOrder.join(', ')}`
    )

    let currentMessages = [...messages]

    for (const strategyName of this.config.executionOrder) {
      let result: StrategyResult

      switch (strategyName) {
        case 'slidingWindow':
          result = this.slidingWindowStrategy.execute(currentMessages)
          break

        case 'tokenLimit':
          result = this.tokenLimitStrategy.execute(currentMessages)
          break

        default:
          console.warn(`[ContextManagementService] Unknown strategy: ${strategyName}`)
          continue
      }

      strategyResults.push(result)
      currentMessages = result.messages

      if (result.trimmed) {
        console.log(
          `[ContextManagementService] Strategy ${strategyName} trimmed ` +
            `${result.originalCount} -> ${result.processedCount} messages`
        )
      }
    }

    console.log(
      `[ContextManagementService] Final result: ${originalCount} -> ${currentMessages.length} messages`
    )

    return {
      messages: currentMessages,
      originalCount,
      finalCount: currentMessages.length,
      strategyResults,
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ContextManagementConfig {
    return { ...this.config }
  }

  /**
   * Estimate total tokens for messages
   */
  static estimateTotalTokens(messages: ChatMessage[]): number {
    return messages.reduce((total, msg) => total + estimateTokens(msg.content), 0)
  }
}

/**
 * Create default context management service instance
 */
export function createContextManagementService(
  config?: Partial<ContextManagementConfig>
): ContextManagementService {
  return new ContextManagementService(normalizeContextManagementConfig(config))
}
