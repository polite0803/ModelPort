import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { History, ExternalLink } from 'lucide-react'

export interface ActivityItem {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  description?: string
  timestamp: number
  providerName?: string
  modelName?: string
  actualModel?: string
  accountName?: string
  clientLabel?: string
  latency?: number
  statusCode?: number
}

export interface RecentActivityProps {
  activities: ActivityItem[]
  onItemClick?: (item: ActivityItem) => void
  className?: string
  maxVisible?: number
}

export function RecentActivity({
  activities,
  onItemClick,
  className,
  maxVisible = 7,
}: RecentActivityProps) {
  const { t } = useTranslation()

  const getTypeDot = (type: ActivityItem['type']) => {
    switch (type) {
      case 'success':
        return 'bg-[var(--success)]'
      case 'error':
        return 'bg-[var(--error)]'
      case 'warning':
        return 'bg-[var(--warning)]'
      default:
        return 'bg-[var(--accent-primary)]'
    }
  }

  const formatTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return t('dashboard.justNow')
    if (minutes < 60) return t('dashboard.minutesAgo', { count: minutes })
    if (hours < 24) return t('dashboard.hoursAgo', { count: hours })
    return t('dashboard.daysAgo', { count: days })
  }

  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const visibleActivities = activities.slice(0, maxVisible)

  return (
    <Card className={cn('flex h-full flex-col p-5', className)}>
      <div className="flex items-center gap-2">
        <History className="h-[15px] w-[15px] text-[var(--text-muted)]" />
        <h3 className="card-heading">
          {t('dashboard.recentActivity')}
        </h3>
      </div>

      {activities.length === 0 ? (
        <div className="empty-state flex-1">
          <div className="empty-state-icon">
            <History className="h-5 w-5" />
          </div>
          <p className="empty-state-title">{t('dashboard.noActivity')}</p>
        </div>
      ) : (
        <div className="mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1">
          {visibleActivities.map((item) => (
            <div
              key={item.id}
              className={cn(
                'group rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]',
                onItemClick && 'cursor-pointer'
              )}
              onClick={() => onItemClick?.(item)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('status-dot shrink-0', getTypeDot(item.type))} />
                  <span className="truncate text-label">{item.title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.statusCode && (
                    <span className="badge-soft font-mono">
                      {item.statusCode}
                    </span>
                  )}
                  {onItemClick && (
                    <ExternalLink className="h-3.5 w-3.5 text-[var(--text-dim)] opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </div>
              </div>
              {item.description && (
                <p className="mb-1 truncate pl-4 text-caption text-[var(--text-muted)]">
                  {item.description}
                </p>
              )}
              <div className="flex items-center gap-1.5 pl-4 text-caption text-[var(--text-dim)]">
                <span>{formatTime(item.timestamp)}</span>
                {item.clientLabel && (
                  <>
                    <span>·</span>
                    <span>{item.clientLabel}</span>
                  </>
                )}
                {item.providerName && (
                  <>
                    <span>·</span>
                    <span>{item.providerName}</span>
                  </>
                )}
                {item.actualModel && (
                  <>
                    <span>·</span>
                    <span className="font-mono">{item.actualModel}</span>
                  </>
                )}
                {item.accountName && (
                  <>
                    <span>·</span>
                    <span>{item.accountName}</span>
                  </>
                )}
                {item.latency !== undefined && (
                  <>
                    <span>·</span>
                    <span className="tabular-nums">{formatLatency(item.latency)}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
