/**
 * Credential Storage Module - Core Storage Implementation
 * Uses electron-store for persistent storage
 * Uses Electron's safeStorage API for sensitive data encryption
 */

import { app, safeStorage, BrowserWindow } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { copyFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import {
  StoreSchema,
  AppConfig,
  Account,
  Provider,
  LogEntry,
  DEFAULT_CONFIG,
  BUILTIN_PROVIDERS,
  LogLevel,
  SessionRecord,
  SessionConfig,
  DEFAULT_SESSION_CONFIG,
  ChatMessage,
  RequestLogEntry,
  RequestLogConfig,
  PersistentStatistics,
  DailyStatistics,
  DEFAULT_STATISTICS,
  EffectiveModel,
  CatalogueModel,
  ProviderModelOverrides,
  DEFAULT_USER_MODEL_OVERRIDES,
  UserModelOverrides,
  DEFAULT_USER_MODEL_MARKS,
  UserModelMarks,
  CustomModel,
  FetchedModel,
  DEFAULT_REQUEST_LOG_CONFIG,
  normalizeModelMappingsWithDefaults,
} from './types'
import { localDayKey, recentLocalDays } from '../../shared/localDay'
import {
  accumulateDayBucket,
  normalizeDayBucket,
  summarizeDay,
  tokenDayKey,
  trimDays,
  type DayTokenBucket,
  type DayTokenSummary,
} from '../../shared/tokenAccounting.ts'
import { sendRequestLog } from '../ipc/logBroadcast'
import { RequestLogManager } from '../requestLogs/manager'
import { normalizeRequestLogConfig } from '../requestLogs/types'
import { setContentLoggingEnabled } from '../proxy/utils/debugContent'
import {
  compareStoreSnapshot,
  legacyBackupCandidates,
  orphanedPromptPayload,
  planKeySetup,
} from './keyMigration'
import { normalizeToolCallingConfig } from '../../shared/toolCalling'
import { applyServed, buildModelCatalogue, namespaceModelOverrides } from './modelServing'
import { DEFAULT_AUTO_ROUTING_CONFIG, RETIRED_PROVIDER_IDS } from '../../shared/types'
import { normalizeAutoRoutingConfig } from './autoRoutingConfig'
import {
  allModelRoutes,
  checkPoolStrategyIds,
  checkRouteModelRefs,
  checkRouteName,
  findModelRoute,
  isRouteStrategyValue,
  normalizeModelRoutes,
  routesFromLegacyAutoRouting,
} from './modelRoutes'
import type { ModelCapabilityHint, ModelRoute } from '../../shared/types'
import { normalizeModelMark } from './modelMarks'
import type {
  ModelRouteError,
  ModelRouteMutation,
  ModelRouteRemoval,
} from '../../shared/modelRouteName'
import { validateRouteNameInput } from '../../shared/modelRouteName'
import { normalizeCompressionConfig } from './compressionConfig'
import { normalizeOutputSteeringConfig } from './outputSteeringConfig'
import type { AppLogTrendPoint, AutoRoutingConfig } from '../../shared/types'
import { AppLogManager } from '../appLogs/manager'
import { QuotaLedger } from '../proxy/quota/ledger'
import { syncBuiltinProvider } from './providerSync'
import { syncAutoStart } from '../autostartHost'
import type { AppLogFilter } from '../appLogs/types'

// Dynamically import electron-store (ESM module)
let Store: any = null

/**
 * Storage Instance Type Definition
 */
type StoreType = any


/**
 * Storage Manager Class
 * Responsible for data persistence and encryption
 */
class StoreManager {
  private store: StoreType | null = null
  private isInitialized: boolean = false
  private mainWindow: BrowserWindow | null = null
  private initializationError: Error | null = null
  private requestLogManager: RequestLogManager | null = null
  private appLogManager: AppLogManager | null = null
  private quotaLedger: QuotaLedger | null = null
  private encryptionKey: string | undefined = undefined
  private keyFilePath: string | null = null
  private dataFileExistedBeforeInit = false

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  /**
   * Check if storage has initialization error
   */
  hasInitializationError(): boolean {
    return this.initializationError !== null
  }

  /**
   * Get initialization error
   */
  getInitializationError(): Error | null {
    return this.initializationError
  }

  /**
   * Initialize Storage
   * Create storage instance and initialize default data
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    const storagePath = this.getStoragePath()

    try {
      // `electron-store` 是 ESM 包，走动态 import。必须在 try **内部**：
      // 打包产物不带 node_modules（build.files 排除了 `!node_modules/**/*`），
      // 依赖没被打进 bundle 时这里会抛 ERR_MODULE_NOT_FOUND；若发生在 try 之外，
      // initializationError 不会被记录，界面只能看到
      // "Storage not initialized, please call initialize() first" 这种无从下手的文案
      // （1.4.5 正是如此：electron-store 被 external 后打包应用必然走到这一步）。
      if (!Store) {
        const module = await import('electron-store')
        Store = module.default
      }

      this.encryptionKey = this.resolveEncryptionKey(storagePath)
      this.store = new Store({
        name: 'data',
        cwd: storagePath,
        defaults: this.getDefaultData(),
        encryptionKey: this.encryptionKey,
      })
      this.orphanSystemPrompts(storagePath)

      await this.initializeAppLogManager(storagePath)
      await this.initializeRequestLogManager(storagePath)
      this.initializeQuotaLedger(storagePath)
      this.initializeDefaultModelMappings()
      await this.initializeDefaultProviders()
      this.isInitialized = true
      this.initializationError = null
    } catch (error) {
      console.error('[Store] Failed to initialize storage:', error)
      this.initializationError = error instanceof Error ? error : new Error(String(error))
      
      // Never replace a data file that held real data: a wrong or missing key
      // would turn "cannot decrypt" into "silently wiped".
      if (this.dataFileExistedBeforeInit && this.keyFilePath) {
        console.error(
          '[Store] Existing data.json could not be read. Move it aside manually to start over; refusing to replace it.',
        )
        throw this.initializationError
      }

      // 依赖模块都没加载起来时（例如打包漏带 electron-store），备份/重建 data.json
      // 解决不了任何问题，只会把真实的 ERR_MODULE_NOT_FOUND 盖掉。直接抛出。
      if (!Store) throw this.initializationError

      // Try to recover by backing up corrupted data and reinitializing
      try {
        await this.recoverFromCorruptedData(storagePath)
        this.store = new Store({
          name: 'data',
          cwd: storagePath,
          defaults: this.getDefaultData(),
          encryptionKey: this.encryptionKey,
        })
        await this.initializeAppLogManager(storagePath)
        await this.initializeRequestLogManager(storagePath)
        this.initializeQuotaLedger(storagePath)
        this.initializeDefaultModelMappings()
        this.isInitialized = true
        this.initializationError = null
        console.log('[Store] Successfully recovered from corrupted data')
      } catch (recoveryError) {
        console.error('[Store] Failed to recover from corrupted data:', recoveryError)
        throw this.initializationError
      }
    }
  }

  /**
   * Recover from corrupted data file
   * Backup the corrupted file and create a new one
   */
  private async recoverFromCorruptedData(storagePath: string): Promise<void> {
    const { renameSync, existsSync } = await import('fs')
    const { join } = await import('path')
    
    const dataPath = join(storagePath, 'data.json')
    const backupPath = join(storagePath, `data.corrupted.${Date.now()}.json`)
    
    if (existsSync(dataPath)) {
      console.log('[Store] Backing up corrupted data file to:', backupPath)
      try {
        renameSync(dataPath, backupPath)
        console.log('[Store] Corrupted data file backed up successfully')
      } catch (backupError) {
        console.error('[Store] Failed to backup corrupted data:', backupError)
        throw backupError
      }
    }
  }

  /**
   * Get Storage Path
   * Storage path: ~/.modelport/
   */
  private getStoragePath(): string {
    return join(homedir(), '.modelport')
  }

  /** Key used by every release before machine-bound keys; only read during migration */
  private static readonly LEGACY_ENCRYPTION_KEY = 'chat2api-fixed-encryption-key-v1'

  /**
   * Resolves the key that encrypts data.json.
   *
   * The key is random per install and sealed with the OS keystore, so a copied
   * data.json cannot be decrypted on another machine. A data file written by an
   * older release is migrated once: read with the legacy key, backed up, then
   * rewritten with the new key and verified before the old file is dropped.
   */
  private resolveEncryptionKey(storagePath: string): string | undefined {
    const keyPath = join(storagePath, 'store.key')
    const dataPath = join(storagePath, 'data.json')
    this.dataFileExistedBeforeInit = existsSync(dataPath)

    let keystoreAvailable = false
    try {
      keystoreAvailable = safeStorage.isEncryptionAvailable()
    } catch (error) {
      console.warn('[Store] OS keystore probe failed, falling back to unencrypted storage:', error)
    }

    const plan = planKeySetup({
      keystoreAvailable,
      keyFileExists: existsSync(keyPath),
      dataFileExists: this.dataFileExistedBeforeInit,
    })

    if (plan === 'unencrypted') {
      if (this.dataFileExistedBeforeInit) {
        console.warn('[Store] OS keystore unavailable; data.json is stored unencrypted')
      }
      return undefined
    }

    this.keyFilePath = keyPath
    if (plan === 'reuse') {
      const key = this.readKeyFile(keyPath)
      this.restoreMissingDataFile(storagePath, key)
      return key
    }
    if (plan === 'create') return this.createKeyFile(keyPath)
    return this.migrateLegacyKey(storagePath, this.createKeyFile(keyPath))
  }

  private readKeyFile(keyPath: string): string {
    const sealed = readFileSync(keyPath, 'utf8').trim()
    const key = safeStorage.decryptString(Buffer.from(sealed, 'base64'))
    if (!key) throw new Error('store.key decrypted to an empty key')
    return key
  }

  private createKeyFile(keyPath: string): string {
    const key = randomBytes(32).toString('hex')
    writeFileSync(keyPath, safeStorage.encryptString(key).toString('base64'), { mode: 0o600 })
    return key
  }

  private nextBackupPath(dataPath: string): string {
    const base = `${dataPath}.pre-key-migration.bak`
    return existsSync(base) ? `${base}.${Date.now()}` : base
  }

  private migrateLegacyKey(storagePath: string, key: string): string {
    this.rewriteWithKey(storagePath, join(storagePath, 'data.json'), key)
    return key
  }

  /**
   * data.json can go missing two ways: a downgrade cannot read it and renames it
   * to data.corrupted.<ts>.json, or an interrupted migration leaves only a .bak.
   * Rather than start empty, put the newest copy back - as-is when it is already
   * under this install's key, or re-encrypted when it is the older fixed-key file.
   */
  private restoreMissingDataFile(storagePath: string, key: string): void {
    const dataPath = join(storagePath, 'data.json')
    if (existsSync(dataPath)) return

    let candidates: string[] = []
    try {
      candidates = legacyBackupCandidates(readdirSync(storagePath))
    } catch (error) {
      console.warn('[Store] Could not list the data directory while looking for a copy to restore:', error)
      return
    }

    for (const name of candidates) {
      const sourcePath = join(storagePath, name)
      copyFileSync(sourcePath, dataPath)
      if (this.canReadWith(dataPath, storagePath, key)) {
        console.warn('[Store] data.json was missing; restored it as-is from', name)
        return
      }
      try {
        this.rewriteWithKey(storagePath, sourcePath, key)
        console.warn('[Store] data.json was missing; restored it from', name)
        return
      } catch (error) {
        console.warn('[Store] Could not restore', name, '-', error instanceof Error ? error.message : error)
        unlinkSync(dataPath)
      }
    }
  }

  /** Read-only probe: succeeds when the file on disk decrypts with this key. */
  private canReadWith(dataPath: string, storagePath: string, key: string): boolean {
    try {
      const probe = new Store({
        name: 'data',
        cwd: storagePath,
        defaults: {},
        encryptionKey: key,
      })
      void probe.store
      return true
    } catch {
      return false
    }
  }
  /**
   * Reads a legacy-encrypted file with the old fixed key and writes the same
   * payload back under `key`, keeping a byte copy first. Any failure restores
   * the live file from that copy.
   */
  private rewriteWithKey(storagePath: string, sourcePath: string, key: string): void {
    const dataPath = join(storagePath, 'data.json')
    const backupPath = this.nextBackupPath(dataPath)

    let snapshot: Record<string, unknown>
    try {
      const legacy = new Store({
        name: 'data',
        cwd: storagePath,
        defaults: {},
        encryptionKey: StoreManager.LEGACY_ENCRYPTION_KEY,
      })
      snapshot = legacy.store
      if (!snapshot || Object.keys(snapshot).length === 0) {
        throw new Error('legacy store decrypted to an empty object')
      }
    } catch (error) {
      throw new Error(
        `Existing ${sourcePath.endsWith('data.json') ? 'data.json' : sourcePath} cannot be read with the legacy key, refusing to migrate: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    copyFileSync(sourcePath, dataPath)
    copyFileSync(dataPath, backupPath)
    // the legacy file must be out of the way: the new store would otherwise try to
    // decrypt it with the new key at construction. The backup above is the copy.
    unlinkSync(dataPath)

    try {
      const rewritten = new Store({
        name: 'data',
        cwd: storagePath,
        defaults: {},
        encryptionKey: key,
      })
      rewritten.store = snapshot
      const check = compareStoreSnapshot(snapshot, rewritten.store)
      if (!check.ok) throw new Error(`verification failed: ${check.detail}`)
      console.log('[Store] Wrote data.json under the machine-bound key; backup at', backupPath)
    } catch (error) {
      copyFileSync(backupPath, dataPath)
      throw new Error(
        `Key rewrite failed and data.json was restored from backup: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * The prompt library was removed; keep whatever a user had written next to the
   * data file instead of silently dropping it from the store.
   */
  private orphanSystemPrompts(storagePath: string): void {
    const leftovers = this.store?.get('systemPrompts')
    const payload = orphanedPromptPayload(leftovers)
    if (!payload) return

    const target = join(storagePath, 'system-prompts.orphaned.json')
    try {
      if (!existsSync(target)) writeFileSync(target, payload, 'utf8')
      this.store!.delete('systemPrompts')
      console.log('[Store] Moved leftover system prompts out of data.json to', target)
    } catch (error) {
      console.warn('[Store] Could not move leftover system prompts aside; leaving them in place:', error)
    }
  }
  /**
   * Get Default Data Structure
   */
  private getDefaultData(): StoreSchema {
    return {
      providers: [],
      accounts: [],
      config: DEFAULT_CONFIG,
      logs: [],
      requestLogs: [],
      sessions: [],
      statistics: DEFAULT_STATISTICS,
      // Per-day token counters start empty; an upgrade simply has no history.
      tokenUsage: {},
      userModelOverrides: DEFAULT_USER_MODEL_OVERRIDES,
      userModelMarks: DEFAULT_USER_MODEL_MARKS,
    }
  }

  private async initializeRequestLogManager(storagePath: string): Promise<void> {
    const config = this.normalizeConfig(this.store?.get('config') || DEFAULT_CONFIG)
    this.requestLogManager = new RequestLogManager({
      storageDir: join(storagePath, 'request-logs'),
      config: config.requestLogConfig,
    })
    setContentLoggingEnabled(config.requestLogConfig.includeBodies)
    await this.requestLogManager.initialize()

    const legacyRequestLogs = this.store?.get('requestLogs') || []
    if (legacyRequestLogs.length > 0) {
      await this.requestLogManager.migrateLegacyLogs(legacyRequestLogs)
      this.store?.set('requestLogs', [])
    }
  }

  private initializeQuotaLedger(storagePath: string): void {
    this.quotaLedger = new QuotaLedger(storagePath)
    this.quotaLedger.initialize()
  }

  private async initializeAppLogManager(storagePath: string): Promise<void> {
    const config = this.normalizeConfig(this.store?.get('config') || DEFAULT_CONFIG)
    this.appLogManager = new AppLogManager({
      storageDir: join(storagePath, 'logs'),
      maxEntries: this.getMaxLogEntries(config),
    })
    await this.appLogManager.initialize()

    const legacyLogs = this.store?.get('logs') || []
    if (legacyLogs.length > 0) {
      await this.appLogManager.migrateLegacyLogs(legacyLogs)
      this.appLogManager.flushSync()
      this.store?.set('logs', [])
    }
  }

  private getMaxLogEntries(config: AppConfig): number {
    return config.logRetentionDays * 1000
  }

  private normalizeConfig(config: Partial<AppConfig>): AppConfig {
    const rawConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    }
    const rawToolCallingConfig = rawConfig.toolCallingConfig ?? rawConfig.toolPromptConfig

    return {
      ...rawConfig,
      modelMappings: normalizeModelMappingsWithDefaults(rawConfig.modelMappings),
      requestLogConfig: normalizeRequestLogConfig(
        rawConfig.requestLogConfig || DEFAULT_REQUEST_LOG_CONFIG,
      ),
      toolCallingConfig: normalizeToolCallingConfig(rawToolCallingConfig),
      toolPromptConfig: undefined,
      autoRouting: normalizeAutoRoutingConfig(rawConfig.autoRouting),
      routes: this.normalizeRoutes(config, rawConfig),
      compression: normalizeCompressionConfig(rawConfig.compression),
      outputSteering: normalizeOutputSteeringConfig(rawConfig.outputSteering),
    }
  }

  /**
   * 路由表的读取侧归一 + 一次性迁移。
   *
   * ⚠️ 判据必须是**原始存储对象**（`config`，即 `store.get('config')` 的那个对象）上
   * 有没有 `routes` 这个键，而不是 `rawConfig`：`normalizeConfig` 先 spread
   * `DEFAULT_CONFIG`，spread 之后的对象永远有这个键（或者永远没有），
   * 「键不存在 = 旧数据」这个信息在那一步就丢了。`DEFAULT_CONFIG` 也刻意**不预置**
   * 这个键（见 store/types.ts 里的注释），所以 `|| DEFAULT_CONFIG` 兜底与
   * `resetConfig()` 走的都是「键不存在」分支 —— 全新安装同样会得到一条 `auto` 路由。
   *
   * 为什么按**键存在性**而不是按「表为空」：按空迁移的话，用户把路由删光以后
   * （routes === `{}`）每一次读取都会重新造出 `auto`，直接违反「删除后这个名字
   * 不再被路由」。键一旦存在（哪怕是 `{}`）就永不迁移，同时满足幂等与删除语义。
   *
   * 归一放读取侧而不是只放 `updateConfig`：renderer 的 `saveAppConfig` 走通用
   * `STORE_SET` 整对象 raw 写（ipc/handlers.ts），**绕过** updateConfig 的归一与
   * 深合并，所以非法条目一定要在读回来时被安全丢弃（绝不抛异常把整个 config 读挂）。
   */
  private normalizeRoutes(
    raw: Partial<AppConfig> | undefined,
    merged: AppConfig
  ): Record<string, ModelRoute> {
    const options = { fallbackStrategy: merged.loadBalanceStrategy }
    const rawIsObject = raw !== null && typeof raw === 'object'
    const hasRoutesKey = rawIsObject && Object.prototype.hasOwnProperty.call(raw, 'routes')

    if (!hasRoutesKey) {
      // `merged.autoRouting` 就是 legacy 那份配置（存储里有就用存储的，否则出厂默认），
      // 迁移只读它，绝不新增第三条真值源。
      return routesFromLegacyAutoRouting(merged.autoRouting, options)
    }

    return normalizeModelRoutes((raw as { routes?: unknown }).routes, options)
  }

  private initializeDefaultModelMappings(): void {
    const rawConfig = this.store?.get('config') || DEFAULT_CONFIG
    this.store?.set('config', this.normalizeConfig(rawConfig))
  }

  /**
   * Initialize Default Providers
   * Clear provider list, users create providers by adding accounts
   */
  private async initializeDefaultProviders(): Promise<void> {
    const providers = this.store?.get('providers') || []
    const builtinIds = BUILTIN_PROVIDERS.map(p => p.id)
    
    const validProviders = providers.filter((p: Provider) => {
      if (p.type === 'builtin') {
        return builtinIds.includes(p.id)
      }
      return true
    })
    
    const userModelOverrides: UserModelOverrides = {
      ...(this.store?.get('userModelOverrides') || {}),
    }
    let userModelOverridesChanged = false

    // Retired providers leave accounts (cookies, refresh tokens, SSO tickets)
    // and per-model switches behind. Delete them instead of keeping orphans.
    const retiredIds = new Set<string>(RETIRED_PROVIDER_IDS)
    const accounts = (this.store?.get('accounts') || []) as Account[]
    const keptAccounts = accounts.filter(account => !retiredIds.has(account.providerId))
    if (keptAccounts.length !== accounts.length) {
      this.store?.set('accounts', keptAccounts)
    }
    for (const id of RETIRED_PROVIDER_IDS) {
      if (id in userModelOverrides) {
        delete userModelOverrides[id]
        userModelOverridesChanged = true
      }
    }

    // OpenCode 的模型名此前是裸 id，现在与其它供应商一样带 `opencode/` 前缀。
    // 供应商记录本身由上面的启动同步按随包配置重写，但用户侧的目录残留
    // （上次同步的清单、停用名单）也要搬进新命名空间，否则同一个上游模型
    // 会在目录里出现新旧两行。
    const opencodeOverrides = userModelOverrides['opencode']
    if (opencodeOverrides) {
      const migrated = namespaceModelOverrides(opencodeOverrides, 'opencode')
      if (migrated.changed) {
        userModelOverrides['opencode'] = migrated.next
        userModelOverridesChanged = true
      }
    }

    const updatedProviders = validProviders.map((p: Provider) => {
      const builtinConfig = BUILTIN_PROVIDERS.find(bp => bp.id === p.id)
      if (!builtinConfig) return p

      if (p.type !== 'builtin') {
        console.warn('[Store] Repairing builtin provider record:', p.id, '(stored type:', p.type ?? 'missing', ')')
      }
      return syncBuiltinProvider(p, builtinConfig)
    })
    
    if (userModelOverridesChanged) {
      this.store?.set('userModelOverrides', userModelOverrides)
    }
    this.store?.set('providers', updatedProviders)

    // 凭据型供应商（OpenCode）自己不需要账号，但负载均衡要有一个 active 账号
    for (const provider of updatedProviders) {
      if (provider.type === 'builtin') this.ensureLocalAccount(provider.id)
    }
  }

  /**
   * Ensure provider exists, create if not
   */
  ensureProviderExists(providerId: string): void {
    this.ensureInitialized()
    const providers = this.store!.get('providers') || []
    const exists = providers.some((p: Provider) => p.id === providerId)
    
    if (!exists) {
      const builtinConfig = BUILTIN_PROVIDERS.find(bp => bp.id === providerId)
      if (builtinConfig) {
        const now = Date.now()
        const newProvider: Provider = {
          id: builtinConfig.id,
          name: builtinConfig.name,
          type: 'builtin',
          authType: builtinConfig.authType,
          apiEndpoint: builtinConfig.apiEndpoint,
          chatPath: builtinConfig.chatPath,
          headers: builtinConfig.headers,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          description: builtinConfig.description,
          supportedModels: builtinConfig.supportedModels,
          modelMappings: builtinConfig.modelMappings,
          supportsModelFetch: Boolean(builtinConfig.modelsFetch) || builtinConfig.runtimeModels === true,
        }
        providers.push(newProvider)
        this.store!.set('providers', providers)
        console.log('[Store] Created missing provider:', providerId)
        this.ensureLocalAccount(providerId)
      }
    }
  }

  /**
   * 有些内置供应商不需要任何凭据（OpenCode 走本机运行时）。但负载均衡要有一个
   * active 账号才肯把请求发出去，所以给它们配一个空的本地账号。
   */
  ensureLocalAccount(providerId: string): void {
    // 只看 store 有没有建好：这个方法会被 initialize() 内部的启动同步调用，
    // 那时 isInitialized 还没置位，用「已初始化」判据会把整个启动流程打断
    if (!this.store) return
    const config = BUILTIN_PROVIDERS.find(bp => bp.id === providerId)
    if (!config) return
    if ((config.credentialFields?.length ?? 0) > 0) return

    const accounts = this.store!.get('accounts') || []
    if (accounts.some((a: Account) => a.providerId === providerId)) return

    const now = Date.now()
    const account: Account = {
      id: this.generateId(),
      providerId,
      name: `${config.name} local`,
      credentials: {},
      status: 'active',
      createdAt: now,
      updatedAt: now,
      requestCount: 0,
      todayUsed: 0,
      lastStatusCheck: now,
      lastUsed: now,
    }
    accounts.push(account)
    this.store!.set('accounts', accounts)
    console.log('[Store] Created local account for credential-less provider:', providerId)
  }

  /**
   * Ensure Storage is Initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized || !this.store) {
      const errorMsg = this.initializationError 
        ? `Storage initialization failed: ${this.initializationError.message}`
        : 'Storage not initialized, please call initialize() first'
      throw new Error(errorMsg)
    }
  }

  private getLogPriority(level: LogLevel): number {
    switch (level) {
      case 'debug':
        return 10
      case 'info':
        return 20
      case 'warn':
        return 30
      case 'error':
        return 40
      default:
        return 20
    }
  }

  private shouldRecordLog(level: LogLevel): boolean {
    const config = this.normalizeConfig(this.store!.get('config') || DEFAULT_CONFIG)
    return this.getLogPriority(level) >= this.getLogPriority(config.logLevel)
  }

  private getCombinedLogs(): LogEntry[] {
    return this.getAppLogManager().exportLogs()
  }

  flushPendingWrites(): void {
    this.appLogManager?.flushSync()
    this.requestLogManager?.flushSync()
    this.quotaLedger?.flushSync()
  }

  /**
   * Encrypt Sensitive Data
   * @param data Data to encrypt
   * @returns Encrypted string
   */
  encryptData(data: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[Store] System keychain unavailable - credentials will be stored unencrypted')
      return data
    }
    try {
      const encrypted = Buffer.from(safeStorage.encryptString(data))
      // Some keychains report available but fail to round-trip (headless Linux without libsecret)
      if (safeStorage.decryptString(encrypted) !== data) {
        console.error('[Store] Encryption round-trip failed - credentials will be stored unencrypted')
        return data
      }
      return encrypted.toString('base64')
    } catch (error) {
      console.error('Failed to encrypt data:', error)
    }
    return data
  }

  /**
   * Decrypt Sensitive Data
   * @param encryptedData Encrypted data
   * @returns Decrypted string
   */
  decryptData(encryptedData: string): string {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const buffer = Buffer.from(encryptedData, 'base64')
        return safeStorage.decryptString(buffer)
      }
    } catch (error) {
      console.error('Failed to decrypt data:', error)
    }
    return encryptedData
  }

  /**
   * Encrypt Credentials Object
   * @param credentials Credentials object
   * @returns Encrypted credentials object
   */
  encryptCredentials(credentials: Record<string, string>): Record<string, string> {
    const encrypted: Record<string, string> = {}
    
    for (const [key, value] of Object.entries(credentials)) {
      encrypted[key] = this.encryptData(value)
    }
    
    return encrypted
  }

  /**
   * Decrypt Credentials Object
   * @param encryptedCredentials Encrypted credentials object
   * @returns Decrypted credentials object
   */
  decryptCredentials(encryptedCredentials: Record<string, string>): Record<string, string> {
    const decrypted: Record<string, string> = {}
    
    for (const [key, value] of Object.entries(encryptedCredentials)) {
      decrypted[key] = this.decryptData(value)
    }
    
    return decrypted
  }

  // ==================== Provider Operations ====================

  /**
   * Get All Providers
   */
  getProviders(): Provider[] {
    this.ensureInitialized()
    return this.store!.get('providers') || []
  }

  /**
   * Get Provider By ID
   */
  getProviderById(id: string): Provider | undefined {
    this.ensureInitialized()
    const providers = this.store!.get('providers') as Provider[] || []
    return providers.find((p: Provider) => p.id === id)
  }

  /**
   * Add Provider
   */
  addProvider(provider: Provider): void {
    this.ensureInitialized()
    const providers = this.store!.get('providers') as Provider[] || []
    providers.push(provider)
    this.store!.set('providers', providers)
  }

  /**
   * Update Provider
   */
  updateProvider(id: string, updates: Partial<Provider>): Provider | null {
    this.ensureInitialized()
    const providers = this.store!.get('providers') as Provider[] || []
    const index = providers.findIndex((p: Provider) => p.id === id)
    
    if (index === -1) {
      return null
    }
    
    providers[index] = {
      ...providers[index],
      ...updates,
      updatedAt: Date.now(),
    }
    
    this.store!.set('providers', providers)
    return providers[index]
  }

  /**
   * Delete Provider
   */
  deleteProvider(id: string): boolean {
    this.ensureInitialized()
    const providers = this.store!.get('providers') as Provider[] || []
    const index = providers.findIndex((p: Provider) => p.id === id)
    
    if (index === -1) {
      return false
    }
    
    providers.splice(index, 1)
    this.store!.set('providers', providers)
    
    const accounts = this.store!.get('accounts') as Account[] || []
    const filteredAccounts = accounts.filter((a: Account) => a.providerId !== id)
    this.store!.set('accounts', filteredAccounts)
    
    return true
  }

  // ==================== Model Overrides Operations ====================

  /**
   * Get Model Overrides for a Provider
   * Returns user customizations to built-in provider models
   */
  getModelOverrides(providerId: string): ProviderModelOverrides | undefined {
    this.ensureInitialized()
    const userModelOverrides = this.store!.get('userModelOverrides') || DEFAULT_USER_MODEL_OVERRIDES
    return userModelOverrides[providerId]
  }

  /**
   * Check if Provider has Model Overrides
   * Returns true if provider has user-added models or excluded models
   */
  hasModelOverrides(providerId: string): boolean {
    const overrides = this.getModelOverrides(providerId)
    if (!overrides) return false
    
    return (
      (overrides.addedModels && overrides.addedModels.length > 0) ||
      (overrides.excludedModels && overrides.excludedModels.length > 0)
    )
  }

  // ==================== Account Operations ====================

  /**
   * Get All Accounts
   * @param includeCredentials Whether to include decrypted credentials
   */
  getAccounts(includeCredentials: boolean = false): Account[] {
    this.ensureInitialized()
    const accounts = this.store!.get('accounts') as Account[] || []
    
    if (includeCredentials) {
      return accounts.map((account: Account) => ({
        ...account,
        credentials: this.decryptCredentials(account.credentials),
      }))
    }
    
    return accounts
  }

  /**
   * Get Account By ID
   * @param includeCredentials Whether to include decrypted credentials
   */
  getAccountById(id: string, includeCredentials: boolean = false): Account | undefined {
    this.ensureInitialized()
    const accounts = this.store!.get('accounts') as Account[] || []
    const account = accounts.find((a: Account) => a.id === id)
    
    if (account && includeCredentials) {
      return {
        ...account,
        credentials: this.decryptCredentials(account.credentials),
      }
    }
    
    return account
  }

  /**
   * Get Accounts By Provider ID
   */
  getAccountsByProviderId(providerId: string, includeCredentials: boolean = false): Account[] {
    this.ensureInitialized()
    const accounts = this.store!.get('accounts') as Account[] || []
    const filtered = accounts.filter((a: Account) => a.providerId === providerId)
    
    if (includeCredentials) {
      return filtered.map((account: Account) => ({
        ...account,
        credentials: this.decryptCredentials(account.credentials),
      }))
    }
    
    return filtered
  }

  /**
   * Add Account
   * Credentials are automatically encrypted before storage
   */
  addAccount(account: Account): void {
    this.ensureInitialized()
    const accounts = this.store!.get('accounts') || []
    
    const encryptedAccount: Account = {
      ...account,
      credentials: this.encryptCredentials(account.credentials),
    }
    
    accounts.push(encryptedAccount)
    this.store!.set('accounts', accounts)
  }

  /**
   * Update Account
   */
  updateAccount(id: string, updates: Partial<Account>): Account | null {
    this.ensureInitialized()
    const accounts = this.store!.get('accounts') as Account[] || []
    const index = accounts.findIndex((a: Account) => a.id === id)
    
    if (index === -1) {
      return null
    }
    
    console.log('[Store] Update account:', {
      id,
      updatesCredentials: updates.credentials,
      oldCredentials: accounts[index].credentials,
      oldCredentialsDecrypted: this.decryptCredentials(accounts[index].credentials),
    })
    
    const updatedAccount: Account = {
      ...accounts[index],
      ...updates,
      updatedAt: Date.now(),
    }
    
    if (updates.credentials) {
      updatedAccount.credentials = this.encryptCredentials(updates.credentials)
      console.log('[Store] Encrypted credentials:', updatedAccount.credentials)
      console.log('[Store] Old credentials:', accounts[index].credentials)
      console.log('[Store] Credentials match:', JSON.stringify(updatedAccount.credentials) === JSON.stringify(accounts[index].credentials))
    }
    
    accounts[index] = updatedAccount
    this.store!.set('accounts', accounts)
    
    // Verify save was successful
    const savedAccounts = this.store!.get('accounts') as Account[]
    const savedAccount = savedAccounts.find(a => a.id === id)
    console.log('[Store] Verify after save:', {
      id,
      savedCredentials: savedAccount?.credentials,
    })
    
    return {
      ...updatedAccount,
      credentials: updates.credentials || this.decryptCredentials(accounts[index].credentials),
    }
  }

  /**
   * Delete Account
   */
  deleteAccount(id: string): boolean {
    this.ensureInitialized()
    const accounts = this.store!.get('accounts') as Account[] || []
    const index = accounts.findIndex((a: Account) => a.id === id)
    
    if (index === -1) {
      return false
    }
    
    accounts.splice(index, 1)
    this.store!.set('accounts', accounts)
    return true
  }

  /**
   * Get Active Accounts
   */
  getActiveAccounts(includeCredentials: boolean = false): Account[] {
    this.ensureInitialized()
    const accounts = this.store!.get('accounts') as Account[] || []
    const active = accounts.filter((a: Account) => a.status === 'active')
    
    if (includeCredentials) {
      return active.map((account: Account) => ({
        ...account,
        credentials: this.decryptCredentials(account.credentials),
      }))
    }
    
    return active
  }

  // ==================== Configuration Operations ====================

  /**
   * Get Application Configuration
   */
  getConfig(): AppConfig {
    this.ensureInitialized()
    return this.normalizeConfig(this.store!.get('config') || DEFAULT_CONFIG)
  }

  /**
   * Applies request-log settings and mirrors the body-logging switch to the
   * content debug logger, so both stay one decision.
   */
  private applyRequestLogConfig(config: RequestLogConfig): void {
    this.requestLogManager?.setConfig(config)
    setContentLoggingEnabled(config.includeBodies)
  }

  /**
   * Mirrors `autoStart` into the OS login item / XDG autostart entry.
   *
   * Runs on every config write that lands here rather than only on
   * `config:update`, because `resetConfig` also changes `autoStart` (default
   * `false`) and would otherwise leave a stale login item behind.
   *
   * Costs nothing when the value did not move: the OS-side write is skipped
   * entirely, so the many unrelated config writes (API keys, mappings, model
   * sync) never touch the registry or the home directory.
   *
   * Failure only warns: a locked-down registry or a read-only home must not
   * turn an unrelated settings save into an error. It does log, because the
   * symptom it prevents ("I enabled it and it never starts") is unobservable
   * otherwise.
   */
  private applyAutoStart(previous: AppConfig | undefined, next: AppConfig): void {
    if (previous !== undefined && previous.autoStart === next.autoStart) return
    void syncAutoStart(next.autoStart).then(result => {
      // `skipped` 的两条都已在 `autostartHost` 里记了日志（开发态 / 无机制平台），
      // 这里不再重复告警；只有真写入时才确认一次，便于用户核对。
      if (result.applied) {
        console.log(`[AutoStart] 开机自启已${next.autoStart ? '开启' : '关闭'}`)
      }
    }).catch((error: unknown) => {
      console.warn(
        '[AutoStart] 写入开机自启失败（不影响使用）：'
        + `${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  /**
   * Set Application Configuration
   *
   * **写入边界的归一通道**：通用 IPC `store:set`（`ipc/handlers.ts`）让 renderer
   * 把整个 config 对象原样落盘，那条路**绕过** `updateConfig` 的归一与深合并。
   * 于是「一次不带 `routes` 键的整对象写」会把 `routes` 从盘上抹掉，而下一次读取
   * （`normalizeConfig` → `normalizeRoutes`）的迁移判据正是「原始存储对象有没有
   * `routes` 键」—— 键没了就重新触发 legacy 迁移，把用户已经删掉的 `auto` 路由复活，
   * 直接违反验收 A。所以 `key === 'config'` 的整对象写必须先过同一条归一：
   * - (a) `normalizeConfig` 无条件输出 `routes` 键，落盘对象从此永远带已归一的表；
   * - (b) 归一只发生在写入侧，读取侧（`getConfig`）的迁移分支保持唯一，不留第二次迁移；
   * - (c) 运行时副作用照旧在这里落（日志容量、请求日志开关、开机自启），与
   *   `updateConfig` 同一套，所以「不重启即生效」不被绕过；
   * - (d) 迁移仍然幂等：`routes` 键一旦存在（哪怕是 `{}`）就永不重放。
   *
   * 入参来自 renderer，形状不可信，所以是 `unknown`：非对象按 `{}` 处理（与读取侧
   * 的 `|| DEFAULT_CONFIG` 兜底同形），非法的 routes 条目由读取侧安全丢弃的规则
   * 在这里同样生效（`normalizeModelRoutes` 不抛异常）。
   *
   * ⚠️ 光「归一再落盘」还不够，探针实测（`model="auto"` 已删除、盘上是 `{fast}`）：
   * 整对象写来的那份没有 `routes` 键，`normalizeConfig` 的迁移判据就在入参上，
   * 于是**写入时**就把迁移又跑了一遍、`auto` 当场复活。所以 `routes` 键在这条路上
   * **永远由 store 做主**：入参带不带 `routes`、带的表新不新，落盘的都是**当前已归一的
   * 表**（`previous.routes`），整对象 raw 写从此不具备「抹掉/替换路由」的能力。
   * 理由：renderer 的 `proxyStore.saveAppConfig` 发的正是整份镜像，而镜像可能已陈旧
   * （开页之后另一条通道新建过路由 —— `routes:create` 落盘了新表，镜像还停在挂载时
   * 那一刻），照单全收就会静默删掉刚建好的路由，击穿「实时提供使用」。路由的写入
   * 只走专用通道：IPC `routes:*` 与 `updateConfig`（管理 API 的 routes 整表写入也经它，
   * 那里有 `validateRoutesForWrite` 的硬校验）。读取侧的迁移分支照旧唯一（首次读旧
   * `data.json` 仍然会迁移），漏键不复活、键存在不重放的语义不变。
   *
   * 返回归一后的配置，调用方（IPC handler）拿它广播，UI 看到的与盘上的是同一份。
   */
  setConfig(config: unknown): AppConfig {
    this.ensureInitialized()
    const previous = this.getConfig()
    const rawIsObject = config !== null && typeof config === 'object' && !Array.isArray(config)
    const incoming = (rawIsObject ? config : {}) as Partial<AppConfig>
    const normalized = this.normalizeConfig({ ...incoming, routes: previous.routes ?? {} })
    this.store!.set('config', normalized)
    this.appLogManager?.setMaxEntries(this.getMaxLogEntries(normalized))
    this.applyRequestLogConfig(normalized.requestLogConfig)
    this.applyAutoStart(previous, normalized)
    return normalized
  }

  /**
   * Update Application Configuration
   */
  updateConfig(updates: Partial<AppConfig>): AppConfig {
    this.ensureInitialized()
    const currentConfig = this.getConfig()
    const newConfig = {
      ...currentConfig,
      ...updates,
    }
    
    // Deep merge for nested objects
    if (updates.toolCallingConfig || updates.toolPromptConfig) {
      const incoming = updates.toolCallingConfig ?? updates.toolPromptConfig
      const incomingRecord = incoming && typeof incoming === 'object' ? incoming as Record<string, unknown> : {}
      const incomingAdvanced = incomingRecord.advanced && typeof incomingRecord.advanced === 'object'
        ? incomingRecord.advanced as Record<string, unknown>
        : {}

      newConfig.toolCallingConfig = normalizeToolCallingConfig({
        ...currentConfig.toolCallingConfig,
        ...incomingRecord,
        advanced: {
          ...currentConfig.toolCallingConfig.advanced,
          ...incomingAdvanced,
        },
      })
      newConfig.toolPromptConfig = undefined
    }
    
    if (updates.sessionConfig && currentConfig.sessionConfig) {
      newConfig.sessionConfig = {
        ...currentConfig.sessionConfig,
        ...updates.sessionConfig,
      }
    }

    if (updates.requestLogConfig) {
      newConfig.requestLogConfig = normalizeRequestLogConfig({
        ...currentConfig.requestLogConfig,
        ...updates.requestLogConfig,
      })
    }

    if (updates.autoRouting) {
      newConfig.autoRouting = normalizeAutoRoutingConfig({
        ...currentConfig.autoRouting,
        ...updates.autoRouting,
      })
    }

    // routes 走 `{ ...currentConfig, ...updates }` 的**整表替换**（就在上面），
    // 这里刻意不做逐键深合并：池策略是有序序列，按字段合并会把用户刚删掉的策略
    // 又拼回来。要改一条请用 `routes:update`（IPC）或 `storeManager.updateRoute()`
    // —— 它们读回现表、只改那一条、再整表写。`updates.routes = {}` 也是合法写入：
    // 键存在且为空 = 「用户删光了路由」，读取侧不会因此把 `auto` 迁移回来。
    const normalized = this.normalizeConfig(newConfig)
    this.store!.set('config', normalized)
    this.appLogManager?.setMaxEntries(this.getMaxLogEntries(normalized))
    this.applyRequestLogConfig(normalized.requestLogConfig)
    this.applyAutoStart(currentConfig, normalized)
    return normalized
  }

  /**
   * Reset Configuration to Default Values
   *
   * 落盘的仍是 raw `DEFAULT_CONFIG`（**没有** `routes` 键），所以重置后读取侧会走
   * 一次「键不存在」的迁移分支，得到一条出厂默认的 `auto` 路由。返回值刻意不是
   * `DEFAULT_CONFIG` 本身：调用方（IPC `config:update` 广播、管理 API）要拿到与
   * `getConfig()` 同形的对象，否则 UI 会看到一份没有 routes 的配置并以为「路由全没了」。
   */
  resetConfig(): AppConfig {
    this.ensureInitialized()
    const previous = this.getConfig()
    this.store!.set('config', DEFAULT_CONFIG)
    this.appLogManager?.setMaxEntries(this.getMaxLogEntries(DEFAULT_CONFIG))
    this.applyRequestLogConfig(DEFAULT_CONFIG.requestLogConfig)
    this.applyAutoStart(previous, DEFAULT_CONFIG)
    return this.getConfig()
  }

  // ==================== Model Route Operations ====================

  /**
   * 当前路由表（已归一）。键就是规范化后的路由名。
   */
  getModelRoutes(): Record<string, ModelRoute> {
    return this.getConfig().routes ?? {}
  }

  /**
   * 路由列表（含停用的），按名字排序 —— IPC `routes:list` 的返回值。
   * 刻意不返回 Record：Record 的迭代顺序会被 JS 整数键提升打乱（`2026` 排最前），
   * UI 拿到的顺序就会和 `/v1/models` 不一致。
   */
  listModelRoutes(): ModelRoute[] {
    return allModelRoutes(this.getModelRoutes())
  }

  /**
   * 请求解析：`request.model` 命中的路由，**不看 `enabled`**（停用的路由要能被认出，
   * 好报「这条路由已停用」而不是「没有这个模型的账号」）。路由名优先于同名模型。
   */
  getModelRoute(requestedModel: string): ModelRoute | undefined {
    return findModelRoute(this.getModelRoutes(), requestedModel)
  }

  /**
   * 已经被占用的路由名（大小写不敏感比较由调用方负责）：
   * - `modelNames`：**每个**供应商目录里的展示名，含已停用但仍留在目录里的名字
   *   （`getModelCatalogue` 是 `getEffectiveModels` 的超集，后者只是「在服务」那一片），
   *   以及供应商自己映射表里的键；
   * - `aliases`：全局 `config.modelMappings` 的键（用户自建别名）。
   * 这两路来源合起来就是「一个路由名会不会让请求解析分叉」的全部答案。
   */
  getRouteNameOccupants(): { modelNames: string[]; aliases: string[] } {
    this.ensureInitialized()

    const modelNames = new Set<string>()
    for (const provider of this.getProviders()) {
      for (const model of this.getModelCatalogue(provider.id)) {
        modelNames.add(model.displayName)
      }
      for (const name of Object.keys(provider.modelMappings || {})) {
        modelNames.add(name)
      }
    }

    const aliases = new Set<string>(Object.keys(this.getConfig().modelMappings || {}))

    return { modelNames: [...modelNames], aliases: [...aliases] }
  }

  /**
   * 新建路由（R2）。名字与池策略在写入前严格校验，其余字段按既有兜底归一。
   * 返回 `{ok:false, error}` 而不是抛异常：错误要原样进 IPC 给 UI 显示。
   */
  createRoute(input: Partial<ModelRoute> & { name: string }): ModelRouteMutation {
    this.ensureInitialized()

    const validated = validateRouteNameInput(input.name)
    if (!validated.ok) return { ok: false, error: validated.error }
    const name = validated.name

    const routes = this.getModelRoutes()
    const occupants = this.getRouteNameOccupants()
    const conflict = checkRouteName({
      routes,
      modelNameOccupants: occupants.modelNames,
      aliasOccupants: occupants.aliases,
      name,
    })
    if (conflict !== undefined) return { ok: false, error: conflict }

    const writeError = this.checkRouteFieldWrites(input)
    if (writeError !== undefined) return { ok: false, error: writeError }

    const config = this.getConfig()
    const next = normalizeModelRoutes(
      { ...routes, [name]: { ...routes[name], ...input, name } },
      { fallbackStrategy: config.loadBalanceStrategy }
    )
    const written = this.updateConfig({ routes: next })
    const route = written.routes?.[name]
    if (route === undefined) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: `Route '${name}' was dropped by normalisation` },
      }
    }

    this.addLog('info', `Route created: ${name}`, { data: { name } })
    return { ok: true, route, routes: written.routes ?? {} }
  }

  /**
   * 编辑路由（R2）：`currentName` 是现在的名字，`patch.name` 是**改名**。
   *
   * 改名才做名字冲突校验：一个已经生效的路由不会因为后来同步进来一个同名模型
   * 而失效或被迫改名（请求解析里路由名优先），所以只改别的字段时不许再拿模型名
   * 拒绝这次保存，否则这类用户的配置从此永久写不进去。
   */
  updateRoute(currentName: string, patch: Partial<ModelRoute>): ModelRouteMutation {
    this.ensureInitialized()

    const current = validateRouteNameInput(currentName)
    if (!current.ok) return { ok: false, error: current.error }

    const routes = this.getModelRoutes()
    const existing = routes[current.name]
    if (existing === undefined) {
      return {
        ok: false,
        error: { code: 'not_found', message: `Route '${current.name}' does not exist` },
      }
    }

    const nextName = patch.name === undefined
      ? current.name
      : (() => { const v = validateRouteNameInput(patch.name); return v.ok ? v.name : '' })()
    if (patch.name !== undefined && nextName.length === 0) {
      const invalid = validateRouteNameInput(patch.name)
      return { ok: false, error: invalid.ok ? { code: 'invalid_name', message: 'Invalid route name' } : invalid.error }
    }

    const renaming = nextName !== current.name
    if (renaming) {
      const occupants = this.getRouteNameOccupants()
      const conflict = checkRouteName({
        routes,
        modelNameOccupants: occupants.modelNames,
        aliasOccupants: occupants.aliases,
        name: nextName,
        excluding: current.name,
      })
      if (conflict !== undefined) return { ok: false, error: conflict }
    }

    const writeError = this.checkRouteFieldWrites(patch)
    if (writeError !== undefined) return { ok: false, error: writeError }

    const config = this.getConfig()
    const merged = { ...routes }
    delete merged[current.name]
    merged[nextName] = { ...existing, ...patch, name: nextName }
    const normalized = normalizeModelRoutes(merged, { fallbackStrategy: config.loadBalanceStrategy })
    const written = this.updateConfig({ routes: normalized })
    const route = written.routes?.[nextName]
    if (route === undefined) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: `Route '${nextName}' was dropped by normalisation` },
      }
    }

    this.addLog('info', `Route updated: ${nextName}`, { data: { name: nextName } })
    return { ok: true, route, routes: written.routes ?? {} }
  }

  /**
   * 删除路由（R2 + 验收 A）：删掉之后这个名字**不再被路由**，也不会被迁移复活
   * —— 迁移判据是「原始存储对象上有没有 `routes` 键」，而删除写入的是 `{}`
   * （键存在，值为空）。停用的路由不广告，删除的路由连条目都没有。
   */
  deleteRoute(name: string): ModelRouteRemoval {
    this.ensureInitialized()

    const validated = validateRouteNameInput(name)
    if (!validated.ok) return { ok: false, error: validated.error }

    const routes = this.getModelRoutes()
    const existing = routes[validated.name]
    if (existing === undefined) {
      return {
        ok: false,
        error: { code: 'not_found', message: `Route '${validated.name}' does not exist` },
      }
    }

    const next = { ...routes }
    delete next[validated.name]
    const written = this.updateConfig({ routes: next })

    this.addLog('info', `Route deleted: ${validated.name}`, { data: { name: validated.name } })
    return { ok: true, removed: existing, routes: written.routes ?? {} }
  }

  /**
   * 写入侧的字段严格校验（读取侧是回落，这里是报错）：池策略 id 与打分口径。
   * `prefer` 不在此列 —— 「未知即 balanced」是既有契约，逐路由复用保持同一兜底。
   */
  private checkRouteFieldWrites(input: Partial<ModelRoute>): ModelRouteError | undefined {
    const poolError = checkPoolStrategyIds(input.poolStrategies)
    if (poolError !== undefined) return poolError
    if (input.strategy !== undefined && !isRouteStrategyValue(input.strategy)) {
      return { code: 'invalid_input', message: `Unknown route strategy: ${JSON.stringify(input.strategy)}` }
    }
    const includeError = checkRouteModelRefs('includeModels', input.includeModels)
    if (includeError !== undefined) return includeError
    const excludeError = checkRouteModelRefs('excludeModels', input.excludeModels)
    if (excludeError !== undefined) return excludeError
    return undefined
  }

  // ==================== Log Operations ====================

  /**
   * Add Log Entry
   */
  addLog(
    level: LogLevel,
    message: string,
    data?: {
      accountId?: string
      providerId?: string
      requestId?: string
      deletedAccounts?: number
      data?: Record<string, unknown>
      model?: string
      actualModel?: string
      latency?: number
      isStream?: boolean
      error?: string
    }
  ): LogEntry {
    this.ensureInitialized()
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      level,
      message,
      ...data,
    }

    if (!this.shouldRecordLog(level)) {
      return entry
    }

    this.getAppLogManager().addLog(entry)

    return entry
  }

  /**
   * Get Logs
   * @param limit Limit count
   * @param level Log level filter
   */
  getLogs(filter?: AppLogFilter): LogEntry[] {
    this.ensureInitialized()
    return this.getAppLogManager().getLogs(filter)
  }

  /**
   * Clear Logs
   */
  clearLogs(): void {
    this.ensureInitialized()
    this.getAppLogManager().clearLogs()
    this.store!.set('logs', [])
  }

  replaceLogs(logs: LogEntry[]): void {
    this.ensureInitialized()
    this.getAppLogManager().replaceLogs(logs)
    this.store!.set('logs', [])
  }

  /**
   * Get Log Statistics
   */
  getLogStats(): { total: number; info: number; warn: number; error: number; debug: number } {
    this.ensureInitialized()
    return this.getAppLogManager().getStats()
  }

  /**
   * Get Log Trend
   */
  getLogTrend(days: number = 7): AppLogTrendPoint[] {
    this.ensureInitialized()
    return this.getAppLogManager().getTrend(days)
  }

  /**
   * Get Log Trend for specific account
   * Only counts successful API requests (logs with requestId) to match requestCount
   */
  getAccountLogTrend(accountId: string, days: number = 7): AppLogTrendPoint[] {
    this.ensureInitialized()
    return this.getAppLogManager().getAccountTrend(accountId, days)
  }

  /**
   * Export Logs
   */
  exportLogs(format: 'json' | 'txt' = 'json'): string {
    this.ensureInitialized()
    const logs = this.getCombinedLogs()

    if (format === 'json') {
      return JSON.stringify(logs, null, 2)
    }

    return logs
      .map((log: LogEntry) => {
        const time = new Date(log.timestamp).toISOString()
        const level = log.level.toUpperCase().padEnd(5)
        let line = `[${time}] [${level}] ${log.message}`
        
        if (log.providerId) {
          line += ` | Provider: ${log.providerId}`
        }
        if (log.accountId) {
          line += ` | Account: ${log.accountId}`
        }
        if (log.requestId) {
          line += ` | Request: ${log.requestId}`
        }
        if (log.data) {
          line += ` | Data: ${JSON.stringify(log.data)}`
        }
        
        return line
      })
      .join('\n')
  }

  /**
   * Get Log By ID
   */
  getLogById(id: string): LogEntry | undefined {
    this.ensureInitialized()
    const logs = this.getCombinedLogs()
    return logs.find((l: LogEntry) => l.id === id)
  }

  /**
   * Clear Expired Logs
   */
  cleanExpiredLogs(): void {
    this.ensureInitialized()
    const config = this.getConfig()
    const logs = this.getCombinedLogs()
    const cutoff = Date.now() - config.logRetentionDays * 24 * 60 * 60 * 1000
    
    const filtered = logs.filter((l: LogEntry) => l.timestamp >= cutoff)
    this.getAppLogManager().replaceLogs(filtered)
    this.store!.set('logs', [])
  }

  // ==================== Request Log Operations ====================

  /**
   * Add Request Log Entry
   */
  addRequestLog(entry: Omit<RequestLogEntry, 'id'>): RequestLogEntry {
    this.ensureInitialized()
    const newEntry = this.getRequestLogManager().addRequestLog(entry)
    // A disabled log or a zero cap stores nothing, and a row the disk does not
    // have must not reach the list either.
    const logConfig = this.getConfig().requestLogConfig
    if (logConfig.enabled && logConfig.maxEntries > 0) {
      sendRequestLog(this.mainWindow, newEntry)
    }
    return newEntry
  }

  /**
   * Update Request Log Entry
   */
  updateRequestLog(id: string, updates: Partial<RequestLogEntry>): boolean {
    this.ensureInitialized()
    return this.getRequestLogManager().updateRequestLog(id, updates)
  }

  /**
   * Get Request Logs
   */
  getRequestLogs(limit?: number, filter?: { status?: 'success' | 'error'; providerId?: string }): RequestLogEntry[] {
    this.ensureInitialized()
    return this.getRequestLogManager().getRequestLogs(limit, filter)
  }

  /**
   * Get Request Log By ID
   */
  getRequestLogById(id: string): RequestLogEntry | undefined {
    this.ensureInitialized()
    return this.getRequestLogManager().getRequestLogById(id)
  }

  /**
   * Clear Request Logs
   */
  clearRequestLogs(): void {
    this.ensureInitialized()
    this.getRequestLogManager().clearRequestLogs()
    this.store!.set('statistics', DEFAULT_STATISTICS)
  }

  /**
   * Get Request Log Statistics
   */
  getRequestLogStats(): { total: number; success: number; error: number; todayTotal: number; todaySuccess: number; todayError: number } {
    this.ensureInitialized()
    return this.getRequestLogManager().getRequestLogStats()
  }

  // ==================== Statistics Operations ====================

  /**
   * Get Persistent Statistics
   */
  getStatistics(): PersistentStatistics {
    this.ensureInitialized()
    return this.store!.get('statistics') || DEFAULT_STATISTICS
  }

  /**
   * Update Statistics
   */
  updateStatistics(updates: Partial<PersistentStatistics>): PersistentStatistics {
    this.ensureInitialized()
    const currentStats = this.store!.get('statistics') || DEFAULT_STATISTICS
    const newStats = {
      ...currentStats,
      ...updates,
      lastUpdated: Date.now(),
    }
    this.store!.set('statistics', newStats)
    return newStats
  }

  /**
   * Record Request in Statistics
   */
  recordRequestInStats(
    success: boolean,
    latency: number,
    model?: string,
    providerId?: string,
    accountId?: string
  ): PersistentStatistics {
    this.ensureInitialized()
    const stats = this.store!.get('statistics') || DEFAULT_STATISTICS
    const today = localDayKey(Date.now())
    
    const newStats: PersistentStatistics = {
      ...stats,
      totalRequests: stats.totalRequests + 1,
      successRequests: success ? stats.successRequests + 1 : stats.successRequests,
      failedRequests: success ? stats.failedRequests : stats.failedRequests + 1,
      totalLatency: success ? stats.totalLatency + latency : stats.totalLatency,
      lastUpdated: Date.now(),
      modelUsage: { ...stats.modelUsage },
      providerUsage: { ...stats.providerUsage },
      accountUsage: { ...stats.accountUsage },
      dailyStats: { ...stats.dailyStats },
    }
    
    if (model) {
      newStats.modelUsage[model] = (newStats.modelUsage[model] || 0) + 1
    }
    
    if (providerId) {
      newStats.providerUsage[providerId] = (newStats.providerUsage[providerId] || 0) + 1
    }
    
    if (accountId) {
      newStats.accountUsage[accountId] = (newStats.accountUsage[accountId] || 0) + 1
    }
    
    if (!newStats.dailyStats[today]) {
      newStats.dailyStats[today] = {
        date: today,
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        totalLatency: 0,
        modelUsage: {},
        providerUsage: {},
        providerSuccess: {},
        providerLatency: {},
      }
    }
    
    newStats.dailyStats[today].totalRequests++
    if (success) {
      newStats.dailyStats[today].successRequests++
      newStats.dailyStats[today].totalLatency += latency
    } else {
      newStats.dailyStats[today].failedRequests++
    }
    
    if (model) {
      newStats.dailyStats[today].modelUsage[model] = (newStats.dailyStats[today].modelUsage[model] || 0) + 1
    }
    
    if (providerId) {
      newStats.dailyStats[today].providerUsage[providerId] = (newStats.dailyStats[today].providerUsage[providerId] || 0) + 1

      // Outcomes go on the day only when this build created that day's outcome
      // maps. A day that began under a build which counted requests only has
      // requests we cannot account for, so marking it covered would divide
      // post-upgrade successes by the whole day's requests and report a success
      // rate that is simply wrong. Such a day stays uncovered.
      const daySuccesses = newStats.dailyStats[today].providerSuccess
      const dayLatency = newStats.dailyStats[today].providerLatency
      if (daySuccesses && dayLatency) {
        daySuccesses[providerId] = (daySuccesses[providerId] || 0) + (success ? 1 : 0)
        dayLatency[providerId] = (dayLatency[providerId] || 0) + (success ? latency : 0)
      }
    }
    
    this.store!.set('statistics', newStats)
    return newStats
  }

  /**
   * Get Today Statistics
   */
  getTodayStatistics(): DailyStatistics {
    this.ensureInitialized()
    const stats = this.store!.get('statistics') || DEFAULT_STATISTICS
    const today = localDayKey(Date.now())
    return stats.dailyStats[today] || {
      date: today,
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalLatency: 0,
      modelUsage: {},
      providerUsage: {},
    }
  }

  /**
   * Record one request's token usage into today's bucket.
   *
   * Kept apart from `recordRequestInStats` on purpose: that one is a per-request
   * counter, this one must preserve the upstream/estimate split and is bounded
   * per day. Sharing one write would couple two unrelated retention rules.
   */
  recordTokenUsage(input: {
    promptTokens: number
    completionTokens: number
    source: 'upstream' | 'estimated'
    savedTokens?: number
    /** 上游报的缓存命中输入 token；只在 `source === 'upstream'` 时入池。 */
    cacheReadTokens?: number
    /** 服务这次请求的供应商；缺省就只累加全局池，不写分表。 */
    providerId?: string
    /** 这次请求的美元估算；`undefined` = 没有价格证据，不是 0。 */
    costUsd?: number
    nowMs?: number
  }): void {
    this.ensureInitialized()
    const day = tokenDayKey(input.nowMs ?? Date.now())
    const stored = this.store!.get('tokenUsage') ?? {}
    const next = accumulateDayBucket(stored[day], input)
    // Trim by day count so a long install cannot grow this key forever.
    this.store!.set('tokenUsage', trimDays({ ...stored, [day]: next }))
  }

  /**
   * Every retained day of token counters, normalized and keyed by local day.
   *
   * The whole map, not the answer to one window: the renderer sums it over
   * whatever period the user picked, so changing the period is not a round trip.
   * `statistics.get` already hands over `dailyStats` the same way.
   *
   * A day with no request is skipped rather than shipped as a zero bucket - "no
   * bucket" and "0 requests" are the same distinction the card renders as "-".
   */
  getTokenUsageDays(): Record<string, DayTokenBucket> {
    this.ensureInitialized()
    const stored = this.store!.get('tokenUsage') ?? {}
    const days: Record<string, DayTokenBucket> = {}
    for (const [day, bucket] of Object.entries(stored)) {
      const normalized = normalizeDayBucket(bucket)
      if (normalized.requests > 0) days[day] = normalized
    }
    return days
  }

  /** Today's token summary, or an all-zero bucket when nothing was recorded. */
  getTodayTokenUsage(nowMs: number = Date.now()): DayTokenSummary {
    this.ensureInitialized()
    const day = tokenDayKey(nowMs)
    const stored = this.store!.get('tokenUsage') ?? {}
    // 开关状态必须由这里给出，而不是让界面猜：`savedTokens` 是 0 有两种完全不同的
    // 成因 —— 「压缩开着但没有可压的内容」是测量结果，「压缩被关掉」根本没有测量
    // 发生。只读一个 config 布尔，不新增 IPC 通道。
    const compressionEnabled = this.getConfig().compression?.enabled === true
    return { ...summarizeDay(day, normalizeDayBucket(stored[day])), compressionEnabled }
  }

  /** Token summaries for the newest `days` local days, oldest first. */
  getTokenUsageHistory(days: number = 7, nowMs: number = Date.now()): DayTokenSummary[] {
    this.ensureInitialized()
    const stored = this.store!.get('tokenUsage') ?? {}
    return recentLocalDays(days, nowMs).map(window =>
      summarizeDay(window.key, normalizeDayBucket(stored[window.key]))
    )
  }

  /**
   * Clean Old Daily Statistics (older than 30 days)
   */
  cleanOldDailyStats(): void {
    this.ensureInitialized()
    const stats = this.store!.get('statistics') || DEFAULT_STATISTICS
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const cutoffDate = localDayKey(cutoff)
    
    const filteredDailyStats: Record<string, DailyStatistics> = {}
    for (const [date, dayStats] of Object.entries(stats.dailyStats)) {
      if (date >= cutoffDate) {
        filteredDailyStats[date] = dayStats as DailyStatistics
      }
    }
    
    if (Object.keys(filteredDailyStats).length !== Object.keys(stats.dailyStats).length) {
      stats.dailyStats = filteredDailyStats
      this.store!.set('statistics', stats)
    }
  }

  // ==================== System Prompts Operations ====================

  // ==================== Session Operations ====================

  /**
   * Get Session Configuration
   */
  getSessionConfig(): SessionConfig {
    this.ensureInitialized()
    const config = this.store!.get('config') || DEFAULT_CONFIG
    return config.sessionConfig || DEFAULT_SESSION_CONFIG
  }

  /**
   * Update Session Configuration
   */
  updateSessionConfig(updates: Partial<SessionConfig>): SessionConfig {
    this.ensureInitialized()
    const currentConfig = this.store!.get('config') || DEFAULT_CONFIG
    const newSessionConfig = {
      ...(currentConfig.sessionConfig || DEFAULT_SESSION_CONFIG),
      ...updates,
    }
    const newConfig = {
      ...currentConfig,
      sessionConfig: newSessionConfig,
    }
    this.store!.set('config', newConfig)
    return newSessionConfig
  }

  /**
   * Get All Sessions
   */
  getSessions(): SessionRecord[] {
    this.ensureInitialized()
    return this.store!.get('sessions') || []
  }

  /**
   * Get Session By ID
   */
  getSessionById(id: string): SessionRecord | undefined {
    this.ensureInitialized()
    const sessions = this.store!.get('sessions') || []
    return sessions.find((s: SessionRecord) => s.id === id)
  }

  /**
   * Get Active Sessions
   */
  getActiveSessions(): SessionRecord[] {
    this.ensureInitialized()
    const sessions = this.store!.get('sessions') || []
    const config = this.getSessionConfig()
    const timeoutMs = config.sessionTimeout * 60 * 1000
    const now = Date.now()
    
    return sessions.filter((s: SessionRecord) => 
      s.status === 'active' && 
      (now - s.lastActiveAt) < timeoutMs
    )
  }

  /**
   * Add Session
   */
  addSession(session: SessionRecord): void {
    this.ensureInitialized()
    const sessions = this.store!.get('sessions') || []
    sessions.push(session)
    this.store!.set('sessions', sessions)
  }

  /**
   * Update Session
   */
  updateSession(id: string, updates: Partial<SessionRecord>): SessionRecord | null {
    this.ensureInitialized()
    const sessions = this.store!.get('sessions') || []
    const index = sessions.findIndex((s: SessionRecord) => s.id === id)
    
    if (index === -1) {
      return null
    }
    
    sessions[index] = {
      ...sessions[index],
      ...updates,
    }
    
    this.store!.set('sessions', sessions)
    return sessions[index]
  }

  /**
   * Add Message to Session
   */
  addMessageToSession(sessionId: string, message: ChatMessage): SessionRecord | null {
    this.ensureInitialized()
    const sessions = this.store!.get('sessions') || []
    const index = sessions.findIndex((s: SessionRecord) => s.id === sessionId)
    
    if (index === -1) {
      return null
    }
    
    const config = this.getSessionConfig()
    const session = sessions[index]
    
    if (session.messages.length >= config.maxMessagesPerSession) {
      session.messages = session.messages.slice(-config.maxMessagesPerSession + 1)
    }
    
    session.messages.push(message)
    session.lastActiveAt = Date.now()
    
    sessions[index] = session
    this.store!.set('sessions', sessions)
    return session
  }

  /**
   * Delete Session
   */
  deleteSession(id: string): boolean {
    this.ensureInitialized()
    const sessions = this.store!.get('sessions') || []
    const index = sessions.findIndex((s: SessionRecord) => s.id === id)
    
    if (index === -1) {
      return false
    }
    
    sessions.splice(index, 1)
    this.store!.set('sessions', sessions)
    return true
  }

  /**
   * Mark Session as Expired
   */
  expireSession(id: string): SessionRecord | null {
    return this.updateSession(id, { status: 'expired' })
  }

  /**
   * Clean Expired Sessions
   * Always delete sessions with 'expired' status
   * For timed-out active sessions, behavior depends on deleteAfterTimeout config:
   * - If true: Delete them from storage
   * - If false: Mark them as 'expired' (will be deleted on next clean)
   */
  cleanExpiredSessions(): number {
    this.ensureInitialized()
    const sessions = this.store!.get('sessions') || []
    const config = this.getSessionConfig()
    const timeoutMs = config.sessionTimeout * 60 * 1000
    const now = Date.now()
    
    let removedCount = 0
    
    // Always delete sessions that are already expired
    let remainingSessions = sessions.filter((s: SessionRecord) => {
      if (s.status === 'expired') {
        removedCount++
        return false
      }
      return true
    })
    
    // Handle timed-out active sessions based on config
    if (config.deleteAfterTimeout) {
      // Delete timed-out sessions from storage
      remainingSessions = remainingSessions.filter((s: SessionRecord) => {
        if (s.status === 'active' && (now - s.lastActiveAt) >= timeoutMs) {
          removedCount++
          return false
        }
        return true
      })
    } else {
      // Mark timed-out sessions as expired (will be deleted on next clean)
      remainingSessions = remainingSessions.map((s: SessionRecord) => {
        if (s.status === 'active' && (now - s.lastActiveAt) >= timeoutMs) {
          removedCount++
          return { ...s, status: 'expired' as const }
        }
        return s
      })
    }
    
    this.store!.set('sessions', remainingSessions)
    
    return removedCount
  }

  /**
   * Get Sessions By Account ID
   */
  getSessionsByAccountId(accountId: string): SessionRecord[] {
    this.ensureInitialized()
    const sessions = this.store!.get('sessions') || []
    return sessions.filter((s: SessionRecord) => s.accountId === accountId)
  }

  /**
   * Get Sessions By Provider ID
   */
  getSessionsByProviderId(providerId: string): SessionRecord[] {
    this.ensureInitialized()
    const sessions = this.store!.get('sessions') || []
    return sessions.filter((s: SessionRecord) => s.providerId === providerId)
  }

  /**
   * Clear All Sessions
   */
  clearAllSessions(): void {
    this.ensureInitialized()
    this.store!.set('sessions', [])
  }

  // ==================== Model Management Operations ====================

  /**
   * Get User Model Overrides
   */
  private getUserModelOverrides(): UserModelOverrides {
    this.ensureInitialized()
    return this.store!.get('userModelOverrides') || DEFAULT_USER_MODEL_OVERRIDES
  }

  /**
   * Set User Model Overrides
   */
  private setUserModelOverrides(overrides: UserModelOverrides): void {
    this.ensureInitialized()
    this.store!.set('userModelOverrides', overrides)
  }

  /**
   * 一份 overrides 记录的**读取侧**归一。
   *
   * 这张表没有读取侧归一（`normalizeConfig` 只管 `config`），所以一份被人手改过、
   * 或被外部工具写坏的 `data.json`（缺 `addedModels` / `excludedModels`）会让
   * `removeModel` / `addCustomModel` 直接撞在 `undefined` 上抛 TypeError：用户在 UI 上
   * 删一行模型，拿到的是「内部错误」而不是「删掉了」。读侧的
   * {@link buildModelCatalogue} 有 `|| []` 兜底，所以只有写路径会炸。
   * 补全只发生在内存里，写回时把补全后的形态一起落盘，等于一次自愈。
   */
  private normalizeOverrideRecord(record: unknown): ProviderModelOverrides {
    const source =
      record !== null && typeof record === 'object' && !Array.isArray(record)
        ? (record as Partial<ProviderModelOverrides>)
        : {}
    const normalized: ProviderModelOverrides = {
      ...source,
      addedModels: Array.isArray(source.addedModels) ? source.addedModels : [],
      excludedModels: Array.isArray(source.excludedModels) ? source.excludedModels : [],
    }
    // `fetchedModels` 只在真的是数组时才保留：类型上它是可选的，但 `...source` 会把
    // 一份写坏的值原样带进来，而读侧的 `|| []` 兜不住 `find`/`filter` 之外的用法。
    if (!Array.isArray(source.fetchedModels)) {
      delete normalized.fetchedModels
    }
    return normalized
  }

  /**
   * 全部手工能力标注（providerId -> displayName -> hint）。
   *
   * 与 `userModelOverrides` 分开存储，所以模型列表同步、重置都不会碰它 ——
   * 用户纠正过的一条错误标注不能在下次在线刷新后悄悄消失。
   */
  getUserModelMarks(): UserModelMarks {
    this.ensureInitialized()
    return this.store!.get('userModelMarks') || DEFAULT_USER_MODEL_MARKS
  }

  /**
   * 写入/清除一条手工标注。`mark` 为 `null` 或归一后没有有效字段表示**清除**，
   * 即回到自动标注。返回写入后的全量标注表，UI 直接替换本地副本。
   *
   * 校验两层：供应商必须存在、模型必须在该供应商目录里（含已停用）。
   * 名字或供应商 id 打错时不报错就等于「保存成功但永不生效」，这里直接拒绝。
   */
  setUserModelMark(
    providerId: string,
    displayName: string,
    mark: ModelCapabilityHint | null
  ): UserModelMarks {
    this.ensureInitialized()

    if (!this.getProviderById(providerId)) {
      throw new Error(`Provider not found: ${providerId}`)
    }
    const name = typeof displayName === 'string' ? displayName.trim() : ''
    if (name.length === 0) {
      throw new Error('Model display name is required')
    }
    if (!this.getModelCatalogue(providerId).some(model => model.displayName === name)) {
      throw new Error(`Model not in the catalogue of ${providerId}: ${name}`)
    }

    const current = this.getUserModelMarks()
    const forProvider: Record<string, ModelCapabilityHint> = { ...(current[providerId] ?? {}) }
    const normalized = mark === null ? undefined : normalizeModelMark(mark)
    if (normalized === undefined) {
      delete forProvider[name]
    } else {
      forProvider[name] = normalized
    }

    const next: UserModelMarks = { ...current }
    if (Object.keys(forProvider).length === 0) {
      delete next[providerId]
    } else {
      next[providerId] = forProvider
    }

    this.store!.set('userModelMarks', next)
    return next
  }

  /**
   * Get Provider Model Overrides
   */
  private getProviderModelOverrides(providerId: string): ProviderModelOverrides {
    const overrides = this.getUserModelOverrides()
    return overrides[providerId] || {
      addedModels: [],
      excludedModels: [],
    }
  }

  /**
   * Get Effective Models for a Provider
   * Merges default models with user overrides
   */
  /**
   * The whole catalogue with each row's served flag, so the management page can
   * list a stopped model instead of losing it.
   */
  getModelCatalogue(providerId: string): CatalogueModel[] {
    this.ensureInitialized()

    const provider = this.getProviderById(providerId)
    if (!provider) {
      return []
    }

    return buildModelCatalogue(
      provider.supportedModels || [],
      provider.modelMappings || {},
      this.getProviderModelOverrides(providerId)
    )
  }

  /**
   * Get Effective Models for a Provider
   * The served slice of the catalogue: what `/v1/models` advertises and what the
   * load balancer routes, so advertising and routing cannot disagree.
   */
  getEffectiveModels(providerId: string): EffectiveModel[] {
    return this.getModelCatalogue(providerId)
      .filter(model => model.served)
      .map(model => ({
        displayName: model.displayName,
        actualModelId: model.actualModelId,
        isCustom: model.isCustom,
        source: model.source,
      }))
  }

  /**
   * Start or stop a batch of catalogue models for one provider.
   */
  setModelsServed(providerId: string, names: string[], served: boolean): CatalogueModel[] {
    this.ensureInitialized()

    if (!this.getProviderById(providerId)) {
      throw new Error('Provider not found')
    }

    if (names.length === 0) {
      return this.getModelCatalogue(providerId)
    }

    const overrides = this.getUserModelOverrides()
    const current = this.normalizeOverrideRecord(overrides[providerId])
    this.setUserModelOverrides({
      ...overrides,
      [providerId]: {
        ...current,
        excludedModels: applyServed(current.excludedModels, names, served),
      },
    })

    return this.getModelCatalogue(providerId)
  }

  /**
   * Store a freshly fetched online model list for a provider
   */
  applyFetchedModels(
    providerId: string,
    models: FetchedModel[]
  ): { fetchedCount: number; addedCount: number; fetchedAt: number; effectiveModels: EffectiveModel[] } {
    this.ensureInitialized()

    const before = new Set(this.getEffectiveModels(providerId).map(model => model.displayName))
    const overrides = this.getUserModelOverrides()
    const current = this.normalizeOverrideRecord(overrides[providerId])

    const fetchedAt = Date.now()
    current.fetchedModels = models.map(model => ({
      displayName: model.displayName,
      actualModelId: model.actualModelId,
    }))
    current.fetchedAt = fetchedAt
    this.setUserModelOverrides({ ...overrides, [providerId]: current })

    const effectiveModels = this.getEffectiveModels(providerId)
    const addedCount = effectiveModels.filter(model => !before.has(model.displayName)).length

    return { fetchedCount: models.length, addedCount, fetchedAt, effectiveModels }
  }

  /**
   * Add Custom Model to Provider
   */
  addCustomModel(providerId: string, model: CustomModel): EffectiveModel[] {
    this.ensureInitialized()
    
    const overrides = this.getUserModelOverrides()
    
    const current = this.normalizeOverrideRecord(overrides[providerId])

    const existingModel = current.addedModels.find(
      m => m.displayName === model.displayName || m.actualModelId === model.actualModelId
    )
    
    if (existingModel) {
      throw new Error(`Model with display name "${model.displayName}" or actual ID "${model.actualModelId}" already exists`)
    }

    current.addedModels.push(model)
    this.setUserModelOverrides({ ...overrides, [providerId]: current })

    return this.getEffectiveModels(providerId)
  }

  /**
   * Remove Model from Provider
   * For default models: add to excludedModels
   * For custom models: remove from addedModels
   */
  removeModel(providerId: string, modelName: string): EffectiveModel[] {
    this.ensureInitialized()
    
    const provider = this.getProviderById(providerId)
    if (!provider) {
      throw new Error('Provider not found')
    }

    const overrides = this.getUserModelOverrides()
    
    const current = this.normalizeOverrideRecord(overrides[providerId])

    const defaultModels = provider.supportedModels || []
    const isDefaultModel = defaultModels.includes(modelName)

    if (isDefaultModel) {
      if (!current.excludedModels.includes(modelName)) {
        current.excludedModels.push(modelName)
      }
    } else {
      current.addedModels = current.addedModels.filter(m => m.displayName !== modelName)
      // Otherwise deleting a row that came from the last online sync would do nothing
      current.fetchedModels = (current.fetchedModels || []).filter(m => m.displayName !== modelName)
    }

    this.setUserModelOverrides({ ...overrides, [providerId]: current })

    return this.getEffectiveModels(providerId)
  }

  /**
   * Reset Provider Models to Default
   * Removes all user overrides for the provider
   */
  resetModels(providerId: string): EffectiveModel[] {
    this.ensureInitialized()
    
    const overrides = this.getUserModelOverrides()
    
    if (overrides[providerId]) {
      delete overrides[providerId]
      this.setUserModelOverrides(overrides)
    }

    const builtinConfig = BUILTIN_PROVIDERS.find(provider => provider.id === providerId)
    if (builtinConfig) {
      const providers = (this.store!.get('providers') as Provider[] || []).map(provider => {
        if (provider.id !== providerId || provider.type !== 'builtin') {
          return provider
        }

        return {
          ...provider,
          apiEndpoint: builtinConfig.apiEndpoint,
          chatPath: builtinConfig.chatPath,
          supportedModels: builtinConfig.supportedModels,
          modelMappings: builtinConfig.modelMappings,
          headers: builtinConfig.headers,
          credentialFields: builtinConfig.credentialFields,
          description: builtinConfig.description,
          updatedAt: Date.now(),
        }
      })
      this.store!.set('providers', providers)
    }

    return this.getEffectiveModels(providerId)
  }

  // ==================== Utility Methods ====================

  /**
   * Generate Unique ID
   */
  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  }

  /**
   * Get Storage Instance (for internal use only)
   */
  getStore(): StoreType | null {
    return this.store
  }

  /**
   * Clear All Data
   */
  clearAll(): void {
    this.ensureInitialized()
    this.appLogManager?.clearLogs()
    this.appLogManager?.flushSync()
    this.store!.clear()
    this.requestLogManager?.clearRequestLogs()
    this.requestLogManager?.flushSync()
  }

  /**
   * Get Storage Path
   */
  getStorePath(): string {
    return this.getStoragePath()
  }

  getQuotaLedger(): QuotaLedger {
    if (!this.quotaLedger) {
      throw new Error('Quota ledger is not initialized')
    }
    return this.quotaLedger
  }

  private getRequestLogManager(): RequestLogManager {
    if (!this.requestLogManager) {
      throw new Error('Request log manager is not initialized')
    }
    return this.requestLogManager
  }

  private getAppLogManager(): AppLogManager {
    if (!this.appLogManager) {
      throw new Error('App log manager is not initialized')
    }
    return this.appLogManager
  }
}

// Export singleton instance
export const storeManager = new StoreManager()

// Export types
export type { StoreType }
