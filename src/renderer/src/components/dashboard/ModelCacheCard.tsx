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
import type {
  CacheMissClassCounts,
  CacheMissDetail,
  CacheMissIdleGapCounts,
  CacheMissIdleGapTokens,
  CacheMissTokenCounts,
  CacheMissTokenDetail,
} from '@shared/tokenAccounting'
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

/**
 * 缺口成因的顺序与配色固定：冷启是外部事实，断链才是网关/客户端真把前缀改断了，
 * 所以只有断链用错误色；正常新增用最暗的灰，避免把「一切正常」渲染成告警。
 */
const MISS_REASONS: ReadonlyArray<{
  key: keyof CacheMissClassCounts
  tone: string
  labelKey: string
}> = [
  { key: 'cold', tone: 'var(--text-muted)', labelKey: 'dashboard.modelCache.missCold' },
  { key: 'rewrite', tone: 'var(--warning)', labelKey: 'dashboard.modelCache.missRewrite' },
  { key: 'break', tone: 'var(--error)', labelKey: 'dashboard.modelCache.missBreak' },
  { key: 'tail', tone: 'var(--text-dim)', labelKey: 'dashboard.modelCache.missTail' },
]

/**
 * 四类的再切分。与上面四颗点的关系：这里是**同一批请求**的细分，不是新增计数。
 * 「新增」是结构上限（这一轮本来就要新读），「断裂」才是可修的；「续轮」是锚点
 * 丢了，「重启后」是疑似值（进程启动 10 分钟内的首轮）。
 */
function MissDetail({
  detail,
  detailTokens,
  tokens,
}: {
  detail?: CacheMissDetail
  detailTokens?: CacheMissTokenDetail
  tokens?: CacheMissTokenCounts
}) {
  const { t } = useTranslation()
  if (detail === undefined) return null
  // 占比的分母是**全部未命中 token**（四类求和）：这样每一格都能回答
  // 「这份损失里它占多少」，而不是四个互不相干的绝对数。
  const total = tokens === undefined
    ? 0
    : tokens.cold + tokens.rewrite + tokens.break + tokens.tail
  const pct = (value: number | undefined): string => {
    if (total <= 0 || value === undefined) return '-'
    return `${Math.round((value / total) * 100)}%`
  }
  const shares = (a: number | undefined, b: number | undefined): string =>
    total > 0 ? ` (${pct(a)} / ${pct(b)})` : ''
  const parts: string[] = []
  if (detail.coldFirst + detail.coldResumed > 0) {
    parts.push(`${t('dashboard.modelCache.missDetailCold', {
      first: detail.coldFirst,
      resumed: detail.coldResumed,
    })}${shares(detailTokens?.coldFirst, detailTokens?.coldResumed)}`)
  }
  if (detail.breakAppend + detail.breakDiverged > 0) {
    parts.push(`${t('dashboard.modelCache.missDetailBreak', {
      append: detail.breakAppend,
      diverged: detail.breakDiverged,
    })}${shares(detailTokens?.breakAppend, detailTokens?.breakDiverged)}`)
  }
  if (detail.afterRestart > 0) {
    const share = total > 0 ? ` (${pct(detailTokens?.afterRestart)})` : ''
    parts.push(`${t('dashboard.modelCache.missDetailRestart', { count: detail.afterRestart })}${share}`)
  }
  if (parts.length === 0) return null
  return (
    <div className="mt-0.5 text-caption text-[var(--text-dim)]" title={t('dashboard.modelCache.missDetailHint')}>
      {parts.join(' · ')}
    </div>
  )
}

/**
 * 「续轮丢锚」按距上一轮的间隔分档。这是区分两种成因的唯一客观依据：
 * 间隔长 ⇒ 上游缓存过期（事实）；间隔短却整段没命中 ⇒ 上游提前清了缓存。
 */
function MissIdleGap({ gaps, tokens }: { gaps?: CacheMissIdleGapCounts; tokens?: CacheMissIdleGapTokens }) {
  const { t } = useTranslation()
  if (gaps === undefined) return null
  if (gaps.under5m + gaps.from5mTo30m + gaps.over30m === 0) return null
  const total = (tokens?.under5m ?? 0) + (tokens?.from5mTo30m ?? 0) + (tokens?.over30m ?? 0)
  const share = (value: number | undefined): string =>
    total > 0 && value !== undefined ? ` (${Math.round((value / total) * 100)}%)` : ''
  return (
    <div className="mt-0.5 text-caption text-[var(--text-muted)]" title={t('dashboard.modelCache.missIdleGapHint')}>
      {t('dashboard.modelCache.missIdleGap', {
        under: gaps.under5m,
        underShare: share(tokens?.under5m),
        middle: gaps.from5mTo30m,
        middleShare: share(tokens?.from5mTo30m),
        over: gaps.over30m,
        overShare: share(tokens?.over30m),
      })}
    </div>
  )
}

function MissBreakdown({ counts, tokens }: { counts?: CacheMissClassCounts; tokens?: CacheMissTokenCounts }) {
  const { t } = useTranslation()
  // 缺省 = 这个模型还没被分类过（旧桶或全部请求都不报缓存），与「四类都是 0」不同。
  if (counts === undefined) return null
  const parts = MISS_REASONS.filter((reason) => counts[reason.key] > 0)
  if (parts.length === 0) return null

  return (
    <div
      className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-caption"
      title={t('dashboard.modelCache.missClassesHint')}
    >
      {parts.map((reason) => (
        <span
          key={reason.key}
          className="inline-flex items-center gap-1 whitespace-nowrap"
          style={{ color: reason.tone }}
        >
          <span
            aria-hidden
            className="h-1 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: reason.tone }}
          />
          {t(reason.labelKey)} {counts[reason.key]}
          {tokens !== undefined && tokens[reason.key] > 0
            ? ` · ${formatTokens(tokens[reason.key])}`
            : ''}
        </span>
      ))}
    </div>
  )
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
                        <MissBreakdown counts={row.cacheMissClasses} tokens={row.cacheMissTokens} />
                        <MissDetail
                          detail={row.cacheMissDetail}
                          detailTokens={row.cacheMissTokenDetail}
                          tokens={row.cacheMissTokens}
                        />
                        <MissIdleGap gaps={row.cacheMissIdleGap} tokens={row.cacheMissIdleGapTokens} />
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
