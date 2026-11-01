import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useProxyStore } from '@/stores/proxyStore'
import { useToast } from '@/hooks/use-toast'
import { Server, AlertCircle, RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ProxyConfigFormProps {
  onConfigChange?: () => void
}

interface FormErrors {
  port?: string
  host?: string
}

export function ProxyConfigForm({ onConfigChange }: ProxyConfigFormProps) {
  const { t } = useTranslation()
  const { proxyConfig, proxyStatus, setProxyConfig, saveAppConfig, startProxy, stopProxy, fetchProxyStatus, isLoading } = useProxyStore()
  const { toast } = useToast()

  const initialConfigRef = useRef({
    port: proxyConfig.port.toString(),
    host: proxyConfig.host,
  })

  const [formData, setFormData] = useState({
    port: proxyConfig.port.toString(),
    host: proxyConfig.host,
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [hasChanges, setHasChanges] = useState(false)
  const [showRestartDialog, setShowRestartDialog] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)

  useEffect(() => {
    const newFormData = {
      port: proxyConfig.port.toString(),
      host: proxyConfig.host,
    }
    setFormData(newFormData)
    initialConfigRef.current = newFormData
  }, [])

  const validatePort = (value: string): string | undefined => {
    const port = parseInt(value, 10)
    if (isNaN(port)) return t('proxy.portMustBeNumber')
    if (port < 1 || port > 65535) return t('proxy.portRangeError')
    if (port < 1024 && port !== 80 && port !== 443) {
      return t('proxy.portPrivilege')
    }
    return undefined
  }

  const validateHost = (value: string): string | undefined => {
    if (!value.trim()) return t('proxy.bindAddressEmpty')
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
    const ipv6Regex = /^\[?[0-9a-fA-F:]+\]?$/
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
    
    if (!ipv4Regex.test(value) && !ipv6Regex.test(value) && !hostnameRegex.test(value) && value !== 'localhost') {
      return t('proxy.invalidIpOrHostname')
    }
    return undefined
  }

  // 跨域策略不由这里配置：`AppConfig` 里没有 CORS 字段，服务端的判定（`proxy/authPolicy.ts`
  // 的 `resolveCorsOrigin`）只回显回环来源，公网 Origin 拿不到 `Access-Control-Allow-Origin`。
  // 以前这两个控件写进的是渲染层 store，用户关掉后本次会话看起来收紧了，重启回到默认，
  // 服务端行为从未变过 —— 一个不起作用的开关比没有开关更糟，所以撤下。

  const handlePortChange = (value: string) => {
    setFormData(prev => ({ ...prev, port: value }))
    const error = validatePort(value)
    setErrors(prev => ({ ...prev, port: error }))
    setHasChanges(true)
    onConfigChange?.()
  }

  const handleHostChange = (value: string) => {
    setFormData(prev => ({ ...prev, host: value }))
    const error = validateHost(value)
    setErrors(prev => ({ ...prev, host: error }))
    setHasChanges(true)
    onConfigChange?.()
  }

  const handleSave = async () => {
    const portError = validatePort(formData.port)
    const hostError = validateHost(formData.host)

    if (portError || hostError) {
      setErrors({
        port: portError,
        host: hostError,
      })
      toast({
        title: t('proxy.validationFailed'),
        description: t('proxy.fixFormErrors'),
        variant: 'destructive',
      })
      return
    }

    const newPort = parseInt(formData.port, 10)
    const newHost = formData.host
    const portOrHostChanged = newPort !== proxyConfig.port || newHost !== proxyConfig.host
    const isProxyRunning = proxyStatus?.isRunning

    if (portOrHostChanged && isProxyRunning) {
      setShowRestartDialog(true)
      return
    }

    await performSave(newPort, newHost)
  }

  const performSave = async (newPort: number, newHost: string): Promise<boolean> => {
    const previous = { port: proxyConfig.port, host: proxyConfig.host }
    setProxyConfig({ port: newPort, host: newHost })

    const success = await saveAppConfig({ proxyPort: newPort, proxyHost: newHost })

    if (success) {
      setHasChanges(false)
      initialConfigRef.current = { port: newPort.toString(), host: newHost }
      toast({
        title: t('common.success'),
        description: t('proxy.proxyConfigUpdated'),
      })
      return true
    }

    // 保存失败就退回界面原值：留着新值，界面显示的就是一个盘上并不存在的端口，
    // 用户会拿着它去连客户端。
    setProxyConfig(previous)
    toast({
      title: t('common.error'),
      description: t('proxy.configSaveFailed'),
      variant: 'destructive',
    })
    return false
  }

  const handleRestartAndSave = async () => {
    setIsRestarting(true)
    try {
      const newPort = parseInt(formData.port, 10)
      const newHost = formData.host

      const saved = await performSave(newPort, newHost)
      if (!saved) return

      await stopProxy()
      await waitForProxyToStop()

      const success = await startProxy(newPort)

      if (success) {
        toast({
          title: t('common.success'),
          description: t('proxy.proxyRestarted'),
        })
      } else {
        toast({
          title: t('common.error'),
          description: t('proxy.proxyRestartFailed'),
          variant: 'destructive',
        })
      }
    } finally {
      setIsRestarting(false)
      setShowRestartDialog(false)
    }
  }

  /**
   * 等端口真正释放，而不是固定等 500ms。慢机器、防火墙弹窗、上游连接未收尾时，
   * 500ms 到点就 start 会撞「端口仍被占用」，界面于是停在「已停止」而配置已是新的。
   */
  const waitForProxyToStop = async (timeoutMs = 3000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await fetchProxyStatus()
      if (!useProxyStore.getState().proxyStatus?.isRunning) return
    }
  }

  const handleReset = () => {
    setFormData(initialConfigRef.current)
    setErrors({})
    setHasChanges(false)
  }

  const isValid = !errors.port && !errors.host

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-[15px] w-[15px] text-[var(--text-muted)]" />
              <CardTitle>{t('proxy.basicConfig')}</CardTitle>
            </div>
            {hasChanges && (
              <Badge variant="secondary" className="text-xs">
                {t('proxy.unsaved')}
              </Badge>
            )}
          </div>
          <CardDescription>{t('proxy.basicConfigDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="port" className="flex items-center gap-2">
                {t('proxy.listeningPort')}
                {errors.port && (
                  <span className="text-destructive text-caption flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.port}
                  </span>
                )}
              </Label>
              <Input
                id="port"
                type="number"
                placeholder="8080"
                value={formData.port}
                onChange={(e) => handlePortChange(e.target.value)}
                className={errors.port ? 'border-destructive' : ''}
              />
              <p className="text-xs text-muted-foreground">
                {t('proxy.portRange')}
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="host" className="flex items-center gap-2">
                {t('proxy.bindAddress')}
                {errors.host && (
                  <span className="text-destructive text-caption flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.host}
                  </span>
                )}
              </Label>
              <Input
                id="host"
                placeholder="127.0.0.1"
                value={formData.host}
                onChange={(e) => handleHostChange(e.target.value)}
                className={errors.host ? 'border-destructive' : ''}
              />
              <p className="text-xs text-muted-foreground">
                {t('proxy.bindAddressHelp')}
              </p>
            </div>
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
              disabled={!hasChanges || !isValid || isLoading}
            >
              {isLoading ? t('proxy.saving') : t('proxy.saveConfig')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showRestartDialog} onOpenChange={setShowRestartDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('proxy.restartRequired')}</DialogTitle>
            <DialogDescription>
              {t('proxy.restartRequiredDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowRestartDialog(false)}
              disabled={isRestarting}
            >
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={handleRestartAndSave}
              disabled={isRestarting}
            >
              {isRestarting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('proxy.restarting')}
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('proxy.restartNow')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default ProxyConfigForm
