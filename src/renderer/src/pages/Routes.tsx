import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Pin, RefreshCw, RotateCcw, Search, SkipForward, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { publishTrayRouteMenu, ROUTES_CHANGED_EVENT } from '@/api/trayRoutes'
import { cn } from '@/lib/utils'
import { ROUTE_RATING_MAX_STARS } from '@shared/types'
import type { RouteMenuEntry, RouteMenuModel } from '@shared/types'

/**
 * 一条路由能取到几个模型，就要能列几个：托盘的原生菜单塞不下，这里能翻能搜。
 * 上限只在主进程夹一次（`ROUTE_MENU_MODELS_MAX`），页面不重复写一份。
 */
const FULL_LIST_LIMIT = 2000

/**
 * 池内模型的星级推荐（1–5）。点第 N 颗设定 N 星，再点同一颗清除；悬停/聚焦
 * 预览将要落下的星级。纯标注控件：写的是路由配置的 `modelRatings`
 * （`routes:rate`），不参与选路打分 —— 主观推荐与客观排序是两件事。
 */
function StarRating({ model, value, disabled, onChange }: {
  model: string
  value: number | undefined
  disabled: boolean
  onChange: (stars: number) => void
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<number | null>(null)
  const current = value ?? 0
  const shown = preview ?? current
  return (
    <span
      className="flex items-center gap-0.5"
      role="group"
      aria-label={t('routes.ratingGroup', { model })}
      onMouseLeave={() => setPreview(null)}
    >
      {Array.from({ length: ROUTE_RATING_MAX_STARS }, (_, index) => index + 1).map(star => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          className={cn(
            'rounded-sm p-0.5 transition-colors',
            disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent',
          )}
          aria-label={star === current
            ? t('routes.rateClearAria', { model, n: star })
            : t('routes.rateAria', { model, n: star })}
          aria-pressed={star <= current}
          title={star === current
            ? t('routes.rateClearAria', { model, n: star })
            : t('routes.rateAria', { model, n: star })}
          onMouseEnter={() => setPreview(star)}
          onFocus={() => setPreview(star)}
          onBlur={() => setPreview(null)}
          onClick={() => onChange(star === current ? 0 : star)}
        >
          <Star
            className={cn(
              'h-3.5 w-3.5 transition-colors',
              star <= shown
                ? 'fill-[var(--warning)] text-[var(--warning)]'
                : 'text-muted-foreground/35',
            )}
          />
        </button>
      ))}
    </span>
  )
}

/**
 * 路由与模型。
 *
 * 托盘子菜单只列前几个模型（原生菜单再长就滚不动，也没有搜索框），溢出那行只说明
 * 「还有 N 个在控制台」—— 但控制台此前没有一处能**选**它们：路由编辑页改的是配置
 * （include/exclude），模型管理页既不按路由看，也不能切换。结果是一个真实缺口：
 * 用户在托盘里点不到、在控制台里也点不到。
 *
 * 这一页就是那个落点，数据来自托盘同一份 `routes:menu` 快照（`routeMenu`）——
 * 池、当前服务者、软钉、熔断都读同一处，不另算一份，否则菜单与真实选路会长期不一致。
 * 切换写内存软钉（`routes:switch`），「长期」把同一次选择落盘成路由的 `preferredModel`
 * （`routes:switch` + `persist`），「恢复自动排序」两者一起清（`routes:unpin`），
 * 与托盘走的是同一组通道。
 */
export function Routes() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [routes, setRoutes] = useState<RouteMenuEntry[]>([])
  const [detail, setDetail] = useState<RouteMenuEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  // 「星级优先」只改显示顺序：真实选路仍按快照原序，两者不许混为一谈。
  const [sortByRating, setSortByRating] = useState(false)

  const api = window.electronAPI?.routes
  const selectedName = searchParams.get('route')

  /** 左栏：每条路由的一行摘要（默认上限足够画这行）。读失败要说原因，不是「没有路由」。 */
  const loadList = useCallback(async (): Promise<RouteMenuEntry[]> => {
    if (!api?.menu) {
      setError(t('routes.unavailable'))
      setLoading(false)
      return []
    }
    try {
      const snapshot = await api.menu()
      if (snapshot.error !== undefined) {
        setError(snapshot.error)
        setRoutes([])
        return []
      }
      setError(null)
      setRoutes(snapshot.routes)
      return snapshot.routes
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setRoutes([])
      return []
    } finally {
      setLoading(false)
    }
  }, [api, t])

  /** 右栏：这一条路由的**全部**可切换模型。 */
  const loadDetail = useCallback(async (route: string): Promise<void> => {
    if (!api?.menu) return
    setDetailLoading(true)
    try {
      const snapshot = await api.menu({ route, limit: FULL_LIST_LIMIT })
      if (snapshot.error !== undefined) {
        setError(snapshot.error)
        setDetail(null)
        return
      }
      setError(null)
      setDetail(snapshot.routes.find(entry => entry.route === route) ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [api])

  useEffect(() => {
    void loadList()
  }, [loadList])

  // 没带 `?route=` 的进入方式（侧边栏、深链丢了参数）落到第一条启用的路由上：
  // 空白的右栏与「这条路由不存在」长得一样，用户分不出。
  useEffect(() => {
    if (loading || error !== null) return
    if (selectedName !== null && routes.some(entry => entry.route === selectedName)) return
    const fallback = routes.find(entry => entry.enabled) ?? routes[0]
    if (fallback !== undefined) setSearchParams({ route: fallback.route }, { replace: true })
  }, [loading, error, routes, selectedName, setSearchParams])

  useEffect(() => {
    if (selectedName === null) return
    void loadDetail(selectedName)
  }, [selectedName, loadDetail])

  const refresh = useCallback(async () => {
    const fresh = await loadList()
    const target = selectedName ?? fresh.find(entry => entry.enabled)?.route
    if (target !== undefined) await loadDetail(target)
  }, [loadList, loadDetail, selectedName])

  // 托盘改了模型之后清空这一页的旧读数：托盘命令是这一页执行的，但执行不等于重读。
  useEffect(() => {
    const onChange = (): void => { void refresh() }
    window.addEventListener(ROUTES_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(ROUTES_CHANGED_EVENT, onChange)
  }, [refresh])

  // 供应商/账号/模型启停、能力标注、路由结构编辑发生在别的页（或别的窗口）时，这一页
  // 若已挂载也要跟着重取 —— 否则「停了供应商，路由页还列着它的模型」。主进程在结构写
  // 落盘时推 routes:pool-changed（评分除外：纯标注不改池）。托盘快照由 App 顶层的
  // tray 桥同一事件重发，这里只管本页视图。桌面与无头宿主走同一条订阅（wire.on/off）。
  useEffect(() => {
    if (api?.onPoolChanged === undefined) return
    return api.onPoolChanged(() => { void refresh() })
  }, [api, refresh])

  // 倒计时是「到点就过期」的东西：没有心跳，页面会一直停在加载那一刻的分钟数。
  // 到期再拉一次 —— 钉子到点就该从本页和托盘上一起消失，而不是等下次手动刷新。
  const [, setTick] = useState(0)
  const pinUntil = detail?.pin !== undefined && detail.pin.until > 0 ? detail.pin.until : undefined
  useEffect(() => {
    if (pinUntil === undefined) return
    const ticker = setInterval(() => setTick(value => value + 1), 30_000)
    const expiry = setTimeout(() => {
      void refresh()
      publishTrayRouteMenu()
    }, Math.max(1_000, pinUntil - Date.now() + 1_000))
    return () => {
      clearInterval(ticker)
      clearTimeout(expiry)
    }
  }, [pinUntil, refresh])

  const runSwitch = async (
    action: 'next' | 'reset' | 'pin' | 'persist',
    model?: RouteMenuModel,
  ): Promise<void> => {
    if (api === undefined || detail === null) return
    setBusy(true)
    try {
      const result = action === 'reset'
        ? await api.unpin(detail.route)
        : await api.switchModel({
            route: detail.route,
            ...(model === undefined ? {} : { model: model.displayName, providerId: model.providerId }),
            // 软钉 30 分钟 vs 落盘：同一份「优先模型」判定，只是活多久不同。
            ...(action === 'persist' ? { persist: true } : {}),
            source: 'console',
          })
      if (!result.ok) {
        toast({
          title: t('routes.actionFailed'),
          description: result.reason ?? t('routes.actionFailedHint'),
          variant: 'destructive',
        })
      } else if (action === 'reset') {
        toast({ title: t('routes.resetDone', { route: detail.route }) })
      } else if (action === 'persist') {
        toast({ title: t('routes.persistDone', { model: result.model ?? '' }) })
      } else {
        toast({ title: t('routes.switched', { model: result.model ?? '' }) })
      }
    } catch (caught) {
      toast({
        title: t('routes.actionFailed'),
        description: caught instanceof Error ? caught.message : String(caught),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
      await refresh()
      // 托盘缓存只有这一页能更新：切完不发布，托盘就停在切之前的那份快照上。
      publishTrayRouteMenu()
    }
  }

  const visibleModels = useMemo(() => {
    if (detail === null) return []
    const needle = search.trim().toLowerCase()
    const filtered = needle.length === 0
      ? detail.models
      : detail.models.filter(model =>
        model.displayName.toLowerCase().includes(needle)
        || model.providerName.toLowerCase().includes(needle)
        || model.providerId.toLowerCase().includes(needle)
      )
    if (!sortByRating) return filtered
    // 稳定排序：同星（含未评分）保持快照原序，即真实选路的先后。
    return [...filtered].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  }, [detail, search, sortByRating])

  /**
   * 星级推荐写入：乐观更新（星星立刻亮），失败再回读真相。成功不整页重读 ——
   * 服务端已确认这一次写入，重读几百行只会让列表闪一下；托盘不画星级，
   * 也不需要为此发布一份新快照。
   */
  const runRate = async (model: RouteMenuModel, stars: number): Promise<void> => {
    if (api?.rate === undefined || detail === null) return
    setDetail(current => current === null ? current : {
      ...current,
      models: current.models.map(entry =>
        entry.providerId === model.providerId && entry.displayName === model.displayName
          ? { ...entry, rating: stars === 0 ? undefined : stars }
          : entry
      ),
    })
    setBusy(true)
    try {
      const result = await api.rate({
        route: detail.route,
        providerId: model.providerId,
        model: model.displayName,
        stars,
      })
      if (!result.ok) {
        toast({
          title: t('routes.actionFailed'),
          description: result.reason ?? t('routes.actionFailedHint'),
          variant: 'destructive',
        })
        await refresh()
      } else {
        toast({
          title: stars === 0
            ? t('routes.rateCleared', { model: model.displayName })
            : t('routes.rateDone', { model: model.displayName, n: stars }),
        })
      }
    } catch (caught) {
      toast({
        title: t('routes.actionFailed'),
        description: caught instanceof Error ? caught.message : String(caught),
        variant: 'destructive',
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  // `until: 0` 是持久偏好（`preferredModel`），其余是 30 分钟的软钉：两者在列表里
  // 必须长得不一样，否则用户点「长期」之后看到的仍是倒计时，会以为没生效。
  const persistentPin = detail?.pin !== undefined && detail.pin.until === 0
    ? detail.pin.displayName
    : undefined

  // 「上轮服务」是已经发生的事实，「已固定」是下一轮的选择。两者不同时把下一轮
  // 明写出来 —— 否则固定之后列表上仍挂着上一个模型，读起来像「固定了但没生效」。
  // 失效的钉子不参与：那一轮会明确失败（pinStale），写成「下一轮」就是骗人。
  const nextModel = detail?.pin !== undefined
    && !detail.pin.stale
    && detail.pin.displayName !== detail.current?.displayName
    ? detail.pin.displayName
    : undefined

  const header = (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">{t('routes.title')}</h2>
      <p className="text-muted-foreground">{t('routes.description')}</p>
    </div>
  )

  if (loading) {
    return <div className="space-y-6">{header}<p className="text-muted-foreground">{t('routes.loading')}</p></div>
  }

  return (
    <div className="space-y-6">
      {header}
      {error !== null && (
        <div className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3 text-sm">
          {t('routes.loadFailed', { error })}
        </div>
      )}
      {routes.length === 0 && error === null && (
        <p className="text-muted-foreground">{t('routes.noRoutes')}</p>
      )}
      {routes.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('routes.routeList')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-2 pt-0">
              {routes.map(entry => (
                <button
                  key={entry.route}
                  type="button"
                  onClick={() => setSearchParams({ route: entry.route })}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                    entry.route === selectedName
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{entry.route}</span>
                    {!entry.enabled && <Badge variant="outline">{t('routes.disabled')}</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs">
                    {entry.pin !== undefined
                      ? entry.pin.stale
                        ? t('routes.listPinnedStale', { model: entry.pin.displayName })
                        : t('routes.listPinned', { model: entry.pin.displayName })
                      : entry.current !== undefined
                        ? entry.current.displayName
                        : t('routes.listNeverServed')}
                  </span>
                  <span className="mt-0.5 block text-xs">
                    {t('routes.listModelCount', { n: entry.totalModels })}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {detail === null ? (selectedName ?? '') : detail.route}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || detail === null || !detail.enabled}
                    onClick={() => void runSwitch('next')}
                  >
                    <SkipForward className="mr-1.5 h-4 w-4" />
                    {t('routes.next')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || detail === null || (detail.pin === undefined && detail.current === undefined)}
                    onClick={() => void runSwitch('reset')}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    {t('routes.reset')}
                  </Button>
                  <Button
                    size="sm"
                    variant={sortByRating ? 'secondary' : 'ghost'}
                    disabled={detail === null}
                    title={t('routes.sortHint')}
                    onClick={() => setSortByRating(value => !value)}
                  >
                    <Star className={cn('mr-1.5 h-4 w-4', sortByRating && 'fill-[var(--warning)] text-[var(--warning)]')} />
                    {sortByRating ? t('routes.sortByRating') : t('routes.sortByRouting')}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
                    <RefreshCw className={cn('h-4 w-4', (busy || detailLoading) && 'animate-spin')} />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>
                  {detail?.current === undefined
                    ? t('routes.currentNone')
                    : detail.current.firstTokenMs === undefined
                      ? t('routes.current', { model: detail.current.displayName })
                      : t('routes.currentWithLatency', {
                          model: detail.current.displayName,
                          ms: Math.round(detail.current.firstTokenMs),
                        })}
                </span>
                {detail?.pin !== undefined && (
                  <Badge variant="secondary" className="gap-1">
                    <Pin className="h-3 w-3" />
                    {detail.pin.stale
                      ? t('routes.pinStale', { model: detail.pin.displayName })
                      : detail.pin.until === 0
                      ? t('routes.pinPersistent', { model: detail.pin.displayName })
                      : t('routes.pinUntil', {
                          model: detail.pin.displayName,
                          minutes: Math.max(1, Math.round((detail.pin.until - Date.now()) / 60_000)),
                        })}
                  </Badge>
                )}
                {detail !== null && !detail.enabled && (
                  <Badge variant="outline">{t('routes.disabled')}</Badge>
                )}
              </div>
              {nextModel !== undefined && (
                <p className="text-xs text-muted-foreground">{t('routes.nextTurn', { model: nextModel })}</p>
              )}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder={t('routes.searchPlaceholder')}
                  aria-label={t('routes.searchPlaceholder')}
                  className="pl-9"
                />
              </div>
              {detail !== null && (
                <p className="text-xs text-muted-foreground">
                  {t('routes.showing', { shown: visibleModels.length, total: detail.totalModels })}
                  {detail.models.some(model => model.rating !== undefined) && (
                    <> · {t('routes.ratedCount', { n: detail.models.filter(model => model.rating !== undefined).length })}</>
                  )}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {detailLoading && detail === null && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('routes.loading')}</p>
              )}
              {detail !== null && detail.models.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('routes.noModels')}</p>
              )}
              {detail !== null && detail.models.length > 0 && visibleModels.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('routes.noMatch')}</p>
              )}
              {visibleModels.map(model => (
                <div
                  key={`${model.providerId}\u0000${model.displayName}`}
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2',
                    model.current && 'bg-accent/60'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{model.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{model.providerName}</span>
                  </span>
                  <StarRating
                    model={model.displayName}
                    value={model.rating}
                    disabled={busy}
                    onChange={stars => void runRate(model, stars)}
                  />
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {model.current && (
                      <Badge variant="secondary" title={t('routes.currentBadgeHint')}>
                        {t('routes.currentBadge')}
                      </Badge>
                    )}
                    {model.pinned && (
                      <Badge variant="secondary">
                        {model.displayName === persistentPin
                          ? t('routes.persistentBadge')
                          : t('routes.pinnedBadge')}
                      </Badge>
                    )}
                    {model.circuitUntil !== undefined && (
                      <Badge variant="outline">
                        {t('routes.circuit', { minutes: Math.max(1, Math.round((model.circuitUntil - Date.now()) / 60_000)) })}
                      </Badge>
                    )}
                    {model.costBucket === 'free' && <Badge variant="outline">{t('routes.free')}</Badge>}
                    <span>{t('routes.accountCount', { n: model.accountCount })}</span>
                    {model.ewmaFirstTokenMs !== undefined && (
                      <span>{t('routes.firstToken', { ms: Math.round(model.ewmaFirstTokenMs) })}</span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant={model.pinned ? 'secondary' : 'outline'}
                    disabled={busy || model.accountCount === 0 || !detail?.enabled}
                    title={model.accountCount === 0 ? t('routes.noAccount') : t('routes.pinHint')}
                    onClick={() => void runSwitch('pin', model)}
                  >
                    <Pin className="mr-1.5 h-4 w-4" />
                    {model.pinned ? t('routes.pinnedBadge') : t('routes.pin')}
                  </Button>
                  {model.displayName !== persistentPin && (
                    // 落盘那一档：重启后还在，直到「恢复自动排序」。写的是路由配置
                    // 里的 `preferredModel`，与软钉共用同一条「优先模型」判定。
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || model.accountCount === 0 || !detail?.enabled}
                      title={model.accountCount === 0 ? t('routes.noAccount') : t('routes.persistHint')}
                      onClick={() => void runSwitch('persist', model)}
                    >
                      {t('routes.persist')}
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default Routes