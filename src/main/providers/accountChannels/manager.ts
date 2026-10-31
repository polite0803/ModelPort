/**
 * Account-channel manager.
 *
 * Sits between the pack worker and the rest of the app:
 * - mirrors the worker's account/model state into provider records, so routing,
 *   `/v1/models` and the load balancer work exactly like any other provider;
 * - answers the IPC surface the channels page renders;
 * - owns the worker bridge for the request path.
 *
 * Provider records only exist while a channel actually has accounts, which keeps
 * the provider list free of ten unusable rows and — more importantly — prevents
 * an enabled record with zero models from becoming a wildcard route target
 * (`providerSupportsModel` treats an empty effective model list as "matches
 * everything").
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { PassThrough } from 'node:stream'
import { shell } from 'electron'
import AccountManager from '../../store/accounts'
import { storeManager } from '../../store/store'
import type { ModelMapping, Provider } from '../../store/types'
import { ChannelBridge, ChannelBridgeError } from '../../channelPack/bridge'
import type {
  ChannelAutoCheckinResult,
  ChannelCredits,
  ChannelModelInfo,
  ChannelModelsResult,
  ChannelModelUpdateResult,
  ChannelOperationResult,
  ChannelRefreshResult,
  ChannelRpcResult,
  ChannelView,
} from '../../../shared/channels'
import type { ModelCapabilityHint } from '../../../shared/types'
import { ACCOUNT_CHANNELS, getChannelDefinition } from './catalogue'
import { attachContextWindows, capabilityHintOf, readModelList } from './modelCatalog'
import { channelRuntimeState } from './runtimeState'
import { resyncsAfterChannelRpc } from './rpcSync'
import { ChannelCredentialVault } from './vault'

interface PackProviderStatus {
  models?: { total?: number; disabled?: number }
  accounts?: { total?: number; enabled?: number }
}

interface PackAccount {
  id?: string
  nickname?: string
  enabled?: boolean
  refreshable?: boolean
  createdAt?: number
  expiresAt?: number
}

const MODELS_CACHE_MS = 30_000

interface ModelsCache {
  at: number
  byChannel: Map<string, ChannelModelInfo[]>
}

class AccountChannelManager {
  private bridge: ChannelBridge | null = null
  private vault: ChannelCredentialVault | null = null
  private initializing: Promise<void> | null = null
  private syncing: Promise<void> | null = null
  private modelsCache: ModelsCache | null = null
  private onChanged: (() => void) | null = null
  private rateLimitCache = new Map<string, { value: Record<string, { limited: true; resetAtMs: number }>; expiresAt: number }>()

  private get dataDir(): string {
    return join(homedir(), '.modelport')
  }

  /** Registers the renderer notification sink (called once from IPC setup). */
  setChangeListener(listener: () => void): void {
    this.onChanged = listener
  }

  /**
   * Starts the worker and mirrors its state into provider records.
   *
   * Safe to call repeatedly; concurrent callers share one start. A failed start
   * is not cached, so a later `channels:list` retries instead of staying broken.
   */
  async initialize(): Promise<void> {
    if (this.initializing !== null) return this.initializing
    this.initializing = (async () => {
      const channelHome = join(this.dataDir, 'channel-pack')
      const vault = new ChannelCredentialVault(channelHome)
      const bridge = new ChannelBridge({
        // The pack writes `channel-pack/state.json` under this dir, so accounts
        // and the credential values stay next to each other.
        dataDir: this.dataDir,
        vault,
        onChanged: () => {
          this.notifyChanged()
        },
        onLog: (level, message) => {
          if (level === 'error') console.error(`[ChannelPack] ${message}`)
          else if (level === 'warn') console.warn(`[ChannelPack] ${message}`)
          else console.log(`[ChannelPack] ${message}`)
        },
      })
      await bridge.start()
      this.vault = vault
      this.bridge = bridge
      await this.syncProviders()
    })()
    try {
      await this.initializing
    } catch (error) {
      this.initializing = null
      throw error
    }
  }

  /** Throws when the worker cannot be started; the forwarder turns it into a 5xx. */
  async bridgeOrThrow(): Promise<ChannelBridge> {
    await this.initialize()
    if (this.bridge === null) throw new ChannelBridgeError('渠道运行时不可用', 503)
    return this.bridge
  }

  /**
   * Worker 是否已经在跑。
   *
   * 状态检查**不允许顺手拉起 Worker**（与 opencode 的同一条规则）：启动要加载
   * WASM 与十个适配器，把一次「看看在线吗」变成几十秒的副作用是不可接受的。
   */
  isRuntimeRunning(): boolean {
    return channelRuntimeState.running
  }

  async list(): Promise<ChannelView[]> {
    const bridge = await this.bridgeOrThrow()
    const status = await this.packStatus(bridge)
    const views: ChannelView[] = []
    for (const channel of ACCOUNT_CHANNELS) {
      const provider = storeManager.getProviderById(channel.id)
      let accounts: PackAccount[] = []
      const listed = await bridge.rpc('account.list', { provider: channel.id })
      if (listed.ok) {
        const value = listed.value as { accounts?: PackAccount[] } | undefined
        accounts = Array.isArray(value?.accounts) ? value.accounts : []
      }
      const packStatus = status[channel.id]
      views.push({
        id: channel.id,
        name: channel.name,
        vendor: channel.vendor,
        loginKind: channel.loginKind,
        credentialAdd: channel.credentialAdd,
        description: channel.description,
        configured: provider !== undefined && provider.type === 'account',
        enabled: provider?.enabled === true,
        accounts: {
          total: packStatus?.accounts?.total ?? accounts.length,
          enabled: packStatus?.accounts?.enabled
            ?? accounts.filter(account => account.enabled !== false).length,
          list: accounts.map(account => ({
            id: String(account.id ?? ''),
            nickname: String(account.nickname ?? account.id ?? ''),
            enabled: account.enabled !== false,
            createdAt: typeof account.createdAt === 'number' ? account.createdAt : undefined,
            expiresAt: typeof account.expiresAt === 'number' ? account.expiresAt : undefined,
            refreshable: account.refreshable === true,
          })),
        },
        models: {
          total: packStatus?.models?.total ?? 0,
          disabled: packStatus?.models?.disabled ?? 0,
        },
      })
    }
    return views
  }

  /**
   * 每个渠道的账号计数，来自 Worker 的账号池 —— 供应商卡片计数走这里。
   *
   * 为什么不复用 `list()`：它为了渲染卡片还要拉每家渠道的 `account.list`
   * （逐个解析凭据）并读模型目录，而「供应商列表上有几个号」只关心计数。这里
   * 只发一次 `provider.status`（池内内存副本，无 IO），成本与渠道数无关。
   *
   * Worker 未启动或调用失败时返回 `{}`：调用方应保留本地计数，而不是把已经连上
   * 账号的渠道显示成 0 个。
   */
  async accountCounts(): Promise<Record<string, { total: number; enabled: number }>> {
    const bridge = await this.bridgeOrThrow()
    const status = await this.packStatus(bridge)
    const counts: Record<string, { total: number; enabled: number }> = {}
    for (const channel of ACCOUNT_CHANNELS) {
      const pool = status[channel.id]?.accounts
      if (pool === undefined) continue
      counts[channel.id] = {
        total: pool.total ?? 0,
        enabled: pool.enabled ?? 0,
      }
    }
    return counts
  }

  async credits(id: string): Promise<ChannelCredits> {
    if (getChannelDefinition(id) === undefined) {
      return { reported: 0, accounts: [], error: 'unknown_channel' }
    }
    const bridge = await this.bridgeOrThrow()
    const result = await bridge.rpc('credits.balances', { provider: id })
    if (!result.ok) {
      const message = result.error?.message ?? ''
      return {
        reported: 0,
        accounts: [],
        // 「不支持」与「查询失败」必须分开：前者是产品事实，后者值得重试。
        unsupported: /unsupported|not supported|不支持/i.test(message) || result.error?.code === 'bad-request',
        error: message || undefined,
      }
    }
    const value = result.value as
      | { accounts?: Array<{ accountId?: string; nickname?: string; enabled?: boolean; balance?: { total?: number } | null; error?: string }> }
      | undefined
    const rows = Array.isArray(value?.accounts) ? value.accounts : []
    let total = 0
    let reported = 0
    const accounts = rows.map(row => {
      const remaining = typeof row.balance?.total === 'number' ? row.balance.total : undefined
      if (remaining !== undefined) {
        reported += 1
        // 渠道总额只累计**启用**账号（worker 对停用账号也回余额，供列表展示；
        // `enabled` 缺省按 true 处理以兼容旧 worker）。否则启停一个号总额
        // 纹丝不动 —— 用户开/关账号就看不到积分的加或减（2026-10-30 缺陷）。
        if (row.enabled !== false) {
          total += remaining
        }
      }
      return {
        accountId: String(row.accountId ?? ''),
        nickname: String(row.nickname ?? row.accountId ?? ''),
        // 逐账号读数要一路带到界面：只有渠道总额时，一个号查询失败就表现为
        // 「总额凭空少了一截」，用户无法知道少了谁、为什么少（2026-11-01）。
        enabled: row.enabled !== false,
        remaining,
        error: typeof row.error === 'string' ? row.error : undefined,
      }
    })
    return { reported, accounts, ...reported > 0 ? { remaining: Math.round(total * 100) / 100 } : {} }
  }

  /**
   * 查询某渠道一批模型当前是否「全部启用账号都在限流中」（auto 选路预检）。
   *
   * ## 背景（用户报障 2026-10-30）
   *
   * worker 内部账号池有**模型级限流**（loomy spark-x2.6 当日额度用尽、次日
   * 00:00 解禁），全账号受限时请求以 LlmError(QUOTA_EXCEEDED) 失败 —— 而该
   * 状态只存在于 worker 内存，主进程选路时毫不知情，auto 会把请求发进必败
   * 渠道。auto 在发请求前用本方法预检：全限流的模型候选直接跳过。
   *
   * ## 缓存
   *
   * rpc 走 worker 内存副本（无网络、无凭据解析），但仍做 TTL 缓存对齐余额
   * 门控策略：成功 60s、失败 5s —— 选路热路径每个渠道每分钟最多一次 IPC，
   * 且限流状态本来就是分钟级粒度。账号启停/重置时用 {@link clearRateLimitCache}
   * 立即失效。失败返回空表（fail-open：查不到就放行，不拦正常流量）。
   */
  async modelRateLimits(id: string, modelIds: string[]): Promise<Record<string, { limited: true; resetAtMs: number }>> {
    if (getChannelDefinition(id) === undefined || modelIds.length === 0) {
      return {}
    }
    const key = `${id}::${[...new Set(modelIds)].sort().join('|')}`
    const cached = this.rateLimitCache.get(key)
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return cached.value
    }
    try {
      const bridge = await this.bridgeOrThrow()
      const result = await bridge.rpc('model.rateLimits', { provider: id, models: modelIds })
      const value = result.ok
        ? (result.value as { rateLimits?: Record<string, { limited: true; resetAtMs: number }> } | undefined)?.rateLimits
        : undefined
      const table = value !== null && typeof value === 'object' ? value : {}
      this.rateLimitCache.set(key, { value: table, expiresAt: Date.now() + (result.ok ? 60_000 : 5_000) })
      return table
    } catch {
      const table: Record<string, { limited: true; resetAtMs: number }> = {}
      this.rateLimitCache.set(key, { value: table, expiresAt: Date.now() + 5_000 })
      return table
    }
  }

  /** 账号启停/重置/换号后立即失效该渠道的限流预检缓存。 */
  clearRateLimitCache(id?: string): void {
    if (id === undefined) {
      this.rateLimitCache.clear()
      return
    }
    const prefix = `${id}::`
    for (const key of this.rateLimitCache.keys()) {
      if (key.startsWith(prefix)) {
        this.rateLimitCache.delete(key)
      }
    }
  }

  /**
   * Reads the global "claim every account's daily credits automatically" switch.
   *
   * The switch is one for all channels: when on, the pack claims once per
   * channel for every account and only once per UTC+8 day (`lastDate` is the
   * de-duplication key). It is on by default and the pack schedules a round 30s
   * after it starts, so this may already report somebody else's run.
   */
  async autoCheckin(): Promise<ChannelAutoCheckinResult> {
    return this.readAutoCheckin(undefined)
  }

  /** Writes the switch; enabling makes the pack try a round immediately. */
  async setAutoCheckin(enabled: boolean): Promise<ChannelAutoCheckinResult> {
    return this.readAutoCheckin(enabled)
  }

  private async readAutoCheckin(enabled: boolean | undefined): Promise<ChannelAutoCheckinResult> {
    const bridge = await this.bridgeOrThrow()
    // `enabled` 省略 = 只读；这与渠道包 `usage.autoCheckin` 的契约一致。
    const result = await bridge.rpc('usage.autoCheckin', enabled === undefined ? {} : { enabled })
    if (!result.ok) {
      return {
        success: false,
        reason: result.error?.message ?? result.error?.code ?? 'auto_checkin_failed',
      }
    }
    const raw = (result.value as { autoCheckin?: Record<string, unknown> } | undefined)?.autoCheckin
    if (raw === undefined || raw === null) {
      return { success: false, reason: 'auto_checkin_unavailable' }
    }
    // 外部数据一律按缺省值收敛，界面不必再对每个字段做空判断。
    return {
      success: true,
      state: {
        // 渠道包的判据是「只有显式 false 才算关闭」（默认打开），照抄它。
        enabled: raw.enabled !== false,
        lastDate: typeof raw.lastDate === 'string' ? raw.lastDate : '',
        ranToday: raw.ranToday === true,
        running: raw.running === true,
        lastResult: typeof raw.lastResult === 'string' ? raw.lastResult : '',
        lastAt: typeof raw.lastAt === 'number' ? raw.lastAt : 0,
        dismissed: raw.dismissed === true,
      },
    }
  }

  /**
   * A channel's online catalogue, including each model's credit weight.
   *
   * The catalogue is cached for 30s and this is only called when the user opens
   * a channel's model list, so ten channels are not fetched on first paint.
   */
  async modelsFor(id: string): Promise<ChannelModelsResult> {
    if (getChannelDefinition(id) === undefined) {
      return { success: false, models: [], reason: 'unknown_channel' }
    }
    const bridge = await this.bridgeOrThrow()
    const byChannel = await this.models(bridge)
    return { success: true, models: byChannel.get(id) ?? [] }
  }

  /**
   * Re-reads one channel's model list online and writes it back into the
   * provider record and the global model mappings.
   *
   * The whole catalogue cache is cleared rather than just this channel: a
   * partial cache would make `syncProviders` see the other channels as having
   * no models and disable them.
   */
  async refreshModels(id: string): Promise<ChannelRefreshResult> {
    if (getChannelDefinition(id) === undefined) return { success: false, reason: 'unknown_channel' }
    await this.bridgeOrThrow()
    await this.resync()
    const count = this.cachedModels(id).length
    if (count === 0) {
      // 没账号、远端目录拉取失败或返回空：保留旧记录，只报告空结果。
      return { success: false, count: 0, reason: 'empty' }
    }
    return { success: true, count }
  }

  /**
   * 打开 / 关闭单个模型。
   *
   * 渠道包写盘后会广播一次目录变更，理论上不下发返回值也能等到界面刷新；但
   * 广播是异步的，这里直接重同步一次，返回的目录与 provider 记录来自同一次
   * 写入，界面不必猜时序。
   *
   * ⚠️ 关掉的模型仍然会出现在目录里（`model.list` 刻意如此，否则用户再也
   * 找不到开关），但 `syncProviders` 会把它从可路由模型里剔除。
   */
  async setModelDisabled(
    id: string,
    modelId: string,
    disabled: boolean,
  ): Promise<ChannelModelUpdateResult> {
    if (getChannelDefinition(id) === undefined) {
      return { success: false, models: [], reason: 'unknown_channel' }
    }
    if (modelId.length === 0) return { success: false, models: [], reason: 'invalid_model' }
    const bridge = await this.bridgeOrThrow()
    const result = await bridge.rpc('model.setDisabled', { provider: id, modelId, disabled })
    if (!result.ok) {
      return {
        success: false,
        models: this.cachedModels(id),
        reason: result.error?.message ?? result.error?.code ?? 'model_update_failed',
      }
    }
    await this.resync()
    return { success: true, models: this.cachedModels(id) }
  }

  /**
   * 把「已失效」的模型从失效表里恢复，让它重新出现在目录与路由里。
   *
   * 失效记录的唯一自愈路径是 TTL 过期（默认 30 天），且失效模型会被排除出
   * 目录 —— 误判一次就等于该模型被藏 30 天且用户毫无办法，所以必须有这个
   * 恢复入口。省略 `modelId` 才是「恢复该渠道全部失效模型」。
   */
  async clearDeadModels(id: string, modelId?: string): Promise<ChannelModelUpdateResult> {
    if (getChannelDefinition(id) === undefined) {
      return { success: false, models: [], reason: 'unknown_channel' }
    }
    if (modelId !== undefined && modelId.length === 0) {
      return { success: false, models: [], reason: 'invalid_model' }
    }
    const bridge = await this.bridgeOrThrow()
    const deadBefore = (await this.models(bridge)).get(id)?.filter(model => model.dead).length ?? 0
    const result = await bridge.rpc('model.clearDead', {
      provider: id,
      ...(modelId === undefined ? {} : { modelId }),
    })
    if (!result.ok) {
      return {
        success: false,
        models: this.cachedModels(id),
        reason: result.error?.message ?? result.error?.code ?? 'model_update_failed',
      }
    }
    const remaining = (result.value as { deadModels?: unknown } | undefined)?.deadModels
    const deadAfter = Array.isArray(remaining) ? remaining.length : 0
    await this.resync()
    return {
      success: true,
      models: this.cachedModels(id),
      removed: Math.max(0, deadBefore - deadAfter),
    }
  }

  /**
   * Forwards one pack RPC.
   *
   * `account.create` is special-cased: the pack returns a login URL and expects
   * a browser window. Opening it here keeps the renderer free of shell access
   * and guarantees the URL is opened exactly once.
   */
  async rpc(method: string, payload: unknown): Promise<ChannelRpcResult> {
    const bridge = await this.bridgeOrThrow()
    const result = await bridge.rpc(method, payload)
    if (method === 'account.create' && result.ok) {
      const value = result.value as { loginUrl?: unknown } | undefined
      if (typeof value?.loginUrl === 'string' && /^https?:\/\//i.test(value.loginUrl)) {
        void shell.openExternal(value.loginUrl)
      }
    }
    // 渠道包没有为所有改动账号池的方法广播 `changed`（opencode 的两个加账号方法就不发），
    // 这里补一次镜像：否则账号进了池子、provider 记录却没出现，卡永远停在「未配置」。
    if (result.ok && resyncsAfterChannelRpc(method)) this.notifyChanged()
    return result
  }

  /** 账号池或模型目录可能变了：清缓存、重建 provider 记录、通知界面。 */
  private notifyChanged(): void {
    this.modelsCache = null
    void this.syncProviders()
    this.onChanged?.()
  }

  setEnabled(id: string, enabled: boolean): ChannelOperationResult {
    const channel = getChannelDefinition(id)
    if (channel === undefined) return { success: false, reason: 'unknown_channel' }
    const provider = storeManager.getProviderById(id)
    if (provider === undefined || provider.type !== 'account') {
      return { success: false, reason: 'not_configured' }
    }
    storeManager.updateProvider(id, { enabled })
    void this.syncProviders()
    return { success: true }
  }

  /** Deletes every pack account and drops the mirrored provider record. */
  async remove(id: string): Promise<ChannelOperationResult> {
    const bridge = await this.bridgeOrThrow()
    const listed = await bridge.rpc('account.list', { provider: id })
    if (listed.ok) {
      const value = listed.value as { accounts?: PackAccount[] } | undefined
      for (const account of value?.accounts ?? []) {
        if (typeof account.id === 'string' && account.id.length > 0) {
          await bridge.rpc('account.delete', { accountId: account.id })
        }
      }
    }
    this.dropProvider(id)
    this.modelsCache = null
    this.onChanged?.()
    return { success: true }
  }

  /* ------------------------------------------------------------ 请求路径 */

  async complete(request: {
    requestId: string
    model: string
    openAi: Record<string, unknown>
  }): Promise<Record<string, unknown>> {
    const bridge = await this.bridgeOrThrow()
    return bridge.complete({ ...request, stream: false })
  }

  async openStream(request: {
    requestId: string
    model: string
    openAi: Record<string, unknown>
  }): Promise<PassThrough> {
    const bridge = await this.bridgeOrThrow()
    return bridge.openStream({ ...request, stream: true })
  }

  async shutdown(): Promise<void> {
    const bridge = this.bridge
    this.bridge = null
    this.initializing = null
    if (bridge !== null) await bridge.shutdown()
  }

  /* ------------------------------------------------------------ 内部 */

  private async packStatus(bridge: ChannelBridge): Promise<Record<string, PackProviderStatus>> {
    const result = await bridge.rpc('provider.status', {
      providers: ACCOUNT_CHANNELS.map(channel => channel.id),
    })
    if (!result.ok) return {}
    const value = result.value as { statuses?: Record<string, PackProviderStatus> } | undefined
    return value?.statuses ?? {}
  }

  /**
   * Rewrites provider records from the worker's account + model state.
   *
   * Runs on start, on every pack `changed` event and after enable toggles;
   * concurrent runs share one pass. Failures are logged and swallowed — a model
   * sync failure must never take down the app or the request path.
   */
  private syncProviders(): Promise<void> {
    if (this.syncing !== null) return this.syncing
    this.syncing = (async () => {
      const bridge = this.bridge
      if (bridge === null) return
      try {
        const [status, models] = await Promise.all([
          this.packStatus(bridge),
          this.models(bridge),
        ])
        for (const channel of ACCOUNT_CHANNELS) {
          const total = status[channel.id]?.accounts?.total ?? 0
          // `model.list` 刻意把「用户关闭」与「已失效」的模型也列出来（否则界面
          // 上再也找不到它们、无法重新打开），但它们**不能参与路由**：写进
          // supportedModels 就等于把 user 主动禁用的模型和上游已下线的模型
          // 继续对外暴露，请求会打到一个必然失败的模型上。
          //
          // 对外用「渠道名 / 上游展示名」（`Trae / DeepSeek-Flash`，而不是内部
          // id `qmodel_38max`）：客户端 `/v1/models` 拿到的就是渠道里看到的
          // 名字。统一加前缀，既不担心跨渠道重名被 `/v1/models` 吞掉，也省掉
          // 一次重名判断，名字还不会随另一家的启停状态来回变。转发仍用
          // `${channel}/${id}`，由 `modelMappings` 把展示名接到内部 id 上。
          // 同渠道内同名的仍是别名，只保留第一条（`model.list` 的顺序即上游
          // 优先级）。
          const owned = new Map<string, string>()
          const legacyNames: Record<string, string> = {}
          const capabilities: Record<string, ModelCapabilityHint> = {}
          for (const model of models.get(channel.id) ?? []) {
            if (model.disabled || model.dead) continue
            const baseName = model.name.trim().length > 0 ? model.name : `${channel.id}/${model.id}`
            const displayName = `${channel.name} / ${baseName}`
            if (!owned.has(displayName)) {
              owned.set(displayName, `${channel.id}/${model.id}`)
              const hint = capabilityHintOf(model)
              if (hint !== undefined) capabilities[displayName] = hint
            }
            legacyNames[`${channel.id}/${model.id}`] = displayName
          }
          this.applyChannel(channel.id, channel.name, total, [...owned], legacyNames, capabilities)
        }
      } catch (error) {
        console.warn(`[ChannelPack] 同步供应商记录失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        this.syncing = null
      }
    })()
    return this.syncing
  }

  /**
   * Every channel's online catalogue, keyed by channel id, cached for 30s.
   *
   * 目录主体走 `model.list`：它是唯一知道**倍率**与 `disabled`/`dead` 的地方，
   * 而 `bridge.models()`（OpenAI 形状）的 `name` 不带倍率、也表达不了这两种状态。
   *
   * ⚠️ 但 `model.list` **不带上下文窗口**，所以这里额外取一次 `/v1/models` 视图，
   * 把 `context_window` 合并进去（`attachContextWindows`）。不合并的后果不是"显示
   * 少一格"，而是功能性的：`auto` 路由把未知窗口按 `UNANNOTATED_CONTEXT_FLOOR`
   * （64K）算，于是任何超过 64K 的请求会把**全部十二个渠道**判成装不下而排除 ——
   * 而实测这些渠道正在服务 300K–500K+（TRAE 单请求 503,128 prompt、0 错误）。
   * 视图整轮只拉一次，12 个渠道共用，避免把同步变成 12 次往返。
   */
  private async models(bridge: ChannelBridge): Promise<Map<string, ChannelModelInfo[]>> {
    const now = Date.now()
    if (this.modelsCache !== null && now - this.modelsCache.at < MODELS_CACHE_MS) {
      return this.modelsCache.byChannel
    }
    const view = await this.modelView(bridge)
    const byChannel = new Map<string, ChannelModelInfo[]>()
    await Promise.all(ACCOUNT_CHANNELS.map(async channel => {
      byChannel.set(channel.id, await this.fetchModels(bridge, channel.id, view))
    }))
    this.modelsCache = { at: now, byChannel }
    // 一行可 grep 的诊断：哪些渠道真的报了上下文窗口、哪些没有。
    // 用 `storeManager.addLog` 而不是 `console.log` —— 只有前者会落进
    // `<dataDir>/logs/app-logs.ndjson`，而"窗口有没有下发"这件事恰恰只能从
    // 那里事后核对（`/v1/models` 需要 API key，排查时不一定拿得到）。
    this.logWindowCoverage(byChannel)
    return byChannel
  }

  /** 记录每个渠道的窗口覆盖率；只统计"有模型的渠道"，避免空渠道刷屏。 */
  private logWindowCoverage(byChannel: Map<string, ChannelModelInfo[]>): void {
    const parts: string[] = []
    for (const [id, models] of byChannel) {
      if (models.length === 0) continue
      const known = models.filter(model => model.contextWindow !== undefined).length
      parts.push(`${id} ${known}/${models.length}`)
    }
    if (parts.length === 0) return
    try {
      storeManager.addLog('info', `模型窗口覆盖（有窗口/总数）：${parts.join('，')}`)
    } catch (error) {
      console.warn(
        `[ChannelPack] 记录窗口覆盖率失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** `/v1/models` 视图，只为取 `context_window`；拉不到就空表（= 全部保持未知）。 */
  private async modelView(bridge: ChannelBridge): Promise<Array<Record<string, unknown>>> {
    try {
      return await bridge.models()
    } catch (error) {
      console.warn(
        `[ChannelPack] 读取 /v1/models 视图失败，模型窗口将保持未知：${error instanceof Error ? error.message : String(error)}`,
      )
      return []
    }
  }

  /** 缓存里某渠道的目录；缓存为空时是 `[]`（不触发远端请求）。 */
  private cachedModels(id: string): ChannelModelInfo[] {
    return this.modelsCache?.byChannel.get(id) ?? []
  }

  /**
   * 丢弃缓存并重跑一轮同步（写入 provider 记录与全局 modelMappings）。
   *
   * 必须清**整个**缓存：只清一家会让 `syncProviders` 把其余渠道读成「无模型」，
   * 从而把它们的 provider 记录关掉。
   */
  private async resync(): Promise<void> {
    this.modelsCache = null
    await this.syncProviders()
  }

  /** One channel's catalogue; failures (no account, remote down) collapse to `[]`. */
  private async fetchModels(
    bridge: ChannelBridge,
    id: string,
    view: ReadonlyArray<Record<string, unknown>>,
  ): Promise<ChannelModelInfo[]> {
    try {
      const result = await bridge.rpc('model.list', { provider: id })
      // 视图为空时 `attachContextWindows` 只是原样复制一份，不会把已有字段抹掉。
      return result.ok ? attachContextWindows(readModelList(result.value), view) : []
    } catch (error) {
      console.warn(
        `[ChannelPack] 读取 ${id} 的模型目录失败：${error instanceof Error ? error.message : String(error)}`,
      )
      return []
    }
  }

  private applyChannel(
    id: string,
    name: string,
    accountTotal: number,
    models: Array<[displayName: string, actualModel: string]>,
    legacyNames: Record<string, string>,
    capabilities: Record<string, ModelCapabilityHint>,
  ): void {
    const existing = storeManager.getProviderById(id)
    const usable = accountTotal > 0 && models.length > 0
    if (!usable) {
      // 账号为 0：这个渠道没连上，provider 记录不该存在；
      // 有账号但模型为空：保留记录但关闭它。否则空模型列表会让
      // 负载均衡把它当成「什么模型都支持」的通配供应商。
      if (existing !== undefined && accountTotal === 0) {
        this.dropProvider(id)
      } else if (existing !== undefined && existing.enabled) {
        storeManager.updateProvider(id, {
          supportedModels: [],
          modelMappings: {},
          modelCapabilities: {},
          // 这里也要带上 `loginKind`：登录方式与「上游目录是否拉得到模型」无关，
          // 目录故障时卡片仍应说清这个渠道是靠网页登录还是设备码，否则又会退回
          // 按 `authType` 显示成「API Key」。
          loginKind: getChannelDefinition(id)?.loginKind,
          enabled: false,
        })
        this.writeMappings(id, {})
      }
      return
    }

    // 改名前的目录快照：停用状态要跟着旧 id 迁到展示名上。
    const servedBefore = new Map(storeManager.getModelCatalogue(id).map(model => [model.displayName, model.served]))

    const supportedModels = models.map(([displayName]) => displayName)
    const modelMappings: Record<string, string> = Object.fromEntries(models)

    const now = Date.now()
    const definition = getChannelDefinition(id)
    const record: Provider = {
      id,
      name,
      type: 'account',
      // ⚠️ `authType` 的枚举里没有「浏览器/设备码登录」这一档，所以这里只能
      // 填最接近的 `token`。**真正要显示给用户的是 `loginKind`** —— 卡片上的
      // 「认证方式」若照 `authType` 渲染，一个靠网页登录拿账号的渠道会显示成
      // 「API Key」，而它根本没有 Key 这种东西。两者都写进记录：`authType`
      // 供只有该枚举的旧代码路径使用，`loginKind` 是展示的事实来源。
      authType: 'token',
      loginKind: definition?.loginKind,
      // 不发 HTTP：endpoint 只是记录完整性的一部分，请求一律走渠道 Worker。
      apiEndpoint: `channel://${id}`,
      headers: { 'Content-Type': 'application/json' },
      enabled: existing?.type === 'account' ? existing.enabled : true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      description: definition?.description,
      supportedModels,
      modelMappings,
      modelCapabilities: capabilities,
      credentialFields: [],
      supportsModelFetch: false,
    }
    if (existing !== undefined) {
      storeManager.updateProvider(id, record)
    } else {
      storeManager.addProvider(record)
    }
    this.ensureLocalAccount(id, name)
    this.writeMappings(id, modelMappings)
    this.migrateServedNames(id, legacyNames, servedBefore)
  }

  /**
   * 把旧版「内部 id」的停用标记迁到展示名上，并清掉旧键。
   *
   * 不做这一步，改名后 `excludedModels` 里的 `qodercn/qfmodel` 就不再匹配任何
   * 目录行，用户关掉的模型会悄悄重新对外广告；反方向也要清旧键，否则以后用
   * 展示名重新启用时旧键仍在。幂等：第二轮起旧键已被删掉。
   */
  private migrateServedNames(
    id: string,
    legacyNames: Record<string, string>,
    servedBefore: Map<string, boolean>,
  ): void {
    const renamed = Object.entries(legacyNames).filter(([legacy, displayName]) => legacy !== displayName)
    if (renamed.length === 0) return
    const stopped = renamed
      .filter(([legacy]) => servedBefore.get(legacy) === false)
      .map(([, displayName]) => displayName)
    if (stopped.length > 0) storeManager.setModelsServed(id, stopped, false)
    storeManager.setModelsServed(id, renamed.map(([legacy]) => legacy), true)
  }

  private ensureLocalAccount(providerId: string, providerName: string): void {
    const existing = AccountManager.getByProviderId(providerId, false)
    if (existing.length > 0) return
    // 凭据为空的本机占位账号：让路由与 `/v1/models` 认为该渠道可用；
    // 真正的账号选择在 Worker 内的渠道账号池里完成。
    AccountManager.create({
      providerId,
      name: `${providerName} (channel)`,
      credentials: {},
    })
  }

  private dropProvider(id: string): void {
    const provider = storeManager.getProviderById(id)
    if (provider === undefined || provider.type !== 'account') return
    storeManager.deleteProvider(id)
    this.writeMappings(id, {})
  }

  /** Mirrors `aggregate/manager.ts`: rewrites only this provider's global mappings. */
  private writeMappings(providerId: string, mappings: Record<string, string>): void {
    const config = storeManager.getConfig()
    const next: Record<string, ModelMapping> = {}
    for (const [requestModel, mapping] of Object.entries(config.modelMappings || {})) {
      if (mapping.preferredProviderId !== providerId) next[requestModel] = mapping
    }
    for (const [requestModel, actualModel] of Object.entries(mappings)) {
      next[requestModel] = { requestModel, actualModel, preferredProviderId: providerId }
    }
    storeManager.updateConfig({ modelMappings: next })
  }
}

export const accountChannelManager = new AccountChannelManager()
