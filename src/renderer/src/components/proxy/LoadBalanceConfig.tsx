import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { useProxyStore, type AccountWeight } from '@/stores/proxyStore'
import { useToast } from '@/hooks/use-toast'
import type { LoadBalanceStrategy, Account, Provider, ModelRoute } from '@/types/electron'
import { DEFAULT_AUTO_ROUTING_CONFIG } from '../../../../shared/types'
import {
  ModelRouteFields,
  defaultRouteFieldValues,
  routeFieldValuesOf,
  type ModelRouteFieldValues,
  type ModelRouteStrategyOption,
} from './ModelRouteFields'
import { Scale, RefreshCw, Info, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react'

// 默认值只有一份：配置层归一化用的是同一个常量，避免两处漂移。
// 路由的初始字段（含新建表单）全部从这个常量取，UI 不抄任何数字。
const DEFAULT_AUTO_ROUTING = DEFAULT_AUTO_ROUTING_CONFIG

// 五个策略的字面量与两张标签/说明映射只留这一处：逐路由的 `strategy` 下拉拿的是
// 由它们生成的 `strategyOptions`，所以加一个策略时不会再多出一份要同步的选项数组。
const STRATEGY_VALUES = ['round-robin', 'fill-first', 'failover', 'smart', 'pace'] as LoadBalanceStrategy[]

/** 按名字排序的**新**数组：`routes:list` 已排序，写入返回的是 Record，两边都收敛到这里。 */
function sortedRoutes(routes: ModelRoute[]): ModelRoute[] {
  return [...routes].sort((a, b) => a.name.localeCompare(b.name))
}

/** 写入结果里的 `Record<string, ModelRoute>` → 列表（新对象，不改主进程返回的表）。 */
function routesFromRecord(record: Record<string, ModelRoute>): ModelRoute[] {
  return sortedRoutes(Object.values(record))
}

interface LoadBalanceConfigProps {
  onConfigChange?: () => void
}

export function LoadBalanceConfig({ onConfigChange }: LoadBalanceConfigProps) {
  const { t } = useTranslation()
  const {
    loadBalanceStrategy,
    setLoadBalanceStrategy,
    accountWeights,
    setAccountWeights,
    saveAppConfig,
    isLoading,
  } = useProxyStore()
  const { toast } = useToast()
  
  const initialStrategyRef = useRef<LoadBalanceStrategy>(loadBalanceStrategy)
  const initialWeightsRef = useRef<AccountWeight[]>(accountWeights)
  
  const [selectedStrategy, setSelectedStrategy] = useState<LoadBalanceStrategy>(loadBalanceStrategy)
  const [weights, setWeights] = useState<AccountWeight[]>(accountWeights)
  const [accounts, setAccounts] = useState<(Account & { provider?: Provider })[]>([])
  const [hasChanges, setHasChanges] = useState(false)

  // ── 多路由（`AppConfig.routes`）的本地状态 ────────────────────────
  // `routes` 是盘上真表的镜像：写操作成功后直接用 IPC 返回的整表替换它，
  // 所以「写完立刻生效」不依赖重启代理，也不依赖再拉一次 `list()`。
  const [routes, setRoutes] = useState<ModelRoute[]>([])
  const [isCreatingRoute, setIsCreatingRoute] = useState(false)
  const [newRouteName, setNewRouteName] = useState('')
  const [newRouteValues, setNewRouteValues] = useState<ModelRouteFieldValues>(() =>
    defaultRouteFieldValues(loadBalanceStrategy)
  )
  const [editingRouteName, setEditingRouteName] = useState<string | null>(null)
  const [routeDraft, setRouteDraft] = useState<ModelRouteFieldValues | null>(null)
  const [routeDraftName, setRouteDraftName] = useState('')
  const [routePendingDelete, setRoutePendingDelete] = useState<string | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [isRouteBusy, setIsRouteBusy] = useState(false)
  /**
   * 路由名 → 这条路由当前的候选模型数。缺席（键不在）代表「没有这个数」，
   * 界面要显示「读不到」而不是 0 —— 一次存储故障被渲染成「池是空的」是更大的错。
   */
  const [poolSizes, setPoolSizes] = useState<Record<string, number>>({})

  useEffect(() => {
    fetchAccounts()
    fetchRoutes()
    fetchPoolSizes()
  }, [])

  // 主进程在每次路由写入后广播 CONFIG_CHANGED（载荷带 `routes`），
  // 管理 API / 另一处入口改的配置也由此同步到本卡片。候选数是同一份配置折出来的，
  // 一起重取，不然表刷新了而池的读数还停在旧配置上。
  useEffect(() => {
    const unsubscribe = window.electronAPI?.config?.onConfigChanged?.((config) => {
      if (!config?.routes) return
      setRoutes(sortedRoutes(Object.values(config.routes)))
      fetchPoolSizes()
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    setSelectedStrategy(loadBalanceStrategy)
    setWeights(accountWeights)
    initialStrategyRef.current = loadBalanceStrategy
    initialWeightsRef.current = accountWeights
  }, [])

  const fetchAccounts = async () => {
    try {
      const allAccounts = await window.electronAPI.accounts.getAll()
      const providers = await window.electronAPI.providers.getAll()
      
      const accountsWithProvider = allAccounts.map(account => ({
        ...account,
        provider: providers.find(p => p.id === account.providerId),
      }))
      
      setAccounts(accountsWithProvider)
      
      const defaultWeights = accountsWithProvider.map(account => ({
        accountId: account.id,
        weight: 100,
      }))
      
      const mergedWeights = defaultWeights.map(dw => {
        const existing = accountWeights.find(w => w.accountId === dw.accountId)
        return existing || dw
      })
      
      setWeights(mergedWeights)
    } catch (error) {
      console.error(t('proxy.failedToGetAccounts'), error)
    }
  }

  const handleStrategyChange = (value: LoadBalanceStrategy) => {
    setSelectedStrategy(value)
    setHasChanges(true)
    onConfigChange?.()
  }

  const handleWeightChange = (accountId: string, weight: number) => {
    setWeights(prev => prev.map(w =>
      w.accountId === accountId ? { ...w, weight } : w
    ))
    setHasChanges(true)
    onConfigChange?.()
  }

  // ── 路由草稿的字段编辑 ──────────────────────────────────────────
  // 新建表单与已有路由的编辑区各持一份草稿：两者都只改草稿，落盘由下面的
  // CRUD 处理，所以两条路径共用同一个 `ModelRouteFields` 子组件。

  const handleNewRoutePatch = (patch: Partial<ModelRouteFieldValues>) => {
    setNewRouteValues((prev) => ({ ...prev, ...patch }))
  }

  const handleDraftPatch = (patch: Partial<ModelRouteFieldValues>) => {
    setRouteDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  // ── 路由 CRUD ──────────────────────────────────────────────────
  // 三条写通道成功时都带回归一后的整表，所以这里不再 list()；失败时把
  // error.message 原样显示 —— 主进程已按 code 组织好可读文本，UI 不重复翻译。

  const showRouteError = (message: string) => {
    setRouteError(message)
    toast({
      title: t('common.error'),
      description: message,
      variant: 'destructive',
    })
  }

  const fetchRoutes = async () => {
    const api = window.electronAPI?.routes
    if (!api) {
      setRouteError(t('proxy.routesUnavailable'))
      return
    }
    try {
      const result = await api.list()
      if (result.ok) {
        setRoutes(sortedRoutes(result.routes))
      } else {
        showRouteError(result.error.message)
      }
    } catch (error) {
      showRouteError(error instanceof Error ? error.message : t('proxy.routesLoadFailed'))
    }
  }

  /**
   * 一次采集折全表拿每条路由的候选模型数。不用逐条 `preview`：那把 473 行明细全带回
   * 渲染进程，而列表页只要一个数字。读不到就清空而不是沿用旧数 —— 配置已经变了，
   * 旧数在新配置下就是假的。
   */
  const fetchPoolSizes = async () => {
    const api = window.electronAPI?.routes
    if (!api?.poolSizes) {
      setPoolSizes({})
      return
    }
    try {
      const result = await api.poolSizes()
      setPoolSizes(result.ok ? result.sizes : {})
    } catch (error) {
      console.error('Failed to load route pool sizes:', error)
      setPoolSizes({})
    }
  }

  const startCreateRoute = () => {
    setIsCreatingRoute(true)
    setNewRouteName('')
    setNewRouteValues(defaultRouteFieldValues(selectedStrategy))
    setRouteError(null)
  }

  const cancelCreateRoute = () => {
    setIsCreatingRoute(false)
    setNewRouteName('')
  }

  const handleCreateRoute = async () => {
    const api = window.electronAPI?.routes
    if (!api) {
      showRouteError(t('proxy.routesUnavailable'))
      return
    }
    const name = newRouteName.trim().toLowerCase()
    if (name.length === 0) {
      showRouteError(t('proxy.routeNameRequired'))
      return
    }
    setIsRouteBusy(true)
    setRouteError(null)
    try {
      const result = await api.create({
        name,
        // 「新建即启用」也取共享默认值，UI 里不出现第二份 true 的字面量
        enabled: DEFAULT_AUTO_ROUTING.enabled,
        ...newRouteValues,
      })
      if (result.ok) {
        setRoutes(routesFromRecord(result.routes))
        void fetchPoolSizes()
        cancelCreateRoute()
        setNewRouteValues(defaultRouteFieldValues(selectedStrategy))
        toast({ title: t('common.success'), description: t('proxy.routeCreatedToast') })
      } else {
        showRouteError(result.error.message)
      }
    } finally {
      setIsRouteBusy(false)
    }
  }

  const startEditRoute = (route: ModelRoute) => {
    setEditingRouteName(route.name)
    setRouteDraft(routeFieldValuesOf(route))
    setRouteDraftName(route.name)
    setRoutePendingDelete(null)
    setRouteError(null)
  }

  const cancelEditRoute = () => {
    setEditingRouteName(null)
    setRouteDraft(null)
    setRouteDraftName('')
  }

  const handleSaveRoute = async (currentName: string) => {
    const api = window.electronAPI?.routes
    if (!api || !routeDraft) return
    const targetName = routeDraftName.trim().toLowerCase()
    if (targetName.length === 0) {
      showRouteError(t('proxy.routeNameRequired'))
      return
    }
    setIsRouteBusy(true)
    setRouteError(null)
    try {
      // 只有真的改名才带 `name`：`currentName` 始终是盘上的现名。
      const patch: Partial<ModelRoute> =
        targetName === currentName
          ? { ...routeDraft }
          : { ...routeDraft, name: targetName }
      const result = await api.update(currentName, patch)
      if (result.ok) {
        setRoutes(routesFromRecord(result.routes))
        void fetchPoolSizes()
        cancelEditRoute()
        toast({ title: t('common.success'), description: t('proxy.routeSavedToast') })
      } else {
        showRouteError(result.error.message)
      }
    } finally {
      setIsRouteBusy(false)
    }
  }

  const handleToggleRoute = async (route: ModelRoute, enabled: boolean) => {
    const api = window.electronAPI?.routes
    if (!api) {
      showRouteError(t('proxy.routesUnavailable'))
      return
    }
    setIsRouteBusy(true)
    setRouteError(null)
    try {
      const result = await api.update(route.name, { enabled })
      if (result.ok) {
        setRoutes(routesFromRecord(result.routes))
        void fetchPoolSizes()
        toast({ title: t('common.success'), description: t('proxy.routeUpdatedToast') })
      } else {
        showRouteError(result.error.message)
      }
    } finally {
      setIsRouteBusy(false)
    }
  }

  const handleDeleteRoute = async (name: string) => {
    const api = window.electronAPI?.routes
    if (!api) {
      showRouteError(t('proxy.routesUnavailable'))
      return
    }
    setIsRouteBusy(true)
    setRouteError(null)
    try {
      const result = await api.delete(name)
      if (result.ok) {
        setRoutes(routesFromRecord(result.routes))
        void fetchPoolSizes()
        setRoutePendingDelete(null)
        if (editingRouteName === name) cancelEditRoute()
        toast({ title: t('common.success'), description: t('proxy.routeDeletedToast') })
      } else {
        showRouteError(result.error.message)
      }
    } finally {
      setIsRouteBusy(false)
    }
  }

  const handleSave = async () => {
    setLoadBalanceStrategy(selectedStrategy)
    setAccountWeights(weights)
    
    // 只保存策略与权重：路由走 `routes:*` 即时落盘，legacy `autoRouting` 已不再是
    // UI 的写入项（它是主进程的一次性迁移源），回写它只会覆盖迁移结果。
    const success = await saveAppConfig({
      loadBalanceStrategy: selectedStrategy,
    })

    if (success) {
      setHasChanges(false)
      toast({
        title: t('common.success'),
        description: t('proxy.loadBalanceConfig'),
      })
    } else {
      toast({
        title: t('common.error'),
        description: t('proxy.configSaveFailed'),
        variant: 'destructive',
      })
    }
  }

  const handleReset = () => {
    setSelectedStrategy(initialStrategyRef.current)
    setWeights(initialWeightsRef.current)
    setHasChanges(false)
  }

  const activeAccounts = accounts.filter(a => a.status === 'active')

  const getStrategyLabel = (strategy: LoadBalanceStrategy): string => {
    const labels: Record<LoadBalanceStrategy, string> = {
      'round-robin': t('proxy.roundRobin'),
      'fill-first': t('proxy.fillFirst'),
      'failover': t('proxy.failover'),
      'smart': t('proxy.smart'),
      'pace': t('proxy.pace'),
    }
    return labels[strategy]
  }

  const getStrategyDescription = (strategy: LoadBalanceStrategy): string => {
    const descriptions: Record<LoadBalanceStrategy, string> = {
      'round-robin': t('proxy.roundRobinDesc'),
      'fill-first': t('proxy.fillFirstDesc'),
      'failover': t('proxy.failoverDesc'),
      'smart': t('proxy.smartDesc'),
      'pace': t('proxy.paceDesc'),
    }
    return descriptions[strategy]
  }

  // 逐路由的 `strategy` 下拉用同一份选项：选项文本只在这里生成一次，
  // 子组件不再抄第二份策略数组/标签表。
  const strategyOptions: ModelRouteStrategyOption[] = STRATEGY_VALUES.map((value) => ({
    value,
    label: getStrategyLabel(value),
  }))

  const deleteWarningKey = (name: string) =>
    name === 'auto' ? 'proxy.routeDeleteWarning_auto' : 'proxy.routeDeleteWarning_other'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-[15px] w-[15px] text-[var(--text-muted)]" />
            <CardTitle>{t('proxy.loadBalanceConfig')}</CardTitle>
          </div>
          {hasChanges && (
            <Badge variant="secondary" className="text-xs">
              {t('proxy.unsaved')}
            </Badge>
          )}
        </div>
        <CardDescription>{t('proxy.loadBalanceConfigDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="strategy">{t('proxy.loadBalanceStrategy')}</Label>
          <Select value={selectedStrategy} onValueChange={handleStrategyChange}>
            <SelectTrigger id="strategy">
              <SelectValue placeholder={t('proxy.selectStrategy')} />
            </SelectTrigger>
            <SelectContent>
              {STRATEGY_VALUES.map((strategy) => (
                <SelectItem key={strategy} value={strategy}>
                  {getStrategyLabel(strategy)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              {getStrategyDescription(selectedStrategy)}
            </p>
          </div>
        </div>

        {activeAccounts.length > 0 && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <Label>{t('proxy.accountWeightConfig')}</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchAccounts}
                className="h-8 px-2"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                {t('common.refresh')}
              </Button>
            </div>
            
            <div className="space-y-4">
              {activeAccounts.map(account => {
                const weight = weights.find(w => w.accountId === account.id)?.weight || 100
                return (
                  <div key={account.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{account.name}</span>
                        {account.provider && (
                          <Badge variant="outline" className="text-xs">
                            {account.provider.name}
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground w-12 text-right">
                        {weight}%
                      </span>
                    </div>
                    <Slider
                      value={[weight]}
                      onValueChange={([value]) => handleWeightChange(account.id, value)}
                      max={100}
                      step={5}
                      className="w-full"
                    />
                  </div>
                )
              })}
            </div>
            
            <p className="text-xs text-muted-foreground">
              {t('proxy.weightHelp')}
            </p>
          </div>
        )}

        {activeAccounts.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">{t('proxy.noActiveAccounts')}</p>
            <p className="text-xs mt-1">{t('proxy.addAndActivateAccount')}</p>
          </div>
        )}

        <div className="space-y-4 pt-4 border-t">
          <div className="flex items-center justify-between gap-2">
            <Label>{t('proxy.modelRoutes')}</Label>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void fetchRoutes()
                  void fetchPoolSizes()
                }}
                className="h-8 px-2"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                {t('common.refresh')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={startCreateRoute}
                disabled={isCreatingRoute}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('proxy.modelRoutesNew')}
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              {t('proxy.modelRoutesDesc')}
            </p>
          </div>

          {/* 主进程返回的 error.message 是可读文本，原样显示，不再按 code 自行翻译 */}
          {routeError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span className="break-words">{routeError}</span>
            </div>
          )}

          {isCreatingRoute && (
            <div className="space-y-4 rounded-lg border p-3">
              <div className="space-y-2">
                <Label htmlFor="route-name-new">{t('proxy.routeNameLabel')}</Label>
                <Input
                  id="route-name-new"
                  value={newRouteName}
                  onChange={(event) => setNewRouteName(event.target.value)}
                  placeholder={t('proxy.routeNamePlaceholder')}
                />
                <p className="text-xs text-muted-foreground">{t('proxy.routeNameHelp')}</p>
              </div>

              <ModelRouteFields
                idPrefix="new"
                values={newRouteValues}
                onChange={handleNewRoutePatch}
                strategyOptions={strategyOptions}
              />

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={cancelCreateRoute}>
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreateRoute}
                  disabled={isRouteBusy || newRouteName.trim().length === 0}
                >
                  {t('proxy.routeCreate')}
                </Button>
              </div>
            </div>
          )}

          {routes.length === 0 && !isCreatingRoute && (
            <div className="text-center py-6 text-muted-foreground">
              <p className="text-sm">{t('proxy.modelRoutesEmpty')}</p>
              <p className="text-xs mt-1">{t('proxy.modelRoutesEmptyHelp')}</p>
            </div>
          )}

          {routes.map((route) => (
            <div key={route.name} className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{route.name}</code>
                  <Badge variant={route.enabled ? 'secondary' : 'outline'} className="text-xs">
                    {route.enabled ? t('common.enabled') : t('common.disabled')}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {getStrategyLabel(route.strategy)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {t(`proxy.autoRoutingPrefer_${route.prefer}`)}
                  </Badge>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    id={`route-enabled-${route.name}`}
                    checked={route.enabled}
                    disabled={isRouteBusy}
                    onCheckedChange={(checked) => handleToggleRoute(route, checked)}
                  />
                  <Label htmlFor={`route-enabled-${route.name}`} className="text-xs text-muted-foreground">
                    {t('proxy.routeEnabledSwitch')}
                  </Label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => startEditRoute(route)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => setRoutePendingDelete(route.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {t('common.delete')}
                  </Button>
                </div>
              </div>

              {/* 候选数三种状态各占一句：读数缺席、池真的空了、池有内容，不许在界面上
                  被并成同一个「一切正常」。空池的路由仍然出现在 /v1/models 里（它是用户
                  启用着的路由），但每个请求都会 503，所以这里必须点名说清。 */}
              {poolSizes[route.name] === undefined ? (
                <p className="text-xs text-muted-foreground">{t('proxy.routePoolSizeUnknown')}</p>
              ) : poolSizes[route.name] === 0 ? (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{t('proxy.routePoolSizeEmpty', { name: route.name })}</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('proxy.routePoolSize', { count: poolSizes[route.name] })}
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                {t('proxy.routeAttemptsSummary', { attempts: route.maxAttempts })}
                {' · '}
                {t('proxy.routeStickySummary', { minutes: route.stickyMinutes })}
              </p>

              {route.poolStrategies.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {route.poolStrategies.map((item, index) => (
                    <span key={`${item.id}-${index}`} className="flex items-center gap-1.5">
                      {index > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {item.operator === 'and'
                            ? t('proxy.autoRoutingPoolOperator_and')
                            : t('proxy.autoRoutingPoolOperator_or')}
                        </span>
                      )}
                      <Badge variant="outline" className="text-xs font-normal">
                        {t(`proxy.autoRoutingPoolStrategy_${item.id}`)}
                      </Badge>
                    </span>
                  ))}
                </div>
              )}

              {route.pinModels.length > 0 && (
                // 钉定是「客户端可以点名的名字只有路由」这条口径下，路由名敢说自己是
                // `claude-opus-5` 的唯一依据：不钉，池就是全目录。
                <p className="text-xs text-muted-foreground">
                  {t('proxy.routePinSummary', { total: route.pinModels.length })}
                </p>
              )}

              {(route.includeModels.length > 0 || route.excludeModels.length > 0) && (
                <p className="text-xs text-muted-foreground">
                  {t('proxy.routePoolManualSummary', {
                    included: route.includeModels.length,
                    excluded: route.excludeModels.length,
                  })}
                </p>
              )}

              {routePendingDelete === route.name && (
                <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                    <p className="text-sm font-medium">
                      {t('proxy.routeDeleteConfirmTitle', { name: route.name })}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(deleteWarningKey(route.name), { name: route.name })}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setRoutePendingDelete(null)}>
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" onClick={() => handleDeleteRoute(route.name)} disabled={isRouteBusy}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              )}

              {editingRouteName === route.name && routeDraft && (
                <div className="space-y-4 pt-3 border-t">
                  <div className="space-y-2">
                    <Label htmlFor={`route-name-${route.name}`}>{t('proxy.routeRename')}</Label>
                    <Input
                      id={`route-name-${route.name}`}
                      value={routeDraftName}
                      onChange={(event) => setRouteDraftName(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t('proxy.routeRenameHelp')}</p>
                  </div>

                  <ModelRouteFields
                    idPrefix={route.name}
                    values={routeDraft}
                    onChange={handleDraftPatch}
                    strategyOptions={strategyOptions}
                  />

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={cancelEditRoute}>
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" onClick={() => handleSaveRoute(route.name)} disabled={isRouteBusy}>
                      {t('proxy.routeSaveChanges')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            {t('proxy.routeImmediateHelp')}
          </p>
        </div>

        <div className="flex justify-end space-x-2 pt-4">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={!hasChanges || isLoading}
          >
            {t('common.reset')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isLoading}
          >
            {isLoading ? t('proxy.saving') : t('proxy.saveConfig')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default LoadBalanceConfig
