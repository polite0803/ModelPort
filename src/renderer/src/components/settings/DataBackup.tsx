import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Download,
  Upload,
  Lock,
  ShieldAlert,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import type {
  BackupApplyResult,
  BackupMode,
  BackupPreview,
  BackupSkippedBlock,
  BackupWarningCode,
} from '@shared/backup'

type Step = 'idle' | 'export' | 'password' | 'preview' | 'done'

const WARNING_KEYS: Record<BackupWarningCode, string> = {
  'no-credentials': 'settings.backup.warnNoCredentials',
  'credentials-unreadable': 'settings.backup.warnCredentialsUnreadable',
  'channel-unavailable': 'settings.backup.warnChannelUnavailable',
  'different-platform': 'settings.backup.warnDifferentPlatform',
  'newer-app-version': 'settings.backup.warnNewerAppVersion',
}

const SKIPPED_KEYS: Record<BackupSkippedBlock, string> = {
  statistics: 'settings.backup.skipStatistics',
  logs: 'settings.backup.skipLogs',
  channels: 'settings.backup.skipChannels',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 完整备份（全部数据与配置）。
 *
 * 与同页的「界面偏好导出」不是一个功能：那份只搬 13 个 UI 偏好，用来同步主题/语言；
 * 这份搬供应商、账号凭据、路由、模型标注与渠道登录态，用来换机迁移。
 *
 * 导出/导入全部由主进程完成（原生保存/打开对话框、解密、重新加密落库），这里只负责
 * 选项、预览与确认。导入完成后**必须重启**：供应商与账号是启动时播种并镜像进运行时
 * 的，热替换会让两套状态并存。
 */
export function DataBackup() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [step, setStep] = useState<Step>('idle')
  const [busy, setBusy] = useState(false)
  const [includeStatistics, setIncludeStatistics] = useState(true)
  const [includeLogs, setIncludeLogs] = useState(false)
  const [encrypt, setEncrypt] = useState(true)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  const [token, setToken] = useState<string | null>(null)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [mode, setMode] = useState<BackupMode>('replace')
  const [result, setResult] = useState<BackupApplyResult | null>(null)

  const api = window.electronAPI?.backup

  const resetState = () => {
    setStep('idle')
    setBusy(false)
    setPassword('')
    setPasswordConfirm('')
    setUnlockPassword('')
    setToken(null)
    setPreview(null)
    setMode('replace')
    setResult(null)
  }

  const closeAll = () => {
    if (token) void api?.cancel(token)
    resetState()
  }

  const handleExport = async () => {
    if (!api) return
    if (encrypt && password !== passwordConfirm) {
      toast({
        title: t('settings.backup.passwordMismatch'),
        variant: 'destructive',
      })
      return
    }
    setBusy(true)
    try {
      const response = await api.export({
        includeStatistics,
        includeLogs,
        ...(encrypt && password !== '' ? { password } : {}),
      })
      if (response.canceled) {
        setBusy(false)
        return
      }
      if (response.error || !response.filePath) {
        toast({
          title: t('common.error'),
          description: t(`settings.backup.error.${response.error ?? 'write-failed'}`),
          variant: 'destructive',
        })
        setBusy(false)
        return
      }
      toast({
        title: t('settings.backup.exportSuccess'),
        description: t('settings.backup.exportSuccessDesc', {
          size: formatBytes(response.bytes ?? 0),
          accounts: response.preview?.counts.accounts ?? 0,
          providers: response.preview?.counts.providers ?? 0,
        }),
      })
      resetState()
    } catch {
      toast({ title: t('common.error'), description: t('settings.backup.error.write-failed'), variant: 'destructive' })
      setBusy(false)
    }
  }

  const handlePick = async () => {
    if (!api) return
    setBusy(true)
    try {
      const response = await api.pick()
      if (response.canceled) {
        setBusy(false)
        return
      }
      if (response.error || !response.token) {
        toast({
          title: t('common.error'),
          description: t(`settings.backup.error.${response.error ?? 'read-failed'}`),
          variant: 'destructive',
        })
        setBusy(false)
        return
      }
      setToken(response.token)
      if (response.encrypted) {
        setUnlockPassword('')
        setStep('password')
        setBusy(false)
        return
      }
      setPreview(response.preview ?? null)
      setMode('replace')
      setStep('preview')
      setBusy(false)
    } catch {
      toast({ title: t('common.error'), description: t('settings.backup.error.read-failed'), variant: 'destructive' })
      setBusy(false)
    }
  }

  const handleUnlock = async () => {
    if (!api || !token) return
    setBusy(true)
    try {
      const response = await api.unlock(token, unlockPassword)
      if (!response.ok || !response.preview) {
        toast({
          title: t('common.error'),
          description: t(`settings.backup.error.${response.error ?? 'bad-password'}`),
          variant: 'destructive',
        })
        setBusy(false)
        return
      }
      setPreview(response.preview)
      setMode('replace')
      setStep('preview')
      setBusy(false)
    } catch {
      toast({ title: t('common.error'), description: t('settings.backup.error.bad-password'), variant: 'destructive' })
      setBusy(false)
    }
  }

  const handleApply = async () => {
    if (!api || !token) return
    setBusy(true)
    try {
      const response = await api.apply(token, mode)
      setResult(response)
      setToken(null)
      if (!response.ok) {
        toast({
          title: t('common.error'),
          description: t(`settings.backup.error.${response.error ?? 'apply-failed'}`),
          variant: 'destructive',
        })
        setBusy(false)
        setStep('idle')
        return
      }
      setStep('done')
      setBusy(false)
    } catch {
      toast({ title: t('common.error'), description: t('settings.backup.error.apply-failed'), variant: 'destructive' })
      setBusy(false)
      setStep('idle')
    }
  }

  const counts = preview?.counts

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="card-icon">
              <Archive className="h-3.5 w-3.5" />
            </div>
            {t('settings.backup.title')}
          </CardTitle>
          <CardDescription>{t('settings.backup.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 space-y-2">
            <p className="text-sm text-muted-foreground">{t('settings.backup.contains')}</p>
            <ul className="grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
              <li>• {t('settings.backup.containsProviders')}</li>
              <li>• {t('settings.backup.containsAccounts')}</li>
              <li>• {t('settings.backup.containsConfig')}</li>
              <li>• {t('settings.backup.containsChannels')}</li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="flex items-center gap-2"
              onClick={() => {
                resetState()
                setStep('export')
              }}
              disabled={busy}
            >
              <Download className="h-4 w-4" />
              {t('settings.backup.export')}
            </Button>
            <Button
              variant="outline"
              className="flex items-center gap-2"
              onClick={handlePick}
              disabled={busy}
            >
              <Upload className="h-4 w-4" />
              {busy ? t('settings.backup.reading') : t('settings.backup.import')}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t('settings.backup.restartHint')}</p>
        </CardContent>
      </Card>

      {/* 导出选项 */}
      <Dialog
        open={step === 'export'}
        onOpenChange={(open) => {
          if (!open && !busy) resetState()
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('settings.backup.exportTitle')}</DialogTitle>
            <DialogDescription>{t('settings.backup.exportDesc')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
              <div className="space-y-1 pr-3">
                <Label htmlFor="backup-statistics">{t('settings.backup.includeStatistics')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.backup.includeStatisticsHelp')}</p>
              </div>
              <Switch
                id="backup-statistics"
                checked={includeStatistics}
                onCheckedChange={setIncludeStatistics}
                disabled={busy}
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
              <div className="space-y-1 pr-3">
                <Label htmlFor="backup-logs">{t('settings.backup.includeLogs')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.backup.includeLogsHelp')}</p>
              </div>
              <Switch
                id="backup-logs"
                checked={includeLogs}
                onCheckedChange={setIncludeLogs}
                disabled={busy}
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
              <div className="space-y-1 pr-3">
                <Label htmlFor="backup-encrypt" className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5" />
                  {t('settings.backup.encrypt')}
                </Label>
                <p className="text-xs text-muted-foreground">{t('settings.backup.encryptHelp')}</p>
              </div>
              <Switch id="backup-encrypt" checked={encrypt} onCheckedChange={setEncrypt} disabled={busy} />
            </div>

            {encrypt ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="backup-password">{t('settings.backup.password')}</Label>
                  <Input
                    id="backup-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t('settings.backup.passwordPlaceholder')}
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="backup-password-confirm">{t('settings.backup.passwordConfirm')}</Label>
                  <Input
                    id="backup-password-confirm"
                    type="password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    disabled={busy}
                  />
                </div>
                <p className="text-xs text-muted-foreground md:col-span-2">
                  {t('settings.backup.passwordHelp')}
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('settings.backup.plaintextWarning')}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetState} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleExport} disabled={busy || (encrypt && password === '')}>
              {busy ? t('settings.backup.exporting') : t('settings.backup.exportConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 口令解密 */}
      <Dialog
        open={step === 'password'}
        onOpenChange={(open) => {
          if (!open && !busy) closeAll()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              {t('settings.backup.unlockTitle')}
            </DialogTitle>
            <DialogDescription>{t('settings.backup.unlockDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="backup-unlock-password">{t('settings.backup.password')}</Label>
            <Input
              id="backup-unlock-password"
              type="password"
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && unlockPassword !== '' && !busy) void handleUnlock()
              }}
              disabled={busy}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAll} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUnlock} disabled={busy || unlockPassword === ''}>
              {busy ? t('settings.backup.unlocking') : t('settings.backup.unlock')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入预览与模式 */}
      <Dialog
        open={step === 'preview'}
        onOpenChange={(open) => {
          if (!open && !busy) closeAll()
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('settings.backup.previewTitle')}</DialogTitle>
            <DialogDescription>{t('settings.backup.previewDesc')}</DialogDescription>
          </DialogHeader>

          {counts ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                <SummaryCell label={t('settings.backup.countProviders')} value={counts.providers} />
                <SummaryCell
                  label={t('settings.backup.countAccounts')}
                  value={`${counts.accounts} (${t('settings.backup.countWithCredentials', { n: counts.accountsWithCredentials })})`}
                />
                <SummaryCell label={t('settings.backup.countRoutes')} value={counts.routes} />
                <SummaryCell label={t('settings.backup.countMappings')} value={counts.modelMappings} />
                <SummaryCell label={t('settings.backup.countApiKeys')} value={counts.apiKeys} />
                <SummaryCell label={t('settings.backup.countChannelAccounts')} value={counts.channelAccounts} />
                <SummaryCell label={t('settings.backup.countRequestLogs')} value={counts.requestLogs} />
                <SummaryCell label={t('settings.backup.countAppLogs')} value={counts.appLogs} />
                <SummaryCell
                  label={t('settings.backup.countCreatedAt')}
                  value={
                    preview?.createdAt && !Number.isNaN(Date.parse(preview.createdAt))
                      ? new Date(preview.createdAt).toLocaleString()
                      : '-'
                  }
                  small
                />
              </div>

              {preview && preview.warnings.length > 0 ? (
                <div className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                  {preview.warnings.map((warning) => (
                    <p key={warning} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t(WARNING_KEYS[warning])}</span>
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>{t('settings.backup.mode')}</Label>
                <div className="grid gap-2 md:grid-cols-2">
                  <ModeOption
                    active={mode === 'replace'}
                    onClick={() => setMode('replace')}
                    title={t('settings.backup.modeReplace')}
                    description={t('settings.backup.modeReplaceDesc')}
                    disabled={busy}
                  />
                  <ModeOption
                    active={mode === 'merge'}
                    onClick={() => setMode('merge')}
                    title={t('settings.backup.modeMerge')}
                    description={t('settings.backup.modeMergeDesc')}
                    disabled={busy}
                  />
                </div>
              </div>

              {mode === 'replace' ? (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t('settings.backup.replaceWarning')}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={closeAll} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleApply} disabled={busy}>
              {busy ? t('settings.backup.applying') : t('settings.backup.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 完成 */}
      <Dialog
        open={step === 'done'}
        onOpenChange={(open) => {
          if (!open) resetState()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              {t('settings.backup.applySuccess')}
            </DialogTitle>
            <DialogDescription>{t('settings.backup.applySuccessDesc')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-xs text-muted-foreground">
            {result?.skipped && result.skipped.length > 0 ? (
              <p>{t('settings.backup.skipped', { blocks: result.skipped.map((block) => t(SKIPPED_KEYS[block])).join('、') })}</p>
            ) : null}
            {result?.safetyCopy ? (
              <p className="break-all">{t('settings.backup.safetyCopy', { path: result.safetyCopy })}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetState}>
              {t('settings.backup.later')}
            </Button>
            <Button className="flex items-center gap-2" onClick={() => void window.electronAPI?.backup?.restart()}>
              <RotateCw className="h-4 w-4" />
              {t('settings.backup.restartNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SummaryCell({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={small ? 'text-xs break-all' : 'text-sm font-medium'}>{value}</p>
    </div>
  )
}

function ModeOption({
  active,
  onClick,
  title,
  description,
  disabled,
}: {
  active: boolean
  onClick: () => void
  title: string
  description: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border p-3 text-left transition ${
        active
          ? 'border-[var(--accent-primary)] bg-[var(--glass-bg-hover)]'
          : 'border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)]'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  )
}
