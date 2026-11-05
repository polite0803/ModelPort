import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'

// `src/main/**` uses bundler-style extensionless imports, so it needs the same
// resolve hooks the in-process route harness registers; registered here before any
// `await import()` of src.
register(new URL('../routes/loader-hooks.mjs', import.meta.url))

/**
 * A keystore-less host (the WSL daemon) pointed at a data directory that was sealed
 * on another machine must refuse, not "recover".
 *
 * Why this needs its own file: `planKeySetup` returning `sealed-unreadable` is only
 * half of it. The other half is that the refusal lands *before* the corrupted-data
 * backup, because `recoverFromCorruptedData()` renames `data.json` and writes a fresh
 * empty store - which, with credentials in that file, reads to the user as "my
 * providers disappeared" rather than "this host cannot open them".
 *
 * This runs the real `storeManager` against a temp home, with the same Node host the
 * daemon binds (no keystore ⇒ the documented plaintext branch).
 */
test('a sealed data.json survives a keystore-less host untouched', async () => {
  const home = mkdtempSync(join(tmpdir(), 'modelport-sealed-'))
  const storage = join(home, '.modelport')
  mkdirSync(storage, { recursive: true })
  // binary-ish bytes: what a machine-bound ciphertext file looks like to a host
  // that cannot open it, and exactly what `conf` would call a parse failure.
  writeFileSync(join(storage, 'data.json'), Buffer.from([0x01, 0x02, 0xff, 0xfe, 0x00, 0x7b]))
  writeFileSync(join(storage, 'store.key'), 'c2VhbGVkLWJ5LWEta2V5c3RvcmU=')

  process.env.USERPROFILE = home
  process.env.HOME = home

  const { setHost, createNodeHost } = await import('../../src/main/runtime/host.ts')
  setHost(createNodeHost({ version: '0.0.0-test', resourceRoot: home }))

  const { storeManager } = await import('../../src/main/store/store.ts')
  // `initialize()` rethrows for this case: a caller that kept serving after it would
  // be serving an empty store while the real file sits unopened next to it.
  await assert.rejects(
    () => storeManager.initialize(),
    /machine-bound key/,
    'the refusal must reach the caller, not be swallowed into a warning',
  )

  assert.ok(storeManager.hasInitializationError(), 'init must fail rather than start an empty store')
  assert.match(
    storeManager.getInitializationError()?.message ?? '',
    /machine-bound key/,
    'the failure has to name the cause and the host difference, not just "corrupted"',
  )
  assert.ok(
    existsSync(join(storage, 'data.json')),
    'the sealed file must still be at its own path',
  )
  assert.equal(
    readdirSync(storage).filter(name => name.startsWith('data.corrupted')).length,
    0,
    'no corrupted-data backup may be created: that rename is how the store would get replaced',
  )
})
