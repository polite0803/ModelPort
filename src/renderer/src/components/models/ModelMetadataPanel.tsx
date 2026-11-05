import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { Database, Loader2, RefreshCw, Radar, RotateCcw } from 'lucide-react'
import type {
  ModelMetadataReport,
  Fact,
  MetadataAttribute,
  ModelGapKind,
  ModelMetadataRow,
} from '@shared/modelMetadata'
import { METADATA_ATTRIBUTES, ROUTING_METADATA_ATTRIBUTES } from '@shared/modelMetadata'
import type {
  CatalogRefreshEndpointAttempt,
  CatalogSnapshotStatus,
  CatalogSourceId,
} from '@shared/modelCatalog'
import type {
  CatalogBatchEstimate,
  CatalogBatchSnapshot,
} from '@shared/modelCatalogBatch'
import {
  CATALOG_SOURCES,
  CATALOG_SOURCE_META,
  sanitizeCatalogMirrorUrl,
} from '@shared/modelCatalog'
import { familyRuleLayer } from '@shared/modelFamilyRules'
import {
  planContextProbe,
  planOutputProbe,
  type ProbeFailureKind,
  type ProbeJobSnapshot,
  type ProbePhase,
  type ProbePlan,
  type ProbeScope,
} from '@shared/modelProbe'
import {
  ATTRIBUTE_LABEL_KEYS,
  FactCell,
  formatDate,
  formatTokens,
  ModelAnnotationDialog,
  SOURCE_LABEL_KEYS,
} from './ModelAnnotationDialog'

const STATUS_LABEL_KEYS: Record<string, string> = {
  measured: 'models.metadata.probeStatusMeasured',
  inconclusive: 'models.metadata.probeStatusInconclusive',
  suspect: 'models.metadata.probeStatusSuspect',
  deferred: 'models.metadata.probeStatusDeferred',
  skipped: 'models.metadata.probeStatusSkipped',
}

type ProbeDialog = { mode: 'single'; row: ModelMetadataRow }

const PROBE_PHASE_LABEL_KEYS: Record<ProbePhase, string> = {
  prepare: 'models.metadata.probePhasePrepare',
  tier: 'models.metadata.probePhaseTier',
  awaiting: 'models.metadata.probePhaseAwaiting',
  done: 'models.metadata.probePhaseDone',
  cancelled: 'models.metadata.probePhaseCancelled',
}

const PROBE_FAILURE_LABEL_KEYS: Record<ProbeFailureKind, string> = {
  network: 'models.metadata.probeErrorNetwork',
  auth: 'models.metadata.probeErrorAuth',
  'rate-limit': 'models.metadata.probeErrorRateLimit',
  timeout: 'models.metadata.probeErrorTimeout',
  upstream: 'models.metadata.probeErrorUpstream',
  unknown: 'models.metadata.probeErrorUnknown',
}

function formatBound(atLeast?: number, below?: number): string {
  const parts: string[] = []
  if (atLeast !== undefined) parts.push(`≥${formatTokens(atLeast)}`)
  if (below !== undefined) parts.push(`<${formatTokens(below)}`)
  return parts.join(', ')
}

function rowKey(providerId: string, displayName: string): string {
  return `${providerId}\u0000${displayName}`
}

function isDeclared(fact: Fact<number>): boolean {
  return fact.state === 'known' && fact.confidence === 'declared'
}

function scopeFact(row: ModelMetadataRow, scope: 'context' | 'output'): Fact<number> {
  return scope === 'context' ? row.contextTokens : row.maxOutputTokens
}

/** 与主进程同一套计划函数：界面显示的请求数/token 预估就是实际要发的量。 */
function planFor(row: ModelMetadataRow, scope: 'context' | 'output'): ProbePlan {
  const fact = scopeFact(row, scope)
  const familyHint = familyRuleLayer(row.actualModelId)?.hint
  const hintTokens = fact.state === 'known'
    ? fact.value
    : scope === 'context'
      ? familyHint?.contextTokens
      : familyHint?.maxOutputTokens
  const hintSource: 'declared' | 'family-rule' | undefined = fact.state === 'known'
    ? 'declared'
    : hintTokens === undefined
      ? undefined
      : 'family-rule'
  return scope === 'context'
    ? planContextProbe({ hintTokens, hintSource })
    : planOutputProbe({ hintTokens, hintSource })
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`
}

export function ModelMetadataPanel() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [report, setReport] = useState<ModelMetadataReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [probing, setProbing] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ProbeDialog | null>(null)
  const [force, setForce] = useState(false)
  const [running, setRunning] = useState(false)
  const [jobSnapshot, setJobSnapshot] = useState<ProbeJobSnapshot | null>(null)
  const [tick, setTick] = useState(0)
  const [lastScope, setLastScope] = useState<ProbeScope | null>(null)
  const runningModeRef = useRef<'single' | null>(null)
  /** 「全部补齐」的编排在主进程；界面只保存最近一次快照并订阅进度。 */
  const [probeWithBatch, setProbeWithBatch] = useState(false)
  const [batchSnapshot, setBatchSnapshot] = useState<CatalogBatchSnapshot | null>(null)
  const [batchEstimate, setBatchEstimate] = useState<CatalogBatchEstimate | null>(null)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [batchStarting, setBatchStarting] = useState(false)
  const [catalogStatuses, setCatalogStatuses] = useState<CatalogSnapshotStatus[]>([])
  const [catalogErrors, setCatalogErrors] = useState<Partial<Record<CatalogSourceId, string>>>({})
  const [catalogAttempts, setCatalogAttempts] = useState<
    Partial<Record<CatalogSourceId, CatalogRefreshEndpointAttempt[]>>
  >({})
  const [refreshingCatalog, setRefreshingCatalog] = useState<CatalogSourceId | null>(null)
  const [catalogDialog, setCatalogDialog] = useState<ModelMetadataRow | null>(null)
  const [mirrorUrl, setMirrorUrl] = useState('')
  const [mirrorSaving, setMirrorSaving] = useState(false)

  const loadCatalog = useCallback(async () => {
    if (!window.electronAPI?.providers?.getCatalogStatuses) return
    try {
      // 只读磁盘元数据；打开页面不联网。
      setCatalogStatuses(await window.electronAPI.providers.getCatalogStatuses())
    } catch {
      // 快照读不出来只影响补全卡片，不让整页报表失败。
    }
  }, [])

  // 自定义镜像地址是普通配置项，打开页面只读取，不发请求。
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.config?.get) return
    void api.config
      .get()
      .then((config) => setMirrorUrl(config.catalogMirrorUrl ?? ''))
      .catch(() => undefined)
  }, [])

  const saveMirrorUrl = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.config?.update) return
    const mirror = sanitizeCatalogMirrorUrl(mirrorUrl)
    if (mirror === undefined) {
      toast({ title: t('models.metadata.catalogMirrorInvalid'), variant: 'destructive' })
      return
    }
    setMirrorSaving(true)
    try {
      const saved = await api.config.update({ catalogMirrorUrl: mirror })
      if (!saved) {
        toast({ title: t('models.metadata.catalogMirrorInvalid'), variant: 'destructive' })
        return
      }
      setMirrorUrl(mirror)
      toast({ title: t('models.metadata.catalogMirrorSaved') })
    } finally {
      setMirrorSaving(false)
    }
  }, [mirrorUrl, t, toast])

  const refreshCatalogSource = useCallback(
    async (source: CatalogSourceId) => {
      if (!window.electronAPI?.providers?.refreshCatalog) return
      setRefreshingCatalog(source)
      try {
        const result = await window.electronAPI.providers.refreshCatalog(source)
        setCatalogStatuses(result.statuses)
        if (result.attempts && result.attempts.length > 0) {
          setCatalogAttempts((current) => ({ ...current, [source]: result.attempts }))
        }
        if (result.success) {
          setCatalogErrors((current) => {
            if (!current[source]) return current
            const next = { ...current }
            delete next[source]
            return next
          })
          toast({
            title: t('models.metadata.catalogRefreshDone'),
            description: result.usedEndpoint
              ? `${CATALOG_SOURCE_META[source].label} · ${result.usedEndpoint}`
              : CATALOG_SOURCE_META[source].label,
          })
        } else {
          const message = result.error ?? ''
          setCatalogErrors((current) => ({ ...current, [source]: message }))
          toast({
            title: t('models.metadata.catalogRefreshFailed'),
            description: `${message} · ${t('models.metadata.catalogKeptOld')}`,
            variant: 'destructive',
          })
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setCatalogErrors((current) => ({ ...current, [source]: message }))
        toast({
          title: t('models.metadata.catalogRefreshFailed'),
          description: `${message} · ${t('models.metadata.catalogKeptOld')}`,
          variant: 'destructive',
        })
      } finally {
        setRefreshingCatalog(null)
      }
    },
    [t, toast],
  )

  const load = useCallback(async () => {
    if (!window.electronAPI?.providers?.getModelMetadata) {
      setError(t('models.metadata.unavailable'))
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await window.electronAPI.providers.getModelMetadata()
      if ('success' in result && (result as { success: boolean }).success === false) {
        setError((result as { success: false; error: string }).error)
        setReport(null)
      } else {
        setReport(result as ModelMetadataReport)
        setError(null)
      }
    } catch (cause) {
      // 只读报表失败不该让整页打不开，交给用户重试。
      setError(cause instanceof Error ? cause.message : t('models.metadata.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    void loadCatalog()
  }, [load, loadCatalog])

  // 进度是主进程推送的，界面不依赖 invoke 返回值刷新；关闭弹窗后任务继续。
  useEffect(() => {
    const api = window.electronAPI?.providers
    if (!api?.onProbeProgress) return
    const unsubscribe = api.onProbeProgress((event) => {
      const snapshot = event as ProbeJobSnapshot
      setJobSnapshot(snapshot)
      setTick((current) => current + 1)
      // 后台任务跑完后，重新打开弹窗的界面需要解除“进行中”状态。
      if (
        runningModeRef.current === 'single'
        && snapshot.jobId !== ''
        && (snapshot.status === 'done' || snapshot.status === 'failed' || snapshot.status === 'cancelled')
      ) {
        setRunning(false)
        setProbing(null)
        runningModeRef.current = null
      }
    })
    return unsubscribe
  }, [])

  // 进行中的任务需要一个本地秒表：主进程只在阶段变化时推送。
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setTick((current) => current + 1), 1000)
    return () => clearInterval(timer)
  }, [running])

  const closeDialog = useCallback(() => {
    // 关闭/Esc 不等待长请求：任务在主进程继续，重新打开会回显。
    setDialog(null)
    setForce(false)
  }, [])

  const describeResult = useCallback(
    (status: string, reason?: string, atLeast?: number, below?: number): string => {
      const label = t(STATUS_LABEL_KEYS[status] ?? 'models.metadata.probeStatusInconclusive')
      if (status === 'measured' && (atLeast !== undefined || below !== undefined)) {
        const range = formatBound(atLeast, below)
        return `${label} · ${t('models.metadata.probeRangeLabel', { range })}`
      }
      return reason ? `${label} · ${t('models.metadata.probeReasonLabel', { reason })}` : label
    },
    [t],
  )

  const runOne = useCallback(
    async (row: ModelMetadataRow, scope: ProbeScope) => {
      if (!window.electronAPI?.providers?.probeModel) return
      const key = rowKey(row.providerId, row.displayName)
      setProbing(key)
      setLastScope(scope)
      try {
        const response = await window.electronAPI.providers.probeModel(
          row.providerId,
          row.displayName,
          scope,
          force,
        )
        if (!response.success || !response.result) {
          toast({
            title: t('models.metadata.probeFailed'),
            description: response.error ?? row.displayName,
            variant: 'destructive',
          })
          return
        }
        const result = response.result
        const range = scope === 'context'
          ? result.row?.contextRange
          : scope === 'output'
            ? result.row?.maxOutputRange
            : undefined
        if (result.status === 'inconclusive' && result.reason?.includes('已取消')) {
          toast({
            title: t('models.metadata.probeCancelled'),
            description: `${row.displayName} · ${result.reason}`,
          })
          return
        }
        const detail = scope === 'capability'
          ? t('models.metadata.probeSuccess')
          : describeResult(result.status, result.reason, range?.atLeast, range?.below)
        toast({
          title: t('models.metadata.probeSuccess'),
          description: `${row.displayName} · ${detail}`,
        })
        await load()
      } finally {
        setProbing(null)
      }
    },
    [describeResult, force, load, t, toast],
  )

  const handleRunSingle = useCallback(
    async (scope: ProbeScope) => {
      if (!dialog || dialog.mode !== 'single') return
      runningModeRef.current = 'single'
      setRunning(true)
      setJobSnapshot(null)
      try {
        await runOne(dialog.row, scope)
      } finally {
        setRunning(false)
        runningModeRef.current = null
      }
    },
    [dialog, runOne],
  )

  /** 打开单模型弹窗：若该模型已有后台任务，直接回显进度。 */
  const openSingle = useCallback(async (row: ModelMetadataRow) => {
    setForce(false)
    setLastScope(null)
    setJobSnapshot(null)
    setRunning(false)
    setDialog({ mode: 'single', row })
    const api = window.electronAPI?.providers
    if (!api?.getProbeJobs) return
    try {
      const jobs = await api.getProbeJobs()
      const active = jobs.find(
        (job) =>
          job.status === 'running' &&
          job.providerId === row.providerId &&
          job.displayName === row.displayName,
      )
      if (active) {
        runningModeRef.current = 'single'
        setJobSnapshot(active)
        setRunning(true)
        setProbing(rowKey(row.providerId, row.displayName))
      }
    } catch {
      // 回读失败不影响新探测；进度事件仍会补上。
    }
  }, [])

  const cancelActiveProbe = useCallback(async () => {
    const jobId = jobSnapshot?.jobId
    if (!jobId || !window.electronAPI?.providers?.cancelProbe) return
    await window.electronAPI.providers.cancelProbe(jobId)
  }, [jobSnapshot?.jobId])

  // 关闭面板后任务仍在主进程跑；重新打开页面时回读最近一次任务快照。
  useEffect(() => {
    const api = window.electronAPI?.providers
    if (!api?.getCatalogBatchJobs) return
    void api
      .getCatalogBatchJobs()
      .then((jobs) => {
        if (jobs.length > 0) setBatchSnapshot(jobs[0])
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const api = window.electronAPI?.providers
    if (!api?.onCatalogBatchProgress) return
    return api.onCatalogBatchProgress((snapshot) => setBatchSnapshot(snapshot))
  }, [])

  // 批量结束后刷新待标注队列与快照元数据；同一任务只刷一次。
  const batchRefreshedRef = useRef<string | null>(null)
  useEffect(() => {
    const snapshot = batchSnapshot
    if (!snapshot) return
    if (snapshot.status !== 'done' && snapshot.status !== 'cancelled' && snapshot.status !== 'failed') {
      return
    }
    if (batchRefreshedRef.current === snapshot.jobId) return
    batchRefreshedRef.current = snapshot.jobId
    void load()
    void loadCatalog()
  }, [batchSnapshot, load, loadCatalog])

  const startBatch = useCallback(
    async (probe: boolean, retryFailedOf?: string) => {
      const api = window.electronAPI?.providers
      if (!api?.startCatalogBatch) return
      setBatchStarting(true)
      try {
        const result = await api.startCatalogBatch({ probe, retryFailedOf })
        if (!result.success || !result.snapshot) {
          toast({
            title: t('models.metadata.batchFailed'),
            description: result.error ?? t('models.metadata.batchNoTargets'),
            variant: 'destructive',
          })
          return
        }
        setBatchSnapshot(result.snapshot)
        setBatchConfirmOpen(false)
        setBatchDialogOpen(true)
      } catch (cause) {
        toast({
          title: t('models.metadata.batchFailed'),
          description: cause instanceof Error ? cause.message : String(cause),
          variant: 'destructive',
        })
      } finally {
        setBatchStarting(false)
      }
    },
    [t, toast],
  )

  /**
   * 主入口：有进行中/暂停的任务就接着看它；否则直接开跑。
   * 只有打开「同时执行探测」时才先取一次合计预估并确认一次。
   */
  const openBatch = useCallback(async () => {
    const api = window.electronAPI?.providers
    if (!api) return
    try {
      const jobs = await api.getCatalogBatchJobs?.()
      const active = jobs?.find(
        (job) => job.status === 'running' || job.status === 'paused',
      )
      if (active) {
        setBatchSnapshot(active)
        setBatchDialogOpen(true)
        return
      }
    } catch {
      // 回读失败就按新任务处理。
    }
    if (!probeWithBatch) {
      await startBatch(false)
      return
    }
    setBatchStarting(true)
    try {
      const estimate = await api.estimateCatalogBatch?.()
      if (!estimate) return
      setBatchEstimate(estimate)
      setBatchConfirmOpen(true)
    } finally {
      setBatchStarting(false)
    }
  }, [probeWithBatch, startBatch])

  const pauseBatch = useCallback(async () => {
    const api = window.electronAPI?.providers
    const jobId = batchSnapshot?.jobId
    if (!api?.pauseCatalogBatch || !jobId) return
    await api.pauseCatalogBatch(jobId)
  }, [batchSnapshot?.jobId])

  const resumeBatch = useCallback(async () => {
    const api = window.electronAPI?.providers
    const jobId = batchSnapshot?.jobId
    if (!api?.resumeCatalogBatch || !jobId) return
    await api.resumeCatalogBatch(jobId)
  }, [batchSnapshot?.jobId])

  const cancelBatch = useCallback(async () => {
    const api = window.electronAPI?.providers
    const jobId = batchSnapshot?.jobId
    if (!api?.cancelCatalogBatch || !jobId) return
    await api.cancelCatalogBatch(jobId)
  }, [batchSnapshot?.jobId])

  const batchActive = batchSnapshot !== null
    && (batchSnapshot.status === 'running' || batchSnapshot.status === 'paused')
  const batchRunning = batchSnapshot !== null && batchSnapshot.status === 'running'

  // 批量进度条的秒表：主进程只在阶段变化时推送快照。
  useEffect(() => {
    if (!batchActive) return
    const timer = setInterval(() => setTick((current) => current + 1), 1000)
    return () => clearInterval(timer)
  }, [batchActive])

  /** 弹窗当前任务：只显示与单模型弹窗匹配的进度。 */
  const activeJob = jobSnapshot
    && dialog?.mode === 'single'
    && jobSnapshot.providerId === dialog.row.providerId
    && jobSnapshot.displayName === dialog.row.displayName
    ? jobSnapshot
    : null
  const elapsedSeconds = activeJob
    ? Math.max(0, Math.round((Date.now() - Date.parse(activeJob.startedAt)) / 1000))
    : 0
  // 用 tick 触发重渲染，保证秒表不依赖下一次进度推送。
  void tick

  if (loading && !report) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('models.metadata.loading')}
        </CardContent>
      </Card>
    )
  }

  if (error && !report) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('models.metadata.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!report) return null

  // 主进程老版本不带这个字段时按全零渲染，不让整页因为一次版本错位打不开。
  const gapKinds: Record<ModelGapKind, number> = report.totals.routingIncompleteByKind ?? {
    adoptable: 0,
    'missing-field': 0,
    'no-candidate': 0,
    'not-chat': 0,
  }
  const coverageRows = METADATA_ATTRIBUTES.map((attribute) => ({
    attribute,
    ...report.coverage[attribute],
    gap: report.coverageGaps[attribute],
    critical: (ROUTING_METADATA_ATTRIBUTES as readonly MetadataAttribute[]).includes(attribute),
  }))
  const batchAvailable = report.queue.length > 0
  const batchElapsedMs = batchSnapshot
    ? (batchActive
      ? Math.max(batchSnapshot.elapsedMs, Date.now() - new Date(batchSnapshot.startedAt).getTime())
      : batchSnapshot.elapsedMs)
    : 0
  const batchPercent = batchSnapshot && batchSnapshot.totalModels > 0
    ? Math.min(100, Math.round((batchSnapshot.processedModels / batchSnapshot.totalModels) * 100))
    : 0
  const batchBackoffSeconds = batchSnapshot?.backoffUntil
    ? Math.max(0, Math.ceil((new Date(batchSnapshot.backoffUntil).getTime() - Date.now()) / 1000))
    : 0

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{t('models.metadata.coverageTitle')}</CardTitle>
            <CardDescription>{t('models.metadata.coverageDesc')}</CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {batchAvailable && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={probeWithBatch}
                  disabled={batchActive}
                  onChange={(event) => setProbeWithBatch(event.target.checked)}
                />
                <span className="text-right">
                  <span className="font-medium text-foreground">
                    {t('models.metadata.batchProbeToggle')}
                  </span>
                  <span className="block">{t('models.metadata.batchProbeToggleHint')}</span>
                </span>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {batchAvailable && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={batchStarting}
                  onClick={() => void openBatch()}
                >
                  {batchStarting || (batchActive && batchRunning) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Radar className="mr-2 h-4 w-4" />
                  )}
                  {batchActive
                    ? t('models.metadata.batchViewProgress')
                    : t('models.metadata.batchAll')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                {t('models.metadata.refresh')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t('models.metadata.totalModels')}</div>
              <div className="text-2xl font-semibold">{report.totals.models}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t('models.metadata.routingComplete')}</div>
              <div className="text-2xl font-semibold text-success">{report.totals.routingComplete}</div>
              <div className="text-xs text-muted-foreground">
                {t('models.metadata.fullyAnnotatedHint', { count: report.totals.fullyAnnotated })}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t('models.metadata.routingIncomplete')}</div>
              <div className="text-2xl font-semibold text-warning">{report.totals.routingIncomplete}</div>
              <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                <div>{t('models.metadata.gapKindAdoptable', { count: gapKinds.adoptable })}</div>
                <div>{t('models.metadata.gapKindMissingField', { count: gapKinds['missing-field'] })}</div>
                <div>{t('models.metadata.gapKindNoCandidate', { count: gapKinds['no-candidate'] })}</div>
                <div>{t('models.metadata.gapKindNotChat', { count: gapKinds['not-chat'] })}</div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {coverageRows.map((row) => (
              <div key={row.attribute} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-sm">
                  {t(ATTRIBUTE_LABEL_KEYS[row.attribute])}
                  {!row.critical && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {t('models.metadata.referenceAttribute')}
                    </span>
                  )}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round(row.rate * 100)}%` }}
                  />
                </div>
                <span className="w-40 shrink-0 text-right text-xs text-muted-foreground">
                  {Math.round(row.rate * 100)}% · {row.known}/{row.applicable}
                  {row.notApplicable > 0 &&
                    ` · ${t('models.metadata.notApplicable', { count: row.notApplicable })}`}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('models.metadata.catalogTitle')}</CardTitle>
          <CardDescription>{t('models.metadata.catalogDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {CATALOG_SOURCES.map((source) => {
            const meta = CATALOG_SOURCE_META[source]
            const status = catalogStatuses.find((item) => item.source === source)
            const refreshing = refreshingCatalog === source
            return (
              <div key={source} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{meta.label}</span>
                      {status ? (
                        <Badge variant="outline" className="text-success">
                          {t('models.metadata.catalogReady', { count: status.entryCount })}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-warning">
                          {t('models.metadata.catalogNotFetched')}
                        </Badge>
                      )}
                      {status?.builtin && (
                        <Badge variant="outline" className="text-info">
                          {t('models.metadata.catalogBuiltinBadge', {
                            date: formatDate(status.fetchedAt),
                          })}
                        </Badge>
                      )}
                    </div>
                    <div className="break-all text-[11px] text-muted-foreground">
                      {status?.sourceUrl ?? meta.sourceUrl}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={refreshingCatalog !== null}
                    onClick={() => void refreshCatalogSource(source)}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing
                      ? t('models.metadata.catalogRefreshing')
                      : t('models.metadata.catalogRefresh')}
                  </Button>
                </div>
                {status && (
                  <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                    <div>
                      {status.builtin
                        ? t('models.metadata.catalogBuiltinFetchedAt', {
                            date: formatDate(status.fetchedAt),
                          })
                        : t('models.metadata.catalogFetchedAt', {
                            time: new Date(status.fetchedAt).toLocaleString(),
                          })}
                    </div>
                    <div>{t('models.metadata.catalogLicense', { license: status.license })}</div>
                    <div>
                      {t('models.metadata.catalogAttribution', {
                        attribution: status.attribution,
                      })}
                    </div>
                    <div className="break-all">
                      {t('models.metadata.catalogHash', { hash: status.contentHash.slice(0, 12) })}
                    </div>
                  </div>
                )}
                {source === 'litellm' && (
                  <div className="mt-2 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                        value={mirrorUrl}
                        placeholder="https://example.com/model_prices_and_context_window.json"
                        onChange={(event) => setMirrorUrl(event.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={mirrorSaving}
                        onClick={() => void saveMirrorUrl()}
                      >
                        {mirrorSaving ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        {t('models.metadata.catalogMirrorSave')}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {t('models.metadata.catalogMirrorHint')}
                    </p>
                  </div>
                )}
                {catalogAttempts[source] && catalogAttempts[source]!.length > 0 && (
                  <div className="mt-2 space-y-0.5 rounded-md border bg-muted/30 px-2 py-1 text-[11px]">
                    <div className="font-medium text-muted-foreground">
                      {t('models.metadata.catalogEndpointAttempts')}
                    </div>
                    {catalogAttempts[source]!.map((attempt) => (
                      <div key={attempt.url} className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">
                          {t(`models.metadata.catalogEndpoint_${attempt.label}`)}
                        </span>
                        <span>
                          {attempt.status !== undefined
                            ? `HTTP ${attempt.status}`
                            : t('models.metadata.catalogEndpointFailed')}
                        </span>
                        {attempt.errorKind && (
                          <span>
                            {t(`models.metadata.catalogErrorKind_${attempt.errorKind}`)}
                          </span>
                        )}
                        <span>{formatDuration(attempt.elapsedMs)}</span>
                        {attempt.bytes !== undefined && <span>{attempt.bytes} B</span>}
                        <span className="break-all text-muted-foreground">{attempt.url}</span>
                        {attempt.error && <span className="text-destructive">{attempt.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {catalogErrors[source] && (
                  <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                    {t('models.metadata.catalogSourceError', {
                      error: catalogErrors[source] ?? '',
                    })}
                    {status?.builtin
                      ? ` · ${t('models.metadata.catalogUsingBuiltin', {
                          date: formatDate(status.fetchedAt),
                        })}`
                      : ''}
                  </div>
                )}
              </div>
            )
          })}
          <p className="text-[11px] text-muted-foreground">
            {t('models.metadata.catalogLicenseNotice')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('models.metadata.queueTitle')}</CardTitle>
          <CardDescription>{t('models.metadata.queueDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {report.queue.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('models.metadata.emptyQueue')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('models.metadata.columnModel')}</TableHead>
                  <TableHead>{t('models.metadata.columnContext')}</TableHead>
                  <TableHead>{t('models.metadata.columnMaxOutput')}</TableHead>
                  <TableHead>{t('models.metadata.columnMissing')}</TableHead>
                  <TableHead className="text-right">{t('models.metadata.columnCalls')}</TableHead>
                  <TableHead className="text-right">{t('models.metadata.columnActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.queue.slice(0, 50).map((row) => {
                  const key = rowKey(row.providerId, row.displayName)
                  return (
                    <TableRow key={key}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <code className="rounded bg-muted px-2 py-1 text-sm">{row.displayName}</code>
                          <span className="text-[11px] text-muted-foreground">{row.providerId}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <FactCell fact={row.contextTokens} t={t} />
                      </TableCell>
                      <TableCell>
                        <FactCell fact={row.maxOutputTokens} t={t} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {!row.critical && (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t('models.metadata.referenceOnlyBadge')}
                            </Badge>
                          )}
                          {row.gapKind === 'not-chat' && (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t('models.metadata.gapKindNotChatBadge')}
                            </Badge>
                          )}
                          {row.gapKind === 'no-candidate' && (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t('models.metadata.gapKindNoCandidateBadge')}
                            </Badge>
                          )}
                          {row.missing
                            .filter((attribute) => attribute !== 'contextTokens' && attribute !== 'maxOutputTokens')
                            .slice(0, 4)
                            .map((attribute) => (
                              <Badge
                                key={attribute}
                                variant="outline"
                                className={row.critical ? 'text-warning' : 'text-muted-foreground'}
                              >
                                {t(ATTRIBUTE_LABEL_KEYS[attribute])}
                              </Badge>
                            ))}
                          {row.missing.length > 4 && (
                            <Badge variant="outline">+{row.missing.length - 4}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">{row.calls}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={running || batchActive}
                            onClick={() => setCatalogDialog(row)}
                          >
                            <Database className="mr-2 h-4 w-4" />
                            {t('models.metadata.annotate')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={batchActive || (running && probing !== key)}
                            onClick={() => void openSingle(row)}
                          >
                            {probing === key ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Radar className="mr-2 h-4 w-4" />
                            )}
                            {probing === key
                              ? t('models.metadata.probing')
                              : t('models.metadata.probe')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
          {report.queue.length > 50 && (
            <p className="pt-3 text-xs text-muted-foreground">
              {t('models.metadata.queueTruncated', { shown: 50, total: report.queue.length })}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(open) => (!open ? closeDialog() : undefined)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          {dialog?.mode === 'single' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('models.metadata.probeDialogTitle', { model: dialog.row.displayName })}</DialogTitle>
                <DialogDescription>{t('models.metadata.probeDialogDesc')}</DialogDescription>
              </DialogHeader>
              {activeJob && (
                <div className="space-y-2 rounded-md border border-info/40 bg-info/5 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-info">
                      {activeJob.phase === 'tier' || activeJob.phase === 'awaiting'
                        ? t(
                          activeJob.phase === 'tier'
                            ? 'models.metadata.probePhaseTier'
                            : 'models.metadata.probePhaseAwaiting',
                          {
                            index: activeJob.tierIndex ?? 0,
                            count: activeJob.tierCount ?? 0,
                            tokens: formatTokens(activeJob.tierTokens ?? 0),
                          },
                        )
                        : t(PROBE_PHASE_LABEL_KEYS[activeJob.phase])}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {t('models.metadata.probeElapsed', { seconds: elapsedSeconds })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span>
                      {t('models.metadata.probeRequestsSent', {
                        sent: activeJob.requestsSent,
                        limit: activeJob.requestLimit,
                      })}
                    </span>
                    {running && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => void cancelActiveProbe()}
                      >
                        {t('models.metadata.probeStop')}
                      </Button>
                    )}
                  </div>
                  {activeJob.requestLimit > 0 && (
                    <div className="h-1 w-full overflow-hidden rounded bg-muted">
                      <div
                        className="h-full bg-info transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round((activeJob.requestsSent / Math.max(1, activeJob.requestLimit)) * 100),
                          )}%`,
                        }}
                      />
                    </div>
                  )}
                  {activeJob.errorKind && (
                    <div className="text-destructive">
                      {t(PROBE_FAILURE_LABEL_KEYS[activeJob.errorKind])}
                      {activeJob.message ? ` · ${activeJob.message}` : ''}
                    </div>
                  )}
                </div>
              )}
              <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={force}
                  disabled={running}
                  onChange={(event) => setForce(event.target.checked)}
                />
                <span>
                  <span className="font-medium">{t('models.metadata.forceProbe')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('models.metadata.forceProbeHint')}
                  </span>
                </span>
              </label>
              <div className="space-y-3">
                {(['context', 'output'] as const).map((scope) => {
                  const fact = scopeFact(dialog.row, scope)
                  const declared = isDeclared(fact)
                  const plan = planFor(dialog.row, scope)
                  const blocked = declared && !force
                  return (
                    <div key={scope} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">
                            {scope === 'context'
                              ? t('models.metadata.probeContextScope')
                              : t('models.metadata.probeOutputScope')}
                          </div>
                          <div className="mt-1"><FactCell fact={fact} t={t} /></div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={running || blocked || plan.requestCount === 0}
                          onClick={() => void handleRunSingle(scope)}
                        >
                          {t('models.metadata.probe')}
                        </Button>
                      </div>
                      {blocked ? (
                        <p className="mt-2 text-xs text-success">
                          {t('models.metadata.probeDeclared')}
                          {fact.state === 'known'
                            ? ` · ${t('models.metadata.probeDeclaredSource', { source: t(SOURCE_LABEL_KEYS[fact.source] ?? '') })}`
                            : ''}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t('models.metadata.probeEstimate', {
                            requests: plan.requestCount,
                            tokens: formatTokens(plan.estimatedInputTokens + plan.estimatedOutputTokens),
                          })}
                          {' · '}
                          {t('models.metadata.probeEstimateSplit', {
                            input: formatTokens(plan.estimatedInputTokens),
                            output: formatTokens(plan.estimatedOutputTokens),
                          })}
                        </p>
                      )}
                    </div>
                  )
                })}
                <div className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{t('models.metadata.probeCapabilityScope')}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('models.metadata.probeEstimate', { requests: 3, tokens: 144 })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={running}
                      onClick={() => void handleRunSingle('capability')}
                    >
                      {t('models.metadata.probe')}
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                {activeJob && !running && lastScope
                  && (activeJob.status === 'failed'
                    || activeJob.status === 'cancelled'
                    || activeJob.result?.status === 'inconclusive') && (
                    <Button variant="outline" onClick={() => void handleRunSingle(lastScope)}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      {t('models.metadata.probeRetry')}
                    </Button>
                  )}
                <Button variant="ghost" onClick={closeDialog}>
                  {t('models.metadata.probeClose')}
                </Button>
              </DialogFooter>
            </>
          )}

        </DialogContent>
      </Dialog>

      <Dialog
        open={batchDialogOpen && batchSnapshot !== null}
        onOpenChange={(open) => (!open ? setBatchDialogOpen(false) : undefined)}
      >
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          {batchSnapshot && (
            <>
              <DialogHeader>
                <DialogTitle>{t('models.metadata.batchProgressTitle')}</DialogTitle>
                <DialogDescription>
                  {t(`models.metadata.batchPhase_${batchSnapshot.phase}`)}
                  {batchSnapshot.status === 'paused'
                    ? ` · ${t('models.metadata.batchPausedLabel')}`
                    : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {t('models.metadata.batchProcessed', {
                        done: batchSnapshot.processedModels,
                        total: batchSnapshot.totalModels,
                        percent: batchPercent,
                      })}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {t('models.metadata.batchElapsed', { time: formatDuration(batchElapsedMs) })}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-info transition-all"
                      style={{ width: `${batchPercent}%` }}
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {t('models.metadata.batchCurrentModel')}
                      {' · '}
                      <span className="font-medium text-foreground">
                        {batchSnapshot.currentModel ?? '—'}
                      </span>
                      {batchSnapshot.currentStatus
                        ? ` · ${t(`models.metadata.batchStatus_${batchSnapshot.currentStatus}`)}`
                        : ''}
                    </span>
                    <span className="tabular-nums">
                      {t('models.metadata.batchEta', {
                        time: batchSnapshot.estimatedRemainingMs === undefined
                          ? '—'
                          : formatDuration(batchSnapshot.estimatedRemainingMs),
                      })}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-md border p-3 text-center">
                  <div>
                    <div className="text-lg font-semibold text-success">{batchSnapshot.success}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t('models.metadata.batchSuccess')}
                    </div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{batchSnapshot.skipped}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t('models.metadata.batchSkippedCount')}
                    </div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-destructive">{batchSnapshot.failed}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t('models.metadata.batchFailedCount')}
                    </div>
                  </div>
                </div>

                {batchSnapshot.skippedDisabled > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {t('models.metadata.batchSkippedDisabled', {
                      count: batchSnapshot.skippedDisabled,
                    })}
                  </div>
                )}

                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>
                    {t('models.metadata.batchAdopted', {
                      fields: batchSnapshot.adoptedFields,
                      exact: batchSnapshot.exactAdoptedModels,
                      alias: batchSnapshot.aliasAdoptedModels.length,
                    })}
                  </div>
                  {batchSnapshot.measuredFields > 0 && (
                    <div>
                      {t('models.metadata.batchMeasuredFields', {
                        count: batchSnapshot.measuredFields,
                      })}
                    </div>
                  )}
                  {batchSnapshot.aliasAdoptedModels.length > 0 && (
                    <div className="break-all">
                      {t('models.metadata.batchAliasAdopted', {
                        models: batchSnapshot.aliasAdoptedModels.slice(0, 8).join('、'),
                      })}
                    </div>
                  )}
                  {batchSnapshot.familyCandidates > 0 && (
                    <div>
                      {t('models.metadata.batchFamilyCandidates', {
                        count: batchSnapshot.familyCandidates,
                      })}
                    </div>
                  )}
                  {batchSnapshot.probeEnabled && (
                    <div>
                      {t('models.metadata.batchProbeUsage', {
                        sent: batchSnapshot.requestsSent,
                        limit: batchSnapshot.requestLimit,
                      })}
                    </div>
                  )}
                </div>

                {batchBackoffSeconds > 0 && batchSnapshot.status === 'running' && (
                  <div className="rounded-md border border-warning/40 bg-warning/5 px-2 py-1 text-xs text-warning">
                    {t('models.metadata.batchBackoff', { seconds: batchBackoffSeconds })}
                  </div>
                )}

                {batchSnapshot.lastError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                    {batchSnapshot.lastError}
                  </div>
                )}

                {batchSnapshot.failedModels.length > 0
                  && (batchSnapshot.status === 'done'
                    || batchSnapshot.status === 'cancelled'
                    || batchSnapshot.status === 'failed') && (
                    <div className="space-y-0.5 rounded-md border p-2 text-xs">
                      <div className="font-medium">
                        {t('models.metadata.batchFailedList')}
                      </div>
                      {batchSnapshot.failedModels.slice(0, 8).map((failure) => (
                        <div key={`${failure.providerId}:${failure.displayName}`} className="flex flex-wrap gap-1.5">
                          <span className="font-medium">{failure.displayName}</span>
                          {failure.error && (
                            <span className="break-all text-destructive">{failure.error}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              <DialogFooter>
                {batchSnapshot.status === 'running' && (
                  <Button variant="outline" onClick={() => void pauseBatch()}>
                    {t('models.metadata.batchPause')}
                  </Button>
                )}
                {batchSnapshot.status === 'paused' && (
                  <Button variant="outline" onClick={() => void resumeBatch()}>
                    {t('models.metadata.batchResume')}
                  </Button>
                )}
                {batchActive && (
                  <Button variant="destructive" onClick={() => void cancelBatch()}>
                    {t('models.metadata.batchCancelRun')}
                  </Button>
                )}
                {!batchActive
                  && batchSnapshot.failedModels.length > 0
                  && batchSnapshot.status !== 'failed'
                  && (
                    <Button
                      variant="outline"
                      disabled={batchStarting}
                      onClick={() => void startBatch(batchSnapshot.probeEnabled, batchSnapshot.jobId)}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      {t('models.metadata.batchRetryFailed')}
                    </Button>
                  )}
                <Button variant="ghost" onClick={() => setBatchDialogOpen(false)}>
                  {t('models.metadata.probeClose')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={batchConfirmOpen && batchEstimate !== null}
        onOpenChange={(open) => (!open ? setBatchConfirmOpen(false) : undefined)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('models.metadata.batchConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('models.metadata.batchConfirmDesc')}</DialogDescription>
          </DialogHeader>
          {batchEstimate && (
            <div className="space-y-1 rounded-md border p-3 text-sm">
              <div>
                {t('models.metadata.batchModels', {
                  selected: batchEstimate.models,
                  total: batchEstimate.models + batchEstimate.skippedDisabled,
                })}
              </div>
              {batchEstimate.skippedDisabled > 0 && (
                <div className="text-xs text-muted-foreground">
                  {t('models.metadata.batchSkippedDisabled', {
                    count: batchEstimate.skippedDisabled,
                  })}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {t('models.metadata.batchFields', { count: batchEstimate.fields })}
                {' · '}
                {t('models.metadata.batchMatchBreakdown', {
                  exact: batchEstimate.exactModels,
                  alias: batchEstimate.aliasModels,
                  family: batchEstimate.familyCandidates,
                })}
              </div>
              <div>
                {t('models.metadata.batchProbeModels', { count: batchEstimate.probeModels })}
              </div>
              <div>
                {t('models.metadata.probeRequests', { count: batchEstimate.requests })}
                {' · '}
                {t('models.metadata.probeTokens', {
                  tokens: formatTokens(batchEstimate.tokens),
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t('models.metadata.batchConfirmOnce')}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBatchConfirmOpen(false)}>
              {t('models.metadata.batchConfirmCancel')}
            </Button>
            <Button
              disabled={batchStarting}
              onClick={() => void startBatch(true)}
            >
              {batchStarting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Radar className="mr-2 h-4 w-4" />
              )}
              {t('models.metadata.batchConfirmStart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {catalogDialog && (
        <ModelAnnotationDialog
          providerId={catalogDialog.providerId}
          displayName={catalogDialog.displayName}
          onClose={() => setCatalogDialog(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}

export default ModelMetadataPanel
