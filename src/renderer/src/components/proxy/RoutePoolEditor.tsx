import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RefreshCw, Plus, Minus, RotateCcw, Pencil, Pin } from 'lucide-react'
import type {
  CapabilitySource,
  CapabilityState,
  InputModality,
  ModelCapability,
  ModelCapabilityHint,
  ModelRoute,
  RouteModelRef,
  RoutePreviewModel,
  RoutePreviewResult,
} from '../../../../shared/types'
import type { ModelRouteFieldValues } from './ModelRouteFields'

/**
 * 一条路由的**候选池预览 + 手动修正**。
 *
 * 预览走的是主进程和生产请求同一条采集/策略/手动增删管线，所以这里显示的
 * 「被哪条策略筛掉」就是真实请求里的结果。手动增删写进路由的
 * `includeModels` / `excludeModels`，只修正在策略层被误筛/漏筛的模型，
 * 不绕过硬过滤（图片→视觉、上下文）与契约过滤。
 *
 * 能力标注（tier/vision/tools/reasoning/context）可逐模型手动覆盖：
 * 保存进 `userModelMarks`，优先级最高，且不会被模型同步重写。
 */

interface RoutePoolEditorProps {
  idPrefix: string
  values: ModelRouteFieldValues
  onChange: (patch: Partial<ModelRouteFieldValues>) => void
}

type StatusFilter = 'all' | 'kept' | 'dropped' | 'unavailable'

const MODALITIES: InputModality[] = ['text', 'image', 'audio', 'video', 'pdf']

/** 手动标注的原始草稿：只保留用户显式设置的字段。 */
type MarkDraft = Record<string, unknown> & ModelCapabilityHint

function refKey(providerId: string, displayName: string): string {
  return `${providerId}\u0000${displayName.toLowerCase()}`
}

function sameRef(refs: RouteModelRef[], providerId: string, displayName: string): boolean {
  const key = refKey(providerId, displayName)
  return refs.some((ref) => refKey(ref.providerId, ref.displayName) === key)
}

function withoutRef(refs: RouteModelRef[], providerId: string, displayName: string): RouteModelRef[] {
  const key = refKey(providerId, displayName)
  return refs.filter((ref) => refKey(ref.providerId, ref.displayName) !== key)
}

/** 去掉值为 undefined 的键：`undefined` 在解析层代表「继承自动标注」。 */
function cleanHint(draft: MarkDraft): ModelCapabilityHint | null {
  const hint: ModelCapabilityHint = {}
  if (draft.tier !== undefined) hint.tier = draft.tier
  if (draft.vision !== undefined) hint.vision = draft.vision
  if (draft.tools !== undefined) hint.tools = draft.tools
  if (draft.reasoning !== undefined) hint.reasoning = draft.reasoning
  if (draft.modalities !== undefined) hint.modalities = [...draft.modalities]
  if (draft.contextTokens !== undefined) hint.contextTokens = draft.contextTokens
  if (draft.weight !== undefined) hint.weight = draft.weight
  if (draft.free !== undefined) hint.free = draft.free
  return Object.keys(hint).length === 0 ? null : hint
}

function formatContext(tokens: number | undefined): string | null {
  if (tokens === undefined) return null
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

export function RoutePoolEditor({ idPrefix, values, onChange }: RoutePoolEditorProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<RoutePreviewResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [needsVision, setNeedsVision] = useState(false)
  const [needsTools, setNeedsTools] = useState(false)
  const [estimatedTokens, setEstimatedTokens] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [marks, setMarks] = useState<Record<string, Record<string, ModelCapabilityHint>>>({})
  const [markTarget, setMarkTarget] = useState<RoutePreviewModel | null>(null)

  // 预览只看候选归属：打分策略/偏好/次数不影响结果，所以签名里不含它们，
  // 避免改这些字段时白跑一次 500 模型的采集。
  const routeSignature = useMemo(
    () =>
      JSON.stringify({
        poolStrategies: values.poolStrategies,
        includeModels: values.includeModels,
        excludeModels: values.excludeModels,
        pinModels: values.pinModels,
      }),
    [values.poolStrategies, values.includeModels, values.excludeModels, values.pinModels]
  )

  useEffect(() => {
    const api = window.electronAPI?.routes
    if (!api?.preview) {
      setError(t('proxy.routesUnavailable'))
      return
    }
    let cancelled = false
    const route: ModelRoute = {
      name: idPrefix,
      enabled: true,
      strategy: values.strategy,
      prefer: values.prefer,
      maxAttempts: values.maxAttempts,
      stickyMinutes: values.stickyMinutes,
      poolStrategies: values.poolStrategies,
      includeModels: values.includeModels,
      excludeModels: values.excludeModels,
      pinModels: values.pinModels,
    }
    const tokens = Number(estimatedTokens)
    setIsLoading(true)
    setError(null)
    api
      .preview(route, {
        needsVision,
        needsTools,
        estimatedTokens: Number.isFinite(tokens) && tokens > 0 ? tokens : 0,
      })
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    idPrefix,
    routeSignature,
    needsVision,
    needsTools,
    estimatedTokens,
    reloadToken,
    t,
    values.strategy,
    values.prefer,
    values.maxAttempts,
    values.stickyMinutes,
    values.poolStrategies,
    values.includeModels,
    values.excludeModels,
    values.pinModels,
  ])

  const loadMarks = useCallback(async () => {
    try {
      const result = await window.electronAPI?.providers?.getModelMarks?.()
      if (result) setMarks(result)
    } catch {
      // 标注读取失败只影响标注列，预览本身仍然可用，不覆盖错误区
    }
  }, [])

  useEffect(() => {
    void loadMarks()
  }, [loadMarks])

  const markOf = (model: RoutePreviewModel): ModelCapabilityHint | undefined =>
    marks[model.providerId]?.[model.displayName]

  const markHasManual = (model: RoutePreviewModel): boolean =>
    Object.keys(markOf(model) ?? {}).length > 0

  const include = (model: RoutePreviewModel) => {
    const ref: RouteModelRef = { providerId: model.providerId, displayName: model.displayName }
    onChange({
      includeModels: [
        ...withoutRef(values.includeModels, model.providerId, model.displayName),
        ref,
      ],
      excludeModels: withoutRef(values.excludeModels, model.providerId, model.displayName),
    })
  }

  const exclude = (model: RoutePreviewModel) => {
    const ref: RouteModelRef = { providerId: model.providerId, displayName: model.displayName }
    onChange({
      excludeModels: [
        ...withoutRef(values.excludeModels, model.providerId, model.displayName),
        ref,
      ],
      includeModels: withoutRef(values.includeModels, model.providerId, model.displayName),
    })
  }

  const resetManual = (providerId: string, displayName: string) => {
    onChange({
      includeModels: withoutRef(values.includeModels, providerId, displayName),
      excludeModels: withoutRef(values.excludeModels, providerId, displayName),
      pinModels: withoutRef(values.pinModels, providerId, displayName),
    })
  }

  /**
   * 钉进 / 移出这条路由的名字名单。
   *
   * 钉定与 `include` 语义不同，所以不共用一个动作：`include` 是「策略误筛了，把它捞回来」，
   * 只在没钉定的路由上有意义；一旦钉了，池外模型捞不回来（`applyModelNamePin` 先收基底）。
   */
  const togglePin = (model: RoutePreviewModel) => {
    const ref: RouteModelRef = { providerId: model.providerId, displayName: model.displayName }
    const already = sameRef(values.pinModels, model.providerId, model.displayName)
    onChange({
      pinModels: already
        ? withoutRef(values.pinModels, model.providerId, model.displayName)
        : [...values.pinModels, ref],
      // 钉定与「手动移除」互相矛盾：两个都留着会得到一个空池 + 说不清的原因。
      ...(already || !sameRef(values.excludeModels, model.providerId, model.displayName)
        ? {}
        : { excludeModels: withoutRef(values.excludeModels, model.providerId, model.displayName) }),
    })
  }

  const visibleModels = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (preview?.models ?? []).filter((model) => {
      if (statusFilter === 'kept' && model.status !== 'kept' && model.status !== 'included') return false
      if (statusFilter === 'dropped' && model.status !== 'filtered' && model.status !== 'excluded' && model.status !== 'not-pinned') return false
      if (statusFilter === 'unavailable' && model.status !== 'unavailable') return false
      if (query === '') return true
      return (
        model.displayName.toLowerCase().includes(query) ||
        model.providerName.toLowerCase().includes(query)
      )
    })
  }, [preview, search, statusFilter])

  const statusLabel = (status: RoutePreviewModel['status']): string =>
    t(`proxy.routePoolStatus_${status}`)

  const statusVariant = (status: RoutePreviewModel['status']) => {
    switch (status) {
      case 'kept':
        return 'secondary' as const
      case 'included':
        return 'default' as const
      case 'excluded':
        return 'destructive' as const
      default:
        return 'outline' as const
    }
  }

  const capabilityBadges = (capability: ModelCapability) => {
    const entries: { key: string; label: string; source: CapabilitySource }[] = [
      { key: 'vision', label: `V:${capability.vision}`, source: capability.sources.vision },
      { key: 'tools', label: `T:${capability.tools}`, source: capability.sources.tools },
      { key: 'reasoning', label: `R:${capability.reasoning}`, source: capability.sources.reasoning },
      { key: 'tier', label: capability.tier, source: capability.sources.tier },
    ]
    const context = formatContext(capability.contextTokens)
    if (context !== null) {
      entries.push({ key: 'context', label: `ctx ${context}`, source: capability.sources.contextTokens })
    }
    return entries.map((entry) => (
      <Badge
        key={entry.key}
        variant="outline"
        className="text-[10px] font-normal"
        title={t(`proxy.routePoolSource_${entry.source}`)}
      >
        {entry.label}
        {entry.source !== 'unknown' && (
          <span className="ml-1 opacity-60">{t(`proxy.routePoolSourceShort_${entry.source}`)}</span>
        )}
      </Badge>
    ))
  }

  return (
    <div className="space-y-3 pt-4 border-t">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={`route-pool-search-${idPrefix}`}>{t('proxy.routePoolTitle')}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setReloadToken((token) => token + 1)}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
          {t('proxy.routePoolRefresh')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('proxy.routePoolHelp')}</p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--primary)]"
            checked={needsVision}
            onChange={(event) => setNeedsVision(event.target.checked)}
          />
          {t('proxy.routePoolSampleVision')}
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--primary)]"
            checked={needsTools}
            onChange={(event) => setNeedsTools(event.target.checked)}
          />
          {t('proxy.routePoolSampleTools')}
        </label>
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`route-pool-tokens-${idPrefix}`} className="text-xs">
            {t('proxy.routePoolSampleTokens')}
          </Label>
          <Input
            id={`route-pool-tokens-${idPrefix}`}
            type="number"
            min={0}
            className="h-7 w-28 text-xs"
            value={estimatedTokens}
            onChange={(event) => setEstimatedTokens(event.target.value)}
          />
        </div>
      </div>

      {preview && (
        <p className="text-xs text-muted-foreground">
          {t('proxy.routePoolSummary', {
            candidates: preview.counts.candidates,
            afterStrategies: preview.counts.afterStrategies,
            afterManual: preview.counts.afterManual,
            unavailable: preview.counts.unavailable,
          })}
        </p>
      )}

      {preview && preview.missing.length > 0 && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t('proxy.routePoolEmpty', {
            reasons: preview.missing.map((reason) => t(`proxy.routePoolMissing_${reason}`)).join(' / '),
          })}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive break-words">
          {error}
        </div>
      )}

      {preview && preview.manual.unresolved.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-dashed px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {t('proxy.routePoolUnresolved', { count: preview.manual.unresolved.length })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {preview.manual.unresolved.map((ref) => (
              <span key={refKey(ref.providerId, ref.displayName)} className="flex items-center gap-1">
                <Badge variant="outline" className="text-[10px] font-normal">
                  {ref.displayName}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1 text-xs"
                  onClick={() => resetManual(ref.providerId, ref.displayName)}
                >
                  <Minus className="h-3 w-3" />
                </Button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`route-pool-search-${idPrefix}`}
          className="h-8 flex-1 min-w-[160px] text-xs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('proxy.routePoolSearchPlaceholder')}
        />
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('proxy.routePoolFilter_all')}</SelectItem>
            <SelectItem value="kept">{t('proxy.routePoolFilter_kept')}</SelectItem>
            <SelectItem value="dropped">{t('proxy.routePoolFilter_dropped')}</SelectItem>
            <SelectItem value="unavailable">{t('proxy.routePoolFilter_unavailable')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="max-h-80 overflow-y-auto rounded-md border">
        {visibleModels.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {isLoading ? t('proxy.routePoolLoading') : t('proxy.routePoolNoMatch')}
          </p>
        )}
        {visibleModels.map((model) => {
          const included = sameRef(values.includeModels, model.providerId, model.displayName)
          const excluded = sameRef(values.excludeModels, model.providerId, model.displayName)
          const pinned = sameRef(values.pinModels, model.providerId, model.displayName)
          return (
            <div
              key={refKey(model.providerId, model.displayName)}
              className="flex flex-wrap items-center gap-1.5 border-b px-2.5 py-1.5 last:border-b-0"
            >
              <Badge variant={statusVariant(model.status)} className="text-[10px]">
                {statusLabel(model.status)}
              </Badge>
              <span className="text-xs font-medium">{model.displayName}</span>
              <span className="text-[10px] text-muted-foreground">{model.providerName}</span>
              {pinned && (
                <span className="text-[10px] text-muted-foreground">{t('proxy.routePoolPinnedFlag')}</span>
              )}
              {model.filteredBy !== undefined && (
                <span className="text-[10px] text-muted-foreground">
                  {t('proxy.routePoolFilteredBy', {
                    strategy: t(`proxy.autoRoutingPoolStrategy_${model.filteredBy}`),
                  })}
                </span>
              )}
              {model.unavailableReason !== undefined && (
                <span className="text-[10px] text-destructive">
                  {t(`proxy.routePoolUnavailable_${model.unavailableReason}`)}
                </span>
              )}
              <span className="flex flex-wrap items-center gap-1 ml-auto">
                {capabilityBadges(model.capability)}
                {markHasManual(model) && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {t('proxy.routePoolManualMark')}
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  title={t('proxy.routePoolMark')}
                  onClick={() => setMarkTarget(model)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant={pinned ? 'default' : 'ghost'}
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  title={pinned ? t('proxy.routePoolUnpin') : t('proxy.routePoolPin')}
                  onClick={() => togglePin(model)}
                >
                  <Pin className="h-3 w-3" />
                </Button>
                {included || excluded || pinned ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    title={t('proxy.routePoolAuto')}
                    onClick={() => resetManual(model.providerId, model.displayName)}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                ) : model.status === 'kept' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    title={t('proxy.routePoolRemove')}
                    onClick={() => exclude(model)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    title={t('proxy.routePoolAdd')}
                    onClick={() => include(model)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {markTarget && (
        <ModelMarkDialog
          open={markTarget !== null}
          target={markTarget}
          mark={markOf(markTarget)}
          onClose={() => setMarkTarget(null)}
          onSaved={(nextMarks) => {
            setMarks(nextMarks)
            setMarkTarget(null)
            setReloadToken((token) => token + 1)
          }}
        />
      )}
    </div>
  )
}

interface ModelMarkDialogProps {
  open: boolean
  target: RoutePreviewModel
  mark: ModelCapabilityHint | undefined
  onClose: () => void
  onSaved: (marks: Record<string, Record<string, ModelCapabilityHint>>) => void
}

const TRI_STATE_FIELDS = [
  ['vision', 'proxy.routePoolMarkVision'],
  ['tools', 'proxy.routePoolMarkTools'],
  ['reasoning', 'proxy.routePoolMarkReasoning'],
] as const

type TriStateField = (typeof TRI_STATE_FIELDS)[number][0]

/**
 * 逐模型手动标注。空 = 继承自动解析（供应商记录 / 聚合官方 / 静态表 / 第三方 /
 * 名字启发式），所以每个字段都有「继承」这一档，而不是默认成一个猜测值。
 */
function ModelMarkDialog({ open, target, mark, onClose, onSaved }: ModelMarkDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<MarkDraft>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 只在这个模型变化时重置草稿：保存失败时用户输入不会被清掉。
  useEffect(() => {
    if (!open) return
    setDraft(mark ? { ...mark, modalities: mark.modalities ? [...mark.modalities] : undefined } : {})
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target.providerId, target.displayName])

  const patch = (changes: Partial<MarkDraft>) => {
    setDraft((current) => {
      const next: MarkDraft = { ...current }
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete next[key]
        else (next as Record<string, unknown>)[key] = value
      }
      return next
    })
  }

  const triState = (field: TriStateField): string => draft[field] ?? 'inherit'

  const setTriState = (field: TriStateField, value: string) => {
    patch({ [field]: value === 'inherit' ? undefined : (value as Exclude<CapabilityState, 'unknown'>) })
  }

  const toggleModality = (modality: InputModality) => {
    const current = draft.modalities ?? []
    const next = current.includes(modality)
      ? current.filter((item) => item !== modality)
      : [...current, modality]
    patch({ modalities: next.length === 0 ? undefined : next })
  }

  const handleSave = async () => {
    const api = window.electronAPI?.providers
    if (!api?.setModelMark) {
      setError(t('proxy.routesUnavailable'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await api.setModelMark(target.providerId, target.displayName, cleanHint(draft))
      if (result.success) {
        onSaved(result.marks)
      } else {
        setError(result.error ?? t('proxy.routePoolMarkSaveFailed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('proxy.routePoolMarkSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const sources: { label: string; source: CapabilitySource }[] = [
    { label: t('proxy.routePoolMarkTier'), source: target.capability.sources.tier },
    { label: t('proxy.routePoolMarkVision'), source: target.capability.sources.vision },
    { label: t('proxy.routePoolMarkTools'), source: target.capability.sources.tools },
    { label: t('proxy.routePoolMarkReasoning'), source: target.capability.sources.reasoning },
    { label: t('proxy.routePoolMarkContext'), source: target.capability.sources.contextTokens },
  ]

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('proxy.routePoolMarkTitle')}</DialogTitle>
          <DialogDescription className="break-all">
            {target.providerName} / {target.displayName}
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{t('proxy.routePoolMarkHelp')}</p>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t('proxy.routePoolMarkTier')}</Label>
            <Select
              value={draft.tier ?? 'inherit'}
              onValueChange={(value) => patch({ tier: value === 'inherit' ? undefined : (value as ModelCapabilityHint['tier']) })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">{t('proxy.routePoolMarkInherit')}</SelectItem>
                <SelectItem value="fast">fast</SelectItem>
                <SelectItem value="balanced">balanced</SelectItem>
                <SelectItem value="strong">strong</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {TRI_STATE_FIELDS.map(([field, labelKey]) => (
            <div key={field} className="space-y-1">
              <Label className="text-xs">{t(labelKey)}</Label>
              <Select value={triState(field)} onValueChange={(value) => setTriState(field, value)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">{t('proxy.routePoolMarkInherit')}</SelectItem>
                  <SelectItem value="yes">{t('proxy.routePoolMarkYes')}</SelectItem>
                  <SelectItem value="no">{t('proxy.routePoolMarkNo')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}

          <div className="space-y-1">
            <Label className="text-xs">{t('proxy.routePoolMarkContext')}</Label>
            <Input
              type="number"
              min={1}
              className="h-8 text-xs"
              value={draft.contextTokens ?? ''}
              onChange={(event) => {
                const raw = event.target.value
                patch({ contextTokens: raw === '' ? undefined : Math.max(1, Number(raw) || 0) })
              }}
              placeholder={t('proxy.routePoolMarkInherit')}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t('proxy.routePoolMarkModalities')}</Label>
            <div className="flex flex-wrap gap-2">
              {MODALITIES.map((modality) => (
                <label key={modality} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                    checked={(draft.modalities ?? []).includes(modality)}
                    onChange={() => toggleModality(modality)}
                  />
                  {modality}
                </label>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">{t('proxy.routePoolMarkModalitiesHelp')}</p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {sources.map((entry) => (
              <Badge key={entry.label} variant="outline" className="text-[10px] font-normal">
                {entry.label}: {t(`proxy.routePoolSource_${entry.source}`)}
              </Badge>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-destructive break-words">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t('proxy.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default RoutePoolEditor
