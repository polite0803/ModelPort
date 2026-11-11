/**
 * Process-level crash capture.
 *
 * `console.error` is invisible in a packaged Electron GUI: there is no terminal
 * attached, so an uncaught exception leaves nothing behind. This module turns
 * the two process hooks into durable app-log entries with enough context to
 * distinguish a code bug from environment/resource pressure.
 *
 * Before the store is initialized, entries are buffered in memory (bounded) and
 * flushed once the writer is installed.
 */

import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LogEntry } from '../store/types.ts'
import { redactAndTruncate } from '../../shared/logging/redaction.ts'

const MAX_PENDING = 100
const MAX_STACK_CHARS = 16_000
const MAX_MESSAGE_CHARS = 4_000
const DEDUPE_WINDOW_MS = 60_000

type CrashWriter = (entry: LogEntry) => void

let writer: CrashWriter | null = null
let pending: LogEntry[] = []
let sequence = 0
let lastKey = ''
let lastAt = 0

function safeAppVersion(): string {
  try {
    return app.getVersion()
  } catch {
    return 'unknown'
  }
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function stackOf(value: unknown): string | undefined {
  if (value instanceof Error && typeof value.stack === 'string') return value.stack
  if (value && typeof value === 'object' && typeof (value as { stack?: unknown }).stack === 'string') {
    return (value as { stack: string }).stack
  }
  return undefined
}

function buildEntry(
  kind: 'uncaughtException' | 'unhandledRejection' | 'renderer',
  value: unknown,
  extra: Record<string, unknown> = {},
): LogEntry {
  const message = redactAndTruncate(messageOf(value), MAX_MESSAGE_CHARS) ?? 'Unknown crash'
  return {
    id: `crash-${Date.now().toString(36)}-${sequence++}`,
    timestamp: Date.now(),
    level: 'error',
    message: `${kind}: ${message}`,
    data: {
      source: 'process',
      kind,
      name: value instanceof Error ? value.name : typeof value,
      stack: redactAndTruncate(stackOf(value), MAX_STACK_CHARS),
      platform: process.platform,
      arch: process.arch,
      appVersion: safeAppVersion(),
      electronVersion: process.versions.electron ?? null,
      nodeVersion: process.versions.node,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      ...extra,
    },
  }
}

/**
 * Last-resort sink when the store is not ready (or failed): a plain ndjson file
 * next to the normal logs. It is intentionally independent of electron-store so
 * a storage initialization failure still leaves the original crash behind.
 */
function persistFallback(entry: LogEntry): void {
  try {
    const dir = join(homedir(), '.modelport', 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'crash-fallback.ndjson'), `${JSON.stringify(entry)}\n`, 'utf-8')
  } catch {
    // Nothing else to do without a writable data directory.
  }
}

export function setCrashLogWriter(next: CrashWriter): void {
  writer = next
  if (pending.length > 0) {
    const buffered = pending
    pending = []
    for (const entry of buffered) {
      try {
        writer(entry)
      } catch {
        // A failed crash write must not crash again.
        persistFallback(entry)
      }
    }
  }
}

export function recordProcessCrash(
  kind: 'uncaughtException' | 'unhandledRejection' | 'renderer',
  value: unknown,
  extra: Record<string, unknown> = {},
): void {
  try {
    // Crash loops can emit the same stack thousands of times per minute; keep
    // one entry per minute per identical message+stack so the useful context
    // survives without merging two different crashes that share a message.
    const key = `${kind}:${messageOf(value)}:${(stackOf(value) ?? '').slice(0, 200)}`
    const now = Date.now()
    if (key === lastKey && now - lastAt < DEDUPE_WINDOW_MS) return
    lastKey = key
    lastAt = now

    const entry = buildEntry(kind, value, extra)
    if (writer !== null) {
      try {
        writer(entry)
      } catch {
        persistFallback(entry)
      }
      return
    }
    // Store not ready yet: keep it for the app log AND write a fallback line so
    // an early crash survives even if initialization never completes.
    pending.push(entry)
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING)
    persistFallback(entry)
  } catch {
    // Never let the reporter throw inside a process-level handler.
  }
}

/** Test-only reset; production never needs to clear the crash buffer. */
export function resetCrashReporterForTests(): void {
  writer = null
  pending = []
  sequence = 0
  lastKey = ''
  lastAt = 0
}
