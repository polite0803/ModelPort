/**
 * Routes main-process `console.error` / `console.warn` into the persisted app log.
 *
 * The Electron main process has no terminal once it is launched from the installer, so a
 * `console.error` there writes to a stream nobody reads. The app log is the surface the UI
 * shows and a support bundle exports. Only error/warn are captured: info-level console
 * output is startup narration and would flood the log list.
 *
 * Re-entrancy matters: any error printed *by the sink itself* would otherwise be
 * intercepted and fed back into the same sink. `AppLogManager` keeps its own persist
 * failures off `console.*` for the same reason; this guard covers every other caller.
 * The sink is never allowed to throw into the caller either.
 *
 * The original console methods still run, so a host with a terminal (the WSL daemon under
 * systemd, `npm run dev`) keeps its output unchanged.
 */
import { redactSensitiveText, truncateText } from './redaction'

export type MainConsoleLevel = 'error' | 'warn'
export type MainConsoleSink = (level: MainConsoleLevel, message: string) => void

const MAX_MESSAGE_CHARS = 2000
const LEVELS = ['error', 'warn'] as const

let sink: MainConsoleSink | null = null
let installed = false
let reentrant = false
const originals: Partial<Record<MainConsoleLevel, (...args: unknown[]) => void>> = {}

/** The host installs the store-backed writer here; tests pass a collector. */
export function setMainConsoleSink(next: MainConsoleSink | null): void {
  sink = next
}

function render(args: unknown[]): string {
  const text = args
    .map((arg) => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
  return truncateText(redactSensitiveText(text), MAX_MESSAGE_CHARS) ?? '[empty]'
}

export function installConsoleBridge(): void {
  if (installed) return
  installed = true
  for (const level of LEVELS) {
    const original = console[level].bind(console)
    originals[level] = original
    console[level] = ((...args: unknown[]): void => {
      original(...args)
      const emit = sink
      if (reentrant || emit === null) return
      reentrant = true
      try {
        emit(level, render(args))
      } catch {
        // A log handler must never break the call site it is attached to.
      } finally {
        reentrant = false
      }
    }) as typeof console.error
  }
}

export function resetConsoleBridgeForTests(): void {
  for (const level of LEVELS) {
    const original = originals[level]
    if (original) console[level] = original as typeof console.error
    delete originals[level]
  }
  installed = false
  reentrant = false
  sink = null
}