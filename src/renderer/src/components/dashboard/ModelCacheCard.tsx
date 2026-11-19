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
import type { ModelWindowCoverage, ModelWindowTokenUsage, ProviderStatsWindow } from '@shared/providerUsage'
import { formatTokens } from './TokenUsageCard'
import { StatsWindowPresets, StatsWindowRangeInputs } from './StatsWindowPicker'

export interface ModelCacheCardProps {
  stats: Record<string, ModelWindowTokenUsage>
  coverage?: ModelWindowCoverage
  statsWindow: ProviderStatsWindow
  onWindowChange: (window: ProviderStatsWindow) => void
  className?: string
}

const DEFAULT_VISIBLE_ROWS = 8

function percentOf(numerator: number, denominator: number): string | null {
  if (!(denominator > 0)) return null
  return `${Math.round((numerator / denominator) * 100)}%`
}

export function ModelCacheCard({
  stats,
  coverage,
  statsWindow,
  onWindowChange,
  className,
}: ModelCacheCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  // A window that spans the upgrade has day buckets without a per-model split:
  // the table's requests would then quietly total less than the day totals it
  // sits beside. State the gap instead of letting the reader find it.
  const coverageGap =
    coverage !== undefined && coverage.detailedRequests < coverage.totalRequests
      ? coverage
      : null

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

        <StatsWindowPresets value={statsWindow} onChange={onWindowChange} />
      </div>

      {/*
        自定义区间的起止输入必须和这张卡片自己的预设行放在一起：这张卡与供应商统计
        共用同一个窗口，以前这里只渲染预设、不渲染日期输入，点这张卡的「自定义」之后
        日期框只出现在隔壁那张卡里——看着像是隔壁那张卡的控件，改的却是这张卡的区间。
      */}
      <StatsWindowRangeInputs
        value={statsWindow}
        onChange={onWindowChange}
        className="mt-2"
      />

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
            <div>
              <p className="text-caption text-[var(--text-dim)]">{t('dashboard.modelCache.note')}</p>
              {coverageGap !== null && (
                <p className="text-caption text-[var(--text-dim)]">
                  {t('dashboard.modelCache.coverageNote', {
                    covered: coverageGap.detailedRequests,
                    total: coverageGap.totalRequests,
                  })}
                </p>
              )}
            </div>
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
