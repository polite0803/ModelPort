import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AppearanceSettings,
  GeneralSettings,
  DataBackup,
  DataManagement,
  ManagementApiSettings,
  ModelListRefreshSettings,
} from '@/components/settings'
import { About } from '@/pages/About'
import { useSettingsStore } from '@/stores/settingsStore'
import { Settings as SettingsIcon, Shield, Key, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

export function Settings() {
  const { t } = useTranslation()
  const { fetchConfig, setConfig } = useSettingsStore()

  useEffect(() => {
    void fetchConfig()

    const unsubscribe = window.electronAPI?.config?.onConfigChanged?.((config) => {
      setConfig(config)
    })

    return () => {
      unsubscribe?.()
    }
  }, [fetchConfig, setConfig])

  return (
    <div>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />

      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general" className="gap-2">
            <SettingsIcon className="h-4 w-4" />
            {t('settings.general')}
          </TabsTrigger>
          <TabsTrigger value="dataSecurity" className="gap-2">
            <Shield className="h-4 w-4" />
            {t('settings.dataSecurity')}
          </TabsTrigger>
          <TabsTrigger value="managementApi" className="gap-2">
            <Key className="h-4 w-4" />
            {t('settings.managementApi.title')}
          </TabsTrigger>
          <TabsTrigger value="about" className="gap-2">
            <Info className="h-4 w-4" />
            {t('nav.about')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="space-y-6">
            <AppearanceSettings />
            <GeneralSettings />
            <ModelListRefreshSettings />
          </div>
        </TabsContent>

        <TabsContent value="dataSecurity">
          <div className="space-y-6">
            <DataBackup />
            <DataManagement />
          </div>
        </TabsContent>

        <TabsContent value="managementApi">
          <ManagementApiSettings />
        </TabsContent>

        <TabsContent value="about">
          <About />
        </TabsContent>
      </Tabs>
    </div>
  )
}
