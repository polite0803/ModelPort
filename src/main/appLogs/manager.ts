import { existsSync, mkdirSync, readFileSync, rename, renameSync, unlink, writeFile, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isDayRetained, oldestTimestamp, recentLocalDays } from '../../shared/localDay.ts'
import type { LogEntry } from '../store/types.ts'
import type { AppLogFilter, AppLogStats, AppLogTrendPoint } from './types.ts'

interface AppLogManagerOptions {
  storageDir: string
  maxEntries?: number
}

/** Error lines kept in addition to maxEntries, so info/debug traffic cannot evict them. */
const APP_ERROR_LOG_RETENTION = 500

export class AppLogManager {
  private readonly logFile: string
  private readonly storageDir: string
  private logs: LogEntry[] = []
  private maxEntries: number
  private initialized = false
  private persistTimer: NodeJS.Timeout | null = null
  private dirty = false
  private persistInFlight = false
  private persistGeneration = 0
  private readonly persistDelayMs = 2000

  constructor(options: AppLogManagerOptions) {
    this.storageDir = options.storageDir
    this.logFile = join(options.storageDir, 'app-logs.ndjson')
    this.maxEntries = Math.max(0, options.maxEntries ?? 7000)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    mkdirSync(this.storageDir, { recursive: true })
    this.logs = this.trimLogs(this.loadLogs())
    this.initialized = true
  }

  setMaxEntries(maxEntries: number): void {
    this.ensureInitialized()
    this.maxEntries = Math.max(0, maxEntries)
    this.logs = this.trimLogs(this.logs)
    this.schedulePersist()
  }

  async migrateLegacyLogs(legacyLogs: LogEntry[]): Promise<boolean> {
    this.ensureInitialized()

    if (legacyLogs.length === 0) {
      return false
    }

    const byId = new Map<string, LogEntry>()
    for (const entry of [...this.logs, ...legacyLogs]) {
      byId.set(entry.id, entry)
    }

    this.logs = this.trimLogs(
      [...byId.values()].sort((a, b) => a.timestamp - b.timestamp),
    )
    this.schedulePersist()
    return true
  }

  addLog(entry: LogEntry): LogEntry {
    this.ensureInitialized()
    this.logs.push(entry)
    this.logs = this.trimLogs(this.logs)
    this.schedulePersist()
    return entry
  }

  replaceLogs(logs: LogEntry[]): void {
    this.ensureInitialized()
    this.logs = this.trimLogs([...logs].sort((a, b) => a.timestamp - b.timestamp))
    this.schedulePersist()
  }

  getLogs(filter?: AppLogFilter): LogEntry[] {
    this.ensureInitialized()
    let result = [...this.logs]

    if (filter?.level && filter.level !== 'all') {
      result = result.filter((entry) => entry.level === filter.level)
    }

    if (filter?.keyword) {
      const keyword = filter.keyword.toLowerCase()
      result = result.filter((entry) => entry.message.toLowerCase().includes(keyword))
    }

    if (filter?.startTime) {
      result = result.filter((entry) => entry.timestamp >= filter.startTime!)
    }

    if (filter?.endTime) {
      result = result.filter((entry) => entry.timestamp <= filter.endTime!)
    }

    result.sort((a, b) => b.timestamp - a.timestamp)

    if (filter?.offset !== undefined) {
      result = result.slice(filter.offset)
    }

    if (filter?.limit !== undefined) {
      result = result.slice(0, filter.limit)
    }

    return result
  }

  getLogById(id: string): LogEntry | undefined {
    this.ensureInitialized()
    return this.logs.find((entry) => entry.id === id)
  }

  clearLogs(): void {
    this.ensureInitialized()
    this.logs = []
    this.schedulePersist()
  }

  getStats(): AppLogStats {
    this.ensureInitialized()

    return this.logs.reduce<AppLogStats>(
      (stats, entry) => ({
        ...stats,
        total: stats.total + 1,
        [entry.level]: stats[entry.level] + 1,
      }),
      { total: 0, info: 0, warn: 0, error: 0, debug: 0 },
    )
  }

  getTrend(days: number = 7): AppLogTrendPoint[] {
    this.ensureInitialized()
    return this.getTrendFromLogs(this.logs, days)
  }

  getAccountTrend(accountId: string, days: number = 7): AppLogTrendPoint[] {
    this.ensureInitialized()
    const accountLogs = this.logs.filter((entry) => entry.accountId === accountId && entry.requestId)
    return this.getTrendFromLogs(accountLogs, days, true)
  }

  exportLogs(): LogEntry[] {
    this.ensureInitialized()
    return [...this.logs]
  }

  flushSync(): void {
    if (!this.initialized) {
      return
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }

    // Invalidate an in-flight async snapshot so it cannot rename over this one.
    // Force the sync write even if the async pass already cleared `dirty`.
    this.persistGeneration += 1
    this.dirty = true
    this.persistNow()
  }

  private getTrendFromLogs(logs: LogEntry[], days: number, totalUsesInfo = false): AppLogTrendPoint[] {
    const oldestRetained = oldestTimestamp(logs)

    return recentLocalDays(days).map((window) => {
      if (!isDayRetained(oldestRetained, window.end)) {
        return { date: window.key, total: null, info: null, warn: null, error: null }
      }

      const dayLogs = logs.filter((entry) => entry.timestamp >= window.start && entry.timestamp < window.end)
      const info = dayLogs.filter((entry) => entry.level === 'info').length
      const warn = dayLogs.filter((entry) => entry.level === 'warn').length
      const error = dayLogs.filter((entry) => entry.level === 'error').length

      return {
        date: window.key,
        total: totalUsesInfo ? info : dayLogs.length,
        info,
        warn,
        error,
      }
    })
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('AppLogManager is not initialized')
    }
  }

  private loadLogs(): LogEntry[] {
    if (!existsSync(this.logFile)) {
      return []
    }

    const content = readFileSync(this.logFile, 'utf-8').trim()
    if (!content) {
      return []
    }

    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry
        } catch {
          return null
        }
      })
      .filter((entry): entry is LogEntry => entry !== null)
  }

  private trimLogs(logs: LogEntry[]): LogEntry[] {
    if (this.maxEntries <= 0) {
      return []
    }

    if (logs.length <= this.maxEntries) return logs
    const keptIds = new Set(logs.slice(-this.maxEntries).map((entry) => entry.id))
    for (const entry of logs.filter((entry) => entry.level === 'error').slice(-APP_ERROR_LOG_RETENTION)) {
      keptIds.add(entry.id)
    }
    return logs.filter((entry) => keptIds.has(entry.id))
  }

  private schedulePersist(): void {
    this.dirty = true

    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistAsync()
    }, this.persistDelayMs)
  }

  /**
   * Persist failures write to stderr, never `console.*`: the console bridge mirrors
   * error/warn into this very log, so "could not persist" reported as an error entry
   * would schedule another failing persist - one self-sustaining loop per retry delay.
   * A headless host still sees the line; in the GUI the store is the broken part anyway.
   */
  private reportPersistFailure(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[AppLogs] ${message}: ${detail}\n`)
  }

  private persistAsync(): void {
    if (!this.dirty || this.persistInFlight) return
    this.persistInFlight = true
    this.dirty = false
    const generation = ++this.persistGeneration
    const content = this.logs.map((entry) => JSON.stringify(entry)).join('\n')
    const tempFile = `${this.logFile}.${generation}.tmp`
    writeFile(tempFile, content, 'utf-8', (error) => {
      if (error) {
        this.persistInFlight = false
        const code = (error as NodeJS.ErrnoException).code
        this.dirty = code !== 'ENOENT'
        this.reportPersistFailure('async persist failed', error)
        if (code !== 'ENOENT') this.schedulePersist()
        return
      }
      if (generation !== this.persistGeneration) {
        this.persistInFlight = false
        unlink(tempFile, () => {})
        return
      }
      rename(tempFile, this.logFile, (renameError) => {
        this.persistInFlight = false
        if (renameError) {
          const code = (renameError as NodeJS.ErrnoException).code
          this.dirty = code !== 'ENOENT'
          this.reportPersistFailure('async rename failed', renameError)
          unlink(tempFile, () => {})
          if (code !== 'ENOENT') this.schedulePersist()
          return
        }
        if (this.dirty) this.schedulePersist()
      })
    })
  }

  private persistNow(): void {
    if (!this.dirty) {
      return
    }

    const content = this.logs.map((entry) => JSON.stringify(entry)).join('\n')
    // 与请求日志同一口径：改名替换是原子的，崩溃不会留下半行被截断的日志。
    const tempFile = `${this.logFile}.${this.persistGeneration}.tmp`
    this.dirty = false
    try {
      writeFileSync(tempFile, content, 'utf-8')
      renameSync(tempFile, this.logFile)
    } catch (error) {
      this.dirty = true
      this.reportPersistFailure('sync persist failed', error)
      unlink(tempFile, () => {})
    }
  }
}
