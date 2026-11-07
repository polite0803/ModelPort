import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ProxyConfigForm,
  LoadBalanceConfig,
  ProxyStatus,
  AdvancedConfig,
  SessionManagement,
} from '@/components/proxy'
import { ContextManagement } from '@/components/proxy/ContextManagement'
import { CompressionSettings } from '@/components/proxy/CompressionSettings'
import { PromptCacheSettings } from '@/components/proxy/PromptCacheSettings'
import { AnthropicInboundSettings } from '@/components/proxy/AnthropicInboundSettings'
import ApiKeys from '@/pages/ApiKeys'
import { useProxyStore } from '@/stores/proxyStore'
import { Settings, Scale, Settings2, Key } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

export function ProxySettings() {
  const { t } = useTranslation()
  const { fetchAppConfig, fetchProxyStatus, fetchProxyStatistics } = useProxyStore()
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true

    fetchAppConfig()
    fetchProxyStatus()
    fetchProxyStatistics()
  }, [])

  return (
    <div>
      <PageHeader title={t('proxy.title')} description={t('proxy.description')} />

      <ProxyStatus />

      <Tabs defaultValue="basic" className="mt-6 w-full">
        <TabsList>
          <TabsTrigger value="basic" className="gap-2">
            <Settings className="h-4 w-4" />
            {t('proxy.basicConfig')}
          </TabsTrigger>
          <TabsTrigger value="keys" className="gap-2">
            <Key className="h-4 w-4" />
            {t('apiKeys.title')}
          </TabsTrigger>
          <TabsTrigger value="loadbalance" className="gap-2">
            <Scale className="h-4 w-4" />
            {t('proxy.loadBalancing')}
          </TabsTrigger>
          <TabsTrigger value="advanced" className="gap-2">
            <Settings2 className="h-4 w-4" />
            {t('proxy.advancedConfig')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <ProxyConfigForm />
        </TabsContent>

        <TabsContent value="keys">
          <ApiKeys embedded />
        </TabsContent>

        <TabsContent value="loadbalance">
          <LoadBalanceConfig />
        </TabsContent>

        <TabsContent value="advanced">
          <div className="space-y-6">
            <AdvancedConfig />
            <SessionManagement />
            <ContextManagement />
            <CompressionSettings />
            <PromptCacheSettings />
            <AnthropicInboundSettings />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default ProxySettings
