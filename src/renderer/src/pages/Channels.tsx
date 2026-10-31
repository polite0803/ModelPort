import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Ticket,
  Trash2,
  Undo2,
  UserMinus,
} from 'lucide-react'
import type {
  ChannelAutoCheckin,
  ChannelCredits,
  ChannelModelInfo,
  ChannelView,
} from '../../../shared/channels'
import { channelAddFlowOf } from '../../../shared/channels'
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

interface LoginState {
  channel: ChannelView
  accountId?: string
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

const POLL_INTERVAL_MS = 2500
const POLL_TIMEOUT_MS = 5 * 60 * 1000

export function Channels() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [channels, setChannels] = useState<ChannelView[]>([])
  const [credits, setCredits] = useState<Record<string, ChannelCredits | 'loading'>>({})
  const [models, setModels] = useState<Record<string, ChannelModelInfo[] | 'loading'>>({})
  const [openModels, setOpenModels] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [autoCheckin, setAutoCheckin] = useState<ChannelAutoCheckin | null>(null)
  const [autoCheckinBusy, setAutoCheckinBusy] = useState(false)
  const [login, setLogin] = useState<LoginState | null>(null)
  const [credentialAdd, setCredentialAdd] = useState<CredentialAddState | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCheckinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loginRef = useRef<LoginState | null>(null)
  loginRef.current = login

  const loadCredits = useCallback(async (views: ChannelView[]) => {
    const connected = views.filter(view => view.accounts.total > 0)
    if (connected.length === 0) return
    await Promise.all(connected.map(async view => {
      // stale-while-revalidate：已有旧值时**不**置 loading —— worker 的 `changed`
      // 事件（请求消耗、启停账号等）都会触发全量刷新，若每次都闪 loading，
      // 用户看到的就是「所有渠道的积分都在刷」而不是目标渠道的加减（2026-10-30）。
      setCredits(current => current[view.id] === undefined
        ? { ...current, [view.id]: 'loading' }
        : current)
      const value = await window.electronAPI.channels.credits(view.id)
      setCredits(current => ({ ...current, [view.id]: value }))
    }))
  }, [])

  // 这个开关不属于某个渠道：一个开关管所有渠道，每个自然日只跑一次。
  // 跑一轮是后台任务，只有 running 时才追着看，跑完就停。
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
    if (result.state.running) {
      autoCheckinTimer.current = setTimeout(() => { void loadAutoCheckin() }, POLL_INTERVAL_MS)
    }
  }, [])

  const refresh = useCallback(async () => {
    const result = await window.electronAPI.channels.list()
    setChannels(result.channels)
    setUnavailable(result.success ? null : (result.reason ?? 'channels_unavailable'))
    setLoading(false)
    void loadCredits(result.channels)
    void loadAutoCheckin()
  }, [loadAutoCheckin, loadCredits])

  useEffect(() => {
    void refresh()
    const unsubscribe = window.electronAPI.channels.onChanged(() => {
      void refresh()
    })
    return unsubscribe
  }, [refresh])

  useEffect(() => () => {
    if (pollTimer.current !== null) clearTimeout(pollTimer.current)
    if (autoCheckinTimer.current !== null) clearTimeout(autoCheckinTimer.current)
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
    const result = await window.electronAPI.channels.rpc('account.create', { provider: channel.id })
    if (!result.ok) {
      setLogin({ channel, phase: 'failed', error: result.error?.message ?? t('channels.login.failed') })
      return
    }
    const value = result.value as { accountId?: string } | undefined
    if (typeof value?.accountId !== 'string') {
      setLogin({ channel, phase: 'failed', error: t('channels.login.failed') })
      return
    }
    setLogin({ channel, accountId: value.accountId, phase: 'waiting' })
    pollLogin(value.accountId, Date.now())
  }

  const cancelLogin = async () => {
    stopPolling()
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

  const loadModels = async (channel: ChannelView) => {
    setModels(current => ({ ...current, [channel.id]: 'loading' }))
    const result = await window.electronAPI.channels.models(channel.id)
    setModels(current => ({ ...current, [channel.id]: result.success ? result.models : [] }))
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
    toast({
      title: t('channels.models.refreshed'),
      description: t('channels.models.refreshedCount', { count: result.count ?? 0 }),
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
            </div>
          </div>
          <Switch
            checked={autoCheckin?.enabled === true}
            disabled={autoCheckinBusy || autoCheckin === null}
            onCheckedChange={checked => void toggleAutoCheckin(checked)}
          />
        </CardContent>
      </Card>

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
          return (
            <Card key={channel.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold uppercase">
                      {channel.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{channel.name}</span>
                        <Badge variant={connected ? 'secondary' : 'outline'}>
                          {connected ? t('channels.connected') : t('channels.notConnected')}
                        </Badge>
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
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('channels.statCredits')}</div>
                    <div className="font-medium">
                      {creditState === 'loading'
                        ? <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                        : remaining !== undefined ? remaining : '—'}
                    </div>
                  </div>
                </div>

                {creditState !== undefined && creditState !== 'loading'
                  && creditState.accounts.length > 0
                  && (creditState.reported < creditState.accounts.length || creditState.accounts.length > 1) && (
                  <div className="rounded-md border p-2">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{t('channels.statCredits')}</span>
                      <span>
                        {t('channels.creditsReported', {
                          reported: creditState.reported,
                          total: creditState.accounts.length,
                        })}
                      </span>
                    </div>
                    {creditState.error !== undefined && (
                      <p className="mb-1 text-xs text-destructive">{creditState.error}</p>
                    )}
                    <ul className="space-y-1">
                      {creditState.accounts.map(account => (
                        <li key={account.accountId} className="flex items-center justify-between gap-2 text-xs">
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
                            : <span className="font-medium">{account.remaining ?? '—'}</span>}
                        </li>
                      ))}
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
                  </div>

                  {modelsOpen && (
                    modelState === 'loading'
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
                            {modelList.map(model => (
                              <div key={model.id} className="flex items-center gap-2 text-sm">
                                <span className={`min-w-0 flex-1 truncate${model.disabled || model.dead ? ' text-muted-foreground line-through' : ''}`}>
                                  {model.name}
                                </span>
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
                            ))}
                          </div>
                        )
                  )}
                </div>

                {channel.accounts.list.length > 0 && (
                  <ul className="space-y-1">
                    {channel.accounts.list.map((account, index) => (
                      <li key={account.id} className="flex items-center gap-2 rounded border px-2 py-1 text-sm">
                        <span className="min-w-0 flex-1 truncate">{account.nickname}</span>
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !connected}
                    onClick={() => void claimCredits(channel)}
                  >
                    <Ticket className="mr-1 h-3.5 w-3.5" />
                    {t('channels.claim')}
                  </Button>
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
    </div>
  )
}

export default Channels
