import { create } from 'zustand'
import type { ProxyStatus, ProxyStatistics, Provider, Account, ProviderCheckResult, LogEntry, DayTokenSummary } from '@/types/electron'
import type { DailyTrendPoint } from '@shared/types'
import { localDayKey, recentLocalDays } from '@shared/localDay'
import { dailyTrendPoints, dayCountsOf, differenceInPoints, percentChange, successRateOf } from '@shared/trendMath'
import type { ProviderStats, ActivityItem, ChartDataPoint } from '@/components/dashboard'

interface DashboardStats {
  totalRequests: number
  successRate: number
  avgLatency: number
  activeAccounts: number
  /** `null` when the comparison cannot be computed - shown as "no comparison", never as 0%. */
  requestsTrend: number | null
  successRateTrend: number | null
  latencyTrend: number | null
  accountsTrend: number | null
}



interface DashboardState {
  proxyStatus: ProxyStatus | null
  statistics: ProxyStatistics | null
  stats: DashboardStats
  providers: ProviderStats[]
  activities: ActivityItem[]
  chartData: ChartDataPoint[]
  /** Today's token counters; null until the first fetch resolves. */
  tokenUsage: DayTokenSummary | null
  isLoading: boolean
  error: string | null
  lastUpdated: number | null

  setProxyStatus: (status: ProxyStatus | null) => void
  setStatistics: (statistics: ProxyStatistics | null) => void
  setTokenUsage: (usage: DayTokenSummary | null) => void
  setStats: (stats: Partial<DashboardStats>) => void
  setProviders: (providers: ProviderStats[]) => void
  setActivities: (activities: ActivityItem[]) => void
  addActivity: (activity: ActivityItem) => void
  setChartData: (data: ChartDataPoint[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  refreshData: () => Promise<void>
}

const convertLogsToActivities = (logs: LogEntry[], providers: Provider[]): ActivityItem[] => {
  return logs.slice(0, 10).map(log => {
    const provider = log.providerId ? providers.find(p => p.id === log.providerId) : undefined
    
    let type: ActivityItem['type'] = 'info'
    if (log.level === 'error') type = 'error'
    else if (log.level === 'warn') type = 'warning'
    else if (log.level === 'info' && log.message.includes('success')) type = 'success'
    
    return {
      id: log.id,
      type,
      title: log.message,
      description: log.data ? JSON.stringify(log.data).slice(0, 100) : undefined,
      timestamp: log.timestamp,
      providerName: provider?.name,
      modelName: log.data?.model as string | undefined,
    }
  })
}

interface DashboardRequestLog {
  id: string
  timestamp: number
  status: 'success' | 'error'
  statusCode: number
  model: string
  actualModel?: string
  providerId?: string
  providerName?: string
  accountId?: string
  accountName?: string
  modelName?: string
  latency: number
  userInput?: string
  errorMessage?: string
  client?: { id: string; label: string; version?: string }
}

const clientLabelOf = (client: DashboardRequestLog['client']): string | undefined => {
  if (!client?.label) return undefined
  return client.version ? `${client.label} ${client.version}` : client.label
}

const convertRequestLogsToActivities = (logs: DashboardRequestLog[]): ActivityItem[] => {
  return logs.slice(0, 10).map(log => {
    return {
      id: log.id,
      type: log.status === 'success' ? 'success' : 'error',
      title: log.model,
      description: log.status === 'error' ? log.errorMessage : log.userInput?.slice(0, 100),
      timestamp: log.timestamp,
      providerName: log.providerName,
      modelName: log.model,
      actualModel: log.actualModel,
      accountName: log.accountName,
      clientLabel: clientLabelOf(log.client),
      latency: log.latency,
      statusCode: log.statusCode,
    }
  })
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  proxyStatus: null,
  statistics: null,
  stats: {
    totalRequests: 0,
    successRate: 0,
    avgLatency: 0,
    activeAccounts: 0,
    requestsTrend: null,
    successRateTrend: null,
    latencyTrend: null,
    accountsTrend: null,
  },
  providers: [],
  activities: [],
  chartData: [],
  tokenUsage: null,
  isLoading: false,
  error: null,
  lastUpdated: null,

  setProxyStatus: (status) => set({ proxyStatus: status }),
  setStatistics: (statistics) => set({ statistics }),
  setTokenUsage: (tokenUsage) => set({ tokenUsage }),
  setStats: (stats) => set((state) => ({ stats: { ...state.stats, ...stats } })),
  setProviders: (providers) => set({ providers }),
  setActivities: (activities) => set({ activities }),
  addActivity: (activity) => set((state) => ({
    activities: [activity, ...state.activities].slice(0, 50),
  })),
  setChartData: (data) => set({ chartData: data }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  refreshData: async () => {
    const { setLoading, setError, setProxyStatus, setStatistics, setTokenUsage, setStats, setProviders, setActivities, setChartData } = get()
    
    setLoading(true)
    setError(null)

    try {
      const proxyStatusPromise = window.electronAPI?.proxy?.getStatus?.() ?? Promise.resolve(null)
      const statisticsPromise = window.electronAPI?.invoke?.('proxy:getStatistics') ?? Promise.resolve(null)
      const persistentStatsPromise = window.electronAPI?.statistics?.get?.() ?? Promise.resolve(null)
      const providersPromise = window.electronAPI?.providers?.getAll?.() ?? Promise.resolve([])
      const accountsPromise = window.electronAPI?.accounts?.getAll?.() ?? Promise.resolve([])
      const providerStatusPromise = window.electronAPI?.providers?.checkAllStatus?.() ?? Promise.resolve({})
      const logsPromise = window.electronAPI?.logs?.get?.({ limit: 10 }) ?? Promise.resolve([])
      // Token counters live in their own store key (bounded by days, not rows),
      // so they are fetched independently of the request-log window.
      const tokenUsagePromise = window.electronAPI?.statistics?.getTokenUsage?.() ?? Promise.resolve(null)

      const [proxyStatus, statistics, persistentStats, providers, accounts, providerStatuses, logs, tokenUsage] = await Promise.all([
        proxyStatusPromise,
        statisticsPromise,
        persistentStatsPromise,
        providersPromise,
        accountsPromise,
        providerStatusPromise,
        logsPromise,
        tokenUsagePromise,
      ]) as [ProxyStatus | null, ProxyStatistics | null, any, Provider[], Account[], Record<string, ProviderCheckResult>, LogEntry[], DayTokenSummary | null]

      // The trend is computed here, from the rollup the `statistics.get` payload
      // already carries. A second channel for the same numbers only added a way to
      // render "no data" when the running build did not have it yet.
      const dailyTrends: DailyTrendPoint[] = persistentStats?.dailyStats
        ? dailyTrendPoints(persistentStats.dailyStats, 7)
        : []

      setProxyStatus(proxyStatus)
      setStatistics(statistics)
      setTokenUsage(tokenUsage)

      const totalRequests = persistentStats?.totalRequests ?? statistics?.totalRequests ?? 0
      const successRequests = persistentStats?.successRequests ?? statistics?.successRequests ?? 0
      const successRate = totalRequests > 0
        ? Math.round((successRequests / totalRequests) * 100)
        : 0
      
      const today = localDayKey(Date.now())
      const todayStats = persistentStats?.dailyStats?.[today]
      const avgLatency = todayStats && todayStats.successRequests > 0
        ? Math.round(todayStats.totalLatency / todayStats.successRequests)
        : (successRequests > 0
          ? Math.round((persistentStats?.totalLatency ?? 0) / successRequests)
          : Math.round(statistics?.avgLatency ?? 0))
      
      const activeAccounts = accounts?.filter((a: Account) => a.status === 'active').length ?? 0

      const yesterday = recentLocalDays(2)[0].key

      const todayTrend = dailyTrends.find((point) => point.date === today)
      const yesterdayTrend = dailyTrends.find((point) => point.date === yesterday)

      const todayCounts = dayCountsOf(todayTrend)
      const yesterdayCounts = dayCountsOf(yesterdayTrend)
      
      const requestsTrend = percentChange(todayCounts.requests, yesterdayCounts.requests)
      const successRateTrend = differenceInPoints(successRateOf(todayCounts), successRateOf(yesterdayCounts))
      // A day with no successful request reports an average latency of 0, which means
      // "not measured", not "instant".
      const latencyTrend = percentChange(todayCounts.avgLatency || null, yesterdayCounts.avgLatency || null)

      setStats({
        totalRequests,
        successRate,
        avgLatency,
        activeAccounts,
        requestsTrend,
        successRateTrend,
        latencyTrend,
      })

      const providerUsage = persistentStats?.providerUsage ?? {}
      const requestLogsPromise = window.electronAPI?.requestLogs?.get?.({ limit: 100 }) ?? Promise.resolve([])
      const requestLogs = await requestLogsPromise as DashboardRequestLog[]
      
      const providerSuccessCount: Record<string, number> = {}
      const providerTotalCount: Record<string, number> = {}
      for (const log of requestLogs) {
        if (log.providerId) {
          providerTotalCount[log.providerId] = (providerTotalCount[log.providerId] || 0) + 1
          if (log.status === 'success') {
            providerSuccessCount[log.providerId] = (providerSuccessCount[log.providerId] || 0) + 1
          }
        }
      }
      
      const providerStats: ProviderStats[] = (providers ?? []).map((provider: Provider) => {
        const status = providerStatuses?.[provider.id]
        const usage = providerUsage[provider.id] ?? 0
        const successCount = providerSuccessCount[provider.id] ?? usage
        const totalCount = providerTotalCount[provider.id] ?? usage
        
        return {
          id: provider.id,
          name: provider.name,
          status: status?.status ?? provider.status ?? 'unknown',
          requestCount: totalCount,
          successCount: successCount,
          latency: status?.latency,
        }
      })
      setProviders(providerStats)

      const recentRequestLogs = requestLogs.slice(0, 10)
      if (recentRequestLogs && recentRequestLogs.length > 0) {
        setActivities(convertRequestLogsToActivities(recentRequestLogs))
      } else {
        setActivities(convertLogsToActivities(logs, providers ?? []))
      }
      
      setChartData(dailyTrends.map((point) => ({
        time: point.date.slice(5),
        requests: point.total,
        success: point.success,
        failed: point.error,
      })))

      set({ lastUpdated: Date.now() })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to fetch data')
      setStats({
        totalRequests: 0,
        successRate: 0,
        avgLatency: 0,
        activeAccounts: 0,
        requestsTrend: null,
        successRateTrend: null,
        latencyTrend: null,
        accountsTrend: null,
      })
      setActivities([])
      setChartData([])
    } finally {
      setLoading(false)
    }
  },
}))
