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
  ModelCacheCard,
} from '@/components/dashboard'
import { StatsWindowPresets, StatsWindowRangeInputs } from '@/components/dashboard/StatsWindowPicker'
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
    statsWindow,
    windowTotals,
    activities,
    chartData,
    tokenUsage,
    modelCacheStats,
    modelCacheCoverage,
    isLoading,
    error,
    connectionLost,
    lastUpdated,
    refreshData,
    setProviderWindow,
    setStatsWindow,
  } = useDashboardStore()
  const { setProxyEnabled } = useSettingsStore()
  const hasLoadedRef = useRef(false)

  /**
   * "vs yesterday" only holds for the today window; every other window compares
   * against the preceding period of the same length.
   */
  const trendLabel =
    statsWindow.kind === 'today'
      ? t('dashboard.vsYesterday')
      : t('dashboard.vsPreviousPeriod')

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

      {connectionLost && (
        <div className="alert-warning mb-4 flex items-start gap-2 px-4 py-3 text-body">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{t('dashboard.connectionLost')}</p>
            <p className="mt-0.5 text-[var(--text-muted)]">{t('dashboard.connectionLostDesc')}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="alert-error mb-4 flex items-start gap-2 px-4 py-3 text-body">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
          <span>{error}</span>
        </div>
      )}

      {/*
        The period is chosen once, above the numbers it applies to: the trend on
        each card compares against the period before this one, so "vs yesterday"
        would be wrong the moment another window is picked.
      */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-[var(--text-muted)]">{t('dashboard.statsWindow')}</span>
          <StatsWindowPresets value={statsWindow} onChange={setStatsWindow} />
        </div>
        <StatsWindowRangeInputs value={statsWindow} onChange={setStatsWindow} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title={t('dashboard.totalRequests')}
          value={windowTotals.requests === null ? '—' : windowTotals.requests.toLocaleString()}
          icon={Activity}
          trend={{
            value: stats.requestsTrend,
            label: trendLabel,
          }}
        />
        <StatsCard
          title={t('dashboard.successRate')}
          value={windowTotals.successRate === null ? '—' : `${windowTotals.successRate}%`}
          icon={CheckCircle}
          trend={{
            value: stats.successRateTrend,
            label: trendLabel,
          }}
        />
        <StatsCard
          title={t('dashboard.avgResponseTime')}
          value={windowTotals.avgLatencyMs === null ? '—' : `${windowTotals.avgLatencyMs}ms`}
          icon={Clock}
          trendPolarity="negative"
          trend={{
            value: stats.latencyTrend,
            label: trendLabel,
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

      <div className="mt-4">
        <ModelCacheCard
          stats={modelCacheStats}
          coverage={modelCacheCoverage}
          statsWindow={providerWindow}
          onWindowChange={setProviderWindow}
        />
      </div>
    </div>
  )
}
