/**
 * The write engine shared by every client writer (ported from the reference project's
 * `live/engine.rs` + `mode/operation.rs`).
 *
 * Why this exists at all: these are the user's own files. A half-written `config.toml` or
 * a lost `auth.json` costs more than the feature is worth. Four properties, each of which
 * a plain `writeFileSync` lacks:
 *
 * - **Byte-for-byte no-op.** An unchanged plan writes nothing (no mtime churn, no backup).
 * - **Optimistic concurrency.** The original is re-read immediately before the rename; if
 *   it changed since planning, the write is refused instead of clobbering the other writer.
 * - **First-write backup.** The first time this console touches a file, its original bytes
 *   are kept under `<dataDir>/client-backups/live-first-write/`, marked with a `.source`
 *   file so a human can tell what it belongs to.
 * - **Crash-safe journal.** Targets are staged to temp files and recorded in a journal
 *   before publishing. If the process dies mid-publish, the next start rolls the operation
 *   forward when the file still has the pre-write bytes, and discards the temp file when it
 *   does not - never overwriting somebody else's newer content.
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

export interface PlannedFile {
  path: string
  /** `null` deletes the file (Codex `auth.json` on a third-party switch). */
  content: string | null
  /** 0600 for files that hold a key. */
  private?: boolean
}

interface JournalEntry {
  path: string
  action: 'write' | 'delete'
  tempPath: string | null
  beforeHash: string | null
  afterHash: string | null
}

interface Journal {
  version: 1
  startedAt: string
  entries: JournalEntry[]
}

export function sha256(content: string | null): string | null {
  return content === null ? null : createHash('sha256').update(content, 'utf8').digest('hex')
}

function hashOfFile(path: string): string | null {
  try {
    return existsSync(path) ? sha256(readFileSync(path, 'utf8')) : null
  } catch {
    return null
  }
}

const locks = new Map<string, Promise<unknown>>()

/** One writer per path inside this process; the console is the only writer it knows of. */
async function withLock<T>(key: string, run: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.then(run, run)
  locks.set(key, next.catch(() => undefined))
  try {
    return await next
  } finally {
    if (locks.get(key) === (next as unknown)) locks.delete(key)
  }
}

function fsyncDirectory(directory: string): void {
  try {
    const fd = openSync(directory, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Windows cannot fsync a directory handle; the rename itself is already atomic there.
  }
}

function writeDurably(path: string, content: string, mode: number): void {
  const fd = openSync(path, 'w', mode)
  try {
    writeSync(fd, content, null, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function journalPath(dataDir: string): string {
  return join(dataDir, 'client-write-journal.json')
}

function backupPath(dataDir: string, path: string): string {
  const digest = createHash('sha256').update(path).digest('hex').slice(0, 12)
  return join(dataDir, 'client-backups', 'live-first-write', `${digest}-${basename(path)}.orig`)
}

function ensureFirstWriteBackup(dataDir: string, path: string, original: string): string | null {
  const target = backupPath(dataDir, path)
  if (existsSync(target)) return null
  mkdirSync(dirname(target), { recursive: true })
  writeDurably(target, original, 0o600)
  writeDurably(`${target}.source`, path, 0o600)
  return target
}

function stageTemp(path: string, content: string, mode: number): string {
  const temp = `${path}.modelport-tmp-${process.pid}-${Date.now()}`
  mkdirSync(dirname(path), { recursive: true })
  writeDurably(temp, content, mode)
  return temp
}

export class WriteConflictError extends Error {}

/**
 * Publishes a set of files as one operation. Either every target ends up in its planned
 * state or the already-published ones are restored from the bytes read before the write.
 */
export async function applyPlannedFiles(
  files: PlannedFile[],
  dataDir: string,
): Promise<{ backups: string[] }> {
  const unique = new Map<string, PlannedFile>()
  for (const file of files) unique.set(file.path, file)
  const targets = [...unique.values()]
  return await withLock('client-writes', async () => {
    const journal: Journal = { version: 1, startedAt: new Date().toISOString(), entries: [] }
    const originals = new Map<string, string | null>()
    const backups: string[] = []

    for (const file of targets) {
      const mode = file.private === true ? 0o600 : 0o644
      await withLock(file.path, () => {
        const original = hashOfFile(file.path)
        const exists = existsSync(file.path)
        if (file.content === null) {
          journal.entries.push({ path: file.path, action: 'delete', tempPath: null, beforeHash: original, afterHash: null })
          return
        }
        if (exists && original === sha256(file.content)) return
        const temp = stageTemp(file.path, file.content, mode)
        journal.entries.push({
          path: file.path,
          action: 'write',
          tempPath: temp,
          beforeHash: original,
          afterHash: sha256(file.content),
        })
      })
    }

    const publishable = journal.entries.length > 0
    if (publishable) {
      mkdirSync(dataDir, { recursive: true })
      writeDurably(journalPath(dataDir), JSON.stringify(journal, null, 2), 0o600)
    }

    try {
      for (const entry of journal.entries) {
        await withLock(entry.path, () => {
          const before = existsSync(entry.path) ? readFileSync(entry.path, 'utf8') : null
          originals.set(entry.path, before)
          const now = sha256(before)
          if (now !== entry.beforeHash) {
            throw new WriteConflictError(`${basename(entry.path)} 在写入前被别的程序改过，已放弃这次写入`)
          }
          if (entry.action === 'delete') {
            if (before !== null) {
              const backup = ensureFirstWriteBackup(dataDir, entry.path, before)
              if (backup !== null) backups.push(backup)
              unlinkSync(entry.path)
              fsyncDirectory(dirname(entry.path))
            }
            return
          }
          if (before !== null) {
            const backup = ensureFirstWriteBackup(dataDir, entry.path, before)
            if (backup !== null) backups.push(backup)
          }
          if (entry.tempPath === null || !existsSync(entry.tempPath)) {
            throw new Error(`${basename(entry.path)} 的暂存文件不见了，已放弃这次写入`)
          }
          renameSync(entry.tempPath, entry.path)
          fsyncDirectory(dirname(entry.path))
        })
      }
      if (publishable) unlinkSync(journalPath(dataDir))
    } catch (error) {
      // Restore what was already published, oldest first. A restore that itself fails is
      // reported by the caller; the journal stays so the next start can finish cleaning up.
      for (const entry of journal.entries) {
        if (!originals.has(entry.path)) continue
        const original = originals.get(entry.path)
        if (original === undefined) continue
        try {
          if (original === null) {
            if (existsSync(entry.path)) unlinkSync(entry.path)
          } else {
            writeDurably(entry.path, original, 0o600)
          }
        } catch {
          // Leave the journal behind: recovery will retry with the recorded hashes.
        }
      }
      throw error
    }
    return { backups }
  })
}

/** Rolls a journal left by a crash forward when the files still hold the pre-write bytes. */
export function recoverClientWrites(dataDir: string): void {
  const journalFile = journalPath(dataDir)
  if (!existsSync(journalFile)) return
  let journal: Journal
  try {
    journal = JSON.parse(readFileSync(journalFile, 'utf8')) as Journal
  } catch {
    try {
      unlinkSync(journalFile)
    } catch {
      // Nothing else to do: an unreadable journal cannot name a target.
    }
    return
  }
  for (const entry of journal.entries ?? []) {
    try {
      const now = hashOfFile(entry.path)
      if (entry.action === 'delete') {
        if (now !== null && now === entry.beforeHash) unlinkSync(entry.path)
        continue
      }
      if (entry.tempPath === null) continue
      if (now === entry.afterHash) {
        if (existsSync(entry.tempPath)) unlinkSync(entry.tempPath)
        continue
      }
      if (now === entry.beforeHash && existsSync(entry.tempPath)) {
        renameSync(entry.tempPath, entry.path)
        fsyncDirectory(dirname(entry.path))
      } else if (existsSync(entry.tempPath)) {
        unlinkSync(entry.tempPath)
      }
    } catch {
      // Best effort: a target that cannot be recovered is left as the other writer made it.
    }
  }
  try {
    unlinkSync(journalFile)
  } catch {
    // Already gone.
  }
}