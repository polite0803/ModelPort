import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, MonitorOff, Network, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/layout/PageHeader'
import type { ShellBridge } from '@shared/shellBridge'
import type { GatewayListSnapshot, GatewayPhase, GatewayRow, GatewayRowAction } from '@shared/shellList'

/**
 * The gateway manager as a console page.
 *
 * The list window (`shell/gatewayListPage.ts`) still exists for the cases where no console
 * page can host the list — a tab that was opened before the shell knew about this route, or
 * a menu entry pressed while the console is showing a failure page. This page is the same
 * list in the console's own furniture; both read `shell:gateways` and both ask again after
 * `shell:gateways-changed`, so neither owns the truth.
 */
const PHASE_DOT: Record<GatewayPhase, string> = {
  running: 'bg-emerald-500',
  stopped: 'bg-zinc-400',
  'not-installed': 'bg-zinc-400',
  unreachable: 'bg-red-500',
  offline: 'bg-red-500',
  unknown: 'bg-amber-500',
}

function dangerAction(action: GatewayRowAction): boolean {
  return action === 'remove' || action === 'uninstall'
}

export function Gateways() {
  const { t } = useTranslation()
  const shellBridge = (window as unknown as { modelportShell?: ShellBridge }).modelportShell
  const gateways = shellBridge?.gateways

  const [snapshot, setSnapshot] = useState<GatewayListSnapshot | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    if (!gateways) return
    try {
      const next = await gateways.snapshot()
      if (mounted.current) setSnapshot(next)
    } catch {
      // A snapshot that cannot even be asked for is the same failure as an empty one with
      // an error: say so, keep the last rows rather than blanking the page.
      if (mounted.current) {
        setSnapshot((current) => current ?? { rows: [], labels: {} as GatewayListSnapshot['labels'], canAddWsl: false, error: t('gateways.loadFailed') })
      }
    }
  }, [gateways, t])

  useEffect(() => {
    mounted.current = true
    void load()
    const off = gateways?.onChanged?.(() => void load())
    return () => {
      mounted.current = false
      off?.()
    }
  }, [gateways, load])

  /** Runs one row action and keeps the row busy until the answer comes back. */
  const run = async (key: string, action: () => Promise<void>): Promise<void> => {
    setPending(key)
    try {
      await action()
      await load()
    } finally {
      if (mounted.current) setPending(null)
    }
  }

  const onConnect = (row: GatewayRow): void => {
    if (!gateways || row.active || !row.actions.includes('connect')) return
    void run(`${row.id}:connect`, () => gateways.connect(row.id))
  }

  const onAct = (row: GatewayRow, action: GatewayRowAction): void => {
    if (!gateways) return
    const key = `${row.id}:${action}`
    if (action === 'connect') return onConnect(row)
    if (action === 'edit') return void run(key, () => gateways.edit(row.id))
    if (action === 'remove') return void run(key, () => gateways.remove(row.id))
    if (action === 'install') return void run(key, () => gateways.installWsl(row.id))
    if (action === 'upgrade') return void run(key, () => gateways.upgrade(row.id))
    if (action === 'deploy') return void run(key, () => gateways.deploy(row.id))
    if (row.kind === 'wsl') {
      return void run(key, () => gateways.wslAction(row.id, action as 'start' | 'stop' | 'restart' | 'uninstall'))
    }
    return void run(key, () => gateways.localAction(row.id, action as 'start' | 'stop' | 'repair'))
  }

  if (!gateways) {
    return (
      <>
        <PageHeader title={t('gateways.title')} description={t('gateways.description')} />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-[var(--text-muted)]">
            <MonitorOff className="h-5 w-5 flex-none" />
            <span>{t('gateways.desktopOnly')}</span>
          </CardContent>
        </Card>
      </>
    )
  }

  const rows = snapshot?.rows ?? []

  return (
    <>
      <PageHeader
        title={t('gateways.title')}
        description={t('gateways.description')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={pending !== null}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              {t('gateways.refresh')}
            </Button>
            <Button size="sm" onClick={() => void gateways.add()} disabled={pending !== null}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('gateways.add')}
            </Button>
          </>
        }
      />

      {snapshot?.error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {snapshot.error}
        </div>
      )}

      {snapshot === null ? (
        <div className="flex items-center gap-2 py-16 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('gateways.loading')}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-sm text-[var(--text-muted)]">
            <Network className="h-6 w-6" />
            <span>{t('gateways.empty')}</span>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const busy = pending?.startsWith(`${row.id}:`) === true || pending === row.id
            const clickable = !row.active && row.actions.includes('connect')
            return (
              <Card
                key={row.id}
                className={
                  row.active
                    ? 'border-[var(--accent-primary)]/60'
                    : clickable
                      ? 'cursor-pointer transition-colors hover:bg-[var(--surface-hover)]'
                      : undefined
                }
              >
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default"
                    onClick={() => onConnect(row)}
                    disabled={!clickable || busy}
                  >
                    <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${PHASE_DOT[row.phase]}`} />
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex items-center gap-2">
                        {row.active && (
                          <span className="rounded border border-[var(--glass-border)] px-1.5 py-px text-[11px] font-medium text-[var(--text-muted)]">
                            {t('gateways.current')}
                          </span>
                        )}
                        <span className="truncate text-sm font-semibold">{row.name}</span>
                        {busy && <Loader2 className="h-3.5 w-3.5 flex-none animate-spin" />}
                      </span>
                      <span className="block truncate text-xs text-[var(--text-muted)]">
                        {t(`gateways.phase.${row.phase}`)} · {row.detail}
                      </span>
                    </span>
                  </button>

                  <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
                    {row.actions
                      .filter((action) => action !== 'connect')
                      .map((action) => (
                        <Button
                          key={action}
                          variant={dangerAction(action) ? 'ghost' : 'outline'}
                          size="sm"
                          className={dangerAction(action) ? 'text-red-400 hover:text-red-300' : undefined}
                          disabled={pending !== null}
                          onClick={() => onAct(row, action)}
                        >
                          {snapshot.labels[action] ?? action}
                        </Button>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
