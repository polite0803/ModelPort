import type { RendererSink } from './logBroadcast'
import { registerMainHandler } from './registry'
import { getHost, requireDesktop, requireSystem } from '../runtime/host'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import axios from 'axios'
import { IpcChannels } from './channels'
import { registerBackupHandlers } from '../backup/ipc.ts'
import { storeManager } from '../store/store'
import { applyAnthropicRoutes, planAnthropicRoutes } from '../store/anthropicRoutes'
import type {
  AnthropicDiscoveryResult,
  AnthropicRouteApplyResult,
} from '../../shared/anthropicDiscovery'
import { ProviderManager } from '../store/providers'
import { AccountManager } from '../store/accounts'
import { ProviderChecker, checkAllProviderStatuses } from '../providers/checker'
import { CustomProviderManager } from '../providers/custom'
import { aggregateProviderManager } from '../providers/aggregate'
import { accountChannelManager } from '../providers/accountChannels/manager'
import type { AggregateSaveInput } from '../../shared/aggregate'
import { getBuiltinProviders, getBuiltinProvider } from '../providers/builtin'
import { oauthManager } from '../oauth/manager'
import { fetchProviderModels } from '../providers/modelCatalog'
import { getModelMetadataReport, getResolvedModelMetadata } from '../providers/modelMetadataService'
import { runModelCapabilityProbe } from '../providers/modelProbeRunner'
import {
  adoptCatalogField,
  getCatalogCandidates,
  getCatalogStatuses,
  refreshCatalog,
  revokeCatalogAdoption,
} from '../providers/modelCatalogService'
import type { CatalogAdoptionField, CatalogSourceId } from '../../shared/modelCatalog.ts'
import {
  cancelCatalogBatch,
  estimateCatalogBatch,
  getCatalogBatchJobs,
  onCatalogBatchProgress,
  pauseCatalogBatch,
  resumeCatalogBatch,
  startCatalogBatch,
} from '../providers/modelCatalogBatchRunner'
import type { CatalogBatchSnapshot } from '../../shared/modelCatalogBatch'
import type { ProbeJobSnapshot, ProbeProgressEvent, ProbeScope } from '../../shared/modelProbe.ts'
import { PROBE_TOTAL_TIMEOUT_MS } from '../../shared/modelProbe.ts'
import { schedulerStatus, triggerModelListRefreshNow, configureModelListRefresh } from '../scheduler/modelListRefresh'
import { proxyServer } from '../proxy/server'
import {
  getTlsStatus,
  installCertificateTrust,
  loadTlsMaterial,
  tryReadTlsMaterial,
  uninstallCertificateTrust,
  type TlsMaterial,
} from '../proxy/tls'
import { autoRouter } from '../proxy/autoRouter'
import type { RoutePreviewResult, RoutePreviewSample } from '../proxy/autoRouter'
import { proxyStatusManager } from '../proxy/status'
import { ConfigManager } from '../store/config'
import { generateManagementSecret } from '../proxy/middleware/managementAuth'
import { buildRequestDiagnosticBundle } from '../logging/diagnosticBundle'
import type { Provider, Account, ProxyStatus, ProviderCheckResult, OAuthResult, AuthType, CredentialField, LogLevel, LogEntry, ProviderVendor, ModelRoute, ModelCapabilityHint } from '../../shared/types'
import type { RouteListResult, RouteMutationResult, RouteRemovalResult, RoutePoolSizesResult } from '../../shared/modelRouteName'
import type { ManagementApiConfig, AppConfig } from '../store/types'
import { DEFAULT_CONTEXT_MANAGEMENT_CONFIG } from '../store/types'
import type { TlsStatus, TlsTrustResult } from '../../shared/types'
import type { ProviderType } from '../oauth/types'
import type { ModelsFetchFailure } from '../store/types'

/**
 * 聚合同步的失败原因 → 供应商卡片那套 ModelsFetchFailure。
 * 只有两处需要映射：没有 Key 等价于"没有可用账号"，目录/记录缺失等价于"不支持"。
 */
function aggregateSyncFailureReason(reason?: string): ModelsFetchFailure {
  switch (reason) {
    case 'invalid_api_key':
    case 'http_status':
    case 'empty':
    case 'unrecognized_shape':
    case 'network_error':
      return reason
    case 'missing_api_key':
      return 'no_active_account'
    default:
      return 'unsupported'
  }
}

/**
 * `CONFIG_CHANGED` 的广播：`config:update` 与 `routes:*` 的写入路径共用同一份载荷
 * —— 归一后的完整 `AppConfig`（一定带 `routes` 键；`store:set('config')` 发的是
 * 同形的那份，见那条分支）。
 * UI 收到就把整份配置（含路由表）换掉，不需要重读、也不需要重启代理。
 */
function broadcastConfigChanged(config: AppConfig): void {
  getHost().push(IpcChannels.CONFIG_CHANGED, config)
}

/** 「全部补齐」进度：主进程编排，任何窗口（含重开的）都收到同一份快照。 */
function broadcastCatalogBatchProgress(snapshot: CatalogBatchSnapshot): void {
  getHost().push(IpcChannels.PROVIDERS_CATALOG_BATCH_PROGRESS, snapshot)
}

onCatalogBatchProgress(broadcastCatalogBatchProgress)

/**
 * 存储层没起来时的可读错误（`routes:*` 用）：`storeManager` 的 CRUD 会直接抛，
 * IPC 边界不许把裸异常扔给 renderer —— 那条协议错误在界面上显示成一句英文栈提示，
 * 用户看不出是「存储初始化失败」。
 */
function routeStorageError(error: unknown): { code: 'storage_unavailable'; message: string } {
  return {
    code: 'storage_unavailable',
    message: error instanceof Error ? error.message : 'Storage is not available',
  }
}

/**
 * 探测后台任务：让「关闭弹窗」不等于「取消请求」。
 *
 * - 进行中的任务保存在这里，`getProbeJobs` 可在重新打开弹窗时回显；
 * - 每个任务独立的整体超时（5 分钟）与取消入口；
 * - 最多保留最近 20 条（含已完成），避免内存随点击增长。
 *
 * 注意：进度事件走 `webContents.send` 单向推送，UI 不依赖 invoke 的返回值刷新。
 */
interface ProbeJobRecord {
  snapshot: ProbeJobSnapshot
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
}

const probeJobs = new Map<string, ProbeJobRecord>()
const MAX_PROBE_JOBS = 20

function broadcastProbeProgress(snapshot: ProbeJobSnapshot): void {
  getHost().push(IpcChannels.PROVIDERS_PROBE_PROGRESS, snapshot)
}

function trimProbeJobs(): void {
  if (probeJobs.size <= MAX_PROBE_JOBS) return
  const entries = [...probeJobs.entries()].sort((left, right) =>
    left[1].snapshot.startedAt.localeCompare(right[1].snapshot.startedAt),
  )
  // 先删已结束的最旧任务；若上限仍然超出（所有记录都在跑），按上限强制收敛最旧记录。
  // 收敛只移除“进度可查询性”，不 abort 真实请求 —— 结果是任务仍在后台跑完。
  for (const [id, record] of entries) {
    if (probeJobs.size <= MAX_PROBE_JOBS) break
    if (record.snapshot.status === 'running') continue
    probeJobs.delete(id)
  }
  for (const [id] of entries) {
    if (probeJobs.size <= MAX_PROBE_JOBS) break
    probeJobs.delete(id)
  }
}

export async function registerIpcHandlers(mainWindow: RendererSink | null): Promise<void> {
  let storageReady = true
  try {
    await storeManager.initialize()
    storageReady = !storeManager.hasInitializationError()
  } catch (error) {
    // 存储初始化失败也要继续注册全部 IPC：否则渲染层每个调用都会收到
    // "No handler registered" 协议错误，界面变成一片死错误，用户看不到真正的原因。
    storageReady = false
    console.error('[IPC] Failed to initialize storage:', error)

    getHost().push(IpcChannels.STORE_INIT_ERROR, {
      message: error instanceof Error ? error.message : 'Failed to initialize storage',
    })
  }

  storeManager.setMainWindow(mainWindow)


  // 备份的六条通道必须在**两个宿主**都注册：`apply` / `unlock` / `cancel` 是纯逻辑，
  // 无头宿主缺了它们，远程界面的导入就会走完上传再在「应用」这一步 404。
  // 真正需要窗口的是文件对话框与重启，它们由 `requireDesktop` 回答 `desktop-only`，
  // 而不是让整组通道在网络面上不存在。
  registerBackupHandlers()
  registerStoreRetryHandler(mainWindow)


  // Check if auto-start proxy is needed
  const config = storageReady ? storeManager.getConfig() : null
  if (config?.autoStartProxy) {
    console.log('[App] Auto-starting proxy service...')
    const proxyPort = config.proxyPort
    const proxyHost = config.proxyHost || '127.0.0.1'
    try {
      const success = await proxyServer.start(proxyPort, proxyHost)
      if (success) {
        console.log('[App] Proxy service auto-started successfully, port:', proxyPort)
        const status: ProxyStatus = {
          isRunning: true,
          port: proxyPort,
          host: proxyHost,
          uptime: 0,
          connections: 0,
        }
        getHost().push(IpcChannels.PROXY_STATUS_CHANGED, status)
      } else {
        console.log('[App] Proxy service auto-start failed')
      }
    } catch (error) {
      console.error('[App] Proxy service auto-start failed:', error)
    }
  }

  registerMainHandler(IpcChannels.PROXY_START, async (_, port?: number): Promise<boolean> => {
    try {
      if (proxyServer.isRunning()) {
        console.log('Proxy server is already running')
        return true
      }

      const config = storeManager.getConfig()
      const proxyPort = port || config.proxyPort
      const proxyHost = config.proxyHost || '127.0.0.1'

      const success = await proxyServer.start(proxyPort, proxyHost)
      
      if (success) {
        const status: ProxyStatus = {
          isRunning: true,
          port: proxyPort,
          host: proxyHost,
          uptime: 0,
          connections: 0,
        }
        getHost().push(IpcChannels.PROXY_STATUS_CHANGED, status)
        getHost().desktop?.notifyProxyStatus(true)
      }
      
      return success
    } catch (error) {
      console.error('Failed to start proxy:', error)
      return false
    }
  })

  registerMainHandler(IpcChannels.PROXY_STOP, async (): Promise<boolean> => {
    try {
      if (!proxyServer.isRunning()) {
        return true
      }

      const success = await proxyServer.stop()
      
      if (success) {
        const status: ProxyStatus = {
          isRunning: false,
          port: proxyStatusManager.getPort(),
          host: storeManager.getConfig().proxyHost || proxyStatusManager.getHost(),
          uptime: proxyStatusManager.getRunningStatus().uptime,
          connections: 0,
        }
        getHost().push(IpcChannels.PROXY_STATUS_CHANGED, status)
        getHost().desktop?.notifyProxyStatus(false)
      }
      
      return success
    } catch (error) {
      console.error('Failed to stop proxy:', error)
      return false
    }
  })

  registerMainHandler(IpcChannels.PROXY_GET_STATUS, async (): Promise<ProxyStatus> => {
    const isRunning = proxyServer.isRunning()
    const port = proxyStatusManager.getPort()
    const host = isRunning
      ? proxyStatusManager.getHost()
      : storeManager.getConfig().proxyHost || proxyStatusManager.getHost()
    return {
      isRunning,
      port,
      host,
      uptime: proxyStatusManager.getRunningStatus().uptime,
      connections: proxyStatusManager.getStatistics().activeConnections,
    }
  })

  registerMainHandler(IpcChannels.PROXY_GET_STATISTICS, async () => {
    const stats = proxyStatusManager.getStatistics()
    return {
      totalRequests: stats.totalRequests,
      successRequests: stats.successRequests,
      failedRequests: stats.failedRequests,
      avgLatency: stats.avgLatency,
      requestsPerMinute: stats.requestsPerMinute,
      activeConnections: stats.activeConnections,
      modelUsage: stats.modelUsage,
      providerUsage: stats.providerUsage,
      accountUsage: stats.accountUsage,
    }
  })

  registerMainHandler(IpcChannels.PROXY_RESET_STATISTICS, async (): Promise<void> => {
    proxyStatusManager.resetStatistics()
  })

  registerMainHandler(IpcChannels.TLS_STATUS, async (): Promise<TlsStatus> => {
    return getTlsStatus(storeManager.getConfig(), proxyServer.getHttpsRuntimeStatus())
  })

  // 信任的安装与卸载都针对**盘上当前这张**证书：改过证书名单后磁盘上的证书已经重签，
  // 运行时缓存那份是旧的，装/卸错对象会让界面显示「未信任」而用户不知道为什么。
  const withTlsMaterial = async (
    action: (material: TlsMaterial) => Promise<TlsTrustResult>,
  ): Promise<TlsTrustResult> => {
    try {
      const config = storeManager.getConfig()
      const material = tryReadTlsMaterial(config) ?? proxyServer.getHttpsMaterial() ?? loadTlsMaterial(config)
      return await action(material)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to prepare the HTTPS certificate',
        trusted: null,
      }
    }
  }

  registerMainHandler(IpcChannels.TLS_INSTALL_TRUST, () => withTlsMaterial(installCertificateTrust))

  registerMainHandler(IpcChannels.TLS_UNINSTALL_TRUST, () => withTlsMaterial(uninstallCertificateTrust))

  registerMainHandler(IpcChannels.CONFIG_GET, async () => {
    return storeManager.getConfig()
  })

  registerMainHandler(IpcChannels.CONFIG_UPDATE, async (_, updates: Partial<AppConfig>) => {
    const current = storeManager.getConfig()
    // Only the HTTPS/proxy pair is checked here: the renderer writes through
    // this channel and used to skip `ConfigManager.validate` entirely, so an
    // HTTPS port equal to the proxy port would only surface as a confusing
    // bind failure at the next start.
    const validation = ConfigManager.validate({
      proxyPort: updates.proxyPort ?? current.proxyPort,
      httpsEnabled: updates.httpsEnabled ?? current.httpsEnabled,
      httpsPort: updates.httpsPort ?? current.httpsPort,
      httpsCertPath: updates.httpsCertPath ?? current.httpsCertPath,
      httpsKeyPath: updates.httpsKeyPath ?? current.httpsKeyPath,
      httpsSanHosts: updates.httpsSanHosts ?? current.httpsSanHosts,
    })
    if (!validation.valid) {
      const message = validation.errors.join('; ')
      storeManager.addLog('warn', `Rejected configuration update: ${message}`)
      throw new Error(message)
    }

    const newConfig = storeManager.updateConfig(updates)

    broadcastConfigChanged(newConfig)
    // 配置一落地就重新核对监听安全：`checkStartupSecurity` 原本只在 `start()` 跑一次，
    // 「先带 Key 绑 0.0.0.0 启动、再把 Key 清空」会让服务继续以无鉴权状态对外监听。
    proxyServer.revalidateSecurity()

    // 模型清单刷新配置变更：运行时重排调度任务（增删类别 / 改周期 / 整体开关）。
    if (updates.modelListRefresh !== undefined) {
      configureModelListRefresh(newConfig.modelListRefresh)
    }

    return true
  })

  // ==================== 多路由 CRUD（R2）====================
  //
  // 返回形状与 `channels:*` 那批同风格：`{ok:true,…} | {ok:false,error:{code,message}}`。
  // 错误**以可读文本返回**而不是抛裸异常：UI 要把「名字撞了已服务的模型」「池策略
  // id 未知」原样显示出来，协议错误只会让用户以为按钮没反应。
  //
  // 三条写通道成功后广播 `CONFIG_CHANGED`（载荷是归一后的整份配置，一定带 `routes`），
  // renderer 立刻刷新路由表 —— 与「删除/停用路由不需要重启代理」是同一件事的两面：
  // 请求侧每请求现读 `getConfig()`，界面侧靠这条广播同步。
  //
  // 名字/池策略校验全在 store 层（`storeManager.createRoute` 等 → `checkRouteName`
  // /`checkPoolStrategyIds`），这里不许长第二份口径。

  registerMainHandler(IpcChannels.ROUTES_LIST, async (): Promise<RouteListResult> => {
    try {
      return { ok: true, routes: storeManager.listModelRoutes() }
    } catch (error) {
      return { ok: false, error: routeStorageError(error) }
    }
  })

  registerMainHandler(
    IpcChannels.ROUTES_CREATE,
    async (_, input: Partial<ModelRoute> & { name: string }): Promise<RouteMutationResult> => {
      try {
        const result = storeManager.createRoute(input)
        if (!result.ok) return result
        broadcastConfigChanged(storeManager.getConfig())
        return result
      } catch (error) {
        return { ok: false, error: routeStorageError(error) }
      }
    },
  )

  registerMainHandler(
    IpcChannels.ROUTES_UPDATE,
    async (_, currentName: string, patch: Partial<ModelRoute>): Promise<RouteMutationResult> => {
      try {
        const result = storeManager.updateRoute(currentName, patch)
        if (!result.ok) return result
        broadcastConfigChanged(storeManager.getConfig())
        return result
      } catch (error) {
        return { ok: false, error: routeStorageError(error) }
      }
    },
  )

  registerMainHandler(
    IpcChannels.ROUTES_DELETE,
    async (_, name: string): Promise<RouteRemovalResult> => {
      try {
        const result = storeManager.deleteRoute(name)
        if (!result.ok) return result
        broadcastConfigChanged(storeManager.getConfig())
        return result
      } catch (error) {
        return { ok: false, error: routeStorageError(error) }
      }
    },
  )

  /**
   * 路由池预览。入参是**草稿**路由（还没保存的那份），所以不能从 store 读配置 ——
   * 用户要看到的是「按下保存后会怎样」。只读：不扣冷却、不请求上游、不写状态。
   */
  registerMainHandler(
    IpcChannels.ROUTES_PREVIEW,
    async (_, route: ModelRoute, sample?: RoutePreviewSample): Promise<RoutePreviewResult> => {
      return autoRouter.preview(route, sample ?? {})
    },
  )

  /**
   * 逐路由的候选模型数。路由列表页在**没进编辑态**时也要回答「这条路由的池有多大」，
   * 而 `routes:preview` 一次只折一条、还把逐行明细全带回来；这里一次采集折全表，只回
   * 数字。停用的路由也算 —— 它的池照样是那份配置折出来的，界面要说的是配置而不是「能不能用」。
   */
  registerMainHandler(
    IpcChannels.ROUTES_POOL_SIZES,
    async (): Promise<RoutePoolSizesResult> => {
      try {
        return { ok: true, sizes: autoRouter.routePoolSizes(storeManager.listModelRoutes()) }
      } catch (error) {
        return { ok: false, error: routeStorageError(error) }
      }
    },
  )

  /** 只读预览：会新增哪几条 Anthropic 可发现别名、哪些名字被什么挡住了。 */
  registerMainHandler(
    IpcChannels.ANTHROPIC_DISCOVERY_PLAN,
    async (): Promise<AnthropicDiscoveryResult> => {
      try {
        return planAnthropicRoutes()
      } catch (error) {
        return { ok: false, error: routeStorageError(error) }
      }
    },
  )

  registerMainHandler(
    IpcChannels.ANTHROPIC_DISCOVERY_APPLY,
    async (): Promise<AnthropicRouteApplyResult> => {
      try {
        const result = applyAnthropicRoutes()
        if (!result.ok) return result
        // 别名写进的是 `config.modelMappings`，模型映射面板与代理都在读它。
        if (result.created.length > 0) broadcastConfigChanged(storeManager.getConfig())
        return result
      } catch (error) {
        return { ok: false, error: routeStorageError(error) }
      }
    },
  )

  registerMainHandler(IpcChannels.STORE_GET, async (_, key: string): Promise<unknown> => {
    if (key === 'logs') {
      return storeManager.getLogs()
    }
    const store = storeManager.getStore()
    return store?.get(key)
  })

  registerMainHandler(IpcChannels.STORE_SET, async (_, key: string, value: unknown): Promise<void> => {
    if (key === 'logs') {
      storeManager.replaceLogs(Array.isArray(value) ? value as LogEntry[] : [])
      return
    }
    // `config` 是唯一有归一契约的整对象键：通用 raw 写会绕过 `updateConfig`，把
    // `routes` 键从盘上抹掉，下一次读取就会重放 legacy 迁移、把用户已删的 `auto`
    // 复活。所以这条路走 `storeManager.setConfig`（先归一再落盘，见该方法注释）：
    // 其中 `routes` 键**永远取盘上现表**，renderer 那份镜像（可能陈旧）不再具备
    // 抹掉路由的能力——路由只由 `routes:*` 专用通道与 `updateConfig` 负责。
    // 广播的也是归一后的那份 —— UI 收到的与盘上的必须同形。
    //
    // 这条广播是 Header 的代理地址徽标等的唯一刷新来源（`tests/renderer/
    // header-proxy-address.test.mjs` 用源码文本钉住「store:set('config') 也发
    // CONFIG_CHANGED」），所以发送语句留在本分支里、不折进 helper：钉的那段文本
    // 就是这条链路真正在跑的那段代码。
    if (key === 'config') {
      const normalized = storeManager.setConfig(value)
      getHost().push(IpcChannels.CONFIG_CHANGED, normalized)
      proxyServer.revalidateSecurity()
      return
    }
    // 通用写通道到上面两个键为止。以前这里还有一条 `store.set(key, value)` 的裸写：
    // `accounts` / `providers` 走它会把渲染层传来的整串对象直接落盘，绕过
    // `encryptCredentials` 的逐字段加密；而读回来时 `decryptData` 对解不开的值回退返回
    // 原文，于是「功能照常、盘上是明文」，谁都看不出加密被绕过了。
    // 渲染层现在没有任何合法调用方（配置走 `config:update`，厂商/账号/路由走各自专用
    // 通道），所以未登记的键一律拒绝并留痕。
    console.error(`[IPC] Rejected raw store:set for unregistered key: ${key}`)
    throw new Error(`store:set does not accept the key "${key}"`)
  })

  registerMainHandler(IpcChannels.STORE_DELETE, async (_, key: string): Promise<void> => {
    if (key === 'logs') {
      storeManager.clearLogs()
      return
    }
    // 与 `store:set` 同一条白名单：删除 `accounts` / `providers` / `config` 属于专用通道
    // 的职责（它们要顺带清运行时状态与广播），通用键删会留下不一致的中间态。
    console.error(`[IPC] Rejected raw store:delete for unregistered key: ${key}`)
    throw new Error(`store:delete does not accept the key "${key}"`)
  })

  registerMainHandler(IpcChannels.STORE_CLEAR_ALL, async (): Promise<void> => {
    storeManager.clearAll()
  })

  registerMainHandler(IpcChannels.PROVIDERS_GET_ALL, async (): Promise<Provider[]> => {
    return ProviderManager.getAll()
  })

  registerMainHandler(IpcChannels.PROVIDERS_GET_BUILTIN, async () => {
    return getBuiltinProviders()
  })

  registerMainHandler(IpcChannels.PROVIDERS_ADD, async (_, data: {
    id?: string
    name: string
    type?: 'builtin' | 'custom'
    authType: AuthType
    apiEndpoint: string
    headers?: Record<string, string>
    description?: string
    supportedModels?: string[]
    credentialFields?: CredentialField[]
  }): Promise<Provider> => {
    return CustomProviderManager.create(data)
  })

  registerMainHandler(IpcChannels.PROVIDERS_UPDATE, async (_, id: string, updates: Partial<Provider>): Promise<Provider | null> => {
    return ProviderManager.update(id, updates)
  })

  registerMainHandler(IpcChannels.PROVIDERS_DELETE, async (_, id: string): Promise<boolean> => {
    return CustomProviderManager.delete(id)
  })

  registerMainHandler(IpcChannels.PROVIDERS_CHECK_STATUS, async (_, providerId: string): Promise<ProviderCheckResult> => {
    const provider = ProviderManager.getById(providerId)

    if (!provider) {
      return {
        providerId,
        status: 'unknown',
        error: 'Provider not found',
      }
    }

    // 单查入口是「用户点了刷新」：`force` 绕过巡检缓存的 TTL，重新探一次。
    // 同一 provider 的在途探测仍然复用（`ProviderChecker` 内部去重），不会并发发两次。
    const result = await ProviderChecker.checkProviderStatus(provider, { force: true })

    // 落盘只在状态翻转时发生：`provider.status` 是「最后一次已知快照」，实时显示读的是
    // 下面这个返回值（`dashboardStore` / `ProviderCard` 都优先用检查结果）。
    ProviderManager.persistStatusSnapshot(providerId, result.status)

    return result
  })

  registerMainHandler(IpcChannels.PROVIDERS_CHECK_ALL_STATUS, async (): Promise<Record<string, ProviderCheckResult>> => {
    // 一轮巡检：结果进 `ProviderChecker` 的 5 分钟缓存（Dashboard 每 60s 打一次这条通道，
    // 23 个 provider ⇒ 改前是每分钟 23 次整份 `data.json` 加密落盘 + 约 10 次上游 GET），
    // 落盘交给 `persistStatusSnapshot` 那道「只认翻转」的门。
    return checkAllProviderStatuses(
      ProviderManager.getAll(),
      (providerId, status, checkedAt) =>
        ProviderManager.persistStatusSnapshot(providerId, status, checkedAt),
    )
  })

  registerMainHandler(IpcChannels.PROVIDERS_DUPLICATE, async (_, id: string): Promise<Provider> => {
    return CustomProviderManager.duplicate(id)
  })

  registerMainHandler(IpcChannels.PROVIDERS_EXPORT, async (_, id: string): Promise<string> => {
    return CustomProviderManager.exportProvider(id)
  })

  registerMainHandler(IpcChannels.PROVIDERS_IMPORT, async (_, jsonData: string): Promise<Provider> => {
    return CustomProviderManager.importProvider(jsonData)
  })

  registerMainHandler(IpcChannels.PROVIDERS_UPDATE_MODELS, async (_, providerId: string): Promise<{
    success: boolean
    reason?: ModelsFetchFailure
    detail?: string
    fetchedCount?: number
    addedCount?: number
    fetchedAt?: number
  }> => {
    // 聚合记录有自己的同步路径：带 Key 轮换探测上游清单，把新模型并入条目的
    // `<entryId>/<id>` 命名空间（并重写全局路由映射），而不是走内置的 fetched 合并。
    const stored = storeManager.getProviderById(providerId)
    if (stored?.type === 'aggregate') {
      const synced = await aggregateProviderManager.syncModels(providerId)
      if (!synced.success) {
        console.warn('[IPC] Aggregate model sync for ' + providerId + ' failed: ' + synced.reason)
        return {
          success: false,
          reason: aggregateSyncFailureReason(synced.reason),
          detail: synced.detail,
        }
      }
      return {
        success: true,
        fetchedCount: synced.fetchedCount ?? synced.modelCount ?? 0,
        addedCount: synced.addedCount ?? 0,
        fetchedAt: Date.now(),
      }
    }

    const result = await fetchProviderModels(providerId)

    if (!result.ok) {
      console.warn(
        '[IPC] Model update for ' + providerId + ' failed: ' + result.reason,
        result.detail || ''
      )
      return { success: false, reason: result.reason, detail: result.detail }
    }

    const applied = storeManager.applyFetchedModels(providerId, result.models)

    return {
      success: true,
      fetchedCount: applied.fetchedCount,
      addedCount: applied.addedCount,
      fetchedAt: applied.fetchedAt,
      detail: result.detail,
    }
  })

  registerMainHandler(IpcChannels.PROVIDERS_GET_EFFECTIVE_MODELS, async (_, providerId: string) => {
    try {
      return storeManager.getEffectiveModels(providerId)
    } catch (error) {
      console.error('[IPC] Failed to get effective models:', error)
      return []
    }
  })

  registerMainHandler(IpcChannels.PROVIDERS_GET_MODEL_CATALOGUE, async (_, providerId: string) => {
    try {
      return storeManager.getModelCatalogue(providerId)
    } catch (error) {
      console.error('[IPC] Failed to get model catalogue:', error)
      return []
    }
  })

  registerMainHandler(
    IpcChannels.PROVIDERS_SET_MODELS_SERVED,
    async (_, providerId: string, names: string[], served: boolean) => {
      if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) {
        return { success: false, error: 'names must be an array of model names', catalogue: [] }
      }
      if (typeof served !== 'boolean') {
        return { success: false, error: 'served must be a boolean', catalogue: [] }
      }
      try {
        return { success: true, catalogue: storeManager.setModelsServed(providerId, names, served) }
      } catch (error) {
        console.error('[IPC] Failed to change served models:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to change served models',
          catalogue: [],
        }
      }
    }
  )

  registerMainHandler(IpcChannels.PROVIDERS_ADD_CUSTOM_MODEL, async (_, providerId: string, model: { displayName: string; actualModelId: string }) => {
    try {
      return {
        success: true,
        models: storeManager.addCustomModel(providerId, model),
      }
    } catch (error) {
      console.error('[IPC] Failed to add custom model:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add custom model',
        models: [],
      }
    }
  })

  registerMainHandler(IpcChannels.PROVIDERS_REMOVE_MODEL, async (_, providerId: string, modelName: string) => {
    try {
      return {
        success: true,
        models: storeManager.removeModel(providerId, modelName),
      }
    } catch (error) {
      console.error('[IPC] Failed to remove model:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove model',
        models: [],
      }
    }
  })

  registerMainHandler(IpcChannels.PROVIDERS_RESET_MODELS, async (_, providerId: string) => {
    try {
      return {
        success: true,
        models: storeManager.resetModels(providerId),
      }
    } catch (error) {
      console.error('[IPC] Failed to reset models:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset models',
        models: [],
      }
    }
  })

  registerMainHandler(IpcChannels.PROVIDERS_GET_MODEL_MARKS, async () => {
    return storeManager.getUserModelMarks()
  })

  // 只读台账，和 getModelMarks 同一形态：界面用它回显「这一行已被批量采用了几项」。
  registerMainHandler(IpcChannels.PROVIDERS_GET_CATALOG_ADOPTIONS, async () => {
    return storeManager.getCatalogAdoptions()
  })

  registerMainHandler(
    IpcChannels.PROVIDERS_SET_MODEL_MARK,
    async (_, providerId: string, displayName: string, mark: ModelCapabilityHint | null) => {
      try {
        return { success: true, marks: storeManager.setUserModelMark(providerId, displayName, mark) }
      } catch (error) {
        console.error('[IPC] Failed to set model mark:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set model mark',
          marks: storeManager.getUserModelMarks(),
        }
      }
    }
  )

  registerMainHandler(IpcChannels.PROVIDERS_GET_MODEL_METADATA, async (_, providerId?: string) => {
    try {
      return await getModelMetadataReport(
        Date.now(),
        typeof providerId === 'string' && providerId.length > 0 ? providerId : undefined,
      )
    } catch (error) {
      console.error('[IPC] Failed to build model metadata report:', error)
      return { success: false, error: 'Failed to build model metadata report' }
    }
  })

  // 逐模型标注入口（聚合渠道 / 账号渠道的模型列表）只要这一行的解析结果。
  // 走 `getResolvedModelMetadata` 而不是报表：报表会遍历所有供应商并重建目录索引，
  // 为一次点击付那个代价不值得，且 store 每次读取都整份解密（见 ~/.modelport 热循环记录）。
  registerMainHandler(
    IpcChannels.PROVIDERS_GET_MODEL_METADATA_ONE,
    async (_, providerId: string, displayName: string) => {
      if (typeof providerId !== 'string' || typeof displayName !== 'string') {
        return { success: false, error: 'providerId and displayName are required' }
      }
      try {
        const metadata = await getResolvedModelMetadata({ providerId, displayName })
        if (!metadata) return { success: false, error: '模型不在该供应商目录中' }
        return { success: true, metadata }
      } catch (error) {
        console.error('[IPC] Failed to resolve model metadata:', error)
        return { success: false, error: error instanceof Error ? error.message : 'metadata failed' }
      }
    }
  )

  registerMainHandler(
    IpcChannels.PROVIDERS_PROBE_MODEL,
    async (_, providerId: string, displayName: string, scope?: string, force?: boolean) => {
      if (typeof providerId !== 'string' || typeof displayName !== 'string') {
        return { success: false, error: 'providerId and displayName are required' }
      }
      const normalizedScope: ProbeScope =
        scope === 'context' || scope === 'output' || scope === 'capability'
          ? scope
          : 'capability'
      const jobId = randomUUID()
      const startedAt = Date.now()
      const controller = new AbortController()
      // 整体超时 5 分钟：到点后信号置为 'timeout'，runner 按 inconclusive 收敛。
      const timer = setTimeout(() => controller.abort('timeout'), PROBE_TOTAL_TIMEOUT_MS)
      const initial: ProbeJobSnapshot = {
        jobId,
        providerId,
        displayName,
        scope: normalizedScope,
        phase: 'prepare',
        elapsedMs: 0,
        requestsSent: 0,
        requestLimit: 0,
        startedAt: new Date(startedAt).toISOString(),
        status: 'running',
        updatedAt: new Date(startedAt).toISOString(),
      }
      const record: ProbeJobRecord = { controller, timer, snapshot: initial }
      probeJobs.set(jobId, record)
      trimProbeJobs()
      broadcastProbeProgress(initial)

      const emit = (event: ProbeProgressEvent): void => {
        const status: ProbeJobSnapshot['status'] =
          event.phase === 'cancelled'
            ? 'cancelled'
            : event.phase === 'done'
              ? 'done'
              : 'running'
        record.snapshot = {
          ...record.snapshot,
          ...event,
          jobId,
          status,
          updatedAt: new Date().toISOString(),
        }
        broadcastProbeProgress(record.snapshot)
      }

      try {
        // 一次点击 → 一条阶梯；不会在打开页面时自动触发。
        const result = await runModelCapabilityProbe({
          providerId,
          displayName,
          scope: normalizedScope,
          force: force === true,
          run: { jobId, signal: controller.signal, onProgress: emit },
        })
        const aborted = controller.signal.aborted
        // `inconclusive` 是一次「跑完但没结论」的结果，不是任务失败；
        // 结论（measured/skipped/inconclusive）由 result.status 表达。
        const finalStatus: ProbeJobSnapshot['status'] = aborted
          ? controller.signal.reason === 'timeout'
            ? 'failed'
            : 'cancelled'
          : 'done'
        const timedOut = aborted && controller.signal.reason === 'timeout'
        record.snapshot = {
          ...record.snapshot,
          status: finalStatus,
          // 整体超时：阶段收口到 done，并显式给出「上游超时」分类，
          // 避免把一次超时显示成「等待响应 / 网络不可达」。
          ...(timedOut ? { phase: 'done' as const, errorKind: 'timeout' as const } : {}),
          updatedAt: new Date().toISOString(),
          result,
        }
        broadcastProbeProgress(record.snapshot)
        return { success: true, jobId, result }
      } catch (error) {
        console.error('[IPC] Failed to probe model metadata:', error)
        const message = error instanceof Error ? error.message : 'Failed to probe model metadata'
        record.snapshot = {
          ...record.snapshot,
          status: 'failed',
          phase: 'done',
          message,
          updatedAt: new Date().toISOString(),
        }
        broadcastProbeProgress(record.snapshot)
        return { success: false, jobId, error: message }
      } finally {
        clearTimeout(timer)
      }
    },
  )

  registerMainHandler(IpcChannels.PROVIDERS_CANCEL_PROBE, (_, jobId: string) => {
    const record = probeJobs.get(jobId)
    if (!record) return { success: false, error: '未知的探测任务' }
    record.controller.abort('cancel')
    return { success: true }
  })

  registerMainHandler(IpcChannels.PROVIDERS_GET_PROBE_JOBS, () =>
    [...probeJobs.values()].map((record) => record.snapshot),
  )

  registerMainHandler(IpcChannels.PROVIDERS_GET_CATALOG_STATUSES, async () => {
    try {
      return await getCatalogStatuses()
    } catch (error) {
      console.error('[IPC] Failed to read catalog statuses:', error)
      return []
    }
  })

  registerMainHandler(IpcChannels.PROVIDERS_REFRESH_CATALOG, async (_, source: string) => {
    const normalized: CatalogSourceId | undefined =
      source === 'models.dev' || source === 'litellm' || source === 'openrouter'
        ? source
        : undefined
    if (normalized === undefined) {
      return { success: false, error: '未知的标准库来源', statuses: [] }
    }
    try {
      // 用户显式触发才联网；失败时 service 保留磁盘上的旧快照。
      return await refreshCatalog(normalized, {
        mirrorUrl: storeManager.getConfig().catalogMirrorUrl,
      })
    } catch (error) {
      console.error('[IPC] Failed to refresh model catalog:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh model catalog',
        statuses: await getCatalogStatuses(),
      }
    }
  })

  registerMainHandler(
    IpcChannels.PROVIDERS_GET_CATALOG_CANDIDATES,
    async (_, providerId: string, displayName: string) => {
      if (typeof providerId !== 'string' || typeof displayName !== 'string') {
        return { statuses: [], matches: [], adoptions: [] }
      }
      try {
        const actualModelId =
          storeManager
            .getEffectiveModels(providerId)
            .find((model) => model.displayName === displayName)?.actualModelId ?? displayName
        return await getCatalogCandidates({ providerId, displayName, actualModelId })
      } catch (error) {
        console.error('[IPC] Failed to match model catalog:', error)
        return { statuses: [], matches: [], adoptions: [] }
      }
    }
  )

  registerMainHandler(
    IpcChannels.PROVIDERS_ADOPT_CATALOG_FIELD,
    async (
      _,
      providerId: string,
      displayName: string,
      catalogId: string,
      field: CatalogAdoptionField,
    ) => {
      try {
        return await adoptCatalogField({ providerId, displayName, catalogId, field })
      } catch (error) {
        console.error('[IPC] Failed to adopt catalog field:', error)
        return { success: false, error: error instanceof Error ? error.message : 'adopt failed' }
      }
    }
  )

  registerMainHandler(
    IpcChannels.PROVIDERS_REVOKE_CATALOG_ADOPTION,
    async (_, providerId: string, displayName: string, field?: CatalogAdoptionField) => {
      try {
        return revokeCatalogAdoption({ providerId, displayName, ...(field ? { field } : {}) })
      } catch (error) {
        console.error('[IPC] Failed to revoke catalog adoption:', error)
        return { success: false, error: error instanceof Error ? error.message : 'revoke failed' }
      }
    }
  )

  registerMainHandler(IpcChannels.PROVIDERS_ESTIMATE_CATALOG_BATCH, async (_, providerId?: string) => {
    try {
      return await estimateCatalogBatch(
        typeof providerId === 'string' && providerId.length > 0 ? providerId : undefined,
      )
    } catch (error) {
      console.error('[IPC] Failed to estimate catalog batch:', error)
      return {
        models: 0,
        fields: 0,
        probeModels: 0,
        requests: 0,
        tokens: 0,
        exactModels: 0,
        aliasModels: 0,
        familyCandidates: 0,
        skippedDisabled: 0,
      }
    }
  })

  registerMainHandler(
    IpcChannels.PROVIDERS_START_CATALOG_BATCH,
    async (
      _,
      input?: { probe?: boolean; retryFailedOf?: string; providerId?: string },
    ) => {
      try {
        return await startCatalogBatch({
          probe: input?.probe === true,
          ...(input?.retryFailedOf ? { retryFailedOf: input.retryFailedOf } : {}),
          ...(typeof input?.providerId === 'string' && input.providerId.length > 0
            ? { providerId: input.providerId }
            : {}),
        })
      } catch (error) {
        console.error('[IPC] Failed to start catalog batch:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'batch start failed',
        }
      }
    }
  )

  registerMainHandler(IpcChannels.PROVIDERS_PAUSE_CATALOG_BATCH, (_, jobId: string) =>
    pauseCatalogBatch(jobId),
  )
  registerMainHandler(IpcChannels.PROVIDERS_RESUME_CATALOG_BATCH, (_, jobId: string) =>
    resumeCatalogBatch(jobId),
  )
  registerMainHandler(IpcChannels.PROVIDERS_CANCEL_CATALOG_BATCH, (_, jobId: string) =>
    cancelCatalogBatch(jobId),
  )
  registerMainHandler(IpcChannels.PROVIDERS_GET_CATALOG_BATCH_JOBS, () => getCatalogBatchJobs())

  registerMainHandler(IpcChannels.AGGREGATE_LIST, async () => {
    return aggregateProviderManager.list()
  })

  registerMainHandler(IpcChannels.AGGREGATE_SAVE, async (_, input: AggregateSaveInput) => {
    try {
      return { success: true, provider: aggregateProviderManager.save(input) }
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : 'save_failed' }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_SET_ENABLED, async (_, id: string, enabled: boolean) => {
    try {
      return { success: true, provider: aggregateProviderManager.setEnabled(id, enabled) }
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : 'not_configured' }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_REMOVE, async (_, id: string) => {
    aggregateProviderManager.remove(id)
    return { success: true }
  })

  registerMainHandler(IpcChannels.AGGREGATE_TEST, async (_, id: string) => {
    return aggregateProviderManager.test(id)
  })

  registerMainHandler(IpcChannels.AGGREGATE_SYNC_MODELS, async (_, id: string) => {
    return aggregateProviderManager.syncModels(id)
  })

  registerMainHandler(IpcChannels.AGGREGATE_DETAIL, async (_, id: string) => {
    try {
      return aggregateProviderManager.detail(id)
    } catch (error) {
      console.error('[IPC] Aggregate detail failed:', error)
      return null
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_ADD_KEY, async (_, id: string, apiKey: string) => {
    try {
      return await aggregateProviderManager.addKey(id, apiKey)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_REMOVE_KEY, async (_, accountId: string) => {
    try {
      return aggregateProviderManager.removeKey(accountId)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_SET_KEY_ENABLED, async (_, accountId: string, enabled: boolean) => {
    try {
      return aggregateProviderManager.setKeyEnabled(accountId, enabled)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_VALIDATE_KEY, async (_, id: string, accountId: string) => {
    try {
      return await aggregateProviderManager.validateKey(id, accountId)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_ADD_MODEL, async (_, id: string, modelId: string) => {
    try {
      return aggregateProviderManager.addModel(id, modelId)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_REMOVE_MODEL, async (_, id: string, modelId: string) => {
    try {
      return aggregateProviderManager.removeModel(id, modelId)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_SET_MODEL_ENABLED, async (_, id: string, modelId: string, enabled: boolean) => {
    try {
      return aggregateProviderManager.setModelEnabled(id, modelId, enabled)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_SET_MODEL_PARAMS, async (_, id: string, modelId: string, params: Record<string, unknown>) => {
    try {
      return aggregateProviderManager.setModelParams(id, modelId, params)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
  })

  registerMainHandler(IpcChannels.AGGREGATE_TEST_MODEL, async (_, id: string, modelId: string) => {
    try {
      return await aggregateProviderManager.testModel(id, modelId)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
  })

  // 账号级实时额度：只由详情页那一个按钮触发。返回值里只有掩码 Key 与报文摘要，
  // 密钥本身不过 IPC；异常兜底也走同一个形状，避免界面收到一个裸 throw。
  registerMainHandler(IpcChannels.AGGREGATE_QUERY_CREDITS, async (_, id: string) => {
    try {
      return await aggregateProviderManager.queryCredits(id)
    } catch (error) {
      console.error('[IPC] Aggregate credit query failed:', error)
      return {
        entryId: id,
        asOf: new Date().toISOString(),
        ok: false,
        reason: 'network',
        rows: [],
        accounts: 0,
        skipped: 0,
      }
    }
  })

  registerMainHandler(IpcChannels.CHANNELS_LIST, async () => {
    try {
      return { success: true, channels: await accountChannelManager.list() }
    } catch (error) {
      // 渠道 Worker 未构建/启动失败是可预期的部署问题，必须让 UI 说出原因，
      // 而不是把整页显示成空白。
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'channels_unavailable',
        channels: [],
      }
    }
  })

  registerMainHandler(IpcChannels.CHANNELS_ACCOUNT_COUNTS, async () => {
    try {
      return await accountChannelManager.accountCounts()
    } catch (error) {
      // 与 `channels:list` 不同，这里读不到就返回空表：供应商卡片会保留本地计数。
      // 「读不到池子」不是「这家渠道没有账号」，不能把它显示成 0。
      console.warn(
        '[ChannelPack] 读取渠道账号计数失败：',
        error instanceof Error ? error.message : String(error),
      )
      return {}
    }
  })

  registerMainHandler(IpcChannels.CHANNELS_RPC, async (_, method: string, payload: unknown) => {
    try {
      return await accountChannelManager.rpc(method, payload)
    } catch (error) {
      return {
        ok: false,
        error: { code: 'host_error', message: error instanceof Error ? error.message : '渠道调用失败' },
      }
    }
  })

  registerMainHandler(IpcChannels.CHANNELS_CREDITS, async (_, id: string) => {
    try {
      return await accountChannelManager.credits(id)
    } catch (error) {
      return {
        reported: 0,
        accounts: [],
        error: error instanceof Error ? error.message : '积分查询失败',
      }
    }
  })

  // 一次刷新问完所有已连接渠道：远程 UI 上这是 1 笔管理面请求而不是 13 笔。
  registerMainHandler(IpcChannels.CHANNELS_CREDITS_ALL, async (_, ids: unknown) => {
    if (!Array.isArray(ids)) return {}
    try {
      return await accountChannelManager.creditsAll(
        ids.filter((id): id is string => typeof id === 'string'),
      )
    } catch (error) {
      console.warn(
        '[ChannelPack] 批量读取渠道积分失败：',
        error instanceof Error ? error.message : String(error),
      )
      return {}
    }
  })

  registerMainHandler(IpcChannels.CHANNELS_SET_ENABLED, async (_, id: string, enabled: boolean) => {
    return accountChannelManager.setEnabled(id, enabled)
  })

  registerMainHandler(IpcChannels.CHANNELS_REMOVE, async (_, id: string) => {
    try {
      return await accountChannelManager.remove(id)
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : 'remove_failed' }
    }
  })

  registerMainHandler(IpcChannels.CHANNELS_AUTO_CHECKIN, async (_, enabled?: unknown) => {
    try {
      // 不传参 = 读当前状态，传布尔 = 改写开关（与渠道包 `usage.autoCheckin` 同口径）。
      return typeof enabled === 'boolean'
        ? await accountChannelManager.setAutoCheckin(enabled)
        : await accountChannelManager.autoCheckin()
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'auto_checkin_failed',
      }
    }
  })

  registerMainHandler(IpcChannels.CHANNELS_MODELS, async (_, id: string) => {
    try {
      return await accountChannelManager.modelsFor(id)
    } catch (error) {
      return {
        success: false,
        models: [],
        reason: error instanceof Error ? error.message : 'models_unavailable',
      }
    }
  })

  registerMainHandler(IpcChannels.CHANNELS_REFRESH_MODELS, async (_, id: string) => {
    try {
      return await accountChannelManager.refreshModels(id)
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'refresh_failed',
      }
    }
  })

  registerMainHandler(
    IpcChannels.CHANNELS_SET_MODEL_DISABLED,
    async (_, id: string, modelId: string, disabled: boolean) => {
      try {
        return await accountChannelManager.setModelDisabled(id, modelId, disabled)
      } catch (error) {
        return {
          success: false,
          models: [],
          reason: error instanceof Error ? error.message : 'model_update_failed',
        }
      }
    },
  )

  registerMainHandler(
    IpcChannels.CHANNELS_CLEAR_DEAD_MODELS,
    async (_, id: string, modelId?: string) => {
      try {
        return await accountChannelManager.clearDeadModels(id, modelId)
      } catch (error) {
        return {
          success: false,
          models: [],
          reason: error instanceof Error ? error.message : 'model_update_failed',
        }
      }
    },
  )

  // 账号/模型在 Worker 内变化后，把「已变化」广播给所有窗口，让卡片自行刷新。
  accountChannelManager.setChangeListener(() => {
    getHost().push(IpcChannels.CHANNELS_CHANGED)
  })

  // 后台起 Worker：启动失败不能挡住窗口加载，具体原因由卡片页显示。
  void accountChannelManager.initialize().catch(error => {
    console.error('[ChannelPack] 渠道运行时启动失败：', error)
  })

  registerMainHandler(IpcChannels.ACCOUNTS_GET_ALL, async (): Promise<Account[]> => {
    // 渲染层拿不到解密后的凭据：转发时用的密钥只在主进程内部解密取用
    // （`proxy/forwarder.ts` 的 `buildHeaders`），界面要显示只能显示掩码。
    // 这条通道原先带 `includeCredentials` 参数，任何能叫 IPC 的脚本一句
    // `accounts:get-all(true)` 就把全部上游 Key / refreshToken / cookie 端走。
    return AccountManager.getAll(false)
  })

  registerMainHandler(IpcChannels.ACCOUNTS_GET_BY_ID, async (_, id: string, includeCredentials?: boolean): Promise<Account | null> => {
    // 这一条仍然把明文凭据交给渲染进程，因为账号编辑框要预填已存的 Key
    // （`pages/Providers.tsx:681,707` 两处都传 true）。彻底闭掉它要先改编辑框语义
    // （显示掩码 + 「留空表示不修改」），那是界面改动 + 实机核对，不能在这批里盲改。
    // 已经收紧的是：`accounts:get-all` 不再返回凭据，且渲染层没有了通用 `invoke`，
    // 主进程每个通道都要过 `senderFrame` 来源校验。
    return storeManager.getAccountById(id, includeCredentials) || null
  })

  registerMainHandler(IpcChannels.ACCOUNTS_GET_BY_PROVIDER, async (_, providerId: string): Promise<Account[]> => {
    return storeManager.getAccountsByProviderId(providerId)
  })

  registerMainHandler(IpcChannels.ACCOUNTS_ADD, async (_, data: {
    providerId: string
    name: string
    email?: string
    credentials: Record<string, string>
    dailyLimit?: number
  }): Promise<Account> => {
    return AccountManager.create(data)
  })

  registerMainHandler(IpcChannels.ACCOUNTS_UPDATE, async (_, id: string, updates: Partial<Account>): Promise<Account | null> => {
    return AccountManager.update(id, updates)
  })

  registerMainHandler(IpcChannels.ACCOUNTS_DELETE, async (_, id: string): Promise<boolean> => {
    return AccountManager.delete(id)
  })

  registerMainHandler(IpcChannels.ACCOUNTS_VALIDATE, async (_, accountId: string): Promise<boolean> => {
    const result = await AccountManager.validate(accountId)
    return result.valid
  })

  registerMainHandler(IpcChannels.ACCOUNTS_VALIDATE_TOKEN, async (_, providerId: string, credentials: Record<string, string>) => {
    let provider = ProviderManager.getById(providerId)
    
    // If provider not in store, check builtin providers
    if (!provider) {
      const builtinConfig = getBuiltinProvider(providerId)
      if (builtinConfig) {
        provider = {
          id: builtinConfig.id,
          name: builtinConfig.name,
          type: 'builtin',
          authType: builtinConfig.authType,
          apiEndpoint: builtinConfig.apiEndpoint,
          headers: builtinConfig.headers,
          enabled: true,
          description: builtinConfig.description,
          supportedModels: builtinConfig.supportedModels || [],
          modelMappings: builtinConfig.modelMappings || {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      }
    }
    
    if (!provider) {
      return { valid: false, error: 'Provider not found' }
    }
    
    const tempAccount: Account = {
      id: 'temp',
      providerId,
      name: 'temp',
      credentials,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    
    return ProviderChecker.checkAccountToken(provider, tempAccount)
  })

  registerMainHandler(IpcChannels.OAUTH_START_LOGIN, async (_, providerId: string, providerType: ProviderVendor): Promise<OAuthResult> => {
    console.log('Starting OAuth login:', providerId, providerType)
    return await oauthManager.startLogin({
      providerId,
      providerType: providerType as ProviderType,
    })
  })

  registerMainHandler(IpcChannels.OAUTH_CANCEL_LOGIN, async (): Promise<void> => {
    console.log('Cancel OAuth login')
    await oauthManager.cancelLogin()
  })

  registerMainHandler(IpcChannels.OAUTH_LOGIN_WITH_TOKEN, async (_, data: { providerId: string, providerType: ProviderVendor, token: string }): Promise<OAuthResult> => {
    return await oauthManager.loginWithToken(data.providerId, data.providerType as ProviderType, data.token)
  })

  registerMainHandler(IpcChannels.OAUTH_VALIDATE_TOKEN, async (_, data: { providerId: string, providerType: ProviderVendor, credentials: Record<string, string> }) => {
    return await oauthManager.validateToken(data.providerId, data.providerType as ProviderType, data.credentials)
  })

  registerMainHandler(IpcChannels.OAUTH_REFRESH_TOKEN, async (_, data: { providerId: string, providerType: ProviderVendor, credentials: Record<string, string> }) => {
    return await oauthManager.refreshToken(data.providerId, data.providerType as ProviderType, data.credentials)
  })

  registerMainHandler(IpcChannels.OAUTH_GET_STATUS, async (): Promise<string> => {
    return oauthManager.getStatus()
  })

  registerMainHandler(IpcChannels.LOGS_GET, async (_, filter?: {
    level?: LogLevel | 'all'
    keyword?: string
    startTime?: number
    endTime?: number
    limit?: number
    offset?: number
  }): Promise<LogEntry[]> => {
    return storeManager.getLogs(filter)
  })

  registerMainHandler(IpcChannels.LOGS_GET_STATS, async () => {
    return storeManager.getLogStats()
  })

  registerMainHandler(IpcChannels.LOGS_GET_TREND, async (_, days?: number) => {
    return storeManager.getLogTrend(days)
  })

  registerMainHandler(IpcChannels.LOGS_GET_ACCOUNT_TREND, async (_, accountId: string, days?: number) => {
    return storeManager.getAccountLogTrend(accountId, days)
  })

  registerMainHandler(IpcChannels.LOGS_CLEAR, async (): Promise<void> => {
    storeManager.clearLogs()
  })

  registerMainHandler(IpcChannels.LOGS_EXPORT, async (_, format?: 'json' | 'txt'): Promise<string> => {
    return storeManager.exportLogs(format)
  })

  registerMainHandler(IpcChannels.LOGS_GET_BY_ID, async (_, id: string): Promise<LogEntry | undefined> => {
    return storeManager.getLogById(id)
  })

  // ==================== Request Logs Handlers ====================

  registerMainHandler(IpcChannels.REQUEST_LOGS_GET, async (_, filter?: {
    status?: 'success' | 'error'
    providerId?: string
    limit?: number
  }) => {
    return storeManager.getRequestLogs(filter?.limit, filter)
  })

  registerMainHandler(IpcChannels.REQUEST_LOGS_GET_BY_ID, async (_, id: string) => {
    return storeManager.getRequestLogById(id)
  })

  registerMainHandler(IpcChannels.REQUEST_LOGS_GET_STATS, async () => {
    return storeManager.getRequestLogStats()
  })

  registerMainHandler(IpcChannels.REQUEST_LOGS_CLEAR, async (): Promise<void> => {
    storeManager.clearRequestLogs()
  })

  registerMainHandler(IpcChannels.REQUEST_LOGS_BUNDLE, async (_, key: string) => {
    return buildRequestDiagnosticBundle(String(key))
  })

  registerMainHandler(IpcChannels.REQUEST_LOGS_BUNDLE_SAVE, async (_, key: string) => {
    const bundle = buildRequestDiagnosticBundle(String(key))
    const target = await requireSystem('save-diagnostic-bundle').pickSavePath(
      `modelport-diagnostic-${String(key).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`,
    )
    if (target === null) return { saved: false }
    writeFileSync(target, JSON.stringify(bundle, null, 2), 'utf-8')
    return { saved: true, path: target }
  })

  // ==================== Statistics Handlers ====================

  registerMainHandler(IpcChannels.STATISTICS_GET, async () => {
    return storeManager.getStatistics()
  })

  registerMainHandler(IpcChannels.STATISTICS_GET_TODAY, async () => {
    return storeManager.getTodayStatistics()
  })

  registerMainHandler(IpcChannels.STATISTICS_GET_TOKEN_USAGE, async () => {
    return storeManager.getTodayTokenUsage()
  })

  registerMainHandler(IpcChannels.STATISTICS_GET_TOKEN_USAGE_HISTORY, async (_event, days?: number) => {
    return storeManager.getTokenUsageHistory(days)
  })

  // The whole retained day map, so the renderer can re-bucket it for any period
  // the user picks without another round trip.
  registerMainHandler(IpcChannels.STATISTICS_GET_TOKEN_USAGE_DAYS, async () => {
    return storeManager.getTokenUsageDays()
  })

  // ==================== 桌面专属通道 ====================
  // 下面这些需要窗口、托盘、安装器或系统链接处理器。无桌面宿主上 `requireDesktop`
  // 抛 `desktop-only`，界面拿到的是「这台主机没有这个能力」，而不是一个什么都不做的按钮。
  registerMainHandler(IpcChannels.APP_GET_VERSION, async (): Promise<string> => {
    return getHost().getVersion()
  })

  registerMainHandler(IpcChannels.APP_CHECK_UPDATE, async () => {
    const desktop = requireDesktop('check-for-updates')
    try {
      await desktop.checkForUpdates()
      return desktop.getUpdateStatus()
    } catch (error) {
      console.error('[App] Check update error:', error)
      return {
        ...(desktop.getUpdateStatus() as Record<string, unknown>),
        checking: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  registerMainHandler(IpcChannels.APP_DOWNLOAD_UPDATE, async (): Promise<void> => {
    await requireDesktop('download-update').downloadUpdate()
  })

  registerMainHandler(IpcChannels.APP_INSTALL_UPDATE, async (): Promise<void> => {
    requireDesktop('install-update').quitAndInstall()
  })

  registerMainHandler(IpcChannels.APP_GET_UPDATE_STATUS, async () => {
    return requireDesktop('get-update-status').getUpdateStatus()
  })

  registerMainHandler(IpcChannels.APP_MINIMIZE, async (): Promise<void> => {
    requireDesktop('minimize').window('minimize')
  })

  registerMainHandler(IpcChannels.APP_MAXIMIZE, async (): Promise<void> => {
    requireDesktop('maximize').window('maximize')
  })

  registerMainHandler(IpcChannels.APP_CLOSE, async (): Promise<void> => {
    // 「最小化到托盘」还是「真的退出」仍由配置决定；宿主只负责执行那一步。
    const config = storeManager.getConfig()
    requireDesktop('close-window').window(config.minimizeToTray ? 'hide' : 'close')
  })

  registerMainHandler(IpcChannels.APP_SHOW_WINDOW, async (): Promise<void> => {
    requireDesktop('show-window').window('show')
  })

  registerMainHandler(IpcChannels.APP_HIDE_WINDOW, async (): Promise<void> => {
    requireDesktop('hide-window').window('hide')
  })

  registerMainHandler(IpcChannels.APP_SET_TITLE_BAR_THEME, async (_, theme: 'dark' | 'light'): Promise<void> => {
    if (theme !== 'dark' && theme !== 'light') return
    requireDesktop('title-bar-theme').window('title-bar-theme', theme)
  })

  registerMainHandler(IpcChannels.APP_OPEN_EXTERNAL, async (_, url: string): Promise<{ opened: boolean; url: string }> => {
    // `shell.openExternal` 把 URL 交给系统默认处理器：`file://` 会开本地文件、`smb://`
    // 会把 NetBIOS 凭据往外送、`ms-msdt:` / `search-ms:` 有已知的协议处理器滥用。
    // 界面里的外链只有 http(s)，所以其它协议一律拒绝并留痕。
    let protocol: string
    try {
      protocol = new URL(url).protocol
    } catch {
      console.warn(`[IPC] Rejected malformed openExternal URL: ${url}`)
      throw new Error('Invalid URL')
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      console.warn(`[IPC] Rejected openExternal for protocol ${protocol}`)
      throw new Error(`Refused to open a ${protocol} URL`)
    }
    const desktop = getHost().desktop
    if (!desktop) {
      // 浏览器客户端自己开链接；无头宿主不能假装它已经打开了。
      return { opened: false, url }
    }
    try {
      await desktop.openWithSystemHandler(url)
      return { opened: true, url }
    } catch (error) {
      console.error('[APP_OPEN_EXTERNAL] Error:', error)
      throw error
    }
  })

  // ==================== Management API Handlers ====================

  registerMainHandler(IpcChannels.MANAGEMENT_API_GET_CONFIG, async (): Promise<ManagementApiConfig> => {
    const config = ConfigManager.get()
    return config.managementApi
  })

  registerMainHandler(IpcChannels.MANAGEMENT_API_UPDATE_CONFIG, async (_, updates: Partial<ManagementApiConfig>): Promise<ManagementApiConfig> => {
    const config = ConfigManager.get()
    const currentManagementConfig = config.managementApi
    const newManagementConfig = { ...currentManagementConfig, ...updates }
    
    ConfigManager.update({ managementApi: newManagementConfig })
    
    return newManagementConfig
  })

  registerMainHandler(IpcChannels.MANAGEMENT_API_GENERATE_SECRET, async (): Promise<string> => {
    const newSecret = generateManagementSecret()
    
    const config = ConfigManager.get()
    const newManagementConfig = { ...config.managementApi, managementApiSecret: newSecret }
    ConfigManager.update({ managementApi: newManagementConfig })
    
    return newSecret
  })

  // ==================== Context Management Handlers ====================

  registerMainHandler(IpcChannels.CONTEXT_MANAGEMENT_GET_CONFIG, async () => {
    const config = ConfigManager.get()
    // 缺省值只有一处权威（`store/types.ts`）。这里以前抄了一份，而且抄错了：
    // 那份写 `enabled: true`，出厂默认是 `false` —— 兜底一旦生效就等于面板报一个和运行态相反的开关。
    return config.contextManagement || DEFAULT_CONTEXT_MANAGEMENT_CONFIG
  })

  registerMainHandler(IpcChannels.CONTEXT_MANAGEMENT_UPDATE_CONFIG, async (_, updates: Partial<any>) => {
    const config = ConfigManager.get()
    const currentContextConfig = config.contextManagement || DEFAULT_CONTEXT_MANAGEMENT_CONFIG
    const newContextConfig = {
      ...currentContextConfig,
      ...updates,
      strategies: {
        ...currentContextConfig.strategies,
        ...(updates.strategies || {}),
      },
    }
    
    ConfigManager.update({ contextManagement: newContextConfig })
    
    return newContextConfig
  })

  // 模型清单定时刷新：状态只读 + 手动触发。配置变更走 `config:update` 的
  // `modelListRefresh` 字段（CONFIG_UPDATE handler 会重新 `configureModelListRefresh`）。
  registerMainHandler(IpcChannels.MODEL_REFRESH_GET_STATUS, async () => {
    return {
      config: storeManager.getConfig().modelListRefresh ?? null,
      tasks: schedulerStatus(),
    }
  })
  registerMainHandler(IpcChannels.MODEL_REFRESH_TRIGGER_NOW, async () => {
    const refresh = storeManager.getConfig().modelListRefresh
    if (!refresh || !refresh.enabled) return { ok: false, reason: 'disabled' }
    await triggerModelListRefreshNow()
    return { ok: true, tasks: schedulerStatus() }
  })

  oauthManager.on('progress', (event) => {
    getHost().push(IpcChannels.OAUTH_PROGRESS, event)
  })
}

export function getProxyStatus(): ProxyStatus {
  const isRunning = proxyServer.isRunning()
  const port = proxyStatusManager.getPort()
  const host = isRunning
    ? proxyStatusManager.getHost()
    : storeManager.getConfig().proxyHost || proxyStatusManager.getHost()
  return {
    isRunning,
    port,
    host,
    uptime: proxyStatusManager.getRunningStatus().uptime,
    connections: proxyStatusManager.getStatistics().activeConnections,
  }
}

/**
 * 存储初始化失败时唯一的补救入口：重新尝试解密并打开 store。
 * 它与正常路径的 `app:getVersion` / `app:close` 不重复注册 —— 那两个 handler
 * 现在无论存储是否可用都会由主流程注册，二次注册会让 ipcMain.handle 直接抛错。
 */
function registerStoreRetryHandler(mainWindow: RendererSink | null): void {
  registerMainHandler(IpcChannels.STORE_RETRY_INIT, async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await storeManager.initialize()
      if (!storeManager.hasInitializationError()) {
        getHost().push(IpcChannels.STORE_INIT_ERROR, { message: null })
        return { success: true }
      }
      return { 
        success: false, 
        error: storeManager.getInitializationError()?.message || 'Unknown error' 
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to initialize storage' 
      }
    }
  })
}
