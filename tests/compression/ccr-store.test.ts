/**
 * P3 acceptance — CCR (Compress-Cache-Retrieve) verifiability.
 *
 * The plan (`docs/plan/PLAN-token-compression.md` §P3) sets three boxes:
 *
 * 1. the hash in every marker retrieves the **byte-identical** original;
 * 2. 100 compressions stay inside the entry/byte budgets, and entries expire
 *    by TTL across a simulated restart;
 * 3. a store write failure means **no compression** — we never emit a marker
 *    that points at nothing.
 *
 * These tests use the real on-disk store (temp dirs), not the in-memory fake
 * the compressor suites inject, because the contract under test is precisely
 * the durability of the stash behind the hash.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CcrStore,
  getCcrStore,
  setCcrStore,
} from '../../src/main/proxy/compression/ccr/store.ts'
import {
  BLOCK_HASH_LENGTH,
  JSON_HASH_LENGTH,
} from '../../src/main/proxy/compression/ccr/markers.ts'
import { crushJsonArray } from '../../src/main/proxy/compression/compressors/smartCrusher.ts'
import { compressLog } from '../../src/main/proxy/compression/compressors/logCompressor.ts'
import { compressSearch } from '../../src/main/proxy/compression/compressors/searchCompressor.ts'
import { applyCompression } from '../../src/main/proxy/compression/index.ts'

interface StoreOptions {
  ttlMs?: number
  maxEntries?: number
  maxBytes?: number
}

/** Fresh temp-dir store; the directory is removed when `fn` returns. */
function withStore<T>(options: StoreOptions, fn: (store: CcrStore, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'modelport-ccr-'))
  try {
    return fn(new CcrStore({ dir, ...options }), dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The store logs when it disables itself; keep test output clean. */
function silenceErrors<T>(fn: () => T): T {
  const original = console.error
  console.error = () => {}
  try {
    return fn()
  } finally {
    console.error = original
  }
}

/** Set an entry's mtime into the past (TTL clock and LRU order are file times). */
function backdate(path: string, msAgo: number): void {
  const when = new Date(Date.now() - msAgo)
  utimesSync(path, when, when)
}

const liveStore =
  (store: CcrStore) => (original: string, idLength: number): string | null =>
    store.put(original, idLength)

// Fixtures mirror the compressor suites so "compression actually happened" is
// guaranteed before the CCR assertions run.

function logFixture(): string {
  const lines = ['build starting', 'compiling modules']
  for (let index = 0; index < 50; index += 1) {
    lines.push(`INFO module-${index} compiled in ${index}ms`)
  }
  lines.push('ERROR src/api/client.ts:42 build failed')
  lines.push('    at handler (src/api/client.ts:42:10)')
  lines.push('=== Summary: 51 passed, 1 failed ===')
  lines.push('build finished')
  return lines.join('\n')
}

function searchFixture(): string {
  const lines = ['searching for compression']
  for (let index = 0; index < 35; index += 1) {
    lines.push(`D:\\src\\app\\module.ts:${index + 1}: compression example ${index}`)
  }
  for (let index = 0; index < 35; index += 1) {
    lines.push(`D:\\src\\app\\render.ts:${index + 1}: compression example ${index}`)
  }
  lines.push('C:\\src\\api\\client.ts:42: compression error')
  lines.push('D:\\src\\app\\module-43-search context line')
  return lines.join('\n')
}

/** 100 near-uniform rows with two error rows — the proven crushable shape. */
function objectRows(): Array<Record<string, unknown>> {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: index,
    status: 'ok',
    duration: 10,
  }))
  rows[67] = { id: 67, status: 'ok', duration: 10, error: 'FATAL: connection reset' }
  rows[68] = { id: 68, status: 'ok', duration: 10, failure: 'timeout after 30s' }
  return rows
}

/** 300-row tool payload big enough to clear the JSON floor and the token gate. */
function toolPayload(): string {
  const rows: Array<Record<string, unknown>> = Array.from({ length: 300 }, (_, index) => ({
    id: index,
    path: `src/module-${index % 7}.ts`,
    line: index,
    match: 'export function handler()',
    status: 'ok',
  }))
  rows[150] = {
    id: 150,
    path: 'src/broken.ts',
    line: 0,
    match: 'export function handler()',
    status: 'ok',
    error: 'FATAL: unexpected token',
  }
  return JSON.stringify(rows)
}

// ---------------------------------------------------------------------------
// Acceptance 1 — the marker hash retrieves the original byte-for-byte
// ---------------------------------------------------------------------------

test('put/get round-trips the original byte-for-byte, including unicode', () => {
  withStore({}, store => {
    const content = '行一\nemoji 🚀 ünïcode "quotes"\ttab\r\nfinal line'
    const id = store.put(content, BLOCK_HASH_LENGTH)

    assert.ok(id)
    assert.equal(id, CcrStore.digest(content).slice(0, BLOCK_HASH_LENGTH))
    assert.equal(store.get(id as string), content)
  })
})

test('a JSON crush retrieves the canonical array under its 12-hex marker', () => {
  withStore({}, (store, dir) => {
    const rows = objectRows()
    const result = crushJsonArray(JSON.stringify(rows), {
      maxKeptItems: 15,
      bias: 1,
      stash: liveStore(store),
    })

    assert.equal(result.changed, true)
    assert.ok(result.ccrHash)
    assert.equal(result.ccrHash?.length, JSON_HASH_LENGTH)
    assert.ok(result.text.includes(`<<ccr:${result.ccrHash}`))

    const retrieved = store.get(result.ccrHash as string)
    assert.equal(retrieved, JSON.stringify(rows))
    assert.deepEqual(JSON.parse(retrieved as string), rows)

    // One file per entry, named exactly by the marker hash.
    assert.deepEqual(readdirSync(dir), [result.ccrHash])
  })
})

test('a log crush retrieves the exact original text under its 24-hex marker', () => {
  withStore({}, store => {
    const original = logFixture()
    const result = compressLog(original, { bias: 1, stash: liveStore(store) })

    assert.equal(result.changed, true)
    assert.ok(result.ccrHash)
    assert.equal(result.ccrHash?.length, BLOCK_HASH_LENGTH)
    assert.ok(result.text.includes(`Retrieve more: hash=${result.ccrHash}`))

    // Byte-identical, not "equal after some normalization".
    assert.equal(store.get(result.ccrHash as string), original)
  })
})

test('a search crush retrieves the exact original text', () => {
  withStore({}, store => {
    const original = searchFixture()
    const result = compressSearch(original, { bias: 1, stash: liveStore(store) })

    assert.equal(result.changed, true)
    assert.ok(result.ccrHash)
    assert.ok(result.text.includes(`Retrieve more: hash=${result.ccrHash}`))
    assert.equal(store.get(result.ccrHash as string), original)
  })
})

test('a repeated hash does not rewrite or double-count the entry', () => {
  withStore({}, (store, dir) => {
    const first = store.put('same bytes', JSON_HASH_LENGTH)
    const second = store.put('same bytes', JSON_HASH_LENGTH)

    assert.equal(first, second)
    assert.equal(store.stats().entries, 1)
    assert.equal(store.stats().writes, 2)
    assert.equal(readdirSync(dir).length, 1)
  })
})

// ---------------------------------------------------------------------------
// Acceptance 2 — budgets hold after many compressions; TTL survives restart
// ---------------------------------------------------------------------------

test('100 compressions never exceed the entry budget', () => {
  withStore({ maxEntries: 8 }, (store, dir) => {
    const ids: string[] = []
    for (let index = 0; index < 100; index += 1) {
      const id = store.put(`payload-${index}-${'x'.repeat(16)}`, BLOCK_HASH_LENGTH)
      assert.ok(id, `put ${index} failed`)
      ids.push(id as string)
      assert.ok(store.stats().entries <= 8, `entries ${store.stats().entries} after put ${index}`)
    }

    assert.ok(readdirSync(dir).length <= 8)
    // The most recent original is always still retrievable.
    assert.equal(store.get(ids[99]), `payload-99-${'x'.repeat(16)}`)
  })
})

test('100 compressions never exceed the byte budget', () => {
  withStore({ maxEntries: 1000, maxBytes: 1024 }, (store, dir) => {
    for (let index = 0; index < 100; index += 1) {
      assert.ok(store.put(`p${index}${'y'.repeat(300)}`, BLOCK_HASH_LENGTH))
      assert.ok(store.stats().bytes <= 1024, `bytes ${store.stats().bytes} after put ${index}`)
    }

    const onDisk = readdirSync(dir).reduce((sum, name) => sum + statSync(join(dir, name)).size, 0)
    assert.ok(onDisk <= 1024, `disk holds ${onDisk} bytes`)
  })
})

test('eviction drops the oldest entries first', () => {
  withStore({ maxEntries: 4 }, (store, dir) => {
    const oldest = store.put('oldest-payload', BLOCK_HASH_LENGTH) as string
    const older = store.put('older-payload', BLOCK_HASH_LENGTH) as string
    const third = store.put('third-payload', BLOCK_HASH_LENGTH) as string
    const fourth = store.put('fourth-payload', BLOCK_HASH_LENGTH) as string

    // Distinct, provably-older mtimes so the LRU order is deterministic.
    backdate(join(dir, oldest), 4000)
    backdate(join(dir, older), 3000)

    // Each of these crosses the budget once and evicts exactly one victim.
    const fifth = store.put('fifth-payload', BLOCK_HASH_LENGTH) as string
    const sixth = store.put('sixth-payload', BLOCK_HASH_LENGTH) as string

    assert.equal(store.get(oldest), undefined, 'oldest must be evicted')
    assert.equal(store.get(older), undefined, 'second-oldest must be evicted')
    for (const id of [third, fourth, fifth, sixth]) {
      assert.ok(store.get(id), `${id} must survive`)
    }
    assert.equal(readdirSync(dir).length, 4)
  })
})

test('entries expire by TTL', () => {
  withStore({ ttlMs: 1000 }, (store, dir) => {
    const id = store.put('will expire', BLOCK_HASH_LENGTH) as string
    backdate(join(dir, id), 5000)

    assert.equal(store.get(id), undefined)
    assert.equal(readdirSync(dir).length, 0, 'expired entry is deleted on miss')
    assert.equal(store.stats().misses, 1)
  })
})

test('a fresh store over the same directory reads pre-restart entries; TTL still applies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelport-ccr-restart-'))
  try {
    const first = new CcrStore({ dir })
    const keptId = first.put('survives restart', BLOCK_HASH_LENGTH) as string
    const doomedId = first.put('doomed after restart', BLOCK_HASH_LENGTH) as string
    backdate(join(dir, doomedId), 120_000)

    // Simulated restart: brand-new instance, counters lost, disk is the truth.
    const reopened = new CcrStore({ dir, ttlMs: 60_000 })
    assert.equal(reopened.get(keptId), 'survives restart')
    assert.equal(reopened.get(doomedId), undefined, 'backdated entry expires under TTL')

    reopened.sweep()
    assert.deepEqual(readdirSync(dir), [keptId])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sweep deletes every expired entry in one pass', () => {
  withStore({ ttlMs: 1000 }, (store, dir) => {
    const ids = ['a', 'b', 'c'].map(key => store.put(`entry-${key}`, BLOCK_HASH_LENGTH) as string)
    for (const id of ids.slice(0, 2)) backdate(join(dir, id), 5000)

    store.sweep()

    assert.equal(readdirSync(dir).length, 1)
    assert.equal(store.get(ids[2]), 'entry-c')
  })
})

// ---------------------------------------------------------------------------
// Acceptance 3 — a failed write refuses compression; no marker points at air
// ---------------------------------------------------------------------------

test('a store whose directory cannot be created refuses every put', () => {
  const root = mkdtempSync(join(tmpdir(), 'modelport-ccr-blocked-'))
  try {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'a file where a directory must be')

    silenceErrors(() => {
      const store = new CcrStore({ dir: join(blocker, 'ccr') })
      assert.equal(store.put('anything', BLOCK_HASH_LENGTH), null)
      assert.equal(store.get('a'.repeat(24)), undefined)
      store.sweep() // must not throw
      assert.equal(store.stats().entries, 0)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an oversized payload is refused rather than stashed', () => {
  withStore({}, store => {
    const huge = 'z'.repeat(8 * 1024 * 1024 + 1)
    assert.equal(store.put(huge, BLOCK_HASH_LENGTH), null)
    assert.equal(store.stats().entries, 0)
  })
})

test('every compressor refuses to compress when the stash returns null', () => {
  const refuse = (): null => null

  const json = crushJsonArray(JSON.stringify(objectRows()), {
    maxKeptItems: 15,
    bias: 1,
    stash: refuse,
  })
  assert.equal(json.changed, false)
  assert.equal(json.strategy, 'ccr_unavailable')

  const log = compressLog(logFixture(), { bias: 1, stash: refuse })
  assert.equal(log.changed, false)
  assert.equal(log.strategy, 'ccr_unavailable')

  const search = compressSearch(searchFixture(), { bias: 1, stash: refuse })
  assert.equal(search.changed, false)
  assert.equal(search.strategy, 'ccr_unavailable')
})

test('applyCompression compresses with a healthy store and forwards verbatim with a broken one', () => {
  const payload = toolPayload()
  const messages = [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'user', content: 'search the codebase for handler' },
    { role: 'assistant', content: 'running grep' },
    { role: 'tool', content: payload },
  ]
  const config = { enabled: true, aggressiveness: 'moderate' } as const

  // Baseline: this exact payload DOES compress when the store works, so the
  // broken-store result below proves refusal, not just a payload too small.
  const healthyDir = mkdtempSync(join(tmpdir(), 'modelport-ccr-e2e-ok-'))
  let baselineHash: string | undefined
  try {
    setCcrStore(new CcrStore({ dir: healthyDir }))
    const healthy = applyCompression({ messages, config })
    assert.deepEqual(healthy.report?.applied, ['json'])
    baselineHash = healthy.report?.ccrHashes?.[0]
    assert.ok(baselineHash)

    // The bytes behind that marker are retrievable from the same store.
    assert.equal(getCcrStore().get(baselineHash as string), payload)
  } finally {
    setCcrStore(undefined)
    rmSync(healthyDir, { recursive: true, force: true })
  }

  const root = mkdtempSync(join(tmpdir(), 'modelport-ccr-e2e-bad-'))
  try {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'not a directory')

    silenceErrors(() => {
      setCcrStore(new CcrStore({ dir: join(blocker, 'ccr') }))
      try {
        const outcome = applyCompression({ messages, config })

        // Same array reference, byte-identical tool message, nothing applied:
        // no marker can dangle because no rewrite happened at all.
        assert.equal(outcome.messages, messages)
        assert.equal((outcome.messages as typeof messages)[3].content, payload)
        assert.equal(outcome.report?.applied.length, 0)
        assert.ok(!outcome.report?.ccrHashes)
      } finally {
        setCcrStore(undefined)
      }
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a marker-bearing payload is never re-compressed (idempotency guard)', () => {
  withStore({}, store => {
    const rows = objectRows()
    const first = crushJsonArray(JSON.stringify(rows), {
      maxKeptItems: 15,
      bias: 1,
      stash: liveStore(store),
    })
    assert.equal(first.changed, true)

    const second = crushJsonArray(first.text, {
      maxKeptItems: 15,
      bias: 1,
      stash: liveStore(store),
    })
    assert.equal(second.changed, false)
    assert.equal(second.strategy, 'already_compressed')

    // The single surviving handle still resolves to the true original.
    assert.equal(store.get(first.ccrHash as string), JSON.stringify(rows))
  })
})

// ---------------------------------------------------------------------------
// Store hygiene — input validation and the shared singleton
// ---------------------------------------------------------------------------

test('malformed ids are rejected before any filesystem access', () => {
  withStore({}, store => {
    for (const bad of [
      '',
      '..\\..\\windows\\system32',
      'A'.repeat(12),
      'f'.repeat(11),
      'f'.repeat(65),
    ]) {
      assert.equal(store.get(bad), undefined)
    }
    // Rejected by the pattern guard, never counted as disk misses.
    assert.equal(store.stats().misses, 0)
  })
})

test('the shared singleton is stable and replaceable via the test seam', () => {
  const before = getCcrStore()
  assert.equal(getCcrStore(), before)
  try {
    withStore({}, store => {
      setCcrStore(store)
      assert.equal(getCcrStore(), store)
    })
  } finally {
    setCcrStore(undefined)
  }
  // Clearing the seam makes the lazy default come back, and it is stable again.
  const fresh = getCcrStore()
  assert.equal(getCcrStore(), fresh)
})
