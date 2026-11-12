/**
 * Which requests have their bodies stored when `includeBodies` is off.
 *
 * Compression work needs bodies from traffic nobody thought to trace by hand,
 * and storing every one of them is not acceptable either (privacy, and bodies
 * of 200 KB and up against a 200-row window). So the choice is a sampled
 * subset rather than a switch.
 *
 * The draw is a hash of the request id, not `Math.random()`. A row is written
 * when the request starts and patched as the stream progresses; the patch does
 * not carry the body, so the sanitizer decides whether to keep what is already
 * on the row by reading `captureBodies`. With a fresh random draw per write
 * that flag would flip under the body it was written for.
 */

/** FNV-1a over the id, mapped to [0, 1). */
function unitHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

/**
 * `rate <= 0` selects nothing, `rate >= 1` selects everything. A row with no
 * `requestId` is never selected: without a stable key we would have to draw per
 * write, which is the disagreement described above.
 */
export function isBodySampleSelected(requestId: string | undefined, rate: number): boolean {
  if (!requestId) return false
  if (!(rate > 0)) return false
  if (rate >= 1) return true
  return unitHash(requestId) < rate
}