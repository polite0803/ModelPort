/**
 * Cache hits by `(provider, model)`.
 *
 * Two rules make the numbers readable rather than merely large:
 *
 * - the hit-rate denominator is `promptWithCache`, the prompt tokens of requests
 *   whose upstream actually supplied a cache figure. Dividing by every upstream
 *   prompt would charge a provider that never reports caching as 0% hits;
 * - a model with no cache-reporting request renders "-", never 0%. A measured
 *   zero and an absent source are different facts.
 *
 * The period is the dashboard's shared provider window, so this card and the
 * provider statistics card always describe the same span.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Database } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { ModelWindowTokenUsage, ProviderStatsWindow } from '@shared/providerUsage'
import { formatTokens } from './TokenUsageCard'

export interface ModelCacheCardProps {
  stats: Record<string, ModelWindowTokenUsage>
  statsWindow: ProviderStatsWindow
  onWindowChange: (window: ProviderStatsWindow) => void
  className?: string
}

const PRESETS: readonly { key: string; window: ProviderStatsWindow; labelKey: string; count?: number }[] = [
  { key: 'today', window: { kind: 'today' }, labelKey: 'dashboard.providerWindow.today' },
  { key: 'days7', window: { kind: 'days', days: 7 }, labelKey: 'dashboard.providerWindow.days', count: 7 },
  { key: 'days30', window: { kind: 'days', days: 30 }, labelKey: 'dashboard.providerWindow.days', count: 30 },
  { key: 'all', window: { kind: 'all' }, labelKey: 'dashboard.providerWindow.all' },
]

const DEFAULT_VISIBLE_ROWS = 8

function isActiveWindow(preset: ProviderStatsWindow, current: ProviderStatsWindow): boolean {
  if (preset.kind !== current.kind) return false
  return preset.kind !== 'days' || (current.kind === 'days' && preset.days === current.days)
}

function percentOf(numerator: number, denominator: number): string | null {
  if (!(denominator > 0)) return null
  return `${Math.round((numerator / denominator) * 100)}%`
}

export function ModelCacheCard({
  stats,
  statsWindow,
  onWindowChange,
  className,
}: ModelCacheCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const rows = useMemo(() => {
    return Object.entries(stats)
      .map(([key, usage]) => ({ key, ...usage }))
      .sort((a, b) =>
        b.promptWithCache - a.promptWithCache
        || b.promptTokens - a.promptTokens
        || b.requests - a.requests
      )
  }, [stats])

  const visibleRows = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE_ROWS)

  return (
    <Card className={cn('p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Database className="h-[15px] w-[15px] text-[var(--text-muted)]" />
          <h3 className="card-heading">{t('dashboard.modelCache.title')}</h3>
        </div>

        <div className="flex items-center gap-1">
          {PRESETS.map((preset) => {
            const active = isActiveWindow(preset.window, statsWindow)

            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => onWindowChange(preset.window)}
                className={cn(
                  'rounded-md px-2 py-1 text-caption transition-colors',
                  active
                    ? 'bg-[var(--accent-soft)] text-[var(--accent-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                )}
              >
                {preset.count === undefined
                  ? t(preset.labelKey)
                  : t(preset.labelKey, { count: preset.count })}
              </button>
            )
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-dim)]">{t('dashboard.modelCache.noData')}</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-meta">
              <thead>
                <tr className="text-[var(--text-muted)]">
                  <th className="py-1.5 pr-3 text-left font-medium">{t('dashboard.modelCache.model')}</th>
                  <th className="py-1.5 px-2 text-right font-medium">{t('dashboard.modelCache.requests')}</th>
                  <th className="py-1.5 px-2 text-right font-medium">{t('dashboard.modelCache.upstream')}</th>
                  <th className="py-1.5 px-2 text-right font-medium">{t('dashboard.modelCache.input')}</th>
                  <th className="py-1.5 px-2 text-right font-medium">{t('dashboard.modelCache.cacheRead')}</th>
                  <th className="py-1.5 pl-2 text-right font-medium">{t('dashboard.modelCache.hitRate')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const hitRate = percentOf(row.cacheReadTokens, row.promptWithCache)
                  const coverage = percentOf(row.upstreamRequests, row.requests)

                  return (
                    <tr key={row.key} className="border-t border-[var(--border)]">
                      <td className="max-w-[18rem] py-1.5 pr-3">
                        <div className="truncate text-[var(--text-primary)]">{row.model}</div>
                        <div className="truncate text-caption text-[var(--text-dim)]">{row.providerId}</div>
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[var(--text-dim)]">
                        {row.requests}
                      </td>
                      <td
                        className="py-1.5 px-2 text-right tabular-nums text-[var(--text-dim)]"
                        title={coverage === null
                          ? t('dashboard.modelCache.missing')
                          : t('dashboard.modelCache.coverageHint', {
                              upstream: row.upstreamRequests,
                              requests: row.requests,
                            })}
                      >
                        {coverage ?? '-'}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[var(--text-dim)]">
                        {row.promptTokens > 0 ? formatTokens(row.promptTokens) : '-'}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[var(--text-dim)]">
                        {row.cacheReportedRequests > 0 ? formatTokens(row.cacheReadTokens) : '-'}
                      </td>
                      <td className="py-1.5 pl-2 text-right tabular-nums">
                        {hitRate === null
                          ? <span className="text-[var(--text-dim)]">-</span>
                          : <span className="text-[var(--text-primary)]">{hitRate}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-caption text-[var(--text-dim)]">{t('dashboard.modelCache.note')}</p>
            {rows.length > DEFAULT_VISIBLE_ROWS && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="shrink-0 rounded-md px-2 py-1 text-caption text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)]"
              >
                {expanded
                  ? t('dashboard.modelCache.collapse')
                  : t('dashboard.modelCache.expand', { count: rows.length })}
              </button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
