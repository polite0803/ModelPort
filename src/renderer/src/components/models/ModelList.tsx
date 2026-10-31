import { useState, useMemo, useCallback, memo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useProvidersStore } from '@/stores/providersStore'
import { useProxyStore } from '@/stores/proxyStore'
import { useToast } from '@/hooks/use-toast'
import { Search, Copy, CheckCircle2, XCircle, Cpu, Check, Square, Database, ChevronLeft, ChevronRight, Loader2, Ban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import type { Account, CatalogueModel } from '@/types/electron'
import type { ChannelCredits, CostBucket } from '@shared/channels'
import { costBucketOf } from '@shared/channels'
import { aggregateCostOf } from '@shared/aggregateCost'
import modelMappingIcon from '@/assets/providers/model-mapping.svg'

const providerIcons: Record<string, string> = {
  mapping: modelMappingIcon,
}

/**
 * 模型类型。只有上游目录**明确声明**图片输入时才是 `multimodal`，
 * 明确声明不支持时才是 `text`，其余一律 `unknown` —— 不按模型名猜。
 */
type Modality = 'multimodal' | 'text' | 'unknown'

function toModality(declared: boolean | undefined): Modality {
  if (declared === true) return 'multimodal'
  if (declared === false) return 'text'
  return 'unknown'
}

/**
 * 消耗权重的颜色分档：0 免费（绿）、打折（主色）、基础 1 倍（灰）、
 * 加价（警告色）。只影响观感，不参与任何计费/筛选判断。
 */
function weightTone(weight: number): string {
  if (weight === 0) return 'text-success'
  if (weight < 1) return 'text-primary'
  if (weight === 1) return 'text-muted-foreground'
  return 'text-warning'
}

interface ModelInfo {
  id: string
  name: string
  providerId: string
  providerName: string
  accountId?: string
  accountName?: string
  status: 'available' | 'unavailable' | 'stopped'
  /** false = 已停用：不对外广告也不参与路由，但仍在列表里以便重新启用 */
  served: boolean
  /** 只有目录行带来源；模型映射别名行由「模型映射」页签管理，这一页不给它开关 */
  source?: 'builtin' | 'custom' | 'fetched'
  /** 来自渠道包目录的模态声明；没有声明时为 unknown */
  modality: Modality
  /** 上游消耗权重为 0 才是免费；undefined 表示没有费用信息，不能当成免费 */
  free?: boolean
  /** 上游生效倍率；缺失表示渠道没报，不能当成 0 */
  weight?: number
}

interface ModelRowProps {
  model: ModelInfo
  isSelected: boolean
  onSelect: (modelId: string) => void
  t: (key: string, params?: Record<string, any>) => string
  /** 供应商维度的当前余额/积分；缺省表示上游没有这份数据 */
  credits: Record<string, ChannelCredits | 'loading'>
  onToggleServed: (model: ModelInfo, served: boolean) => void
}

const PAGE_SIZE = 50

const ModelRow = memo(({ model, isSelected, onSelect, t, credits, onToggleServed }: ModelRowProps) => {
  const providerIcon = providerIcons[model.providerId]
  const credit = credits[model.providerId]
  
  return (
    <TableRow 
      className={cn(
        'cursor-pointer hover:bg-muted/50',
        isSelected && 'bg-muted',
        !model.served && 'opacity-60'
      )}
      onClick={() => onSelect(model.id)}
    >
      <TableCell>
        {isSelected ? (
          <Check className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4 text-muted-foreground" />
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-sm bg-muted px-2 py-1 rounded">
            {model.name}
          </code>
          {/* 倍率取自渠道目录；渠道没报的就标「未标注」，不拿 1 倍冒充 */}
          <Badge
            variant="outline"
            className={
              model.free === true
                ? 'text-success'
                : model.weight === undefined
                  ? 'text-muted-foreground'
                  : weightTone(model.weight)
            }
            title={
              model.free === true
                ? undefined
                : model.weight === undefined
                  ? t('models.weightUnknownHint')
                  : undefined
            }
          >
            {model.free === true
              ? 'x0'
              : model.weight === undefined
                ? t('models.costUnknown')
                : `x${model.weight}`}
          </Badge>
          {model.free === true && (
            <Badge variant="outline" className="text-success">
              {t('models.free')}
            </Badge>
          )}
          {model.modality === 'multimodal' && (
            <Badge variant="secondary">{t('models.multimodal')}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {providerIcon ? (
            <img 
              src={providerIcon} 
              alt={model.providerName} 
              className="h-4 w-4 object-contain"
            />
          ) : (
            <Database className="h-4 w-4 text-muted-foreground" />
          )}
          <Badge variant="outline">{model.providerName}</Badge>
          {/* 上标：供应商当前可用的余额/积分，来自渠道包的 credits.balances */}
          {credit === 'loading' ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : typeof credit?.remaining === 'number' ? (
            <sup
              className="text-[10px] font-medium tabular-nums text-muted-foreground"
              title={`${t('models.providerCredits')}: ${credit.remaining}`}
            >
              {credit.remaining}
            </sup>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {model.accountName ? (
          <span className="text-sm">{model.accountName}</span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {model.source !== undefined && (
            <Switch
              checked={model.served}
              onCheckedChange={(checked) => onToggleServed(model, checked)}
              onClick={(event) => event.stopPropagation()}
              aria-label={t('models.serveToggle')}
            />
          )}
          {model.status === 'stopped' ? (
            <>
              <Ban className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t('models.stopped')}</span>
            </>
          ) : model.status === 'available' ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm text-success">{t('models.available')}</span>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-error" />
              <span className="text-sm text-error">{t('models.unavailable')}</span>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
})

ModelRow.displayName = 'ModelRow'

export function ModelList() {
  const { t } = useTranslation()
  const { providers, accounts, modelsLastUpdated, setProviders, setAccounts, setModelsLastUpdated } = useProvidersStore()
  const { modelMappings } = useProxyStore()
  const { toast } = useToast()
  
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<string>('all')
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [catalogueMap, setCatalogueMap] = useState<Record<string, CatalogueModel[]>>({})
  const [serving, setServing] = useState(false)
  const [modalityFilter, setModalityFilter] = useState<'all' | Modality>('all')
  const [costFilter, setCostFilter] = useState<'all' | CostBucket>('all')
  /** 启用状态筛选：served = 对外广告且参与路由，stopped = 已停用 */
  const [servedFilter, setServedFilter] = useState<'all' | 'served' | 'stopped'>('all')
  /** `<provider>/<model>` -> 上游是否消耗权重为 0；缺失表示没有费用信息 */
  const [freeFlags, setFreeFlags] = useState<Record<string, boolean>>({})
  /** `<provider>/<model>` -> 上游生效倍率；缺失表示渠道没报，不是 0 */
  const [weightFlags, setWeightFlags] = useState<Record<string, number>>({})

  /** `<provider>/<model>` -> 目录是否声明接受图片；缺失表示没有这份信息 */
  const [modalityFlags, setModalityFlags] = useState<Record<string, boolean>>({})
  /** provider id -> 该供应商当前余额/积分（渠道包 credits.balances） */
  const [credits, setCredits] = useState<Record<string, ChannelCredits | 'loading'>>({})
  
  /** 该页可能直接由导航进入，供应商与账号得自己取一次 */
  useEffect(() => {
    if (!window.electronAPI?.providers?.getAll || !window.electronAPI.accounts?.getAll) return
    let cancelled = false
    Promise.all([
      window.electronAPI.providers.getAll(),
      window.electronAPI.accounts.getAll(),
    ])
      .then(([providersData, accountsData]) => {
        if (cancelled) return
        setProviders(providersData)
        setAccounts(accountsData)
      })
      .catch((error) => console.error('Failed to load providers for the model list:', error))
    return () => {
      cancelled = true
    }
  }, [setProviders, setAccounts])

  const loadCatalogue = useCallback(async () => {
    try {
      const enabledProviders = providers.filter(p => p.enabled)
      const newMap: Record<string, CatalogueModel[]> = {}
      
      for (const provider of enabledProviders) {
        try {
          const models = await window.electronAPI.providers.getModelCatalogue(provider.id)
          newMap[provider.id] = models
        } catch (error) {
          console.error(`Failed to load models for provider ${provider.id}:`, error)
          newMap[provider.id] = []
        }
      }
      
      setCatalogueMap(newMap)
    } catch (error) {
      console.error('Failed to load model catalogue:', error)
    }
  }, [providers])
  
  useEffect(() => {
    loadCatalogue()
  }, [loadCatalogue, modelsLastUpdated])

  /**
   * Catalogue facts come only from upstream declarations: the channel pack
   * reports `free` and `supportsImage` per model, and the aggregate registry
   * ships `freeModelsHint` per endpoint. Every other catalogue carries neither,
   * so a missing key stays "unknown" instead of being guessed.
   */
  const loadCatalogueFacts = useCallback(async () => {
    const free: Record<string, boolean> = {}
    const weights: Record<string, number> = {}
    const images: Record<string, boolean> = {}
    const channelProviders = providers.filter(p => p.enabled && p.type === 'account')
    await Promise.all(channelProviders.map(async (provider) => {
      try {
        const result = await window.electronAPI.channels.models(provider.id)
        for (const model of result.models ?? []) {
          const key = `${provider.id}/${model.id}`
          free[key] = model.free
          if (model.weight !== undefined) weights[key] = model.weight
          if (model.supportsImage !== undefined) images[key] = model.supportsImage
        }
      } catch (error) {
        console.error(`Failed to load channel models for ${provider.id}:`, error)
      }
    }))
    try {
      // 聚合条目走同一个分类器：只认 `freeModelsHint` 会丢掉官方免费清单，
      // 于是本页与聚合页对同一个模型给出不一致的说法。
      // 注意只认 `free`，不认 `included`：本页只有「免费 / 未标注倍率」两种说法，
      // 没有「套餐内」这一档，把套餐内标成免费正是聚合页刻意避免的那个坑。
      const result = await window.electronAPI.aggregate.list()
      for (const entry of result.entries ?? []) {
        for (const model of entry.models ?? []) {
          const signal = aggregateCostOf({
            entryId: entry.id,
            modelId: model.id,
            ...(entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}),
          })
          if (signal.class === 'free') free[`${entry.id}/${model.id}`] = true
        }
      }
    } catch (error) {
      console.error('Failed to load aggregate cost classification:', error)
    }
    setFreeFlags(free)
    setWeightFlags(weights)
    setModalityFlags(images)
  }, [providers])

  useEffect(() => {
    loadCatalogueFacts()
  }, [loadCatalogueFacts, modelsLastUpdated])

  /**
   * 余额/积分是**渠道级**数据，不是模型级：走渠道包的 `credits.balances`。
   * 没有账号的渠道不查；查不到（不支持/未登录/超时）就不显示上标，也不写 0。
   */
  const loadCredits = useCallback(async () => {
    const connected = providers.filter(p =>
      p.enabled && p.type === 'account' && accounts.some(account => account.providerId === p.id))
    if (connected.length === 0) {
      setCredits({})
      return
    }
    await Promise.all(connected.map(async (provider) => {
      // stale-while-revalidate：已有旧值时不置 loading（同 Channels.tsx ——
      // 账号启停等触发的重刷不该让所有渠道的上标一起闪）。
      setCredits(current => current[provider.id] === undefined
        ? { ...current, [provider.id]: 'loading' }
        : current)
      try {
        const value = await window.electronAPI.channels.credits(provider.id)
        setCredits(current => ({ ...current, [provider.id]: value }))
      } catch (error) {
        console.error(`Failed to load credits for ${provider.id}:`, error)
        setCredits(current => {
          const next = { ...current }
          delete next[provider.id]
          return next
        })
      }
    }))
  }, [providers, accounts])

  useEffect(() => {
    void loadCredits()
  }, [loadCredits, modelsLastUpdated])
  
  const modelList = useMemo(() => {
    const models: ModelInfo[] = []
    const enabledProviders = providers.filter(p => p.enabled)
    const addedModelNames = new Set<string>()
    const catalogueNames = new Set<string>()
    for (const provider of providers) {
      for (const name of provider.supportedModels || []) {
        catalogueNames.add(name)
      }
    }
    
    const accountMap = new Map<string, Account[]>()
    for (const account of accounts) {
      if (!accountMap.has(account.providerId)) {
        accountMap.set(account.providerId, [])
      }
      accountMap.get(account.providerId)!.push(account)
    }
    
    const activeProviderMap = new Map<string, boolean>()
    for (const provider of enabledProviders) {
      const providerAccounts = accountMap.get(provider.id) || []
      const hasActiveAccounts = providerAccounts.some(a => a.status === 'active')
      activeProviderMap.set(provider.id, hasActiveAccounts)
    }
    
    for (const provider of enabledProviders) {
      const catalogue = catalogueMap[provider.id] || []
      if (catalogue.length === 0) {
        continue
      }
      
      const providerAccounts = accountMap.get(provider.id) || []
      const hasActiveAccounts = activeProviderMap.get(provider.id) || false
      
      for (const model of catalogue) {
        const modelId = `${provider.id}-${model.displayName}`
        const status = !model.served ? 'stopped' : hasActiveAccounts ? 'available' : 'unavailable'
        addedModelNames.add(model.displayName)

        // 目录已用上游展示名，渠道事实仍按 `<channel>/<内部 id>`（即
        // actualModelId）记录，所以先按它查，再回落到展示名（内置供应商两者相同）。
        const free = freeFlags[model.actualModelId] ?? freeFlags[model.displayName]
        const weight = weightFlags[model.actualModelId] ?? weightFlags[model.displayName]
        const supportsImage = modalityFlags[model.actualModelId] ?? modalityFlags[model.displayName]

        models.push({
          id: modelId,
          name: model.displayName,
          providerId: provider.id,
          providerName: provider.name,
          accountId: providerAccounts[0]?.id,
          accountName: providerAccounts[0]?.name,
          status,
          served: model.served,
          source: model.source,
          modality: toModality(supportsImage),
          free,
          weight,
        })
      }
    }
    
    // A name owned by any provider catalogue is that provider's model (its sync writes a
    // global mapping per model), so only names no provider lists are user-defined aliases.
    for (const mapping of modelMappings) {
      if (!addedModelNames.has(mapping.requestModel) && !catalogueNames.has(mapping.requestModel)) {
        const owner = providers.find(p => p.id === mapping.preferredProviderId)
        models.push({
          id: `mapping-${mapping.requestModel}`,
          name: mapping.requestModel,
          providerId: owner ? owner.id : 'mapping',
          providerName: owner ? owner.name : (t('models.modelMapping') || 'Model Mapping'),
          accountId: mapping.preferredAccountId,
          accountName: mapping.preferredAccountId 
            ? (accounts.find(a => a.id === mapping.preferredAccountId)?.name)
            : undefined,
          status: owner ? (activeProviderMap.get(owner.id) ? 'available' : 'unavailable') : 'available',
          served: true,
          modality: 'unknown',
        })
      }
    }
    
    return models
  }, [providers, accounts, modelMappings, catalogueMap, freeFlags, weightFlags, modalityFlags, t])
  
  const filteredModels = useMemo(() => {
    let filtered = modelList
    
    if (selectedProvider !== 'all') {
      filtered = filtered.filter(m => m.providerId === selectedProvider)
    }
    
    if (modalityFilter !== 'all') {
      filtered = filtered.filter(m => m.modality === modalityFilter)
    }
    
    // 倍率缺失自成一档：没有倍率标注既不是便宜也不是付费确定，折进任何一档都会误导选择
    if (costFilter !== 'all') {
      filtered = filtered.filter(m => costBucketOf(m.weight, m.free === true) === costFilter)
    }
    
    if (servedFilter !== 'all') {
      filtered = filtered.filter(m => (servedFilter === 'served' ? m.served : !m.served))
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(m =>
        m.name.toLowerCase().includes(query) ||
        m.providerName.toLowerCase().includes(query)
      )
    }
    
    return filtered
  }, [modelList, selectedProvider, modalityFilter, costFilter, servedFilter, searchQuery])
  
  useEffect(() => {
    setCurrentPage(1)
    setSelectedModels(new Set())
    setSelectAll(false)
  }, [selectedProvider, modalityFilter, costFilter, servedFilter, searchQuery])
  
  const totalPages = useMemo(() => {
    return Math.ceil(filteredModels.length / PAGE_SIZE)
  }, [filteredModels.length])
  
  const paginatedModels = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE
    return filteredModels.slice(startIndex, startIndex + PAGE_SIZE)
  }, [filteredModels, currentPage])
  
  const providerOptions = useMemo(() => {
    const enabledProviders = providers.filter(p => p.enabled)
    const options = [
      { value: 'all', label: t('models.allProviders') },
      ...enabledProviders.map(p => ({ value: p.id, label: p.name })),
    ]
    // 只有对不上任何真实供应商的映射才需要「模型映射」这个类目
    if (modelList.some(m => m.providerId === 'mapping')) {
      options.push({ value: 'mapping', label: t('models.modelMapping') || 'Model Mapping' })
    }
    return options
  }, [providers, modelList, t])

  useEffect(() => {
    if (!providerOptions.some(option => option.value === selectedProvider)) {
      setSelectedProvider('all')
    }
  }, [providerOptions, selectedProvider])
  
  const handleSelectAll = useCallback(() => {
    const newSelectAll = !selectAll
    setSelectAll(newSelectAll)
    // 圈的是筛选后的全部行，不只是当前这一页
    setSelectedModels(newSelectAll ? new Set(filteredModels.map(m => m.id)) : new Set())
  }, [selectAll, filteredModels])
  
  const handleSelectModel = useCallback((modelId: string) => {
    const newSelected = new Set(selectedModels)
    if (newSelected.has(modelId)) {
      newSelected.delete(modelId)
    } else {
      newSelected.add(modelId)
    }
    setSelectedModels(newSelected)
    setSelectAll(newSelected.size === filteredModels.length)
  }, [selectedModels, filteredModels.length])

  /** 停用即从 `/v1/models` 与负载均衡里消失；别名行不归这一页管，跳过 */
  const changeServed = useCallback(async (rows: ModelInfo[], served: boolean): Promise<boolean> => {
    const namesByProvider = new Map<string, string[]>()
    for (const row of rows) {
      if (row.source === undefined) continue
      const names = namesByProvider.get(row.providerId) || []
      names.push(row.name)
      namesByProvider.set(row.providerId, names)
    }
    if (namesByProvider.size === 0) return true

    setServing(true)
    try {
      const nextCatalogue = { ...catalogueMap }
      for (const [providerId, names] of namesByProvider) {
        const result = await window.electronAPI.providers.setModelsServed(providerId, names, served)
        if (!result.success) {
          toast({
            title: t('common.error'),
            description: result.error || t('models.serveChangeFailed'),
            variant: 'destructive',
          })
          return false
        }
        nextCatalogue[providerId] = result.catalogue
      }
      setCatalogueMap(nextCatalogue)
      setModelsLastUpdated(Date.now())
      return true
    } finally {
      setServing(false)
    }
  }, [catalogueMap, setModelsLastUpdated, t, toast])

  const handleToggleServed = useCallback((model: ModelInfo, served: boolean) => {
    changeServed([model], served)
  }, [changeServed])

  /** 「仅启用选中」：选中的启用、其余目录行停用，跨全部供应商 */
  const handleServeOnlySelected = useCallback(async () => {
    const selected = new Set(selectedModels)
    const started = await changeServed(modelList.filter(m => selected.has(m.id)), true)
    if (!started) return
    const stopped = await changeServed(
      modelList.filter(m => m.source !== undefined && !selected.has(m.id)),
      false
    )
    if (!stopped) return
    toast({
      title: t('models.serveOnlyDone'),
      description: t('models.serveOnlyDoneDesc', { count: selected.size }),
    })
    setSelectedModels(new Set())
    setSelectAll(false)
  }, [changeServed, modelList, selectedModels, t, toast])
  
  const handleCopySelected = useCallback(async () => {
    const selectedModelNames = filteredModels
      .filter(m => selectedModels.has(m.id))
      .map(m => m.name)
    
    if (selectedModelNames.length === 0) {
      toast({
        title: t('models.noModelsFound'),
        description: t('models.noModelsDesc'),
        variant: 'destructive',
      })
      return
    }
    
    const text = selectedModelNames.join(',')
    
    try {
      await navigator.clipboard.writeText(text)
      toast({
        title: t('models.copySuccess'),
        description: t('models.copySuccessDesc', { count: selectedModelNames.length }),
      })
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      })
    }
  }, [filteredModels, selectedModels, t])
  
  const handleCopyAll = useCallback(async () => {
    if (filteredModels.length === 0) {
      toast({
        title: t('models.noModelsFound'),
        description: t('models.noModelsDesc'),
        variant: 'destructive',
      })
      return
    }
    
    const text = filteredModels.map(m => m.name).join(',')
    
    try {
      await navigator.clipboard.writeText(text)
      toast({
        title: t('models.copySuccess'),
        description: t('models.copySuccessDesc', { count: filteredModels.length }),
      })
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      })
    }
  }, [filteredModels, t])
  
  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(newPage)
    setSelectedModels(new Set())
    setSelectAll(false)
  }, [])
  
  if (modelList.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-[15px] w-[15px] text-[var(--text-muted)]" />
              <CardTitle>{t('models.modelList')}</CardTitle>
            </div>
            <Badge variant="outline">
              {t('models.totalModels', { count: 0 })}
            </Badge>
          </div>
          <CardDescription>
            {t('models.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="empty-state">
            <div className="empty-state-icon">
              <Cpu className="h-5 w-5" />
            </div>
            <p className="empty-state-title">{t('models.noModelsFound')}</p>
            <p className="empty-state-hint">{t('models.noModelsDesc')}</p>
          </div>
        </CardContent>
      </Card>
    )
  }
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-[15px] w-[15px] text-[var(--text-muted)]" />
            <CardTitle>{t('models.modelList')}</CardTitle>
          </div>
          <Badge variant="outline">
            {t('models.servedOfTotal', {
              served: modelList.filter(m => m.served).length,
              total: modelList.length,
            })}
          </Badge>
        </div>
        <CardDescription>
          {t('models.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('models.searchModels')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={selectedProvider} onValueChange={setSelectedProvider}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providerOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={modalityFilter}
            onValueChange={(value) => setModalityFilter(value as 'all' | Modality)}
          >
            <SelectTrigger className="w-[180px]" title={t('models.modalityHint')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('models.allTypes')}</SelectItem>
              <SelectItem value="multimodal">{t('models.typeMultimodal')}</SelectItem>
              <SelectItem value="text">{t('models.typeText')}</SelectItem>
              <SelectItem value="unknown">{t('models.typeUnknown')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={costFilter}
            onValueChange={(value) => setCostFilter(value as 'all' | CostBucket)}
          >
            <SelectTrigger className="w-[180px]" title={t('models.costHint')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('models.allCosts')}</SelectItem>
              <SelectItem value="free">{t('models.costFreeOnly')}</SelectItem>
              <SelectItem value="below-base">{t('models.costBelowBase')}</SelectItem>
              <SelectItem value="base">{t('models.costBase')}</SelectItem>
              <SelectItem value="above-base">{t('models.costAboveBase')}</SelectItem>
              <SelectItem value="unknown">{t('models.costUnknown')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={servedFilter}
            onValueChange={(value) => setServedFilter(value as 'all' | 'served' | 'stopped')}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('models.allServeStates')}</SelectItem>
              <SelectItem value="served">{t('models.servedOnly')}</SelectItem>
              <SelectItem value="stopped">{t('models.stoppedOnly')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              className="h-8 px-2"
            >
              {selectAll ? (
                <Check className="h-4 w-4 mr-2" />
              ) : (
                <Square className="h-4 w-4 mr-2" />
              )}
              {t('models.selectAll')}
            </Button>
            {selectedModels.size > 0 && (
              <Badge variant="secondary" className="text-xs">
                {t('models.selectedModels', { count: selectedModels.size })}
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleServeOnlySelected}
              disabled={selectedModels.size === 0 || serving}
            >
              {serving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {t('models.serveOnlySelected')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopySelected}
              disabled={selectedModels.size === 0}
            >
              <Copy className="h-4 w-4 mr-2" />
              {t('models.copySelected')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyAll}
              disabled={filteredModels.length === 0}
            >
              <Copy className="h-4 w-4 mr-2" />
              {t('models.copyAll')}
            </Button>
          </div>
        </div>
        
        {paginatedModels.length > 0 ? (
          <>
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>{t('models.modelName')}</TableHead>
                    <TableHead>{t('models.provider')}</TableHead>
                    <TableHead>{t('models.account')}</TableHead>
                    <TableHead>{t('models.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedModels.map((model) => (
                    <ModelRow
                      key={model.id}
                      model={model}
                      isSelected={selectedModels.has(model.id)}
                      onSelect={handleSelectModel}
                      t={t}
                      credits={credits}
                      onToggleServed={handleToggleServed}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 py-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  {t('models.pageInfo', { 
                    current: currentPage, 
                    total: totalPages 
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Database className="h-5 w-5" />
            </div>
            <p className="empty-state-title">{t('models.noModelsFound')}</p>
            <p className="empty-state-hint">
              {modelList.length > 0 ? t('models.noMatchDesc') : t('models.noModelsDesc')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default ModelList
