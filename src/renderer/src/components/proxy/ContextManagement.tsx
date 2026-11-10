import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { Layers } from 'lucide-react'

interface StrategyConfig {
  slidingWindow: {
    enabled: boolean
    maxMessages: number
  }
  tokenLimit: {
    enabled: boolean
    maxTokens: number
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

export function ContextManagement() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [config, setConfig] = useState<ContextManagementConfigType>({
    enabled: false,
    strategies: {
      slidingWindow: { enabled: true, maxMessages: 20 },
      tokenLimit: { enabled: false, maxTokens: 4000 },
    },
    executionOrder: ['slidingWindow', 'tokenLimit'],
  })

  const [hasChanges, setHasChanges] = useState(false)
  const [channelIdsText, setChannelIdsText] = useState('')

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const contextConfig = await window.electronAPI.contextManagement.getConfig()
      setConfig(contextConfig)
      setChannelIdsText((contextConfig.channelIds ?? []).join(', '))
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
                        <Label htmlFor="max-tokens">{t('contextManagement.tokenLimit.maxTokens')}</Label>
                        <Input
                          id="max-tokens"
                          type="number"
                          min={100}
                          max={100000}
                          value={config.strategies.tokenLimit.maxTokens}
                          onChange={(e) =>
                            handleStrategyChange('tokenLimit', {
                              maxTokens: parseInt(e.target.value) || 4000,
                            })
                          }
                          className="w-32"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('contextManagement.tokenLimit.maxTokensHint')}
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
    </div>
  )
}
