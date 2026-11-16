/**
 * Time-varying credit multipliers (off-peak discounts).
 *
 * ## Why this file exists (2026-11-16)
 *
 * Several channels sell the same model at two prices depending on the clock:
 * Qoder is 22:00–08:00 Asia/Singapore, WorkBuddy/CodeBuddy nights `23:00–7:50`
 * Asia/Shanghai, TRAE promotions carry an end timestamp. Every adapter already
 * parsed that window — and then threw it away, collapsing the two prices into
 * one string in the display name (`Qwen3.8-Max · x0.5→x0.2`), emitted **only
 * while the window was open**. Two consequences:
 *
 * 1. The host never learned *when* a price applies, so a catalogue read at
 *    noon said `x0.5` and nothing recorded that `x0.2` exists at night;
 * 2. whichever price happened to be current at fetch time was cached for the
 *    catalogue TTL, so a request crossing the window boundary was priced with
 *    the previous side.
 *
 * So the window is now a first-class catalogue fact and the effective price is
 * **computed at evaluation time from the local clock** — no sync, no schedule
 * table to keep aligned, and the channel page and the routing decision read the
 * same function so they cannot disagree at the same instant.
 *
 * ## Shape
 *
 * A window is a set of daily slots in a named time zone plus an optional
 * validity span. Slots may cross midnight (`23:00–7:50`). `timezone` is an IANA
 * name because the vendors really do send different ones; a missing or
 * unparseable zone means **unknown**, which reads as "active" (see below).
 */

/** One daily slot, `HH:MM` wall-clock in the window's time zone. */
export interface DiscountSlot {
  /** Start of the discounted period (`"22:00"`). */
  start: string
  /** End of the discounted period (`"08:00"`); may be earlier than `start`. */
  end: string
}

/**
 * When a discounted price applies.
 *
 * ⚠️ Absent is not "never discounted" — it is **"this channel did not say"**.
 * A catalogue entry with no window keeps the price it was fetched with, which is
 * the best available answer; inventing a window (or assuming 24/7) would make
 * the router price a promotion that is not running.
 */
export interface DiscountWindow {
  /** Daily slots, any of which makes the window active. Absent = all day. */
  daily?: readonly DiscountSlot[]
  /** IANA zone the slots are written in (`Asia/Shanghai`); absent = UTC. */
  timezone?: string
  /** Inclusive start of the promotion, epoch ms. */
  validFrom?: number
  /** Exclusive end of the promotion, epoch ms. */
  validUntil?: number
}

/** `"7:50"` / `"07:50"` → minutes since midnight. Anything else → undefined. */
export function parseSlotBoundary(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined
}

/**
 * Wall-clock minutes since midnight in `timeZone` at `now`.
 *
 * Uses `Intl` rather than a hand-computed UTC offset: the zone is sent by the
 * vendor and is not always +8, so hardcoding the shift misprices every
 * promotion that is not in the author's own zone.
 */
export function zonedMinutes(now: number, timeZone: string | undefined): number | undefined {
  const zone = timeZone !== undefined && timeZone.length > 0 ? timeZone : 'UTC'
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(now))
    const hour = Number(parts.find(part => part.type === 'hour')?.value)
    const minute = Number(parts.find(part => part.type === 'minute')?.value)
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : undefined
  } catch {
    // A zone string we cannot resolve (`Intl` throws on garbage). The caller
    // treats this as "cannot decide", never as "window closed".
    return undefined
  }
}

/**
 * Is the discounted price in force at `now`?
 *
 * Failure direction is deliberate and asymmetric: when the schedule cannot be
 * read (unknown zone, malformed slot) the window reads as **active**, i.e. the
 * cheaper price is used. Both sides of this call are facts about money the user
 * has already been quoted — showing the discount the vendor's own client shows
 * is recoverable, silently charging double the advertised rate is not. Same rule
 * the vendor adapters already apply (`buddy.ts::promotionActiveNow`).
 */
export function isDiscountWindowActive(window: DiscountWindow, now: number): boolean {
  if (window.validFrom !== undefined && now < window.validFrom) return false
  if (window.validUntil !== undefined && now >= window.validUntil) return false
  if (window.daily === undefined || window.daily.length === 0) return true

  const minutes = zonedMinutes(now, window.timezone)
  if (minutes === undefined) return true

  return window.daily.some(slot => {
    const start = parseSlotBoundary(slot.start)
    const end = parseSlotBoundary(slot.end)
    if (start === undefined || end === undefined) return false
    // `start > end` is a window that crosses midnight (`23:00–7:50`).
    return start <= end
      ? minutes >= start && minutes < end
      : minutes >= start || minutes < end
  })
}

/**
 * The next instant at which `isDiscountWindowActive` may change, or undefined when
 * nothing ahead can change it.
 *
 * ## Why the UI needs it
 *
 * A surface that shows the price has to re-render when the price changes. Polling
 * every second would put a re-render per second on a page that changes twice a day;
 * polling every minute would show the pre-discount price for up to 59 seconds after
 * midnight. So the boundary is computed once and one timer fires at it.
 *
 * ## Precision, honestly
 *
 * Daily slots are converted through the zone's *current* offset. A zone with DST
 * (neither `Asia/Shanghai` nor `Asia/Singapore`, but the type does not say) can move
 * the offset inside the interval, so the fire time may be off by up to an hour; the
 * caller re-evaluates after firing, so that reads as a slightly late switch, never a
 * wrong price. Callers should also cap the delay so a long gap still self-corrects.
 */
export function nextDiscountBoundary(window: DiscountWindow, now: number): number | undefined {
  const candidates: number[] = []
  // Validity spans are absolute instants: both flip the state when they pass.
  if (window.validFrom !== undefined && window.validFrom > now) candidates.push(window.validFrom)
  if (window.validUntil !== undefined && window.validUntil > now) candidates.push(window.validUntil)

  if (window.daily !== undefined && window.daily.length > 0) {
    const minutes = zonedMinutes(now, window.timezone)
    // An unreadable zone keeps the window permanently active (`isDiscountWindowActive`),
    // so no daily boundary can change anything.
    if (minutes !== undefined) {
      for (const slot of window.daily) {
        for (const boundary of [parseSlotBoundary(slot.start), parseSlotBoundary(slot.end)]) {
          if (boundary === undefined) continue
          // `0` means the boundary is passing right now; the next one is tomorrow.
          const delta = (boundary - minutes + 1440) % 1440 || 1440
          candidates.push(now + delta * 60_000)
        }
      }
    }
  }

  return candidates.length === 0 ? undefined : Math.min(...candidates)
}

/**
 * Human-readable summary of a window, for the badge next to a price.
 *
 * Two shapes, because two kinds of promotion reach the catalogue: a recurring
 * daily slot (`23:00–7:50`) and a one-off span with an end (`至 …`). A window with
 * only `validUntil` has no clock time to print, and printing "all day" for it
 * would be a lie — the time is still in force until that instant.
 *
 * Returns `undefined` for a window with nothing displayable, so the caller can
 * omit the badge rather than render an empty one.
 */
export function discountWindowLabel(window: DiscountWindow, now: number): string | undefined {
  const zone = window.timezone === undefined ? '' : ` ${window.timezone}`
  if (window.daily !== undefined && window.daily.length > 0) {
    const slots = window.daily.map(slot => `${slot.start}–${slot.end}`).join(' , ')
    return `${slots}${zone}`
  }
  if (window.validUntil !== undefined) {
    // The span has a real end; show it in the reader's own clock (the only zone the
    // person at the keyboard can act on) rather than the vendor's.
    const until = Math.max(window.validUntil, now)
    const date = new Date(until)
    const pad = (value: number): string => String(value).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return undefined
}

/** The two prices a time-varying entry carries, plus when the cheaper one runs. */
export interface TimeVaryingPrice {
  /** Price in force when the catalogue was read (what the display names quote). */
  weight?: number
  /** Price outside the window. */
  baseWeight?: number
  /** Price inside the window — present only when the channel reported a window. */
  promoWeight?: number
  /** When `promoWeight` applies. */
  discountWindow?: DiscountWindow
}

/**
 * The multiplier that applies **right now**.
 *
 * Returns `undefined` when the channel never reported a price (unknown stays
 * unknown — it is not free). With no window there is nothing to switch on, so
 * the fetched price stands: that is a snapshot, and the doc says so.
 */
export function effectiveWeightOf(entry: TimeVaryingPrice, now: number): number | undefined {
  const window = entry.discountWindow
  if (window === undefined) return entry.weight
  if (isDiscountWindowActive(window, now)) return entry.promoWeight ?? entry.weight
  return entry.baseWeight ?? entry.weight
}

/**
 * Whether a model costs nothing **right now**, and at what multiplier.
 *
 * This is the whole price answer a surface needs, and it is deliberately the same
 * function the router calls (`autoRouter.ts::costSignalFor`): a badge and a
 * routing decision computed from two copies of this rule disagree the moment one
 * of them forgets the window. Three consumers, one ruler:
 *
 * - the channels page and the model list print the number;
 * - the route preview shows the bucket the menu sorts by;
 * - the router scores it.
 *
 * ## Why the static `free` flag yields to a window
 *
 * `free: true` is a conclusion drawn **at fetch time** (`weight === 0`). A model
 * that is `0` at night and `0.29` by day carries the flag either way, so reading
 * it as a constant marks all 24 hours free and `cheap` route preference keeps
 * dispatching to a metered model around the clock. With a window the flag stops
 * being a fact and the effective price decides; without one it is unchanged.
 *
 * `free` is still true when the *effective* price is 0 — a windowed promo that is
 * genuinely free inside its hours is free at those hours.
 */
export function effectiveCostOf(
  entry: TimeVaryingPrice & { free?: boolean },
  now: number,
): { free: boolean; weight?: number } {
  const weight = effectiveWeightOf(entry, now)
  const staticFree = entry.free === true && entry.discountWindow === undefined
  return { free: staticFree || weight === 0, weight }
}

/**
 * Cost factor value (0..1) for a multiplier: `2^-w`.
 *
 * The exponential is not a taste — it is the curve the bucket table was already
 * sampling. `COST_SCORE` says free (w=0) → 1, base (w=1) → 0.5 and above-base
 * (w=2) → 0.25, which is exactly `2^-w` at those three points; the old
 * below-base 0.75 is the curve at w≈0.42.
 *
 * Connecting the points matters because five buckets cannot see depth: x0.02
 * and x0.9 both fall in `below-base` and scored identically, so a 50× price
 * difference could not change a routing decision. On the curve they are 0.99 and
 * 0.54 — and the gap is what lets an off-peak discount actually win the turn.
 *
 * Clamped to [0, 16]: a promo priced at 0 or below is free (score 1), and
 * anything past x16 is "effectively unaffordable" without underflowing to 0.
 */
export function costScoreOfWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0.5
  const clamped = Math.min(16, Math.max(0, weight))
  return 2 ** -clamped
}