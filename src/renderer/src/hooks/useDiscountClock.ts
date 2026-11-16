/**
 * A `now` that advances exactly when a discount window opens or closes.
 *
 * Pages that print a credit multiplier cannot print the fetched price: the same
 * model costs `x0.5` at noon and `x0.2` at night, and the catalogue records both
 * plus the schedule (`shared/discountWindow.ts`). Printing the snapshot means the
 * page disagrees with what the router will actually charge.
 *
 * So the page re-renders at the boundaries instead of on a fixed ticker: one timer
 * per page, firing at the earliest upcoming slot edge (or validity edge), capped at
 * `MAX_INTERVAL_MS` so a DST-shifted or clock-adjusted boundary still self-corrects.
 *
 * Pass the windows the page is displaying. An empty list arms nothing — a page with
 * no time-varying prices must not re-render at midnight for no reason.
 */
import { useEffect, useMemo, useState } from 'react'
import { nextDiscountBoundary, type DiscountWindow } from '@shared/discountWindow'

/**
 * Upper bound on how long the timer sleeps.
 *
 * The boundary math converts daily slots through the zone's current offset, so a DST
 * transition inside the interval can move the real boundary by up to an hour. Waking
 * at least this often bounds that error to one interval without turning the page
 * into a per-second re-renderer.
 */
const MAX_INTERVAL_MS = 30 * 60 * 1000

/** Below this the page would spin; a boundary this close is re-read on the next tick. */
const MIN_INTERVAL_MS = 1000

export function useDiscountClock(windows: readonly (DiscountWindow | undefined)[]): number {
  const [now, setNow] = useState(() => Date.now())

  // Key on the schedule content, not on array identity: callers rebuild the array on
  // every render (it comes from a `.map` over models), and an identity-keyed effect
  // would clear and re-arm its timer on every keystroke elsewhere on the page.
  const key = useMemo(
    () => JSON.stringify(windows.filter(window => window !== undefined)),
    [windows],
  )

  useEffect(() => {
    const parsed = JSON.parse(key) as DiscountWindow[]
    if (parsed.length === 0) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = (): void => {
      const current = Date.now()
      let earliest: number | undefined
      for (const window of parsed) {
        const boundary = nextDiscountBoundary(window, current)
        if (boundary !== undefined && (earliest === undefined || boundary < earliest)) earliest = boundary
      }
      if (earliest === undefined) return
      const delay = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, earliest - current))
      timer = setTimeout(() => {
        setNow(Date.now())
        arm()
      }, delay)
    }
    arm()
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [key])

  return now
}