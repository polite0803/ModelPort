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
    text.includes('Retrieve original: hash=')
  )
}
