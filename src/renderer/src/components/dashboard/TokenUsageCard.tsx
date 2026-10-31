/**
 * Today's token consumption, with the upstream-reported and estimated pools
 * shown SEPARATELY.
 *
 * Why it is not one number: `usage` is `null` unless the provider reported real
 * counts, and most shipped channels report nothing. Merging the two pools would
 * produce a large figure that reads as fact while being almost entirely
 * `chars/4` arithmetic. Two labelled rows is the honest presentation — the
 * upstream row is what could be reconciled against a bill, the estimated row is
 * explicitly a local approximation.
 *
 * Savings are only counted for compression that actually took effect; potential
 * savings on skipped requests are counterfactuals and are not shown.
 */

import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Coins, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DayTokenSummary } from '@/types/electron'

export interface TokenUsageCardProps {
  /** Today's counters; `null` while the first fetch is in flight. */
  usage: DayTokenSummary | null
  className?: string
}

/** Compact token formatting: 12.3k, 1.24M. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(2)}M`
}

export function TokenUsageCard({ usage, className }: TokenUsageCardProps) {
  const { t } = useTranslation()

  const upstreamTotal = usage ? usage.upstreamPrompt + usage.upstreamCompletion : 0
  const estimatedTotal = usage ? usage.estimatedPrompt + usage.estimatedCompletion : 0
  const hasAny = usage !== null && usage.requests > 0

  // Coverage is shown only when there is something to divide. A null coverage
  // means "no requests yet", which must not read as "0% reported".
  const coverageText =
    usage && usage.upstreamCoverage !== null
      ? `${Math.round(usage.upstreamCoverage * 100)}%`
      : null

  return (
    <Card hover className={cn('p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="stat-label">{t('dashboard.tokenUsage.title')}</p>
        <Coins className="h-[15px] w-[15px] shrink-0 text-[var(--text-dim)]" />
      </div>

      {!hasAny ? (
        <p className="mt-3 text-sm text-[var(--text-dim)]">{t('dashboard.tokenUsage.noData')}</p>
      ) : (
        <div className="mt-3 space-y-2.5">
          {/*
            Two labelled numbers, still never one total - only laid out side by
            side, because this card spans most of the row's width and a single
            column left the middle of it empty.
          */}
          <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {/* Upstream-reported — the only pool that could match a bill. */}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-meta text-[var(--text-muted)]">
                {t('dashboard.tokenUsage.upstream')}
              </span>
              <span className="stat-value tabular-nums text-base">{formatTokens(upstreamTotal)}</span>
            </div>

            {/* Estiamted — explicitly a local approximation, never a billing figure. */}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-meta text-[var(--text-muted)]">
                {t('dashboard.tokenUsage.estimated')}
              </span>
              <span
                className="tabular-nums text-[var(--text-dim)]"
                title={t('dashboard.tokenUsage.estimatedHint')}
              >
                ≈ {formatTokens(estimatedTotal)}
              </span>
            </div>
          </div>

          {coverageText && (
            <p className="text-meta text-[var(--text-dim)]">
              {t('dashboard.tokenUsage.coverage', { percent: coverageText })}
            </p>
          )}

          {/*
            Cache reads, shown only when an upstream actually reported them.
            A channel that reports nothing must NOT render "0": that would read
            as "prefix caching is not working", which we never measured.
          */}
          {usage && usage.upstreamCacheRead > 0 && (
            <div className="flex items-baseline justify-between gap-3">
              <span
                className="text-meta text-[var(--text-muted)]"
                title={t('dashboard.tokenUsage.cacheReadHint')}
              >
                {t('dashboard.tokenUsage.cacheRead')}
              </span>
              <span className="tabular-nums text-[var(--text-dim)]">
                {formatTokens(usage.upstreamCacheRead)}
                <span className="ml-1">
                  / {formatTokens(usage.upstreamPrompt)}
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/*
        Savings: compression that actually took effect today. `compressionEnabled
        === false` renders "-" instead of the 0, because with the switch off no
        compression was ever allowed to run — that 0 is the absence of a source,
        not a measurement that found nothing.
      */}
      {hasAny && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--border)] pt-2.5 text-meta">
          <TrendingDown className="h-3 w-3 text-[var(--success)]" />
          <span className="text-[var(--text-muted)]">{t('dashboard.tokenUsage.saved')}</span>
          {usage?.compressionEnabled === false ? (
            <>
              <span
                className="tabular-nums text-[var(--text-dim)]"
                title={t('dashboard.tokenUsage.savedDisabledHint')}
              >
                -
              </span>
              {/* The reason belongs in the row, not only in the tooltip: a bare
                  "-" is still a claim the user would have to come back to decode. */}
              <span className="text-[var(--text-dim)]">
                {t('dashboard.tokenUsage.savedDisabled')}
              </span>
            </>
          ) : (
            <>
              <span className="tabular-nums text-[var(--success)]">
                {formatTokens(usage?.savedTokens ?? 0)}
              </span>
              <span className="text-[var(--text-dim)]">{t('dashboard.tokenUsage.savedHint')}</span>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
