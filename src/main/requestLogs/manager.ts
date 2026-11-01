import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { currentLocalDay } from '../../shared/localDay.ts'
import type { RequestLogEntry } from '../store/types.ts'
import type {
  RequestLogConfig,
  RequestLogFilter,
  RequestLogStats,
} from './types.ts'
import { normalizeRequestLogConfig } from './types.ts'
import {
  sanitizeRequestLogEntry,
  sanitizeRequestLogUpdates,
  trimRequestLogsToMaxEntries,
} from './sanitizer.ts'

interface RequestLogManagerOptions {
  storageDir: string
  config?: Partial<RequestLogConfig>
}

export class RequestLogManager {
  private readonly logFile: string
  private readonly storageDir: string
  private requestLogs: RequestLogEntry[] = []
  private config: RequestLogConfig
  private initialized = false
  private persistTimer: NodeJS.Timeout | null = null
  private dirty = false
  private readonly persistDelayMs = 2000

  constructor(options: RequestLogManagerOptions) {
    this.storageDir = options.storageDir
    this.logFile = join(options.storageDir, 'request-logs.ndjson')
    this.config = normalizeRequestLogConfig(options.config)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    mkdirSync(this.storageDir, { recursive: true })
    this.requestLogs = this.loadRequestLogs()
    this.initialized = true
  }

  setConfig(config: Partial<RequestLogConfig>): void {
    this.config = normalizeRequestLogConfig(config)
    this.requestLogs = trimRequestLogsToMaxEntries(this.requestLogs, this.config)
    this.schedulePersist()
  }

  async migrateLegacyLogs(legacyLogs: RequestLogEntry[]): Promise<boolean> {
    this.ensureInitialized()

    if (legacyLogs.length === 0 || this.requestLogs.length > 0) {
      return false
    }

    this.requestLogs = trimRequestLogsToMaxEntries(
      legacyLogs
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((entry) => ({
          ...sanitizeRequestLogEntry(stripId(entry), this.config),
          id: entry.id,
        })),
      this.config,
    )
    this.schedulePersist()

    return true
  }

  addRequestLog(entry: Omit<RequestLogEntry, 'id'>): RequestLogEntry {
    this.ensureInitialized()

    const logEntry: RequestLogEntry = {
      ...sanitizeRequestLogEntry(entry, this.config),
      id: generateId(),
    }

    if (!this.config.enabled) {
      return logEntry
    }

    this.requestLogs.push(logEntry)
    this.requestLogs = trimRequestLogsToMaxEntries(this.requestLogs, this.config)
    this.schedulePersist()

    return logEntry
  }

  updateRequestLog(id: string, updates: Partial<RequestLogEntry>): boolean {
    this.ensureInitialized()
    if (!this.config.enabled || this.config.maxEntries <= 0) {
      return false
    }

    const index = this.requestLogs.findIndex((entry) => entry.id === id)
    if (index === -1) {
      return false
    }

    this.requestLogs[index] = {
      ...this.requestLogs[index],
      ...sanitizeRequestLogUpdates(updates, this.config),
    }
    this.schedulePersist()
    return true
  }

  getRequestLogs(limit?: number, filter?: RequestLogFilter): RequestLogEntry[] {
    this.ensureInitialized()
    let result = [...this.requestLogs]

    if (filter?.status) {
      result = result.filter((entry) => entry.status === filter.status)
    }

    if (filter?.providerId) {
      result = result.filter((entry) => entry.providerId === filter.providerId)
    }

    result.sort((a, b) => b.timestamp - a.timestamp)

    if (limit && result.length > limit) {
      return result.slice(0, limit)
    }

    return result
  }

  getRequestLogById(id: string): RequestLogEntry | undefined {
    this.ensureInitialized()
    return this.requestLogs.find((entry) => entry.id === id)
  }

  clearRequestLogs(): void {
    this.ensureInitialized()
    this.requestLogs = []
    this.schedulePersist()
  }

  getRequestLogStats(): RequestLogStats {
    this.ensureInitialized()
    const today = currentLocalDay()
    const todayLogs = this.requestLogs.filter((entry) => entry.timestamp >= today.start && entry.timestamp < today.end)

    return {
      total: this.requestLogs.length,
      success: this.requestLogs.filter((entry) => entry.status === 'success').length,
      error: this.requestLogs.filter((entry) => entry.status === 'error').length,
      todayTotal: todayLogs.length,
      todaySuccess: todayLogs.filter((entry) => entry.status === 'success').length,
      todayError: todayLogs.filter((entry) => entry.status === 'error').length,
    }
  }

  exportRequestLogs(): RequestLogEntry[] {
    this.ensureInitialized()
    return [...this.requestLogs]
  }

  flushSync(): void {
    if (!this.initialized) {
      return
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }

    this.persistNow()
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RequestLogManager is not initialized')
    }
  }

  private loadRequestLogs(): RequestLogEntry[] {
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
          return JSON.parse(line) as RequestLogEntry
        } catch {
          return null
        }
      })
      .filter((entry): entry is RequestLogEntry => entry !== null)
  }

  private schedulePersist(): void {
    this.dirty = true

    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistNow()
    }, this.persistDelayMs)
  }

  private persistNow(): void {
    if (!this.dirty) {
      return
    }

    const content = this.requestLogs.map((entry) => JSON.stringify(entry)).join('\n')
    // 先写临时文件再改名替换：直接覆盖时若进程在写入中途退出，ndjson 末行会留下半条，
    // 下次加载按行 parse 失败就整条丢弃 —— 那次会话的请求日志静默消失。
    const tempFile = `${this.logFile}.tmp`
    writeFileSync(tempFile, content, 'utf-8')
    renameSync(tempFile, this.logFile)
    this.dirty = false
  }
}

function generateId(): string {
  return randomUUID()
}

function stripId(entry: RequestLogEntry): Omit<RequestLogEntry, 'id'> {
  const { id: _id, ...rest } = entry
  return rest
}
