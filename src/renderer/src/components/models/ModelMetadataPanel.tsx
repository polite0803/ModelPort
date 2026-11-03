import { useCallback, useEffect, useState } from 'react'
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
import { Database, Loader2, RefreshCw, Radar } from 'lucide-react'
import type { ModelMetadataReport, Fact, MetadataAttribute, ModelMetadataRow } from '@shared/modelMetadata'
import { METADATA_ATTRIBUTES } from '@shared/modelMetadata'
import type {
  CatalogAdoptionField,
  CatalogCandidatesResult,
  CatalogEntry,
  CatalogMatchConfidence,
  CatalogPrice,
  CatalogSnapshotStatus,
  CatalogSourceId,
} from '@shared/modelCatalog'
import {
  CATALOG_ADOPTION_FIELDS,
  CATALOG_SOURCES,
  CATALOG_SOURCE_META,
  catalogFieldValue,
} from '@shared/modelCatalog'
import { familyRuleLayer } from '@shared/modelFamilyRules'
import {
  planContextProbe,
  planOutputProbe,
  type ProbePlan,
  type ProbeScope,
} from '@shared/modelProbe'

const ATTRIBUTE_LABEL_KEYS: Record<MetadataAttribute, string> = {
  modelType: 'models.metadata.attrModelType',
  vision: 'models.metadata.attrVision',
  tools: 'models.metadata.attrTools',
  reasoning: 'models.metadata.attrReasoning',
  modalities: 'models.metadata.attrModalities',
  contextTokens: 'models.metadata.attrContextTokens',
  maxOutputTokens: 'models.metadata.attrMaxOutputTokens',
  weight: 'models.metadata.attrWeight',
  free: 'models.metadata.attrFree',
}

const SOURCE_LABEL_KEYS: Record<string, string> = {
  manual: 'models.metadata.sourceManual',
  upstream: 'models.metadata.sourceUpstream',
  catalog: 'models.metadata.sourceCatalog',
  'family-rule': 'models.metadata.sourceFamilyRule',
  probe: 'models.metadata.sourceProbe',
  'cost-ledger': 'models.metadata.sourceCostLedger',
  unclassified: 'models.metadata.sourceUnclassified',
}

const CONFIDENCE_LABEL_KEYS: Record<string, string> = {
  declared: 'models.metadata.confidenceDeclared',
  inferred: 'models.metadata.confidenceInferred',
  measured: 'models.metadata.confidenceMeasured',
}

const SOURCE_TONE: Record<string, string> = {
  manual: 'text-primary',
  upstream: 'text-success',
  catalog: 'text-info',
  'family-rule': 'text-warning',
  probe: 'text-info',
  'cost-ledger': 'text-muted-foreground',
}

const CATALOG_CONFIDENCE_LABEL_KEYS: Record<CatalogMatchConfidence, string> = {
  exact: 'models.metadata.catalogConfidenceExact',
  alias: 'models.metadata.catalogConfidenceAlias',
  family: 'models.metadata.catalogConfidenceFamily',
}

const CATALOG_CONFIDENCE_TONE: Record<CatalogMatchConfidence, string> = {
  exact: 'text-success',
  alias: 'text-warning',
  family: 'text-muted-foreground',
}

const CATALOG_FIELD_LABEL_KEYS: Record<CatalogAdoptionField, string> = {
  contextTokens: 'models.metadata.attrContextTokens',
  maxOutputTokens: 'models.metadata.attrMaxOutputTokens',
  price: 'models.metadata.catalogFieldPrice',
  modalities: 'models.metadata.attrModalities',
  vision: 'models.metadata.attrVision',
  tools: 'models.metadata.attrTools',
}

/** 采用条目里每个字段的展示值；价格只以 USD / 1M tokens 说明，不换算。 */
function formatCatalogValue(field: CatalogAdoptionField, value: unknown, t: (key: string) => string): string {
  if (field === 'price') {
    const price = value as CatalogPrice | undefined
    if (!price) return '—'
    const parts: string[] = []
    if (price.inputPerMillion !== undefined) parts.push(`in $${price.inputPerMillion}`)
    if (price.outputPerMillion !== undefined) parts.push(`out $${price.outputPerMillion}`)
    return `${parts.join(' · ')} / 1M`
  }
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(' + ')
  if (value === 'yes') return t('models.metadata.catalogYes')
  if (value === 'no') return t('models.metadata.catalogNo')
  if (typeof value === 'number') return formatTokens(value)
  return value === undefined ? '—' : String(value)
}

function entryValue(entry: CatalogEntry, field: CatalogAdoptionField): unknown {
  return catalogFieldValue(entry, field)
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  measured: 'models.metadata.probeStatusMeasured',
  inconclusive: 'models.metadata.probeStatusInconclusive',
  suspect: 'models.metadata.probeStatusSuspect',
  deferred: 'models.metadata.probeStatusDeferred',
  skipped: 'models.metadata.probeStatusSkipped',
}

const BATCH_LIMIT = 10

type ProbeDialog =
  | { mode: 'single'; row: ModelMetadataRow }
  | { mode: 'batch'; items: { row: ModelMetadataRow; scopes: ProbeScope[] }[] }

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`
  return String(value)
}

function formatBound(atLeast?: number, below?: number): string {
  const parts: string[] = []
  if (atLeast !== undefined) parts.push(`≥${formatTokens(atLeast)}`)
  if (below !== undefined) parts.push(`<${formatTokens(below)}`)
  return parts.join(', ')
}

function FactCell({
  fact,
  t,
}: {
  fact: Fact<unknown>
  t: (key: string) => string
}) {
  if (fact.state === 'unclassified') {
    return <span className="text-xs text-muted-foreground">{t('models.metadata.unclassified')}</span>
  }
  const display = Array.isArray(fact.value)
    ? fact.value.join(' + ')
    : typeof fact.value === 'number'
      ? formatTokens(fact.value)
      : String(fact.value)
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm">{display}</span>
      <span className={`text-[11px] ${SOURCE_TONE[fact.source] ?? 'text-muted-foreground'}`}>
        {t(SOURCE_LABEL_KEYS[fact.source] ?? 'models.metadata.sourceUnclassified')}
        {fact.confidence !== 'declared'
          ? ` · ${t(CONFIDENCE_LABEL_KEYS[fact.confidence] ?? '')}`
          : ''}
      </span>
    </div>
  )
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

function batchItemsOf(queue: ModelMetadataRow[]): { row: ModelMetadataRow; scopes: ProbeScope[] }[] {
  return queue
    .slice(0, BATCH_LIMIT)
    .map((row) => {
      const scopes: ProbeScope[] = []
      // 推定值（家族规则/第三方）也值得实测对比；声明级与已实测的不再重复。
      const contextProbeable = row.contextTokens.state !== 'known' || row.contextTokens.confidence === 'inferred'
      const outputProbeable = row.maxOutputTokens.state !== 'known' || row.maxOutputTokens.confidence === 'inferred'
      if (contextProbeable) scopes.push('context')
      if (outputProbeable) scopes.push('output')
      return { row, scopes }
    })
    .filter((item) => item.scopes.length > 0)
}

/**
 * 标准库候选对话框：三档置信度只用于排序，永不自动采用。
 * 每个字段单独「采用」，「撤销」回到自动解析结果；刷新快照不在这个对话框里发生。
 */
function CatalogDialog({
  row,
  onClose,
  onChanged,
}: {
  row: ModelMetadataRow
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [data, setData] = useState<CatalogCandidatesResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!window.electronAPI?.providers?.getCatalogCandidates) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await window.electronAPI.providers.getCatalogCandidates(
        row.providerId,
        row.displayName,
      )
      setData(result)
    } catch (cause) {
      toast({
        title: t('models.metadata.catalogFailed'),
        description: cause instanceof Error ? cause.message : row.displayName,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [row.displayName, row.providerId, t, toast])

  useEffect(() => {
    void load()
  }, [load])

  const adopt = useCallback(
    async (entry: CatalogEntry, field: CatalogAdoptionField) => {
      if (!window.electronAPI?.providers?.adoptCatalogField) return
      setBusy(`${entry.catalogId}\u0000${field}`)
      try {
        const result = await window.electronAPI.providers.adoptCatalogField(
          row.providerId,
          row.displayName,
          entry.catalogId,
          field,
        )
        if (!result.success) {
          toast({
            title: t('models.metadata.catalogFailed'),
            description: result.error ?? row.displayName,
            variant: 'destructive',
          })
          return
        }
        setData((current) =>
          current ? { ...current, adoptions: result.adoptions ?? current.adoptions } : current,
        )
        onChanged()
        toast({
          title: t('models.metadata.catalogAdopted'),
          description: `${row.displayName} · ${t(CATALOG_FIELD_LABEL_KEYS[field])}`,
        })
      } finally {
        setBusy(null)
      }
    },
    [onChanged, row.displayName, row.providerId, t, toast],
  )

  const revoke = useCallback(
    async (field?: CatalogAdoptionField) => {
      if (!window.electronAPI?.providers?.revokeCatalogAdoption) return
      setBusy(`revoke\u0000${field ?? 'all'}`)
      try {
        const result = await window.electronAPI.providers.revokeCatalogAdoption(
          row.providerId,
          row.displayName,
          field,
        )
        if (!result.success) {
          toast({
            title: t('models.metadata.catalogFailed'),
            description: result.error ?? row.displayName,
            variant: 'destructive',
          })
          return
        }
        setData((current) =>
          current ? { ...current, adoptions: result.adoptions ?? current.adoptions } : current,
        )
        onChanged()
        toast({ title: t('models.metadata.catalogRevoked'), description: row.displayName })
      } finally {
        setBusy(null)
      }
    },
    [onChanged, row.displayName, row.providerId, t, toast],
  )

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('models.metadata.catalogDialogTitle', { model: row.displayName })}</DialogTitle>
          <DialogDescription>{t('models.metadata.catalogDialogDesc')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('models.metadata.catalogLoading')}
          </div>
        ) : (
          <div className="space-y-4">
            {data && data.adoptions.length > 0 && (
              <section className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t('models.metadata.catalogAdoptedTitle')}</span>
                  {data.adoptions.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void revoke()}
                    >
                      {t('models.metadata.catalogRevokeAll')}
                    </Button>
                  )}
                </div>
                {data.adoptions.map((adoption) => (
                  <div
                    key={`${adoption.field}\u0000${adoption.catalogId}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="flex flex-col">
                      <span>
                        {t(CATALOG_FIELD_LABEL_KEYS[adoption.field])}
                        {' · '}
                        {formatCatalogValue(adoption.field, adoption.value, t)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {CATALOG_SOURCE_META[adoption.source].label}
                        {' · '}
                        <code>{adoption.catalogId}</code>
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void revoke(adoption.field)}
                    >
                      {t('models.metadata.catalogRevoke')}
                    </Button>
                  </div>
                ))}
              </section>
            )}

            {data && data.matches.length === 0 ? (
              <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                {t('models.metadata.catalogNoMatches')}
              </div>
            ) : (
              <section className="space-y-3">
                {(data?.matches ?? []).map((match) => {
                  const entry = match.entry
                  return (
                    <div key={entry.catalogId} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant="outline" className={CATALOG_CONFIDENCE_TONE[match.confidence]}>
                          {t(CATALOG_CONFIDENCE_LABEL_KEYS[match.confidence])}
                        </Badge>
                        <code className="rounded bg-muted px-2 py-0.5">{entry.id}</code>
                        {entry.provider && (
                          <span className="text-xs text-muted-foreground">{entry.provider}</span>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {CATALOG_SOURCE_META[entry.source].label}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1.5">
                        {CATALOG_ADOPTION_FIELDS.map((field) => {
                          const value = entryValue(entry, field)
                          const adopted = data?.adoptions.find((item) => item.field === field)
                          const same = adopted?.catalogId === entry.catalogId
                          return (
                            <div key={field} className="flex items-center justify-between gap-3 text-sm">
                              <div className="flex flex-col">
                                <span className="text-xs text-muted-foreground">
                                  {t(CATALOG_FIELD_LABEL_KEYS[field])}
                                  {field === 'price' && ` · ${t('models.metadata.catalogPriceHint')}`}
                                </span>
                                <span>{formatCatalogValue(field, value, t)}</span>
                                {adopted && !same && (
                                  <span className="text-[11px] text-warning">
                                    {t('models.metadata.catalogAdoptedOther', { id: adopted.catalogId })}
                                  </span>
                                )}
                              </div>
                              {same ? (
                                <Badge variant="outline" className="shrink-0 text-success">
                                  {t('models.metadata.catalogAdoptedBadge')}
                                </Badge>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="shrink-0"
                                  disabled={value === undefined || busy !== null}
                                  onClick={() => void adopt(entry, field)}
                                >
                                  {busy === `${entry.catalogId}\u0000${field}` ? (
                                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                  ) : null}
                                  {t('models.metadata.catalogAdopt')}
                                </Button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
            {t('models.metadata.probeCancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [catalogStatuses, setCatalogStatuses] = useState<CatalogSnapshotStatus[]>([])
  const [refreshingCatalog, setRefreshingCatalog] = useState<CatalogSourceId | null>(null)
  const [catalogDialog, setCatalogDialog] = useState<ModelMetadataRow | null>(null)

  const loadCatalog = useCallback(async () => {
    if (!window.electronAPI?.providers?.getCatalogStatuses) return
    try {
      // 只读磁盘元数据；打开页面不联网。
      setCatalogStatuses(await window.electronAPI.providers.getCatalogStatuses())
    } catch {
      // 快照读不出来只影响补全卡片，不让整页报表失败。
    }
  }, [])

  const refreshCatalogSource = useCallback(
    async (source: CatalogSourceId) => {
      if (!window.electronAPI?.providers?.refreshCatalog) return
      setRefreshingCatalog(source)
      try {
        const result = await window.electronAPI.providers.refreshCatalog(source)
        setCatalogStatuses(result.statuses)
        if (result.success) {
          toast({
            title: t('models.metadata.catalogRefreshDone'),
            description: CATALOG_SOURCE_META[source].label,
          })
        } else {
          toast({
            title: t('models.metadata.catalogRefreshFailed'),
            description: `${result.error ?? ''} · ${t('models.metadata.catalogKeptOld')}`,
            variant: 'destructive',
          })
        }
      } catch (cause) {
        toast({
          title: t('models.metadata.catalogRefreshFailed'),
          description: `${cause instanceof Error ? cause.message : ''} · ${t('models.metadata.catalogKeptOld')}`,
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

  const closeDialog = useCallback(() => {
    if (running) return
    setDialog(null)
    setForce(false)
    setProgress({ done: 0, total: 0 })
  }, [running])

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
      setRunning(true)
      try {
        await runOne(dialog.row, scope)
      } finally {
        setRunning(false)
        setDialog(null)
      }
    },
    [dialog, runOne],
  )

  const handleRunBatch = useCallback(async () => {
    if (!dialog || dialog.mode !== 'batch') return
    if (!window.electronAPI?.providers?.probeModel) return
    const items = dialog.items
    const total = items.reduce((count, item) => count + item.scopes.length, 0)
    setRunning(true)
    setProgress({ done: 0, total })
    let done = 0
    let failures = 0
    for (const item of items) {
      for (const scope of item.scopes) {
        const response = await window.electronAPI.providers.probeModel(
          item.row.providerId,
          item.row.displayName,
          scope,
          false,
        )
        if (!response.success) failures += 1
        done += 1
        setProgress({ done, total })
      }
    }
    await load()
    setRunning(false)
    setDialog(null)
    setProgress({ done: 0, total: 0 })
    toast({
      title: t('models.metadata.batchDone'),
      description: failures > 0
        ? `${done - failures}/${total} · ${failures} ${t('models.metadata.probeFailed')}`
        : `${done}/${total}`,
      ...(failures > 0 ? { variant: 'destructive' as const } : {}),
    })
  }, [dialog, load, t, toast])

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

  const coverageRows = METADATA_ATTRIBUTES.map((attribute) => ({
    attribute,
    ...report.coverage[attribute],
    gap: report.coverageGaps[attribute],
  }))
  const batchItems = batchItemsOf(report.queue)
  const batchPlanTotals = batchItems.reduce(
    (totals, item) => {
      for (const scope of item.scopes) {
        const plan = planFor(item.row, scope as 'context' | 'output')
        totals.requests += plan.requestCount
        totals.tokens += plan.estimatedInputTokens + plan.estimatedOutputTokens
      }
      return totals
    },
    { requests: 0, tokens: 0 },
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{t('models.metadata.coverageTitle')}</CardTitle>
            <CardDescription>{t('models.metadata.coverageDesc')}</CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {batchItems.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={running}
                onClick={() => {
                  setForce(false)
                  setDialog({ mode: 'batch', items: batchItems })
                }}
              >
                <Radar className="mr-2 h-4 w-4" />
                {t('models.metadata.batchProbe')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {t('models.metadata.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t('models.metadata.totalModels')}</div>
              <div className="text-2xl font-semibold">{report.totals.models}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t('models.metadata.annotated')}</div>
              <div className="text-2xl font-semibold text-success">{report.totals.annotated}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t('models.metadata.unclassifiedCount')}</div>
              <div className="text-2xl font-semibold text-warning">{report.totals.unclassified}</div>
            </div>
          </div>

          <div className="space-y-2">
            {coverageRows.map((row) => (
              <div key={row.attribute} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-sm">{t(ATTRIBUTE_LABEL_KEYS[row.attribute])}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round(row.rate * 100)}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                  {Math.round(row.rate * 100)}% · {row.known}/{row.total}
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
                      {t('models.metadata.catalogFetchedAt', {
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
                          {row.missing
                            .filter((attribute) => attribute !== 'contextTokens' && attribute !== 'maxOutputTokens')
                            .slice(0, 4)
                            .map((attribute) => (
                              <Badge key={attribute} variant="outline" className="text-warning">
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
                            disabled={running}
                            onClick={() => setCatalogDialog(row)}
                          >
                            <Database className="mr-2 h-4 w-4" />
                            {t('models.metadata.catalogComplete')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={probing === key || running}
                            onClick={() => {
                              setForce(false)
                              setDialog({ mode: 'single', row })
                            }}
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
        <DialogContent className="max-w-xl">
          {dialog?.mode === 'single' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('models.metadata.probeDialogTitle', { model: dialog.row.displayName })}</DialogTitle>
                <DialogDescription>{t('models.metadata.probeDialogDesc')}</DialogDescription>
              </DialogHeader>
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
                <Button variant="ghost" onClick={closeDialog} disabled={running}>
                  {t('models.metadata.probeCancel')}
                </Button>
              </DialogFooter>
            </>
          )}

          {dialog?.mode === 'batch' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('models.metadata.batchTitle')}</DialogTitle>
                <DialogDescription>
                  {t('models.metadata.batchDesc', {
                    requests: batchPlanTotals.requests,
                    tokens: formatTokens(batchPlanTotals.tokens),
                  })}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <div className="flex justify-between">
                  <span>{t('models.metadata.batchModels', { count: dialog.items.length })}</span>
                  <span className="text-muted-foreground">
                    {t('models.metadata.probeRequests', { count: batchPlanTotals.requests })}
                    {' · '}
                    {t('models.metadata.probeTokens', { tokens: formatTokens(batchPlanTotals.tokens) })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{t('models.metadata.batchSkipped')}</p>
                {running && (
                  <p className="text-xs text-info">
                    {t('models.metadata.batchRunning', { done: progress.done, total: progress.total })}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={closeDialog} disabled={running}>
                  {t('models.metadata.probeCancel')}
                </Button>
                <Button onClick={() => void handleRunBatch()} disabled={running || batchPlanTotals.requests === 0}>
                  {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
                  {t('models.metadata.batchStart')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {catalogDialog && (
        <CatalogDialog
          row={catalogDialog}
          onClose={() => setCatalogDialog(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}

export default ModelMetadataPanel
