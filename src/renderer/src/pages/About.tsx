import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2,
  Globe,
  Download,
  CheckCircle2,
  AlertCircle,
  Github,
  Bug,
  Zap,
  RefreshCw,
} from 'lucide-react'
import logoIcon from '@/assets/icons/icons.png'
import type { ShellBridge, ShellUpdateCheck, ShellUpdateProgress } from '@shared/shellBridge'

type UpdatePhase = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

interface UpdateInfo {
  phase: UpdatePhase
  latestVersion: string | null
  error: string | null
}

interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export function About() {
  const { t } = useTranslation()
  const shellBridge = (window as unknown as { modelportShell?: ShellBridge }).modelportShell
  const isShell = typeof shellBridge?.checkForUpdates === 'function'
  const isRemotePage = (window as unknown as { __MODELPORT_REMOTE__?: boolean }).__MODELPORT_REMOTE__ === true
  const isDesktopApp = !isShell && !isRemotePage
  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    if (window.electronAPI?.app?.getVersion) {
      window.electronAPI.app.getVersion().then((v: string) => {
        if (v) setAppVersion(v)
      })
    }
  }, [])

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({ phase: 'idle', latestVersion: null, error: null })
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const displayAppVersion = appVersion || '...'

  const [shellVersion, setShellVersion] = useState('')
  const [shellCheck, setShellCheck] = useState<ShellUpdateCheck | null>(null)
  const [shellPhase, setShellPhase] = useState<'idle' | 'checking' | 'ready' | 'upgrading' | 'done' | 'error'>('idle')
  const [shellProgress, setShellProgress] = useState<ShellUpdateProgress | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)

  useEffect(() => {
    if (!isDesktopApp || !window.electronAPI?.app) return

    const unsubscribeChecking = window.electronAPI.app.onUpdateChecking(() => {
      setUpdateInfo((current) => ({
        ...current,
        phase: 'checking',
        error: null,
      }))
      setDownloadProgress(null)
    })

    const unsubscribeAvailable = window.electronAPI.app.onUpdateAvailable((info) => {
      setUpdateInfo({
        phase: 'available',
        latestVersion: info?.version || null,
        error: null,
      })
      setDownloadProgress(null)
    })

    const unsubscribeNotAvailable = window.electronAPI.app.onUpdateNotAvailable((info) => {
      setUpdateInfo({
        phase: 'not-available',
        latestVersion: info?.version || null,
        error: null,
      })
      setDownloadProgress(null)
    })

    const unsubscribeProgress = window.electronAPI.app.onUpdateProgress((progress: DownloadProgress) => {
      setDownloadProgress(progress)
      setUpdateInfo((current) => ({
        ...current,
        phase: 'downloading',
        error: null,
      }))
    })

    const unsubscribeDownloaded = window.electronAPI.app.onUpdateDownloaded((info) => {
      setUpdateInfo({
        phase: 'downloaded',
        latestVersion: info?.version || null,
        error: null,
      })
      setDownloadProgress(null)
    })

    const unsubscribeError = window.electronAPI.app.onUpdateError((error: any) => {
      setDownloadProgress(null)
      setUpdateInfo((current) => ({
        ...current,
        phase: 'error',
        error: typeof error === 'string' ? error : error?.message || 'Update failed',
      }))
    })

    return () => {
      unsubscribeChecking()
      unsubscribeAvailable()
      unsubscribeNotAvailable()
      unsubscribeProgress()
      unsubscribeDownloaded()
      unsubscribeError()
    }
  }, [isDesktopApp])

  useEffect(() => {
    if (!isShell || !shellBridge) return
    let cancelled = false
    void shellBridge.getVersion?.().then(version => {
      if (!cancelled) setShellVersion(version)
    }).catch(() => undefined)
    const unsubscribe = shellBridge.onUpdateProgress?.((progress) => {
      if (cancelled) return
      setShellProgress(progress)
      if (progress.stage === 'done') setShellPhase('done')
      if (progress.stage === 'error') {
        setShellPhase('error')
        setShellError(progress.message)
      }
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [isShell, shellBridge])

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  const formatSpeed = (bytesPerSecond: number): string => {
    return `${formatBytes(bytesPerSecond)}/s`
  }

  const getUpdateErrorMessage = (error: unknown, fallback: string): string => {
    if (typeof error === 'string') return error
    return error instanceof Error ? error.message : fallback
  }

  const handleShellCheck = async (): Promise<void> => {
    if (!shellBridge?.checkForUpdates) return
    setShellPhase('checking')
    setShellError(null)
    setShellProgress(null)
    try {
      const result = await shellBridge.checkForUpdates()
      setShellCheck(result)
      setShellPhase('ready')
    } catch (error) {
      setShellPhase('error')
      setShellError(getUpdateErrorMessage(error, t('about.upgradeFailed')))
    }
  }

  const handleShellUpgrade = async (): Promise<void> => {
    if (!shellBridge?.startUpgrade) return
    setShellPhase('upgrading')
    setShellError(null)
    setShellProgress(null)
    try {
      const result = await shellBridge.startUpgrade()
      if (!result.ok) {
        setShellPhase('error')
        setShellError(result.error ?? t('about.upgradeFailed'))
        return
      }
      if (!result.shellUpdated) {
        setShellPhase('done')
        setShellCheck(null)
      }
    } catch (error) {
      setShellPhase('error')
      setShellError(getUpdateErrorMessage(error, t('about.upgradeFailed')))
    }
  }

  const shellCanUpgrade = shellCheck !== null && (
    (shellCheck.shell.updateAvailable && shellCheck.shell.asset !== null)
    || (shellCheck.daemon.managed && shellCheck.daemon.updateAvailable && shellCheck.daemon.asset !== null)
  )
  // Only complain about a missing checksum when an update actually needs that asset;
  // an up-to-date install must not show a red "missing" note for the latest release.
  const shellNeedsMissing = shellCheck !== null && (
    (shellCheck.shell.updateAvailable && shellCheck.shell.asset === null)
    || (shellCheck.daemon.managed && shellCheck.daemon.updateAvailable && shellCheck.daemon.asset === null)
  )

  const handleCheckAppUpdate = async () => {
    setUpdateInfo((current) => ({
      ...current,
      phase: 'checking',
      error: null,
    }))
    setDownloadProgress(null)
    try {
      const status = await window.electronAPI.app.checkUpdate()
      setUpdateInfo({
        phase: status.error
          ? 'error'
          : status.checking
            ? 'checking'
            : status.downloaded
              ? 'downloaded'
              : status.downloading
                ? 'downloading'
                : status.available
                  ? 'available'
                  : 'not-available',
        latestVersion: status.version || null,
        error: status.error,
      })
    } catch (error) {
      setUpdateInfo((current) => ({
        ...current,
        phase: 'error',
        error: getUpdateErrorMessage(error, 'Update check failed'),
      }))
    }
  }

  const handleDownloadUpdate = async () => {
    try {
      setUpdateInfo((current) => ({
        ...current,
        phase: 'downloading',
        error: null,
      }))
      setDownloadProgress(null)
      await window.electronAPI.app.downloadUpdate()
    } catch (error) {
      setDownloadProgress(null)
      setUpdateInfo((current) => ({
        ...current,
        phase: 'error',
        error: getUpdateErrorMessage(error, 'Download failed'),
      }))
    }
  }

  const handleInstallUpdate = async () => {
    try {
      await window.electronAPI.app.installUpdate()
    } catch (error) {
      setUpdateInfo((current) => ({
        ...current,
        phase: 'error',
        error: getUpdateErrorMessage(error, 'Install failed'),
      }))
    }
  }

  const handleOpenExternal = (url: string) => {
    if (window.electronAPI?.app?.openExternal) {
      window.electronAPI.app.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  const links = [
    {
      label: t('about.github'),
      icon: Github,
      url: 'https://github.com/polite0803/ModelPort',
    },
    {
      label: t('about.releases'),
      icon: Download,
      url: 'https://github.com/polite0803/ModelPort/releases',
    },
    {
      label: t('about.reportIssue'),
      icon: Bug,
      url: 'https://github.com/polite0803/ModelPort/issues',
    },
  ]

  return (
    <div>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col items-center justify-center py-6 text-center relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-[var(--accent-primary)]/10 blur-[60px] rounded-full pointer-events-none" />

          <div className="relative mb-4 animate-scale-in">
            <div className="relative w-16 h-16 rounded-2xl glass-card p-2.5 overflow-hidden">
              <img
                src={logoIcon}
                alt="ModelPort Logo"
                className="w-full h-full object-contain drop-shadow-md"
              />
            </div>
          </div>

          <div className="space-y-2 z-10">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
              {t('settings.appName')}
            </h1>
            <p className="text-[var(--text-muted)] font-medium max-w-sm mx-auto">
              {t('about.tagline')}
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-1 mt-3 rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)]">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
              <span className="text-xs font-mono text-[var(--text-muted)]">
                v{displayAppVersion}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="glass-card p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text-dim)] flex items-center gap-2">
              <Globe className="w-3.5 h-3.5" />
              {t('about.links')}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {links.map((link) => (
                <button
                  key={link.label}
                  onClick={() => handleOpenExternal(link.url)}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] hover:bg-[var(--glass-bg-hover)] hover:border-[var(--glass-border-hover)] transition-all group cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-[var(--bg-tertiary)]/50 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">
                      <link.icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-sm text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors font-medium">
                      {link.label}
                    </span>
                  </div>
                  <div className="w-6 h-6 flex items-center justify-center rounded-full bg-[var(--bg-tertiary)]/30 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0">
                    <span className="text-micro text-[var(--text-primary)]">
                      ↗
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {!isDesktopApp && (
          <div className="glass-card p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[var(--accent-primary)]" />
                  {isShell ? t('about.shellUpdateTitle') : t('about.gatewayRemoteTitle')}
                </h3>
                <p className="text-xs text-[var(--text-muted)] max-w-xl">
                  {isShell ? t('about.shellUpdateDesc') : t('about.gatewayRemoteDesc')}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isShell && (
                  <button
                    onClick={() => void handleShellCheck()}
                    disabled={shellPhase === 'checking' || shellPhase === 'upgrading'}
                    className="px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)] rounded-full text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {shellPhase === 'checking'
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <RefreshCw className="w-4 h-4" />}
                    {t('settings.checkUpdates')}
                  </button>
                )}
                {isShell && shellCanUpgrade && (
                  <button
                    onClick={() => void handleShellUpgrade()}
                    disabled={shellPhase === 'upgrading'}
                    className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--button-primary-hover)] text-[var(--text-on-accent)] rounded-full text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    {t('about.upgradeAll')}
                  </button>
                )}
                {!isShell && (
                  <button
                    onClick={() => handleOpenExternal('https://github.com/polite0803/ModelPort/releases')}
                    className="px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)] rounded-full text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    <Github className="w-4 h-4" />
                    {t('about.openReleasePage')}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {isShell && (
                <div className="rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-3 space-y-1">
                  <div className="text-micro uppercase tracking-widest text-[var(--text-dim)]">
                    {t('about.shellVersion')}
                  </div>
                  <div className="text-sm font-mono text-[var(--text-primary)]">
                    {shellVersion || '...'}
                    {shellCheck?.shell.latest
                      ? <span className="text-[var(--text-muted)]"> → {shellCheck.shell.latest}</span>
                      : null}
                  </div>
                  {shellCheck && (
                    <div className="text-xs text-[var(--text-muted)]">
                      {shellCheck.shell.updateAvailable ? t('about.updateAvailable') : t('settings.upToDate')}
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-3 space-y-1">
                <div className="text-micro uppercase tracking-widest text-[var(--text-dim)]">
                  {t('about.gatewayVersion')}
                </div>
                <div className="text-sm font-mono text-[var(--text-primary)]">
                  {displayAppVersion}
                  {shellCheck?.daemon.latest
                    ? <span className="text-[var(--text-muted)]"> → {shellCheck.daemon.latest}</span>
                    : null}
                </div>
                {shellCheck && (
                  <div className="text-xs text-[var(--text-muted)]">
                    {shellCheck.daemon.current === null
                      ? t('about.daemonReadFailed')
                      : shellCheck.daemon.updateAvailable
                        ? (shellCheck.daemon.managed
                            ? t('about.updateAvailable')
                            : t('about.gatewayUnmanaged'))
                        : t('settings.upToDate')}
                  </div>
                )}
              </div>
            </div>

            {isShell && shellCheck?.daemon.managed === false && (
              <p className="text-xs text-[var(--text-muted)]">{t('about.gatewayUnmanaged')}</p>
            )}
            {isShell && shellCheck && shellNeedsMissing && (
              <p className="text-xs text-[var(--accent-error)]">
                {t('about.missingAssets')}: {shellCheck.missing.join(', ')}
              </p>
            )}
            {isShell && (shellCheck?.error || shellError) && (
              <p className="text-xs text-[var(--accent-error)]">{shellCheck?.error ?? shellError}</p>
            )}

            {isShell && shellProgress && (
              <div className="space-y-2 pt-3 border-t border-[var(--glass-border)]">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>{t(`about.stages.${shellProgress.stage}`)}</span>
                  {shellProgress.percent !== undefined && (
                    <span className="font-mono">{shellProgress.percent.toFixed(1)}%</span>
                  )}
                </div>
                {shellProgress.percent !== undefined && (
                  <div className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent-primary)] transition-all duration-300"
                      style={{ width: `${shellProgress.percent}%` }}
                    />
                  </div>
                )}
                <p className="text-xs text-[var(--text-muted)]">{shellProgress.message}</p>
              </div>
            )}

            {isShell && shellPhase === 'done' && !shellProgress && (
              <p className="text-xs text-[var(--accent-success)]">{t('about.upgradeDone')}</p>
            )}
            {isShell && shellCheck?.release && (
              <button
                onClick={() => handleOpenExternal(shellCheck.release?.pageUrl ?? '')}
                className="text-xs text-[var(--accent-primary)] hover:underline text-left"
              >
                {t('about.openReleasePage')}
              </button>
            )}
          </div>
        )}

        <div className={`glass-card p-6 relative overflow-hidden group${isDesktopApp ? '' : ' hidden'}`}>
          <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--accent-primary)]/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none transition-opacity opacity-50 group-hover:opacity-100" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Zap className="w-4 h-4 text-[var(--accent-primary)]" />
                {t('about.appUpdates')}
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                {t('settings.currentVersion')}:{' '}
                <span className="text-[var(--text-primary)] font-mono ml-1">
                  {displayAppVersion}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-3">
              {updateInfo.phase === 'checking' ? (
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm font-medium">{t('settings.checking')}</span>
                </div>
              ) : updateInfo.phase === 'downloading' ? (
                <div className="flex flex-col gap-2 min-w-[200px]">
                  <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                    <span>{t('settings.downloadingUpdate')}</span>
                    {downloadProgress && (
                      <span className="font-mono">{downloadProgress.percent.toFixed(1)}%</span>
                    )}
                  </div>
                  {downloadProgress ? (
                    <>
                      <div className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent-primary)] transition-all duration-300"
                          style={{ width: `${downloadProgress.percent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-[var(--text-dim)]">
                        <span>{formatSpeed(downloadProgress.bytesPerSecond)}</span>
                        <span>
                          {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('settings.downloadingUpdate')}</span>
                    </div>
                  )}
                </div>
              ) : updateInfo.phase === 'downloaded' ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--success)]/10 shadow-[0_0_8px_var(--success)]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" />
                    <span className="text-xs font-medium text-[var(--success)]">
                      {t('settings.updateDownloaded')}
                    </span>
                  </div>
                  <button
                    onClick={handleInstallUpdate}
                    className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--button-primary-hover)] text-[var(--text-on-accent)] text-sm font-medium rounded-full transition-colors flex items-center gap-2 shadow-lg shadow-[var(--accent-primary)]/20"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t('settings.restartAndInstall')}
                  </button>
                </div>
              ) : updateInfo.phase === 'error' ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full badge-error">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">
                      {t('settings.updateCheckFailed')}
                    </span>
                  </div>
                  <button
                    onClick={handleCheckAppUpdate}
                    className="px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)] hover:border-[var(--glass-border-hover)] rounded-full text-sm text-[var(--text-primary)] font-medium transition-all duration-200 flex items-center gap-2"
                  >
                    <RefreshCw className="h-4 w-4 text-[var(--text-muted)]" />
                    {t('settings.retry')}
                  </button>
                </div>
              ) : updateInfo.phase === 'available' ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--success)]/10 shadow-[0_0_8px_var(--success)]">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--success)]"></span>
                    </span>
                    <span className="text-xs font-medium text-[var(--success)]">
                      {t('settings.updateAvailable')}
                      {updateInfo.latestVersion ? ` v${updateInfo.latestVersion}` : ''}
                    </span>
                  </div>
                  <button
                    onClick={handleDownloadUpdate}
                    className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--button-primary-hover)] text-[var(--text-on-accent)] text-sm font-medium rounded-full transition-colors flex items-center gap-2 shadow-lg shadow-[var(--accent-primary)]/20"
                  >
                    <Download className="w-4 h-4" />
                    {t('settings.downloadUpdate')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleCheckAppUpdate}
                  className="px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)] hover:border-[var(--glass-border-hover)] rounded-full text-sm text-[var(--text-primary)] font-medium transition-all duration-200 flex items-center gap-2"
                >
                  <Globe className="h-4 w-4 text-[var(--text-muted)]" />
                  {t('settings.checkUpdates')}
                </button>
              )}
            </div>
          </div>

          {(updateInfo.phase === 'error' || updateInfo.phase === 'not-available') && (
            <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
              {updateInfo.phase === 'error' ? (
                <div className="flex items-center gap-2 text-[var(--accent-error)]">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {updateInfo.error || t('settings.updateCheckFailed')}
                  </span>
                </div>
              ) : updateInfo.phase === 'not-available' ? (
                <div className="flex items-center gap-2 text-[var(--accent-success)]">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm font-medium">{t('settings.upToDate')}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="text-center space-y-3 pt-8 pb-4 border-t border-[var(--glass-border)] opacity-60">
          <p className="text-caption font-bold tracking-[0.2em] text-[var(--text-dim)] uppercase">
            {t('about.credits')}
          </p>
          <p className="text-xs text-[var(--text-muted)] max-w-lg mx-auto leading-relaxed">
            {t('about.builtWith')}
          </p>
          <p className="text-micro text-[var(--text-dim)] font-mono">
            © {new Date().getFullYear()} {t('settings.appName')} • GPL-3.0 License
          </p>
        </div>
      </div>
    </div>
  )
}
