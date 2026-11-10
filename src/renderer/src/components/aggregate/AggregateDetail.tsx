import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Coins,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Tags,
  Trash2,
  Wifi,
} from 'lucide-react'
import { CatalogScopeBatchButton } from '@/components/models/CatalogScopeBatchButton'
import { ModelAnnotationDialog } from '@/components/models/ModelAnnotationDialog'
import { ModelAnnotationSummary } from '@/components/models/ModelAnnotationSummary'
import type {
  AggregateDetail,
  AggregateEntry,
  AggregateEntryState,
  AggregateKeyInfo,
  AggregateModelInfo,
  AggregateModelTestResult,
  AggregateMutationResult,
  AggregateQuotaUsage,
} from '../../../../shared/aggregate'
import type {
  AggregateCreditQueryResult,
  AggregateCreditReading,
  AggregateCreditSnapshot,
} from '../../../../shared/aggregateCredit'
import { CREDIT_SNAPSHOT_TTL_MS, creditSnapshotLive } from '../../../../shared/aggregateCredit'
import type {
  AggregateCostClass,
  AggregateCostSignal as AggregateModelCostSignal,
} from '../../../../shared/aggregateCost'
import { aggregateCostCounts, aggregateCostOf } from '../../../../shared/aggregateCost'
import { getTermsWarning } from '../../../../shared/aggregateTerms'
import { quotaRows, quotaViewOf, WINDOW_OF_METRIC } from '../../../../shared/aggregateQuotaView'
import type { ModelCapabilityHint } from '../../../../shared/types'
import type { CatalogAdoption } from '../../../../shared/modelCatalog'
import type { ModelMetadata } from '../../../../shared/modelMetadata'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'

/** 每模型参数编辑草稿：三个常用数值字段 + 其余参数的 JSON 文本。 */
interface ParamDraft {
  temperature: string
  maxTokens: string
  topP: string
  extraJson: string
}

interface AggregateDetailProps {
  entry: AggregateEntry
  state: AggregateEntryState
  quotaUsage?: AggregateQuotaUsage
  detail: AggregateDetail | null
  loading: boolean
  reasonText: (reason?: string) => string
  onRefresh: () => Promise<void>
  onApplyDetail: (detail: AggregateDetail) => void
  onRemove: () => Promise<void>
}

function categoryLabelKey(category: AggregateEntry['category']): string {
  if (category === 'free-tier') return 'aggregate.category.freeTier'
  if (category === 'apikey') return 'aggregate.category.apikey'
  return 'aggregate.category.local'
}

/** 已存参数 → 编辑草稿（常用字段拆出来，其余原样进 JSON）。 */
function draftOfParams(params: Record<string, unknown> | undefined): ParamDraft {
  const { temperature, max_tokens, top_p, ...rest } = params ?? {}
  const asText = (value: unknown): string =>
    value === undefined || value === null ? '' : String(value)
  return {
    temperature: asText(temperature),
    maxTokens: asText(max_tokens),
    topP: asText(top_p),
    extraJson: Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : '',
  }
}

/** 编辑草稿 → 参数对象；数值字段转数字、额外字段走 JSON。解析失败返回 null。 */
function parseParamDraft(draft: ParamDraft): Record<string, unknown> | null {
  const params: Record<string, unknown> = {}
  const numericFields: Array<['temperature' | 'max_tokens' | 'top_p', string]> = [
    ['temperature', draft.temperature],
    ['max_tokens', draft.maxTokens],
    ['top_p', draft.topP],
  ]
  for (const [key, raw] of numericFields) {
    const text = raw.trim()
    if (!text) continue
    const value = Number(text)
    if (!Number.isFinite(value)) return null
    params[key] = value
  }
  const extra = draft.extraJson.trim()
  if (extra) {
    try {
      const parsed: unknown = JSON.parse(extra)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
      Object.assign(params, parsed as Record<string, unknown>)
    } catch {
      return null
    }
  }
  return params
}

function paramSummary(params: Record<string, unknown> | undefined): string {
  if (!params) return ''
  return Object.entries(params)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
}

/** 分组用上游 id 的第一段（`gpt-4o-mini` → `gpt`）。 */
function groupOfModel(id: string): string {
  const index = id.search(/[\-_:.]/)
  return index === -1 ? id : id.slice(0, index)
}

/**
 * 消耗徽标的文案与配色。
 *
 * 每一档都有自己的一句，**不合并成"免费/付费"两态**：`included`（套餐内）
 * 与 `unknown`（未标注）都是真实的中间状态，折进任何一头都会骗人 ——
 * 前者是"不额外花钱但套餐有限"，后者是"完全不知道"。
 * 免费那一档还要按证据来源加限定词：只有官方出口的才敢直接写"免费"。
 */
function costBadgeOf(
  cost: AggregateModelCostSignal,
  t: (key: string, params?: Record<string, unknown>) => string
): { label: string; className: string; title: string } {
  if (cost.class === 'free') {
    if (cost.evidence === 'official') {
      return {
        label: t('aggregate.manage.models.costFreeOfficial'),
        className: 'text-success',
        title: t('aggregate.manage.models.costFreeOfficialHint'),
      }
    }
    if (cost.evidence === 'catalogue') {
      return {
        label: t('aggregate.manage.models.costFreeCatalogue'),
        className: 'text-success',
        title: t('aggregate.manage.models.costFreeCatalogueHint'),
      }
    }
    return {
      label: t('aggregate.manage.models.costFreeThirdParty'),
      className: 'text-success',
      title: t('aggregate.manage.models.costFreeThirdPartyHint'),
    }
  }
  if (cost.class === 'included') {
    return {
      label: t('aggregate.manage.models.costIncluded'),
      className: 'text-primary',
      title: t('aggregate.manage.models.costIncludedHint'),
    }
  }
  if (cost.class === 'priced') {
    const price = cost.price
    return {
      label: t('aggregate.manage.models.costPriced'),
      className: 'text-warning',
      // 标价是绝对值，不是倍率；把它写成倍率会让读者按错误的量级比较
      title: price
        ? `${t('aggregate.manage.models.costPricedHint')}\n${t('aggregate.manage.models.costPriceLabel', {
            input: price.input,
            output: price.output,
          })}`
        : t('aggregate.manage.models.costPricedHint'),
    }
  }
  return {
    label: t('aggregate.manage.models.costUnknown'),
    className: 'text-muted-foreground',
    title: t('aggregate.manage.models.costUnknownHint'),
  }
}

const NUMERIC_PARAM_FIELDS: Array<{ key: 'temperature' | 'maxTokens' | 'topP'; label: string }> = [
  { key: 'temperature', label: 'temperature' },
  { key: 'maxTokens', label: 'max_tokens' },
  { key: 'topP', label: 'top_p' },
]

export function AggregateDetailPanel(props: AggregateDetailProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const {
    entry,
    state,
    quotaUsage,
    detail,
    loading,
    reasonText,
    onRefresh,
    onApplyDetail,
    onRemove,
  } = props

  const [enabling, setEnabling] = useState(false)
  const unsupported = entry.authKind === 'unsupported'
  const wireLabel = entry.wire === 'anthropic-messages'
    ? t('aggregate.manage.wireAnthropic')
    : t('aggregate.manage.wireChat')
  const termsWarning = getTermsWarning(entry.id)

  const handleToggleEnabled = async (enabled: boolean) => {
    setEnabling(true)
    const result = await window.electronAPI.aggregate.setEnabled(entry.id, enabled)
    setEnabling(false)
    if (!result.success) {
      toast({ title: t('common.error'), description: reasonText(result.reason), variant: 'destructive' })
      return
    }
    await onRefresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-base font-semibold uppercase">
            {entry.name.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold">{entry.name}</h2>
              <Badge variant="outline">{t(categoryLabelKey(entry.category))}</Badge>
              <Badge variant="secondary">{wireLabel}</Badge>
              {state.configured && (
                <Badge variant={state.enabled ? 'default' : 'outline'}>
                  {state.enabled ? t('aggregate.active') : t('aggregate.disabled')}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {entry.id}
              {entry.notes ? ` · ${entry.notes}` : ''}
            </p>
          </div>
        </div>
        {state.configured && !unsupported && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t('aggregate.dialog.enabled')}</span>
              <Switch
                checked={state.enabled}
                disabled={enabling}
                onCheckedChange={enabled => void handleToggleEnabled(enabled)}
              />
            </div>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void onRemove()}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              {t('aggregate.manage.remove')}
            </Button>
          </div>
        )}
      </div>

      {unsupported && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">{t('aggregate.unsupported')}</CardContent>
        </Card>
      )}

      {termsWarning && (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="space-y-1 py-3 text-xs text-amber-800 dark:text-amber-300">
            <p>
              {termsWarning.scope === 'free-tier-models'
                ? t('aggregate.termsWarningFreeOnly')
                : t('aggregate.termsWarningAll')}
            </p>
            <p className="italic">"{termsWarning.quote}"</p>
            <button
              type="button"
              className="underline"
              onClick={() => window.electronAPI?.app?.openExternal?.(termsWarning.docUrl)}
            >
              {t('aggregate.termsWarningSource', { date: termsWarning.asOf })}
            </button>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {!loading && !unsupported && !state.configured && (
        <SetupPanel entry={entry} reasonText={reasonText} onRefresh={onRefresh} />
      )}

      {!loading && !unsupported && state.configured && detail && (
        <>
          <KeysCard
            entry={entry}
            keys={detail.keys}
            reasonText={reasonText}
            onApplyDetail={onApplyDetail}
            onRefresh={onRefresh}
          />
          <EndpointCard
            entry={entry}
            state={state}
            reasonText={reasonText}
            onRefresh={onRefresh}
          />
          <QuotaCard
            entry={entry}
            hasApiKey={state.hasApiKey}
            usage={quotaUsage}
            credit={detail.credit}
            onRefresh={onRefresh}
          />
          <ModelsCard
            entry={entry}
            models={detail.models}
            reasonText={reasonText}
            onApplyDetail={onApplyDetail}
            onRefresh={onRefresh}
          />
        </>
      )}
    </div>
  )
}

/** 未配置条目的内联配置卡：地址 + Key（可多把）+ 初始模型清单。 */
function SetupPanel(props: {
  entry: AggregateEntry
  reasonText: (reason?: string) => string
  onRefresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { entry, reasonText, onRefresh } = props

  const [baseUrl, setBaseUrl] = useState(entry.baseUrl ?? '')
  const [apiKeys, setApiKeys] = useState('')
  const [models, setModels] = useState(entry.models.map(model => model.id).join('\n'))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const result = await window.electronAPI.aggregate.save({
      id: entry.id,
      baseUrl: baseUrl.trim() || undefined,
      apiKeys: apiKeys
        .split(/[\n,]/)
        .map(key => key.trim())
        .filter(Boolean),
      models: models
        .split(/[\n,]/)
        .map(model => model.trim())
        .filter(Boolean),
      enabled: true,
    })
    setSaving(false)
    if (!result.success) {
      toast({ title: t('common.error'), description: reasonText(result.reason), variant: 'destructive' })
      return
    }
    toast({ title: t('aggregate.result.saved', { name: entry.name }) })
    await onRefresh()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('aggregate.manage.setup.title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('aggregate.manage.notConfiguredHint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="setup-base-url">{t('aggregate.dialog.baseUrl')}</Label>
          <Input
            id="setup-base-url"
            className="font-mono text-xs"
            value={baseUrl}
            placeholder={t('aggregate.dialog.baseUrlHint')}
            onChange={event => setBaseUrl(event.target.value)}
          />
        </div>

        {entry.authKind === 'apiKey' && (
          <div className="space-y-1.5">
            <Label htmlFor="setup-api-keys">{t('aggregate.dialog.apiKeys')}</Label>
            <Textarea
              id="setup-api-keys"
              rows={2}
              className="font-mono text-xs"
              placeholder={t('aggregate.dialog.apiKeyPlaceholder')}
              value={apiKeys}
              onChange={event => setApiKeys(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('aggregate.dialog.apiKeysHint')}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="setup-models">{t('aggregate.dialog.models')}</Label>
          <Textarea
            id="setup-models"
            rows={4}
            className="font-mono text-xs"
            value={models}
            onChange={event => setModels(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('aggregate.manage.setup.modelsHint')}</p>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('aggregate.manage.setup.submit')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** 多 Key 管理：逐条新增（先校验）、复查、启停、删除。 */
function KeysCard(props: {
  entry: AggregateEntry
  keys: AggregateKeyInfo[]
  reasonText: (reason?: string) => string
  onApplyDetail: (detail: AggregateDetail) => void
  onRefresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { entry, keys, reasonText, onApplyDetail, onRefresh } = props

  const [newKey, setNewKey] = useState('')
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (entry.authKind !== 'apiKey') {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('aggregate.manage.keys.title')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('aggregate.manage.keys.keyless')}</CardContent>
      </Card>
    )
  }

  const handleAdd = async () => {
    const key = newKey.trim()
    if (!key) return
    setAdding(true)
    const result = await window.electronAPI.aggregate.addKey(entry.id, key)
    setAdding(false)
    if (!result.success) {
      toast({
        title: t('common.error'),
        description: result.message ?? t('aggregate.manage.keys.rejected', { message: reasonText(result.reason) }),
        variant: 'destructive',
      })
      return
    }
    setNewKey('')
    if (result.detail) onApplyDetail(result.detail)
    toast({ title: t('aggregate.manage.keys.added') })
    await onRefresh()
  }

  const settle = async (result: AggregateMutationResult, okTitle: string) => {
    if (!result.success) {
      toast({
        title: t('common.error'),
        description: result.message ?? reasonText(result.reason),
        variant: 'destructive',
      })
      return false
    }
    if (result.detail) onApplyDetail(result.detail)
    toast({ title: okTitle })
    return true
  }

  const handleValidate = async (key: AggregateKeyInfo) => {
    setBusyId(key.id)
    const result = await window.electronAPI.aggregate.validateKey(entry.id, key.id)
    setBusyId(null)
    await settle(result, t('aggregate.manage.keys.valid'))
    await onRefresh()
  }

  const handleToggle = async (key: AggregateKeyInfo, enabled: boolean) => {
    setBusyId(key.id)
    const result = await window.electronAPI.aggregate.setKeyEnabled(key.id, enabled)
    setBusyId(null)
    await settle(result, t('aggregate.manage.toast.saved'))
    await onRefresh()
  }

  const handleDelete = async (key: AggregateKeyInfo) => {
    setBusyId(key.id)
    const result = await window.electronAPI.aggregate.removeKey(key.id)
    setBusyId(null)
    await settle(result, t('aggregate.manage.toast.removed'))
    await onRefresh()
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          {t('aggregate.manage.keys.title')}
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {t('aggregate.manage.keyCount', { count: keys.length })}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {keys.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('aggregate.manage.keys.empty')}</p>
        )}

        <div className="space-y-1.5">
          {keys.map(key => (
            <div key={key.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-mono text-xs">{key.maskedKey}</span>
              <Badge variant={key.status === 'active' ? 'default' : key.status === 'error' ? 'destructive' : 'outline'}>
                {key.status === 'active'
                  ? t('common.enabled')
                  : key.status === 'error'
                    ? t('aggregate.manage.keys.statusError')
                    : t('common.disabled')}
              </Badge>
              {key.errorMessage && (
                <span className="max-w-[16rem] truncate text-[11px] text-destructive" title={key.errorMessage}>
                  {key.errorMessage}
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {key.lastUsed
                  ? t('aggregate.manage.keys.lastUsed', { time: new Date(key.lastUsed).toLocaleString() })
                  : new Date(key.createdAt).toLocaleDateString()}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                title={t('aggregate.manage.keys.validate')}
                disabled={busyId === key.id}
                onClick={() => void handleValidate(key)}
              >
                {busyId === key.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              </Button>
              <Switch
                checked={key.status === 'active'}
                disabled={busyId === key.id}
                onCheckedChange={enabled => void handleToggle(key, enabled)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-destructive"
                title={t('aggregate.manage.keys.delete')}
                disabled={busyId === key.id}
                onClick={() => void handleDelete(key)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              className="font-mono text-xs"
              type="password"
              placeholder={t('aggregate.manage.keys.placeholder')}
              value={newKey}
              disabled={adding}
              onChange={event => setNewKey(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleAdd()
                }
              }}
            />
            <Button onClick={() => void handleAdd()} disabled={adding || !newKey.trim()}>
              {adding ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
              {t('aggregate.manage.keys.add')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('aggregate.manage.keys.hint')}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** 接口地址卡：可改 Base URL，并显示实际调用路径。 */
function EndpointCard(props: {
  entry: AggregateEntry
  state: AggregateEntryState
  reasonText: (reason?: string) => string
  onRefresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { entry, state, reasonText, onRefresh } = props

  const [baseUrl, setBaseUrl] = useState(state.baseUrl ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setBaseUrl(state.baseUrl ?? '')
  }, [state.baseUrl])

  const changed = (state.baseUrl ?? '') !== baseUrl.trim()
  const invalid = Boolean(baseUrl.trim()) && !/^https?:\/\//i.test(baseUrl.trim())
  const canReset = Boolean(entry.baseUrl) && (state.baseUrl ?? '') !== entry.baseUrl

  const handleSave = async () => {
    if (invalid) {
      toast({ title: t('common.error'), description: t('aggregate.manage.endpoint.invalid'), variant: 'destructive' })
      return
    }
    setSaving(true)
    const result = await window.electronAPI.aggregate.save({ id: entry.id, baseUrl: baseUrl.trim() || undefined, enabled: state.enabled })
    setSaving(false)
    if (!result.success) {
      toast({ title: t('common.error'), description: reasonText(result.reason), variant: 'destructive' })
      return
    }
    toast({ title: t('aggregate.manage.endpoint.saved') })
    await onRefresh()
  }

  const handleReset = async () => {
    if (!entry.baseUrl) return
    setBaseUrl(entry.baseUrl)
    setSaving(true)
    const result = await window.electronAPI.aggregate.save({ id: entry.id, baseUrl: entry.baseUrl, enabled: state.enabled })
    setSaving(false)
    if (!result.success) {
      toast({ title: t('common.error'), description: reasonText(result.reason), variant: 'destructive' })
      return
    }
    await onRefresh()
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('aggregate.manage.endpoint.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-[16rem] flex-1 font-mono text-xs"
            value={baseUrl}
            onChange={event => setBaseUrl(event.target.value)}
          />
          <Button onClick={() => void handleSave()} disabled={saving || !changed || invalid}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {t('aggregate.manage.endpoint.save')}
          </Button>
          <Button variant="outline" onClick={() => void handleReset()} disabled={saving || !canReset}>
            {t('aggregate.manage.endpoint.reset')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('aggregate.manage.endpoint.chatPath')}:{' '}
          <span className="font-mono">
            {(state.baseUrl ?? '').replace(/\/+$/, '')}
            {entry.wire === 'anthropic-messages' ? '/messages' : '/chat/completions'}
          </span>
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * 一次额度读数的界面文案。
 *
 * 三条硬要求都在这里落地：
 * - 「没问出来」和「问出来是 0」是两句话：失败只显示分类（HTTP 状态 / 非 JSON / 形状不认识 /
 *   网络），永远不显示成"额度为 0"，也不留旧数字当现值。
 * - 无上限（`limit: null`）不折算成任何数：它既不是 0 也不是"还有很多"。
 * - 美元与人民币各自带单位出现，绝不和本应用的 token 计量出现在同一个数字里。
 */
function CreditReadingLine(props: { reading: AggregateCreditReading }) {
  const { t } = useTranslation()
  const { reading } = props

  if (!reading.ok) {
    const labelKey =
      reading.reason === 'http-status'
        ? 'aggregate.manage.credit.failHttpStatus'
        : reading.reason === 'not-json'
          ? 'aggregate.manage.credit.failNotJson'
          : reading.reason === 'network'
            ? 'aggregate.manage.credit.failNetwork'
            : 'aggregate.manage.credit.failShape'
    return (
      <span className="text-destructive" title={reading.detail}>
        {t('aggregate.manage.credit.failDetail', { label: t(labelKey), detail: reading.detail })}
      </span>
    )
  }

  if (reading.unlimited) {
    return <span>{t('aggregate.manage.credit.unlimited')}</span>
  }

  if (typeof reading.remaining !== 'number') {
    // 上游给了帽却没给余额：这不足以说"还剩多少"，照实说没有余额。
    return (
      <span>
        {t('aggregate.manage.credit.limitOnly', { limit: reading.limit ?? 0, unit: reading.unit })}
      </span>
    )
  }

  return (
    <span className="font-mono">
      {typeof reading.limit === 'number'
        ? t('aggregate.manage.credit.remainingWithLimit', {
            remaining: reading.remaining,
            limit: reading.limit,
            unit: reading.unit,
          })
        : t('aggregate.manage.credit.remaining', { remaining: reading.remaining, unit: reading.unit })}
    </span>
  )
}

/** 读数时刻的本地化显示；解析不了就原样给出去，不假装是"刚刚"。 */
function creditTimeOf(asOf: string): string {
  const at = Date.parse(asOf)
  return Number.isNaN(at) ? asOf : new Date(at).toLocaleString()
}

/** 免费额度卡：官方上限 / 本应用计量 / 官方口径说明，加一行手点出来的实时余额。 */
function QuotaCard(props: {
  entry: AggregateEntry
  hasApiKey: boolean
  usage?: AggregateQuotaUsage
  credit?: AggregateCreditSnapshot
  onRefresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { entry, hasApiKey, usage, credit, onRefresh } = props
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<AggregateCreditQueryResult | null>(null)

  const view = quotaViewOf(entry, { hasApiKey, usage })
  const rows = quotaRows(entry.id, usage)
  // 五态按严重程度着色：只有打满是红的，官方未公布是警示色，有官方数字是健康色。
  const stateTone =
    view.state === 'exhausted'
      ? 'border-transparent bg-destructive text-destructive-foreground'
      : view.state === 'documented'
        ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300'
        : view.state === 'undocumented'
          ? 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400'
          : 'text-muted-foreground'

  const probeDeclaration = entry.quotaProbe
  /** 只有那一个按钮会发请求：没有轮询，也没有开页自动查。 */
  const handleQueryCredits = async () => {
    setProbing(true)
    try {
      setProbe(await window.electronAPI.aggregate.queryCredits(entry.id))
      // 问成功的这一次会落盘成快照，面板要把它带回来显示"读数时间/是否过期"。
      await onRefresh()
    } finally {
      setProbing(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          {t('aggregate.manage.quota.title')}
        </CardTitle>
        <div className="flex items-center gap-2">
          {view.isFreePool && (
            <Badge variant="outline" className="border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {t('aggregate.quotaFreePool')}
            </Badge>
          )}
          <Badge variant="outline" className={stateTone}>
            {t(`aggregate.quota.${view.state}`)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {view.state === 'exhausted' && view.exhaustedMetric && (
          <p className="text-xs text-destructive">
            {t('aggregate.quotaUsage', {
              metric: t(`aggregate.metric.${view.exhaustedMetric}`),
              used: view.used ?? 0,
              limit: view.limit ?? 0,
              window: t(`aggregate.window.${WINDOW_OF_METRIC[view.exhaustedMetric]}`),
            })}
          </p>
        )}
        {view.state === 'needs-key' && (
          <p className="text-sm text-muted-foreground">{t('aggregate.manage.quota.notKeyed')}</p>
        )}
        {rows.length > 0 && (
          <div className="space-y-1">
            {rows.map(row => (
              <div key={row.metric} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                <span>{t(`aggregate.metric.${row.metric}`)}</span>
                <span className="font-mono">
                  {row.used}/{row.limit}
                </span>
                <span className="text-muted-foreground">{t(`aggregate.window.${WINDOW_OF_METRIC[row.metric]}`)}</span>
              </div>
            ))}
          </div>
        )}
        {rows.length === 0 && view.state !== 'needs-key' && (
          <p className="text-sm text-muted-foreground">{t('aggregate.manage.quota.none')}</p>
        )}
        {view.officialNote && (
          <p className="text-xs text-muted-foreground" title={view.officialNote}>
            {t('aggregate.quotaScopeNote')}
            {view.officialNote}
          </p>
        )}
        {(view.asOf || view.docUrl) && (
          <p className="text-[11px] text-muted-foreground">
            {view.asOf ? t('aggregate.quotaSource', { date: view.asOf }) : ''}
            {view.docUrl && (
              <button
                type="button"
                className="ml-1 underline"
                onClick={() => window.electronAPI?.app?.openExternal?.(view.docUrl as string)}
              >
                {view.docUrl}
              </button>
            )}
          </p>
        )}
        {/*
          实时余额是**旁边独立的一行**：上面那张五态徽章（needs-key / exhausted / documented /
          undocumented / absent）一个字都不改写，也不把问回来的钱并进它的判定。
        */}
        {probeDeclaration && (
          <div className="space-y-1.5 border-t pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t('aggregate.manage.credit.title')}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasApiKey || probing}
                title={hasApiKey ? t('aggregate.manage.credit.hint', { path: probeDeclaration.path }) : t('aggregate.manage.credit.needsKey')}
                onClick={() => void handleQueryCredits()}
              >
                {probing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Coins className="mr-1.5 h-4 w-4" />}
                {probing ? t('aggregate.manage.credit.querying') : t('aggregate.manage.credit.query')}
              </Button>
            </div>

            {!hasApiKey && (
              <p className="text-xs text-muted-foreground">{t('aggregate.manage.credit.needsKey')}</p>
            )}

            {/* 逐把 Key 一行：多把 Key 各自问过一次，合并成一行会把"这把没钱那把有钱"说成"这家没钱"。 */}
            {probe?.rows.map(row => (
              <div key={row.keyId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="truncate" title={row.keyName}>
                  {t('aggregate.manage.credit.perKey', { name: row.keyName, maskedKey: row.maskedKey })}
                </span>
                <CreditReadingLine reading={row.reading} />
              </div>
            ))}
            {probe && probe.skipped > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('aggregate.manage.credit.skippedKeys', { n: probe.skipped })}
              </p>
            )}
            {probe?.failure && (
              <p className="text-xs text-destructive">{t(`aggregate.manage.credit.failure.${probe.failure}`)}</p>
            )}

            {/* 落盘的那一行（本次问成功 = 新读数；本次没问成 = 上一次读数的原样，带它自己的时刻与过期标记）。 */}
            {(() => {
              const shown = probe?.snapshot ?? credit
              if (!shown) {
                return probe ? null : (
                  <p className="text-xs text-muted-foreground">{t('aggregate.manage.credit.never')}</p>
                )
              }
              const fresh = creditSnapshotLive(shown)
              if (!shown.ok) {
                // 旧行只剩"上次也没问出来"这一种信息，别让它看起来像一个 0 余额。
                return (
                  <p className="text-xs text-muted-foreground">
                    {t('aggregate.manage.credit.lastFail', {
                      time: creditTimeOf(shown.asOf),
                      detail: t(`aggregate.manage.credit.reason.${shown.reason ?? 'network'}`),
                    })}
                  </p>
                )
              }
              return (
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-mono">
                      {shown.unlimited
                        ? t('aggregate.manage.credit.unlimited')
                        : typeof shown.limit === 'number'
                          ? t('aggregate.manage.credit.remainingWithLimit', {
                              remaining: shown.remaining ?? 0,
                              limit: shown.limit,
                              unit: shown.unit,
                            })
                          : t('aggregate.manage.credit.remaining', { remaining: shown.remaining ?? 0, unit: shown.unit })}
                    </span>
                    <span className="text-muted-foreground">{t('aggregate.manage.credit.at', { time: creditTimeOf(shown.asOf) })}</span>
                  </div>
                  <p className={fresh ? 'text-[11px] text-muted-foreground' : 'text-[11px] text-amber-700 dark:text-amber-400'}>
                    {fresh
                      ? t('aggregate.manage.credit.orderingOn', { minutes: Math.round(CREDIT_SNAPSHOT_TTL_MS / 60_000) })
                      : t('aggregate.manage.credit.orderingOff', { minutes: Math.round(CREDIT_SNAPSHOT_TTL_MS / 60_000) })}
                  </p>
                </div>
              )
            })()}

            <p className="text-[11px] text-muted-foreground" title={probeDeclaration.docUrl}>
              {t('aggregate.manage.credit.endpoint', { path: probeDeclaration.path, doc: probeDeclaration.docUrl })}
              {` ${t('aggregate.quotaSource', { date: probeDeclaration.asOf })}`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** 一行模型加它算出来的消耗分类（主进程没送 `cost` 时由渲染进程就地补算）。 */
interface ModelRow {
  model: AggregateModelInfo
  cost: AggregateModelCostSignal
}

/** 模型卡：搜索、同步、添加、批量测试、分组列表、逐模型参数 / 测试 / 启停 / 删除。 */
function ModelsCard(props: {
  entry: AggregateEntry
  models: AggregateModelInfo[]
  reasonText: (reason?: string) => string
  onApplyDetail: (detail: AggregateDetail) => void
  onRefresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { entry, models, reasonText, onApplyDetail, onRefresh } = props

  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [busyModel, setBusyModel] = useState<string | null>(null)
  const [busyGroup, setBusyGroup] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [testingAll, setTestingAll] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, AggregateModelTestResult>>({})
  const [paramModel, setParamModel] = useState<string | null>(null)
  const [paramDraft, setParamDraft] = useState<ParamDraft | null>(null)
  /** 逐模型标注对话框的目标行（providerId 就是 `entry.id`，聚合供应商记录与目录条目同名）。 */
  const [annotateModel, setAnnotateModel] = useState<AggregateModelInfo | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [adding, setAdding] = useState(false)
  /** 消耗筛选：`all` = 不筛；其余按分类精确匹配。 */
  const [costFilter, setCostFilter] = useState<'all' | AggregateCostClass>('all')
  /**
   * 手工标注表：`detail()` 只回目录行，不含标注，所以保存后光看模型行会像「什么都没发生」。
   * 标注写入经 onRefresh 换出新的 models 引用，这里随之重读一次，把「已标注」显示出来。
   * 判据与路由池编辑器一致：该行有任意手工字段就算已标注。
   */
  const [marks, setMarks] = useState<Record<string, Record<string, ModelCapabilityHint>>>({})
  useEffect(() => {
    const api = window.electronAPI?.providers
    if (!api?.getModelMarks) return
    let cancelled = false
    void api.getModelMarks()
      .then((next) => { if (!cancelled) setMarks(next) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [entry.id, models])

  /**
   * 标准库采用台账：批量补全写的是 catalogAdoptions，不是 userModelMarks。
   * 行上只显示手工标注会让一次成功的批量补全看起来毫无变化，所以同样随 refresh 重读。
   */
  const [adoptions, setAdoptions] = useState<CatalogAdoption[]>([])
  useEffect(() => {
    const api = window.electronAPI?.providers
    if (!api?.getCatalogAdoptions) return
    let cancelled = false
    void api.getCatalogAdoptions()
      .then((next) => { if (!cancelled) setAdoptions(next) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [entry.id, models])

  const adoptedByModel = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of adoptions) {
      if (item.providerId !== entry.id) continue
      counts.set(item.displayName, (counts.get(item.displayName) ?? 0) + 1)
    }
    return counts
  }, [adoptions, entry.id])

  /**
   * 这一家的解析结果（含批量补全刚采用的值）。
   *
   * 采用台账只回答「补了几项」，行上要看到「补成了什么」必须读解析后的六项属性；
   * 按供应商一次读回全部行，避免逐模型 N 次 store 解密。
   */
  const [metadataByModel, setMetadataByModel] = useState<Record<string, ModelMetadata>>({})
  useEffect(() => {
    const api = window.electronAPI?.providers
    if (!api?.getModelMetadata) return
    let cancelled = false
    void api.getModelMetadata(entry.id)
      .then((result) => {
        if (cancelled || !('totals' in result)) return
        const next: Record<string, ModelMetadata> = {}
        for (const row of result.records ?? []) next[row.displayName] = row
        setMetadataByModel(next)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [entry.id, models])

  const servedCount = models.filter(model => model.served).length

  /**
   * 每行带上消耗分类。
   *
   * 主进程会随 `detail()` 一起把 `cost` 送过来，但这里仍要有一个本地兜底：
   * dev 模式下 HMR 只重载渲染进程，主进程还跑着旧包，此时送到前端的模型行没有
   * `cost` 字段。直接读 `model.cost.class` 会抛 undefined 并让整个页面崩掉，
   * 而"分类器算不出来"本来就有合法答案（unknown），所以就地算一次即可。
   * 分类器是纯函数，两条路径结论一致。
   */
  const rows = useMemo(
    () =>
      models.map(model => ({
        model,
        cost:
          model.cost ??
          aggregateCostOf({
            entryId: entry.id,
            modelId: model.id,
            ...(entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}),
          }),
      })),
    [models, entry.id, entry.freeModelsHint]
  )

  // 汇总一行：四类各多少。分开计数而不是只报"免费/付费"，
  // 因为"套餐内"与"未标注"都是需要用户自己判断的中间状态。
  const costCounts = useMemo(
    () => aggregateCostCounts(rows.map(row => row.cost)),
    [rows]
  )

  const filtered = useMemo(() => {
    const byCost = costFilter === 'all' ? rows : rows.filter(row => row.cost.class === costFilter)
    const needle = search.trim().toLowerCase()
    if (!needle) return byCost
    return byCost.filter(row =>
      row.model.id.toLowerCase().includes(needle) || row.model.displayName.toLowerCase().includes(needle)
    )
  }, [rows, search, costFilter])

  const groups = useMemo(() => {
    const map = new Map<string, ModelRow[]>()
    for (const row of filtered) {
      const group = groupOfModel(row.model.id)
      const list = map.get(group) ?? []
      list.push(row)
      map.set(group, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const settle = async (result: AggregateMutationResult, okTitle?: string): Promise<boolean> => {
    if (!result.success) {
      toast({
        title: t('common.error'),
        description: result.message ?? reasonText(result.reason),
        variant: 'destructive',
      })
      return false
    }
    if (result.detail) onApplyDetail(result.detail)
    if (okTitle) toast({ title: okTitle })
    return true
  }

  const handleSync = async () => {
    setSyncing(true)
    const result = await window.electronAPI.aggregate.syncModels(entry.id)
    setSyncing(false)
    if (!result.success) {
      toast({ title: t('common.error'), description: reasonText(result.reason), variant: 'destructive' })
      return
    }

    // 清单来源必须说清：由 models.dev 补的清单比上游略滞后，
    // 用户据此判断"这家漏了模型"时该怪目录还是怪自己的 Key。
    if (result.modelSource === 'models.dev') {
      toast({
        title: t('aggregate.manage.toast.synced', {
          fetched: result.fetchedCount ?? 0,
          added: result.addedCount ?? 0,
          total: result.modelCount ?? 0,
        }),
        description: t('aggregate.manage.toast.syncedFromModelsDev'),
      })
    } else if ((result.addedCount ?? 0) === 0) {
      toast({ title: t('aggregate.manage.toast.syncedNoChange') })
    } else {
      toast({
        title: t('aggregate.manage.toast.synced', {
          fetched: result.fetchedCount ?? 0,
          added: result.addedCount ?? 0,
          total: result.modelCount ?? 0,
        }),
      })
    }
    await onRefresh()
  }

  const handleToggleModel = async (model: AggregateModelInfo, enabled: boolean) => {
    setBusyModel(model.id)
    const result = await window.electronAPI.aggregate.setModelEnabled(entry.id, model.id, enabled)
    setBusyModel(null)
    await settle(result)
    await onRefresh()
  }

  const handleDeleteModel = async (model: AggregateModelInfo) => {
    if (!window.confirm(t('aggregate.manage.models.delete'))) return
    setBusyModel(model.id)
    const result = await window.electronAPI.aggregate.removeModel(entry.id, model.id)
    setBusyModel(null)
    const ok = await settle(result)
    if (ok) toast({ title: t('aggregate.manage.toast.modelRemoved', { model: model.id }) })
    await onRefresh()
  }

  const handleTestModel = async (model: AggregateModelInfo) => {
    setBusyModel(model.id)
    const result = await window.electronAPI.aggregate.testModel(entry.id, model.id)
    setBusyModel(null)
    setTestResults(prev => ({ ...prev, [model.id]: result }))
  }

  const handleTestAll = async () => {
    if (filtered.length === 0) return
    setTestingAll(true)
    toast({ title: t('aggregate.manage.toast.testing', { count: filtered.length }) })
    const next: Record<string, AggregateModelTestResult> = { ...testResults }
    let ok = 0
    let failed = 0
    for (const row of filtered) {
      setBusyModel(row.model.id)
      const result = await window.electronAPI.aggregate.testModel(entry.id, row.model.id)
      next[row.model.id] = result
      if (result.success) ok += 1
      else failed += 1
    }
    setBusyModel(null)
    setTestingAll(false)
    setTestResults(next)
    toast({ title: t('aggregate.manage.toast.tested', { ok, failed }) })
  }

  const handleGroupToggle = async (groupRows: ModelRow[]) => {
    const allServed = groupRows.every(row => row.model.served)
    const enable = !allServed
    setBusyGroup(groupOfModel(groupRows[0].model.id))
    for (const row of groupRows) {
      const result = await window.electronAPI.aggregate.setModelEnabled(entry.id, row.model.id, enable)
      if (result.success && result.detail) onApplyDetail(result.detail)
    }
    setBusyGroup(null)
    await onRefresh()
  }

  const openParams = (model: AggregateModelInfo) => {
    setParamModel(model.id)
    setParamDraft(draftOfParams(model.params))
  }

  const closeParams = () => {
    setParamModel(null)
    setParamDraft(null)
  }

  const applyParams = async () => {
    if (!paramModel || !paramDraft) return
    const parsed = parseParamDraft(paramDraft)
    if (!parsed) {
      toast({ title: t('common.error'), description: t('aggregate.dialog.paramsInvalid'), variant: 'destructive' })
      return
    }
    const result = await window.electronAPI.aggregate.setModelParams(entry.id, paramModel, parsed)
    if (!(await settle(result, t('aggregate.manage.toast.saved')))) return
    await onRefresh()
    closeParams()
  }

  const clearParams = async () => {
    if (!paramModel) return
    const result = await window.electronAPI.aggregate.setModelParams(entry.id, paramModel, {})
    if (!(await settle(result, t('aggregate.manage.toast.saved')))) return
    await onRefresh()
    closeParams()
  }

  const handleAddModel = async () => {
    const id = newModelId.trim()
    if (!id) return
    setAdding(true)
    const result = await window.electronAPI.aggregate.addModel(entry.id, id)
    setAdding(false)
    if (!(await settle(result, t('aggregate.manage.toast.saved')))) return
    setNewModelId('')
    setAddOpen(false)
    await onRefresh()
  }

  const allCollapsed = groups.length > 0 && groups.every(([group]) => collapsed[group])

  return (
    <Card>
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wifi className="h-4 w-4" />
            {t('aggregate.manage.models.title')}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {t('aggregate.manage.models.count', { total: models.length, served: servedCount })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              placeholder={t('aggregate.manage.models.search')}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          {/* 消耗筛选：按分类精确筛，不是按价格区间 —— 价格不是倍率，没有可比区间 */}
          <Select value={costFilter} onValueChange={value => setCostFilter(value as 'all' | AggregateCostClass)}>
            <SelectTrigger className="w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('aggregate.manage.models.costFilterAll')}</SelectItem>
              <SelectItem value="free">{t('aggregate.manage.models.costFree')}</SelectItem>
              <SelectItem value="included">{t('aggregate.manage.models.costIncluded')}</SelectItem>
              <SelectItem value="priced">{t('aggregate.manage.models.costPriced')}</SelectItem>
              <SelectItem value="unknown">{t('aggregate.manage.models.costUnknown')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={syncing} onClick={() => void handleSync()} title={t('aggregate.manage.models.syncHint')}>
            {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            {t('aggregate.manage.models.sync')}
          </Button>
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('aggregate.manage.models.add')}
          </Button>
          <Button variant="outline" disabled={testingAll || filtered.length === 0} onClick={() => void handleTestAll()}>
            {testingAll ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
            {testingAll ? t('aggregate.manage.models.testing') : t('aggregate.manage.models.testAll')}
          </Button>
          {/* 按本条目批量补全：先估算再确认，范围只这一家（见 CatalogScopeBatchButton） */}
          <CatalogScopeBatchButton
            providerId={entry.id}
            scopeLabel={entry.name}
            onFinished={() => void onRefresh()}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setCollapsed(next => {
                const map: Record<string, boolean> = { ...next }
                for (const [group] of groups) map[group] = !allCollapsed
                return map
              })
            }
          >
            {allCollapsed ? t('aggregate.manage.models.expandAll') : t('aggregate.manage.models.collapseAll')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* 四类各多少：一行汇总，比只报"免费/付费"更能说明这一家到底怎么计费 */}
        <p className="text-[11px] text-muted-foreground">
          {t('aggregate.manage.models.costSummary', {
            free: costCounts.free,
            included: costCounts.included,
            priced: costCounts.priced,
            unknown: costCounts.unknown,
          })}
        </p>

        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('aggregate.manage.models.empty')}</p>
        )}

        {groups.map(([group, groupRows]) => {
          const expanded = !collapsed[group]
          const groupServed = groupRows.filter(row => row.model.served).length
          return (
            <div key={group} className="rounded-lg border">
              <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => setCollapsed(prev => ({ ...prev, [group]: !prev[group] }))}
                >
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <span className="truncate text-sm font-medium">{group}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {groupServed}/{groupRows.length}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  title={t('aggregate.manage.models.groupToggle')}
                  disabled={busyGroup === group}
                  onClick={() => void handleGroupToggle(groupRows)}
                >
                  {busyGroup === group ? <Loader2 className="h-3 w-3 animate-spin" /> : t('common.enabled')}
                </Button>
              </div>
              {expanded && (
                <div className="divide-y">
                  {groupRows.map(row => {
                    const model = row.model
                    const result = testResults[model.id]
                    const summary = paramSummary(model.params)
                    const cost = costBadgeOf(row.cost, t)
                    const adoptedCount = adoptedByModel.get(model.displayName) ?? 0
                    return (
                      <div key={model.displayName} className="flex flex-wrap items-center gap-2 px-2 py-1.5 hover:bg-muted/20">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-mono text-xs" title={model.displayName}>
                              {model.id}
                            </span>
                            <Badge variant="outline" className="px-1 py-0 text-[10px]">
                              {model.source === 'fetched'
                                ? t('aggregate.manage.models.sourceFetched')
                                : model.source === 'custom'
                                  ? t('aggregate.manage.models.sourceCustom')
                                  : t('aggregate.manage.models.sourceBuiltin')}
                            </Badge>
                            {/* 消耗徽标：四类各有各的文案，出处放在 title 里 */}
                            <Badge
                              variant="outline"
                              className={`px-1 py-0 text-[10px] ${cost.className}`}
                              title={cost.title}
                            >
                              {cost.label}
                            </Badge>
                            {Object.keys(marks[entry.id]?.[model.displayName] ?? {}).length > 0 && (
                              <Badge variant="outline" className="px-1 py-0 text-[10px] text-primary">
                                {t('proxy.routePoolManualMark')}
                              </Badge>
                            )}
                            {adoptedCount > 0 && (
                              <Badge variant="outline" className="px-1 py-0 text-[10px] text-info">
                                {t('aggregate.manage.models.adoptedBadge', { count: adoptedCount })}
                              </Badge>
                            )}
                          </div>
                          <ModelAnnotationSummary metadata={metadataByModel[model.displayName]} />
                          {summary && (
                            <span className="truncate font-mono text-[11px] text-muted-foreground" title={summary}>
                              {summary}
                            </span>
                          )}
                        </div>
                        {result && (
                          <span
                            className={result.success ? 'text-[11px] text-emerald-600 dark:text-emerald-400' : 'max-w-[12rem] truncate text-[11px] text-destructive'}
                            title={result.detail ?? ''}
                          >
                            {result.success
                              ? t('aggregate.manage.models.testOk', { latency: result.latencyMs ?? 0 })
                              : t('aggregate.manage.models.testFailed')}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          title={t('aggregate.manage.models.test')}
                          disabled={busyModel === model.id}
                          onClick={() => void handleTestModel(model)}
                        >
                          {busyModel === model.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          title={t('aggregate.dialog.paramsEdit')}
                          onClick={() => openParams(model)}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          title={`${t('aggregate.manage.models.annotate')} · ${t('aggregate.manage.models.annotateHint')}`}
                          onClick={() => setAnnotateModel(model)}
                        >
                          <Tags className="h-3.5 w-3.5" />
                        </Button>
                        <Switch
                          checked={model.served}
                          disabled={busyModel === model.id}
                          onCheckedChange={enabled => void handleToggleModel(model, enabled)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive"
                          title={t('aggregate.manage.models.delete')}
                          disabled={busyModel === model.id || models.length <= 1}
                          onClick={() => void handleDeleteModel(model)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('aggregate.manage.modelAdd.title')}</DialogTitle>
            <DialogDescription>
              {t('aggregate.manage.modelAdd.hint', { prefix: entry.id })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="add-model-id">{t('aggregate.manage.modelAdd.id')}</Label>
            <Input
              id="add-model-id"
              className="font-mono text-xs"
              value={newModelId}
              placeholder={t('aggregate.manage.modelAdd.placeholder')}
              onChange={event => setNewModelId(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleAddModel()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleAddModel()} disabled={adding || !newModelId.trim()}>
              {adding && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t('aggregate.manage.modelAdd.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paramModel !== null} onOpenChange={open => { if (!open) closeParams() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('aggregate.manage.modelParams.title', { model: paramModel ?? '' })}</DialogTitle>
            <DialogDescription>{t('aggregate.manage.modelParams.hint')}</DialogDescription>
          </DialogHeader>
          {paramDraft && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {NUMERIC_PARAM_FIELDS.map(field => (
                  <div key={field.key} className="space-y-1">
                    <Label className="font-mono text-[11px]">{field.label}</Label>
                    <Input
                      className="h-8 font-mono text-xs"
                      value={paramDraft[field.key]}
                      onChange={event => setParamDraft({ ...paramDraft, [field.key]: event.target.value })}
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">{t('aggregate.dialog.paramsExtra')}</Label>
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  placeholder='{"seed": 42, "top_k": 50}'
                  value={paramDraft.extraJson}
                  onChange={event => setParamDraft({ ...paramDraft, extraJson: event.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter className="justify-between">
            <Button variant="ghost" className="text-destructive" onClick={() => void clearParams()}>
              {t('aggregate.dialog.paramsClear')}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeParams}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void applyParams()}>{t('aggregate.dialog.paramsApply')}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {annotateModel && (
        <ModelAnnotationDialog
          providerId={entry.id}
          displayName={annotateModel.displayName}
          modelLabel={annotateModel.id}
          onClose={() => setAnnotateModel(null)}
          onChanged={() => void onRefresh()}
        />
      )}
    </Card>
  )
}
