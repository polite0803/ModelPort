import { useTranslation } from 'react-i18next'
import { recentLocalDays } from '@shared/localDay'
import type { ProviderStatsWindow } from '@shared/providerUsage'
import { cn } from '@/lib/utils'

const PRESETS: readonly { key: string; window: ProviderStatsWindow; labelKey: string; count?: number }[] = [
  { key: 'today', window: { kind: 'today' }, labelKey: 'dashboard.providerWindow.today' },
  { key: 'days7', window: { kind: 'days', days: 7 }, labelKey: 'dashboard.providerWindow.days', count: 7 },
  { key: 'days30', window: { kind: 'days', days: 30 }, labelKey: 'dashboard.providerWindow.days', count: 30 },
  { key: 'all', window: { kind: 'all' }, labelKey: 'dashboard.providerWindow.all' },
]

interface StatsWindowControlProps {
  value: ProviderStatsWindow
  onChange: (window: ProviderStatsWindow) => void
}

/**
 * The preset row shared by the headline cards and the provider card.
 *
 * Both edit the same kind of window, so they must offer the same presets and
 * name them the same way - two controls that said "7 days" differently would be
 * two definitions of the period, and the cards would stop agreeing.
 */
export function StatsWindowPresets({ value, onChange, className }: StatsWindowControlProps & { className?: string }) {
  const { t } = useTranslation()
  const isCustom = value.kind === 'range'

  /**
   * The preset is highlighted only for the window it produces: two `days`
   * presets differ by their count, and a hand-edited range is never a preset.
   */
  const isActive = (preset: ProviderStatsWindow): boolean => {
    if (isCustom || preset.kind !== value.kind) return false
    return preset.kind !== 'days' ||
      (value.kind === 'days' && value.days === preset.days)
  }

  // Opening the custom editor on the last week keeps it a change of shape, not
  // an accident: an empty range would read as "no traffic" rather than "not yet
  // filled in".
  const openCustomRange = () => {
    const days = recentLocalDays(7)
    onChange({ kind: 'range', start: days[0].key, end: days[days.length - 1].key })
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          onClick={() => onChange(preset.window)}
          className={cn(
            'rounded-md px-2 py-1 text-caption transition-colors',
            isActive(preset.window)
              ? 'bg-[var(--accent-soft)] text-[var(--accent-primary)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
          )}
        >
          {preset.count === undefined
            ? t(preset.labelKey)
            : t(preset.labelKey, { count: preset.count })
          }
        </button>
      ))}
      <button
        type="button"
        onClick={openCustomRange}
        className={cn(
          'rounded-md px-2 py-1 text-caption transition-colors',
          isCustom
            ? 'bg-[var(--accent-soft)] text-[var(--accent-primary)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
        )}
      >
        {t('dashboard.providerWindow.custom')}
      </button>
    </div>
  )
}

/**
 * The start/end editor, rendered only while the window is a hand-picked range.
 *
 * A reversed range is called out here rather than corrected: silently swapping
 * the edges would hide that the days were typed the wrong way round, and the
 * sums would then cover a period nobody asked for.
 */
export function StatsWindowRangeInputs({ value, onChange, className }: StatsWindowControlProps & { className?: string }) {
  const { t } = useTranslation()

  if (value.kind !== 'range') return null

  const setEdge = (edge: 'start' | 'end', edgeValue: string) => {
    onChange({ ...value, [edge]: edgeValue })
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2 text-caption text-[var(--text-muted)]', className)}>
      <label className="flex items-center gap-1.5">
        <span>{t('dashboard.providerWindow.from')}</span>
        <input
          type="date"
          value={value.start}
          onChange={(event) => setEdge('start', event.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-caption"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span>{t('dashboard.providerWindow.to')}</span>
        <input
          type="date"
          value={value.end}
          onChange={(event) => setEdge('end', event.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-caption"
        />
      </label>
      {value.start > value.end && (
        <span className="text-[var(--warning)]">{t('dashboard.providerWindow.invalidRange')}</span>
      )}
    </div>
  )
}