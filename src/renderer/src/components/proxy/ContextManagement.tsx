import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useProxyStore } from '@/stores/proxyStore'
import { Layers, Eye } from 'lucide-react'
import { normalizeVisionRelay, type VisionRelaySettings } from '@shared/visionRelayConfig'

type ContextWindowTier = '200k' | '400k' | '1m'

interface StrategyConfig {
  slidingWindow: {
    enabled: boolean
    maxMessages: number
  }
  tokenLimit: {
    enabled: boolean
    maxTokens: number
    contextWindowTier?: ContextWindowTier
    costBudgetByProvider?: Record<string, number>
  }
}

interface ContextManagementConfigType {
  enabled: boolean
  strategies: StrategyConfig
  executionOrder: ('slidingWindow' | 'tokenLimit')[]
  channelIds?: string[]
}

/** 逗号/空白分隔的渠道 ID 列表；空串归一为不裁剪任何渠道。 */
function parseChannelIds(text: string): string[] {
  return [...new Set(text.split(/[,\s，、]+/).map(id => id.trim()).filter(Boolean))]
}

/** `渠道: token` 每行一条。坏行整条丢弃 —— 落一个 0 会把历史裁到只剩最新一条。 */
function parseCostBudget(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split(/\r?\n/)) {
    const at = line.lastIndexOf(':')
    if (at < 0) continue
    const id = line.slice(0, at).trim()
    const value = Number(line.slice(at + 1).trim())
    if (id.length === 0 || !Number.isFinite(value)) continue
    const tokens = Math.floor(value)
    if (tokens <= 0) continue
    out[id] = tokens
  }
  return out
}

/** 反向：把存着的那张表摊成可编辑文本（界面只此一份形态，不改它的形状）。 */
function formatCostBudget(table?: Record<string, number>): string {
  return Object.entries(table ?? {}).map(([id, tokens]) => `${id}: ${tokens}`).join('\n')
}

export function ContextManagement() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [config, setConfig] = useState<ContextManagementConfigType>({
    enabled: false,
    strategies: {
      slidingWindow: { enabled: true, maxMessages: 20 },
      // 出厂不带档位：与 `DEFAULT_TOKEN_LIMIT_CONFIG` 同形，老配置读进来也不必先被改一次。
      tokenLimit: { enabled: false, maxTokens: 4000 },
    },
    executionOrder: ['slidingWindow', 'tokenLimit'],
  })

  const [hasChanges, setHasChanges] = useState(false)
  const [channelIdsText, setChannelIdsText] = useState('')
  const [costBudgetText, setCostBudgetText] = useState('')

  // 视觉读图两段式（PLAN-vision-relay）。读到持久化配置之前不渲染可编辑控件：
  // 否则默认值会在用户没碰过的情况下被保存回盘，把「出厂关闭」伪装成用户的选择。
  const { appConfig, isLoading, saveAppConfig } = useProxyStore()
  const [visionRelay, setVisionRelay] = useState<VisionRelaySettings | null>(null)
  const [relayReaders, setRelayReaders] = useState<Array<{ displayName: string; providerName: string; paid?: boolean }>>([])
  const [relaySaving, setRelaySaving] = useState(false)

  useEffect(() => {
    if (isLoading || !appConfig) return
    setVisionRelay(normalizeVisionRelay(appConfig.visionRelay) ?? { enabled: false, maxImageBytes: 8 * 1024 * 1024 })
  }, [isLoading, appConfig])

  useEffect(() => {
    window.electronAPI.visionRelay.readers()
      .then(result => setRelayReaders(result.readers ?? []))
      .catch(error => console.error('Failed to load vision relay readers:', error))
  }, [])

  const saveVisionRelay = async () => {
    if (visionRelay === null) return
    setRelaySaving(true)
    try {
      const success = await saveAppConfig({ visionRelay })
      if (success) {
        toast({ title: t('common.success'), description: t('contextManagement.visionRelay.saved') })
      }
    } finally {
      setRelaySaving(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const contextConfig = await window.electronAPI.contextManagement.getConfig()
      setConfig(contextConfig)
      setChannelIdsText((contextConfig.channelIds ?? []).join(', '))
      setCostBudgetText(formatCostBudget(contextConfig.strategies?.tokenLimit?.costBudgetByProvider))
    } catch (error) {
      console.error('Failed to load context management config:', error)
    }
  }

  const handleConfigChange = (updates: Partial<ContextManagementConfigType>) => {
    setConfig(prev => ({ ...prev, ...updates }))
    setHasChanges(true)
  }

  const handleStrategyChange = (
    strategyKey: keyof StrategyConfig,
    updates: Partial<StrategyConfig[keyof StrategyConfig]>
  ) => {
    setConfig(prev => ({
      ...prev,
      strategies: {
        ...prev.strategies,
        [strategyKey]: {
          ...prev.strategies[strategyKey],
          ...updates,
        },
      },
    }))
    setHasChanges(true)
  }

  const saveConfig = async () => {
    try {
      await window.electronAPI.contextManagement.updateConfig({
        ...config,
        channelIds: parseChannelIds(channelIdsText),
        strategies: {
          ...config.strategies,
          tokenLimit: {
            ...config.strategies.tokenLimit,
            costBudgetByProvider: parseCostBudget(costBudgetText),
          },
        },
      })
      setHasChanges(false)
      toast({
        title: t('common.success'),
        description: t('contextManagement.configSaved'),
      })
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('contextManagement.configSaveFailed'),
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t('contextManagement.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="space-y-0.5">
              <Label htmlFor="context-enabled">{t('contextManagement.enableContextManagement')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('contextManagement.enableContextManagementHint')}
              </p>
            </div>
            <Switch
              id="context-enabled"
              checked={config.enabled}
              onCheckedChange={(checked) => handleConfigChange({ enabled: checked })}
            />
          </div>

          {config.enabled && (
            <div className="space-y-4 pt-4 border-t">
              <div className="space-y-2">
                <Label htmlFor="context-channel-ids">{t('contextManagement.channelIds')}</Label>
                <Input
                  id="context-channel-ids"
                  value={channelIdsText}
                  onChange={(e) => {
                    setChannelIdsText(e.target.value)
                    handleConfigChange({ channelIds: parseChannelIds(e.target.value) })
                  }}
                  placeholder="trae"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  {t('contextManagement.channelIdsHint')}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-primary"></div>
                <span className="text-sm font-medium text-muted-foreground">
                  {t('contextManagement.strategyConfig')}
                </span>
              </div>

              <div className="space-y-4">
                <div className="p-4 border rounded-lg space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="font-medium">{t('contextManagement.slidingWindow.title')}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t('contextManagement.slidingWindow.description')}
                      </p>
                    </div>
                    <Switch
                      checked={config.strategies.slidingWindow.enabled}
                      onCheckedChange={(checked) =>
                        handleStrategyChange('slidingWindow', { enabled: checked })
                      }
                    />
                  </div>
                  {config.strategies.slidingWindow.enabled && (
                    <div className="flex items-center gap-4 pl-4 border-l-2">
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="max-messages">{t('contextManagement.slidingWindow.maxMessages')}</Label>
                        <Input
                          id="max-messages"
                          type="number"
                          min={1}
                          max={100}
                          value={config.strategies.slidingWindow.maxMessages}
                          onChange={(e) =>
                            handleStrategyChange('slidingWindow', {
                              maxMessages: parseInt(e.target.value) || 20,
                            })
                          }
                          className="w-32"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('contextManagement.slidingWindow.maxMessagesHint')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 border rounded-lg space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="font-medium">{t('contextManagement.tokenLimit.title')}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t('contextManagement.tokenLimit.description')}
                      </p>
                    </div>
                    <Switch
                      checked={config.strategies.tokenLimit.enabled}
                      onCheckedChange={(checked) =>
                        handleStrategyChange('tokenLimit', { enabled: checked })
                      }
                    />
                  </div>
                  {config.strategies.tokenLimit.enabled && (
                    <div className="flex items-center gap-4 pl-4 border-l-2">
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="context-window-tier">
                          {t('contextManagement.tokenLimit.tierFallbackLabel')}
                        </Label>
                        <Select
                          value={config.strategies.tokenLimit.contextWindowTier ?? 'none'}
                          onValueChange={(value) =>
                            handleStrategyChange('tokenLimit', {
                              contextWindowTier:
                                value === 'none' ? undefined : (value as ContextWindowTier),
                            })
                          }
                        >
                          <SelectTrigger id="context-window-tier" className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* 不选也要能表达：留空＝继续沿用按供应商/全局的旧数。 */}
                            <SelectItem value="none">
                              {t('contextManagement.tokenLimit.tierUnset')}
                            </SelectItem>
                            <SelectItem value="200k">200K</SelectItem>
                            <SelectItem value="400k">400K</SelectItem>
                            <SelectItem value="1m">1M</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {t('contextManagement.tokenLimit.contextWindowTierHint')}
                        </p>
                      </div>
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="context-cost-budget">
                          {t('contextManagement.tokenLimit.costBudget')}
                        </Label>
                        <textarea
                          id="context-cost-budget"
                          value={costBudgetText}
                          onChange={(e) => {
                            setCostBudgetText(e.target.value)
                            handleStrategyChange('tokenLimit', {
                              costBudgetByProvider: parseCostBudget(e.target.value),
                            })
                          }}
                          placeholder={t('contextManagement.tokenLimit.costBudgetPlaceholder')}
                          rows={3}
                          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('contextManagement.tokenLimit.costBudgetHint')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {hasChanges && (
            <div className="flex justify-end pt-4 border-t">
              <Button onClick={saveConfig}>
                {t('common.save')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 视觉读图两段式：这一轮服务的模型收不下图时，先用免费视觉模型把图转述成文字。
          已标注 vision 的目标直发、零介入；默认关闭，行为与从前逐字节相同。 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            {t('contextManagement.visionRelay.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {visionRelay === null ? null : (
            <>
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="vision-relay-enabled">{t('contextManagement.visionRelay.enable')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('contextManagement.visionRelay.enableHint')}
                  </p>
                </div>
                <Switch
                  id="vision-relay-enabled"
                  checked={visionRelay.enabled}
                  onCheckedChange={(checked) => setVisionRelay(prev => (prev ? { ...prev, enabled: checked } : prev))}
                />
              </div>

              {visionRelay.enabled && (
                <div className="space-y-4 pt-4 border-t">
                  <div className="space-y-2">
                    <Label htmlFor="vision-relay-reader">{t('contextManagement.visionRelay.reader')}</Label>
                    <Select
                      value={visionRelay.reader ?? '__auto__'}
                      onValueChange={(value) => setVisionRelay(prev => {
                        if (!prev) return prev
                        return value === '__auto__' ? { enabled: prev.enabled, maxImageBytes: prev.maxImageBytes } : { ...prev, reader: value }
                      })}
                    >
                      <SelectTrigger id="vision-relay-reader">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__auto__">{t('contextManagement.visionRelay.readerAuto')}</SelectItem>
                        {relayReaders.map(reader => (
                          <SelectItem key={reader.displayName} value={reader.displayName}>
                            {reader.displayName}
                            {reader.paid === true ? ` (${t('contextManagement.visionRelay.paid')})` : ''}
                          </SelectItem>
                        ))}
                        {visionRelay.reader !== undefined
                          && !relayReaders.some(reader => reader.displayName === visionRelay.reader) && (
                            <SelectItem value={visionRelay.reader}>{visionRelay.reader}</SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t('contextManagement.visionRelay.readerHint')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vision-relay-max-bytes">{t('contextManagement.visionRelay.maxImageBytes')}</Label>
                    <Input
                      id="vision-relay-max-bytes"
                      type="number"
                      min={1}
                      value={Math.round(visionRelay.maxImageBytes / (1024 * 1024))}
                      onChange={(event) => {
                        const mb = Number(event.target.value)
                        if (Number.isFinite(mb) && mb > 0) {
                          setVisionRelay(prev => (prev ? { ...prev, maxImageBytes: Math.floor(mb * 1024 * 1024) } : prev))
                        }
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('contextManagement.visionRelay.maxImageBytesHint')}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t">
                <Button onClick={saveVisionRelay} disabled={relaySaving}>
                  {t('common.save')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
