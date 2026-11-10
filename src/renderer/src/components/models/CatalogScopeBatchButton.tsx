/**
 * 「按这一家批量补全」：估算 → 确认 → 主进程跑任务 → 本行显示进度。
 *
 * 与「模型管理 › 元数据」里的全部补齐共用同一个主进程编排（`modelCatalogBatchRunner`），
 * 区别只有范围：`providerId` 传给估算与启动两端，确认弹窗里的数字就是实际要跑的数字。
 *
 * 纪律（和全局批量一样，不许放宽）：
 * - 标准库匹配不联网，只有勾上「同时执行探测」才会按账户真实发请求，所以默认不勾；
 * - 必须先估算再确认，界面没有跳过确认直接启动的路径；
 * - 任务仍在主进程串行执行，关掉弹窗不打断，重开靠 `getCatalogBatchJobs` 回显。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Wand2 } from 'lucide-react'
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
import { useToast } from '@/hooks/use-toast'
import type {
  CatalogBatchEstimate,
  CatalogBatchSnapshot,
} from '@shared/modelCatalogBatch'
import { isCatalogBatchActive } from '@shared/modelCatalogBatch'
import { formatTokens } from './ModelAnnotationDialog'

export interface CatalogScopeBatchButtonProps {
  /** 渠道 id / 聚合条目 id —— 两侧的供应商记录 id 与目录条目 id 同名。 */
  providerId: string
  /** 确认弹窗标题里的范围名称。 */
  scopeLabel: string
  /** 任务结束后通知宿主刷新（采用的是异步写入，宿主重读目录才能看到新值）。 */
  onFinished?: () => void
  /** 未连上的渠道没有目录可补，宿主据此关掉入口。 */
  disabled?: boolean
}

export function CatalogScopeBatchButton({
  providerId,
  scopeLabel,
  onFinished,
  disabled = false,
}: CatalogScopeBatchButtonProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [estimate, setEstimate] = useState<CatalogBatchEstimate | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [probing, setProbing] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [snapshot, setSnapshot] = useState<CatalogBatchSnapshot | null>(null)
  /** 另一个范围的 active job：全局补齐或别的渠道。它挡住本家启动时必须可见、可取消。 */
  const [otherJob, setOtherJob] = useState<CatalogBatchSnapshot | null>(null)

  // 只认领本范围启动的任务：全局「全部补齐」的进度不该显示在这个渠道的卡片上。
  // 其它范围的任务单独收进 `otherJob`，否则用户只会收到一句「已有任务在进行」却看不到它。
  const acceptProgress = useCallback((job: CatalogBatchSnapshot) => {
    if (job.providerScope === providerId) {
      setSnapshot(job)
      return
    }
    if (isCatalogBatchActive(job.status)) {
      setOtherJob(job)
    } else {
      setOtherJob(prev => (prev?.jobId === job.jobId ? null : prev))
    }
  }, [providerId])

  useEffect(() => {
    const api = window.electronAPI?.providers
    if (!api?.onCatalogBatchProgress) return
    const unsubscribe = api.onCatalogBatchProgress(acceptProgress)
    return unsubscribe
  }, [acceptProgress])

  // 重开界面时回显：任务在主进程继续，不因弹窗关闭而中断。
  useEffect(() => {
    const api = window.electronAPI?.providers
    if (!api?.getCatalogBatchJobs) return
    void api.getCatalogBatchJobs()
      .then((jobs) => {
        const active = jobs.find((job) => isCatalogBatchActive(job.status))
        if (!active) return
        if (active.providerScope === providerId) setSnapshot(active)
        else setOtherJob(active)
      })
      .catch(() => undefined)
  }, [providerId])

  const active = snapshot !== null && isCatalogBatchActive(snapshot.status)

  const start = useCallback(async () => {
    const api = window.electronAPI?.providers
    if (!api?.startCatalogBatch) return
    setStarting(true)
    try {
      const result = await api.startCatalogBatch({ probe: probing, providerId })
      if (!result.success) {
        // 被别的 active job 挡住时，把那个任务本身摆到界面上：只报一句「已有任务在进行」，
        // 用户在这个页面既看不到进度也没有取消入口，等于死路。
        setConfirmOpen(false)
        if (result.snapshot && isCatalogBatchActive(result.snapshot.status)) {
          if (result.snapshot.providerScope === providerId) setSnapshot(result.snapshot)
          else setOtherJob(result.snapshot)
        }
        toast({
          title: t('models.metadata.batchScopeFailedStart'),
          description: result.error ?? scopeLabel,
          variant: 'destructive',
        })
        return
      }
      setConfirmOpen(false)
      setEstimate(null)
      if (result.snapshot) setSnapshot(result.snapshot)
    } catch (error) {
      toast({
        title: t('models.metadata.batchScopeFailedStart'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setStarting(false)
    }
  }, [probing, providerId, scopeLabel, t, toast])

  const begin = useCallback(async () => {
    const api = window.electronAPI?.providers
    if (!api?.estimateCatalogBatch) return
    setEstimating(true)
    try {
      const result = await api.estimateCatalogBatch(providerId)
      if (result.models === 0) {
        // 没有活可干必须说原因：静默按钮无响应会被读成「补全失败了」。
        toast({
          title: t('models.metadata.batchNoTargets'),
          description: t('models.metadata.batchScopeNone'),
        })
        return
      }
      setEstimate(result)
      setProbing(false)
      setConfirmOpen(true)
    } catch (error) {
      toast({
        title: t('models.metadata.batchScopeEstimateFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setEstimating(false)
    }
  }, [providerId, t, toast])

  // 任务收尾：一次通知宿主刷新，一次把结果说清。
  // 只在「进行中 → 结束」这条边上触发：回显出来的历史任务不能再弹一次吐司。
  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (active) {
      wasActiveRef.current = true
      return
    }
    if (!wasActiveRef.current || snapshot === null) return
    wasActiveRef.current = false
    // 三态里的 `done` 包含「没有可做的事」：只报成功数会让一次空跑看起来像补全成功。
    // 采用了 0 个字段且没有实测时换一句标题，并始终把 adopted 数写进汇总。
    const noChange =
      snapshot.status === 'done'
      && snapshot.adoptedFields === 0
      && snapshot.measuredFields === 0
    const title = snapshot.status === 'cancelled'
      ? t('models.metadata.batchScopeCancelled')
      : snapshot.status === 'failed'
        ? t('models.metadata.batchScopeFailedStart')
        : noChange
          ? t('models.metadata.batchScopeNoChangeTitle')
          : t('models.metadata.batchScopeDone')
    toast({
      title,
      description: t('models.metadata.batchScopeSummary', {
        success: snapshot.success,
        skipped: snapshot.skipped,
        failed: snapshot.failed,
        fields: snapshot.adoptedFields,
      }),
      variant: snapshot.failed > 0 ? 'destructive' : 'default',
    })
    onFinished?.()
  }, [active, onFinished, snapshot, t, toast])

  const control = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
    const api = window.electronAPI?.providers
    const jobId = snapshot?.jobId
    if (!jobId) return
    if (action === 'pause') await api?.pauseCatalogBatch?.(jobId)
    if (action === 'resume') await api?.resumeCatalogBatch?.(jobId)
    if (action === 'cancel') await api?.cancelCatalogBatch?.(jobId)
  }, [snapshot?.jobId])

  const cancelOther = useCallback(async () => {
    const jobId = otherJob?.jobId
    if (!jobId) return
    const cancelled = await window.electronAPI?.providers?.cancelCatalogBatch?.(jobId)
    // 任务可能刚好在点击前结束：主进程说没取消成，就把这条提示收掉，不等一个不会来的事件。
    if (cancelled === false) setOtherJob(null)
  }, [otherJob?.jobId])

  const otherActive = otherJob !== null && isCatalogBatchActive(otherJob.status)

  // 估算里有模型但一个可自动采用的字段都没有时，启动只会得到一次「全部 done、adopted=0」的空跑。
  // 探测本身就是一份真实工作量，所以勾上探测且确有可探测模型时放行。
  const probeWillRun = probing && (estimate?.probeModels ?? 0) > 0
  const nothingToDo = estimate !== null && estimate.fields === 0 && !probeWillRun

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || estimating || active || otherActive}
        onClick={() => void begin()}
        title={t('models.metadata.batchScopeDesc')}
      >
        {estimating || starting
          ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          : <Wand2 className="mr-1.5 h-4 w-4" />}
        {active ? t('models.metadata.batchViewProgress') : t('models.metadata.batchScopeButton')}
      </Button>

      {snapshot && active && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
          <span className="font-medium">{t('models.metadata.batchScopeProgressTitle')}</span>
          <Badge variant="outline">
            {snapshot.status === 'paused'
              ? t('models.metadata.batchPausedLabel')
              : t(`models.metadata.batchPhase_${snapshot.phase}`)}
          </Badge>
          <span>
            {t('models.metadata.batchProcessed', {
              done: snapshot.processedModels,
              total: snapshot.totalModels,
              percent: snapshot.totalModels > 0
                ? Math.min(100, Math.round((snapshot.processedModels / snapshot.totalModels) * 100))
                : 0,
            })}
          </span>
          <span className="text-muted-foreground">
            {t('models.metadata.batchAdopted', {
              fields: snapshot.adoptedFields,
              exact: snapshot.exactAdoptedModels,
              alias: snapshot.aliasAdoptedModels.length,
            })}
          </span>
          {snapshot.currentModel && (
            <span className="truncate text-muted-foreground" title={snapshot.currentModel}>
              {t('models.metadata.batchCurrentModel')}: {snapshot.currentModel}
            </span>
          )}
          {snapshot.probeEnabled && (
            <span className="text-muted-foreground">
              {t('models.metadata.batchProbeUsage', {
                sent: snapshot.requestsSent,
                limit: snapshot.requestLimit,
              })}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {snapshot.status === 'running' && (
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => void control('pause')}>
                {t('models.metadata.batchPause')}
              </Button>
            )}
            {snapshot.status === 'paused' && (
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => void control('resume')}>
                {t('models.metadata.batchResume')}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => void control('cancel')}>
              {t('models.metadata.batchCancelRun')}
            </Button>
          </span>
        </div>
      )}

      <Dialog open={confirmOpen && estimate !== null} onOpenChange={(open) => (!open ? setConfirmOpen(false) : undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('models.metadata.batchScopeTitle', { scope: scopeLabel })}</DialogTitle>
            <DialogDescription>{t('models.metadata.batchScopeDesc')}</DialogDescription>
          </DialogHeader>
          {estimate && (
            <ul className="space-y-1 text-sm">
              <li>{t('models.metadata.batchModels', { selected: estimate.models })}</li>
              <li>{t('models.metadata.batchFields', { count: estimate.fields })}</li>
              <li>
                {t('models.metadata.batchMatchBreakdown', {
                  exact: estimate.exactModels,
                  alias: estimate.aliasModels,
                  family: estimate.familyCandidates,
                })}
              </li>
              <li>{t('models.metadata.batchProbeModels', { count: estimate.probeModels })}</li>
              <li>
                {t('models.metadata.probeRequests', { count: estimate.requests })}
                {' · '}
                {t('models.metadata.probeTokens', { tokens: formatTokens(estimate.tokens) })}
              </li>
              <li>{t('models.metadata.batchSkippedDisabled', { count: estimate.skippedDisabled })}</li>
            </ul>
          )}
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]"
              checked={probing}
              onChange={(event) => setProbing(event.target.checked)}
            />
            <span>
              {t('models.metadata.batchProbeToggle')}
              <span className="block text-[11px] text-muted-foreground">
                {t('models.metadata.batchProbeToggleHint')}
              </span>
            </span>
          </label>
          {nothingToDo && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {estimate.probeModels > 0
                ? t('models.metadata.batchScopeNothingAdoptable', { count: estimate.probeModels })
                : t('models.metadata.batchScopeNothingAtAll')}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)} disabled={starting}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => void start()} disabled={starting || nothingToDo}>
              {starting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {t('models.metadata.batchConfirmStart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {otherActive && otherJob && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs">
          <span className="font-medium">
            {t('models.metadata.batchOtherJobTitle', {
              scope: otherJob.providerScope ?? t('models.metadata.batchAll'),
            })}
          </span>
          <Badge variant="outline">
            {otherJob.status === 'paused'
              ? t('models.metadata.batchPausedLabel')
              : t(`models.metadata.batchPhase_${otherJob.phase}`)}
          </Badge>
          <span>
            {t('models.metadata.batchProcessed', {
              done: otherJob.processedModels,
              total: otherJob.totalModels,
              percent: otherJob.totalModels > 0
                ? Math.min(100, Math.round((otherJob.processedModels / otherJob.totalModels) * 100))
                : 0,
            })}
          </span>
          {otherJob.currentModel && (
            <span className="truncate text-muted-foreground" title={otherJob.currentModel}>
              {t('models.metadata.batchCurrentModel')}: {otherJob.currentModel}
            </span>
          )}
          <span className="ml-auto">
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => void cancelOther()}>
              {t('models.metadata.batchOtherJobCancel')}
            </Button>
          </span>
        </div>
      )}
    </>
  )
}

export default CatalogScopeBatchButton
