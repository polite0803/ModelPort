/**
 * Sticky "current serving account" ordering.
 *
 * The pool returns the first eligible account in the user's manual order, so
 * parallel requests normally land on the same account. The problem is the
 * hand-over: a request that fails on A moves to B while other requests are
 * still running on A, and once A is marked rate-limited every *new* request
 * goes to B. Without a pin, the channel keeps a foot on both accounts.
 *
 * The rule implemented here: while the current serving account is eligible, it
 * stays first regardless of the order it appears in; the pin only moves when
 * that account is excluded (failed) or ineligible (disabled / rate-limited).
 * That keeps at most one switch in flight instead of letting the pool drift
 * between accounts.
 */

/**
 * @param candidates - eligible accounts, already in manual order
 * @param activeId - the account currently serving this channel, if any
 * @returns a new array with `activeId` moved to the front when present
 */
export function moveActiveFirst<T extends { id: string }>(
  candidates: readonly T[],
  activeId: string | undefined,
): readonly T[] {
  if (activeId === undefined || activeId === '' || candidates.length <= 1) return candidates
  if (candidates[0]!.id === activeId) return candidates
  const index = candidates.findIndex(entry => entry.id === activeId)
  if (index <= 0) return candidates
  const ordered = [...candidates]
  const [active] = ordered.splice(index, 1)
  ordered.unshift(active!)
  return ordered
}
