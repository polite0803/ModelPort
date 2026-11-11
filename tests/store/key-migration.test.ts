import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  compareStoreSnapshot,
  orphanedPromptPayload,
  legacyBackupCandidates,
  planKeySetup,
  retiredTopLevelKeys,
} from '../../src/main/store/keyMigration.ts'

test('a machine-bound key is only planned when the OS keystore exists', () => {
  assert.equal(
    planKeySetup({ keystoreAvailable: false, keyFileExists: false, dataFileExists: true }),
    'unencrypted',
  )
  // `store.key` proves the file was sealed with a machine-bound key. A host without
  // a keystore cannot open it, and "cannot open it" must not become "corrupted".
  assert.equal(
    planKeySetup({ keystoreAvailable: false, keyFileExists: true, dataFileExists: true }),
    'sealed-unreadable',
  )
  assert.equal(
    planKeySetup({ keystoreAvailable: false, keyFileExists: true, dataFileExists: false }),
    'sealed-unreadable',
  )
})

test('plan picks reuse, migrate or create from what is on disk', () => {
  assert.equal(
    planKeySetup({ keystoreAvailable: true, keyFileExists: true, dataFileExists: true }),
    'reuse',
  )
  // a key file wins even without a data file: the install already has an identity
  assert.equal(
    planKeySetup({ keystoreAvailable: true, keyFileExists: true, dataFileExists: false }),
    'reuse',
  )
  assert.equal(
    planKeySetup({ keystoreAvailable: true, keyFileExists: false, dataFileExists: true }),
    'migrate',
  )
  assert.equal(
    planKeySetup({ keystoreAvailable: true, keyFileExists: false, dataFileExists: false }),
    'create',
  )
})

test('a faithful rewrite compares equal', () => {
  const before = { providers: [1, 2], accounts: [1], sessions: [], config: { a: 1 } }
  const after = { providers: [3, 4], accounts: [2], sessions: [], config: { a: 1 } }
  assert.deepEqual(compareStoreSnapshot(before, after), { ok: true, detail: 'ok' })
})

test('a lost key or a lost row fails the comparison and names which', () => {
  const before = { providers: [1, 2], accounts: [1], config: {} }

  const keyLost = compareStoreSnapshot(before, { providers: [1, 2], config: {} })
  assert.equal(keyLost.ok, false)
  assert.match(keyLost.detail, /accounts/)

  const rowLost = compareStoreSnapshot(before, { providers: [1], accounts: [1], config: {} })
  assert.equal(rowLost.ok, false)
  assert.match(rowLost.detail, /providers count 2 -> 1/)

  const notAnObject = compareStoreSnapshot(before, null)
  assert.equal(notAnObject.ok, false)
})

test('copies left behind are offered newest first when data.json has gone missing', () => {
  assert.deepEqual(
    legacyBackupCandidates([
      'data.json',
      'logs',
      'data.json.pre-key-migration.bak',
      'data.json.pre-key-migration.bak.1700000000000',
      'data.corrupted.1600000000000.json',
    ]),
    ['data.json.pre-key-migration.bak.1700000000000', 'data.corrupted.1600000000000.json', 'data.json.pre-key-migration.bak'],
  )

  assert.deepEqual(
    legacyBackupCandidates(['data.json', 'data.corrupted.1700000000000.json', 'data.corrupted.1600000000000.json']),
    ['data.corrupted.1700000000000.json', 'data.corrupted.1600000000000.json'],
  )

  // unrelated files never become a restore source
  assert.deepEqual(legacyBackupCandidates(['data.json', 'store.key', 'data.corrupted.json', 'backup.json']), [])
})

test('leftover prompts are only exported when there is something to keep', () => {
  assert.equal(orphanedPromptPayload(undefined), null)
  assert.equal(orphanedPromptPayload([]), null)
  assert.equal(orphanedPromptPayload({ id: 'x' }), null)

  const payload = orphanedPromptPayload([{ id: 'legacy-prompt', name: 'legacy' }])
  assert.equal(typeof payload, 'string')
  assert.deepEqual(JSON.parse(payload as string), [{ id: 'legacy-prompt', name: 'legacy' }])
})

test('a retired top-level key is reported whatever it holds', () => {
  // The live case: a `data.json` written before the session table was retired keeps its
  // empty `sessions` key forever unless startup drops it.
  assert.deepEqual(retiredTopLevelKeys({ providers: [], accounts: [], sessions: [] }), ['sessions'])
  // No released version had a writer for that table, so rows there are not user data worth
  // moving aside the way the prompt library's were - the key goes either way.
  assert.deepEqual(retiredTopLevelKeys({ sessions: [{ id: 'x' }] }), ['sessions'])
  // A file that was already migrated reports nothing to do.
  assert.deepEqual(retiredTopLevelKeys({ providers: [], accounts: [], config: {} }), [])
  // And an unreadable snapshot is never a drop list.
  assert.deepEqual(retiredTopLevelKeys(undefined), [])
  assert.deepEqual(retiredTopLevelKeys(null), [])
  assert.deepEqual(retiredTopLevelKeys('sessions'), [])
})
