import { useState, useEffect, useRef, useCallback, useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { List, type RowComponentProps } from 'react-window'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RequestLogDetail } from './RequestLogDetail'
import { RequestLogStats } from './RequestLogStats'
import { Trash2, FileText } from 'lucide-react'
import type { RequestLogEntry } from '@/types/electron'

interface RequestLogStatsData {
  total: number
  success: number
  error: number
  todayTotal: number
  todaySuccess: number
  todayError: number
}

interface RowProps {
  logs: RequestLogEntry[]
  onSelectLog: (log: RequestLogEntry) => void
}

const ITEM_HEIGHT = 72
const LOG_LIST_LIMIT = 200
/** Safety net for rows written while the window was closed; the live push is the normal path. */
const RECONCILE_INTERVAL_MS = 30_000
const STATS_REFRESH_DEBOUNCE_MS = 400

function getStatusColor(status: 'success' | 'error', statusCode: number) {
  if (status === 'success') return 'badge-success'
  if (statusCode >= 500) return 'badge-error'
  if (statusCode >= 400) return 'badge-warning'
  return 'badge-error'
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatLatency(ms: number) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

interface RequestLogListProps {
  highlightId?: string
}

export function RequestLogList({ highlightId }: RequestLogListProps) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<RequestLogEntry[]>([])
  const [stats, setStats] = useState<RequestLogStatsData | null>(null)
  const [selectedLog, setSelectedLog] = useState<RequestLogEntry | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const logsRef = useRef<RequestLogEntry[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const consumedHighlightRef = useRef<string | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 400 })

  const fetchLogs = useCallback(async () => {
    try {
      const filter = statusFilter === 'all' ? {} : { status: statusFilter }
      const result = await window.electronAPI?.requestLogs?.get({ ...filter, limit: LOG_LIST_LIMIT })
      if (result) {
        if (JSON.stringify(result) !== JSON.stringify(logsRef.current)) {
          logsRef.current = result
          setLogs(result)
        }
      }
    } catch (error) {
      console.error('Failed to fetch request logs:', error)
    }
  }, [statusFilter])

  const fetchStats = useCallback(async () => {
    try {
      const result = await window.electronAPI?.requestLogs?.getStats()
      if (result) {
        setStats(result)
      }
    } catch (error) {
      console.error('Failed to fetch request log stats:', error)
    }
  }, [])

  const refreshLogs = useCallback(async () => {
    await Promise.all([fetchLogs(), fetchStats()])
  }, [fetchLogs, fetchStats])

  const statsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setIsLoading(true)
    refreshLogs().finally(() => setIsLoading(false))
  }, [refreshLogs])

  // Rows arrive as they are persisted, so the list no longer polls every 3s. The
  // debounced stats refetch keeps the counters authoritative instead of guessing +1,
  // and the slow reconcile covers rows written while no window was listening.
  useEffect(() => {
    const unsubscribe = window.electronAPI?.requestLogs?.onNewLog?.((log) => {
      if (statusFilter !== 'all' && log.status !== statusFilter) {
        return
      }
      logsRef.current = [log, ...logsRef.current.filter((entry) => entry.id !== log.id)].slice(0, LOG_LIST_LIMIT)
      setLogs(logsRef.current)
      if (statsTimerRef.current) clearTimeout(statsTimerRef.current)
      statsTimerRef.current = setTimeout(() => {
        statsTimerRef.current = null
        fetchStats().catch((error) => {
          console.error('Failed to refresh request log stats:', error)
        })
      }, STATS_REFRESH_DEBOUNCE_MS)
    })

    const reconcile = setInterval(() => {
      refreshLogs().catch((error) => {
        console.error('Failed to reconcile request logs:', error)
      })
    }, RECONCILE_INTERVAL_MS)

    return () => {
      unsubscribe?.()
      clearInterval(reconcile)
      if (statsTimerRef.current) clearTimeout(statsTimerRef.current)
    }
  }, [statusFilter, refreshLogs, fetchStats])

  useEffect(() => {
    if (!highlightId || consumedHighlightRef.current === highlightId || logs.length === 0) return
    const target = logs.find(log => log.id === highlightId)
    if (target) {
      setSelectedLog(target)
      consumedHighlightRef.current = highlightId
    }
  }, [highlightId, logs])

  /**
   * 虚拟列表必须给定像素高度。过去按「条数 × 行高、封顶 600」算，窗口再高也只铺到 600px，
   * 下方一片空白。现在直接量容器：容器是 flex-1 的剩余空间，窗口变高它就变高。
   */
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const updateSize = () => {
      setContainerSize({
        width: element.clientWidth,
        height: Math.max(ITEM_HEIGHT, element.clientHeight),
      })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const handleClearLogs = async () => {
    await window.electronAPI?.requestLogs?.clear()
    logsRef.current = []
    setLogs([])
    fetchStats()
    setShowClearDialog(false)
  }

  const handleSelectLog = useCallback((log: RequestLogEntry) => {
    setSelectedLog(log)
  }, [])

  const RowComponent = useCallback(
    ({ index, style, logs: rowLogs, onSelectLog }: RowComponentProps<RowProps>): ReactElement | null => {
      const log = rowLogs[index]
      if (!log) return null

      return (
        <div
          style={style}
          className="px-2 pb-2"
          onClick={() => onSelectLog(log)}
        >
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors h-[68px]">
            <Badge variant="outline" className={getStatusColor(log.status, log.statusCode)}>
              {log.statusCode}
            </Badge>

            {log.streamTruncated === true && (
              <Badge variant="outline" className="badge-warning" title={t('logs.streamTruncated')}>
                {t('logs.truncatedShort')}
              </Badge>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{log.model}</span>
                {log.actualModel && log.actualModel !== log.model && (
                  <span className="text-xs text-muted-foreground">→ {log.actualModel}</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <span>{log.providerName || log.providerId}</span>
                {log.accountName && (
                  <>
                    <span>·</span>
                    <span>{log.accountName}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
              <span className="tabular-nums">{formatLatency(log.latency)}</span>
              <span>{formatTime(log.timestamp)}</span>
            </div>
          </div>
        </div>
      )
    },
    [t]
  )

  const rowProps = useMemo<RowProps>(() => ({
    logs,
    onSelectLog: handleSelectLog,
  }), [logs, handleSelectLog])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">{t('logs.requestLogs')}</h2>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | 'success' | 'error')}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder={t('logs.filter')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('logs.all')}</SelectItem>
              <SelectItem value="success">{t('common.success')}</SelectItem>
              <SelectItem value="error">{t('common.error')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshLogs}>
            {t('dashboard.refresh')}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setShowClearDialog(true)}>
            {t('logs.clearLogs')}
          </Button>
        </div>
      </div>

      {stats && <RequestLogStats stats={stats} />}

      <div ref={containerRef} className="mt-4 min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-[var(--text-muted)]">
            {t('common.loading')}
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <FileText className="h-5 w-5" />
            </div>
            <p className="empty-state-title">{t('logs.noRequestLogs')}</p>
            <p className="empty-state-hint">{t('logs.noRequestLogsHint')}</p>
          </div>
        ) : (
          <List
            rowComponent={RowComponent}
            rowCount={logs.length}
            rowHeight={ITEM_HEIGHT}
            rowProps={rowProps}
            style={{
              width: containerSize.width,
              height: containerSize.height,
            }}
            className="scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
          />
        )}
      </div>

      {selectedLog && (
        <RequestLogDetail log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}

      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center">
                <Trash2 className="h-4 w-4 text-destructive" />
              </div>
              {t('logs.clearConfirm')}
            </DialogTitle>
            <DialogDescription>
              {t('logs.clearConfirmDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleClearLogs}>
              {t('logs.clearLogs')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
