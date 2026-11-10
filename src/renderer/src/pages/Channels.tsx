import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Tags,
  Ticket,
  Trash2,
  Undo2,
  UserMinus,
} from 'lucide-react'
import type {
  ChannelAccountView,
  ChannelAutoCheckin,
  ChannelCredits,
  ChannelIdentityEntry,
  ChannelModelInfo,
  ChannelModelSource,
  ChannelView,
} from '../../../shared/channels'
import { channelAddFlowOf, channelModelDisplayName } from '../../../shared/channels'
import type { CatalogAdoption } from '../../../shared/modelCatalog'
import type { ModelMetadata } from '../../../shared/modelMetadata'
import { CatalogScopeBatchButton } from '@/components/models/CatalogScopeBatchButton'
import { ModelAnnotationDialog } from '@/components/models/ModelAnnotationDialog'
import { ModelAnnotationSummary } from '@/components/models/ModelAnnotationSummary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'

/**
 * 渠道包 `onboarding.status` 的一条任务（`RpcOnboardingTaskItem` 的渲染层镜像）。
 *
 * ⚠️ 这里**重新声明**而不是 import：渠道包在 `vendor/` 且经 `virtual:channel-pack`
 * 构建期注入，渲染层的 tsc 程序看不见那份源码（见
 * `docs/plan/PLAN-workbuddy-growth-tasks.md` §6.2）。字段名与可选性必须与渠道包一致，
 * 一致性由 `tests/renderer/channel-claim-action.test.mjs` 的源码断言把住。
 */
interface RpcTaskItem {
  key: string
  title: string
  description: string
  /** 服务端状态**原值**：not_accepted / accepted / in_progress / completed / claimed。 */
  status: string
  claimable: boolean
  /** 未接单时服务端下发 `null` ⇒ 这里没有这个键，不补 0/0。 */
  progress?: { current: number; target: number }
  rewardCredit: number
  /** 第二量纲（能量），**不与 rewardCredit 相加**。 */
  rewardEnergy: number
  rewardBuddy: boolean
  locked: boolean
}

/** 一行清单 = 一条任务 + 它属于哪个账号。 */
type TaskRow = RpcTaskItem & { account: string }

/**
 * 「自动领取已完成的成长任务」状态（渠道包 `RpcUsageAutoGrowthState` 的渲染层镜像）。
 *
 * ⚠️ 与自动签到**分开**：签到是每号每天一次的固定请求，成长任务的领取是服务端已认定
 * 完成后的写请求。共用一个开关会让用户以为打开的是同一件事。
 */
interface RpcAutoGrowthState {
  enabled: boolean
  lastDate: string
  ranToday: boolean
  running: boolean
  lastResult: string
  lastAt: number
  pending: number
  pendingProviders: string[]
  nextRetryAt: number
  dismissed: boolean
}

/**
 * 清单排序权重：可领 → 进行中 → 已接单 → 未接单 → 已领 → 其它。
 *
 * ⚠️ 未知状态一律排在最后而不是当成「未接单」：服务端加一档新状态时，
 * 把它错归到已有那一档会让界面说谎。
 */
const TASK_ORDER: Record<string, number> = {
  completed: 0,
  in_progress: 1,
  accepted: 2,
  not_accepted: 3,
  claimed: 4,
}

function taskOrder(row: TaskRow): number {
  if (row.claimable) return 0
  return TASK_ORDER[row.status] ?? 9
}

/**
 * 从要求原文里取出「要搜的那个词」：首个 `「…」` 或 `《…》`。
 *
 * 服务端的要求文案形如「在专家页搜索并召唤「抖音策略师」，完成一次对话」/「读完《…介绍》」，
 * 引号里的就是用户要输入/搜索的名字。拿不到引号就返回 null —— **不猜**
 *（猜错等于把用户引到一个不存在的专家页）。
 */
function taskSearchTerm(row: TaskRow): string | null {
  const match = row.description.match(/[「《]([^」》]{2,40})[」》]/)
  return match === null ? null : match[1].trim()
}

interface LoginState {
  channel: ChannelView
  accountId?: string
  /**
   * 渠道包返回的登录页地址。
   *
   * 为什么由界面打开而不是主进程：headless daemon 的 `openExternal` 只能把
   * URL 打到日志，没有浏览器可开；浏览器版 `/ui/` 必须用 `window.open`。
   */
  loginUrl?: string
  phase: 'starting' | 'waiting' | 'failed'
  error?: string
}

/**
 * 表单型登录（`api-key`）的对话框状态。
 *
 * 与 {@link LoginState} 分开：那一套是「跳浏览器 + 轮询登录结果」的状态机，
 * 这里没有跳转也没有轮询，提交即落库。
 */
interface CredentialAddState {
  channel: ChannelView
  apiKey: string
  nickname: string
  busy: boolean
  error?: string
}

/**
 * TRAE 账号的设备号编辑对话框。
 *
 * 上游只认官方客户端登记过的 16 位号，自己生成的号 claim 恒回 9074
 * （见渠道包 `trae-device.ts`）。这里列出客户端 `storage.json` 里能读到的
 * 候选号，也允许手工粘贴 —— 网关与客户端不同机时候选为空，手工是唯一路径。
 */
interface TraeDeviceState {
  accountId: string
  nickname: string
  /** 输入框当前值；初始为该账号凭据里的 device_id。 */
  deviceId: string
  devices: Array<{ deviceId: string; source: string }>
  searched: string[]
  loading: boolean
  saving: boolean
  error?: string
}

// 2.5s 轮询叠加上面那次「一次刷新十几个 RPC」，会把远程 UI 自己打到 429。
// 登录轮询 5s 仍远快于人工感知；自动签到的状态变化也不需要 2.5s 的精度。
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 5 * 60 * 1000
// `channels:changed` 在请求消耗时也会触发，逐个事件刷新等于按流量频率打 RPC。
const CHANGED_DEBOUNCE_MS = 1500
// 积分查询是每渠道一个 RPC，变化远慢于请求事件；10s 的尾随节流足够。
const CREDITS_MIN_INTERVAL_MS = 10_000
// 自动签到还有渠道待重试时，下一次重试在 30 分钟后；30s 的慢轮询足够看见结果。
const PENDING_POLL_INTERVAL_MS = 30_000

/** 身份核对时间的本地短格式（`MM-DD HH:mm`）：徽标 tooltip 空间有限，日期不带年份。 */
function formatIdentityTime(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 非上游目录的短徽标文案键；`upstream`/未接入都返回 null（不渲染）。 */
function modelSourceBadgeKey(source: ChannelModelSource | undefined): string | null {
  if (source === 'official-cache') return 'channels.models.source.badgeCache'
  if (source === 'static-fallback') return 'channels.models.source.badgeFallback'
  return null
}

/** 非上游目录的说明文案键（模型列表面板顶部、刷新提示共用）。 */
function modelSourceNoticeKey(source: ChannelModelSource | undefined): string | null {
  if (source === 'official-cache') return 'channels.models.source.noticeCache'
  if (source === 'static-fallback') return 'channels.models.source.noticeFallback'
  return null
}

export function Channels() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [channels, setChannels] = useState<ChannelView[]>([])
  const [credits, setCredits] = useState<Record<string, ChannelCredits | 'loading'>>({})
  const [models, setModels] = useState<Record<string, ChannelModelInfo[] | 'loading'>>({})
  // 目录来源（上游现取 / 官方客户端缓存 / 静态兜底）。非上游时必须在界面上
  // 说清「这份清单不是现取的」，否则用户会把降级目录当成上游当前报价。
  const [modelSources, setModelSources] = useState<Record<string, ChannelModelSource>>({})
  // 各渠道「下一笔请求实际会发」的客户端身份（B4）：版本、来源、核对时间。
  // 读不到（worker 未起 / RPC 失败）就是空表，徽标退回纯声明文案，不报错打扰。
  const [identity, setIdentity] = useState<Record<string, ChannelIdentityEntry>>({})
  const [openModels, setOpenModels] = useState<Record<string, boolean>>({})
  /**
   * 成长任务清单（按渠道）。`'loading'` 与 `'error'` 是**独立状态**而不是空数组：
   * 「还在问」「问不出结果」「问出来了、确实没有任务」是三件事，
   * 都渲染成空列表就是本仓库反复出过的「缺席伪装成正常结果」。
   */
  const [tasks, setTasks] = useState<Record<string, TaskRow[] | 'loading' | 'error'>>({})
  const [openTasks, setOpenTasks] = useState<Record<string, boolean>>({})
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [autoCheckin, setAutoCheckin] = useState<ChannelAutoCheckin | null>(null)
  const [autoCheckinBusy, setAutoCheckinBusy] = useState(false)
  const [autoGrowth, setAutoGrowth] = useState<RpcAutoGrowthState | null>(null)
  const [autoGrowthBusy, setAutoGrowthBusy] = useState(false)
  const [login, setLogin] = useState<LoginState | null>(null)
  const [credentialAdd, setCredentialAdd] = useState<CredentialAddState | null>(null)
  const [traeDevice, setTraeDevice] = useState<TraeDeviceState | null>(null)
  /**
   * 标注对话框的目标行。存 `(channel, model)` 而不是算好的 displayName：
   * 展示名由 `channelModelDisplayName` 现算，和主进程写目录用的是同一个函数，
   * 抄一份字符串只会和目录漂移（漂移后每次标注都拿归属错误）。
   */
  const [annotateTarget, setAnnotateTarget] = useState<{
    channel: ChannelView
    model: ChannelModelInfo
  } | null>(null)
  /**
   * 标准库采用台账：批量补全写的是 catalogAdoptions，不是供应商记录本身。
   * 模型行要能显示「已采用 N 项」，否则一次几十毫秒跑完的批量只剩一条一闪而过的提示。
   */
  const [adoptions, setAdoptions] = useState<CatalogAdoption[]>([])
  const refreshAdoptions = useCallback(async () => {
    const api = window.electronAPI?.providers
    if (!api?.getCatalogAdoptions) return
    try {
      setAdoptions(await api.getCatalogAdoptions())
    } catch {
      // 台账读不到只影响徽标，不阻断渠道页其它操作。
    }
  }, [])
  useEffect(() => {
    void refreshAdoptions()
  }, [refreshAdoptions])
  const adoptedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of adoptions) {
      const key = `${item.providerId}\u0000${item.displayName}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [adoptions])
  const adoptedCountOf = useCallback(
    (channel: ChannelView, model: ChannelModelInfo): number =>
      adoptedCounts.get(
        `${channel.id}\u0000${channelModelDisplayName(channel.name, channel.id, model)}`,
      ) ?? 0,
    [adoptedCounts],
  )
  /**
   * 每家的解析结果（含批量补全刚采用的值）。按渠道收口一次读回全部行：
   * 行上要显示「补成了什么」，逐模型 `getModelMetadataOne` 会为每个模型各解密一次 store。
   */
  const [metadataByChannel, setMetadataByChannel] = useState<
    Record<string, Record<string, ModelMetadata>>
  >({})
  const loadMetadata = useCallback(async (providerId: string) => {
    const api = window.electronAPI?.providers
    if (!api?.getModelMetadata) return
    try {
      const result = await api.getModelMetadata(providerId)
      if (!('totals' in result)) return
      const byModel: Record<string, ModelMetadata> = {}
      for (const row of result.records ?? []) byModel[row.displayName] = row
      setMetadataByChannel(current => ({ ...current, [providerId]: byModel }))
    } catch {
      // 元数据只影响行上的摘要，不阻断渠道页其它操作。
    }
  }, [])
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCheckinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoGrowthTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const creditsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const creditsPendingViews = useRef<ChannelView[] | null>(null)
  const creditsLastRunAt = useRef(0)
  const loginRef = useRef<LoginState | null>(null)
  loginRef.current = login
  /** headless `/ui/` 里点击时预占的标签页；桌面/外壳为 null。 */
  const loginPopup = useRef<Window | null>(null)

  const runCredits = useCallback(async (views: ChannelView[]) => {
    const connected = views.filter(view => view.accounts.total > 0)
    if (connected.length === 0) return
    // stale-while-revalidate：已有旧值时**不**置 loading —— worker 的 `changed`
    // 事件（请求消耗、启停账号等）都会触发全量刷新，若每次都闪 loading，
    // 用户看到的就是「所有渠道的积分都在刷」而不是目标渠道的加减（2026-10-30）。
    setCredits(current => {
      let next = current
      for (const view of connected) {
        if (next[view.id] === undefined) next = { ...next, [view.id]: 'loading' }
      }
      return next
    })
    try {
      // 一次问完所有已连接渠道：管理面只花 1 笔请求（原来是逐渠道 13 笔，
      // 每 1.5s 的去抖刷新就能把 240/分钟的程序预算打满）。
      const values = await window.electronAPI.channels.creditsAll(connected.map(view => view.id))
      setCredits(current => ({ ...current, ...values }))
    } catch (error) {
      // 保留旧读数：一次查询失败不该把已有的积分清空，也不该让整轮刷新 reject。
      console.warn('[Channels] 批量读取渠道积分失败：', error)
    }
  }, [])

  /**
   * 尾随节流：变化事件密集时只保留最后一次视图，10s 内最多查一轮积分。
   * 不用简单丢弃（leading-only），否则请求持续消耗时积分会停在旧值。
   */
  const loadCredits = useCallback((views: ChannelView[]) => {
    creditsPendingViews.current = views
    const elapsed = Date.now() - creditsLastRunAt.current
    if (elapsed >= CREDITS_MIN_INTERVAL_MS) {
      creditsLastRunAt.current = Date.now()
      creditsPendingViews.current = null
      void runCredits(views)
      return
    }
    if (creditsTimer.current !== null) return
    creditsTimer.current = setTimeout(() => {
      creditsTimer.current = null
      const pending = creditsPendingViews.current
      creditsPendingViews.current = null
      if (pending === null) return
      creditsLastRunAt.current = Date.now()
      void runCredits(pending)
    }, CREDITS_MIN_INTERVAL_MS - elapsed)
  }, [runCredits])

  // 这个开关不属于某个渠道：一个开关管所有渠道，每个自然日只跑一次。
  // 跑一轮是后台任务，只有 running 时才追着看，跑完就停。
  const loadIdentity = useCallback(async () => {
    const result = await window.electronAPI.channels.rpc('identity.snapshot', {})
    if (!result.ok) {
      setIdentity({})
      return
    }
    const value = result.value as { entries?: ChannelIdentityEntry[] } | undefined
    const entries = Array.isArray(value?.entries) ? value.entries : []
    setIdentity(Object.fromEntries(entries.map(entry => [entry.channel, entry])))
  }, [])

  const loadAutoCheckin = useCallback(async () => {
    if (autoCheckinTimer.current !== null) {
      clearTimeout(autoCheckinTimer.current)
      autoCheckinTimer.current = null
    }
    const result = await window.electronAPI.channels.autoCheckin()
    if (!result.success || result.state === undefined) {
      setAutoCheckin(null)
      return
    }
    setAutoCheckin(result.state)
    // 运行中跟得紧一点（5s）；只是有待重试渠道时用更慢的节奏，避免空转。
    if (result.state.running) {
      autoCheckinTimer.current = setTimeout(() => { void loadAutoCheckin() }, POLL_INTERVAL_MS)
    } else if (result.state.enabled && result.state.pending > 0) {
      autoCheckinTimer.current = setTimeout(() => { void loadAutoCheckin() }, PENDING_POLL_INTERVAL_MS)
    }
  }, [])

  /**
   * 自动领取（成长任务）状态。
   *
   * ⚠️ 走通用 `channels.rpc` 透传而不是新开 IPC 通道：宿主早就有一条直通渠道包的
   * 方法通道，给同一件事再开一个入口只会多一处漂移点（PLAN-workbuddy-growth-tasks §6.1）。
   */
  const loadAutoGrowth = useCallback(async () => {
    if (autoGrowthTimer.current !== null) {
      clearTimeout(autoGrowthTimer.current)
      autoGrowthTimer.current = null
    }
    const result = await window.electronAPI.channels.rpc('usage.autoGrowth', {})
    if (!result.ok) {
      setAutoGrowth(null)
      return
    }
    const state = (result.value as { autoGrowth?: RpcAutoGrowthState } | undefined)?.autoGrowth
    if (state === undefined) {
      setAutoGrowth(null)
      return
    }
    setAutoGrowth(state)
    if (state.running) {
      autoGrowthTimer.current = setTimeout(() => { void loadAutoGrowth() }, POLL_INTERVAL_MS)
    } else if (state.enabled && state.pending > 0) {
      autoGrowthTimer.current = setTimeout(() => { void loadAutoGrowth() }, PENDING_POLL_INTERVAL_MS)
    }
  }, [])

  const refresh = useCallback(async () => {
    const result = await window.electronAPI.channels.list()
    setChannels(result.channels)
    setUnavailable(result.success ? null : (result.reason ?? 'channels_unavailable'))
    setLoading(false)
    void loadCredits(result.channels)
    void loadAutoCheckin()
    void loadAutoGrowth()
    void loadIdentity()
  }, [loadAutoCheckin, loadAutoGrowth, loadCredits, loadIdentity])

  /**
   * `changed` 是逐请求触发的（积分/用量变化），直接 refresh 等于把流量频率
   * 复制到管理面上。1.5s 去抖把一次突发折叠成一轮，用户看到的仍是最终状态。
   */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void refresh()
    }, CHANGED_DEBOUNCE_MS)
  }, [refresh])

  useEffect(() => {
    void refresh()
    const unsubscribe = window.electronAPI.channels.onChanged(scheduleRefresh)
    return unsubscribe
  }, [refresh, scheduleRefresh])

  useEffect(() => () => {
    if (pollTimer.current !== null) clearTimeout(pollTimer.current)
    if (autoCheckinTimer.current !== null) clearTimeout(autoCheckinTimer.current)
    if (autoGrowthTimer.current !== null) clearTimeout(autoGrowthTimer.current)
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
    if (creditsTimer.current !== null) clearTimeout(creditsTimer.current)
  }, [])

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const pollLogin = useCallback((accountId: string, startedAt: number) => {
    stopPolling()
    pollTimer.current = setTimeout(async () => {
      const result = await window.electronAPI.channels.rpc('login.poll', { accountId })
      const value = result.ok
        ? result.value as { done?: boolean; success?: boolean; error?: string } | undefined
        : undefined
      if (!result.ok) {
        setLogin(current => current === null ? null : { ...current, phase: 'failed', error: result.error?.message })
        return
      }
      if (value?.done === true) {
        if (value.success === true) {
          loginPopup.current?.close()
          loginPopup.current = null
          setLogin(null)
          toast({ title: t('channels.login.success') })
          void refresh()
          return
        }
        setLogin(current => current === null ? null : {
          ...current,
          phase: 'failed',
          error: value.error ?? t('channels.login.failed'),
        })
        return
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setLogin(current => current === null ? null : { ...current, phase: 'failed', error: t('channels.login.timeout') })
        return
      }
      pollLogin(accountId, startedAt)
    }, POLL_INTERVAL_MS)
  }, [refresh, stopPolling, t])

  const startLogin = async (channel: ChannelView) => {
    stopPolling()
    setLogin({ channel, phase: 'starting' })
    // 浏览器版 `/ui/`：在用户点击的手势内先占一个标签页，等 `account.create`
    // 返回后再导航。RPC 往返（甚至 429 等待）会让手势窗口过期，直接
    // `window.open(loginUrl)` 很容易被弹窗拦截。
    const browserUi = window.electronAPI?.app?.platform === 'browser'
    loginPopup.current = browserUi ? window.open('', '_blank') : null
    const result = await window.electronAPI.channels.rpc('account.create', { provider: channel.id })
    if (!result.ok) {
      loginPopup.current?.close()
      loginPopup.current = null
      setLogin({ channel, phase: 'failed', error: result.error?.message ?? t('channels.login.failed') })
      return
    }
    const value = result.value as { accountId?: string; loginUrl?: string } | undefined
    if (typeof value?.accountId !== 'string') {
      loginPopup.current?.close()
      loginPopup.current = null
      setLogin({ channel, phase: 'failed', error: t('channels.login.failed') })
      return
    }
    const loginUrl = typeof value.loginUrl === 'string' && /^https?:\/\//i.test(value.loginUrl)
      ? value.loginUrl
      : undefined
    if (loginUrl === undefined) {
      loginPopup.current?.close()
      loginPopup.current = null
    } else if (browserUi) {
      // 预占的标签页可能被拦截（null）；退回到直接开新标签，仍失败则靠
      // 对话框里的手动链接。
      if (loginPopup.current !== null) {
        try { loginPopup.current.opener = null } catch { /* 跨源后不可写 */ }
        loginPopup.current.location.href = loginUrl
      } else {
        window.open(loginUrl, '_blank', 'noopener,noreferrer')
      }
    } else {
      // 桌面/Windows 外壳：交给主进程用系统浏览器打开。
      void window.electronAPI?.app?.openExternal?.(loginUrl)
    }
    setLogin({ channel, accountId: value.accountId, loginUrl, phase: 'waiting' })
    pollLogin(value.accountId, Date.now())
  }

  const cancelLogin = async () => {
    stopPolling()
    loginPopup.current?.close()
    loginPopup.current = null
    const current = loginRef.current
    setLogin(null)
    if (current?.accountId !== undefined) {
      // 取消时删掉占位账号，否则“正在等待登录”的空条目会一直留在账号池里。
      await window.electronAPI.channels.rpc('account.delete', { accountId: current.accountId })
      void refresh()
    }
  }

  const openCredentialAdd = (channel: ChannelView) => {
    setCredentialAdd({ channel, apiKey: '', nickname: '', busy: false })
  }

  /**
   * 提交表单型登录。两种形态共用一个入口，靠 mode 选渠道包方法：
   * 匿名槽不需要 key，贴 key 那条必须给出形状正确的值（形状由渠道包再校验一次）。
   */
  const submitCredentialAdd = async (mode: 'key' | 'anonymous') => {
    const current = credentialAdd
    if (current === null || current.busy) return
    const method = mode === 'key'
      ? current.channel.credentialAdd?.withKey
      : current.channel.credentialAdd?.anonymous
    if (method === undefined) {
      setCredentialAdd({ ...current, error: t('channels.credential.misconfigured') })
      return
    }
    const apiKey = current.apiKey.trim()
    if (mode === 'key' && apiKey.length === 0) {
      setCredentialAdd({ ...current, error: t('channels.credential.keyRequired') })
      return
    }
    setCredentialAdd({ ...current, busy: true, error: undefined })
    const nickname = current.nickname.trim()
    const payload = mode === 'key'
      ? { apiKey, ...(nickname.length > 0 ? { nickname } : {}) }
      : (nickname.length > 0 ? { nickname } : {})
    const result = await window.electronAPI.channels.rpc(method, payload)
    if (!result.ok) {
      setCredentialAdd(prev => prev === null ? null : {
        ...prev,
        busy: false,
        error: result.error?.message ?? t('channels.credential.failed'),
      })
      return
    }
    setCredentialAdd(null)
    toast({
      title: t(mode === 'key' ? 'channels.credential.addedKey' : 'channels.credential.addedAnonymous'),
    })
    void refresh()
  }

  const toggleAutoCheckin = async (enabled: boolean) => {
    setAutoCheckinBusy(true)
    const result = await window.electronAPI.channels.autoCheckin(enabled)
    setAutoCheckinBusy(false)
    if (!result.success || result.state === undefined) {
      toast({ title: t('common.error'), description: result.reason, variant: 'destructive' })
      return
    }
    setAutoCheckin(result.state)
    if (result.state.running) {
      // 打开开关会立刻跑一轮：接上轮询，界面上就能看到进度。
      autoCheckinTimer.current = setTimeout(() => { void loadAutoCheckin() }, POLL_INTERVAL_MS)
    }
  }

  /**
   * 自动领取（成长任务）开关。
   *
   * ⚠️ 与自动签到同理：打开后宿主会立刻尝试一轮；失败要如实弹错，
   * 不能把「设置没生效」显示成「保存成功」。
   */
  const toggleAutoGrowth = async (enabled: boolean) => {
    setAutoGrowthBusy(true)
    const result = await window.electronAPI.channels.rpc('usage.autoGrowth', { enabled })
    setAutoGrowthBusy(false)
    const state = result.ok
      ? (result.value as { autoGrowth?: RpcAutoGrowthState } | undefined)?.autoGrowth
      : undefined
    if (!result.ok || state === undefined) {
      toast({
        title: t('common.error'),
        description: result.ok ? t('channels.autoGrowth.unavailable') : (result.error?.message ?? ''),
        variant: 'destructive',
      })
      return
    }
    setAutoGrowth(state)
    if (state.running) {
      autoGrowthTimer.current = setTimeout(() => { void loadAutoGrowth() }, POLL_INTERVAL_MS)
    }
  }

  const toggleChannel = async (channel: ChannelView, enabled: boolean) => {
    setBusyId(channel.id)
    const result = await window.electronAPI.channels.setEnabled(channel.id, enabled)
    setBusyId(null)
    if (!result.success) {
      toast({ title: t('common.error'), description: result.reason, variant: 'destructive' })
      return
    }
    await refresh()
  }

  const toggleAccount = async (channel: ChannelView, accountId: string, enabled: boolean) => {
    setBusyId(channel.id)
    await window.electronAPI.channels.rpc('account.update', { accountId, patch: { enabled } })
    setBusyId(null)
    await refresh()
  }

  const deleteAccount = async (channel: ChannelView, accountId: string) => {
    setBusyId(channel.id)
    await window.electronAPI.channels.rpc('account.delete', { accountId })
    setBusyId(null)
    await refresh()
  }

  /**
   * 打开 TRAE 设备号对话框：先读候选（只读 RPC），再让用户挑选或粘贴。
   *
   * 候选可能为空（网关与官方客户端不同机）：此时保留手工输入，不把「读不到」
   * 渲染成「没有设备号」。
   */
  const openTraeDevice = async (account: ChannelAccountView) => {
    setTraeDevice({
      accountId: account.id,
      nickname: account.nickname,
      deviceId: '',
      devices: [],
      searched: [],
      loading: true,
      saving: false,
    })
    const result = await window.electronAPI.channels.rpc('credits.traeDevices', { accountId: account.id })
    const value = result.ok
      ? result.value as {
        devices?: Array<{ deviceId: string; source: string }>
        searched?: string[]
        current?: string | null
      } | undefined
      : undefined
    setTraeDevice(current => current === null || current.accountId !== account.id
      ? current
      : {
          ...current,
          loading: false,
          deviceId: value?.current ?? current.deviceId,
          devices: value?.devices ?? [],
          searched: value?.searched ?? [],
          error: result.ok ? undefined : (result.error?.message ?? t('channels.device.readFailed')),
        })
  }

  const saveTraeDevice = async () => {
    const current = traeDevice
    if (current === null) return
    const deviceId = current.deviceId.trim()
    if (!/^\d{16}$/.test(deviceId)) {
      setTraeDevice({ ...current, error: t('channels.device.invalid') })
      return
    }
    setTraeDevice({ ...current, saving: true, error: undefined })
    const result = await window.electronAPI.channels.rpc('credits.setTraeDevice', {
      accountId: current.accountId,
      deviceId,
    })
    if (!result.ok) {
      setTraeDevice(state => state === null || state.accountId !== current.accountId
        ? state
        : { ...state, saving: false, error: result.error?.message ?? t('channels.device.saveFailed') })
      return
    }
    setTraeDevice(null)
    toast({ title: t('channels.device.saved'), description: t('channels.device.savedHint', { name: current.nickname }) })
  }

  const claimCredits = async (channel: ChannelView) => {
    setBusyId(channel.id)
    const result = await window.electronAPI.channels.rpc('credits.claimAll', { provider: channel.id })
    setBusyId(null)
    if (!result.ok) {
      toast({
        title: t('common.error'),
        description: result.error?.message ?? t('channels.claimFailed'),
        variant: 'destructive',
      })
      return
    }
    const summary = (result.value as {
      summary?: { claimed?: number; alreadyClaimed?: number; failed?: number; totalCredit?: number }
    } | undefined)?.summary
    toast({
      title: t('channels.claimDone'),
      description: t('channels.claimSummary', {
        claimed: summary?.claimed ?? 0,
        already: summary?.alreadyClaimed ?? 0,
        failed: summary?.failed ?? 0,
        total: summary?.totalCredit ?? 0,
      }),
    })
    await refresh()
  }

  /**
   * 一键领取「完成任务领积分」（成长中心，与上面的签到是两套请求）。
   *
   * ⚠️ 结果句子按**段**拼，且**只拼非零段**：把 `0` 也写进句子会让「什么都没发生」
   * 和「有 5 项还没做完」读起来一样。两个量纲（积分 / 能量）**各说一句、不相加**
   * —— 渠道包与上游都是分开计量的，合成一个数就无从核对。
   */
  const claimTasks = async (channel: ChannelView) => {
    setBusyId(channel.id)
    const result = await window.electronAPI.channels.rpc('onboarding.claimAll', { provider: channel.id })
    setBusyId(null)
    if (!result.ok) {
      toast({
        title: t('common.error'),
        description: result.error?.message ?? t('channels.claimTasksError'),
        variant: 'destructive',
      })
      return
    }
    const value = result.value as {
      summary?: {
        claimedTasks?: number
        alreadyClaimedTasks?: number
        notClaimableTasks?: number
        failedTasks?: number
        errors?: number
        gained?: { credit?: number; energy?: number }
      }
      accounts?: Array<{ error?: string }>
    } | undefined
    const summary = value?.summary ?? {}
    const gained = summary.gained ?? {}
    const credit = Number(gained.credit) || 0
    const energy = Number(gained.energy) || 0
    const claimed = Number(summary.claimedTasks) || 0
    const gains = [
      credit > 0 ? t('channels.claimTasksGainsCredit', { credit }) : '',
      energy > 0 ? t('channels.claimTasksGainsEnergy', { energy }) : '',
    ].filter((part) => part.length > 0).join(t('channels.listSeparator'))
    const segments: string[] = []
    if (claimed > 0) {
      segments.push(gains.length > 0
        ? t('channels.claimTasksClaimedWithGains', { count: claimed, gains })
        : t('channels.claimTasksClaimed', { count: claimed }))
    }
    const already = Number(summary.alreadyClaimedTasks) || 0
    if (already > 0) segments.push(t('channels.claimTasksAlready', { count: already }))
    const pending = Number(summary.notClaimableTasks) || 0
    if (pending > 0) segments.push(t('channels.claimTasksNotClaimable', { count: pending }))
    const failed = Number(summary.failedTasks) || 0
    if (failed > 0) segments.push(t('channels.claimTasksFailed', { count: failed }))
    const errors = Number(summary.errors) || 0
    if (errors > 0) segments.push(t('channels.claimTasksErrors', { count: errors }))
    // 「这个账号问不出结果」的原文单独补一句：计数行只说「N 个账号失败」，
    // 用户看不出该去重新登录（同 `actionRequired` 的那条教训）。
    const firstError = (value?.accounts ?? []).find((account) => typeof account?.error === 'string')?.error
    if (firstError !== undefined && firstError.length > 0) segments.push(firstError)
    toast({
      title: t('channels.claimTasksDone'),
      description: segments.length > 0 ? segments.join(t('channels.listSeparator')) : t('channels.claimTasksNothing'),
      variant: failed > 0 || errors > 0 ? 'destructive' : 'default',
    })
    await refresh()
  }

  /**
   * 一键接单（成长任务）。**不产生积分** —— 它只让服务端开始为该任务计进度。
   *
   * ⚠️ 结果句子必须把这件事说明白：用户点完如果只看到「接了 20 项」而没有分数，
   * 第一反应是「没生效」。所以这里固定带一句「接下来正常使用就会陆续完成」。
   */
  const acceptTasks = async (channel: ChannelView) => {
    setBusyId(channel.id)
    const result = await window.electronAPI.channels.rpc('onboarding.acceptAll', { provider: channel.id })
    setBusyId(null)
    if (!result.ok) {
      toast({
        title: t('common.error'),
        description: result.error?.message ?? t('channels.tasks.acceptError'),
        variant: 'destructive',
      })
      return
    }
    const summary = (result.value as {
      summary?: { acceptedTasks?: number; untouchedTasks?: number; errors?: number }
      accounts?: Array<{ error?: string }>
    } | undefined)?.summary ?? {}
    const accepted = Number(summary.acceptedTasks) || 0
    const errors = Number(summary.errors) || 0
    const untouched = Number(summary.untouchedTasks) || 0
    const segments: string[] = []
    if (accepted > 0) segments.push(t('channels.tasks.accepted', { count: accepted }))
    if (untouched > 0) segments.push(t('channels.tasks.untouched', { count: untouched }))
    if (errors > 0) segments.push(t('channels.tasks.acceptErrors', { count: errors }))
    const firstError = (result.value as { accounts?: Array<{ error?: string }> } | undefined)?.accounts
      ?.find(account => typeof account?.error === 'string')?.error
    if (firstError) segments.push(firstError)
    toast({
      title: t('channels.tasks.acceptDone'),
      description: segments.length > 0
        ? `${segments.join(t('channels.listSeparator'))}${accepted > 0 ? ` · ${t('channels.tasks.acceptNote')}` : ''}`
        : t('channels.tasks.acceptNothing'),
      variant: errors > 0 ? 'destructive' : 'default',
    })
    // 清单展开着就刷新，让用户立刻看到状态从「未接单」变成「进行中」。
    if (openTasks[channel.id] === true) await loadTasks(channel)
  }

  const loadTasks = async (channel: ChannelView) => {
    setTasks(current => ({ ...current, [channel.id]: 'loading' }))
    const listed = await window.electronAPI.channels.rpc('account.list', { provider: channel.id })
    if (!listed.ok) {
      setTasks(current => ({ ...current, [channel.id]: 'error' }))
      setTaskErrors(current => ({ ...current, [channel.id]: listed.error?.message ?? t('channels.tasks.readFailed') }))
      return
    }
    const accounts = ((listed.value as { accounts?: Array<{ id: string; nickname?: string }> } | undefined)
      ?.accounts ?? [])
    if (accounts.length === 0) {
      setTasks(current => ({ ...current, [channel.id]: [] }))
      return
    }
    const rows: TaskRow[] = []
    const failures: string[] = []
    // ⚠️ 串行：这与渠道包 `collectGrowthClaims` 同一条口径 —— 并发敲同一账号的
    // 认证接口正是上游判「非官方客户端」时看的那个形状。
    for (const account of accounts) {
      const status = await window.electronAPI.channels.rpc('onboarding.status', {
        provider: channel.id,
        accountId: account.id,
      })
      if (!status.ok) {
        failures.push(status.error?.message ?? t('channels.tasks.readFailed'))
        continue
      }
      const value = status.value as { items?: RpcTaskItem[] } | undefined
      if (value?.items === undefined) {
        failures.push(t('channels.tasks.readFailed'))
        continue
      }
      for (const item of value.items) {
        rows.push({ ...item, account: account.nickname || account.id })
      }
    }
    if (rows.length === 0 && failures.length > 0) {
      setTasks(current => ({ ...current, [channel.id]: 'error' }))
      setTaskErrors(current => ({ ...current, [channel.id]: failures[0] }))
      return
    }
    setTaskErrors(current => ({ ...current, [channel.id]: failures[0] ?? '' }))
    setTasks(current => ({ ...current, [channel.id]: rows }))
  }

  const toggleTasks = async (channel: ChannelView) => {
    const next = openTasks[channel.id] !== true
    setOpenTasks(current => ({ ...current, [channel.id]: next }))
    // 按需拉取：折叠时不该为每个渠道都去敲一次上游清单。
    if (next && !Array.isArray(tasks[channel.id])) await loadTasks(channel)
  }

  /**
   * 复制「清单里那一项要搜的名字」到剪贴板。
   *
   * ⚠️ 用 `navigator.clipboard` 而不是新开一个 IPC 通道：桌面壳与远程 `/ui/` 都是
   * 安全上下文，剪贴板写入只需用户手势。失败时如实报错（而不是静默成功），
   * 因为这类失败通常意味着浏览器策略拒绝了写入。
   */
  const copyTaskTerm = async (term: string) => {
    try {
      await navigator.clipboard.writeText(term)
      toast({ title: t('channels.tasks.copied'), description: term })
    } catch {
      toast({
        title: t('common.error'),
        description: t('channels.tasks.copyFailed'),
        variant: 'destructive',
      })
    }
  }

  const loadModels = async (channel: ChannelView) => {
    setModels(current => ({ ...current, [channel.id]: 'loading' }))
    // 元数据与目录并行读：行上的标注摘要跟着这次目录刷新一起换新。
    void loadMetadata(channel.id)
    const result = await window.electronAPI.channels.models(channel.id)
    setModels(current => ({ ...current, [channel.id]: result.success ? result.models : [] }))
    setModelSources(current => {
      if (result.source === undefined) {
        if (!(channel.id in current)) return current
        const next = { ...current }
        delete next[channel.id]
        return next
      }
      return { ...current, [channel.id]: result.source }
    })
    if (!result.success) {
      toast({ title: t('common.error'), description: result.reason, variant: 'destructive' })
    }
  }

  const toggleModels = async (channel: ChannelView) => {
    const next = openModels[channel.id] !== true
    setOpenModels(current => ({ ...current, [channel.id]: next }))
    // 目录按需拉取：卡片折叠时不该为十个渠道各发一次请求。
    if (next && !Array.isArray(models[channel.id])) await loadModels(channel)
  }

  const refreshChannelModels = async (channel: ChannelView) => {
    setBusyId(channel.id)
    const result = await window.electronAPI.channels.refreshModels(channel.id)
    setBusyId(null)
    if (!result.success) {
      toast({
        title: t('channels.models.refreshFailed'),
        description: result.reason,
        variant: 'destructive',
      })
      await loadModels(channel)
      return
    }
    const noticeKey = modelSourceNoticeKey(result.source)
    toast({
      title: t('channels.models.refreshed'),
      description: noticeKey === null
        ? t('channels.models.refreshedCount', { count: result.count ?? 0 })
        : `${t('channels.models.refreshedCount', { count: result.count ?? 0 })} · ${t(noticeKey)}`,
    })
    await loadModels(channel)
    await refresh()
  }

  /** 单个模型的开关：结果直接带回最新目录，顺带刷新卡片上的模型计数。 */
  const setModelDisabled = async (channel: ChannelView, model: ChannelModelInfo, disabled: boolean) => {
    setBusyId(channel.id)
    const result = await window.electronAPI.channels.setModelDisabled(channel.id, model.id, disabled)
    setBusyId(null)
    if (!result.success) {
      toast({ title: t('channels.models.updateFailed'), description: result.reason, variant: 'destructive' })
      return
    }
    setModels(current => ({ ...current, [channel.id]: result.models }))
    await refresh()
  }

  const restoreDeadModel = async (channel: ChannelView, model: ChannelModelInfo) => {
    setBusyId(channel.id)
    const result = await window.electronAPI.channels.clearDeadModels(channel.id, model.id)
    setBusyId(null)
    if (!result.success) {
      toast({ title: t('channels.models.updateFailed'), description: result.reason, variant: 'destructive' })
      await loadModels(channel)
      return
    }
    setModels(current => ({ ...current, [channel.id]: result.models }))
    toast({
      title: t('channels.models.restored'),
      description: t('channels.models.restoredCount', { count: result.removed ?? 0 }),
    })
    await refresh()
  }

  /** 凭据续期：refreshable 的渠道换新 token，其余渠道相当于一次有效性探测。 */
  const refreshAccount = async (channel: ChannelView, accountId: string) => {
    setBusyId(channel.id)
    const result = await window.electronAPI.channels.rpc('account.refresh', { accountId })
    setBusyId(null)
    if (!result.ok) {
      toast({
        title: t('channels.refreshAccountFailed'),
        description: result.error?.message,
        variant: 'destructive',
      })
      return
    }
    toast({ title: t('channels.refreshedAccount') })
    await refresh()
  }

  /** 账号池按顺序分担请求，上移/下移就是提交整张有序 id 表。 */
  const moveAccount = async (channel: ChannelView, index: number, delta: number) => {
    const orderedIds = channel.accounts.list.map(account => account.id)
    const target = index + delta
    if (target < 0 || target >= orderedIds.length) return
    const [moved] = orderedIds.splice(index, 1)
    orderedIds.splice(target, 0, moved)
    setBusyId(channel.id)
    const result = await window.electronAPI.channels.rpc('account.reorder', {
      provider: channel.id,
      orderedIds,
    })
    setBusyId(null)
    if (!result.ok) {
      toast({
        title: t('channels.reorderFailed'),
        description: result.error?.message,
        variant: 'destructive',
      })
      return
    }
    await refresh()
  }

  const removeChannel = async (channel: ChannelView) => {
    if (!window.confirm(t('channels.removeConfirm', { name: channel.name }))) return
    setBusyId(channel.id)
    await window.electronAPI.channels.remove(channel.id)
    setBusyId(null)
    toast({ title: t('channels.removed', { name: channel.name }) })
    await refresh()
  }

  const connectedCount = useMemo(
    () => channels.filter(channel => channel.accounts.total > 0).length,
    [channels],
  )

  const autoCheckinStatus = useMemo(() => {
    if (autoCheckin === null) return t('channels.autoCheckin.unavailable')
    if (autoCheckin.running) return t('channels.autoCheckin.running')
    if (autoCheckin.enabled && autoCheckin.pending > 0) {
      return t('channels.autoCheckin.pending', { count: autoCheckin.pending })
    }
    if (autoCheckin.ranToday) {
      return t('channels.autoCheckin.ranToday', { date: autoCheckin.lastDate })
    }
    if (autoCheckin.lastResult !== '') {
      return t('channels.autoCheckin.last', {
        result: autoCheckin.lastResult,
        time: new Date(autoCheckin.lastAt).toLocaleString(),
      })
    }
    return t('channels.autoCheckin.never')
  }, [autoCheckin, t])

  const autoGrowthStatus = useMemo(() => {
    if (autoGrowth === null) return t('channels.autoGrowth.unavailable')
    if (autoGrowth.running) return t('channels.autoGrowth.running')
    if (autoGrowth.enabled && autoGrowth.pending > 0) {
      return t('channels.autoGrowth.pending', { count: autoGrowth.pending })
    }
    if (autoGrowth.ranToday) return t('channels.autoGrowth.ranToday', { date: autoGrowth.lastDate })
    if (autoGrowth.lastResult !== '') {
      return t('channels.autoGrowth.last', {
        result: autoGrowth.lastResult,
        time: new Date(autoGrowth.lastAt).toLocaleString(),
      })
    }
    return t('channels.autoGrowth.never')
  }, [autoGrowth, t])

  /** 有渠道声明了成长任务能力才渲染这张卡：没有它时开这个开关什么也不会发生。 */
  const hasGrowthChannel = useMemo(() => channels.some(channel => channel.growthTasks), [channels])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('channels.title')}</h2>
          <p className="text-muted-foreground">
            {t('channels.description', { connected: connectedCount, total: channels.length })}
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('common.refresh')}
        </Button>
      </div>

      {unavailable !== null && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 text-sm text-destructive">
            {unavailable}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CalendarCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {t('channels.autoCheckin.title')}
                {autoCheckin !== null && (
                  <Badge variant={autoCheckin.enabled ? 'secondary' : 'outline'}>
                    {autoCheckin.enabled
                      ? t('channels.autoCheckin.on')
                      : t('channels.autoCheckin.off')}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{t('channels.autoCheckin.description')}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {autoCheckin?.running === true && <Loader2 className="h-3 w-3 animate-spin" />}
                {autoCheckinStatus}
              </p>
              {autoCheckin !== null && autoCheckin.channels.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {autoCheckin.channels
                    .map(entry => t('channels.autoCheckin.channelLine', {
                      name: channels.find(channel => channel.id === entry.provider)?.name ?? entry.provider,
                      status: entry.text,
                    }))
                    .join(' · ')}
                </p>
              )}
            </div>
          </div>
          <Switch
            checked={autoCheckin?.enabled === true}
            disabled={autoCheckinBusy || autoCheckin === null}
            onCheckedChange={checked => void toggleAutoCheckin(checked)}
          />
        </CardContent>
      </Card>

      {hasGrowthChannel && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {t('channels.autoGrowth.title')}
                  {autoGrowth !== null && (
                    <Badge variant={autoGrowth.enabled ? 'secondary' : 'outline'}>
                      {autoGrowth.enabled ? t('channels.autoGrowth.on') : t('channels.autoGrowth.off')}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{t('channels.autoGrowth.description')}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {autoGrowth?.running === true && <Loader2 className="h-3 w-3 animate-spin" />}
                  {autoGrowthStatus}
                </p>
              </div>
            </div>
            <Switch
              checked={autoGrowth?.enabled === true}
              disabled={autoGrowthBusy || autoGrowth === null}
              onCheckedChange={checked => void toggleAutoGrowth(checked)}
            />
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t('common.loading')}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {!loading && channels.map(channel => {
          const busy = busyId === channel.id
          const connected = channel.accounts.total > 0
          const creditState = credits[channel.id]
          const remaining = creditState !== undefined && creditState !== 'loading'
            ? creditState.remaining
            : undefined
          const modelState = models[channel.id]
          const modelList = Array.isArray(modelState) ? modelState : []
          const modelsOpen = openModels[channel.id] === true
          // 本地已拉到的来源优先；否则用 `channels:list` 从同步缓存里带的来源。
          const modelSource = modelSources[channel.id] ?? channel.models.source
          const sourceBadge = modelSourceBadgeKey(modelSource)
          const sourceNotice = modelSourceNoticeKey(modelSource)
          return (
            <Card key={channel.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold uppercase">
                      {channel.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{channel.name}</span>
                        <Badge variant={connected ? 'secondary' : 'outline'}>
                          {connected ? t('channels.connected') : t('channels.notConnected')}
                        </Badge>
                        {channel.upstreamIdentity !== undefined && (() => {
                          // B4：徽标 tooltip 追加「当前生效身份」。快照读不到时
                          // 保持纯声明文案 —— 展示是诊断增强，不是强依赖。
                          const live = identity[channel.id]
                          const liveText = live === undefined ? '' : ` ${t('channels.identityLive.title')}：v${live.version}（${t(`channels.identityLive.source.${live.source}`)}，${t('channels.identityLive.checkedAt', { time: formatIdentityTime(live.checkedAt) })}）${live.detail !== undefined ? ` · ${live.detail}` : ''}`
                          return (
                            <>
                              <Badge
                                variant="outline"
                                className={
                                  channel.upstreamIdentity.risk === 'high'
                                    ? 'border-destructive text-destructive'
                                    : channel.upstreamIdentity.risk === 'medium'
                                      ? 'border-amber-500 text-amber-600'
                                      : 'text-muted-foreground'
                                }
                                title={t('channels.identityRiskTooltip', {
                                  declared: channel.upstreamIdentity.declared,
                                }) + liveText}
                              >
                                {t(`channels.identityRisk.${channel.upstreamIdentity.risk}`)}
                              </Badge>
                              {/* 双色版本状态徽标：与「风险档」（本质冒用身份，不随修复变化）
                                  区分开 —— 这里显示的是「发出去的版本号是否跟得上官方」。
                                  绿 = official / local-install / env（受控来源，自动跟随升级）；
                                  黄 = fallback（内置常量，可能落后于官方现役版）。快照读不到
                                  （worker 崩 / 渠道不在快照）时不渲染，避免误导。 */}
                              {live !== undefined && (() => {
                                const stale = live.source === 'fallback'
                                return (
                                  <Badge
                                    variant="outline"
                                    className={stale ? 'border-amber-500 text-amber-600' : 'border-emerald-600 text-emerald-600'}
                                    title={t('channels.identityLive.badgeTooltip', {
                                      version: live.version,
                                      source: t(`channels.identityLive.source.${live.source}`),
                                      time: formatIdentityTime(live.checkedAt),
                                      state: t(stale ? 'channels.identityLive.badgeState.stale' : 'channels.identityLive.badgeState.fresh'),
                                    })}
                                  >
                                    <span
                                      aria-hidden
                                      className={`mr-1 inline-block size-2 rounded-full ${stale ? 'bg-amber-500' : 'bg-emerald-600'}`}
                                    />
                                    v{live.version} · {t(stale ? 'channels.identityLive.badge.stale' : 'channels.identityLive.badge.fresh')}
                                  </Badge>
                                )
                              })()}
                            </>
                          )
                        })()}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {channel.vendor} · {t(`channels.loginKind.${channel.loginKind}`)}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={channel.enabled}
                    disabled={busy || !channel.configured}
                    onCheckedChange={checked => void toggleChannel(channel, checked)}
                  />
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <p className="text-sm text-muted-foreground">{channel.description}</p>

                <div className="grid grid-cols-3 gap-2 rounded-md border p-3 text-center">
                  <div>
                    <div className="text-xs text-muted-foreground">{t('channels.statAccounts')}</div>
                    <div className="font-medium">{channel.accounts.enabled}/{channel.accounts.total}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('channels.statModels')}</div>
                    <div className="font-medium">
                      {channel.models.total - channel.models.disabled}/{channel.models.total}
                    </div>
                    {connected && sourceBadge !== null && sourceNotice !== null && (
                      <Badge
                        variant="outline"
                        className="mt-1 max-w-full border-amber-500 text-[10px] text-amber-600"
                        title={t(sourceNotice)}
                      >
                        {t(sourceBadge)}
                      </Badge>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('channels.statCredits')}</div>
                    <div
                      className="font-medium"
                      title={creditState !== undefined && creditState !== 'loading' ? creditState.note : undefined}
                    >
                      {creditState === 'loading'
                        ? <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                        : remaining !== undefined
                          ? remaining
                          : creditState !== undefined && creditState.status === 'available'
                            ? t('channels.creditsAvailable')
                            : creditState !== undefined && creditState.status === 'limited'
                              ? t('channels.creditsLimited')
                              : creditState !== undefined && creditState.status === 'unknown'
                                ? t('channels.creditsUnknown')
                                : creditState !== undefined && creditState.unsupported === true
                                  ? t('channels.creditsUnsupported')
                                  : '—'}
                    </div>
                  </div>
                </div>

                {creditState !== undefined && creditState !== 'loading'
                  && creditState.accounts.length > 0
                  && (
                    creditState.reported < creditState.accounts.length
                    || creditState.accounts.length > 1
                    || creditState.accounts.some(account => account.status !== undefined || account.note !== undefined)
                  ) && (
                  <div className="rounded-md border p-2">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {creditState.reported === 0
                          ? t('channels.creditsStatus')
                          : t('channels.statCredits')}
                      </span>
                      {creditState.reported > 0 && (
                        <span>
                          {t('channels.creditsReported', {
                            reported: creditState.reported,
                            total: creditState.accounts.length,
                          })}
                        </span>
                      )}
                    </div>
                    {creditState.error !== undefined && (
                      <p className="mb-1 text-xs text-destructive">{creditState.error}</p>
                    )}
                    <ul className="space-y-1">
                      {creditState.accounts.map(account => {
                        const statusLabel = account.status === 'available'
                          ? t('channels.creditsAvailable')
                          : account.status === 'limited'
                            ? t('channels.creditsLimited')
                            : account.status === 'unknown'
                              ? t('channels.creditsUnknown')
                              : undefined
                        const at = account.lastAt !== undefined
                          ? new Date(account.lastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '—'
                        const statusNote = account.status === 'available'
                          ? t('channels.creditsLastSuccess', { time: at })
                          : account.status === 'limited'
                            ? t('channels.creditsLastLimited', { time: at })
                            : account.status === 'unknown'
                              ? t('channels.creditsNoRecord')
                              : undefined
                        const note = [statusNote, account.note].filter(Boolean).join('；')
                        return (
                          <li key={account.accountId} className="space-y-0.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate">
                                {account.nickname}
                                {account.enabled === false && (
                                  <span className="ml-1 text-muted-foreground">{t('channels.creditsDisabled')}</span>
                                )}
                              </span>
                              {account.error !== undefined
                                ? (
                                  <span className="min-w-0 truncate text-destructive" title={account.error}>
                                    {account.error}
                                  </span>
                                )
                                : statusLabel !== undefined
                                  ? <span className="font-medium">{statusLabel}</span>
                                  : <span className="font-medium">{account.remaining ?? '—'}</span>}
                            </div>
                            {note.length > 0 && (
                              <p className="truncate text-muted-foreground" title={note}>{note}</p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2"
                      onClick={() => void toggleModels(channel)}
                    >
                      {modelsOpen
                        ? <ChevronUp className="mr-1 h-3.5 w-3.5" />
                        : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                      {t('channels.models.title')}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {modelList.length > 0 ? modelList.length : channel.models.total}
                      </span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !connected}
                      onClick={() => void refreshChannelModels(channel)}
                    >
                      <RefreshCw className={`mr-1 h-3.5 w-3.5${busy ? ' animate-spin' : ''}`} />
                      {t('channels.models.refresh')}
                    </Button>
                    {/* 按本渠道批量补全：先估算再确认，范围只这一家 */}
                    <CatalogScopeBatchButton
                      providerId={channel.id}
                      scopeLabel={channel.name}
                      disabled={!connected}
                      onFinished={() => {
                        void loadModels(channel)
                        void refreshAdoptions()
                      }}
                    />
                  </div>

                  {openTasks[channel.id] === true && (
                    <div className="space-y-2">
                      {taskErrors[channel.id] !== undefined && taskErrors[channel.id].length > 0 && (
                        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs text-amber-700">
                          {taskErrors[channel.id]}
                        </p>
                      )}
                      {tasks[channel.id] === 'loading' && (
                        <div className="flex items-center justify-center rounded-md border py-4 text-xs text-muted-foreground">
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          {t('common.loading')}
                        </div>
                      )}
                      {tasks[channel.id] === 'error' && (
                        <div className="rounded-md border py-4 text-center text-xs text-muted-foreground">
                          {t('channels.tasks.readFailed')}
                        </div>
                      )}
                      {Array.isArray(tasks[channel.id]) && (
                        <div className="divide-y rounded-md border">
                          {(tasks[channel.id] as TaskRow[])
                            .slice()
                            // 可领的排最前，其次进行中、未接单、已领 —— 用户先看能动手的。
                            .sort((a, b) => taskOrder(a) - taskOrder(b))
                            .map(row => {
                              const term = taskSearchTerm(row)
                              return (
                              <div key={`${row.account}-${row.key}`} className="px-2 py-2 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{row.title || row.key}</span>
                                  <span className={row.claimable
                                    ? 'rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700'
                                    : 'rounded bg-muted px-1.5 py-0.5 text-muted-foreground'}>
                                    {t(`channels.tasks.status.${row.status}`)}
                                  </span>
                                  {row.progress !== undefined && (
                                    <span className="text-muted-foreground">
                                      {`${row.progress.current}/${row.progress.target}`}
                                    </span>
                                  )}
                                  <span className="ml-auto text-muted-foreground">
                                    {/* 两个量纲各说一句、不相加；零的那一档不渲染。 */}
                                    {[
                                      row.rewardCredit > 0
                                        ? t('channels.claimTasksGainsCredit', { credit: row.rewardCredit }) : '',
                                      row.rewardEnergy > 0
                                        ? t('channels.claimTasksGainsEnergy', { energy: row.rewardEnergy }) : '',
                                      row.rewardBuddy ? t('channels.tasks.gainsBuddy') : '',
                                    ].filter(part => part.length > 0).join(t('channels.listSeparator'))}
                                  </span>
                                </div>
                                {row.description.length > 0 && (
                                  <p className="mt-1 text-muted-foreground">{row.description}</p>
                                )}
                                {term !== null && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="mt-1 h-6 px-1.5 text-[11px]"
                                    onClick={() => void copyTaskTerm(term)}
                                  >
                                    <Copy className="mr-1 h-3 w-3" />
                                    {t('channels.tasks.copyTerm', { term })}
                                  </Button>
                                )}
                                {channel.accounts.total > 1 && (
                                  <p className="mt-0.5 text-[10px] text-muted-foreground/70">{row.account}</p>
                                )}
                              </div>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  )}
                  {modelsOpen && (
                    <div className="space-y-2">
                      {connected && sourceNotice !== null && (
                        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs text-amber-700">
                          {t(sourceNotice)}
                        </p>
                      )}
                      {modelState === 'loading'
                        ? (
                        <div className="flex items-center justify-center rounded-md border py-4 text-xs text-muted-foreground">
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          {t('common.loading')}
                        </div>
                      )
                      : modelList.length === 0
                        ? (
                          <p className="rounded-md border px-2 py-2 text-xs text-muted-foreground">
                            {t('channels.models.empty')}
                          </p>
                        )
                        : (
                          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                            {modelList.map(model => {
                              const displayName = channelModelDisplayName(channel.name, channel.id, model)
                              return (
                              <div key={model.id} className="flex items-center gap-2 text-sm">
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span className={`truncate${model.disabled || model.dead ? ' text-muted-foreground line-through' : ''}`}>
                                    {model.name}
                                  </span>
                                  <ModelAnnotationSummary metadata={metadataByChannel[channel.id]?.[displayName]} />
                                </div>
                                {model.free && (
                                  <Badge variant="outline" className="shrink-0 border-emerald-500/40 text-emerald-600">
                                    {t('channels.models.free')}
                                  </Badge>
                                )}
                                {model.weight !== undefined && !model.free && (
                                  <Badge variant="secondary" className="shrink-0">
                                    {model.baseWeight === undefined
                                      ? `x${model.weight}`
                                      : `x${model.baseWeight}→x${model.weight}`}
                                  </Badge>
                                )}
                                {model.dead && (
                                  <Badge variant="outline" className="shrink-0">
                                    {t('channels.models.dead')}
                                  </Badge>
                                )}
                                {model.disabled && !model.dead && (
                                  <Badge variant="outline" className="shrink-0">
                                    {t('channels.models.disabled')}
                                  </Badge>
                                )}
                                {adoptedCountOf(channel, model) > 0 && (
                                  <Badge variant="outline" className="shrink-0 text-[10px] text-info">
                                    {t('channels.models.adoptedBadge', {
                                      count: adoptedCountOf(channel, model),
                                    })}
                                  </Badge>
                                )}
                                {/*
                                  标注入口。停用/失效的模型不在供应商目录里（`syncProviders`
                                  把它们排除在 supportedModels 之外），而手工标注与标准库采用
                                  写入前都校验「这个名字在该供应商目录里」，所以这两类只能关掉
                                  入口并说明原因 —— 放开就是一点击就吃一个归属错误。
                                */}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="shrink-0 px-1"
                                  disabled={model.disabled || model.dead}
                                  title={model.disabled || model.dead
                                    ? t('channels.models.annotateBlocked')
                                    : `${t('channels.models.annotate')} · ${t('channels.models.annotateHint')}`}
                                  onClick={() => setAnnotateTarget({ channel, model })}
                                >
                                  <Tags className="h-3.5 w-3.5" />
                                </Button>
                                {model.dead
                                  ? (
                                    // 失效模型只能恢复、不能开关：它已经不在目录里了。
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="shrink-0 px-1"
                                      disabled={busy}
                                      title={t('channels.models.restoreModel')}
                                      onClick={() => void restoreDeadModel(channel, model)}
                                    >
                                      <Undo2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )
                                  : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="shrink-0 px-1"
                                      disabled={busy}
                                      title={model.disabled
                                        ? t('channels.models.enableModel')
                                        : t('channels.models.disableModel')}
                                      onClick={() => void setModelDisabled(channel, model, !model.disabled)}
                                    >
                                      {model.disabled
                                        ? <Eye className="h-3.5 w-3.5" />
                                        : <EyeOff className="h-3.5 w-3.5" />}
                                    </Button>
                                  )}
                              </div>
                              )
                            })}
                          </div>
                        )}
                    </div>
                  )}
                </div>

                {channel.accounts.list.length > 0 && (
                  <ul className="space-y-1">
                    {channel.accounts.list.map((account, index) => (
                      <li key={account.id} className="flex items-center gap-2 rounded border px-2 py-1 text-sm">
                        <span className="min-w-0 flex-1 truncate">{account.nickname}</span>
                        {account.serviceStopped !== undefined && (
                          <span
                            className="shrink-0 text-xs text-destructive"
                            title={account.serviceStopped.text}
                          >
                            {t('channels.serviceStopped')}
                          </span>
                        )}
                        {account.expiresAt !== undefined && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {new Date(account.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-1"
                          disabled={busy || index === 0}
                          title={t('channels.moveUp')}
                          onClick={() => void moveAccount(channel, index, -1)}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-1"
                          disabled={busy || index === channel.accounts.list.length - 1}
                          title={t('channels.moveDown')}
                          onClick={() => void moveAccount(channel, index, 1)}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-1"
                          disabled={busy}
                          title={t('channels.refreshAccount')}
                          onClick={() => void refreshAccount(channel, account.id)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        {channel.id === 'trae' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="px-1"
                            disabled={busy}
                            title={t('channels.device.button')}
                            onClick={() => void openTraeDevice(account)}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Switch
                          checked={account.enabled}
                          disabled={busy}
                          onCheckedChange={checked => void toggleAccount(channel, account.id, checked)}
                          className="scale-75"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => void deleteAccount(channel, account.id)}
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      // 表单型渠道不跳浏览器：直接开本地对话框收 key / 加匿名槽。
                      if (channelAddFlowOf(channel.loginKind) === 'credential') openCredentialAdd(channel)
                      else void startLogin(channel)
                    }}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t('channels.addAccount')}
                  </Button>
                  {channel.dailyCheckin && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !connected}
                      onClick={() => void claimCredits(channel)}
                    >
                      <Ticket className="mr-1 h-3.5 w-3.5" />
                      {t('channels.claim')}
                    </Button>
                  )}
                  {channel.growthTasks && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !connected}
                      onClick={() => void claimTasks(channel)}
                    >
                      <Ticket className="mr-1 h-3.5 w-3.5" />
                      {t('channels.claimTasks')}
                    </Button>
                  )}
                  {channel.growthTasks && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !connected}
                      onClick={() => void acceptTasks(channel)}
                    >
                      <ListChecks className="mr-1 h-3.5 w-3.5" />
                      {t('channels.tasks.accept')}
                    </Button>
                  )}
                  {channel.growthTasks && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!connected}
                      onClick={() => void toggleTasks(channel)}
                    >
                      {t('channels.tasks.list')}
                    </Button>
                  )}
                  {connected && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void removeChannel(channel)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog open={login !== null} onOpenChange={open => { if (!open) void cancelLogin() }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t('channels.login.title', { name: login?.channel.name })}</DialogTitle>
            <DialogDescription>
              {login?.phase === 'failed'
                ? login.error
                : t(`channels.login.hint.${login?.channel.loginKind ?? 'browser'}`)}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 rounded-md border p-3 text-sm">
            {login?.phase === 'failed'
              ? <span className="text-destructive">{login.error}</span>
              : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{login?.phase === 'starting'
                    ? t('channels.login.starting')
                    : t('channels.login.waiting')}</span>
                </>
              )}
          </div>

          {login?.loginUrl !== undefined && login.phase !== 'failed' && (
            <p className="text-xs text-muted-foreground">
              {t('channels.login.manualHint')}{' '}
              <a
                className="break-all underline"
                href={login.loginUrl}
                target="_blank"
                rel="noreferrer"
              >
                {login.loginUrl}
              </a>
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => void cancelLogin()}>
              {login?.phase === 'failed' ? t('common.close') : t('common.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={credentialAdd !== null}
        onOpenChange={open => { if (!open && credentialAdd?.busy !== true) setCredentialAdd(null) }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t('channels.credential.title', { name: credentialAdd?.channel.name })}</DialogTitle>
            <DialogDescription>{t('channels.credential.hint')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="channel-credential-key">
                {t('channels.credential.keyLabel')}
              </label>
              <Input
                id="channel-credential-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                disabled={credentialAdd?.busy === true}
                value={credentialAdd?.apiKey ?? ''}
                placeholder={t('channels.credential.keyPlaceholder')}
                onChange={event => setCredentialAdd(current => current === null
                  ? null
                  : { ...current, apiKey: event.target.value, error: undefined })}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="channel-credential-nickname">
                {t('channels.credential.nicknameLabel')}
              </label>
              <Input
                id="channel-credential-nickname"
                autoComplete="off"
                disabled={credentialAdd?.busy === true}
                value={credentialAdd?.nickname ?? ''}
                placeholder={t('channels.credential.nicknamePlaceholder')}
                onChange={event => setCredentialAdd(current => current === null
                  ? null
                  : { ...current, nickname: event.target.value })}
              />
            </div>

            {credentialAdd?.error !== undefined && (
              <p className="text-destructive">{credentialAdd.error}</p>
            )}
            <p className="text-xs text-muted-foreground">{t('channels.credential.anonymousHint')}</p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              disabled={credentialAdd?.busy === true}
              onClick={() => setCredentialAdd(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              disabled={credentialAdd?.busy === true || credentialAdd?.channel.credentialAdd?.anonymous === undefined}
              onClick={() => void submitCredentialAdd('anonymous')}
            >
              {t('channels.credential.addAnonymous')}
            </Button>
            <Button
              disabled={credentialAdd?.busy === true || credentialAdd?.channel.credentialAdd?.withKey === undefined}
              onClick={() => void submitCredentialAdd('key')}
            >
              {credentialAdd?.busy === true && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('channels.credential.addKey')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={traeDevice !== null}
        onOpenChange={open => { if (!open && traeDevice?.saving !== true) setTraeDevice(null) }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t('channels.device.title', { name: traeDevice?.nickname })}</DialogTitle>
            <DialogDescription>{t('channels.device.hint')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="trae-device-id">
                {t('channels.device.label')}
              </label>
              <Input
                id="trae-device-id"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                disabled={traeDevice?.loading === true || traeDevice?.saving === true}
                value={traeDevice?.deviceId ?? ''}
                placeholder={t('channels.device.placeholder')}
                onChange={event => setTraeDevice(current => current === null
                  ? null
                  : { ...current, deviceId: event.target.value, error: undefined })}
              />
            </div>

            {traeDevice?.loading === true && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('channels.device.reading')}
              </p>
            )}

            {traeDevice !== null && traeDevice.loading !== true && traeDevice.devices.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('channels.device.detected')}</p>
                <ul className="space-y-1">
                  {traeDevice.devices.map(device => (
                    <li key={device.deviceId}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start font-mono text-xs"
                        disabled={traeDevice.saving}
                        onClick={() => setTraeDevice(current => current === null
                          ? null
                          : { ...current, deviceId: device.deviceId, error: undefined })}
                      >
                        {device.deviceId}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {traeDevice !== null && traeDevice.loading !== true && traeDevice.devices.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('channels.device.none')}</p>
            )}

            {traeDevice?.error !== undefined && <p className="text-destructive">{traeDevice.error}</p>}
            <p className="text-xs text-muted-foreground">{t('channels.device.where')}</p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={traeDevice?.saving === true} onClick={() => setTraeDevice(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={traeDevice?.saving === true || traeDevice?.loading === true}
              onClick={() => void saveTraeDevice()}
            >
              {traeDevice?.saving === true && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('channels.device.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {annotateTarget && (
        <ModelAnnotationDialog
          providerId={annotateTarget.channel.id}
          displayName={channelModelDisplayName(
            annotateTarget.channel.name,
            annotateTarget.channel.id,
            annotateTarget.model,
          )}
          modelLabel={annotateTarget.model.name}
          onClose={() => setAnnotateTarget(null)}
          onChanged={() => {
            void loadModels(annotateTarget.channel)
            void refreshAdoptions()
          }}
        />
      )}
    </div>
  )
}

export default Channels
