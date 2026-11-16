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
import {
  BLOCK_HASH_LENGTH,
  isAlreadyCompressed,
  makeTruncationMarker,
  makeUntrackedTruncationMarker,
  parseTruncationMarker,
} from '../compression/ccr/markers.ts'
import { getCcrStore } from '../compression/ccr/store.ts'
import { countCjkChars } from '../compression/estimator.ts'

/**
 * Sliding Window Strategy Configuration
 */
export interface SlidingWindowConfig {
  enabled: boolean
  maxMessages: number
  /**
   * Per-provider message window; wins over `maxMessages`, absent = `maxMessages`.
   *
   * This strategy runs before `tokenLimit`, so a small global window binds first and
   * the per-provider token cap never gets to decide. An agent session needs the token
   * budget to be the binding constraint, not a message count tuned for another channel.
   */
  maxMessagesByProvider?: Record<string, number>
}

/**
 * Token Limit Strategy Configuration
 */
export interface TokenLimitConfig {
  enabled: boolean
  maxTokens: number
  /**
   * Per-provider cap; wins over `maxTokens` for the named provider, absent = `maxTokens`.
   *
   * Trim scope is per-provider (`channelIds`) but the cap was one global number, so
   * two channels in the same scope could not be bounded differently: trae must stay
   * small (its credit burn is prompt volume and it cannot get a prefix cache), while
   * an AFP-billed plan pays full input price for every cached token and needs a much
   * larger window to keep an agent session coherent.
   */
  maxTokensByProvider?: Record<string, number>
  /**
   * Providers whose **system block** may be truncated; the value is that block's
   * own cap. Absent = system messages are never touched, which is the historical
   * behaviour and stays the default everywhere.
   *
   * Why per-provider and off by default: the system block is the client's own
   * prompt, so cutting it is a stronger act than dropping old turns. On an agent
   * session it is also large but not dominant — measured 2026-11-16 on a
   * 125,024-token request: ~45,239 tokens of system block (36.2%) against ~66,005
   * in a single tool result. Turning it on globally would rewrite the head of
   * every conversation on every channel, including the ones with a working prefix
   * cache; naming the channel is the same gate `channelIds` already uses.
   */
  maxSystemTokensByProvider?: Record<string, number>
  /**
   * Resolved cap for the system block on the current provider, folded in by
   * `createContextManagementService` from {@link maxSystemTokensByProvider}.
   * Internal: the stored config never carries it.
   */
  systemMaxTokens?: number
  /**
   * Fallback context-window tier, used **only** for a model that declares no
   * window of its own.
   *
   * The serving model's own annotation is the authority (see
   * {@link resolveTrimBudget}); a route can point at any model, so keying the
   * budget on the provider (or on one global number) is wrong for whichever
   * model it was not measured on. This key exists for the remaining case — a
   * model nobody annotated — where the honest answer is still "some window",
   * and a discrete 200K / 400K / 1M choice is easier to reason about than a
   * free-form number.
   *
   * Absent = fall through to `maxTokensByProvider` / `maxTokens`, i.e. the
   * behaviour before tiers existed.
   */
  contextWindowTier?: ContextWindowTier
  /**
   * Per-provider **prompt-cost target**, in tokens — a self-imposed spending
   * limit, not a window.
   *
   * These are two different questions and they must not share a number. The
   * window (`maxTokens` after {@link resolveTrimBudget}) is an upstream fact:
   * sending more is a `context` 400. A cost target is our own choice: `trae`
   * charges by prompt volume and gets no prefix cache, so its burn is roughly
   * linear in tokens and a smaller prompt is simply cheaper — for a model whose
   * window is 1M, trimming to 64K loses history and buys nothing on the wire,
   * but it does buy credits back.
   *
   * Because it is our choice, it may never make the request unserviceable. A
   * target smaller than what must survive (system block + reserved task
   * statements + the newest message) is not a budget but a way to reproduce the
   * 2026-11-16 defect — an unreachable cap that throws the conversation away
   * every turn. Below that floor the window wins and the log says so; see
   * `TokenLimitStrategy::budgetFor`.
   *
   * Absent = no cost gate (the default, and the behaviour before this key
   * existed). There is deliberately no global fallback: `maxTokens` ships as
   * 4000, and reading that as a cost target would truncate every annotated
   * model to 4000 tokens.
   */
  costBudgetByProvider?: Record<string, number>
  /**
   * Resolved cost target for the current provider, folded in by
   * `createContextManagementService` from {@link costBudgetByProvider}.
   * Internal: the stored config never carries it.
   */
  costBudget?: number
}

/**
 * The context-window tiers offered by the console, mirroring the picker a coding
 * agent vendor ships. A *fallback*, never the authority: a model that declares
 * its own window is trimmed to that window, and only an unannotated model falls
 * back to the selected tier.
 */
export const CONTEXT_WINDOW_TIERS = {
  '200k': 200_000,
  '400k': 400_000,
  '1m': 1_000_000,
} as const

export type ContextWindowTier = keyof typeof CONTEXT_WINDOW_TIERS

/** 只认三个合法档位；别的写法（含老配置里的数字）当作没选。 */
export function isContextWindowTier(value: unknown): value is ContextWindowTier {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONTEXT_WINDOW_TIERS, value)
}

/**
 * The trim budget actually used for one request, in priority order:
 *
 * 1. **the serving model's own declared window** — the only number that
 *    describes *this* request;
 * 2. the configured tier (`200k` / `400k` / `1m`) — the fallback for a model
 *    nobody annotated;
 * 3. `maxTokensByProvider[providerId]`, then `maxTokens` — the shape that
 *    existed before tiers, kept so old configs keep behaving identically.
 *
 * Why the model wins over the policy number: a route can point at any model,
 * and one provider routinely serves models of very different windows
 * (volcengine serves both a 128K model and a 1M one). A single configured
 * number therefore cannot be right for all of them — 200K is generous for a
 * 128K model (an upstream context 400 the client reads as its own fault) and
 * stingy for a 1M one.
 *
 * That is exactly the live defect of 2026-11-16: `maxTokensByProvider.
 * volcengine_ark_agent_plan = 65536` against a model declaring 1,000,000. A
 * Claude Code session's own system prompt measured 65,880 tokens, so the cap
 * was unreachable on every turn and the whole conversation was thrown away
 * (the client reported it as "the model keeps switching languages"). A
 * per-provider number cannot express "this model is big and that one is small";
 * a per-model annotation can.
 *
 * An unknown declared window (`undefined`) means "no evidence", never zero — so
 * the tier (or the legacy number) stands in. `maxTokensByProvider` is NOT
 * applied on top of the model window: it is a fallback for the unannotated
 * case, not a ceiling, and stacking it would reproduce the very defect above.
 */
export function resolveTrimBudget(
  config: Pick<TokenLimitConfig, 'maxTokens' | 'maxTokensByProvider' | 'contextWindowTier'>,
  providerId?: string,
  declaredContextWindow?: number
): number {
  if (
    declaredContextWindow !== undefined &&
    Number.isFinite(declaredContextWindow) &&
    declaredContextWindow > 0
  ) {
    return declaredContextWindow
  }
  if (isContextWindowTier(config.contextWindowTier)) {
    return CONTEXT_WINDOW_TIERS[config.contextWindowTier]
  }
  const providerCap = providerId === undefined ? undefined : config.maxTokensByProvider?.[providerId]
  return providerCap ?? config.maxTokens
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
  /** False when the strategy returned the input unchanged (identity or same bytes). */
  trimmed: boolean
  /**
   * True when a message's content was rewritten in place (budget truncation),
   * as opposed to only dropping messages. `processedCount` alone cannot express
   * this: a truncation keeps every message and changes one.
   */
  rewrote?: boolean
}

/**
 * Context Processing Result
 */
export interface ContextProcessResult {
  messages: ChatMessage[]
  originalCount: number
  finalCount: number
  strategyResults: StrategyResult[]
  /**
   * True when any strategy returned **different bytes**, not merely fewer
   * messages.
   *
   * Callers used `finalCount !== originalCount` as the "did anything happen?"
   * test. A budget truncation keeps the message count identical while rewriting
   * one message's content, so that test reported "nothing happened" and the
   * caller forwarded the untruncated request — the cap then held only on paper
   * (2026-11-16: 125,024 tokens against a 65,536 cap, twice).
   */
  changed: boolean
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
  merged.strategies.tokenLimit = {
    ...merged.strategies.tokenLimit,
    maxTokensByProvider: positiveIntByProvider(merged.strategies.tokenLimit.maxTokensByProvider),
    maxSystemTokensByProvider: positiveIntByProvider(
      merged.strategies.tokenLimit.maxSystemTokensByProvider
    ),
    costBudgetByProvider: positiveIntByProvider(merged.strategies.tokenLimit.costBudgetByProvider),
    // 未知档位丢掉整个键，而不是留一个 `undefined` 值：`isContextWindowTier`
    // 在运行期把它当「没选」，落盘时也不该多出一个键。
    ...(isContextWindowTier(merged.strategies.tokenLimit.contextWindowTier)
      ? { contextWindowTier: merged.strategies.tokenLimit.contextWindowTier }
      : { contextWindowTier: undefined }),
  }
  if (merged.strategies.tokenLimit.contextWindowTier === undefined) {
    delete (merged.strategies.tokenLimit as { contextWindowTier?: ContextWindowTier }).contextWindowTier
  }
  // `systemMaxTokens` is a RESOLVED value, never stored state: the override table
  // is the only thing a config file may carry. Stripping it here is what keeps a
  // stale cap from being resolved for one provider and then applied to another.
  delete (merged.strategies.tokenLimit as { systemMaxTokens?: number }).systemMaxTokens
  // Same rule for the cost target: `costBudget` is resolved per request from the
  // table, so a stored one would be a stale number applied to the wrong provider.
  delete (merged.strategies.tokenLimit as { costBudget?: number }).costBudget
  merged.strategies.slidingWindow = {
    ...merged.strategies.slidingWindow,
    maxMessagesByProvider: positiveIntByProvider(merged.strategies.slidingWindow.maxMessagesByProvider),
  }
  return merged
}

/** 按渠道覆盖值只收正有限数：坏值丢弃而不是回落成 0 —— 0 会把历史裁到只剩最新一条。 */
function positiveIntByProvider(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (raw === null || typeof raw !== 'object') return out
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = id.trim()
    const n = Number(value)
    if (key.length > 0 && Number.isFinite(n) && n > 0) out[key] = Math.floor(n)
  }
  return out
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
 * Characters per token for the non-CJK bulk of a message.
 *
 * Deliberately lower than the calibrated 4.0 in `compression/estimator.ts`:
 * this side of the house must over-estimate, because under-estimating means a
 * cap that does not bind. Kept at 3 on purpose — every existing numeric
 * expectation (and the shipped behaviour for Latin traffic) depends on it.
 */
const CHARS_PER_TOKEN_ASCII = 3

/**
 * Characters per token for denser scripts.
 *
 * The flat 3 was the one real bug behind the 2026-11-16 overshoot: a Chinese
 * agent conversation priced at 3 chars/token is under-counted ~2x, so a
 * 65,536-token cap happily admitted 125,024 tokens and the trimmer logged a
 * no-op. 1.5 comes from `compression/estimator.ts` (CJK is 0.6–1.7 tokens per
 * char, mostly ~1.5), so the two budgets now agree on what a CJK character
 * costs. Latin traffic is unaffected — same divisor as before.
 */
const CHARS_PER_TOKEN_CJK = 1.5

/**
 * Floor for a truncated message, in tokens.
 *
 * A message cut below this is not a summary of anything — it is a marker with
 * noise in front of it. The degenerate branch (system block already at or over
 * the cap) has no budget left to give, and still must keep something the model
 * can answer, so it uses this instead of a negative number.
 */
const MIN_KEPT_TOKENS = 64

/**
 * Smallest window in which a request is still worth sending: the newest message
 * gets a real budget, and the system block and reserved task statements are
 * untouched by definition.
 *
 * A cost target that leaves less than this is not a budget — it is a request to
 * throw the conversation away and call it spending control. `budgetFor` hands
 * such a target back in favour of the window (2026-11-16: 65,536 against a
 * 65,880 system prompt bought nothing and cost every turn).
 */
const MIN_SERVICEABLE_TAIL_TOKENS = MIN_KEPT_TOKENS * 4

/**
 * Estimate the token count of a message.
 *
 * ASCII keeps the historical 3 chars/token; CJK codepoints are priced
 * separately at 1.5. Getting this wrong in the cheap direction is not a
 * rounding error, it is a cap that silently does not bind.
 */
function estimateTokens(content: string | ChatMessage['content']): number {
  if (content === null || content === undefined) {
    return 0
  }

  if (typeof content === 'string') {
    return estimateTextTokens(content)
  }

  if (Array.isArray(content)) {
    return content.reduce((total, part) => {
      if (part.type === 'text' && part.text) {
        return total + estimateTextTokens(part.text)
      }
      return total
    }, 0)
  }

  return 0
}

/** Price one piece of text: dense scripts by their own ratio, the bulk at 3. */
function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0
  const cjk = countCjkChars(text)
  return Math.ceil((text.length - cjk) / CHARS_PER_TOKEN_ASCII + cjk / CHARS_PER_TOKEN_CJK)
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
 * 3. **Lost current turn** — the first `user` message is not always the task. Codex
 *    injects `AGENTS.md` as the first user turn, so a mid-turn window that kept only
 *    tool traffic rescued the rulebook and dropped the instruction: the model answered
 *    "AGENTS.md instructions loaded … what would you like me to work on?", the turn
 *    closed, and the client read it as "stopped without doing anything" (2026-11-13,
 *    `codex-deepseek` served by the trimmed `trae` lane). Keep the newest user turn
 *    before the window as well whenever the window itself carries none.
 *
 * `kept` must be a contiguous suffix of `nonSystem` (both strategies build it
 * that way); the index math below relies on it.
 */
function keepToolGroupAndTask(nonSystem: ChatMessage[], kept: ChatMessage[]): ChatMessage[] {
  if (kept.length === 0) return kept
  const groupStart = toolGroupStart(nonSystem, kept)
  const withGroup = nonSystem.slice(groupStart)
  const prefix = taskPrefix(nonSystem, groupStart, withGroup)
  return prefix.length === 0 ? withGroup : [...prefix, ...withGroup]
}

/**
 * Start index of the contiguous run that `kept` must be widened to.
 *
 * Only the tool-group half of {@link keepToolGroupAndTask}'s repair. Split out
 * because `TokenLimitStrategy` has to price the two halves separately: the tool
 * group is part of the tail it already budgeted, while the rescued task
 * statements come out of their own reserve.
 */
function toolGroupStart(nonSystem: ChatMessage[], kept: ChatMessage[]): number {
  let groupStart = nonSystem.length - kept.length
  if (kept[0]?.role === 'tool') {
    while (groupStart > 0 && nonSystem[groupStart - 1]?.role === 'tool') groupStart -= 1
    const parent = nonSystem[groupStart - 1]
    const toolCalls = (parent as { tool_calls?: unknown[] } | undefined)?.tool_calls
    if (parent?.role === 'assistant' && Array.isArray(toolCalls) && toolCalls.length > 0) {
      groupStart -= 1
    }
  }
  return groupStart
}

/**
 * The task statements to pull back in front of a cut window: the first `user`
 * turn (what was asked) and, when the window carries none, the newest `user`
 * turn before it (what is being asked now).
 */
function taskPrefix(
  nonSystem: ChatMessage[],
  groupStart: number,
  withGroup: ChatMessage[]
): ChatMessage[] {
  const prefix: ChatMessage[] = []
  const first = nonSystem.find(message => message.role === 'user')
  if (first !== undefined && !withGroup.includes(first)) prefix.push(first)
  if (!withGroup.some(message => message.role === 'user')) {
    const current = lastUserBefore(nonSystem, groupStart)
    if (current !== undefined && current !== first) prefix.push(current)
  }
  return prefix
}

/** The newest user turn before `before` — the instruction that governs the kept window. */
function lastUserBefore(nonSystem: ChatMessage[], before: number): ChatMessage | undefined {
  for (let i = before - 1; i >= 0; i--) {
    if (nonSystem[i]?.role === 'user') return nonSystem[i]
  }
  return undefined
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
 *
 * The cap is a hard constraint. Two things used to keep it from being one:
 *
 * 1. an oversized newest message was forwarded **verbatim**, so one large tool
 *    result could carry the request far past `maxTokens` (measured 2026-11-16:
 *    125,024 tokens against a 65,536 cap on a live agent session);
 * 2. `trimmed` was derived from the message **count**, so a truncation — which
 *    keeps every message and rewrites one — reported "nothing happened", and the
 *    caller dropped the result and forwarded the original.
 *
 * Both are fixed by the same idea: cut the message down to its budget and leave
 * a retrievable pointer to the dropped tail (`truncateToBudget`). The history is
 * never emptied, and the request is the size the user configured.
 */
export class TokenLimitStrategy {
  private config: TokenLimitConfig

  constructor(config: TokenLimitConfig = DEFAULT_TOKEN_LIMIT_CONFIG) {
    this.config = { ...DEFAULT_TOKEN_LIMIT_CONFIG, ...config }
  }

  /**
   * Budget held back for the task statements pulled back in front of the window.
   *
   * Reserving here (instead of adding them after the loop) keeps the total near
   * `maxTokens`; the newest message is not reserved because it is the thing the
   * budget must be spent on.
   */
  private taskReserve(nonSystemMessages: ChatMessage[]): number {
    const newest = nonSystemMessages[nonSystemMessages.length - 1]
    const first = nonSystemMessages.find(message => message.role === 'user')
    const current = lastUserBefore(nonSystemMessages, nonSystemMessages.length)
    let reserve = 0
    if (first !== undefined && first !== newest) reserve += estimateTokens(first.content)
    if (current !== undefined && current !== first && current !== newest) {
      reserve += estimateTokens(current.content)
    }
    return reserve
  }

  /**
   * The budget this request is actually trimmed against: the cost target when it
   * is serviceable and cheaper than the window, the window otherwise.
   *
   * The window (`this.config.maxTokens`) is an upstream fact — going over it is a
   * `context` 400 — so a cost target can only ever tighten it, never loosen it.
   * The interesting case is the other end: a target below what must survive
   * (system block + task reserve + a usable tail) cannot be met by any legal
   * trimming, and honouring it literally is the 2026-11-16 defect with a new
   * name. So it is declined there — the request stays serviceable and the log
   * names the reason, which is the only way an operator learns the target is
   * misconfigured.
   */
  private budgetFor(systemTokens: number, reserve: number): { budget: number; declined?: number } {
    const window = this.config.maxTokens
    const target = this.config.costBudget
    if (target === undefined || target >= window) return { budget: window }
    if (target < systemTokens + reserve + MIN_SERVICEABLE_TAIL_TOKENS) {
      return { budget: window, declined: target }
    }
    return { budget: target }
  }

  /**
   * Cut one message so it fits `budgetTokens`, appending a retrievable pointer to
   * the dropped tail. Returns `undefined` when nothing had to be cut.
   *
   * Why truncate instead of drop: the newest message is the thing to answer, so
   * dropping it turns trimming into clearing the conversation (upstream rejects
   * `messages: []`). Why cap it at all: "keep it whatever its size" made the
   * configured limit advisory. Truncation is the only shape that honours both.
   *
   * The stash holds the ORIGINAL text, so the pointer resolves to the full
   * message rather than to the prefix it came from. A failed stash still cuts —
   * an over-budget request is the bigger problem — but the marker then says the
   * original is unavailable instead of pointing at nothing.
   */
  private truncateToBudget(message: ChatMessage, budgetTokens: number): ChatMessage | undefined {
    if (typeof message.content !== 'string') return undefined
    const text = message.content
    if (estimateTokens(text) <= budgetTokens) return undefined

    // Already truncated by an earlier pass: cut the BODY further and keep
    // pointing at the same original. Refusing outright would let a second budget
    // pass (`enforceHardCap`) fail to bind, which is the defect this whole path
    // exists to remove; re-hashing the visible text would instead make the
    // pointer describe a prefix instead of the real original.
    const prior = parseTruncationMarker(text)
    const body = prior?.body ?? text
    const totalChars = prior?.totalChars ?? text.length
    // Compressed some other way (`<<ccr:` rows/items, a fold pointer): its inner
    // hash is the only handle on the bytes, so a second cut would destroy it.
    if (prior === undefined && isAlreadyCompressed(text)) return undefined

    // The estimate is not linear in characters (CJK and ASCII are priced
    // differently), so a computed ratio can land over the cap. Searching for the
    // boundary is exact and costs O(log n) estimates.
    const markerReserve = 96
    let lo = 1
    let hi = body.length
    let keep = 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const candidate = estimateTokens(body.slice(0, mid)) + markerReserve
      if (candidate <= budgetTokens) {
        keep = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    // Without the reserve fitting, take the bare minimum rather than emitting a
    // marker that is itself over budget.
    if (estimateTokens(body.slice(0, keep)) + markerReserve > budgetTokens) {
      keep = Math.max(1, Math.min(keep, Math.floor(budgetTokens * CHARS_PER_TOKEN_CJK / 2)))
    }

    let hash: string | null = prior?.hash ?? null
    if (prior === undefined) {
      try {
        hash = getCcrStore().put(text, BLOCK_HASH_LENGTH)
      } catch (error) {
        console.error('[TokenLimitStrategy] CCR stash failed, truncating without a pointer:', error)
      }
    }

    const kept = body.slice(0, keep)
    const dropped = Math.max(0, totalChars - kept.length)
    const marker = hash === null
      ? makeUntrackedTruncationMarker(totalChars, dropped)
      : makeTruncationMarker(totalChars, dropped, hash)
    return { ...message, content: kept + marker }
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

    const originalTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)

    // The system block is truncated only when this provider named a cap for it
    // (`maxSystemTokensByProvider` -> `systemMaxTokens`). Default: untouched, so
    // no channel rewrites its client's own prompt by surprise.
    const systemBudget = this.config.systemMaxTokens
    const systemMessages = messages
      .filter(message => message.role === 'system')
      .map(message => (systemBudget === undefined ? message : this.truncateToBudget(message, systemBudget) ?? message))

    // Everything below works on a COPY of the non-system messages, and every
    // repair (tool-group widening, task rescue) slices from that same copy. That
    // is load-bearing: re-slicing the original array silently reverted a
    // truncation applied to the newest element, so the request went out at full
    // size while the log claimed it had been cut.
    const work = messages.filter(message => message.role !== 'system')

    const systemTokens = systemMessages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
    const reserve = this.taskReserve(work)
    const { budget, declined } = this.budgetFor(systemTokens, reserve)
    if (declined !== undefined) {
      // Say it out loud: a target the operator set and the gateway refuses to
      // honour is a configuration error they can only fix if they can see it.
      console.warn(
        `[TokenLimitStrategy] costBudget=${declined} 装不下 system=${systemTokens} + reserve=${reserve} + ` +
          `最小可用尾部=${MIN_SERVICEABLE_TAIL_TOKENS}，本次按窗口 ${this.config.maxTokens} 裁剪`
      )
    }
    const availableTokens = budget - systemTokens - reserve
    const newestIndex = work.length - 1

    if (availableTokens <= 0) {
      // The system block (and/or the reserved task statements) already consume
      // the whole cap, so `availableTokens` is negative and there is no window to
      // fill.
      //
      // A cost target cannot be the cause: `budgetFor` only hands one back when it
      // leaves room for the whole tail, so reaching here always means the WINDOW
      // is too small — an upstream fact the operator has to change, never a
      // spending decision. That separation is the point of keeping the two
      // numbers apart.
      //
      // Two things matter here and they are not the same:
      //
      // 1. The newest message must stay answerable. Budgeting it at the negative
      //    remaining balance used to cut it to `MIN_KEPT_TOKENS` — a 64-token stub
      //    with no instruction left in it. Observed 2026-11-16 on a Claude Code
      //    session whose own system prompt was ~65,880 tokens against a 65,536
      //    cap: every turn forwarded `"客\n… [626 of 627 chars dropped to fit the
      //    context budget. …]"` and nothing else, and the client read the language
      //    flip as the model's. Budget it at the cap instead: a normal instruction
      //    passes through whole, and a genuinely huge turn is still bounded.
      // 2. The cap can only be satisfied at all if something is allowed to shrink.
      //    An untouchable system block already wider than the cap makes it
      //    unreachable; `enforceHardCap` would find no candidate and loop to its
      //    guard. So it only runs when the system block is either capped or small
      //    enough that cutting the rest can still get there.
      const capReachable = systemBudget !== undefined || systemTokens < this.config.maxTokens
      if (newestIndex >= 0) {
        const truncated = this.truncateToBudget(work[newestIndex], this.config.maxTokens)
        if (truncated !== undefined) work[newestIndex] = truncated
      }
      const repaired = keepToolGroupAndTask(work, newestIndex < 0 ? [] : [work[newestIndex]])
      // The rescued task statements are unbudgeted here (there was no budget to
      // reserve from), so a 31,000-token AGENTS.md turn would be pulled back in
      // whole and the output would sail past the cap — the same defect in a
      // second place. The hard cap is the last word, but only when it has
      // something it is allowed to cut.
      const result = capReachable
        ? this.enforceHardCap([...systemMessages, ...repaired], this.config.maxTokens, systemBudget !== undefined)
        : [...systemMessages, ...repaired]
      const totalTokens = result.reduce((sum, message) => sum + estimateTokens(message.content), 0)
      console.warn(
        `[TokenLimitStrategy] 系统块 + 任务预留已吃满上限 ` +
          `(system=${systemTokens} + reserve=${reserve} > maxTokens=${this.config.maxTokens})` +
          (systemBudget === undefined
            ? capReachable
              ? '；该渠道未开启 system 截断（maxSystemTokensByProvider），系统块原样保留'
              : '；系统的提示词本身就超过上限且该渠道未开 system 截断 —— 裁剪无法让本请求落回上限，' +
                '故保留最新一条原样（不截成残句）；请调大 maxTokens 或为该渠道配 maxSystemTokensByProvider'
            : `；系统块已按 ${systemBudget} 截断`) +
          `，合计 ${totalTokens} token` +
          (totalTokens > this.config.maxTokens ? `（超上限 ${totalTokens - this.config.maxTokens}）` : '')
      )
      return this.resultOf(result, originalCount, originalTokens)
    }

    // Fill from the tail while the budget allows.
    let spend = 0
    let windowStart = work.length
    for (let index = work.length - 1; index >= 0; index -= 1) {
      const tokens = estimateTokens(work[index].content)
      if (spend + tokens <= availableTokens) {
        spend += tokens
        windowStart = index
      } else {
        break
      }
    }

    // Nothing fit because the newest message alone is over budget: keep its
    // truncated form rather than dropping it.
    if (windowStart === work.length && work.length > 0) {
      const truncated = this.truncateToBudget(work[newestIndex], availableTokens)
      if (truncated !== undefined) work[newestIndex] = truncated
      windowStart = newestIndex
    }

    // Widen to keep the tool group whole, then pull the task statements back in
    // front — both against `work`, so a truncation above is never undone.
    const kept = work.slice(windowStart)
    const groupStart = toolGroupStart(work, kept)
    this.fitGroupToBudget(work, groupStart, availableTokens)
    const withGroup = work.slice(groupStart)
    // The rescued task statements live on their own budget: `taskReserve` was
    // already subtracted from `availableTokens`, so the share they may occupy is
    // exactly `reserve` — charging them `availableTokens - spend` a second time
    // truncates a task statement that fits its own share (caught by 「首条任务
    // 补回」, 2026-11-16). They are still fitted because that reserve is an
    // ESTIMATE and a statement can exceed it (Codex injects AGENTS.md as the first
    // user turn): "rescue the task" must not be able to unmake the cap.
    const prefix = this.fitPrefixToBudget(taskPrefix(work, groupStart, withGroup), reserve)
    let result = [...systemMessages, ...prefix, ...withGroup]
    let totalTokens = result.reduce((sum, message) => sum + estimateTokens(message.content), 0)

    if (totalTokens > budget) {
      // Whichever bound is in force is a constraint, not a target. Reaching here
      // means the accounting above disagrees with measurement (multimodal parts,
      // tool_call arguments, a reserve that under-counted) — reporting "trimmed"
      // while forwarding an over-budget prompt is the exact failure this path
      // exists to prevent, so cut the largest message again until the total
      // fits. `budget` is the cost target when one is in force, so the same
      // repair keeps the spending promise rather than merely the window.
      result = this.enforceHardCap(result, budget, systemBudget !== undefined)
      totalTokens = result.reduce((sum, message) => sum + estimateTokens(message.content), 0)
    }

    const rewrote = totalTokens < originalTokens
    console.log(
      `[TokenLimitStrategy] Trimmed from ${originalCount} to ${result.length} messages ` +
        `(tokens: ${totalTokens}/${this.config.maxTokens}` +
        `${budget === this.config.maxTokens ? '' : `, costBudget=${budget}`}` +
        `${rewrote && result.length === originalCount ? ', content truncated' : ''})`
    )

    return this.resultOf(result, originalCount, originalTokens)
  }

  /**
   * Package a result, deriving `trimmed`/`rewrote` from measured bytes.
   *
   * `trimmed` must be true when content shrank, not only when the count did:
   * callers used the count to decide whether to adopt the result, and a
   * truncation keeps the count identical (`rewrote` says which kind it was).
   */
  private resultOf(
    messages: ChatMessage[],
    originalCount: number,
    originalTokens: number
  ): StrategyResult {
    const totalTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
    const shrunk = totalTokens < originalTokens
    return {
      messages,
      originalCount,
      processedCount: messages.length,
      strategyName: 'tokenLimit',
      trimmed: messages.length < originalCount || shrunk,
      rewrote: shrunk,
    }
  }

  /**
   * Fit the rescued task statements into whatever the window and group left over.
   *
   * They are disjoint from the group by construction (`taskPrefix` skips anything
   * already kept), so truncating one cannot disturb a truncation already applied
   * to the other side. The surplus is taken from the LARGEST statement first: a
   * 9,006-token AGENTS.md turn should give up its tail before a short 「继续」 does.
   */
  private fitPrefixToBudget(prefix: ChatMessage[], budgetTokens: number): ChatMessage[] {
    if (prefix.length === 0) return prefix
    const total = prefix.reduce((sum, message) => sum + estimateTokens(message.content), 0)
    if (total <= budgetTokens) return prefix

    const next = [...prefix]
    let excess = total - budgetTokens
    // Largest first, and never below the floor: a marker with nothing in front of
    // it is not a task statement any more.
    const order = next
      .map((message, index) => ({ index, tokens: estimateTokens(message.content) }))
      .sort((a, b) => b.tokens - a.tokens)
    for (const { index, tokens } of order) {
      if (excess <= 0) break
      const target = Math.max(MIN_KEPT_TOKENS, tokens - excess)
      const truncated = this.truncateToBudget(next[index], target)
      if (truncated === undefined) continue
      next[index] = truncated
      excess -= tokens - estimateTokens(truncated.content)
    }
    return next
  }

  /**
   * Make the widened tool group fit by truncating its largest message, in place.
   *
   * The group is part of the same tail the fit-loop already budgeted, so it must
   * not hand back what that loop just removed. Only the largest single message is
   * cut: cutting several small ones would lose more distinct context for the same
   * token saving. Mutating `work` (rather than returning a new array) keeps this
   * repair and the earlier truncation on the same objects.
   */
  private fitGroupToBudget(work: ChatMessage[], groupStart: number, availableTokens: number): void {
    if (groupStart >= work.length) return
    const groupTokens = work
      .slice(groupStart)
      .reduce((sum, message) => sum + estimateTokens(message.content), 0)
    if (groupTokens <= availableTokens) return

    let largestIndex = groupStart
    let largestTokens = -1
    for (let index = groupStart; index < work.length; index += 1) {
      const tokens = estimateTokens(work[index].content)
      if (tokens > largestTokens) {
        largestTokens = tokens
        largestIndex = index
      }
    }

    const budgetForLargest = availableTokens - (groupTokens - largestTokens)
    const truncated = this.truncateToBudget(work[largestIndex], Math.max(MIN_KEPT_TOKENS, budgetForLargest))
    if (truncated !== undefined) work[largestIndex] = truncated
  }

  /**
   * Last-resort hard cap: halve the largest messages until the total fits.
   *
   * Never touches a system message unless the provider opted in — cutting the
   * client's own prompt is a stronger act than dropping history, and the
   * provider that wants it says so (`maxSystemTokensByProvider`).
   */
  private enforceHardCap(
    messages: ChatMessage[],
    maxTokens: number,
    systemMayShrink: boolean
  ): ChatMessage[] {
    const next = [...messages]
    let guard = next.length * 2
    while (next.reduce((sum, message) => sum + estimateTokens(message.content), 0) > maxTokens && guard-- > 0) {
      let worst = -1
      let worstTokens = 0
      next.forEach((message, index) => {
        if (message.role === 'system' && !systemMayShrink) return
        const tokens = estimateTokens(message.content)
        if (tokens > worstTokens) {
          worstTokens = tokens
          worst = index
        }
      })
      if (worst < 0 || worstTokens === 0) break
      const truncated = this.truncateToBudget(next[worst], Math.max(MIN_KEPT_TOKENS, Math.floor(worstTokens / 2)))
      if (truncated === undefined) break
      next[worst] = truncated
    }
    return next
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
  private providerId?: string
  private declaredContextWindow?: number

  /**
   * @param providerId - resolves the per-provider fallbacks.
   * @param declaredContextWindow - the serving model's own declared window, which
   *   wins over both the tier and any per-provider cap. Passed separately rather
   *   than baked into `config` for the same reason as `providerId`: the
   *   constructor normalizes, and normalization strips every RESOLVED key so a
   *   stored file cannot pin a cap that was resolved for a different request.
   */
  constructor(
    config: ContextManagementConfig = DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
    providerId?: string,
    declaredContextWindow?: number
  ) {
    this.providerId = providerId
    this.declaredContextWindow = declaredContextWindow
    this.config = normalizeContextManagementConfig(config)
    this.slidingWindowStrategy = new SlidingWindowStrategy(
      this.resolveSlidingWindowConfig(this.config.strategies.slidingWindow, providerId)
    )
    this.tokenLimitStrategy = new TokenLimitStrategy(
      this.resolveTokenLimitConfig(this.config.strategies.tokenLimit, providerId)
    )
  }

  /** Fold `maxMessagesByProvider` onto the message window. */
  private resolveSlidingWindowConfig(config: SlidingWindowConfig, providerId?: string): SlidingWindowConfig {
    if (providerId === undefined) return config
    const window = config.maxMessagesByProvider?.[providerId]
    return window === undefined ? config : { ...config, maxMessages: window }
  }

  /**
   * Fold the declared model window / tier / per-provider caps onto the token cap.
   *
   * The provider is no longer enough to pick the cap: the serving model's own
   * window is what this request should be trimmed against, and the tier is the
   * fallback for a model that declares nothing (see `resolveTrimBudget`).
   */
  private resolveTokenLimitConfig(config: TokenLimitConfig, providerId?: string): TokenLimitConfig {
    const budget = resolveTrimBudget(config, providerId, this.declaredContextWindow)
    const systemCap = providerId === undefined
      ? undefined
      : config.maxSystemTokensByProvider?.[providerId]
    const costBudget = providerId === undefined ? undefined : config.costBudgetByProvider?.[providerId]
    return {
      ...config,
      maxTokens: budget,
      ...(systemCap === undefined ? {} : { systemMaxTokens: systemCap }),
      ...(costBudget === undefined ? {} : { costBudget }),
    }
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
      this.resolveSlidingWindowConfig(this.config.strategies.slidingWindow, this.providerId)
    )
    this.tokenLimitStrategy = new TokenLimitStrategy(
      this.resolveTokenLimitConfig(this.config.strategies.tokenLimit, this.providerId)
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
        changed: false,
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

      if (result.trimmed && result.rewrote === true) {
        console.log(
          `[ContextManagementService] Strategy ${strategyName} kept all ` +
            `${result.processedCount} messages but truncated content to fit the budget`
        )
      } else if (result.trimmed) {
        console.log(
          `[ContextManagementService] Strategy ${strategyName} trimmed ` +
            `${result.originalCount} -> ${result.processedCount} messages`
        )
      }
    }

    const changed = currentMessages !== messages && currentMessages.some(
      (message, index) =>
        message !== messages[index] ||
        typeof message.content !== typeof messages[index]?.content ||
        message.content !== messages[index]?.content
    )
    const changedByRewrite = strategyResults.some(result => result.rewrote === true)

    console.log(
      `[ContextManagementService] Final result: ${originalCount} -> ${currentMessages.length} messages` +
        (changedByRewrite ? ' (content rewritten to fit the budget)' : '')
    )

    return {
      messages: currentMessages,
      originalCount,
      finalCount: currentMessages.length,
      strategyResults,
      changed: changed || changedByRewrite,
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
 * Create a context management service bound to one provider **and one serving
 * model**.
 *
 * `declaredContextWindow` is the model's own annotated window and takes
 * priority over the configured tier and every per-provider cap — trim to what
 * this model actually holds, not to a number measured on a different model.
 * Absent (`undefined`, i.e. the model declares nothing) the tier applies, and
 * failing that the legacy `maxTokensByProvider` / `maxTokens` shape — so
 * callers that pass neither behave exactly as before.
 */
export function createContextManagementService(
  config?: Partial<ContextManagementConfig>,
  providerId?: string,
  declaredContextWindow?: number
): ContextManagementService {
  return new ContextManagementService(
    normalizeContextManagementConfig(config),
    providerId,
    declaredContextWindow
  )
}
