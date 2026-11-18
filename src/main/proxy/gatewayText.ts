/**
 * The two blocks of text this gateway may add to an outbound conversation.
 *
 * Ruling 2026-11-03 said the gateway writes no prompt text at all. Ruling
 * 2026-11-12 lifts that for exactly these two, and only under three conditions
 * that are enforced here rather than promised in a document:
 *
 * 1. **The text states a protocol, not a task.** It says what our own markers
 *    mean and what output shape the user asked for. It never says what the user
 *    wants, never describes the next action, and never impersonates the user or
 *    the client's system prompt.
 * 2. **It arrives as its own leading `system` message.** The client's own system
 *    prompt is never edited, appended to, or replaced - the previous injection
 *    (2026-11-03 `trailing-user-guard`) failed by writing a `user` turn, which
 *    the model echoed back as its own opening line in 36 of 267 reasoning
 *    blocks.
 * 3. **It is byte-identical on every turn of a conversation.** Both blocks are
 *    pure functions of their inputs, so the prefix cache sees the same bytes
 *    again on the next turn. A block that drifts per turn would cost more than
 *    it saves - and "presence" counts as drift: this block is prepended, so it
 *    sits at the head of the prompt, and a block that comes and goes rewrites
 *    the first bytes and drops every cached prefix after it. That is why the
 *    protocol is remembered per conversation once it is introduced
 *    (`gatewayProtocolMemory.ts`) instead of being tied to the current turn's
 *    compression outcome.
 *
 * The compression protocol is only present for conversations that have actually
 * been compressed, so traffic that never gets compressed pays nothing. The
 * output contract is opt-in per level and defaults to absent.
 */

import type { ChatMessage } from './types'
import type { OutputContractLevel } from '../../shared/types'

/** First line of the block we own; also how a re-run recognises its own output. */
export const GATEWAY_TEXT_HEADER = '[ModelPort gateway block]'

export const CCR_PROTOCOL_TAG = 'ModelPort compression protocol v1'

/**
 * Tells the model what a compression marker is and how to get the original.
 *
 * GATEWAY-TEXT: ccr-protocol — 2026-11-12 裁定放开后的第一个注入点。
 * 修的是「指针指向空」：标记一直存在，可取回路径却在管理密钥后面（默认关闭）、
 * 且原文字节 30 分钟就被清掉。协议块只描述标记与取回端点，不替用户说任何话。
 */
export function ccrProtocolText(): string {
  return [
    `Compression protocol (${CCR_PROTOCOL_TAG}).`,
    // Conditional ("may shorten"), never "this request was shortened": on a later
    // turn of a marked conversation the client resends the original bytes, so the
    // request may carry no marker at all while the block is still in the prefix.
    'This gateway may shorten long tool results and user messages before they reach you. A shortened block ends with a marker such as `<<ccr:0123456789ab 42_rows_offloaded>>` or `[120 lines compressed to 30. Retrieve more: hash=0123456789abcdef01234567]`. The 12- or 24-character hex string after `ccr:` or `hash=` identifies the text that was dropped.',
    '- A marker is a pointer, not content. Never invent a hash, and never treat the marker text as data.',
    '- If the dropped text matters, fetch it from the same API base URL this request used, with the same API key: `GET /v1/ccr/<hash>`. The reply is JSON `{"hash","content","bytes"}`.',
    '- A 404 means the original is gone (unknown or expired); the shortened block is then all that exists.',
    '- A marker that says `Retrieve original: hash=...` points at text that still appears verbatim in an earlier message; read that earlier copy instead of fetching it.',
  ].join('\n')
}

/** Minimal output contract texts; `default` authors nothing. */
const OUTPUT_CONTRACT_TEXT: Record<Exclude<OutputContractLevel, 'default'>, string[]> = {
  concise: [
    'Response style (client setting: concise).',
    'Give the shortest answer that is still complete. Do not restate the request, do not narrate steps before taking them, and do not summarize work you just finished unless a summary was asked for. A tool call speaks for itself; a sentence that only announces the next call is noise.',
  ],
  minimal: [
    'Response style (client setting: minimal).',
    'Return results only. No preamble, no narration of steps, no closing summary, no restating the request. When the next step is a tool call, make the call instead of describing it. Do not end a turn with a promise of work you have not done.',
  ],
}

/**
 * GATEWAY-TEXT: say-less-contract — 2026-11-12 裁定放开后的第二个注入点。
 *
 * 它继承 `9d07417` 那次退役的立意（少花 completion token）但换了形态：一段定长
 * system 块、三档、默认关闭、只对带工具的请求生效，且受 `outputContractGuard`
 * 的退化窗口熔断。
 */
export function outputContractText(level: OutputContractLevel): string | null {
  if (level === 'default') return null
  const lines = OUTPUT_CONTRACT_TEXT[level]
  return lines ? lines.join('\n') : null
}

/** True when this message's text carries one of our compression markers. */
function messageHasMarker(message: ChatMessage): boolean {
  if (typeof message.content === 'string') return hasMarkerText(message.content)
  if (!Array.isArray(message.content)) return false
  return message.content.some(part => part?.type === 'text' && hasMarkerText(part.text ?? ''))
}

function hasMarkerText(text: string): boolean {
  return (
    text.includes('<<ccr:') ||
    text.includes('Retrieve more: hash=') ||
    text.includes('Retrieve original: hash=')
  )
}

/** True when the conversation already carries a marker from an earlier turn. */
export function conversationHasCompressionMarker(messages: readonly ChatMessage[]): boolean {
  for (let index = 0; index < messages.length; index += 1) {
    // Our own block mentions the marker syntax; counting it would make the
    // protocol self-perpetuating after the markers themselves were gone.
    if (index === 0 && isGatewayBlock(messages[0])) continue
    if (messageHasMarker(messages[index])) return true
  }
  return false
}

function isGatewayBlock(message: ChatMessage | undefined): boolean {
  return (
    message?.role === 'system' &&
    typeof message.content === 'string' &&
    message.content.startsWith(GATEWAY_TEXT_HEADER)
  )
}

/**
 * Put `blocks` at the head of the conversation as one system message, or remove
 * the block we own when `blocks` is empty.
 *
 * Returns the original reference when nothing changes, so callers can keep using
 * identity to mean "untouched". An existing block of ours is replaced rather
 * than stacked, which is what makes a re-run (retry, chained attempt, client
 * that echoed the block) idempotent.
 */
export function applyGatewayText(
  messages: ChatMessage[],
  blocks: readonly string[]
): ChatMessage[] {
  const text =
    blocks.length === 0 ? '' : [GATEWAY_TEXT_HEADER, ...blocks].join('\n\n')

  const first = messages[0]
  const ownsHead = isGatewayBlock(first)

  if (text === '') return ownsHead ? messages.slice(1) : messages
  if (ownsHead) {
    if (first.content === text) return messages
    const next = [...messages]
    next[0] = { ...first, content: text }
    return next
  }
  return [{ role: 'system', content: text }, ...messages]
}