import { useEffect, useState, useMemo } from 'react'
import { Power, Copy, Check, Play, Square, RotateCw, ExternalLink, Moon, Sun, Zap, Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProvidersStore } from '@/stores/providersStore'
import { localAccountCounts, mergeChannelCounts } from '@/lib/accountCounts'
import type { AccountCounts } from '@/lib/accountCounts'
import type { Provider, Account } from '@/types/electron'
import iconsPng from '@/assets/icons/icons.png'

interface ProviderInfo {
  id: string
  name: string
  accountCount: number
  activeCount: number
}

export function TrayView() {
  const { toggleTheme, isDark } = useTheme()
  const { language } = useSettingsStore()
  const { providers, accounts, setProviders, setAccounts, setIsLoading, isLoading } = useProvidersStore()

  const [proxyRunning, setProxyRunning] = useState(false)
  const [proxyLoading, setProxyLoading] = useState(false)
  const [port, setPort] = useState(8080)
  const [host, setHost] = useState('127.0.0.1')
  const [copied, setCopied] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  /**
   * 供应商卡片上的账号数。
   *
   * 渠道（`type: 'account'`）的真实账号在 Worker 池里，本地只有一条占位账号；
   * 照本地表算会永远显示 1，与账号渠道页上的真实数量对不上。
   */
  const [accountCounts, setAccountCounts] = useState<AccountCounts>({})

  useEffect(() => {
    const loadProxyStatus = async () => {
      const status = await window.electronAPI?.proxy?.getStatus?.()
      setProxyRunning(status.isRunning)
      
      const config = await window.electronAPI?.config?.get?.()
      if (config) {
        setPort(config.proxyPort || 8080)
        setHost(config.proxyHost || '127.0.0.1')
      }
    }
    
    loadProxyStatus()

    const unsubscribeProxy = window.electronAPI?.proxy?.onStatusChanged?.((status) => {
      setProxyRunning(status.isRunning)
      if (status.port) setPort(status.port)
    })

    const unsubscribeConfig = window.electronAPI?.config?.onConfigChanged?.((config) => {
      setPort(config.proxyPort || 8080)
      setHost(config.proxyHost || '127.0.0.1')
    })

    return () => {
      unsubscribeProxy?.()
      unsubscribeConfig?.()
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!selectedProvider && providers.length > 0) {
      const firstWithAccounts = providers.find((p) => {
        const count = accounts.filter((a) => a.providerId === p.id).length
        return count > 0
      })
      setSelectedProvider(firstWithAccounts?.id || providers[0]?.id || null)
    }
  }, [providers, accounts, selectedProvider])

  useEffect(() => {
    window.electronAPI?.tray?.setHeight?.(460)
  }, [])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [providersData, accountsData, config] = await Promise.all([
        window.electronAPI?.providers?.getAll?.() || [],
        window.electronAPI?.accounts?.getAll?.() || [],
        window.electronAPI?.config?.get?.(),
      ])
      setProviders(providersData)
      setAccounts(accountsData)
      if (config) {
        setPort(config.proxyPort || 8080)
        setHost(config.proxyHost || '127.0.0.1')
      }
      await loadAccountCounts(providersData, accountsData)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * 本地账号表 + 渠道池：渠道的真实账号在 Worker 里，本地表里那一条是占位账号。
   * 池子读不到（Worker 没启动 / 调用失败）时保留本地计数，不把已连接渠道显示成 0。
   */
  const loadAccountCounts = async (
    providersData: Provider[],
    accountsData: Account[],
  ) => {
    const local = localAccountCounts(providersData, accountsData)
    let pool: Record<string, { total: number; enabled: number }> = {}
    if (providersData.some(provider => provider.type === 'account')) {
      try {
        pool = await window.electronAPI.channels.accountCounts()
      } catch (error) {
        console.warn('Failed to read channel account counts:', error)
      }
    }
    setAccountCounts(mergeChannelCounts(local, providersData, pool))
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await loadData()
    setTimeout(() => setIsRefreshing(false), 1000)
  }

  const handleCopyUrl = async () => {
    const url = `http://${host}:${port}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleProxy = async () => {
    if (proxyLoading) return
    setProxyLoading(true)
    try {
      if (proxyRunning) {
        await window.electronAPI?.proxy?.stop?.()
        setProxyRunning(false)
      } else {
        await window.electronAPI?.proxy?.start?.()
        setProxyRunning(true)
      }
    } finally {
      setProxyLoading(false)
    }
  }

  const openDashboard = () => {
    window.electronAPI?.tray?.openDashboard?.()
  }

  const quitApp = () => {
    window.electronAPI?.tray?.quitApp?.()
  }

  const providerList: ProviderInfo[] = useMemo(() => {
    return providers.map((p) => {
      // 渠道计数取池子那份；其余供应商仍是本地账号表。
      const counts = accountCounts[p.id]
      if (counts !== undefined) {
        return { id: p.id, name: p.name, accountCount: counts.total, activeCount: counts.active }
      }
      const providerAccounts = accounts.filter((a) => a.providerId === p.id)
      return {
        id: p.id,
        name: p.name,
        accountCount: providerAccounts.length,
        activeCount: providerAccounts.filter((a) => a.status === 'active').length,
      }
    })
  }, [providers, accounts, accountCounts])

  const selectedProviderAccounts = useMemo(() => {
    if (!selectedProvider) return []
    return accounts.filter((a) => a.providerId === selectedProvider)
  }, [accounts, selectedProvider])

  const isZh = language === 'zh-CN'

  return (
    <div className="w-full h-[460px] flex flex-col select-none overflow-hidden bg-[var(--bg-primary)]">
      <div className="absolute top-0 left-0 right-0 h-6 drag-region z-50" />

      {/* Header */}
      <div
        className={cn(
          'flex-none relative overflow-hidden transition-colors',
          proxyRunning
            ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
        )}
      >
        <div className="relative px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-[var(--radius-card)] bg-[var(--bg-secondary)] border border-[var(--glass-border)] flex items-center justify-center shadow-[var(--shadow-sm)]">
              <img src={iconsPng} alt="ModelPort" className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-title tracking-tight">ModelPort</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                {proxyRunning ? <Wifi size={12} /> : <WifiOff size={12} />}
                <span className="text-meta font-medium opacity-90">
                  {proxyRunning ? (isZh ? '服务运行中' : 'Service Running') : (isZh ? '服务已停止' : 'Service Stopped')}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              className="p-2 rounded-[var(--radius-control)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-30"
            >
              <RotateCw size={15} className={cn((isLoading || isRefreshing) && 'animate-spin')} />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-[var(--radius-control)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </div>

      {/* Endpoint Card */}
      <section className="flex-none px-4 -mt-3 relative z-10 no-drag">
        <div className="bg-[var(--bg-secondary)] border border-[var(--glass-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-md)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap size={12} className="text-warning" />
                <span className="text-micro text-[var(--text-muted)] uppercase tracking-wider font-semibold">API Endpoint</span>
              </div>
              <button
                onClick={handleCopyUrl}
                className="flex items-center gap-1.5 group"
              >
                <code className="text-subtitle font-mono font-semibold text-[var(--text-primary)] truncate">
                  {host}:{port}
                </code>
                {copied ? (
                  <Check size={12} className="text-success flex-shrink-0" />
                ) : (
                  <Copy size={12} className="text-[var(--text-dim)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            </div>
            <button
              onClick={toggleProxy}
              disabled={proxyLoading}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-control)] font-semibold text-body transition-colors shadow-[var(--shadow-sm)]',
                proxyRunning
                  ? 'bg-[var(--error)] text-[var(--text-on-accent)] hover:bg-[var(--button-destructive-hover)]'
                  : 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] hover:bg-[var(--button-primary-hover)]'
              )}
            >
              {proxyRunning ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
              <span>{proxyRunning ? (isZh ? '停止' : 'Stop') : (isZh ? '启动' : 'Start')}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Provider Tabs */}
      {providerList.length > 0 && (
        <nav className="flex-none px-4 pt-3 pb-2 no-drag">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {providerList.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProvider(p.id)}
                className={cn(
                  'flex-shrink-0 px-3 py-1.5 rounded-full text-meta font-medium transition-colors',
                  selectedProvider === p.id
                    ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                    : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                )}
              >
                {p.name}
                <span className="ml-1 opacity-70">
                  {p.activeCount}/{p.accountCount}
                </span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Account List */}
      <main className="flex-1 min-h-0 px-4 overflow-y-auto no-drag">
        {isLoading && selectedProviderAccounts.length === 0 ? (
          <div className="py-10 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[var(--glass-border)] border-t-[var(--accent-primary)] rounded-full animate-spin" />
          </div>
        ) : selectedProviderAccounts.length === 0 ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center mx-auto mb-2">
              <WifiOff size={20} className="text-[var(--text-dim)]" />
            </div>
            <p className="text-meta text-[var(--text-muted)]">{isZh ? '暂无账户' : 'No accounts'}</p>
          </div>
        ) : (
          <div className="space-y-2 pb-3">
            {selectedProviderAccounts.map((account) => {
              const isActive = account.status === 'active'
              return (
                <div
                  key={account.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-[var(--radius-card)] border transition-colors',
                    isActive
                      ? 'bg-[var(--accent-soft)] border-[var(--accent-border)]'
                      : 'bg-[var(--surface)] border-[var(--glass-border)]'
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={cn(
                        'w-2.5 h-2.5 rounded-full flex-shrink-0',
                        isActive ? 'bg-[var(--success)]' : 'bg-[var(--text-dim)]'
                      )}
                    />
                    <span className="text-subtitle font-medium text-[var(--text-primary)] truncate">
                      {account.name || account.email || 'Unknown'}
                    </span>
                  </div>
                  <span className={cn('flex-shrink-0', isActive ? 'badge-success' : 'badge-soft')}>
                    {isActive ? (isZh ? '在线' : 'Active') : (isZh ? '离线' : 'Inactive')}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="flex-none p-4 border-t border-[var(--glass-border)] no-drag">
        <div className="flex gap-2">
          <button
            onClick={openDashboard}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[var(--radius-control)] bg-[var(--accent-primary)] hover:bg-[var(--button-primary-hover)] text-[var(--text-on-accent)] font-semibold text-body transition-colors shadow-[var(--shadow-sm)]"
          >
            <ExternalLink size={15} />
            <span>{isZh ? '打开主界面' : 'Open Dashboard'}</span>
          </button>
          <button
            onClick={quitApp}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[var(--radius-control)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-[var(--text-muted)] font-semibold text-body transition-colors border border-[var(--glass-border)]"
          >
            <Power size={15} />
            <span>{isZh ? '退出' : 'Quit'}</span>
          </button>
        </div>
      </footer>
    </div>
  )
}

export default TrayView
