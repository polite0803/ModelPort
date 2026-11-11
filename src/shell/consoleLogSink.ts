/**
 * Gives the console its own error log.
 *
 * A console launched from the installer has no terminal, and it owns no gateway store -
 * `tests/build/shell-entries.test.ts` fences it out of `src/main`, so `AppLogManager` is not
 * reachable. Its own `console.error` / `console.warn` therefore went to a stream nobody read,
 * including the failures only the console can see: a refused certificate, an unreadable
 * address book, a gateway child that never came up.
 *
 * Those lines now land in the console's own profile: `<userData>/logs/console.ndjson`, capped
 * at `MAX_FILE_BYTES` with one rotated sibling. Writes are synchronous on purpose - the volume
 * is error/warn only, and an async queue drops exactly the last lines before a crash exit.
 */
import { appendFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { installConsoleBridge, resetConsoleBridgeForTests, setMainConsoleSink } from '../shared/logging/consoleBridge'

const MAX_FILE_BYTES = 2 * 1024 * 1024

/**
 * Returns `false` when the log file cannot be written at all; the bridge is then not
 * installed, so the host keeps its plain console output instead of a silent half-install.
 */
export function installShellConsoleLog(userDataDir: string): boolean {
  const logDir = join(userDataDir, 'logs')
  const file = join(logDir, 'console.ndjson')

  try {
    mkdirSync(logDir, { recursive: true })
  } catch (error) {
    reportFailure('console log dir unavailable', error)
    return false
  }

  let bytes = 0
  try {
    bytes = statSync(file).size
  } catch {
    // First run: nothing to measure yet.
  }

  setMainConsoleSink((level, message) => {
    const line = `${JSON.stringify({ ts: new Date().toISOString(), level, message })}\n`
    if (bytes + line.length > MAX_FILE_BYTES) {
      bytes = rotate(file)
    }
    try {
      appendFileSync(file, line, 'utf8')
      bytes += line.length
    } catch (error) {
      reportFailure('console log write failed', error)
    }
  })
  installConsoleBridge()
  return true
}

// The bridge owns the console patch, so the reset it exposes is how a host (or a test)
// un-patches it. Re-exported because installing the bridge is this module's job.
export { resetConsoleBridgeForTests }

function rotate(file: string): number {
  try {
    renameSync(file, `${file}.1`)
  } catch {
    // A refused rename (another process holds the file) must not let the log grow past
    // its cap, so start the live file over rather than keep appending to it.
    try {
      writeFileSync(file, '', 'utf8')
    } catch {
      // Reported by the write below, which fails the same way.
    }
  }
  return 0
}

/**
 * Failures go to stderr, never to `console.error`: the bridge routes that stream into this
 * very sink, so reporting a write failure as an error entry would schedule another write
 * failure. A machine whose profile is unwritable has no log surface left, which is the
 * honest outcome; a host with a terminal still sees the line.
 */
function reportFailure(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[Shell] ${message}: ${detail}\n`)
}
