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
import { Loader2, RefreshCw, Radar } from 'lucide-react'
import type { ModelMetadataReport, Fact, MetadataAttribute, ModelMetadataRow } from '@shared/modelMetadata'
import { METADATA_ATTRIBUTES } from '@shared/modelMetadata'
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
  'family-rule': 'text-warning',
  probe: 'text-info',
  'cost-ledger': 'text-muted-foreground',
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
  }, [load])

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
    </div>
  )
}

export default ModelMetadataPanel
