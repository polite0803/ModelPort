/**
 * SQLite access for the two clients that keep their endpoint in a VSCode-fork
 * `state.vscdb` (TRAE CN, CodeBuddy CN).
 *
 * Three rules, all of them about not losing the user's state:
 * - **The app must be closed.** A VSCode fork holds global state in memory and writes the
 *   whole table back on exit, so an external write while it runs is silently discarded.
 *   The caller checks the process; this file checks the sidecars, because a non-empty
 *   `-wal` means committed pages this reader would not see.
 * - **Backup before write, verify after.** The export is a whole-file rewrite, so the
 *   original is kept next to it and the result is reopened and compared before the call
 *   reports success.
 * - **Preserve the storage class.** `ItemTable.value` has BLOB affinity but the fork binds
 *   strings, so a value read as text is written back as text and one read as bytes as
 *   bytes. Re-typing every row would be a change nobody asked for.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import type { SqlJsDatabase, SqlJsStatic } from 'sql.js/dist/sql-wasm-inline.js'

export interface SqliteItem {
  key: string
  value: string
}

let engine: Promise<SqlJsStatic> | null = null

/** Loaded on first use: a console that never syncs a fork never pays for the wasm. */
function sqlEngine(): Promise<SqlJsStatic> {
  if (!engine) {
    engine = import('sql.js/dist/sql-wasm-inline.js').then(module => module.default())
  }
  return engine
}

/**
 * A non-empty `-wal` / `-shm` means the database has pages outside the main file.
 * Returns the offending path, or null when the file is self-contained.
 */
export function sqliteSidecar(dbPath: string): string | null {
  for (const suffix of ['-wal', '-shm']) {
    const path = `${dbPath}${suffix}`
    if (!existsSync(path)) continue
    if (statSync(path).size > 0) return path
  }
  return null
}

function decode(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return String(value ?? '')
}

async function open(dbPath: string): Promise<SqlJsDatabase> {
  const SQL = await sqlEngine()
  return new SQL.Database(readFileSync(dbPath))
}

/** Reads the given keys; absent keys are simply missing from the map. */
export async function readSqliteItems(dbPath: string, keys: string[]): Promise<Map<string, string>> {
  const db = await open(dbPath)
  try {
    const found = new Map<string, string>()
    for (const key of keys) {
      const result = db.exec(`SELECT value FROM ItemTable WHERE key = '${key.replace(/'/g, "''")}'`)
      const value = result[0]?.values[0]?.[0]
      if (value !== undefined) found.set(key, decode(value))
    }
    return found
  } finally {
    db.close()
  }
}

/**
 * Reads every key matching a SQL LIKE pattern.
 *
 * Needed because TRAE prefixes its keys with the signed-in account id and uses two
 * separators (`<id>:AI.agent.model.model_list_map` and `<id>_AI.agent.model.model_list_map`),
 * so there is no single key name to ask for.
 */
export async function readSqliteItemsLike(dbPath: string, pattern: string): Promise<Map<string, string>> {
  const db = await open(dbPath)
  try {
    const result = db.exec(`SELECT key, value FROM ItemTable WHERE key LIKE '${pattern.replace(/'/g, "''")}'`)
    const found = new Map<string, string>()
    for (const row of result[0]?.values ?? []) found.set(String(row[0]), decode(row[1]))
    return found
  } finally {
    db.close()
  }
}

function backupPath(dbPath: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `${dbPath}.bak-${stamp}`
}

/**
 * Rewrites the given ItemTable rows and returns the backup path.
 *
 * Throws before touching anything when a sidecar is present, and throws after writing
 * when the reopened file does not contain exactly what was asked for - in both cases the
 * backup (or the untouched original) is what remains.
 */
export async function writeSqliteItems(dbPath: string, items: SqliteItem[]): Promise<{ backup: string }> {
  const sidecar = sqliteSidecar(dbPath)
  if (sidecar !== null) {
    throw new Error(`${sidecar} 非空：数据库还有未合并的页，先正常退出客户端再试`)
  }
  if (items.length === 0) return { backup: '' }

  const backup = backupPath(dbPath)
  copyFileSync(dbPath, backup)

  const db = await open(dbPath)
  let bytes: Uint8Array
  try {
    for (const item of items) {
      const existing = db.exec(`SELECT value, typeof(value) FROM ItemTable WHERE key = '${item.key.replace(/'/g, "''")}'`)
      const kind = existing[0]?.values[0]?.[1]
      // `blob` is the only class that must go back as bytes; text and everything else
      // the fork wrote as a string.
      const param = kind === 'blob' ? Buffer.from(item.value, 'utf8') : item.value
      db.run('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', [item.key, param])
    }
    bytes = db.export()
  } finally {
    db.close()
  }

  const temp = `${dbPath}.tmp-${process.pid}`
  writeFileSync(temp, bytes)
  renameSync(temp, dbPath)

  const verify = await open(dbPath)
  try {
    for (const item of items) {
      const result = verify.exec(`SELECT value FROM ItemTable WHERE key = '${item.key.replace(/'/g, "''")}'`)
      const value = result[0]?.values[0]?.[0]
      if (value === undefined || decode(value) !== item.value) {
        throw new Error(`写入后校验失败：${item.key} 不是预期内容，原文件已备份到 ${backup}`)
      }
    }
  } finally {
    verify.close()
  }
  return { backup }
}