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
import AccountManager from '../../store/accounts'
import { storeManager } from '../../store/store'
import type { Provider } from '../../store/types'
import { ChannelBridge, ChannelBridgeError } from '../../channelPack/bridge'
import type {
  ChannelAutoCheckinResult,
  ChannelCredits,
  ChannelIdentitySnapshot,
  ChannelModelInfo,
  ChannelModelSource,
  ChannelModelsResult,
  ChannelModelUpdateResult,
  ChannelOperationResult,
  ChannelRefreshResult,
  ChannelRpcResult,
  ChannelView,
} from '../../../shared/channels'
import { CHANNEL_DISPLAY_RENAMES, renameDisplayNameRefs, renamedDisplayName } from '../../../shared/channelRename'
import { channelModelDisplayName } from '../../../shared/channels'
import type { ModelCapabilityHint } from '../../../shared/types'
import { ACCOUNT_CHANNELS, getChannelDefinition } from './catalogue'
import { accountRuntime } from '../../proxy/accountRuntime'
import { attachContextWindows, capabilityHintOf, qualifyChannelModel, readModelList, readModelListSource } from './modelCatalog'
import { channelRuntimeState } from './runtimeState'
import { resyncsAfterChannelRpc } from './rpcSync'
import { SingleFlight } from './singleFlight'
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
  /** Set by the pack when upstream said it will not serve this account. */
  serviceStopped?: { at: number; text: string }
}

const MODELS_CACHE_MS = 30_000
/** 服务清单预检的成功/失败 TTL：与限流预检同一档（成功 30s 对齐目录缓存，失败 5s 防打爆）。 */
const PACK_SERVED_CACHE_MS = 30_000
const PACK_SERVED_FAILURE_CACHE_MS = 5_000
/**
 * 过期清单的**继续可用**宽限期。
 *
 * 预检跑在选路热路径上，而一次 `bridge.models()` 的 RPC 上限是 120s —— 在请求
 * 路径上等目录读取等于把「一次本地必败」换成「一笔可能卡两分钟的请求」。所以
 * 过期只触发**后台**刷新，宽限期内的旧清单照用；超过宽限期就按未知处理
 * （= 不剔除），仍然不许同步等。
 */
const PACK_SERVED_STALE_GRACE_MS = 10 * 60_000

interface ModelsCache {
  at: number
  byChannel: Map<string, ChannelModelInfo[]>
  /** 每渠道目录的来源；只在 pack 明确上报时写入。 */
  sourceByChannel: Map<string, ChannelModelSource>
}

/**
 * 某渠道**渠道 pack 自己愿意服务**的模型全集（完整 `<channel>/<model>` id）。
 *
 * `null` = 未知（运行时没在跑、`bridge.models()` 抛错、这一家整组缺席），
 * 与「一个都不服务」是两件事 —— 前者必须放行，否则一次目录故障就把整池打死。
 */
interface PackServedCache {
  ids: ReadonlySet<string> | null
  expiresAt: number
}

class AccountChannelManager {
  private bridge: ChannelBridge | null = null
  private vault: ChannelCredentialVault | null = null
  private initializing: Promise<void> | null = null
  private syncing: Promise<void> | null = null
  private modelsCache: ModelsCache | null = null
  /** 目录扫描单飞：并发调用共享在途那一轮（见 {@link SingleFlight}）。 */
  private modelsSweep = new SingleFlight<Map<string, ChannelModelInfo[]>>()
  private packServedCache = new Map<string, PackServedCache>()
  /** 后台刷新的单飞标记：同一轮只跑一份，逐请求只查表（见 `refreshPackServedInBackground`）。 */
  private packServedRefreshing: Promise<void> | null = null
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
        onLog: (level, message, context) => {
          // Worker logs used to be console-only, invisible in a packaged GUI.
          // Persist them with the request/provider correlation when available.
          const logLevel = level === 'error' ? 'error' : level === 'warn' ? 'warn' : level === 'debug' ? 'debug' : 'info'
          try {
            storeManager.addLog(logLevel, message, {
              ...(context?.providerId === undefined ? {} : { providerId: context.providerId }),
              ...(context?.requestId === undefined ? {} : { requestId: context.requestId }),
              ...(context?.model === undefined ? {} : { model: context.model }),
              data: {
                source: 'channel-pack',
                ...(context?.jobId === undefined ? {} : { jobId: context.jobId }),
                ...(context?.activeJobs === undefined ? {} : { activeJobs: context.activeJobs }),
              },
            })
          } catch (error) {
            console.error('[ChannelPack] failed to persist worker log:', error)
          }
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
    // 13 家并发，不是串行：单次 `account.list` 实测 0.1–0.5s，串起来就是首屏
    // 1.7–5.9s（2026-11-09 429 风暴里最慢的那一格）。worker 的 RPC 各自 await，
    // 并发不会互相挡；返回顺序仍按 `ACCOUNT_CHANNELS`。
    const [status, listed] = await Promise.all([
      this.packStatus(bridge),
      Promise.all(ACCOUNT_CHANNELS.map(channel => bridge.rpc('account.list', { provider: channel.id }))),
    ])
    const views: ChannelView[] = []
    for (const [index, channel] of ACCOUNT_CHANNELS.entries()) {
      const provider = storeManager.getProviderById(channel.id)
      let accounts: PackAccount[] = []
      const result = listed[index]
      if (result?.ok === true) {
        const value = result.value as { accounts?: PackAccount[] } | undefined
        accounts = Array.isArray(value?.accounts) ? value.accounts : []
      }
      const packStatus = status[channel.id]
      views.push({
        id: channel.id,
        name: channel.name,
        vendor: channel.vendor,
        loginKind: channel.loginKind,
        credentialAdd: channel.credentialAdd,
        dailyCheckin: channel.dailyCheckin,
        growthTasks: channel.growthTasks,
        description: channel.description,
        upstreamIdentity: channel.upstreamIdentity,
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
            serviceStopped: typeof account.serviceStopped?.text === 'string'
              ? {
                  at: typeof account.serviceStopped.at === 'number' ? account.serviceStopped.at : 0,
                  text: account.serviceStopped.text,
                }
              : undefined,
          })),
        },
        models: {
          total: packStatus?.models?.total ?? 0,
          disabled: packStatus?.models?.disabled ?? 0,
          // 只读已知缓存，不在这里触发目录拉取（`list()` 是首屏路径）。
          ...(() => {
            const source = this.modelsCache?.sourceByChannel.get(channel.id)
            return source === undefined ? {} : { source }
          })(),
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
      | {
        accounts?: Array<{
          accountId?: string
          nickname?: string
          enabled?: boolean
          balance?: { total?: number } | null
          status?: unknown
          note?: unknown
          lastAt?: unknown
          error?: string
        }>
        status?: unknown
        note?: unknown
      }
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
      const status: 'limited' | 'available' | 'unknown' | undefined =
        row.status === 'limited' || row.status === 'available' || row.status === 'unknown'
          ? row.status
          : undefined
      return {
        accountId: String(row.accountId ?? ''),
        nickname: String(row.nickname ?? row.accountId ?? ''),
        // 逐账号读数要一路带到界面：只有渠道总额时，一个号查询失败就表现为
        // 「总额凭空少了一截」，用户无法知道少了谁、为什么少（2026-11-01）。
        enabled: row.enabled !== false,
        remaining,
        ...status !== undefined ? { status } : {},
        ...typeof row.note === 'string' && row.note.length > 0 ? { note: row.note } : {},
        ...typeof row.lastAt === 'number' && Number.isFinite(row.lastAt) ? { lastAt: row.lastAt } : {},
        error: typeof row.error === 'string' ? row.error : undefined,
      }
    })
    const status: 'limited' | 'available' | 'unknown' | undefined =
      value?.status === 'limited' || value?.status === 'available' || value?.status === 'unknown'
        ? value.status
        : undefined
    return {
      reported,
      accounts,
      ...reported > 0 ? { remaining: Math.round(total * 100) / 100 } : {},
      ...status !== undefined ? { status } : {},
      ...typeof value?.note === 'string' && value.note.length > 0 ? { note: value.note } : {},
    }
  }

  /**
   * 一次问完多家渠道的积分。
   *
   * Channels 页一次刷新原本逐渠道发 13 个 `channels:credits`，远程 UI 上就是 13
   * 笔管理面请求（2026-11-09 429 风暴的放大器之一）。批量入口在**宿主内**并发问
   * worker，对管理面只占一次预算；单家失败已在 `credits()` 里收敛成 `error` 字段，
   * 这里只兜住「整个 bridge 没了」那一层，保证不把一家的异常升级成整页失败。
   */
  async creditsAll(ids: string[]): Promise<Record<string, ChannelCredits>> {
    const wanted = [...new Set(ids)]
      .filter((id): id is string => typeof id === 'string' && getChannelDefinition(id) !== undefined)
    const results = await Promise.all(wanted.map(async id => {
      try {
        return [id, await this.credits(id)] as const
      } catch (error) {
        const entry: ChannelCredits = {
          reported: 0,
          accounts: [],
          error: error instanceof Error ? error.message : '积分查询失败',
        }
        return [id, entry] as const
      }
    }))
    return Object.fromEntries(results)
  }

  /**
   * 渠道客户端身份快照（B4）：各动态渠道「下一笔请求实际会发」的版本号、来源
   * 与核对时间。读不到 worker 时返回空表而不抛错 —— 身份展示是诊断信息，
   * 它的失败不该把渠道页搞挂（与 `accountCounts()` 同一方向）。
   */
  async identitySnapshot(): Promise<ChannelIdentitySnapshot> {
    try {
      const bridge = await this.bridgeOrThrow()
      const result = await bridge.rpc('identity.snapshot', {})
      if (!result.ok) {
        return { entries: [], error: result.error?.message ?? 'identity.snapshot 调用失败' }
      }
      const value = result.value as { entries?: unknown } | undefined
      const entries = Array.isArray(value?.entries) ? value.entries : []
      return {
        entries: entries.filter((entry): entry is ChannelIdentitySnapshot['entries'][number] =>
          typeof entry === 'object' && entry !== null
          && typeof (entry as { channel?: unknown }).channel === 'string'
          && typeof (entry as { version?: unknown }).version === 'string'),
      }
    } catch (error) {
      return { entries: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 强制重拉官方版本源并返回刷新后的身份快照（B5 配套）。
   *
   * 供管理接口手动触发；风控自动触发的接线（`channel_risk_control` → 这里）
   * 仍在计划 B5 的待办里，需要先确认「连续 N 次风控自动暂停渠道」的产品决策。
   */
  async identityRefresh(): Promise<ChannelIdentitySnapshot> {
    try {
      const bridge = await this.bridgeOrThrow()
      const result = await bridge.rpc('identity.refresh', {})
      if (!result.ok) {
        return { entries: [], error: result.error?.message ?? 'identity.refresh 调用失败' }
      }
      const value = result.value as { entries?: unknown } | undefined
      const entries = Array.isArray(value?.entries) ? value.entries : []
      return {
        entries: entries.filter((entry): entry is ChannelIdentitySnapshot['entries'][number] =>
          typeof entry === 'object' && entry !== null
          && typeof (entry as { channel?: unknown }).channel === 'string'
          && typeof (entry as { version?: unknown }).version === 'string'),
      }
    } catch (error) {
      return { entries: [], error: error instanceof Error ? error.message : String(error) }
    }
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
   * 查询某渠道一批模型**是否根本不在渠道 pack 的服务清单里**（auto 选路预检）。
   *
   * ## 背景（真实流量 2026-11-01 → 11-04：137 行 `模型不存在或已停用`）
   *
   * 宿主的可路由名单来自 `model.list`，而它优先取适配器的 `listAllModels()`——
   * **静态兜底表，不套身份档、也不随远端目录消失的条目收缩**；渠道 worker 的
   * 请求前校验（`channelPack/worker.ts`）读的却是**分档后**的 `listModels(provider)`。
   * 两个集合一分歧，用户点名或 auto 选中的条目就会在**发出任何上游请求之前**
   * 被自己的进程 404 掉，换下一候选大概率同样 404，一次对话反复撞。
   *
   * 本方法把那道闸门提前到选路阶段：返回的表里出现的模型 id = pack 明确不服务，
   * 调用方据此剔候选（`failover.ts` 那句精确文案识别保留，兜住预检之后的竞态）。
   *
   * ## 口径与缓存
   *
   * 数据源必须是 `bridge.models()`（worker 的 `models()` → 逐 provider
   * `ctx.llm.listModels`），**与那道闸门同一个源**；`model.list` 在这里无效，
   * 它就是分歧的另一侧。整轮视图一次读全 12 家，缓存在 `packServedCache`，与目录
   * 缓存同源同生命周期（{@link models} 每轮回填，`invalidateModelsCache` 一起作废），
   * 所以一次 select 里同一家几个候选也只读一份清单，不逐条重复解 store。
   *
   * ⚠️ **过期只后台刷**（`refreshPackServedInBackground`）：这道 RPC 的上限是 120s，
   * 在选择路径上等它等于把「一次本地必败」换成「一笔可能卡两分钟的请求」。宽限期内
   * 用旧清单，超出宽限期按未知处理（= 不剔除）。
   *
   * ⚠️ **一律 fail-open**：运行时没在跑（状态检查不许顺手拉起 Worker，与 opencode
   * 同一条规则）、视图拉不到、或这一家在视图里**一条都没有**（可能是整家未登录，
   * 也可能是适配器这轮读目录抛错，两者在返回值上不可区分）→ 返回空表 = 什么都不剔。
   * 预检只能减少「本地必败」，不能新增「目录故障时把整池打死」。
   */
  async packUnservedModels(id: string, modelIds: string[]): Promise<Record<string, { unserved: true }>> {
    if (getChannelDefinition(id) === undefined || modelIds.length === 0) return {}
    const served = await this.packServedIds(id)
    if (served === null || served.size === 0) return {}
    const unserved: Record<string, { unserved: true }> = {}
    for (const modelId of new Set(modelIds)) {
      // 目录里可能留着**裸 id** 的旧行（见 `qualifyChannelModel`），而视图的键永远是
      // 完整的 `<channel>/<model>`，所以两边都用补全后的形状比，别拿裸 id 去查。
      if (!served.has(qualifyChannelModel(id, modelId))) {
        unserved[modelId] = { unserved: true }
      }
    }
    return unserved
  }

  /**
   * 某渠道 pack 侧服务清单的模型 id 全集（完整形状）；`null` = 未知。
   *
   * 走 {@link models} 的 30s 目录缓存顺带回填的 `packServedCache`：一次读目录把
   * 全 12 家一起填满，不在候选循环里逐家重拉。
   */
  private async packServedIds(id: string): Promise<ReadonlySet<string> | null> {
    if (!this.isRuntimeRunning()) {
      // 运行时不在 = 清单**未知**，旧缓存在这里一起作废：把「pack 掉了」读成
      // 「这些模型它不服务」，等于让一次状态故障制造整池 503。
      // 状态检查也不许顺手拉起 Worker（与 opencode 同一条规则）。
      this.packServedCache.clear()
      return null
    }
    const now = Date.now()
    const entry = this.packServedCache.get(id)
    if (entry !== undefined && now < entry.expiresAt) return entry.ids
    // 过期或缺席：只触发后台刷新，**绝不**在选路热路径上等一次目录读
    // （`bridge.models()` 走 RPC_TIMEOUT_MS = 120s）。
    this.refreshPackServedInBackground()
    if (entry !== undefined && now < entry.expiresAt + PACK_SERVED_STALE_GRACE_MS) {
      return entry.ids
    }
    return null
  }

  /**
   * 后台刷新全 12 家的服务清单（同一轮只跑一份，逐请求只是查表）。
   *
   * 只读 `bridge.models()` 这一份视图，不重跑 `model.list` 那 12 次 RPC：预检要的
   * 就是 `listModels` 的分档口径，倍率与 `disabled` 标记对它无用。
   * 失败保持旧条目（下次宽限期外自然降级成「未知 → 不剔除」），并给缺席的家记
   * 一条 5s 的「未知」，免得每个请求都重开一轮。
   */
  private refreshPackServedInBackground(): void {
    if (this.packServedRefreshing !== null) return
    if (!this.isRuntimeRunning()) return
    const task = (async () => {
      try {
        const bridge = await this.bridgeOrThrow()
        const view = await this.modelView(bridge)
        if (view !== null) {
          this.seedPackServedCache(view, Date.now())
          return
        }
      } catch (error) {
        console.warn(
          `[ChannelPack] 后台刷新服务清单失败，保留旧条目：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      // 读不到：完全没有条目的家记一条 5s 的「未知」，免得每个请求都重开一轮刷新；
      // 已有条目的家**不动**（宽限期内的旧清单仍按上面的判据继续用）。
      const unknownUntil = Date.now() + PACK_SERVED_FAILURE_CACHE_MS
      for (const channel of ACCOUNT_CHANNELS) {
        if (this.packServedCache.has(channel.id)) continue
        this.packServedCache.set(channel.id, { ids: null, expiresAt: unknownUntil })
      }
    })().finally(() => {
      this.packServedRefreshing = null
    })
    this.packServedRefreshing = task
  }

  /**
   * 用 `bridge.models()` 的视图回填每家的服务清单缓存。
   *
   * 视图条目形状是 `{ id: '<provider>/<model>', … }`（`toOpenAiModelIds` 拼的），
   * 与 worker 那道闸门比的 `entry.id` 同源，所以这里**只做切分不做推断**：
   * 按第一个 `/` 取 provider，整条 id 作为键。
   */
  private seedPackServedCache(
    view: ReadonlyArray<Record<string, unknown>>,
    fetchedAt: number,
  ): void {
    const grouped = new Map<string, Set<string>>()
    for (const entry of view) {
      if (entry === null || typeof entry !== 'object') continue
      const modelId = typeof entry.id === 'string' ? entry.id.trim() : ''
      if (modelId.length === 0) continue
      const slash = modelId.indexOf('/')
      if (slash <= 0) continue
      const provider = modelId.slice(0, slash)
      let bucket = grouped.get(provider)
      if (bucket === undefined) {
        bucket = new Set<string>()
        grouped.set(provider, bucket)
      }
      bucket.add(modelId)
    }
    const expiresAt = fetchedAt + PACK_SERVED_CACHE_MS
    for (const channel of ACCOUNT_CHANNELS) {
      // 这一家在视图里一条都没有 → 记下「未知」而不是空集合：`collectGatewayModels`
      // 会跳过 listModels 抛错的那一家，空与缺席在视图里不可区分。
      const ids = grouped.get(channel.id) ?? null
      this.packServedCache.set(channel.id, { ids, expiresAt })
    }
  }

  /** 目录缓存与服务清单缓存同源同生命周期：清一个必须清另一个。 */
  private invalidateModelsCache(): void {
    this.modelsCache = null
    this.packServedCache.clear()
    // 在途那一轮的结果已经过时：代次 +1，后来者另起一轮，旧轮次不回写缓存。
    this.modelsSweep.invalidate()
  }

  /**
   * Reads the global "claim every account's daily credits automatically" switch.
   *
   * The switch is one for all channels: when on, the pack claims once per
   * channel for every account and records completion **per channel** for the
   * current UTC+8 day. Channels that failed or that are not refreshed yet
   * (Qoder before 10:00) stay pending and are retried every 30 minutes; a
   * channel that already finished is not requested again that day. It is off
   * by default; the pack schedules the first round 30s after it starts only
   * when the user has explicitly enabled it.
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
        // 渠道包默认关闭，且只认「用户亲手打开」（文档里的 `decidedBy: 'user'`）。
        // 缺字段或非 true 一律按关处理，不能沿用旧版「只有显式 false 才算关闭」。
        enabled: raw.enabled === true,
        lastDate: typeof raw.lastDate === 'string' ? raw.lastDate : '',
        ranToday: raw.ranToday === true,
        running: raw.running === true,
        lastResult: typeof raw.lastResult === 'string' ? raw.lastResult : '',
        lastAt: typeof raw.lastAt === 'number' ? raw.lastAt : 0,
        pending: typeof raw.pending === 'number' ? raw.pending : 0,
        pendingProviders: Array.isArray(raw.pendingProviders)
          ? raw.pendingProviders.filter((id): id is string => typeof id === 'string')
          : [],
        nextRetryAt: typeof raw.nextRetryAt === 'number' ? raw.nextRetryAt : 0,
        channels: Array.isArray(raw.channels)
          ? raw.channels
              .filter((entry): entry is { provider: string; text: string } => (
                typeof entry === 'object'
                && entry !== null
                && typeof (entry as { provider?: unknown }).provider === 'string'
                && typeof (entry as { text?: unknown }).text === 'string'
              ))
              .map((entry) => ({ provider: entry.provider, text: entry.text }))
          : [],
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
    const source = this.modelsCache?.sourceByChannel.get(id)
    return {
      success: true,
      models: byChannel.get(id) ?? [],
      ...source === undefined ? {} : { source },
    }
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
    const source = this.modelsCache?.sourceByChannel.get(id)
    if (count === 0) {
      // 没账号、远端目录拉取失败或返回空：保留旧记录，只报告空结果。
      return { success: false, count: 0, reason: 'empty' }
    }
    return {
      success: true,
      count,
      ...source === undefined ? {} : { source },
    }
  }

  /**
   * 周期预热入口（供 `Scheduler` 调用）。
   *
   * 与 `refreshModels` 的本质区别：后者走 `resync()`（清整个缓存 → `syncProviders`
   * 写 provider 记录 + 广播），那是"用户在界面里点了刷新、
   * 期望状态立即生效"的语义。定时预热不想要这套副作用：
   *
   * - **不写持久化**：定时跑出来的目录不该覆盖用户手动的停用/恢复决策；
   * - **不广播**：后台预热不该让界面每 4 小时闪一次；
   * - 只刷新内存里的 `modelsCache`（下一次 `modelsFor` 读到的就是新的）。
   *
   * 失败 fail-soft：`bridge` 起不来或渠道包无应答时保持旧缓存，记 warning 即可
   * （继承 `fetchModels`「拉不到就空表」但也别清掉已有内存副本的纪律——这里直接
   * 保留旧 `modelsCache`，比 `fetchModels` 更保守：后台任务失败绝不能把可用的
   * 内存目录变成空）。
   */
  async warmModels(): Promise<void> {
    try {
      const bridge = await this.bridgeOrThrow()
      // 只清缓存、重读内存副本，不触碰 `syncProviders` / 磁盘 / 广播。
      this.invalidateModelsCache()
      await this.models(bridge)
    } catch (error) {
      console.warn(
        `[ChannelPack] 定时预热模型目录失败，保留旧缓存：${error instanceof Error ? error.message : String(error)}`,
      )
    }
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
   * `account.create` returns the channel's login URL to the caller; **the
   * renderer opens it**. A headless daemon has no browser (`getHost().openExternal`
   * only logs the URL), so opening it here would leave the UI waiting forever.
   */
  async rpc(method: string, payload: unknown): Promise<ChannelRpcResult> {
    const bridge = await this.bridgeOrThrow()
    const result = await bridge.rpc(method, payload)
    // 渠道包没有为所有改动账号池的方法广播 `changed`（opencode 的两个加账号方法就不发），
    // 这里补一次镜像：否则账号进了池子、provider 记录却没出现，卡永远停在「未配置」。
    if (result.ok && resyncsAfterChannelRpc(method)) this.notifyChanged()
    return result
  }

  /** 账号池或模型目录可能变了：清缓存、重建 provider 记录、通知界面。 */
  private notifyChanged(): void {
    this.invalidateModelsCache()
    // 池子一变就解除凭据类冷却（`accountRuntime.recordCredentialFailure` 那条
    // 5–30 分钟的档）。那条冷却的前提是「要人来处理」，而 `changed` / 登录 /
    // `account.refresh` 正是人已经处理完的信号 —— 不解就变成「重新登录成功了，
    // 卡还要再锁半小时」。清档走 `recordSuccess`，与 autoRouter 的
    // `clearAccountCooldown` 同一实现；这里直接用它，是为了不把 autoRouter 拖进
    // 管理器与请求路径的导入图。
    // 这里**故意不带 model**：不带模型 = 连该账号所有 (账号, 模型) 限流档一起清，
    // 因为换凭据/换池子等于上游的限流窗口重新开过。
    for (const channel of ACCOUNT_CHANNELS) {
      for (const account of AccountManager.getByProviderId(channel.id, false)) {
        accountRuntime.recordSuccess(account.id)
      }
    }
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
    this.invalidateModelsCache()
    this.onChanged?.()
    return { success: true }
  }

  /* ------------------------------------------------------------ 请求路径 */

  async complete(request: {
    requestId: string
    model: string
    openAi: Record<string, unknown>
  }, timeoutMs?: number): Promise<Record<string, unknown>> {
    const bridge = await this.bridgeOrThrow()
    return bridge.complete({ ...request, stream: false }, timeoutMs)
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
            const displayName = channelModelDisplayName(channel.name, channel.id, model)
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
   * 少一格"，而是功能性的：`auto` 路由把未公布的窗口按 `UNANNOTATED_CONTEXT_FLOOR`
   * （64K）算，于是任何超过 64K 的请求会把**全部十二个渠道**判成装不下而排除（现在这条已改掉：未公布不参与广告也不淘汰，见 `autoRouting.ts::hardFilterFailure`）——
   * 而实测这些渠道正在服务 300K–500K+（TRAE 单请求 503,128 prompt、0 错误）。
   * 视图整轮只拉一次，12 个渠道共用，避免把同步变成 12 次往返。
   */
  private async models(bridge: ChannelBridge): Promise<Map<string, ChannelModelInfo[]>> {
    if (this.modelsCache !== null && Date.now() - this.modelsCache.at < MODELS_CACHE_MS) {
      return this.modelsCache.byChannel
    }
    // 单飞：缓存只在整轮扫完才回填，并发调用若各跑一轮，就是 5 路同时读全量目录。
    return this.modelsSweep.run(async (version) => {
      const view = await this.modelView(bridge)
      const byChannel = new Map<string, ChannelModelInfo[]>()
      const sourceByChannel = new Map<string, ChannelModelSource>()
      await Promise.all(ACCOUNT_CHANNELS.map(async channel => {
        const fetched = await this.fetchModels(bridge, channel.id, view ?? [])
        byChannel.set(channel.id, fetched.models)
        if (fetched.source !== undefined) sourceByChannel.set(channel.id, fetched.source)
      }))
      // 途中被作废（账号池/目录刚变）：这一轮只把结果交给等它的调用方，
      // 不回写缓存、也不再打一行诊断 —— 否则旧轮次会覆盖新一轮的扫描结果。
      if (version === this.modelsSweep.version) {
        const at = Date.now()
        this.modelsCache = { at, byChannel, sourceByChannel }
        // 同一次视图读取顺手填服务清单缓存：视图拿不到（`modelView` 返回 null）就**不填**，
        // 让 `packServedIds` 落到「未知 → 不剔除」，而不是把一次目录故障读成「整家没模型」。
        if (view !== null) this.seedPackServedCache(view, at)
        // 一行可 grep 的诊断：哪些渠道真的报了上下文窗口、哪些没有。
        // 用 `storeManager.addLog` 而不是 `console.log` —— 只有前者会落进
        // `<dataDir>/logs/app-logs.ndjson`，而"窗口有没有下发"这件事恰恰只能从
        // 那里事后核对（`/v1/models` 需要 API key，排查时不一定拿得到）。
        this.logWindowCoverage(byChannel)
      }
      return byChannel
    })
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

  /**
   * `/v1/models` 视图：既为 `model.list` 补 `context_window`，也是**服务清单预检**的
   * 数据源（它逐 provider 调 `ctx.llm.listModels`，与 `channelPack/worker.ts` 那道
   * 请求前闸门同源）。
   *
   * ⚠️ 拉不到时返回 `null` 而不是 `[]`：窗口那一侧 `[]` 与真目录 `[]` 等价（都保持
   * 未知），但预检那一侧 `[]` 会被读成「这一家什么都不服务」，把一次目录故障变成
   * 整池 503 —— 两种处境必须能分开。
   */
  private async modelView(bridge: ChannelBridge): Promise<Array<Record<string, unknown>> | null> {
    try {
      return await bridge.models()
    } catch (error) {
      console.warn(
        `[ChannelPack] 读取 /v1/models 视图失败，模型窗口将保持未知：${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }

  /** 缓存里某渠道的目录；缓存为空时是 `[]`（不触发远端请求）。 */
  private cachedModels(id: string): ChannelModelInfo[] {
    return this.modelsCache?.byChannel.get(id) ?? []
  }

  /**
   * 丢弃缓存并重跑一轮同步（写入 provider 记录及其模型账本）。
   *
   * 必须清**整个**缓存：只清一家会让 `syncProviders` 把其余渠道读成「无模型」，
   * 从而把它们的 provider 记录关掉。
   */
  private async resync(): Promise<void> {
    this.invalidateModelsCache()
    await this.syncProviders()
  }

  /** One channel's catalogue; failures (no account, remote down) collapse to `[]`. */
  private async fetchModels(
    bridge: ChannelBridge,
    id: string,
    view: ReadonlyArray<Record<string, unknown>>,
  ): Promise<{ models: ChannelModelInfo[]; source?: ChannelModelSource }> {
    try {
      const result = await bridge.rpc('model.list', { provider: id })
      if (!result.ok) return { models: [] }
      return {
        // 视图为空时 `attachContextWindows` 只是原样复制一份，不会把已有字段抹掉。
        models: attachContextWindows(readModelList(result.value), view),
        source: readModelListSource(result.value),
      }
    } catch (error) {
      console.warn(
        `[ChannelPack] 读取 ${id} 的模型目录失败：${error instanceof Error ? error.message : String(error)}`,
      )
      return { models: [] }
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
    // 展示名 → `<channel>/<内部 id>` 的接线在供应商记录的账本里（上面那份 record），
    // 不再写全局别名表：那是用户自己的表，同步整表重写会抹掉同类名的用户钉定。
    this.migrateServedNames(id, legacyNames, servedBefore)
    this.migrateRenamedDisplayNames(id, name, servedBefore)
  }

  /**
   * Carry user configuration across a channel **display-name** rename.
   *
   * A rename changes every model name (`<channel> / <model>`), and three pieces
   * of configuration are keyed by that name: the served flag (user switched the
   * model off), and a route's `pinModels` / `includeModels` / `excludeModels`.
   * Without this, a rename silently un-excludes models and leaves pinned routes
   * pointing at names that no longer exist.
   *
   * Idempotent: the old prefix is gone after the first pass, so a later sync
   * finds nothing to rewrite. Providers are updated before this runs, so the
   * new names already resolve when a route is revalidated.
   */
  private migrateRenamedDisplayNames(
    providerId: string,
    currentName: string,
    servedBefore: Map<string, boolean>,
  ): void {
    const rename = CHANNEL_DISPLAY_RENAMES.find(entry => entry.id === providerId)
    if (rename === undefined || rename.from === currentName) return

    for (const [oldName, served] of servedBefore) {
      const renamed = renamedDisplayName(oldName, rename.from, currentName)
      if (renamed === undefined) continue
      if (served === false) storeManager.setModelsServed(providerId, [renamed], false)
      // Clear the old key, same direction as `migrateServedNames`: leaving it
      // behind would re-apply a stale "off" if the name ever came back.
      storeManager.setModelsServed(providerId, [oldName], true)
    }

    for (const route of Object.values(storeManager.getModelRoutes())) {
      const pinModels = renameDisplayNameRefs(route.pinModels, rename.from, currentName)
      const includeModels = renameDisplayNameRefs(route.includeModels, rename.from, currentName)
      const excludeModels = renameDisplayNameRefs(route.excludeModels, rename.from, currentName)
      if (pinModels === undefined && includeModels === undefined && excludeModels === undefined) continue
      const result = storeManager.updateRoute(route.name, {
        ...(pinModels === undefined ? {} : { pinModels }),
        ...(includeModels === undefined ? {} : { includeModels }),
        ...(excludeModels === undefined ? {} : { excludeModels }),
      })
      if (!result.ok) {
        console.warn(`[ChannelPack] 路由 ${route.name} 的模型引用未能跟随渠道改名：${result.error}`)
      }
    }
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
    // 全局映射表里钉到这条渠道的行由 `normalizeModelMappingsWithDefaults` 按
    // 「owner 已不存在」摘掉；同步不再碰用户的别名表，这里也无需整表重写。
  }
}

export const accountChannelManager = new AccountChannelManager()
