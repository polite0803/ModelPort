import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The renderer bundle has to run in a browser tab, not only inside an Electron window.
 *
 * Electron hands every renderer and preload context a `process` global, so a bare
 * `process.platform` looks harmless in `npm run dev` and is fatal once the headless daemon
 * serves the same files: the module throws at evaluation time, React never mounts, and the
 * window sits black with nothing in the console to point at it. That is exactly how the
 * `/ui` hosting shipped broken until the shell was opened against a real daemon.
 */
const BARE_PROCESS = /(?<![\w$.])process\./g

/** Indices of every unguarded `process.` reference. */
function unguardedSites(text: string): number[] {
  const sites: number[] = []
  for (const match of text.matchAll(BARE_PROCESS)) {
    const before = text.slice(Math.max(0, match.index! - 48), match.index)
    if (!before.includes('typeof process')) sites.push(match.index!)
  }
  return sites
}

const assetsDir = join('out', 'renderer', 'assets')
const chunks = readdirSync(assetsDir).filter(name => name.endsWith('.js'))

test('every renderer chunk references process only behind a typeof guard', () => {
  assert.ok(chunks.length > 0, 'npm run build must emit the renderer chunks')
  for (const chunk of chunks) {
    const sites = unguardedSites(readFileSync(join(assetsDir, chunk), 'utf8'))
    assert.equal(sites.length, 0, `${chunk} would throw "process is not defined" in a browser`)
  }
})

test('the guard is what satisfies it, not the checker', () => {
  const guarded = 'platform: typeof process === "undefined" ? "browser" : process.platform'
  assert.equal(unguardedSites(guarded).length, 0)
  // The same text with the guard removed is what the build used to emit.
  assert.equal(unguardedSites('platform: process.platform').length, 1)
})
