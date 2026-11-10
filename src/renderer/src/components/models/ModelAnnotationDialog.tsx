/**
 * 逐模型标注对话框：渠道/上游已声明的参数 + 第三方标准库逐字段采用 + 手工覆盖。
 *
 * 入口在三个地方共用同一份实现：「模型管理 › 元数据」的待标注队列、聚合渠道的模型行、
 * 账号渠道的模型行（设计见 docs/design/2026-11-04-model-metadata-resolution.md §9）。
 * 三处都必须走同一个对话框，因为「采用」写 `catalogAdoptions`、「手工标注」写
 * `userModelMarks`，两者的优先级与校验判据只能有一份实现。
 *
 * 口径（不许在这里放宽）：
 * - 未知是一等状态，任何一格都不许用 0 / 默认值补空；
 * - 标准库是第三方数据，只有用户逐字段采用后才进入解析链，且永不覆盖人工标记与上游声明；
 * - 刷新快照不在这个对话框里发生（唯一的网络调用由用户在补全卡片上显式点击）。
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useToast } from '@/hooks/use-toast'
import type { Fact, MetadataAttribute, ModelMetadata } from '@shared/modelMetadata'
import { isAttributeApplicable, METADATA_ATTRIBUTES } from '@shared/modelMetadata'
import type {
  CatalogAdoptionField,
  CatalogCandidatesResult,
  CatalogEntry,
  CatalogMatchConfidence,
  CatalogPrice,
} from '@shared/modelCatalog'
import {
  CATALOG_ADOPTION_FIELDS,
  CATALOG_SOURCES,
  CATALOG_SOURCE_META,
  catalogFieldValue,
} from '@shared/modelCatalog'
import type {
  CapabilitySource,
  CapabilityState,
  InputModality,
  ModelCapabilityHint,
} from '@shared/types'

type Translator = (key: string, options?: Record<string, unknown>) => string

export const ATTRIBUTE_LABEL_KEYS: Record<MetadataAttribute, string> = {
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

export const SOURCE_LABEL_KEYS: Record<string, string> = {
  manual: 'models.metadata.sourceManual',
  upstream: 'models.metadata.sourceUpstream',
  catalog: 'models.metadata.sourceCatalog',
  'family-rule': 'models.metadata.sourceFamilyRule',
  probe: 'models.metadata.sourceProbe',
  'cost-ledger': 'models.metadata.sourceCostLedger',
  unclassified: 'models.metadata.sourceUnclassified',
}

export const CONFIDENCE_LABEL_KEYS: Record<string, string> = {
  declared: 'models.metadata.confidenceDeclared',
  inferred: 'models.metadata.confidenceInferred',
  measured: 'models.metadata.confidenceMeasured',
}

export const SOURCE_TONE: Record<string, string> = {
  manual: 'text-primary',
  upstream: 'text-success',
  catalog: 'text-info',
  'family-rule': 'text-warning',
  probe: 'text-info',
  'cost-ledger': 'text-muted-foreground',
}

export const CATALOG_CONFIDENCE_LABEL_KEYS: Record<CatalogMatchConfidence, string> = {
  exact: 'models.metadata.catalogConfidenceExact',
  alias: 'models.metadata.catalogConfidenceAlias',
  family: 'models.metadata.catalogConfidenceFamily',
  fuzzy: 'models.metadata.catalogConfidenceFuzzy',
}

export const CATALOG_CONFIDENCE_TONE: Record<CatalogMatchConfidence, string> = {
  exact: 'text-success',
  alias: 'text-warning',
  family: 'text-muted-foreground',
  fuzzy: 'text-muted-foreground',
}

export const CATALOG_FIELD_LABEL_KEYS: Record<CatalogAdoptionField, string> = {
  contextTokens: 'models.metadata.attrContextTokens',
  maxOutputTokens: 'models.metadata.attrMaxOutputTokens',
  price: 'models.metadata.catalogFieldPrice',
  modalities: 'models.metadata.attrModalities',
  vision: 'models.metadata.attrVision',
  tools: 'models.metadata.attrTools',
  reasoning: 'models.metadata.attrReasoning',
}

/** 采用条目里每个字段的展示值；价格只以 USD / 1M tokens 说明，不换算。 */
export function formatCatalogValue(
  field: CatalogAdoptionField,
  value: unknown,
  t: Translator,
): string {
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

export function entryValue(entry: CatalogEntry, field: CatalogAdoptionField): unknown {
  return catalogFieldValue(entry, field)
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`
  return String(value)
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * 一条已解析的属性：值 + 来源层 + 置信度。
 *
 * `showEvidence` 给逐模型对话框用 —— 那里用户要看清这个数是「渠道包说的」还是
 * 「官方额度旁表说的」，出处文案（`KnownFact.evidence`）就是判断该不该改的依据。
 */
export function FactCell({
  fact,
  t,
  showEvidence = false,
}: {
  fact: Fact<unknown>
  t: Translator
  showEvidence?: boolean
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
      {showEvidence && (fact.evidence || fact.asOf) && (
        <span className="text-[11px] text-muted-foreground">
          {fact.evidence ?? ''}
          {fact.asOf ? ` ${formatDate(fact.asOf)}` : ''}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 手工标注编辑器
// ---------------------------------------------------------------------------

const TRI_STATE_FIELDS = [
  ['vision', 'proxy.routePoolMarkVision'],
  ['tools', 'proxy.routePoolMarkTools'],
  ['reasoning', 'proxy.routePoolMarkReasoning'],
] as const

type TriStateField = (typeof TRI_STATE_FIELDS)[number][0]

const MODALITIES: InputModality[] = ['text', 'image', 'audio', 'video', 'pdf']

/**
 * 两个数值字段的合理上界，与主进程 `store/modelMarks.ts` 的
 * `MAX_CONTEXT_TOKENS` / `MAX_OUTPUT_TOKENS` 同值。这里先做一次人读校验：
 * 超出范围的输入必须当场拒绝并说明，不能等到保存时被 `normalizeModelMark`
 * 静默丢掉 —— 那会让界面显示「已保存」，库里却没有这一格，下次打开又回退。
 */
const MAX_MARK_CONTEXT_TOKENS = 100_000_000
const MAX_MARK_OUTPUT_TOKENS = 1_000_000

/** 手动标注的原始草稿：只保留用户显式设置的字段。 */
type MarkDraft = Record<string, unknown> & ModelCapabilityHint

/** 去掉值为 undefined 的键：`undefined` 在解析层代表「继承自动标注」。 */
function cleanHint(draft: MarkDraft): ModelCapabilityHint | null {
  const hint: ModelCapabilityHint = {}
  if (draft.tier !== undefined) hint.tier = draft.tier
  if (draft.vision !== undefined) hint.vision = draft.vision
  if (draft.tools !== undefined) hint.tools = draft.tools
  if (draft.reasoning !== undefined) hint.reasoning = draft.reasoning
  if (draft.modalities !== undefined) hint.modalities = [...draft.modalities]
  if (draft.contextTokens !== undefined) hint.contextTokens = draft.contextTokens
  if (draft.maxOutputTokens !== undefined) hint.maxOutputTokens = draft.maxOutputTokens
  if (draft.weight !== undefined) hint.weight = draft.weight
  if (draft.free !== undefined) hint.free = draft.free
  return Object.keys(hint).length === 0 ? null : hint
}

export interface ModelMarkEditorProps {
  providerId: string
  displayName: string
  /** 已存储的人工标注；省略 = 全部字段「继承」。 */
  mark: ModelCapabilityHint | undefined
  /** 每个字段当前来自哪一层，画成徽标；调用方没有这份数据时不画。 */
  sources?: { label: string; source: CapabilitySource }[]
  onSaved: (marks: Record<string, Record<string, ModelCapabilityHint>>) => void
  /** 提供时渲染「取消」按钮（对话框自带 footer 的调用方自己放关闭键）。 */
  onCancel?: () => void
}

/**
 * 逐模型人工标注表单。空 = 继承自动解析（供应商记录 / 聚合官方 / 静态表 / 第三方 /
 * 名字启发式），所以每个字段都有「继承」这一档，而不是默认成一个猜测值。
 *
 * 这是人工标注的唯一实现：路由池编辑器和逐模型对话框都渲染它，两处的校验判据
 * （输出上限的正整数 / 上界、模态清空即不写）必须一起改，不允许各写一份。
 */
export function ModelMarkEditor({
  providerId,
  displayName,
  mark,
  sources,
  onSaved,
  onCancel,
}: ModelMarkEditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<MarkDraft>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 两个数值字段用文本草稿：非法输入要留在框里并给出提示，不能一按保存就被归一函数静默丢掉。
  const [contextDraft, setContextDraft] = useState('')
  const [outputDraft, setOutputDraft] = useState('')

  // 只在换模型时重置草稿：保存失败时用户输入不会被清掉。
  // 保存成功则由 handleSave 用主进程返回的归一结果回填（见下），两处口径一致。
  useEffect(() => {
    setDraft(mark ? { ...mark, modalities: mark.modalities ? [...mark.modalities] : undefined } : {})
    setContextDraft(mark?.contextTokens !== undefined ? String(mark.contextTokens) : '')
    setOutputDraft(mark?.maxOutputTokens !== undefined ? String(mark.maxOutputTokens) : '')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, displayName])

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

  const contextError = validateMarkTokens(contextDraft, MAX_MARK_CONTEXT_TOKENS, t, 'context')
  const outputError = validateMarkTokens(outputDraft, MAX_MARK_OUTPUT_TOKENS, t, 'output')

  /** 两个数值字段共用一条判据：留空 = 未标注，非法值留在框里并清掉草稿里的旧值。 */
  const changeTokens = (field: 'context' | 'output', raw: string) => {
    if (field === 'context') setContextDraft(raw)
    else setOutputDraft(raw)
    const max = field === 'context' ? MAX_MARK_CONTEXT_TOKENS : MAX_MARK_OUTPUT_TOKENS
    const parsed = parseMarkTokens(raw, max)
    const value = parsed === null ? undefined : parsed.value
    patch(field === 'context' ? { contextTokens: value } : { maxOutputTokens: value })
  }

  const handleSave = async () => {
    if (contextError !== null || outputError !== null) {
      setError(contextError ?? outputError)
      return
    }
    const api = window.electronAPI?.providers
    if (!api?.setModelMark) {
      setError(t('proxy.routesUnavailable'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await api.setModelMark(providerId, displayName, cleanHint(draft))
      if (result.success) {
        // 主进程会归一（丢弃越界 / 空值），界面必须立刻显示库里真正存下的那一版：
        // 否则显示「已保存」却留着被丢弃的字段，下次打开就跳回「继承」＝用户看到的回退。
        const saved = result.marks[providerId]?.[displayName]
        setDraft(saved ? { ...saved, modalities: saved.modalities ? [...saved.modalities] : undefined } : {})
        setContextDraft(saved?.contextTokens !== undefined ? String(saved.contextTokens) : '')
        setOutputDraft(saved?.maxOutputTokens !== undefined ? String(saved.maxOutputTokens) : '')
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

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('proxy.routePoolMarkHelp')}</p>

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
          type="text"
          inputMode="numeric"
          className="h-8 text-xs"
          value={contextDraft}
          onChange={(event) => changeTokens('context', event.target.value)}
          placeholder={t('proxy.routePoolMarkMaxOutputPlaceholder')}
          aria-invalid={contextError !== null}
        />
        <p className="text-[10px] text-muted-foreground">
          {t('proxy.routePoolMarkMaxOutputHelp', {
            max: MAX_MARK_CONTEXT_TOKENS.toLocaleString('en-US'),
          })}
        </p>
        {contextError !== null && (
          <p className="text-[10px] text-destructive break-words">{contextError}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">{t('proxy.routePoolMarkMaxOutput')}</Label>
        <Input
          type="text"
          inputMode="numeric"
          className="h-8 text-xs"
          value={outputDraft}
          onChange={(event) => changeTokens('output', event.target.value)}
          placeholder={t('proxy.routePoolMarkMaxOutputPlaceholder')}
          aria-invalid={outputError !== null}
        />
        <p className="text-[10px] text-muted-foreground">
          {t('proxy.routePoolMarkMaxOutputHelp', {
            max: MAX_MARK_OUTPUT_TOKENS.toLocaleString('en-US'),
          })}
        </p>
        {outputError !== null && (
          <p className="text-[10px] text-destructive break-words">{outputError}</p>
        )}
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

      {sources && (
        <div className="flex flex-wrap gap-1.5">
          {sources.map((entry) => (
            <Badge key={entry.label} variant="outline" className="text-[10px] font-normal">
              {entry.label}: {t(`proxy.routePoolSource_${entry.source}`)}
            </Badge>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-destructive break-words">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? t('proxy.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}

/** 留空 = 未标注；合法正整数 = 值；其余 = `null`（调用方必须拒绝而不是截断/取整）。 */
function parseMarkTokens(raw: string, max: number): { value?: number } | null {
  const trimmed = raw.trim()
  if (trimmed === '') return { value: undefined }
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  if (value <= 0 || value > max) return null
  return { value }
}

/** 两个字段共用判据，只有「上界过大」的文案各自说清是哪个字段。 */
function validateMarkTokens(
  raw: string,
  max: number,
  t: Translator,
  field: 'context' | 'output',
): string | null {
  const trimmed = raw.trim()
  if (parseMarkTokens(trimmed, max) !== null) return null
  if (Number(trimmed) > max) {
    const key = field === 'context'
      ? 'proxy.routePoolMarkContextTooLarge'
      : 'proxy.routePoolMarkMaxOutputTooLarge'
    return t(key, { max: max.toLocaleString('en-US') })
  }
  return t('proxy.routePoolMarkMaxOutputInvalid')
}

// ---------------------------------------------------------------------------
// 对话框
// ---------------------------------------------------------------------------

export interface ModelAnnotationDialogProps {
  providerId: string
  displayName: string
  /** 标题里显示的名字；省略时用 `displayName`（渠道行的裸模型名更好读，由调用方给）。 */
  modelLabel?: string
  onClose: () => void
  /** 任何一次写入（采用 / 撤销 / 手工标注）成功后通知宿主刷新。 */
  onChanged?: () => void
}

/**
 * 一个模型的标注界面。三段从上到下读就是解析链的顺序：
 * 这一家已经声明了什么 → 标准台账能补什么 → 用户自己怎么覆盖。
 */
export function ModelAnnotationDialog({
  providerId,
  displayName,
  modelLabel,
  onClose,
  onChanged,
}: ModelAnnotationDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex max-w-2xl max-h-[85vh] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {t('models.annotation.title', { model: modelLabel ?? displayName })}
          </DialogTitle>
          <DialogDescription className="break-all">{displayName}</DialogDescription>
        </DialogHeader>
        <AnnotationBody
          providerId={providerId}
          displayName={displayName}
          onChanged={onChanged}
        />
        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 对话框正文：自己滚动，头部与底部按钮不随内容滚走。 */
function AnnotationBody({
  providerId,
  displayName,
  onChanged,
}: {
  providerId: string
  displayName: string
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [metadata, setMetadata] = useState<ModelMetadata | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [mark, setMark] = useState<ModelCapabilityHint | undefined>(undefined)
  const [data, setData] = useState<CatalogCandidatesResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const loadFacts = useCallback(async () => {
    const api = window.electronAPI?.providers
    if (!api?.getModelMetadataOne) {
      setMetadataError(t('models.annotation.unavailable'))
      return
    }
    const result = await api.getModelMetadataOne(providerId, displayName)
    if (result.success) {
      setMetadata(result.metadata)
      setMetadataError(null)
    } else {
      setMetadataError(result.error)
    }
  }, [displayName, providerId, t])

  const loadCandidates = useCallback(async () => {
    if (!window.electronAPI?.providers?.getCatalogCandidates) return
    try {
      setData(await window.electronAPI.providers.getCatalogCandidates(providerId, displayName))
    } catch (cause) {
      toast({
        title: t('models.metadata.catalogFailed'),
        description: cause instanceof Error ? cause.message : displayName,
        variant: 'destructive',
      })
    }
  }, [displayName, providerId, t, toast])

  const loadMark = useCallback(async () => {
    const api = window.electronAPI?.providers
    if (!api?.getModelMarks) return
    const marks = await api.getModelMarks()
    setMark(marks[providerId]?.[displayName])
  }, [displayName, providerId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([loadFacts(), loadCandidates(), loadMark()]).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [loadCandidates, loadFacts, loadMark])

  /** 写入之后三处都要重读：手工标注会改变解析结果，采用会改变队列归类。 */
  const afterChange = useCallback(async () => {
    await Promise.all([loadFacts(), loadCandidates(), loadMark()])
    onChanged?.()
  }, [loadCandidates, loadFacts, loadMark, onChanged])

  const adopt = useCallback(
    async (entry: CatalogEntry, field: CatalogAdoptionField) => {
      const api = window.electronAPI?.providers
      if (!api?.adoptCatalogField) return
      setBusy(`${entry.catalogId}\u0000${field}`)
      try {
        const result = await api.adoptCatalogField(providerId, displayName, entry.catalogId, field)
        if (!result.success) {
          toast({
            title: t('models.metadata.catalogFailed'),
            description: result.error ?? displayName,
            variant: 'destructive',
          })
          return
        }
        setData((current) =>
          current ? { ...current, adoptions: result.adoptions ?? current.adoptions } : current,
        )
        await afterChange()
        toast({
          title: t('models.metadata.catalogAdopted'),
          description: `${displayName} · ${t(CATALOG_FIELD_LABEL_KEYS[field])}`,
        })
      } finally {
        setBusy(null)
      }
    },
    [afterChange, displayName, providerId, t, toast],
  )

  const revoke = useCallback(
    async (field?: CatalogAdoptionField) => {
      const api = window.electronAPI?.providers
      if (!api?.revokeCatalogAdoption) return
      setBusy(`revoke\u0000${field ?? 'all'}`)
      try {
        const result = await api.revokeCatalogAdoption(providerId, displayName, field)
        if (!result.success) {
          toast({
            title: t('models.metadata.catalogFailed'),
            description: result.error ?? displayName,
            variant: 'destructive',
          })
          return
        }
        setData((current) =>
          current ? { ...current, adoptions: result.adoptions ?? current.adoptions } : current,
        )
        await afterChange()
        toast({ title: t('models.metadata.catalogRevoked'), description: displayName })
      } finally {
        setBusy(null)
      }
    },
    [afterChange, displayName, providerId, t, toast],
  )

  const unfetchedSources = data
    ? CATALOG_SOURCES.filter(
      (source) => !data.statuses.some((status) => status.source === source),
    )
    : []

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('models.metadata.catalogLoading')}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t('models.annotation.factsSection')}</h3>
        {metadataError && <p className="text-xs text-destructive break-words">{metadataError}</p>}
        {metadata && (
          <div className="divide-y rounded-md border">
            {METADATA_ATTRIBUTES.filter((attribute) =>
              isAttributeApplicable(attribute, metadata.providerType, metadata),
            ).map((attribute) => (
              <div key={attribute} className="flex items-start justify-between gap-3 px-3 py-1.5">
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t(ATTRIBUTE_LABEL_KEYS[attribute])}
                </span>
                <div className="text-right">
                  <FactCell
                    fact={metadata[attribute] as Fact<unknown>}
                    t={t}
                    showEvidence
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t('models.annotation.catalogSection')}</h3>
        {unfetchedSources.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
            {t('models.metadata.catalogSourcesNotFetched', {
              sources: unfetchedSources.map((source) => CATALOG_SOURCE_META[source].label).join(' / '),
            })}
          </div>
        )}
        {data && data.adoptions.length > 0 && (
          <div className="space-y-2 rounded-md border p-3">
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
          </div>
        )}

        {data && data.matches.length === 0 ? (
          <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            {t('models.metadata.catalogNoMatches')}
          </div>
        ) : (
          <div className="space-y-3">
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
                            {value === undefined && (
                              <span className="text-[11px] text-muted-foreground">
                                {t('models.metadata.catalogFieldAbsent')}
                              </span>
                            )}
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
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t('models.annotation.markSection')}</h3>
        <ModelMarkEditor
          providerId={providerId}
          displayName={displayName}
          mark={mark}
          onSaved={() => void afterChange()}
        />
      </section>
    </div>
  )
}

export default ModelAnnotationDialog
