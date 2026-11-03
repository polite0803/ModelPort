import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ModelListRefreshConfig } from '@shared/types'

/**
 * 周期档位（毫秒）。UI 只暴露**天/周/月**单位——模型清单变化本就低频，
 * 分钟/小时级刷新纯属浪费。下限 60s 是主进程 `normalizeModelListRefresh` 的防呆，
 * 这里不暴露。
 *   短档（账号渠道）：1周 / 2周 / 1月 / 3月（默认 1周）
 *   长档（聚合·内置）：2周 / 1月 / 3月 / 6月（默认 2周）
 */
const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY
const MONTH = 30 * DAY

const SHORT_OPTIONS = [
  { value: WEEK, labelKey: 'settings.modelRefresh.week1' },
  { value: 2 * WEEK, labelKey: 'settings.modelRefresh.week2' },
  { value: MONTH, labelKey: 'settings.modelRefresh.month1' },
  { value: 3 * MONTH, labelKey: 'settings.modelRefresh.month3' },
]

const LONG_OPTIONS = [
  { value: 2 * WEEK, labelKey: 'settings.modelRefresh.week2' },
  { value: MONTH, labelKey: 'settings.modelRefresh.month1' },
  { value: 3 * MONTH, labelKey: 'settings.modelRefresh.month3' },
  { value: 6 * MONTH, labelKey: 'settings.modelRefresh.month6' },
]

export function ModelListRefreshSettings() {
  const { t } = useTranslation()
  const { config, updateConfig } = useSettingsStore()
  const refresh = config?.modelListRefresh ?? null

  const [triggering, setTriggering] = useState(false)
  const [lastTriggerError, setLastTriggerError] = useState<string | null>(null)

  // 本地 fallback：config 还没读回来时用出厂默认展示，不影响实际逻辑。
  const enabled = refresh?.enabled ?? true
  const accountChannels = refresh?.accountChannels ?? true
  const aggregate = refresh?.aggregate ?? true
  const builtin = refresh?.builtin ?? true
  const shortMs = refresh?.accountIntervalMs ?? WEEK
  const longMs = refresh?.aggregateIntervalMs ?? 2 * WEEK

  function patch(partial: Partial<ModelListRefreshConfig>) {
    const next: ModelListRefreshConfig = {
      enabled,
      accountIntervalMs: shortMs,
      aggregateIntervalMs: longMs,
      accountChannels,
      aggregate,
      builtin,
      ...partial,
    }
    void updateConfig({ modelListRefresh: next })
  }

  async function handleTrigger() {
    setTriggering(true)
    setLastTriggerError(null)
    try {
      const result = await window.electronAPI.modelRefresh.triggerNow()
      if (!result.ok) setLastTriggerError(result.reason ?? 'failed')
    } catch (error) {
      setLastTriggerError(error instanceof Error ? error.message : String(error))
    } finally {
      setTriggering(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>{t('settings.modelRefresh.title')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="setting-list">
          <div className="setting-row">
            <div className="space-y-0.5">
              <p className="setting-label">{t('settings.modelRefresh.enabled')}</p>
              <p className="setting-hint">{t('settings.modelRefresh.enabledHelp')}</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(value) => patch({ enabled: value })}
            />
          </div>

          <div className="setting-row setting-row-wrap">
            <div className="space-y-0.5">
              <p className="setting-label">{t('settings.modelRefresh.shortInterval')}</p>
              <p className="setting-hint">{t('settings.modelRefresh.shortIntervalHelp')}</p>
            </div>
            <Select
              value={String(shortMs)}
              onValueChange={(value) => patch({ accountIntervalMs: Number(value) })}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHORT_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="setting-row setting-row-wrap">
            <div className="space-y-0.5">
              <p className="setting-label">{t('settings.modelRefresh.longInterval')}</p>
              <p className="setting-hint">{t('settings.modelRefresh.longIntervalHelp')}</p>
            </div>
            <Select
              value={String(longMs)}
              onValueChange={(value) => patch({ aggregateIntervalMs: Number(value) })}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LONG_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="setting-row">
            <div className="space-y-0.5">
              <p className="setting-label">{t('settings.modelRefresh.accountChannels')}</p>
              <p className="setting-hint">{t('settings.modelRefresh.accountChannelsHelp')}</p>
            </div>
            <Switch
              checked={accountChannels}
              onCheckedChange={(value) => patch({ accountChannels: value })}
            />
          </div>

          <div className="setting-row">
            <div className="space-y-0.5">
              <p className="setting-label">{t('settings.modelRefresh.aggregate')}</p>
              <p className="setting-hint">{t('settings.modelRefresh.aggregateHelp')}</p>
            </div>
            <Switch
              checked={aggregate}
              onCheckedChange={(value) => patch({ aggregate: value })}
            />
          </div>

          <div className="setting-row">
            <div className="space-y-0.5">
              <p className="setting-label">{t('settings.modelRefresh.builtin')}</p>
              <p className="setting-hint">{t('settings.modelRefresh.builtinHelp')}</p>
            </div>
            <Switch
              checked={builtin}
              onCheckedChange={(value) => patch({ builtin: value })}
            />
          </div>

          <div className="setting-row setting-row-wrap">
            <div className="space-y-0.5">
              <p className="setting-label">{t('settings.modelRefresh.triggerNow')}</p>
              <p className="setting-hint">
                {lastTriggerError
                  ? t('settings.modelRefresh.triggerError', { reason: lastTriggerError })
                  : t('settings.modelRefresh.triggerNowHelp')}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={triggering || !enabled} onClick={handleTrigger}>
              {triggering ? t('settings.modelRefresh.triggering') : t('settings.modelRefresh.triggerBtn')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
