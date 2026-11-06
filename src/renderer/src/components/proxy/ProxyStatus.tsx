import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useProxyStore } from '@/stores/proxyStore'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  Activity,
  Play,
  Square,
  RefreshCw,
  CheckCircle2,
  XCircle,
  BarChart3,
  Timer,
  TrendingUp,
  Cpu,
  Server,
} from 'lucide-react'

interface ProxyStatusProps {
  onStatusChange?: () => void
}

export function ProxyStatus({ onStatusChange }: ProxyStatusProps) {
  const { t } = useTranslation()
  const {
    proxyStatus,
    proxyStatistics,
    fetchProxyStatus,
    fetchProxyStatistics,
    startProxy,
    stopProxy,
    isLoading,
  } = useProxyStore()
  const { toast } = useToast()

  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    fetchProxyStatus()
    fetchProxyStatistics()

    const statusInterval = setInterval(() => {
      // 窗口不可见（收进托盘、切走）时不打扰主进程：这份状态没人看，而托盘与主界面各自
      // 挂载就是两份同频轮询。回到前台立刻补一次，不留下「看着像停了」的空窗。
      if (document.visibilityState !== 'visible') return
      fetchProxyStatus()
      fetchProxyStatistics()
      // 5s 一次 × 两个调用 = 24 RPC/分钟，单独就吃掉旧管理面限额的四成；
      // 15s 仍是「状态看起来是活的」的粒度，靠可见性补刷保证回前台不空虚。
    }, 15_000)

    const refreshWhenVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      fetchProxyStatus()
      fetchProxyStatistics()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      clearInterval(statusInterval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [fetchProxyStatus, fetchProxyStatistics])

  const handleStart = async () => {
    const success = await startProxy()
    if (success) {
      toast({
        title: t('common.success'),
        description: t('dashboard.proxyRunning'),
      })
      onStatusChange?.()
    } else {
      toast({
        title: t('common.error'),
        description: t('dashboard.proxyStopped'),
        variant: 'destructive',
      })
    }
  }

  const handleStop = async () => {
    const success = await stopProxy()
    if (success) {
      toast({
        title: t('common.success'),
        description: t('dashboard.proxyStopped'),
      })
      onStatusChange?.()
    } else {
      toast({
        title: t('common.error'),
        description: 'Unable to stop proxy service',
        variant: 'destructive',
      })
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([fetchProxyStatus(), fetchProxyStatistics()])
    setIsRefreshing(false)
  }

  const formatUptime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  const formatLatency = (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const getSuccessRate = (): number => {
    const total = proxyStatistics?.totalRequests ?? 0
    const success = proxyStatistics?.successRequests ?? 0
    if (total === 0) return 0
    return Math.round((success / total) * 100)
  }

  const isRunning = proxyStatus?.isRunning ?? false
  const port = proxyStatus?.port ?? '-'
  const host = proxyStatus?.host ?? '127.0.0.1'

  const stats = [
    {
      title: t('dashboard.totalRequests'),
      value: proxyStatistics?.totalRequests ?? 0,
      icon: TrendingUp,
    },
    {
      title: t('common.success'),
      value: proxyStatistics?.successRequests ?? 0,
      icon: CheckCircle2,
    },
    {
      title: t('common.error'),
      value: proxyStatistics?.failedRequests ?? 0,
      icon: XCircle,
    },
    {
      title: t('dashboard.successRate'),
      value: `${getSuccessRate()}%`,
      icon: Activity,
    },
    {
      title: t('dashboard.avgLatency'),
      value: formatLatency(proxyStatistics?.avgLatency ?? 0),
      icon: Timer,
    },
  ]

  const metrics = [
    { label: t('dashboard.port'), value: port },
    {
      label: t('dashboard.runtime'),
      value: isRunning && proxyStatus?.uptime ? formatUptime(proxyStatus.uptime) : '-',
    },
    { label: t('dashboard.totalRequests'), value: proxyStatistics?.totalRequests ?? 0 },
  ]

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'status-dot h-2.5 w-2.5',
                isRunning ? 'status-dot-online' : 'bg-[var(--text-dim)]'
              )}
            />
            <div>
              <p className="text-subtitle font-semibold leading-tight">
                {isRunning ? t('dashboard.running') : t('dashboard.stopped')}
              </p>
              <p className="mt-0.5 font-mono text-meta text-[var(--text-muted)]">
                {host}:{port}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title={t('common.refresh')}
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            </Button>
            {!isRunning ? (
              <Button onClick={handleStart} disabled={isLoading}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                {t('dashboard.startProxy')}
              </Button>
            ) : (
              <Button variant="secondary" onClick={handleStop} disabled={isLoading}>
                <Square className="mr-1.5 h-3 w-3" />
                {t('dashboard.stopProxy')}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="stat-tile">
              <p className="text-caption text-[var(--text-dim)]">{metric.label}</p>
              <p className="mt-1 text-metric">{metric.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-[15px] w-[15px] text-[var(--text-muted)]" />
          <h3 className="card-heading">
            {t('proxy.statistics')}
          </h3>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {stats.map((stat) => (
            <div key={stat.title} className="stat-tile">
              <div className="flex items-center gap-1.5 text-caption text-[var(--text-muted)]">
                <stat.icon className="h-3.5 w-3.5" />
                <span className="truncate">{stat.title}</span>
              </div>
              <p className="mt-1 text-metric">{stat.value}</p>
            </div>
          ))}
        </div>

        {(proxyStatistics?.modelUsage && Object.keys(proxyStatistics.modelUsage).length > 0) ||
        (proxyStatistics?.providerUsage && Object.keys(proxyStatistics.providerUsage).length > 0) ? (
          <div className="mt-5 grid gap-6 border-t border-[var(--glass-border)] pt-5 md:grid-cols-2">
            {proxyStatistics?.modelUsage && Object.keys(proxyStatistics.modelUsage).length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Cpu className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  <h4 className="text-body font-medium">{t('providers.modelUsage')}</h4>
                </div>
                <div className="space-y-1">
                  {(Object.entries(proxyStatistics.modelUsage) as [string, number][])
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 5)
                    .map(([model, count]) => {
                      const total = Object.values(proxyStatistics.modelUsage).reduce((a, b) => a + b, 0)
                      const percentage = Math.round((count / total) * 100)
                      return (
                        <div
                          key={model}
                          className="flex items-center justify-between gap-2 py-1.5 text-meta"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]" />
                            <span className="truncate font-mono" title={model}>
                              {model}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 tabular-nums">
                            <span className="font-medium">{count}</span>
                            <span className="w-8 text-right text-[var(--text-dim)]">{percentage}%</span>
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}

            {proxyStatistics?.providerUsage && Object.keys(proxyStatistics.providerUsage).length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  <h4 className="text-body font-medium">{t('providers.providerDistribution')}</h4>
                </div>
                <div className="space-y-1">
                  {(Object.entries(proxyStatistics.providerUsage) as [string, number][])
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 5)
                    .map(([providerId, count]) => {
                      const total = Object.values(proxyStatistics.providerUsage).reduce((a, b) => a + b, 0)
                      const percentage = Math.round((count / total) * 100)
                      return (
                        <div
                          key={providerId}
                          className="flex items-center justify-between gap-2 py-1.5 text-meta"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]" />
                            <span className="truncate" title={providerId}>
                              {providerId}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 tabular-nums">
                            <span className="font-medium">{count}</span>
                            <span className="w-8 text-right text-[var(--text-dim)]">{percentage}%</span>
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  )
}

export default ProxyStatus
