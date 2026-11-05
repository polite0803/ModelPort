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

  // 只认领本范围启动的任务：全局「全部补齐」的进度不该显示在这个渠道的卡片上。
  const acceptProgress = useCallback((job: CatalogBatchSnapshot) => {
    if (job.providerScope !== providerId) return
    setSnapshot(job)
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
        const mine = jobs.filter((job) => job.providerScope === providerId)
        const active = mine.find((job) => isCatalogBatchActive(job.status))
        if (active) setSnapshot(active)
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
    const title = snapshot.status === 'cancelled'
      ? t('models.metadata.batchScopeCancelled')
      : snapshot.status === 'failed'
        ? t('models.metadata.batchScopeFailedStart')
        : t('models.metadata.batchScopeDone')
    toast({
      title,
      description: t('models.metadata.batchSummary', {
        success: snapshot.success,
        skipped: snapshot.skipped,
        failed: snapshot.failed,
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

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || estimating || active}
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
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)} disabled={starting}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => void start()} disabled={starting}>
              {starting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {t('models.metadata.batchConfirmStart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default CatalogScopeBatchButton
