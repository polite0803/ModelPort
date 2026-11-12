/**
 * Cross-turn duplicate folding — the *apply* half of `duplication.ts`.
 *
 * `duplication.ts` measures how many bytes a conversation repeats. This module
 * does the thing that measurement was for: when a **history** message is a
 * line-for-line repeat of an earlier message, replace it with a pointer and keep
 * the original in the CCR store.
 *
 * Why message granularity and not the measured line runs: a run-level rewrite
 * surgically edits inside a tool result, so every off-by-one in line mapping is
 * a corrupted file the model then reasons over. A whole-message repeat is the
 * dominant agent shape anyway (`cat file`, then `git diff`, then `cat file`) and
 * is exact - the signature either matches a previous message or it does not.
 *
 * Four properties, all load-bearing:
 *
 * 1. **The earliest copy is never folded.** The pointer always resolves *back*
 *    to something still visible in the conversation, so a model that reads only
 *    the marker loses nothing but the duplicate.
 * 2. **It is deterministic.** The same conversation produces the same markers
 *    and the same content-addressed hashes on every turn, so folding a
 *    conversation once does not make the next turn's prefix drift. The first
 *    turn a duplicate appears is the only cache miss.
 * 3. **The live zone is untouched.** Only messages before the last `assistant`
 *    turn are eligible; everything newer belongs to the current turn and is
 *    owned by live-zone compression. Two rewriters must not overlap.
 * 4. **A failed stash means no fold.** A pointer to bytes that were never stored
 *    is worse than the duplicate, so a refused write leaves the message intact.
 */

import type { ChatMessage } from '../types'
import { BLOCK_HASH_LENGTH } from './ccr/markers.ts'
import { normalizeLineKey } from './duplication.ts'

/** Below this size a message is not worth a marker. */
export const FOLD_MIN_CHARS = 512
/** Signature work is bounded per message; a huge message folds by its head. */
const MAX_SIGNATURE_LINES = 4000

export interface FoldOptions {
  /** Persist the original and return the id to embed, or `null` to refuse. */
  stash: (original: string, idLength: number) => string | null
  /**
   * Only messages with index strictly below this are eligible. Production passes
   * the index of the last `assistant` message; `0` disables folding.
   */
  liveZoneFrom: number
  minChars?: number
}

export interface FoldOutcome {
  messages: ChatMessage[]
  foldedMessages: number
  foldedChars: number
  hashes: string[]
  /** A stash failed, so at least one duplicate was left in place. */
  refused: boolean
}

/**
 * Line-for-line signature, tolerating a uniform line-number offset.
 *
 * Empty lines and trailing whitespace are dropped because a re-print through a
 * different tool re-wraps and re-pads; the words are what must match.
 */
function signatureOf(text: string): string | null {
  const keys: string[] = []
  for (const rawLine of text.split('\n')) {
    if (keys.length >= MAX_SIGNATURE_LINES) break
    const key = normalizeLineKey(rawLine)
    if (key.length > 0) keys.push(key)
  }
  return keys.length > 0 ? keys.join('\n') : null
}

function foldMarker(lineCount: number, chars: number, hash: string): string {
  return `[This message repeats an earlier one in this conversation: ${lineCount} lines / ${chars} chars folded. Retrieve original: hash=${hash}]`
}

function messageText(message: ChatMessage): string | null {
  // Array content is left alone: rewriting one text part of a multimodal
  // message makes the part order - and therefore the cache prefix - ambiguous.
  return typeof message.content === 'string' && message.content.length > 0
    ? message.content
    : null
}

/**
 * Replace repeated history messages with retrievable pointers.
 *
 * Returns the input array reference when nothing was folded, so callers can
 * keep using identity to mean "untouched".
 */
export function foldCrossTurnDuplicates(
  messages: ChatMessage[],
  options: FoldOptions
): FoldOutcome {
  const minChars = options.minChars ?? FOLD_MIN_CHARS
  const firstSeen = new Map<string, number>()
  let next = messages
  let foldedMessages = 0
  let foldedChars = 0
  const hashes: string[] = []
  let refused = false

  const limit = Math.min(options.liveZoneFrom, messages.length)
  for (let index = 0; index < limit; index += 1) {
    const message = messages[index]
    if (message.role !== 'tool' && message.role !== 'user') continue

    const text = messageText(message)
    if (!text || text.length < minChars) continue
    // Already folded (or compressed): a second pass must not hash a marker.
    if (text.includes('Retrieve original: hash=') || text.includes('<<ccr:')) continue

    const signature = signatureOf(text)
    if (!signature) continue

    const earlier = firstSeen.get(signature)
    if (earlier === undefined) {
      firstSeen.set(signature, index)
      continue
    }

    const hash = options.stash(text, BLOCK_HASH_LENGTH)
    if (!hash) {
      refused = true
      continue
    }

    const marker = foldMarker(text.split('\n').length, text.length, hash)
    if (next === messages) next = [...messages]
    next[index] = { ...message, content: marker }
    foldedMessages += 1
    foldedChars += text.length
    hashes.push(hash)
  }

  return { messages: next, foldedMessages, foldedChars, hashes, refused }
}