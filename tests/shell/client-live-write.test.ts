import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyPlannedFiles, recoverClientWrites } from '../../src/shell/clientLiveWrite.ts'

/**
 * The engine that stands between a "switch gateway" click and the user's own files.
 *
 * Each test is a claim the plain `writeFileSync` version of this feature would have made
 * falsely: that a crash mid-publish does not leave a half-written config, that the bytes
 * the user edited while we were planning are not overwritten, and that there is a copy of
 * what was there before the first time we touched the file.
 */
function sandbox(): { dir: string; data: string; target: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mp-live-'))
  const data = join(dir, 'data')
  mkdirSync(data, { recursive: true })
  return { dir, data, target: join(dir, 'config.toml') }
}

test('a first write is backed up once, and a no-op plan writes nothing', async () => {
  const { data, target } = sandbox()
  writeFileSync(target, 'model = "keep-me"\n')
  const first = await applyPlannedFiles([{ path: target, content: 'model = "keep-me"\nurl = "x"\n' }], data)
  assert.equal(readFileSync(target, 'utf8'), 'model = "keep-me"\nurl = "x"\n')
  const backups = readdirSync(join(data, 'client-backups', 'live-first-write')).filter(name => name.endsWith('.orig'))
  assert.equal(backups.length, 1, 'the .orig copy is made once; the .source marker is its sidecar')
  assert.ok(backups.some(name => name.endsWith('.orig')))
  assert.equal(readFileSync(join(data, 'client-backups', 'live-first-write', backups.find(name => name.endsWith('.orig')) as string), 'utf8'), 'model = "keep-me"\n')
  assert.ok(existsSync(`${join(data, 'client-backups', 'live-first-write', backups.find(name => name.endsWith('.orig')) as string)}.source`))

  // The same content again: not a rewrite, and not a second backup.
  const before = statSync(target).mtimeMs
  const second = await applyPlannedFiles([{ path: target, content: 'model = "keep-me"\nurl = "x"\n' }], data)
  assert.deepEqual(second.backups, [])
  assert.equal(statSync(target).mtimeMs, before, 'an unchanged plan must not touch the file')
  assert.equal(
    readdirSync(join(data, 'client-backups', 'live-first-write'))    .filter(name => name.endsWith('.orig')).length, 1)
})

test('a key-bearing file is written 0600 and the journal is gone after a clean publish', async () => {
  const { data, target } = sandbox()
  await applyPlannedFiles([{ path: target, content: 'apiKey = "secret"\n', private: true }], data)
  if (process.platform !== 'win32') {
    assert.equal(statSync(target).mode & 0o777, 0o600, 'a file holding a key is not world-readable')
  }
  assert.ok(!existsSync(join(data, 'client-write-journal.json')), 'a finished operation leaves no journal')
  assert.ok(!readdirSync(data).some(name => name.includes('modelport-tmp')), 'no temp file survives')
})

test('a delete keeps a copy of the bytes it removed', async () => {
  const { data, target } = sandbox()
  writeFileSync(target, 'login = true\n')
  await applyPlannedFiles([{ path: target, content: null }], data)
  assert.ok(!existsSync(target))
  const restored = readdirSync(join(data, 'client-backups', 'live-first-write')).filter(name => name.endsWith('.orig'))
  assert.equal(readFileSync(join(data, 'client-backups', 'live-first-write', restored[0]), 'utf8'), 'login = true\n')
})

test('crash recovery: the staged file is adopted only when the target still has the pre-write bytes', async () => {
  const { data, target } = sandbox()
  writeFileSync(target, 'before\n')
  const temp = `${target}.modelport-tmp-1-2`
  writeFileSync(temp, 'after\n')
  const journal = {
    version: 1,
    startedAt: new Date().toISOString(),
    entries: [
      { path: target, action: 'write', tempPath: temp, beforeHash: hashOf('before\n'), afterHash: hashOf('after\n') },
    ],
  }
  recoverClientWrites(data) // no journal yet: nothing happens, the target stays
  assert.equal(readFileSync(target, 'utf8'), 'before\n')

  writeFileSync(join(data, 'client-write-journal.json'), JSON.stringify(journal))
  recoverClientWrites(data)
  assert.equal(readFileSync(target, 'utf8'), 'after\n', 'the interrupted publish is finished')
  assert.ok(!existsSync(temp))
  assert.ok(!existsSync(join(data, 'client-write-journal.json')))

  // Same journal shape, but the user edited the target meanwhile: their edit wins.
  writeFileSync(target, 'edited by the user\n')
  writeFileSync(temp, 'after\n')
  writeFileSync(join(data, 'client-write-journal.json'), JSON.stringify(journal))
  recoverClientWrites(data)
  assert.equal(readFileSync(target, 'utf8'), 'edited by the user\n')
  assert.ok(!existsSync(temp), 'the staged bytes are discarded, not forced over newer content')
})

function hashOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
