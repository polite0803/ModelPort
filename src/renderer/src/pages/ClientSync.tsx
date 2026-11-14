import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CheckCircle2, Loader2, MonitorOff, RefreshCw, TriangleAlert, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { useToast } from '@/hooks/use-toast'
import type { ShellBridge } from '@shared/shellBridge'
import type { ClientApplyResult, ClientId, ClientSyncPreview, ClientSyncRow, ClientSyncState } from '@shared/clientSync'

/**
 * Repointing the installed clients at the active gateway, as a console page.
 *
 * The page owns no truth: it asks the shell for a preview and then names client ids. Every
 * path, current value and edit is re-derived in the main process, so this file cannot aim a
 * write somewhere else even if it wanted to - and it never sees a plaintext key, only the
 * masked `keyPreview`. That is why the confirm dialog can be honest about what will happen:
 * the rows it lists are the rows `apply` will re-gather.
 *
 * Only the console injects `modelportShell`; a browser tab on the same gateway has no bridge
 * and says so instead of rendering buttons that cannot work.
 */
const STATE_TONE: Record<ClientSyncState, string> = {
  ready: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  unchanged: 'border-[var(--glass-border)] bg-transparent text-[var(--text-muted)]',
  'not-installed': 'border-[var(--glass-border)] bg-transparent text-[var(--text-muted)]',
  'no-entry': 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  'app-running': 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  blocked: 'border-red-500/40 bg-red-500/10 text-red-400',
  error: 'border-red-500/40 bg-red-500/10 text-red-400',
}

const DISTRIBUTION_TONE: Record<string, string> = {
  already: 'text-[var(--text-muted)]',
  added: 'text-emerald-400',
  failed: 'text-red-400',
  'no-secret': 'text-amber-400',
}

function ChangeList({ row }: { row: ClientSyncRow }) {
  const { t } = useTranslation()
  if (row.changes.length === 0) return null
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-[var(--text-muted)]">{t('clientSync.changesTitle')}</span>
      <ul className="space-y-1">
        {row.changes.map(change => (
          <li key={change.label} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[var(--text-muted)]">{change.label}</span>
            <span className="font-mono text-[var(--text-muted)]">
              {change.before === null ? t('clientSync.added') : change.before}
            </span>
            <ArrowRight className="h-3 w-3 flex-none text-[var(--text-muted)]" />
            <span className="break-all font-mono">{change.after}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ClientSync() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const shellBridge = (window as unknown as { modelportShell?: ShellBridge }).modelportShell
  const clients = shellBridge?.clients

  const [preview, setPreview] = useState<ClientSyncPreview | null>(null)
  const [selected, setSelected] = useState<ClientId[]>([])
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [results, setResults] = useState<ClientApplyResult[]>([])
  const mounted = useRef(true)

  const load = useCallback(async () => {
    if (!clients) return
    setBusy(true)
    try {
      const next = await clients.preview()
      if (!mounted.current) return
      setPreview(next)
      // Only `ready` rows can be written, so only they are selectable. Re-gathering after
      // an apply resets the selection to what is still writable rather than keeping ids
      // that have just become `unchanged`.
      setSelected(next.rows.filter(row => row.state === 'ready').map(row => row.id))
      setResults([])
    } catch (error) {
      if (!mounted.current) return
      const message = error instanceof Error ? error.message : String(error)
      setPreview(current => current ?? {
        origin: '',
        gatewayName: '',
        keyPreview: null,
        models: [],
        rows: [],
        keyDistribution: [],
        error: message,
      })
      toast({ title: t('clientSync.loadFailed', { error: message }), variant: 'destructive' })
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [clients, t, toast])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
    }
  }, [load])

  const readyRows = useMemo(() => preview?.rows.filter(row => row.state === 'ready') ?? [], [preview])

  const apply = async (): Promise<void> => {
    if (!clients || selected.length === 0) return
    setConfirming(false)
    setBusy(true)
    try {
      const answer = await clients.apply(selected)
      if (!mounted.current) return
      setResults(answer.results)
      if (answer.ok) {
        toast({ title: t('clientSync.applyDone') })
      } else {
        toast({
          title: t('clientSync.applyFailed'),
          description: answer.error ?? answer.results.find(item => !item.ok)?.message,
          variant: 'destructive',
        })
      }
      await load()
      if (mounted.current) setResults(answer.results)
    } catch (error) {
      if (!mounted.current) return
      toast({
        title: t('clientSync.applyFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  if (!clients) {
    return (
      <>
        <PageHeader title={t('clientSync.title')} description={t('clientSync.description')} />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-[var(--text-muted)]">
            <MonitorOff className="h-5 w-5 flex-none" />
            <span>{t('clientSync.desktopOnly')}</span>
          </CardContent>
        </Card>
      </>
    )
  }

  const resultFor = (id: ClientId): ClientApplyResult | undefined => results.find(item => item.id === id)

  return (
    <>
      <PageHeader
        title={t('clientSync.title')}
        description={t('clientSync.description')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              {t('clientSync.refresh')}
            </Button>
            <Button size="sm" onClick={() => setConfirming(true)} disabled={busy || selected.length === 0}>
              <Wand2 className="mr-1.5 h-4 w-4" />
              {t('clientSync.apply', { n: selected.length })}
            </Button>
          </>
        }
      />

      {preview?.error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {preview.error}
        </div>
      )}

      {preview === null ? (
        <div className="flex items-center gap-2 py-16 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('clientSync.loading')}
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span>
                  <span className="text-[var(--text-muted)]">{t('clientSync.targetGateway')}：</span>
                  <span className="font-semibold">{preview.gatewayName}</span>
                  <span className="ml-2 break-all font-mono text-xs text-[var(--text-muted)]">{preview.origin}</span>
                </span>
                <span>
                  <span className="text-[var(--text-muted)]">{t('clientSync.canonicalKey')}：</span>
                  {preview.keyPreview === null
                    ? <span className="text-amber-400">{t('clientSync.noKey')}</span>
                    : <span className="font-mono text-xs">{preview.keyPreview}</span>}
                </span>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  {t('clientSync.modelsTitle')} · {t('clientSync.modelsCount', { n: preview.models.length })}
                </span>
                {preview.models.length === 0
                  ? <p className="text-xs text-amber-400">{t('clientSync.modelsEmpty')}</p>
                  : (
                    <div className="flex flex-wrap gap-1.5">
                      {preview.models.map(model => (
                        <span
                          key={model.name}
                          className="rounded border border-[var(--glass-border)] px-2 py-0.5 font-mono text-[11px]"
                          title={model.displayName}
                        >
                          {model.name}
                          <span className="ml-1.5 text-[var(--text-muted)]">
                            {model.contextWindow === null
                              ? t('clientSync.contextUnknown')
                              : `${Math.round(model.contextWindow / 1000)}K`}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
              </div>

              {preview.keyDistribution.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-[var(--text-muted)]">{t('clientSync.distributionTitle')}</span>
                  <ul className="space-y-0.5">
                    {preview.keyDistribution.map(item => (
                      <li key={item.origin} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium">{item.name}</span>
                        <span className="break-all font-mono text-[var(--text-muted)]">{item.origin}</span>
                        <span className={DISTRIBUTION_TONE[item.state] ?? ''}>
                          {t(`clientSync.distribution.${item.state}`)}
                        </span>
                        {item.detail && <span className="text-[var(--text-muted)]">{item.detail}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {readyRows.length === 0 && (
            <Card>
              <CardContent className="flex items-center gap-3 p-4 text-sm text-[var(--text-muted)]">
                <TriangleAlert className="h-4 w-4 flex-none" />
                <span>{t('clientSync.noReady')}</span>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            {preview.rows.map(row => {
              const writable = row.state === 'ready'
              const checked = selected.includes(row.id)
              const result = resultFor(row.id)
              return (
                <Card key={row.id} className={writable ? 'border-[var(--accent-primary)]/40' : undefined}>
                  <CardContent className="space-y-2.5 p-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 flex-none accent-[var(--accent-primary)] disabled:opacity-40"
                        checked={checked}
                        disabled={!writable || busy}
                        aria-label={row.label}
                        onChange={event => {
                          const on = event.target.checked
                          setSelected(current => on ? [...current, row.id] : current.filter(id => id !== row.id))
                        }}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{row.label}</span>
                          <span className={`rounded-full border px-2 py-px text-[11px] font-medium ${STATE_TONE[row.state]}`}>
                            {t(`clientSync.state.${row.state}`)}
                          </span>
                          {busy && writable && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        </div>
                        <div className="space-y-0.5">
                          {row.paths.map(path => (
                            <p key={path} className="break-all font-mono text-[11px] text-[var(--text-muted)]" title={path}>
                              {path}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Every non-ready state keeps its own reason: "not installed", "nothing of
                        ours to update" and "the app would overwrite us" have different next steps. */}
                    {row.reason && <p className="pl-7 text-xs text-[var(--text-muted)]">{row.reason}</p>}

                    <div className="pl-7">
                      <ChangeList row={row} />
                    </div>

                    {row.unservedModels.length > 0 && (
                      <div className="ml-7 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                        <span className="font-medium">{t('clientSync.unservedTitle')}</span>
                        <span className="ml-1.5 break-all font-mono">{row.unservedModels.join(', ')}</span>
                        <p className="mt-0.5 text-[var(--text-muted)]">{t('clientSync.unservedHint')}</p>
                      </div>
                    )}

                    {row.manualStep && (
                      <div className="ml-7 rounded-lg border border-[var(--glass-border)] px-3 py-2 text-xs">
                        <span className="font-medium text-amber-400">{t('clientSync.manualTitle')}</span>
                        <span className="ml-1.5 text-[var(--text-muted)]">{row.manualStep}</span>
                      </div>
                    )}

                    {result && (
                      <div
                        className={`ml-7 rounded-lg border px-3 py-2 text-xs ${
                          result.ok
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                            : 'border-red-500/40 bg-red-500/10 text-red-400'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          {result.ok
                            ? <CheckCircle2 className="h-3.5 w-3.5 flex-none" />
                            : <TriangleAlert className="h-3.5 w-3.5 flex-none" />}
                          {result.message}
                        </span>
                        {result.backups.length > 0 && (
                          <div className="mt-1 space-y-0.5 text-[var(--text-muted)]">
                            <span>{t('clientSync.backupsTitle')}</span>
                            {result.backups.map(path => (
                              <p key={path} className="break-all font-mono text-[11px]">{path}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={open => !open && setConfirming(false)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t('clientSync.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('clientSync.confirmDescription', { n: selected.length, origin: preview?.origin ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {preview?.rows
              .filter(row => selected.includes(row.id))
              .map(row => (
                <li key={row.id} className="flex items-center justify-between gap-3">
                  <span>{row.label}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {t('clientSync.confirmChanges', { n: row.changes.length })}
                  </span>
                </li>
              ))}
          </ul>
          <p className="text-xs text-[var(--text-muted)]">{t('clientSync.confirmBackup')}</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void apply()}>{t('clientSync.confirmApply')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}