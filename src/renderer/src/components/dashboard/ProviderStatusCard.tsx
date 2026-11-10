import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Server } from 'lucide-react'
import type { ProviderStatus } from '@/types/electron'
import type { ProviderStatsWindow, ProviderWindowTokenUsage } from '@shared/providerUsage'
import { formatTokens } from './TokenUsageCard'
import { StatsWindowPresets, StatsWindowRangeInputs } from './StatsWindowPicker'

export interface ProviderStats {
  id: string
  name: string
  status: ProviderStatus
  /** Requests in the selected window. */
  requestCount: number
  /**
   * `undefined` when no day in the window recorded outcomes for this provider -
   * rendered as "-", never as 0%.
   */
  successRate?: number
  /** `undefined` when unrecorded, or when no successful request was measured. */
  avgLatencyMs?: number
  /** Earliest day in the window with outcome data, for the "自 … 起" hint. */
  coveredFrom?: string
  /**
   * Token and cash totals from a different store key than the counters above, so
   * a provider can be covered in one and absent in the other. `undefined` is
   * rendered as "-" - not as 0 tokens and not as $0.00.
   */
  tokens?: ProviderWindowTokenUsage
  /** Health-check probe latency: a property of right now, not of the window. */
  latency?: number
}

export interface ProviderStatusCardProps {
  providers: ProviderStats[]
  /** The period the counters were summed over; named to keep `window` free. */
  statsWindow: ProviderStatsWindow
  onWindowChange: (window: ProviderStatsWindow) => void
  className?: string
}

/**
 * Money keeps its own formatting because a day of cheap requests genuinely costs
 * a fraction of a cent: `toFixed(2)` would print that as `$0.00`, which reads as
 * "free" - the one thing this column must never claim about an unpriced model.
 */
function formatUsd(value: number): string {
  if (value <= 0) return '$0.00'
  if (value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}

export function ProviderStatusCard({
  providers,
  statsWindow,
  onWindowChange,
  className,
}: ProviderStatusCardProps) {
  const { t } = useTranslation()

  const statusDot = (status: ProviderStatus) => {
    switch (status) {
      case 'online':
        return 'status-dot-online'
      case 'offline':
        return 'status-dot-offline'
      default:
        return 'bg-[var(--warning)]'
    }
  }

  const statusText = (status: ProviderStatus) => {
    switch (status) {
      case 'online':
        return t('providers.online')
      case 'offline':
        return t('providers.offline')
      default:
        return t('providers.unknown')
    }
  }

  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  /**
   * The tooltip behind the token number: which pool is which, how much of the
   * window was measured rather than estimated, and from which day the per
   * provider split exists at all.
   */
  const tokenHint = (tokens: ProviderWindowTokenUsage | undefined): string => {
    if (tokens === undefined) return t('dashboard.providerWindow.tokenMissing')
    const coverage = Math.round((tokens.upstreamRequests / Math.max(tokens.requests, 1)) * 100)

    return [
      `${t('dashboard.tokenUsage.upstream')}: ${formatTokens(tokens.upstreamTokens)}`,
      `${t('dashboard.tokenUsage.estimated')}: ≈${formatTokens(tokens.estimatedTokens)}`,
      t('dashboard.tokenUsage.coverage', { percent: `${coverage}%` }),
      tokens.coveredFrom
        ? t('dashboard.providerWindow.tokenFrom', { day: tokens.coveredFrom })
        : '',
    ].filter(Boolean).join(' · ')
  }

  return (
    <Card className={cn('flex h-full flex-col p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server className="h-[15px] w-[15px] text-[var(--text-muted)]" />
          <h3 className="card-heading">
            {t('dashboard.providerStats')}
          </h3>
        </div>

        <StatsWindowPresets value={statsWindow} onChange={onWindowChange} />
      </div>

      <StatsWindowRangeInputs
        value={statsWindow}
        onChange={onWindowChange}
        className="mt-2 pl-4"
      />

      {providers.length === 0 ? (
        <div className="empty-state flex-1">
          <div className="empty-state-icon">
            <Server className="h-5 w-5" />
          </div>
          <p className="empty-state-title">{t('providers.noProvidersFound')}</p>
          <p className="empty-state-hint">{t('providers.clickToAddProvider')}</p>
        </div>
      ) : (
        <div className="mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('status-dot shrink-0', statusDot(provider.status))} />
                  <span className="truncate text-label">{provider.name}</span>
                </div>
                <span className="shrink-0 text-caption text-[var(--text-dim)]">
                  {statusText(provider.status)}
                  {/*
                    The probe belongs to the status, not to the window: it is how
                    long *this* check took, so it sits next to the word it
                    qualifies instead of taking a column of window metrics.
                  */}
                  {provider.latency !== undefined && provider.latency > 0 && (
                    <span title={t('dashboard.providerWindow.probeHint')}>
                      {' · '}
                      {t('dashboard.providerWindow.probe')} {provider.latency}ms
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-5 gap-2 pl-4 text-caption">
                <div>
                  <span className="text-[var(--text-dim)]">{t('dashboard.totalRequests')}</span>
                  <p className="font-medium tabular-nums">
                    {provider.requestCount.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span
                    className="text-[var(--text-dim)]"
                    title={provider.coveredFrom
                      ? t('dashboard.providerWindow.outcomeFrom', { day: provider.coveredFrom })
                      : t('dashboard.providerWindow.outcomeMissing')
                    }
                  >
                    {t('dashboard.successRate')}
                  </span>
                  <p className="font-medium tabular-nums">
                    {provider.successRate === undefined ? '-' : `${provider.successRate}%`}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--text-dim)]">{t('dashboard.avgResponse')}</span>
                  <p className="font-medium tabular-nums">
                    {provider.avgLatencyMs === undefined ? '-' : formatLatency(provider.avgLatencyMs)}
                  </p>
                </div>
                <div>
                  <span
                    className="text-[var(--text-dim)]"
                    title={tokenHint(provider.tokens)}
                  >
                    {t('dashboard.tokenTotal')}
                  </span>
                  {provider.tokens === undefined ? (
                    <p className="font-medium tabular-nums">-</p>
                  ) : (
                    <p className="font-medium tabular-nums">
                      {formatTokens(provider.tokens.upstreamTokens)}
                      {provider.tokens.estimatedTokens > 0 && (
                        // Second pool, second number: one total would read as
                        // measured while being mostly `chars/4`.
                        <span className="ml-1 font-normal text-[var(--text-dim)]">
                          +≈ {formatTokens(provider.tokens.estimatedTokens)}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div>
                  <span
                    className="text-[var(--text-dim)]"
                    title={provider.tokens
                      ? t('dashboard.providerWindow.costHint', {
                          costed: provider.tokens.costedRequests,
                          requests: provider.tokens.requests,
                        })
                      : t('dashboard.providerWindow.costMissing')
                    }
                  >
                    {t('dashboard.cost')}
                  </span>
                  <p className="font-medium tabular-nums">
                    {provider.tokens?.costUsd === undefined ? '-' : formatUsd(provider.tokens.costUsd)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
