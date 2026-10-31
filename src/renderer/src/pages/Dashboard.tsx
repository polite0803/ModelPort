import { useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Activity, CheckCircle, Clock, Users, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  StatsCard,
  ProviderStatusCard,
  RequestChart,
  QuickActions,
  RecentActivity,
  TokenUsageCard,
} from '@/components/dashboard'
import { PageHeader } from '@/components/layout/PageHeader'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    proxyStatus,
    stats,
    providers,
    providerWindow,
    activities,
    chartData,
    tokenUsage,
    isLoading,
    error,
    lastUpdated,
    refreshData,
    setProviderWindow,
  } = useDashboardStore()
  const { setProxyEnabled } = useSettingsStore()
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      refreshData()
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      useDashboardStore.getState().refreshData()
    }, 60000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (proxyStatus) {
      setProxyEnabled(proxyStatus.isRunning)
    }
  }, [proxyStatus, setProxyEnabled])

  useEffect(() => {
    if (!window.electronAPI?.proxy?.onStatusChanged) return

    const unsubscribe = window.electronAPI.proxy.onStatusChanged((status) => {
      useDashboardStore.getState().setProxyStatus(status)
      setProxyEnabled(status.isRunning)
    })

    return unsubscribe
  }, [setProxyEnabled])

  const handleAddAccount = useCallback(() => {
    navigate('/providers')
  }, [navigate])

  const handleToolCalling = useCallback(() => {
    navigate('/models?tab=tool-calling')
  }, [navigate])

  const handleViewLogs = useCallback(() => {
    navigate('/logs')
  }, [navigate])

  const handleOpenProxy = useCallback(() => {
    navigate('/proxy')
  }, [navigate])

  const handleActivityClick = useCallback((item: { id: string; type: string; title: string }) => {
    navigate('/logs?highlight=' + item.id)
  }, [navigate])

  const isElectron = !!window.electronAPI

  return (
    <div>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        actions={
          <>
            {lastUpdated && (
              <span className="text-meta text-[var(--text-dim)]">
                {t('dashboard.lastUpdated')}: {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={refreshData} disabled={isLoading}>
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              {t('dashboard.refresh')}
            </Button>
          </>
        }
      />

      {!isElectron && (
        <div className="alert-warning mb-4 px-4 py-3 text-body">
          <p className="font-medium">{t('dashboard.browserMode')}</p>
          <p className="mt-0.5 text-[var(--text-muted)]">{t('dashboard.browserModeDesc')}</p>
        </div>
      )}

      {error && (
        <div className="alert-error mb-4 flex items-start gap-2 px-4 py-3 text-body">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title={t('dashboard.totalRequests')}
          value={stats.totalRequests.toLocaleString()}
          icon={Activity}
          trend={{
            value: stats.requestsTrend,
            label: t('dashboard.vsYesterday'),
          }}
        />
        <StatsCard
          title={t('dashboard.successRate')}
          value={`${stats.successRate}%`}
          icon={CheckCircle}
          trend={{
            value: stats.successRateTrend,
            label: t('dashboard.vsYesterday'),
          }}
        />
        <StatsCard
          title={t('dashboard.avgResponseTime')}
          value={`${stats.avgLatency}ms`}
          icon={Clock}
          trendPolarity="negative"
          trend={{
            value: stats.latencyTrend,
            label: t('dashboard.vsYesterday'),
          }}
        />
      </div>
      {/*
        One column of the grid the stats row above already uses, plus the two
        that are left: the card edges of both rows line up, and neither card is
        a narrow strip next to a stretched one.
      */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="cursor-pointer" onClick={handleAddAccount}>
          <StatsCard
            className="flex h-full flex-col justify-center"
            title={t('dashboard.activeAccountCount')}
            value={stats.activeAccounts}
            icon={Users}
            trend={{
              value: stats.accountsTrend,
              label: t('dashboard.vsYesterday'),
            }}
          />
        </div>
        <div className="lg:col-span-2">
          <TokenUsageCard className="h-full" usage={tokenUsage} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RequestChart data={chartData} />
        </div>
        <div>
          <QuickActions
            onAddAccount={handleAddAccount}
            onToolCalling={handleToolCalling}
            onViewLogs={handleViewLogs}
            onOpenProxy={handleOpenProxy}
          />
        </div>
      </div>

      <div className="mt-4 grid items-stretch gap-4 lg:grid-cols-2">
        <ProviderStatusCard
          providers={providers}
          statsWindow={providerWindow}
          onWindowChange={setProviderWindow}
        />
        <RecentActivity activities={activities} onItemClick={handleActivityClick} />
      </div>
    </div>
  )
}
