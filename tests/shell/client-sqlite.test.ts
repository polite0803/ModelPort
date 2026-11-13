import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

import { readSqliteItems, readSqliteItemsLike, sqliteSidecar, writeSqliteItems } from '../../src/shell/clientSqlite.ts'

const require = createRequire(import.meta.url)

/**
 * A real SQLite file, not a mock: the whole point of this writer is that a VSCode fork
 * can still read what it produced. The fixture uses the fork's own schema
 * (`ItemTable(key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)`) and account-prefixed keys
 * in both separator variants measured in TRAE CN.
 */
async function fixture(rows: [string, string][]): Promise<{ dir: string; dbPath: string }> {
  const initSqlJs = require('sql.js/dist/sql-wasm-inline.js') as () => Promise<{
    Database: new (data?: ArrayLike<number> | null) => { run(sql: string, params?: unknown[]): void; export(): Uint8Array; close(): void }
  }>
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')
  for (const [key, value] of rows) db.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', [key, value])
  const dir = mkdtempSync(join(tmpdir(), 'mp-sqlite-'))
  const dbPath = join(dir, 'state.vscdb')
  writeFileSync(dbPath, Buffer.from(db.export()))
  db.close()
  return { dir, dbPath }
}

const MAP_KEY = '4035664558954057:AI.agent.model.model_list_map'
const MAP_KEY_ALT = '4035664558954057_AI.agent.model.model_list_map'

test('reads the account-prefixed keys in both separator variants', async () => {
  const { dbPath } = await fixture([
    [MAP_KEY, '{"agent":[]}'],
    [MAP_KEY_ALT, '{"builder":[]}'],
    ['unrelated', 'keep'],
  ])
  const found = await readSqliteItemsLike(dbPath, '%AI.agent.model.model_list_map')
  assert.equal(found.size, 2)
  assert.equal(found.get(MAP_KEY), '{"agent":[]}')
  assert.equal(found.get(MAP_KEY_ALT), '{"builder":[]}')
  const exact = await readSqliteItems(dbPath, [MAP_KEY, 'absent'])
  assert.equal(exact.size, 1)
  assert.equal(exact.get(MAP_KEY), '{"agent":[]}')
})

test('a write backs up, replaces only the named rows, and keeps every other row', async () => {
  const { dbPath } = await fixture([
    [MAP_KEY, '{"old":true}'],
    ['workbench.state', 'untouched'],
    ['secret://blob', 'also untouched'],
  ])
  const before = readFileSync(dbPath)
  const { backup } = await writeSqliteItems(dbPath, [{ key: MAP_KEY, value: '{"new":true}' }])
  assert.ok(backup.startsWith(dbPath))
  assert.ok(existsSync(backup))
  assert.deepEqual(readFileSync(backup), before)

  const after = await readSqliteItems(dbPath, [MAP_KEY, 'workbench.state', 'secret://blob'])
  assert.equal(after.get(MAP_KEY), '{"new":true}')
  assert.equal(after.get('workbench.state'), 'untouched')
  assert.equal(after.get('secret://blob'), 'also untouched')
})

test('the written file is still a SQLite database the fork can open', async () => {
  const { dbPath } = await fixture([[MAP_KEY, 'v1']])
  await writeSqliteItems(dbPath, [{ key: MAP_KEY, value: 'v2' }])
  const initSqlJs = require('sql.js/dist/sql-wasm-inline.js') as () => Promise<{
    Database: new (data?: ArrayLike<number> | null) => { exec(sql: string): { values: unknown[][] }[]; close(): void }
  }>
  const SQL = await initSqlJs()
  const db = new SQL.Database(readFileSync(dbPath))
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")
  assert.deepEqual(tables[0].values, [['ItemTable']])
  const count = db.exec('SELECT count(*) FROM ItemTable')
  assert.equal(count[0].values[0][0], 1)
  db.close()
})

test('a non-empty -wal refuses the write and leaves the original alone', async () => {
  const { dbPath } = await fixture([[MAP_KEY, 'original']])
  writeFileSync(`${dbPath}-wal`, 'unmerged pages')
  assert.equal(sqliteSidecar(dbPath), `${dbPath}-wal`)
  const before = readFileSync(dbPath)
  await assert.rejects(() => writeSqliteItems(dbPath, [{ key: MAP_KEY, value: 'changed' }]), /未合并的页/)
  assert.deepEqual(readFileSync(dbPath), before)
})

test('an empty -shm is not a reason to refuse', async () => {
  const { dbPath } = await fixture([[MAP_KEY, 'original']])
  writeFileSync(`${dbPath}-shm`, '')
  assert.equal(sqliteSidecar(dbPath), null)
  await writeSqliteItems(dbPath, [{ key: MAP_KEY, value: 'changed' }])
  assert.equal((await readSqliteItems(dbPath, [MAP_KEY])).get(MAP_KEY), 'changed')
})

test('writing nothing is a no-op with no backup', async () => {
  const { dbPath } = await fixture([[MAP_KEY, 'original']])
  const { backup } = await writeSqliteItems(dbPath, [])
  assert.equal(backup, '')
  assert.equal((await readSqliteItems(dbPath, [MAP_KEY])).get(MAP_KEY), 'original')
})

test('a new key is inserted, not silently dropped', async () => {
  const { dbPath } = await fixture([[MAP_KEY, 'original']])
  await writeSqliteItems(dbPath, [{ key: 'brand-new', value: 'added' }])
  const found = await readSqliteItems(dbPath, [MAP_KEY, 'brand-new'])
  assert.equal(found.size, 2)
  assert.equal(found.get('brand-new'), 'added')
})