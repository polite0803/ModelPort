/**
 * CCR (Compress-Cache-Retrieve) store.
 *
 * Content-addressed, on-disk, bounded. One file per entry, named by the hash id
 * that the marker in the prompt carries, so a retrieval is a single `readFile`
 * and never a directory scan.
 *
 * Two rules matter and are both easy to get wrong:
 *
 * 1. **A failed write aborts the compression.** A marker whose original was
 *    never stored is worse than no compression at all: the model follows the
 *    hash and finds nothing, and the bytes are gone. `put()` returns `null` on
 *    any failure and the caller forwards the original.
 * 2. **Writes are synchronous by design.** The compressor is a synchronous
 *    function on the hot path, and an async write would let a request return
 *    before its own original was durable. Writes are rare (only when a
 *    compression actually lands) and small, so the blocking cost is bounded.
 *
 * Path: `~/.modelport/ccr/` — same root as `data.json`, so it follows the
 * existing install and needs no extra directory choice.
 */

import { createHash } from 'crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Defaults are sized for a *conversation*, not for a request.
 *
 * The marker travels in the conversation, so the pointer must outlive any single
 * turn: 30 minutes was shorter than a typical agent session, which is how a
 * marker ended up pointing at bytes that had already been swept. A day covers
 * the long tail; the byte budget is what actually bounds the disk.
 */
export const CCR_DEFAULTS = {
  ttlMs: 24 * 60 * 60 * 1000,
  maxEntries: 2000,
  maxBytes: 256 * 1024 * 1024,
} as const

const DEFAULT_TTL_MS = CCR_DEFAULTS.ttlMs
const DEFAULT_MAX_ENTRIES = CCR_DEFAULTS.maxEntries
const DEFAULT_MAX_BYTES = CCR_DEFAULTS.maxBytes
/** Never stash a single payload larger than this; refuse instead. */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024
/** Sweep at most once per this many writes, in addition to budget triggers. */
const SWEEP_EVERY_WRITES = 50

export interface CcrStats {
  entries: number
  bytes: number
  hits: number
  misses: number
  writes: number
}

export class CcrStore {
  private readonly dir: string
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly maxBytes: number

  private entries = 0
  private bytes = 0
  private writes = 0
  private hits = 0
  private misses = 0
  private ready = false
  private disabled = false

  constructor(options: {
    dir?: string
    ttlMs?: number
    maxEntries?: number
    maxBytes?: number
  } = {}) {
    this.dir = options.dir ?? join(homedir(), '.modelport', 'ccr')
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  }

  private ensureDir(): boolean {
    if (this.ready) return true
    if (this.disabled) return false
    try {
      mkdirSync(this.dir, { recursive: true })
      this.ready = true
      return true
    } catch (error) {
      // A read-only home (or a hostile sandbox) must not break every request:
      // disable the store and let compression fail open from then on.
      this.disabled = true
      console.error('[Compression] CCR store unavailable, compression disabled:', error)
      return false
    }
  }

  /** Stable id for `content`: the first `idLength` hex chars of its SHA-256. */
  static digest(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex')
  }

  /**
   * Stash `content` and return the id to embed in a marker, or `null` when it
   * could not be stored (caller must then NOT compress).
   */
  put(content: string, idLength: number): string | null {
    if (!this.ensureDir()) return null

    const payload = Buffer.from(content, 'utf8')
    if (payload.byteLength > MAX_ENTRY_BYTES) return null

    const id = CcrStore.digest(content).slice(0, idLength)
    const path = join(this.dir, id)

    try {
      // `wx` semantics via the exists check keep a repeated hash from
      // rewriting (and re-dating) an entry that is already there.
      let already = false
      try {
        statSync(path)
        already = true
      } catch {
        already = false
      }
      if (!already) {
        writeFileSync(path, payload)
        this.entries += 1
        this.bytes += payload.byteLength
      }
      this.writes += 1
      if (this.writes % SWEEP_EVERY_WRITES === 0 || this.overBudget()) {
        this.sweep()
      }
      return id
    } catch (error) {
      console.error('[Compression] CCR put failed, refusing to compress:', error)
      return null
    }
  }

  /**
   * Retrieve the original bytes for `id`, or `undefined` when absent/expired.
   *
   * A hit refreshes the file's mtime, so TTL and eviction both mean "time since
   * last *use*". Without that, an entry read on every turn would still be
   * evicted for being old, and the sweep would keep deleting the pointers that
   * are actually being followed.
   */
  get(id: string): string | undefined {
    if (!/^[a-f0-9]{12,64}$/.test(id)) return undefined
    if (!this.ensureDir()) return undefined

    const path = join(this.dir, id)
    try {
      const stat = statSync(path)
      if (this.isExpired(stat.mtimeMs)) {
        unlinkSync(path)
        this.misses += 1
        return undefined
      }
      const content = readFileSync(path, 'utf8')
      const now = new Date()
      try {
        utimesSync(path, now, now)
      } catch {
        // Recency is an optimisation; a read-only entry is still a valid hit.
      }
      this.hits += 1
      return content
    } catch {
      this.misses += 1
      return undefined
    }
  }

  stats(): CcrStats {
    return {
      entries: this.entries,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      writes: this.writes,
    }
  }

  private isExpired(mtimeMs: number): boolean {
    return this.ttlMs > 0 && Date.now() - mtimeMs > this.ttlMs
  }

  private overBudget(): boolean {
    return this.entries > this.maxEntries || this.bytes > this.maxBytes
  }

  /**
   * Drop expired entries, then evict oldest-first until back inside both
   * budgets. Best-effort: a failure here must never fail a request, so every
   * per-entry error is swallowed and the counters are recomputed from disk.
   */
  sweep(): void {
    if (!this.ensureDir()) return

    try {
      const names = readdirSync(this.dir)
      const live: Array<{ name: string; mtimeMs: number; size: number }> = []
      let bytes = 0

      for (const name of names) {
        const path = join(this.dir, name)
        try {
          const stat = statSync(path)
          if (!stat.isFile()) continue
          if (this.isExpired(stat.mtimeMs)) {
            unlinkSync(path)
            continue
          }
          live.push({ name, mtimeMs: stat.mtimeMs, size: stat.size })
          bytes += stat.size
        } catch {
          // Entry vanished between readdir and stat — nothing to do.
        }
      }

      if (live.length > this.maxEntries || bytes > this.maxBytes) {
        live.sort((a, b) => a.mtimeMs - b.mtimeMs)
        let entries = live.length
        while (live.length > 0 && (entries > this.maxEntries || bytes > this.maxBytes)) {
          const victim = live.shift()
          if (!victim) break
          try {
            unlinkSync(join(this.dir, victim.name))
            bytes -= victim.size
            entries -= 1
          } catch {
            // Already gone.
          }
        }
      }

      this.entries = Math.min(live.length, this.maxEntries)
      this.bytes = Math.max(0, bytes)
    } catch (error) {
      console.error('[Compression] CCR sweep failed:', error)
    }
  }
}

let shared: CcrStore | undefined

/** Process-wide store; one directory, one budget. */
export function getCcrStore(): CcrStore {
  if (!shared) shared = new CcrStore()
  return shared
}

/** Test seam: replace the shared store. */
export function setCcrStore(store: CcrStore | undefined): void {
  shared = store
}
