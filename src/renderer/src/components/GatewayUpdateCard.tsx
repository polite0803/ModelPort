import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Download, CheckCircle2, AlertCircle, RefreshCw, Container } from 'lucide-react'
import type { DockerUpdateCheck, DockerUpdateStatus } from '@shared/dockerUpdate'
import { GATEWAY_UNREACHABLE } from '@/api/headless'

/**
 * In-UI online update for the Docker-deployed gateway. Only rendered on the remote
 * (headless/browser) About page. The three capability absences are shown verbatim -
 * never a button that pretends to work when the socket is missing.
 */
export function GatewayUpdateCard() {
  const { t } = useTranslation()
  const [check, setCheck] = useState<DockerUpdateCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<DockerUpdateStatus | null>(null)
  const [applying, setApplying] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [doneVersion, setDoneVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const deadlineRef = useRef<number>(0)
  const targetRef = useRef<string>('')

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const runCheck = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const result = await window.electronAPI.app.gatewayCheckUpdate()
      setCheck(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void runCheck()
  }, [runCheck])

  const beginPolling = useCallback((target: string) => {
    targetRef.current = target
    deadlineRef.current = Date.now() + 150_000
    setRestarting(true)
    stopPolling()
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const s = await window.electronAPI.app.gatewayUpdateStatus()
          setStatus(s)
          if (s.phase === 'failed') {
            stopPolling()
            setRestarting(false)
            setApplying(false)
            setError(s.error ?? t('about.gatewayUpdate.failed'))
            return
          }
          if (s.current === targetRef.current && s.phase === 'idle') {
            stopPolling()
            setRestarting(false)
            setApplying(false)
            setDoneVersion(s.current)
            return
          }
          if (Date.now() > deadlineRef.current) {
            stopPolling()
            setRestarting(false)
            setApplying(false)
            setError(t('about.gatewayUpdate.failed'))
          }
        } catch (e) {
          const code = (e as { code?: string }).code
          if (code === GATEWAY_UNREACHABLE) {
            // The daemon is down mid-swap; this is expected, keep waiting.
            if (Date.now() > deadlineRef.current) {
              stopPolling()
              setRestarting(false)
              setApplying(false)
              setError(t('about.gatewayUpdate.failed'))
            }
            return
          }
          stopPolling()
          setRestarting(false)
          setApplying(false)
          setError(e instanceof Error ? e.message : String(e))
        }
      })()
    }, 2000)
  }, [stopPolling, t])

  const handleApply = useCallback(async () => {
    if (!check || !check.newer) return
    setApplying(true)
    setError(null)
    setDoneVersion(null)
    setStatus(null)
    try {
      const s = await window.electronAPI.app.gatewayApplyUpdate(check.latest)
      setStatus(s)
      beginPolling(check.latest)
    } catch (e) {
      setApplying(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [check, beginPolling])

  const capability = check?.capability ?? 'ok'
  const absenceKey = capability === 'not-docker'
    ? 'notDocker'
    : capability === 'no-socket'
      ? 'noSocket'
      : capability === 'socket-denied'
        ? 'socketDenied'
        : null

  const busy = applying || restarting
  const phaseLabel = status && status.phase !== 'idle' && status.phase !== 'failed'
    ? t(`about.gatewayUpdate.phase.${status.phase}`)
    : null

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Container className="w-4 h-4 text-[var(--accent-primary)]" />
            {t('about.gatewayUpdate.title')}
          </h3>
          <p className="text-xs text-[var(--text-muted)] max-w-xl">
            {t('about.gatewayUpdate.desc')}
          </p>
        </div>
        {capability === 'ok' && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void runCheck()}
              disabled={checking || busy}
              className="px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)] rounded-full text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {t('about.gatewayUpdate.check')}
            </button>
            {check?.newer && (
              <button
                onClick={() => void handleApply()}
                disabled={busy}
                className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--button-primary-hover)] text-[var(--text-on-accent)] rounded-full text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {t('about.gatewayUpdate.apply')}
              </button>
            )}
          </div>
        )}
      </div>

      {absenceKey !== null && (
        <div className="flex items-start gap-2 text-xs text-[var(--accent-error)]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t(`about.gatewayUpdate.${absenceKey}`)}</span>
        </div>
      )}

      {capability === 'ok' && check && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-3 space-y-1">
            <div className="text-micro uppercase tracking-widest text-[var(--text-dim)]">
              {t('about.gatewayUpdate.current')}
            </div>
            <div className="text-sm font-mono text-[var(--text-primary)]">v{check.current}</div>
          </div>
          <div className="rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-3 space-y-1">
            <div className="text-micro uppercase tracking-widest text-[var(--text-dim)]">
              {t('about.gatewayUpdate.latest')}
            </div>
            <div className="text-sm font-mono text-[var(--text-primary)]">
              {check.latest ? `v${check.latest}` : '…'}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {check.newer ? t('about.gatewayUpdate.newer') : t('about.gatewayUpdate.upToDate')}
            </div>
          </div>
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>
            {restarting
              ? t('about.gatewayUpdate.restarting')
              : phaseLabel ?? t('about.gatewayUpdate.applying')}
          </span>
        </div>
      )}

      {doneVersion !== null && (
        <div className="flex items-center gap-2 text-xs text-[var(--accent-success)]">
          <CheckCircle2 className="w-4 h-4" />
          <span>{t('about.gatewayUpdate.done', { version: doneVersion })}</span>
        </div>
      )}

      {error !== null && (
        <div className="flex items-start gap-2 text-xs text-[var(--accent-error)]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}