import axios, { AxiosError } from 'axios'
import { getBuiltinProvider } from './builtin/index.ts'
import { channelRuntimeState } from './accountChannels/runtimeState.ts'
import type { Provider, ProviderCheckResult, ProviderStatus, Account } from '../../shared/types'
import type { BuiltinProviderConfig } from '../store/types'

const CHECK_TIMEOUT = 15000

/**
 * 巡检结果的进程内缓存 TTL = 5 分钟。
 *
 * 为什么要这张表（实测，2026-11 运行实例）：Dashboard 每 60s 调一次
 * `PROVIDERS_CHECK_ALL_STATUS`，本机 23 个 provider ⇒ **每分钟 23 次
 * `store.set('providers')`**（`data.json` 是 electron-store 加密模式、940KB，一次
 * set = 整份序列化 + 加密 + 原子重命名落盘）+ 约 10 次真上游 `GET /models`
 * （aggregate/custom 那一支，`CHECK_TIMEOUT` 15s）。一天因此写了 **3829 行
 * `Update provider:` info 日志**，并有 1130 条 `slowRequest`（>1500ms）告警与这 23
 * 连发全量写盘同时段集中。
 *
 * 供应商健康是「分钟级够用」的巡检指标，不是实时量：一次 15s 超时的探测本来就谈不上
 * 新鲜度，而状态真的翻转时下游的 failover 会在请求路径上立刻体现（`autoRouter` 读的是
 * 账号与路由事实，不是这个快照）。取 5 分钟把上游探测压到每 provider 每 5 分钟 1 次，
 * 落盘则由「只在翻转时写」那道门（`ProviderManager.persistStatusSnapshot`）接住。
 */
export const PROVIDER_STATUS_CACHE_TTL_MS = 5 * 60 * 1000

export interface ProviderStatusCheckOptions {
  /** 绕过 TTL 重新探测（手动刷新那一支）。在途去重仍然生效。 */
  force?: boolean
  /**
   * 注入时钟（epoch ms）。缓存的 `checkedAt` 与 TTL 比较都用它，测试才能把「5 分钟后
   * 过期」这条真实路径钉住而不必等 5 分钟；生产调用不传，等价于 `Date.now()`。
   */
  now?: number
}

interface CachedStatusCheck {
  /** 冻结后入库：缓存被多个调用方共享，谁都不该改到别人的那份。 */
  result: Readonly<ProviderCheckResult>
  checkedAt: number
}

/**
 * 缓存键 = `id` + 这条记录**决定探测结果的那几个字段**（`apiEndpoint` 与 `headers`）。
 *
 * 为什么不能只用 `id`：改端点/换 Key 这件事走的是 `storeManager.updateProvider`
 * （`providers/custom.ts`、`providers/aggregate/manager.ts` 的 Key 轮换都直接写库，
 * 不经过 `ProviderManager`），巡检缓存无权拦截那条通路。把会改变上游目标的字段放进键里，
 * 一次编辑就自然是一次缓存未命中 —— 下一轮巡检立刻重探，不必再等 TTL。
 * 键只活在这个模块内存里，从不进日志/错误体（`headers` 带凭据）。
 */
function statusCacheKey(provider: Provider): string {
  return `${provider.id}\u0000${provider.apiEndpoint ?? ''}\u0000${JSON.stringify(provider.headers ?? {})}`
}

const statusCheckCache = new Map<string, CachedStatusCheck>()
const inFlightStatusChecks = new Map<string, Promise<ProviderCheckResult>>()

/**
 * 清空巡检缓存（测试隔离 + 「手动刷新全部」用）。
 *
 * 在途的那几次探测**不**取消：它们跑完照样入表，而表的写入时刻是完成时刻，所以清完
 * 之后落进来的那份只会更新、不会更旧。
 */
export function clearProviderStatusCache(): void {
  statusCheckCache.clear()
}

export interface TokenCheckResult {
  valid: boolean
  error?: string
  userInfo?: {
    name?: string
    email?: string
    quota?: number
    used?: number
  }
}

export class ProviderChecker {
  /**
   * 单个 provider 的健康检查：先查缓存表，其次复用同一 provider 的在途 Promise，
   * 最后才真发一次上游探测。
   */
  static async checkProviderStatus(
    provider: Provider,
    options: ProviderStatusCheckOptions = {},
  ): Promise<ProviderCheckResult> {
    const now = options.now ?? Date.now()

    // 账号渠道**不进缓存表**：`probeAccount` 读的是进程内的
    // `channelRuntimeState.running`，一次都不发网络请求（`CHECK_TIMEOUT` 不参与），
    // 缓存它省不下任何 IO，只会让「Worker 刚起/刚挂」这件事在 UI 上晚 5 分钟才看见。
    // 省写盘交给落盘那道门，不是交给这张表。
    if (provider.type === 'account') {
      return this.probeAccount(provider)
    }

    const cacheKey = statusCacheKey(provider)

    if (!options.force) {
      const cached = statusCheckCache.get(cacheKey)
      if (cached && now - cached.checkedAt < PROVIDER_STATUS_CACHE_TTL_MS) {
        return { ...cached.result }
      }
    }

    // 在途去重：同一次 `Promise.all` 之外（巡检与手动刷新撞上、两轮巡检重叠）也不该
    // 对同一个上游发两次 GET。
    const inFlight = inFlightStatusChecks.get(cacheKey)
    if (inFlight) {
      return { ...(await inFlight) }
    }

    const pending = this.probe(provider)
      .then((result) => {
        const frozen = Object.freeze(result)
        // 同一 provider 只保留当前这条端点/凭据组合的那一份：换过端点的旧键不留僵尸条目。
        for (const staleKey of statusCheckCache.keys()) {
          if (staleKey !== cacheKey && staleKey.startsWith(`${provider.id}\u0000`)) {
            statusCheckCache.delete(staleKey)
          }
        }
        statusCheckCache.set(cacheKey, { result: frozen, checkedAt: now })
        return frozen
      })
      .finally(() => {
        if (inFlightStatusChecks.get(cacheKey) === pending) {
          inFlightStatusChecks.delete(cacheKey)
        }
      })

    inFlightStatusChecks.set(cacheKey, pending)

    return { ...(await pending) }
  }

  /**
   * 一次真探测（不经缓存）。原 `checkProviderStatus` 的主体，行为与状态判据一字未改：
   * 内置走 `<apiEndpoint>/health`，账号渠道读运行时标志，其余 GET `<apiEndpoint>/models`。
   */
  private static async probe(provider: Provider): Promise<ProviderCheckResult> {
    const startTime = Date.now()

    try {
      const builtinConfig = provider.type === 'builtin'
        ? getBuiltinProvider(provider.id)
        : null

      if (builtinConfig) {
        return await this.checkBuiltinProvider(builtinConfig)
      }

      // 账号渠道同样没有可探的 HTTP 端点（apiEndpoint 是 `channel://` 占位），
      // 拿它发请求只会得到 axios 的「Unsupported protocol channel:」。这里只报
      // Worker 是否已经在跑，绝不因为一次状态检查去拉起它。
      if (provider.type === 'account') {
        return this.probeAccount(provider)
      }

      return await this.checkCustomProvider(provider)
    } catch (error) {
      return {
        providerId: provider.id,
        status: 'offline',
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private static probeAccount(provider: Provider): ProviderCheckResult {
    const running = channelRuntimeState.running
    return {
      providerId: provider.id,
      status: running ? 'online' : 'unknown',
      latency: 0,
      reason: running ? 'channel_runtime_running' : 'channel_runtime_stopped',
    }
  }

  private static async checkBuiltinProvider(config: BuiltinProviderConfig): Promise<ProviderCheckResult> {
    const startTime = Date.now()
    
    try {
      const checkUrl = `${config.apiEndpoint.replace('/api', '')}${config.tokenCheckEndpoint || '/health'}`
      
      const response = await axios({
        method: 'GET',
        url: checkUrl,
        timeout: CHECK_TIMEOUT,
        validateStatus: () => true,
      })
      
      const latency = Date.now() - startTime
      
      if (response.status >= 200 && response.status < 500) {
        return {
          providerId: config.id,
          status: 'online',
          latency,
        }
      }
      
      return {
        providerId: config.id,
        status: 'offline',
        latency,
        error: `HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        providerId: config.id,
        status: 'offline',
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  }

  private static async checkCustomProvider(provider: Provider): Promise<ProviderCheckResult> {
    const startTime = Date.now()
    
    try {
      const response = await axios({
        method: 'GET',
        url: `${provider.apiEndpoint}/models`,
        headers: provider.headers,
        timeout: CHECK_TIMEOUT,
        validateStatus: () => true,
      })
      
      const latency = Date.now() - startTime
      
      if (response.status >= 200 && response.status < 500) {
        return {
          providerId: provider.id,
          status: 'online',
          latency,
        }
      }
      
      return {
        providerId: provider.id,
        status: 'offline',
        latency,
        error: `HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        providerId: provider.id,
        status: 'offline',
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  }

  static async checkAccountToken(
    provider: Provider,
    account: Account
  ): Promise<TokenCheckResult> {
    const builtinConfig = provider.type === 'builtin' 
      ? getBuiltinProvider(provider.id) 
      : null
    
    if (!builtinConfig) {
      return this.checkCustomAccountToken(provider, account)
    }
    
    if (!builtinConfig.tokenCheckEndpoint) {
      return { valid: true }
    }
    return this.checkGenericToken(builtinConfig, account)
  }

  private static async checkGenericToken(
    config: BuiltinProviderConfig,
    account: Account
  ): Promise<TokenCheckResult> {
    try {
      const headers: Record<string, string> = {
        ...config.headers,
      }
      
      const credentials = account.credentials
      if (credentials.token) {
        headers['Authorization'] = `Bearer ${credentials.token}`
      } else if (credentials.apiKey) {
        headers['Authorization'] = `Bearer ${credentials.apiKey}`
      }
      
      const response = await axios({
        method: config.tokenCheckMethod || 'GET',
        url: `${config.apiEndpoint.replace('/api', '')}${config.tokenCheckEndpoint}`,
        headers,
        timeout: CHECK_TIMEOUT,
        validateStatus: () => true,
      })
      
      if (response.status >= 200 && response.status < 300) {
        return { valid: true }
      }
      
      if (response.status === 401) {
        return { valid: false, error: 'Authentication failed, please check credentials' }
      }
      
      return { valid: false, error: `Validation failed: HTTP ${response.status}` }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof AxiosError 
          ? error.message 
          : 'Connection failed',
      }
    }
  }

  private static async checkCustomAccountToken(
    provider: Provider,
    account: Account
  ): Promise<TokenCheckResult> {
    try {
      const headers: Record<string, string> = {
        ...provider.headers,
      }
      
      const credentials = account.credentials
      if (credentials.token) {
        headers['Authorization'] = `Bearer ${credentials.token}`
      } else if (credentials.apiKey) {
        headers['Authorization'] = `Bearer ${credentials.apiKey}`
      }
      
      const response = await axios({
        method: 'GET',
        url: `${provider.apiEndpoint}/models`,
        headers,
        timeout: CHECK_TIMEOUT,
        validateStatus: () => true,
      })
      
      if (response.status >= 200 && response.status < 300) {
        return { valid: true }
      }
      
      if (response.status === 401) {
        return { valid: false, error: 'Authentication failed, please check credentials' }
      }
      
      return { valid: false, error: `Validation failed: HTTP ${response.status}` }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof AxiosError 
          ? error.message 
          : 'Connection failed',
      }
    }
  }

}

/**
 * 一轮全量巡检：并发检查每个 provider，把结果交给 `persistStatus` 决定要不要落盘，
 * 返回 `{ providerId → 结果 }`（IPC 的那份载荷）。
 *
 * 落盘动作**不在这个函数里**，也不是「每个 provider 写一次」：生产接线传的是
 * `ProviderManager.persistStatusSnapshot`，它只在 `status` 真的翻转时写。于是
 * 「23 个 provider × 每分钟一轮」的稳态成本是 0 次全量写盘 + 每 provider 每 5 分钟
 * 一次上游探测（见 `PROVIDER_STATUS_CACHE_TTL_MS` 的理由）。
 */
export async function checkAllProviderStatuses(
  providers: readonly Provider[],
  persistStatus: (providerId: string, status: ProviderStatus, checkedAt: number) => unknown,
  options: { now?: number } = {},
): Promise<Record<string, ProviderCheckResult>> {
  const now = options.now ?? Date.now()

  const settled = await Promise.all(
    providers.map(async (provider) => {
      const result = await ProviderChecker.checkProviderStatus(provider, { now })
      persistStatus(provider.id, result.status, now)
      return [provider.id, result] as const
    }),
  )

  return Object.fromEntries(settled)
}

export default ProviderChecker
