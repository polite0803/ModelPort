import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Ban, Pin, RefreshCw, RotateCcw, Search, SkipForward, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { publishTrayRouteMenu, ROUTES_CHANGED_EVENT } from '@/api/trayRoutes'
import { cn } from '@/lib/utils'
import { ROUTE_RATING_MAX_STARS } from '@shared/types'
import type { RouteMenuEntry, RouteMenuModel } from '@shared/types'
import {
  blockReasonKey,
  describeDelay,
  type RouteQuotaWindowRow,
  type RouteQuotaWindow,
  type RouteModelBlock,
} from '@shared/routeQuotaView'

/**
 * 一条路由能取到几个模型，就要能列几个：托盘的原生菜单塞不下，这里能翻能搜。
 * 上限只在主进程夹一次（`ROUTE_MENU_MODELS_MAX`），页面不重复写一份。
 */
const FULL_LIST_LIMIT = 2000

/**
 * 「还有多久」的刷新节奏。
 *
 * 页面上所有时刻都是**绝对毫秒**（主进程给的快照），倒计时由本地这一个时钟算 ——
 * 每 15 秒重画一次标签，不重取快照、更不轮询 `routes:menu`：那个快照是一次全池扫描
 * （实测 p50 4.7s），拿它做倒计时等于把界面变成一个定时炸弹。15 秒的粒度与分钟级
 * 展示相称，也不会让「约 3 分钟」在屏幕上跳来跳去。
 */
const CLOCK_TICK_MS = 15_000

/** 相对时长的标签（`3 小时`）：只给时长，前面的「约」「还有」由调用方拼。 */
function delayLabel(
  until: number,
  now: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const { unit, n } = describeDelay(Math.max(0, until - now))
  return t(`routes.delay_${unit}`, { n })
}

/** `estimated` 是估算，「约」必须写出来；`upstream` / `local` 是确定的时刻。 */
function isApproximate(source: 'upstream' | 'local' | 'estimated' | undefined): boolean {
  return source === 'estimated'
}

/** 一个额度窗口的读数行：`每天 12/100 次`。 */
function quotaRowLabel(
  row: RouteQuotaWindowRow,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const window = t(`routes.window_${row.window as RouteQuotaWindow}`)
  return t('routes.quotaWindowRow', {
    window,
    used: row.used,
    limit: row.limit,
    unit: t(`routes.quotaUnit_${row.unit}`),
  })
}

/** 一条阻塞原因的人话 + 恢复时刻。`until` 缺席（钱不够）时不编倒计时。 */
function blockLabel(
  block: RouteModelBlock,
  now: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const reason = t(blockReasonKey(block.reason))
  if (block.until === undefined) return reason
  const when = delayLabel(block.until, now, t)
  return `${reason} · ${t(isApproximate(block.untilSource) ? 'routes.blockedUntilApprox' : 'routes.blockedUntil', { when })}`
}

/**
 * 这一行现在**不在**这条路由的派发池里。
 *
 * 与 `blocked` 正交：`blocked` 是「在池里，但此刻派不出去」（额度/限流，会自己恢复）；
 * 这里是「配置层就不在池里」—— 手动排除、被池策略筛掉、低于能力下限、或请求画像
 * 不支持。两类原因在界面上必须分开写，否则用户会对着一个配置问题白等额度。
 */
function isOutOfPool(model: RouteMenuModel): boolean {
  if (model.excluded === true) return true
  return model.status !== undefined && model.status !== 'kept' && model.status !== 'included'
}

/** 池层结论的人话（`undefined` = 在池里，不需要说）。与路由编辑器同一个 `status`。 */
function statusNote(
  model: RouteMenuModel,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | undefined {
  if (model.excluded === true || model.status === 'excluded') return t('routes.excludedLabel')
  switch (model.status) {
    case undefined:
    case 'kept':
    case 'included':
      return undefined
    case 'filtered':
      return model.filteredBy === undefined
        ? t('routes.poolStatus_filtered')
        : t('routes.poolStatus_filteredBy', { strategy: t(`routes.poolStrategy_${model.filteredBy}`) })
    case 'below-tier':
      return t('routes.poolStatus_below-tier')
    case 'not-pinned':
      return t('routes.poolStatus_not-pinned')
    case 'unavailable':
      return model.unavailableReason === undefined
        ? t('routes.poolStatus_unavailable')
        : t(`routes.poolUnavailable_${model.unavailableReason}`)
    default:
      return t('routes.poolStatus_filtered')
  }
}

/**
 * 这一行的手动例外按钮该做什么（与路由编辑器的三个按钮同语义）。
 *
 * - 在池里 → `exclude`（把它排除出去）；
 * - 被手动排除 → `restore`（恢复自动，交回池策略）；
 * - 其它不在池里的原因（被策略筛掉 / 低于下限 / 画像不支持）→ `include`（手动加回）。
 */
function manualActionOf(model: RouteMenuModel): 'exclude' | 'include' | 'restore' {
  if (model.excluded === true || model.status === 'excluded') return 'restore'
  if (model.status === undefined || model.status === 'kept' || model.status === 'included') return 'exclude'
  return 'include'
}

/**
 * 池内模型的星级推荐（1–5）。点第 N 颗设定 N 星，再点同一颗清除；悬停/聚焦
 * 预览将要落下的星级。纯标注控件：写的是路由配置的 `modelRatings`
 * （`routes:rate`），不参与选路打分 —— 主观推荐与客观排序是两件事。
 */
function StarRating({ model, value, manual, disabled, onChange }: {
  model: string
  value: number | undefined
  /** true = 显示手动评分（金色）；false = 显示系统默认推荐（灰色实心），点星即覆盖。 */
  manual: boolean
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
      title={manual ? undefined : t('routes.recommendedHint', { n: current })}
      onMouseLeave={() => setPreview(null)}
    >
      {Array.from({ length: ROUTE_RATING_MAX_STARS }, (_, index) => index + 1).map(star => {
        const isClear = manual && star === current
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            className={cn(
              'rounded-sm p-0.5 transition-colors',
              disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent',
            )}
            aria-label={isClear
              ? t('routes.rateClearAria', { model, n: star })
              : t('routes.rateAria', { model, n: star })}
            aria-pressed={star <= current}
            title={isClear
              ? t('routes.rateClearAria', { model, n: star })
              : t('routes.rateAria', { model, n: star })}
            onMouseEnter={() => setPreview(star)}
            onFocus={() => setPreview(star)}
            onBlur={() => setPreview(null)}
            onClick={() => onChange(isClear ? 0 : star)}
          >
            <Star
              className={cn(
                'h-3.5 w-3.5 transition-colors',
                star <= shown
                  ? manual
                    ? 'fill-[var(--warning)] text-[var(--warning)]'
                    : 'fill-muted-foreground/45 text-muted-foreground/45'
                  : 'text-muted-foreground/35',
              )}
            />
          </button>
        )
      })}
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
 * 池、当前服务者、钉、熔断都读同一处，不另算一份，否则菜单与真实选路会长期不一致。
 * 「固定」= 钉住（`routes:switch` 落盘成路由的 `preferredModel`，持久硬钉，与托盘
 * 同一颗，裁定 2026-11-15），「恢复自动排序」清钉（`routes:unpin`）。
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
  // 走时的钟：快照里的时刻是绝对的，倒计时在这里算。只重画标签，不重取快照。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  // 拿到新快照就把钟拨准：否则「约 3 分钟」会按上一次的读数多算或少算一个刻度。
  useEffect(() => {
    setNow(Date.now())
  }, [detail])

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
      const snapshot = await api.menu({ route, limit: FULL_LIST_LIMIT, includeDropped: true })
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

  const runSwitch = async (
    action: 'next' | 'reset' | 'pin',
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
    // 推荐队列：能派的在前、被挡的在后，两段内按星级降序。
    //
    // 为什么先分两段再比星：星级已经把「这一轮跳过」扣过分（`recommendModelStars`），
    // 但那个扣分是有限的，一个强档模型扣完仍可能压过一个快档模型。队列要说的是
    // 「现在点下去会发生什么」，所以能派与不能派之间是一条硬边界，不靠分数暗示。
    // 段内稳定排序：同星（含未评分）保持快照原序，即真实选路的先后。
    const rank = (model: RouteMenuModel): number => model.rating ?? model.recommendedStars ?? 0
    return [...filtered].sort((a, b) => {
      // 三段：能派 → 被挡 → 被排除。排除是配置事实（不是临时状态），排在最后。
      const seg = (model: RouteMenuModel): number =>
        model.excluded === true ? 2 : (model.blocked === undefined ? 0 : 1)
      const delta = seg(a) - seg(b)
      if (delta !== 0) return delta
      return rank(b) - rank(a)
    })
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

  /**
   * 排除 / 加回 / 恢复自动一个模型（写路由的两个手动名单，经 routes:exclude）。
   *
   * 与「固定」的区别必须让用户看得见：固定 = 下一轮只服务它；排除 = 把它从这条
   * 路由的池里拿掉。所以排除之后要重读菜单（池成员变了，快照里的候选集也变了），
   * 不像星级那样只改一个字段。
   */
  const runExclude = async (
    model: RouteMenuModel,
    action: 'exclude' | 'include' | 'restore',
  ): Promise<void> => {
    if (api?.excludeModel === undefined || detail === null) return
    setBusy(true)
    try {
      const result = await api.excludeModel({
        route: detail.route,
        providerId: model.providerId,
        model: model.displayName,
        action,
      })
      if (!result.ok) {
        toast({
          title: t('routes.actionFailed'),
          description: result.reason ?? t('routes.actionFailedHint'),
          variant: 'destructive',
        })
      } else {
        toast({
          title: action === 'exclude'
            ? t('routes.excludeDone', { model: model.displayName })
            : action === 'restore'
              ? t('routes.restoreDone', { model: model.displayName })
              : t('routes.includeDone', { model: model.displayName }),
        })
      }
    } catch (caught) {
      toast({
        title: t('routes.actionFailed'),
        description: caught instanceof Error ? caught.message : String(caught),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
      // 不论成败都重读：池成员/排除态是服务端事实，页面上那份快照不能自己猜。
      await refresh()
      publishTrayRouteMenu()
    }
  }

  /** 这一页里本轮派不出去的模型数（不算搜索过滤：它说的是路由的形状）。 */
  const blockedCount = useMemo(
    () => detail?.models.filter(model => model.blocked !== undefined && model.excluded !== true).length ?? 0,
    [detail],
  )

  /**
   * 最近一笔要过期的额度：所有行里 `resetAt` 最小、且还有余量的那个。
   *
   * 只取「还有余量」的：已经打满的那一笔不是「即将过期」，是「已经没了」—— 它由
   * `blocked` 那一行说，混进这里会把两件事说成一件。
   */
  const soonestExpiry = useMemo(() => {
    let best: {
      model: string
      window: RouteQuotaWindowRow['window']
      unit: RouteQuotaWindowRow['unit']
      remaining: number
      resetAt: number
      resetSource: RouteQuotaWindowRow['resetSource']
    } | undefined
    for (const model of detail?.models ?? []) {
      for (const row of model.quota?.rows ?? []) {
        if (row.resetAt === undefined || row.remaining <= 0) continue
        if (best !== undefined && row.resetAt >= best.resetAt) continue
        best = {
          model: model.displayName,
          window: row.window,
          unit: row.unit,
          remaining: row.remaining,
          resetAt: row.resetAt,
          resetSource: row.resetSource,
        }
      }
    }
    return best
  }, [detail])

  /**
   * 完全没有额度数字的模型数（`quota` 缺席或 `band === 'undocumented'`）。
   *
   * 它只说一次、放在表头：一行一行写「这家没公布额度」会把列表变成噪声，而这件
   * 事对**整页**是同一句 —— 「这些模型的余量我们不知道，别把留白读成充裕」。
   */
  const undocumentedCount = useMemo(
    () => detail?.models.filter(model =>
      model.blocked === undefined
      && (model.quota === undefined || model.quota.band === 'undocumented')).length ?? 0,
    [detail],
  )

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
                      : t('routes.pinPersistent', { model: detail.pin.displayName })}
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
                  {blockedCount > 0 && (
                    <> · {t('routes.queueBlockedCount', { n: blockedCount })}</>
                  )}
                  {detail.models.some(model => model.rating !== undefined) && (
                    <> · {t('routes.ratedCount', { n: detail.models.filter(model => model.rating !== undefined).length })}</>
                  )}
                  {sortByRating && <> · {t('routes.queueHint')}</>}
                </p>
              )}
              {/* 「不知道」要说出来。额度行缺席时留白会被读成「额度充裕」，而这里是
                  相反的意思：这家官方没公布、你也没声明，省不省着用只能靠猜。 */}
              {undocumentedCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('routes.quotaUndocumented', { n: undocumentedCount })}
                </p>
              )}
              {/* 「即将过期」：所有窗口里最近的一个复位时刻。这就是本轮要回答的第二个
                  问题 —— 哪一笔额度快没了，别等到它过期才发现。 */}
              {soonestExpiry !== undefined && (
                <p className="text-xs text-muted-foreground">
                  {t('routes.expiringSoon', {
                    model: soonestExpiry.model,
                    window: t(`routes.window_${soonestExpiry.window as RouteQuotaWindow}`),
                    remaining: soonestExpiry.remaining,
                    unit: t(`routes.quotaUnit_${soonestExpiry.unit}`),
                    when: `${isApproximate(soonestExpiry.resetSource)
                      ? t('routes.blockedUntilApprox', { when: delayLabel(soonestExpiry.resetAt, now, t) })
                      : t('routes.blockedUntil', { when: delayLabel(soonestExpiry.resetAt, now, t) })}`,
                  })}
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
                    model.current && 'bg-accent/60',
                    // 不进池的行（被手动排除 / 被池策略筛掉 / 低于下限 / 画像不支持）整体压暗：
                    // 它们仍在表里（这是就地加回的唯一入口），但必须一眼看出不参与选路。
                    isOutOfPool(model) && 'opacity-55'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{model.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{model.providerName}</span>
                    {/* 池层结论（与路由编辑器读 `preview.models[].status` 同一份）：说清
                        这一行为什么不在池里。排除是配置事实，不用警告色 —— 它与限流/额度
                        那种「等一会儿就回来」不是一回事。 */}
                    {statusNote(model, t) !== undefined && (
                      <span
                        className="mt-0.5 block truncate text-xs text-muted-foreground"
                        title={model.excluded === true ? t('routes.excludedHint') : t('routes.statusHint')}
                      >
                        {statusNote(model, t)}
                      </span>
                    )}
                    {/* 为什么这一轮派不出去 + 什么时候回来。估算带「约」（`isApproximate`），
                        钱不够这类没有时刻的原因只写原因 —— 不给一个假的倒计时。 */}
                    {model.blocked !== undefined && (
                      <span
                        className="mt-0.5 block truncate text-xs text-[var(--warning)]"
                        title={t('routes.blockedHint')}
                      >
                        {blockLabel(model.blocked, now, t)}
                      </span>
                    )}
                    {/* 账号级限流：`blocked` 只在**全部账号**都限流时出现，部分账号
                        限流时整行看起来完全正常 —— 而用户真正要判断的是「这条路由
                        还有几个号能用」。分母是该渠道的启用账号数，分子是此刻在
                        这个模型上限流的账号数；恢复时刻取最早解禁的那个。 */}
                    {model.accountLimits !== undefined && model.accountLimits.limited > 0 && (
                      <span
                        className="mt-0.5 block truncate text-xs text-[var(--warning)]"
                        title={t('routes.accountLimitsHint')}
                      >
                        {model.accountLimits.earliestResetAt === undefined
                          ? t('routes.accountLimitsNoReset', {
                              limited: model.accountLimits.limited,
                              total: model.accountLimits.total,
                            })
                          : t('routes.accountLimits', {
                              limited: model.accountLimits.limited,
                              total: model.accountLimits.total,
                              when: delayLabel(model.accountLimits.earliestResetAt, now, t),
                            })}
                      </span>
                    )}
                    {/* 额度读数：哪个窗口、还剩多少、什么时候复位、这个数哪来的。
                        「即将过期」的那一笔就排在这些行的最前面（主进程已按复位时刻排过）。 */}
                    {model.quota !== undefined && model.quota.rows.length > 0 && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {model.quota.rows.map(row => (
                          <span
                            key={`${row.window}\u0000${row.unit}\u0000${row.source}\u0000${row.limit}`}
                            title={t(`routes.quotaSource_${row.source}`)}
                          >
                            {quotaRowLabel(row, t)}
                            {row.resetAt !== undefined ? (
                              <>
                                {' · '}
                                {t(isApproximate(row.resetSource) ? 'routes.quotaResetApprox' : 'routes.quotaResetExact', {
                                  when: delayLabel(row.resetAt, now, t),
                                })}
                              </>
                            ) : (
                              // 算不出来就说算不出来：这一行**不写**倒计时，也不给一个猜的时刻。
                              // 沉默会让人以为「它不会复位」，那比「未知」更糟。
                              <>{' · '}{t('routes.quotaResetUnknown')}</>
                            )}
                          </span>
                        ))}
                        {model.quota.windows > model.quota.rows.length && (
                          <span>
                            {t('routes.quotaMoreWindows', { n: model.quota.windows - model.quota.rows.length })}
                          </span>
                        )}
                      </span>
                    )}
                                      </span>
                  <StarRating
                    model={model.displayName}
                    value={model.rating ?? model.recommendedStars}
                    manual={model.rating !== undefined}
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
                        {t('routes.pinnedBadge')}
                      </Badge>
                    )}
                    {model.blocked !== undefined && (
                      <Badge variant="destructive" title={t('routes.blockedHint')}>
                        {t('routes.blockedBadge')}
                      </Badge>
                    )}
                    {model.circuitUntil !== undefined && (
                      <Badge variant="outline">
                        {t('routes.circuit', { minutes: Math.max(1, Math.round((model.circuitUntil - now) / 60_000)) })}
                      </Badge>
                    )}
                    {model.costBucket === 'free' && <Badge variant="outline">{t('routes.free')}</Badge>}
                    <span>{t('routes.accountCount', { n: model.accountCount })}</span>
                    {model.ewmaFirstTokenMs !== undefined && (
                      <span>{t('routes.firstToken', { ms: Math.round(model.ewmaFirstTokenMs) })}</span>
                    )}
                  </span>
                  {/* 被挡下的模型也能固定（裁定 2026-11-16：手动固定是最高响应）。
                      点下去不会换别的模型，而是让这一轮明确等额度回来 —— 按钮文案要说清
                      这一点，否则用户以为点了也没用。
                      被排除的模型不能固定：排除与固定互相矛盾（一个说「不要它」，一个说
                      「只要它」），先加回再固定。 */}
                  <Button
                    size="sm"
                    variant={model.pinned ? 'secondary' : 'outline'}
                    disabled={busy || model.excluded === true
                      || (!model.pinned && (model.accountCount === 0 || !detail?.enabled))}
                    title={model.pinned
                      ? t('routes.unpinHint')
                      : model.accountCount === 0
                        ? t('routes.noAccount')
                        : model.blocked !== undefined ? t('routes.pinBlockedHint') : t('routes.pinHint')}
                    onClick={() => void runSwitch(model.pinned ? 'reset' : 'pin', model)}
                  >
                    <Pin className="mr-1.5 h-4 w-4" />
                    {model.pinned ? t('routes.pinnedBadge') : t('routes.pin')}
                  </Button>
                  {/* 手动例外：三态，与路由编辑器的「排除 / 加回 / 恢复自动」同一套写入
                      （两者是路由配置里同一份手动名单，与编辑器共用）。
                      - 在池里 → 「排除」；
                      - 被手动排除 → 「恢复自动」（交回池策略）；
                      - 被策略筛掉 / 低于下限 / 画像不支持 → 「加回」（手动 include）。 */}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || detail === null}
                    title={manualActionOf(model) === 'exclude'
                      ? t('routes.excludeHint')
                      : manualActionOf(model) === 'restore'
                        ? t('routes.restoreHint')
                        : t('routes.includeHint')}
                    onClick={() => void runExclude(model, manualActionOf(model))}
                  >
                    <Ban className="mr-1.5 h-4 w-4" />
                    {manualActionOf(model) === 'exclude'
                      ? t('routes.exclude')
                      : manualActionOf(model) === 'restore'
                        ? t('routes.restore')
                        : t('routes.include')}
                  </Button>
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