/**
 * 模型参数对话框（通用）：目前承载「上下文窗口档位」。
 *
 * 为什么单独一个对话框：窗口档是**模型级**设置，而它能从三个地方打开模型——路由页、
 * 渠道页、聚合详情。聚合详情那边另有一个带 temperature 等请求参数的完整版本；这里
 * 只放所有宿主都有的那一格，保证「哪里能标注，哪里就能设参数」。
 *
 * 存储仍是手工标注（`userModelMarks`）：网关裁剪与 `/v1/models` 都从那里读。写之前
 * 先读现有标注再合并 —— `setModelMark` 是整表覆盖，直接写会把 vision / modalities
 * 一起抹掉。
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CONTEXT_WINDOW_TIERS, type ContextWindowTier, type ModelCapabilityHint } from '@shared/types'

export interface ModelParamsDialogProps {
  providerId: string
  displayName: string
  modelLabel?: string
  onClose: () => void
  onSaved?: () => void
}

const TIERS: ContextWindowTier[] = ['200k', '400k', '1m']

export function ModelParamsDialog({
  providerId,
  displayName,
  modelLabel,
  onClose,
  onSaved,
}: ModelParamsDialogProps) {
  const { t } = useTranslation()
  const [tier, setTier] = useState<ContextWindowTier | null>(null)
  const [declared, setDeclared] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const api = window.electronAPI?.providers
      const marks = api?.getModelMarks ? await api.getModelMarks() : undefined
      if (cancelled) return
      setTier(marks?.[providerId]?.[displayName]?.contextWindowTier ?? null)
      const meta = api?.getModelMetadataOne ? await api.getModelMetadataOne(providerId, displayName) : undefined
      const fact = meta?.success ? meta.metadata?.contextTokens : undefined
      const value = fact !== undefined && fact.state === 'known' ? fact.value : undefined
      if (!cancelled) setDeclared(typeof value === 'number' && value > 0 ? value : null)
    })()
    return () => {
      cancelled = true
    }
  }, [displayName, providerId])

  const tooLarge = useCallback(
    (candidate: ContextWindowTier): boolean =>
      declared !== null && CONTEXT_WINDOW_TIERS[candidate] > declared,
    [declared],
  )

  const save = async () => {
    const api = window.electronAPI?.providers
    if (!api?.setModelMark || !api.getModelMarks) {
      setError(t('models.annotation.unavailable'))
      return
    }
    if (tier !== null && tooLarge(tier)) {
      setError(t('aggregate.dialog.paramsWindowTooLarge', { declared: String(declared ?? '') }))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const marks = await api.getModelMarks()
      const current: ModelCapabilityHint = marks?.[providerId]?.[displayName] ?? {}
      const next: Record<string, unknown> = { ...current }
      if (tier === null) delete next.contextWindowTier
      else next.contextWindowTier = tier
      const result = await api.setModelMark(
        providerId,
        displayName,
        Object.keys(next).length > 0 ? (next as ModelCapabilityHint) : null,
      )
      if (!result.success) {
        setError(t('proxy.routePoolMarkSaveFailed'))
        return
      }
      onSaved?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('aggregate.dialog.paramsWindowTitle', { model: modelLabel ?? displayName })}</DialogTitle>
          <DialogDescription className="break-all">
            {t('aggregate.dialog.paramsWindowSubtitle')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">{t('aggregate.dialog.paramsWindow')}</Label>
          <div className="flex flex-wrap gap-2">
            {TIERS.map(candidate => {
              const blocked = tooLarge(candidate)
              return (
                <Button
                  key={candidate}
                  type="button"
                  size="sm"
                  variant={tier === candidate ? 'default' : 'outline'}
                  disabled={blocked}
                  title={blocked
                    ? t('aggregate.dialog.paramsWindowTooLarge', { declared: String(declared ?? '') })
                    : undefined}
                  onClick={() => setTier(candidate)}
                >
                  {candidate.toUpperCase()}
                </Button>
              )
            })}
            <Button
              type="button"
              size="sm"
              variant={tier === null ? 'default' : 'outline'}
              onClick={() => setTier(null)}
            >
              {t('aggregate.dialog.paramsWindowInherit')}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">{t('aggregate.dialog.paramsWindowHelp')}</p>
          {error !== null && <p className="text-[10px] text-destructive break-words">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t('aggregate.dialog.paramsApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}