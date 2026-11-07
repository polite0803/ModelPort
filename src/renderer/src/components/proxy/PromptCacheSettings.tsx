/**
 * Prompt-cache settings.
 *
 * This switch only governs explicit breakpoint injection (Anthropic Messages).
 * Providers that cache implicitly — DeepSeek and OpenAI-compatible endpoints —
 * need no marker, so this panel says so instead of pretending to control them.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { Database } from 'lucide-react'
import type { PromptCachingConfig } from '@shared/promptCache'

export function PromptCacheSettings() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [config, setConfig] = useState<PromptCachingConfig | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    void loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const appConfig = await window.electronAPI.config.get()
      setConfig(appConfig?.promptCaching ?? null)
    } catch (error) {
      console.error('Failed to load prompt cache config:', error)
      setConfig(null)
    }
  }

  const handleChange = (updates: Partial<PromptCachingConfig>) => {
    if (config === null) return
    setConfig({ ...config, ...updates })
    setHasChanges(true)
  }

  const saveConfig = async () => {
    if (config === null) return
    try {
      await window.electronAPI.config.update({ promptCaching: config })
      setHasChanges(false)
      toast({ title: t('common.success'), description: t('promptCaching.configSaved') })
    } catch (error) {
      console.error('Failed to save prompt cache config:', error)
      toast({
        title: t('common.error'),
        description: t('promptCaching.configSaveFailed'),
        variant: 'destructive',
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          {t('promptCaching.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {config === null ? (
          <p className="p-4 text-sm text-muted-foreground rounded-lg bg-muted/30">
            {t('promptCaching.loading')}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="prompt-cache-enabled">{t('promptCaching.enable')}</Label>
                <p className="text-sm text-muted-foreground">{t('promptCaching.enableHint')}</p>
              </div>
              <Switch
                id="prompt-cache-enabled"
                checked={config.enabled}
                onCheckedChange={checked => handleChange({ enabled: checked })}
              />
            </div>

            {config.enabled && (
              <div className="space-y-3 pt-4 border-t">
                <div className="space-y-0.5">
                  <Label>{t('promptCaching.ttl')}</Label>
                  <p className="text-sm text-muted-foreground">{t('promptCaching.ttlHint')}</p>
                </div>
                <div className="flex gap-2">
                  {(['5m', '1h'] as const).map(ttl => (
                    <Button
                      key={ttl}
                      type="button"
                      variant={config.anthropicTtl === ttl ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleChange({ anthropicTtl: ttl })}
                    >
                      {t(`promptCaching.ttlOption.${ttl}`)}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-caption text-[var(--text-dim)]">{t('promptCaching.note')}</p>

            {hasChanges && (
              <div className="flex justify-end">
                <Button onClick={() => void saveConfig()}>{t('common.save')}</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
