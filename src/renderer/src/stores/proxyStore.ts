import { create } from 'zustand'
import { localDayKey } from '@shared/localDay'
import type { ProxyStatus, ProxyStatistics, LoadBalanceStrategy, ModelMapping, AppConfig } from '@/types/electron'

export interface ProxyConfig {
  port: number
  host: string
  httpsEnabled: boolean
  httpsPort: number
  httpsCertPath?: string
  httpsKeyPath?: string
  /** Extra IPs/hostnames the managed certificate must carry. */
  httpsSanHosts: string[]
  timeout: number
  retryCount: number
  /** Absent = 代理内置默认（anthropic wire 必填的 max_tokens 兜底） */
  defaultMaxOutputTokens?: number
  maxConnections: number
}

export interface AccountWeight {
  accountId: string
  weight: number
}

interface ProxyState {
  proxyStatus: ProxyStatus | null
  proxyStatistics: ProxyStatistics | null
  proxyConfig: ProxyConfig
  loadBalanceStrategy: LoadBalanceStrategy
  accountWeights: AccountWeight[]
  modelMappings: ModelMapping[]
  appConfig: AppConfig | null
  isLoading: boolean
  error: string | null

  setProxyStatus: (status: ProxyStatus | null) => void
  setProxyStatistics: (statistics: ProxyStatistics | null) => void
  setProxyConfig: (config: Partial<ProxyConfig>) => void
  setLoadBalanceStrategy: (strategy: LoadBalanceStrategy) => void
  setAccountWeights: (weights: AccountWeight[]) => void
  updateAccountWeight: (accountId: string, weight: number) => void
  setModelMappings: (mappings: ModelMapping[]) => void
  setAppConfig: (config: AppConfig | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  resetProxyConfig: () => void
  fetchProxyStatus: () => Promise<void>
  fetchProxyStatistics: () => Promise<void>
  fetchAppConfig: () => Promise<void>
  saveAppConfig: (config: Partial<AppConfig>) => Promise<boolean>
  startProxy: (port?: number) => Promise<boolean>
  stopProxy: () => Promise<boolean>
}

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  port: 8080,
  host: '127.0.0.1',
  httpsEnabled: false,
  httpsPort: 8443,
  httpsSanHosts: [],
  timeout: 60000,
  retryCount: 3,
  maxConnections: 100,
}

/**
 * The persisted AppConfig is the only source of truth for the listener form.
 * Both the initial fetch and CONFIG_CHANGED broadcasts go through this mapping,
 * so one window changing the host/HTTPS settings cannot leave the other
 * window's form (or its rollback snapshot) on defaults/stale values.
 */
function proxyConfigFromAppConfig(config: AppConfig): ProxyConfig {
  return {
    ...DEFAULT_PROXY_CONFIG,
    port: config.proxyPort,
    host: config.proxyHost || '127.0.0.1',
    httpsEnabled: config.httpsEnabled ?? false,
    httpsPort: config.httpsPort ?? 8443,
    httpsSanHosts: config.httpsSanHosts ?? [],
    httpsCertPath: config.httpsCertPath,
    httpsKeyPath: config.httpsKeyPath,
    timeout: config.requestTimeout,
    retryCount: config.retryCount,
    defaultMaxOutputTokens: config.defaultMaxOutputTokens,
  }
}

const DEFAULT_STATISTICS: ProxyStatistics = {
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  avgLatency: 0,
  requestsPerMinute: 0,
  activeConnections: 0,
  modelUsage: {},
  providerUsage: {},
  accountUsage: {},
}

export const useProxyStore = create<ProxyState>((set, get) => ({
  proxyStatus: null,
  proxyStatistics: null,
  proxyConfig: DEFAULT_PROXY_CONFIG,
  loadBalanceStrategy: 'round-robin',
  accountWeights: [],
  modelMappings: [],
  appConfig: null,
  isLoading: false,
  error: null,

  setProxyStatus: (status) => set({ proxyStatus: status }),

  setProxyStatistics: (statistics) => set({ proxyStatistics: statistics }),

  setProxyConfig: (config) => set((state) => ({
    proxyConfig: { ...state.proxyConfig, ...config },
  })),

  setLoadBalanceStrategy: (strategy) => set({ loadBalanceStrategy: strategy }),

  setAccountWeights: (weights) => set({ accountWeights: weights }),

  updateAccountWeight: (accountId, weight) => set((state) => {
    const weights = [...state.accountWeights]
    const index = weights.findIndex(w => w.accountId === accountId)
    if (index >= 0) {
      weights[index] = { accountId, weight }
    } else {
      weights.push({ accountId, weight })
    }
    return { accountWeights: weights }
  }),

  setModelMappings: (mappings) => set({ modelMappings: mappings }),

  setAppConfig: (config) => set({ appConfig: config }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  resetProxyConfig: () => set({ proxyConfig: DEFAULT_PROXY_CONFIG }),

  fetchProxyStatus: async () => {
    if (!window.electronAPI?.proxy?.getStatus) return
    try {
      const status = await window.electronAPI.proxy.getStatus()
      set({ proxyStatus: status })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  fetchProxyStatistics: async () => {
    if (!window.electronAPI?.statistics?.get) {
      set({ proxyStatistics: DEFAULT_STATISTICS })
      return
    }
    try {
      const persistentStats = await window.electronAPI.statistics.get()
      const today = localDayKey(Date.now())
      const todayStats = persistentStats?.dailyStats?.[today] || {
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        totalLatency: 0,
        modelUsage: {},
        providerUsage: {},
      }
      
      const avgLatency = todayStats.successRequests > 0 
        ? Math.round(todayStats.totalLatency / todayStats.successRequests) 
        : 0
      
      const statistics: ProxyStatistics = {
        totalRequests: todayStats.totalRequests,
        successRequests: todayStats.successRequests,
        failedRequests: todayStats.failedRequests,
        avgLatency: avgLatency,
        requestsPerMinute: 0,
        activeConnections: 0,
        modelUsage: todayStats.modelUsage,
        providerUsage: todayStats.providerUsage,
        accountUsage: persistentStats?.accountUsage || {},
      }
      
      set({ proxyStatistics: statistics || DEFAULT_STATISTICS })
    } catch (error) {
      set({ proxyStatistics: DEFAULT_STATISTICS })
    }
  },

  fetchAppConfig: async () => {
    if (!window.electronAPI?.store?.get) return
    try {
      set({ isLoading: true })
      const config = await window.electronAPI.store.get<AppConfig>('config')
      if (config) {
        set({
          appConfig: config,
          loadBalanceStrategy: config.loadBalanceStrategy,
          modelMappings: Object.values(config.modelMappings || {}),
          proxyConfig: proxyConfigFromAppConfig(config),
        })
      }
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },

  saveAppConfig: async (config) => {
    if (!window.electronAPI?.config?.update) return false
    try {
      set({ isLoading: true, error: null })
      // 按字段提交：主进程的 `storeManager.updateConfig` 是唯一的合并与归一权威（它对
      // sessionConfig / requestLogConfig / autoRouting 做深合并）。
      // 之前这条路是「取渲染层缓存的整份镜像 → 整对象覆盖 → 经通用 `store:set` raw 写盘」，
      // 它绕过归一，还会把主进程运行期更新的字段顶回这份镜像的旧值。
      await window.electronAPI.config.update(config)
      set((state) => ({
        appConfig: state.appConfig ? { ...state.appConfig, ...config } : state.appConfig,
      }))
      return true
    } catch (error) {
      set({ error: (error as Error).message })
      return false
    } finally {
      set({ isLoading: false })
    }
  },

  startProxy: async (port) => {
    if (!window.electronAPI?.proxy?.start) return false
    try {
      set({ isLoading: true, error: null })
      const success = await window.electronAPI.proxy.start(port)
      if (success) {
        await get().fetchProxyStatus()
      }
      return success
    } catch (error) {
      set({ error: (error as Error).message })
      return false
    } finally {
      set({ isLoading: false })
    }
  },

  stopProxy: async () => {
    if (!window.electronAPI?.proxy?.stop) return false
    try {
      set({ isLoading: true, error: null })
      const success = await window.electronAPI.proxy.stop()
      if (success) {
        await get().fetchProxyStatus()
      }
      return success
    } catch (error) {
      set({ error: (error as Error).message })
      return false
    } finally {
      set({ isLoading: false })
    }
  },
}))

// CONFIG_CHANGED → 保持 `appConfig` 这份镜像新鲜。
// 没有这条订阅时 `fetchAppConfig` 只在页面挂载时跑一次（ProxySettings 的 hasLoadedRef
// 守卫），于是「开代理设置 → 新建路由（routes:create 落盘）→ 改别的设置 → 保存」会拿
// 挂载那一刻的整份镜像去写 `store:set('config')`。主进程的 `setConfig` 如今把 routes 键
// 收归专用通道（盘上现表说了算），本订阅再把其余字段也对齐盘上真值：陈旧镜像既删不掉
// 路由，也不会再把别的配置写回旧值。载荷是主进程归一后的完整 AppConfig，与盘上同形。
if (typeof window !== 'undefined') {
  window.electronAPI?.config?.onConfigChanged?.((config) => {
    useProxyStore.setState({
      appConfig: config,
      proxyConfig: proxyConfigFromAppConfig(config),
    })
  })
}

export default useProxyStore
