/**
 * Which conversations have already been told what the compression markers mean.
 *
 * Why this exists rather than a per-turn decision: the protocol block is
 * prepended as the first `system` message, so its **presence** is part of the
 * prompt prefix. If it appeared on the turns that compressed and vanished on the
 * turns that did not, the very first bytes would change back and forth and every
 * upstream prefix cache would miss on the flapping turn — a full re-read of a
 * conversation the gateway deliberately keeps byte-stable (`compression/index.ts`
 * only rewrites the live zone for exactly this reason).
 *
 * So the block is remembered per conversation: the turn that first compresses
 * introduces it, and every later turn of the same conversation keeps the same
 * bytes. A conversation that never compresses pays nothing at all.
 *
 * The text itself is conditional ("this gateway may shorten…"), never an
 * assertion that this particular request was shortened, because on a later turn
 * of a marked conversation the client resends the original bytes and there may
 * be no marker in the request at all.
 *
 * Keyed by `autoRouting.conversationKey`, which is derived from the client's
 * own system text and first user message — the client does not echo our block,
 * so the key stays stable across turns.
 */

/** A conversation is forgotten after this long without a request. */
export const MARKED_CONVERSATION_TTL_MS = 30 * 60 * 1000
/** Hard cap; the oldest entry is evicted first. */
export const MAX_MARKED_CONVERSATIONS = 512

const marked = new Map<string, number>()

export function conversationHasProtocolBlock(key: string | undefined, nowMs: number = Date.now()): boolean {
  if (!key) return false
  const at = marked.get(key)
  if (at === undefined) return false
  if (nowMs - at > MARKED_CONVERSATION_TTL_MS) {
    marked.delete(key)
    return false
  }
  return true
}

export function rememberProtocolBlock(key: string | undefined, nowMs: number = Date.now()): void {
  if (!key) return
  // Refresh recency so an active conversation never falls out of the window.
  marked.delete(key)
  marked.set(key, nowMs)
  if (marked.size <= MAX_MARKED_CONVERSATIONS) return

  for (const [candidate, at] of marked) {
    if (nowMs - at > MARKED_CONVERSATION_TTL_MS) marked.delete(candidate)
  }
  while (marked.size > MAX_MARKED_CONVERSATIONS) {
    const oldest = marked.keys().next()
    if (oldest.done) break
    marked.delete(oldest.value)
  }
}

/** Test seam: fresh installs and restarts start with no conversation marked. */
export function resetProtocolBlockMemory(): void {
  marked.clear()
}