/**
 * CCR (Compress-Cache-Retrieve) markers.
 *
 * A lossy compression is only defensible if the original is still reachable.
 * Every rewrite we perform therefore leaves a marker carrying a content hash,
 * and the original bytes are stashed under that hash.
 *
 * Two shapes exist and they are NOT interchangeable (headroom `crusher.rs:606`
 * vs `:1161`):
 *
 *   - object arrays drop ROWS and append a sentinel OBJECT,
 *   - scalar arrays drop ITEMS and append a sentinel STRING.
 *
 * The sentinel is a deliberate schema break: an "array of uniform records" is
 * no longer uniform. Consumers must filter it, which is what
 * `isCcrSentinel` / `stripCcrSentinels` are for. Re-compressing a payload that
 * already carries a sentinel is never correct — the second pass would treat the
 * compressed text as source and hash the marker itself.
 */

/** Key of the sentinel object appended to a crushed object array. */
export const ROW_SENTINEL_KEY = '_ccr_dropped'

/** Hash id length used by JSON markers (48 bits — collisions are negligible). */
export const JSON_HASH_LENGTH = 12

/** Hash id length used by whole-line and whole-file compressors. */
export const BLOCK_HASH_LENGTH = 24

/** Build the sentinel object appended after dropped rows. */
export function makeRowSentinel(hash: string, dropped: number): Record<string, string> {
  return { [ROW_SENTINEL_KEY]: `<<ccr:${hash} ${dropped}_rows_offloaded>>` }
}

/**
 * Build the sentinel string appended after dropped scalar items.
 *
 * GATEWAY-TEXT: ccr-sentinel — 有损压缩必须留下可取回的指针（`9d07417` 2026-10-30）。
 * 它进的是工具结果正文，不是提示词；带哨兵的载荷绝不二次压缩。
 */
export function makeItemSentinel(hash: string, dropped: number): string {
  return `… ${dropped} more items <<ccr:${hash} ${dropped}_items_offloaded>>`
}

/** Marker appended to a compressed block of log lines. */
export function makeLogMarker(before: number, after: number, hash: string): string {
  return `[${before} lines compressed to ${after}. Retrieve more: hash=${hash}]`
}

/** Marker appended to a compressed set of search matches. */
export function makeSearchMarker(before: number, after: number, hash: string): string {
  return `[${before} matches compressed to ${after}. Retrieve more: hash=${hash}]`
}

/**
 * Marker appended when one message's tail is cut to fit the context budget.
 *
 * GATEWAY-TEXT: ccr-sentinel — 与行/项哨兵同族（有损压缩必须留下可取回的指针）,
 * 只是丢的单位是正文尾部而不是整行/整项。
 *
 * Why this exists (2026-11-16): `TokenLimitStrategy` used to keep an oversized
 * newest message **verbatim** so trimming could never empty the history. The cap
 * therefore did not bind: 现网一笔 125,024 token 的请求打在 65,536 的上限上
 * （1.9x），日志却写 `Trimmed from 4 to 4` —— 单条 tool 结果（一次文件读/搜索
 * 的输出）就能把节省全吃掉。截断 + 取回指针是唯一既保住「有东西可回答」又让
 * 上限真的成立的形状。
 */
export function makeTruncationMarker(totalChars: number, droppedChars: number, hash: string): string {
  return `\n… [${droppedChars} of ${totalChars} ${TRUNCATION_NOTICE} Retrieve more: hash=${hash}]`
}

/**
 * Phrase every truncation tail carries, hashed or not.
 *
 * `isAlreadyCompressed` keys off the retrieval wording, which the no-store
 * variant below does not have — so a second trimming pass over an already
 * truncated message must recognise it by this phrase instead. Without it the
 * second pass would truncate the tail of a tail and the pointer would drift.
 */
export const TRUNCATION_NOTICE = 'chars dropped to fit the context budget.'

/** Tail marker used when the original could not be stashed (disk full, oversize). */
export function makeUntrackedTruncationMarker(totalChars: number, droppedChars: number): string {
  return `\n… [${droppedChars} of ${totalChars} ${TRUNCATION_NOTICE} Original unavailable to retrieve.]`
}

/**
 * Read back a truncation tail left by an earlier pass.
 *
 * A budget can be applied twice (`enforceHardCap` runs after the planned cuts,
 * and a second strategy pass sees the first pass's output). Cutting the marker's
 * tail again would corrupt it, so the second pass has to recognise it and cut the
 * BODY further while re-pointing at the same original — one pointer, one hash,
 * and the dropped count keeps describing the whole original.
 *
 * Returns `undefined` when `text` carries no truncation tail of ours.
 */
export function parseTruncationMarker(
  text: string
): { body: string; totalChars: number; hash: string | null } | undefined {
  const at = text.lastIndexOf('\n… [')
  if (at < 0) return undefined
  const tail = text.slice(at)
  if (!tail.includes(TRUNCATION_NOTICE)) return undefined

  const hashed = /^\n… \[(\d+) of (\d+) chars dropped to fit the context budget\. Retrieve more: hash=([a-f0-9]{12,64})\]$/.exec(tail)
  if (hashed) {
    return { body: text.slice(0, at), totalChars: Number(hashed[2]), hash: hashed[3] }
  }
  const untracked = /^\n… \[(\d+) of (\d+) chars dropped to fit the context budget\. Original unavailable to retrieve\.\]$/.exec(tail)
  if (untracked) {
    return { body: text.slice(0, at), totalChars: Number(untracked[2]), hash: null }
  }
  return undefined
}

/**
 * True when `value` is one of our sentinels — either the row-drop object or the
 * item-drop marker string. Used to keep a second compression pass from treating
 * a marker as data.
 */
export function isCcrSentinel(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('<<ccr:') && value.includes('_items_offloaded>>')
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = (value as Record<string, unknown>)[ROW_SENTINEL_KEY]
    return typeof raw === 'string' && raw.includes('<<ccr:')
  }
  return false
}

/** Drop every sentinel element, leaving the data rows untouched. */
export function stripCcrSentinels(items: readonly unknown[]): unknown[] {
  return items.filter(item => !isCcrSentinel(item))
}

/**
 * True when `text` already carries a compression marker, so it must be
 * forwarded verbatim.
 *
 * Beyond wasting CPU, re-compressing marker-bearing text is destructive: the
 * inner hash is the only handle on the real bytes, and a second pass can hash
 * the placeholder and lose it (`content_router.py:145-158`).
 */
export function isAlreadyCompressed(text: string): boolean {
  return (
    text.includes('<<ccr:') ||
    text.includes('Retrieve more: hash=') ||
    text.includes('Retrieve original: hash=') ||
    // A budget truncation whose original could not be stashed carries no hash,
    // so it is recognised by its own notice instead.
    text.includes(TRUNCATION_NOTICE)
  )
}
