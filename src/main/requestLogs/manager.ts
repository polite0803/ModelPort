import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, writeFile, rename, unlink } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { RequestLogEntry } from '../store/types.ts'
import type {
  RequestLogConfig,
  RequestLogFilter,
} from './types.ts'
import { normalizeRequestLogConfig } from './types.ts'
import {
  DEFAULT_ERROR_LOG_RETENTION_DAYS,
  sanitizeRequestLogEntry,
  sanitizeRequestLogUpdates,
  trimRequestLogsToMaxEntries,
} from './sanitizer.ts'
import { isBodySampleSelected } from './sampling.ts'

interface RequestLogManagerOptions {
  storageDir: string
  config?: Partial<RequestLogConfig>
  /** 错误行保底覆盖的天数，取自 `logRetentionDays`。 */
  errorRetentionDays?: number
}

/** 保留窗按「这次请求顺手扫一遍」执行，最多十分钟一次；不给它单独开定时器。 */
const BODY_SWEEP_INTERVAL_MS = 10 * 60 * 1000

export class RequestLogManager {
  private readonly logFile: string
  private readonly storageDir: string
  private requestLogs: RequestLogEntry[] = []
  private config: RequestLogConfig
  private errorRetentionDays: number
  private initialized = false
  private persistTimer: NodeJS.Timeout | null = null
  private dirty = false
  private persistInFlight = false
  private persistGeneration = 0
  private readonly persistDelayMs = 2000
  private lastBodySweepAt = 0

  constructor(options: RequestLogManagerOptions) {
    this.storageDir = options.storageDir
    this.logFile = join(options.storageDir, 'request-logs.ndjson')
    this.config = normalizeRequestLogConfig(options.config)
    this.errorRetentionDays = options.errorRetentionDays ?? DEFAULT_ERROR_LOG_RETENTION_DAYS
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    mkdirSync(this.storageDir, { recursive: true })
    this.requestLogs = this.loadRequestLogs()
    // 关掉的进程不会自己老化：不在这里扫一遍，跨过保留窗的请求体会一直躺在盘上
    // 直到下一次有流量把它挤出去。
    if (this.stripExpiredBodies()) {
      this.schedulePersist()
    }
    this.initialized = true
  }

  setConfig(config: Partial<RequestLogConfig>): void {
    this.config = normalizeRequestLogConfig(config)
    this.requestLogs = trimRequestLogsToMaxEntries(this.requestLogs, this.config, this.errorRetentionDays)
    // 调小保留窗应当当场生效，而不是等下一个十分钟。
    this.stripExpiredBodies()
    this.schedulePersist()
  }

  /**
   * 错误保底的天数窗口，取自 `logRetentionDays`：天数调大，能回头查的失败窗口一起变长；
   * 调小当场生效。它必须跟着这个已有设置走，否则界面上调「日志保留天数」对错误保底
   * 没有任何作用，而面板上读到的条数还是那个没人配过的数。
   */
  setErrorRetentionDays(days: number): void {
    this.errorRetentionDays = Math.max(1, Math.round(days))
    this.requestLogs = trimRequestLogsToMaxEntries(this.requestLogs, this.config, this.errorRetentionDays)
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
      this.errorRetentionDays,
    )
    this.schedulePersist()

    return true
  }

  addRequestLog(entry: Omit<RequestLogEntry, 'id'>): RequestLogEntry {
    this.ensureInitialized()

    // 采样决定写在行上（`captureBodies`），因为落 body 的是插入，而裁剪 body 的
    // sanitizer 只看这个标记 —— 两条判据必须是同一个。
    const sampled = entry.captureBodies !== true
      && isBodySampleSelected(entry.requestId, this.config.bodySampleRate)
    const logEntry: RequestLogEntry = {
      ...sanitizeRequestLogEntry(sampled ? { ...entry, captureBodies: true } : entry, this.config),
      id: generateId(),
    }

    if (!this.config.enabled) {
      return logEntry
    }

    this.requestLogs.push(logEntry)
    this.requestLogs = trimRequestLogsToMaxEntries(this.requestLogs, this.config, this.errorRetentionDays)
    this.sweepBodiesIfDue()
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

    const existing = this.requestLogs[index]
    this.requestLogs[index] = {
      ...existing,
      ...sanitizeRequestLogUpdates(updates, this.config, existing.captureBodies === true),
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

  /**
   * 整表替换（备份导入用）。
   *
   * 走这个入口而不是直接写 `request-logs.ndjson`：管理器在内存里握着当前表，并在
   * 防抖到期/退出时整份回写。绕过去写文件，下一次刷新就把它盖回旧内容 —— 用户会看到
   * 「导入成功，但日志还是原来那些」。
   */
  replaceRequestLogs(entries: RequestLogEntry[]): void {
    this.ensureInitialized()
    this.requestLogs = trimRequestLogsToMaxEntries([...entries], this.config, this.errorRetentionDays)
    this.schedulePersist()
  }

  exportRequestLogs(): RequestLogEntry[] {
    this.ensureInitialized()
    return [...this.requestLogs]
  }

  flushSync(): void {
    if (!this.initialized || !this.config.enabled) {
      return
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }

    // Invalidate an in-flight async write: it carries an older snapshot and
    // must not rename over the synchronous one during quit. Force the sync
    // write even if the async pass already cleared `dirty` — otherwise an
    // in-flight snapshot discarded by the generation bump would leave nothing.
    this.persistGeneration += 1
    this.dirty = true
    this.persistNow()
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RequestLogManager is not initialized')
    }
  }

  private sweepBodiesIfDue(nowMs: number = Date.now()): void {
    if (this.config.bodyRetentionDays <= 0) return
    if (nowMs - this.lastBodySweepAt < BODY_SWEEP_INTERVAL_MS) return
    this.stripExpiredBodies(nowMs)
  }

  /**
   * Drop the bodies, keep the row.
   *
   * The body is the part worth keeping for compression work and the only part
   * that costs hundreds of kilobytes; the row itself is what the dashboards,
   * the Bandit and the detail dialog read. Deleting the row to age out its body
   * would throw away the reading the body was collected for. `captureBodies`
   * goes with it so the dialog says "not captured" instead of rendering an
   * empty body.
   */
  private stripExpiredBodies(nowMs: number = Date.now()): boolean {
    this.lastBodySweepAt = nowMs
    const days = this.config.bodyRetentionDays
    if (days <= 0) return false
    const cutoff = nowMs - days * 24 * 60 * 60 * 1000
    let changed = false

    this.requestLogs = this.requestLogs.map((entry) => {
      if (entry.timestamp >= cutoff) return entry
      if (entry.requestBody === undefined && entry.responseBody === undefined && entry.captureBodies !== true) {
        return entry
      }
      changed = true
      const {
        requestBody: _requestBody,
        responseBody: _responseBody,
        captureBodies: _captureBodies,
        ...rest
      } = entry
      return rest
    })

    return changed
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
      this.persistAsync()
    }, this.persistDelayMs)
  }

  /**
   * Timed persistence is async: serializing thousands of rows and writing them
   * on the main thread can stall the proxy during an error storm. `flushSync`
   * remains the quit path and invalidates any stale in-flight snapshot.
   */
  private persistAsync(): void {
    if (!this.dirty || this.persistInFlight) return
    this.persistInFlight = true
    this.dirty = false
    const generation = ++this.persistGeneration
    const content = this.requestLogs.map((entry) => JSON.stringify(entry)).join('\n')
    // Unique per generation: flushSync may write a newer snapshot while this
    // write is still in flight; sharing `.tmp` would let the older rename win.
    const tempFile = `${this.logFile}.${generation}.tmp`
    writeFile(tempFile, content, 'utf-8', (error) => {
      if (error) {
        this.persistInFlight = false
        const code = (error as NodeJS.ErrnoException).code
        this.dirty = code !== 'ENOENT'
        console.error('[RequestLogs] async persist failed:', error)
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
          console.error('[RequestLogs] async rename failed:', renameError)
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

    const content = this.requestLogs.map((entry) => JSON.stringify(entry)).join('\n')
    // 先写临时文件再改名替换：直接覆盖时若进程在写入中途退出，ndjson 末行会留下半条，
    // 下次加载按行 parse 失败就整条丢弃 —— 那次会话的请求日志静默消失。
    const tempFile = `${this.logFile}.${this.persistGeneration}.tmp`
    this.dirty = false
    try {
      writeFileSync(tempFile, content, 'utf-8')
      renameSync(tempFile, this.logFile)
    } catch (error) {
      this.dirty = true
      console.error('[RequestLogs] sync persist failed:', error)
      unlink(tempFile, () => {})
    }
  }
}

function generateId(): string {
  return randomUUID()
}

function stripId(entry: RequestLogEntry): Omit<RequestLogEntry, 'id'> {
  const { id: _id, ...rest } = entry
  return rest
}
