import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import type {
  AggregateDetail,
  AggregateEntry,
  AggregateEntryState,
  AggregateQuotaUsage,
} from '../../../shared/aggregate'
import { PageHeader } from '@/components/layout/PageHeader'
import { AggregateDetailPanel } from '@/components/aggregate/AggregateDetail'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { isPlanEntry } from '../../../shared/aggregateCost'
import type { AggregateQuotaExhaustionSummary } from '../../../shared/aggregateQuotaExhaustion'

/**
 * `plan` 不是目录里的 `AggregateCategory`，而是叠加在目录之上的一个视图：
 * 「这家是不是订阅套餐端点」由 `AGGREGATE_PLAN_ENTRIES` 判定，与计费类别无关。
 * 把它塞进枚举会逼着每条目录项都改数据，而这条信息本来就有单一出处。
 */
type CategoryFilter = 'all' | 'plan' | AggregateEntry['category']

const EMPTY_STATE = (entry: AggregateEntry): AggregateEntryState => ({
  configured: false,
  enabled: false,
  hasApiKey: false,
  apiKeyCount: 0,
  baseUrl: entry.baseUrl,
  modelCount: entry.models.length,
})

/**
 * 聚合渠道主界面：左侧是目录里的供应商列表（已启用 / 已停用 / 未添加），
 * 右侧是所选供应商的详情——Key 管理、接口地址、免费额度、模型清单，
 * 版式对齐 AxInvest 的服务商管理页。
 */
export function Aggregate() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [entries, setEntries] = useState<AggregateEntry[]>([])
  const [states, setStates] = useState<Record<string, AggregateEntryState>>({})
  const [quotaUsage, setQuotaUsage] = useState<Record<string, AggregateQuotaUsage>>({})
  const [quotaExhaustions, setQuotaExhaustions] = useState<Record<string, AggregateQuotaExhaustionSummary>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AggregateDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const selectedRef = useRef<string | null>(null)
  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.electronAPI.aggregate.list()
    setEntries(result.entries)
    setStates(result.states)
    setQuotaUsage(result.quotaUsage ?? {})
    setQuotaExhaustions(result.quotaExhaustions ?? {})
    setLoading(false)

    const id = selectedRef.current
    if (id && result.entries.some(entry => entry.id === id)) {
      const fresh = await window.electronAPI.aggregate.detail(id)
      setDetail(fresh)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 首次进入或刷掉当前选中项后，自动落在一个已配置的供应商上。
  useEffect(() => {
    if (loading) return
    if (selectedId && entries.some(entry => entry.id === selectedId)) return
    const initial = entries.find(entry => states[entry.id]?.configured) ?? entries[0]
    setSelectedId(initial?.id ?? null)
  }, [loading, entries, states, selectedId])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    void window.electronAPI.aggregate
      .detail(selectedId)
      .then(result => {
        if (!cancelled) setDetail(result)
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const reasonText = useCallback(
    (reason?: string) => {
      if (!reason) return t('aggregate.reasons.unknown')
      const key = `aggregate.reasons.${reason}`
      const translated = t(key)
      return translated === key ? reason : translated
    },
    [t]
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return entries.filter(entry => {
      if (category === 'plan' && !isPlanEntry(entry.id)) return false
      if (category !== 'all' && category !== 'plan' && entry.category !== category) return false
      if (!needle) return true
      if (entry.id.toLowerCase().includes(needle)) return true
      if (entry.name.toLowerCase().includes(needle)) return true
      return entry.models.some(model => model.id.toLowerCase().includes(needle))
    })
  }, [entries, search, category])

  const groups = useMemo(() => {
    const enabled: AggregateEntry[] = []
    const disabled: AggregateEntry[] = []
    const available: AggregateEntry[] = []
    for (const entry of filtered) {
      const state = states[entry.id]
      if (!state?.configured) available.push(entry)
      else if (state.enabled) enabled.push(entry)
      else disabled.push(entry)
    }
    return [
      { key: 'enabled', label: t('aggregate.manage.sectionEnabled'), entries: enabled },
      { key: 'disabled', label: t('aggregate.manage.sectionDisabled'), entries: disabled },
      { key: 'available', label: t('aggregate.manage.sectionAvailable'), entries: available },
    ].filter(group => group.entries.length > 0)
  }, [filtered, states, t])

  const handleToggle = async (entry: AggregateEntry, enabled: boolean) => {
    setBusyId(entry.id)
    const result = await window.electronAPI.aggregate.setEnabled(entry.id, enabled)
    setBusyId(null)
    if (!result.success) {
      toast({ title: t('common.error'), description: reasonText(result.reason), variant: 'destructive' })
      return
    }
    await refresh()
  }

  const handleRemove = async (entry: AggregateEntry) => {
    if (!window.confirm(t('aggregate.deleteConfirm', { name: entry.name }))) return
    await window.electronAPI.aggregate.remove(entry.id)
    toast({ title: t('aggregate.result.removed', { name: entry.name }) })
    const next =
      entries.find(other => other.id !== entry.id && states[other.id]?.configured) ??
      entries.find(other => other.id !== entry.id)
    setSelectedId(next?.id ?? null)
    await refresh()
  }

  const selected = entries.find(entry => entry.id === selectedId) ?? null
  const selectedState = selected ? states[selected.id] ?? EMPTY_STATE(selected) : null

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('aggregate.title')}
        description={t('aggregate.description')}
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3 lg:sticky lg:top-0">
          <Card>
            <CardContent className="space-y-2 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder={t('aggregate.manage.search')}
                  className="pl-9"
                />
              </div>
              <Select value={category} onValueChange={value => setCategory(value as CategoryFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('aggregate.allCategories')}</SelectItem>
                  <SelectItem value="plan">{t('aggregate.category.plan')}</SelectItem>
                  <SelectItem value="apikey">{t('aggregate.category.apikey')}</SelectItem>
                  <SelectItem value="free-tier">{t('aggregate.category.freeTier')}</SelectItem>
                  <SelectItem value="local">{t('aggregate.category.local')}</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="max-h-[calc(100vh-16rem)] overflow-y-auto p-2">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.loading')}
                </div>
              )}
              {!loading && groups.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">{t('aggregate.manage.noMatch')}</p>
              )}
              {!loading &&
                groups.map(group => (
                  <div key={group.key} className="mb-2 last:mb-0">
                    <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {group.label} · {group.entries.length}
                    </p>
                    <div className="space-y-0.5">
                      {group.entries.map(entry => {
                        const state = states[entry.id] ?? EMPTY_STATE(entry)
                        const active = entry.id === selectedId
                        return (
                          <div
                            key={entry.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedId(entry.id)}
                            onKeyDown={event => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setSelectedId(entry.id)
                              }
                            }}
                            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${
                              active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                            }`}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase">
                              {entry.name.slice(0, 1)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-medium">{entry.name}</span>
                                {state.configured && (
                                  <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                      state.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                                    }`}
                                  />
                                )}
                                {quotaExhaustions[entry.id] !== undefined && (
                                  <span
                                    className="shrink-0 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive-foreground"
                                    title={t('aggregate.manage.exhaustion.badgeTitle', {
                                      count: quotaExhaustions[entry.id].count,
                                    })}
                                  >
                                    {t('aggregate.manage.exhaustion.badge')}
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {state.configured
                                  ? t('aggregate.manage.modelCount', { count: state.modelCount })
                                  : t('aggregate.notConfigured')}
                                {entry.authKind === 'apiKey' && state.apiKeyCount > 0
                                  ? ` · ${t('aggregate.manage.keyCount', { count: state.apiKeyCount })}`
                                  : ''}
                              </p>
                            </div>
                            {state.configured && (
                              <Switch
                                checked={state.enabled}
                                disabled={busyId === entry.id}
                                onClick={event => event.stopPropagation()}
                                onCheckedChange={enabled => void handleToggle(entry, enabled)}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0">
          {selected && selectedState ? (
            <AggregateDetailPanel
              entry={selected}
              state={selectedState}
              quotaUsage={quotaUsage[selected.id]}
              detail={detail}
              loading={detailLoading}
              reasonText={reasonText}
              onRefresh={refresh}
              onApplyDetail={setDetail}
              onRemove={() => handleRemove(selected)}
            />
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                {t('aggregate.manage.noMatch')}
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  )
}
