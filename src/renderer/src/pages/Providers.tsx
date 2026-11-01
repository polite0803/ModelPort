/**
 * Provider Management Page
 * Integrates all components for CRUD operations on providers and accounts
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/hooks/use-toast'
import { useProvidersStore } from '@/stores/providersStore'
import {
  localAccountCounts,
  mergeChannelCounts,
} from '@/lib/accountCounts'
import {
  ProviderCard,
  AddProviderDialog,
  CustomProviderForm,
  AccountList,
  AddAccountDialog,
  AccountDetail,
  ProviderFilter,
} from '@/components/providers'
import { ModelEditor } from '@/components/models/ModelEditor'
import type { 
  Provider, 
  ProviderStatus, 
  BuiltinProviderConfig,
  CustomProviderFormData,
  Account,
} from '@/types/electron'
import { FilterType, StatusFilter } from '@/components/providers/ProviderFilter'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Server, Plus, RefreshCw, AlertTriangle } from 'lucide-react'

type ViewMode = 'providers' | 'accounts' | 'account-detail'

export function Providers() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const store = useProvidersStore()
  const hasLoadedRef = useRef(false)
  
  const [viewMode, setViewMode] = useState<ViewMode>('providers')
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<FilterType>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  const [showAddProviderDialog, setShowAddProviderDialog] = useState(false)
  const [showCustomProviderForm, setShowCustomProviderForm] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  
  const [showAddAccountDialog, setShowAddAccountDialog] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  
  const [showModelEditor, setShowModelEditor] = useState(false)
  const [modelEditorProvider, setModelEditorProvider] = useState<{ id: string; name: string } | null>(null)

  const [deleteProviderId, setDeleteProviderId] = useState<string | null>(null)

  /**
   * 先把本地表算出来写进 store —— 同步、瞬时，页面不必等渠道 Worker。
   *
   * 渠道（`type: 'account'`）的真实账号在 Worker 里，本地只有一条占位账号；
   * 只照本地表算，卡片就永远是 1/1，与 /channels 页上的「2/2」对不上。所以
   * 这一步只是「先给个不离谱的数」，真正的池内计数由下面那次覆盖。
   */
  const applyLocalAccountCounts = useCallback(() => {
    const { providers, accounts } = useProvidersStore.getState()
    useProvidersStore.getState().setAccountCounts(localAccountCounts(providers, accounts))
  }, [])

  /**
   * 用渠道池的计数覆盖本地那份。
   *
   * 刻意**不**在首屏 `await` 它：Worker 可能还没启动（启动要加载 WASM 与十一个
   * 适配器，还有自己的超时），让供应商列表等它等于把首屏绑在一个后台初始化的
   * 时序上。所以先画本地计数，池子答了再改。
   *
   * 读的是 store 的实时快照（不是闭包里那份）—— 调用点大多刚做完一次
   * `addAccount` / `removeAccount`，拿旧快照会少算或多算一个。
   */
  const refreshAccountCounts = useCallback(async () => {
    const { providers, accounts } = useProvidersStore.getState()
    const local = localAccountCounts(providers, accounts)
    let pool: Record<string, { total: number; enabled: number }> = {}
    // 只有存在渠道供应商时才值得问一次 Worker。
    if (providers.some(provider => provider.type === 'account')) {
      try {
        pool = await window.electronAPI.channels.accountCounts()
      } catch (error) {
        // 读不到池子不是「没有账号」：下面保留本地计数，界面不会凭空掉到 0。
        console.warn('Failed to read channel account counts:', error)
      }
    }
    useProvidersStore.getState().setAccountCounts(mergeChannelCounts(local, providers, pool))
  }, [])

  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    
    const loadInitialData = async () => {
      if (!window.electronAPI?.providers?.getAll) {
        console.log('electronAPI not available')
        useProvidersStore.getState().setIsLoading(false)
        useProvidersStore.getState().setProviders([])
        useProvidersStore.getState().setBuiltinProviders([])
        useProvidersStore.getState().setAccounts([])
        return
      }
      
      try {
        useProvidersStore.getState().setIsLoading(true)
        const [providersData, builtinData, accountsData] = await Promise.all([
          window.electronAPI.providers.getAll(),
          window.electronAPI.providers.getBuiltin(),
          window.electronAPI.accounts.getAll(),
        ])
        
        useProvidersStore.getState().setProviders(providersData)
        useProvidersStore.getState().setBuiltinProviders(builtinData)
        useProvidersStore.getState().setAccounts(accountsData)
        
        const existingStatuses = useProvidersStore.getState().providerStatuses
        const statusMap: Record<string, ProviderStatus> = { ...existingStatuses }
        
        for (const provider of providersData) {
          if (provider.status) {
            statusMap[provider.id] = provider.status
          } else if (!statusMap[provider.id]) {
            statusMap[provider.id] = 'unknown'
          }
        }
        
        useProvidersStore.getState().setProviderStatuses(statusMap)
        // 首屏不等 Worker：先落本地计数，池内计数在后台补上。
        applyLocalAccountCounts()
      } catch (error) {
        console.error('Failed to load providers:', error)
      } finally {
        useProvidersStore.getState().setIsLoading(false)
      }

      // Worker 可能还在冷启动，所以放在 finally 之后单独跑，不阻塞上面的 loading 收尾。
      void refreshAccountCounts()
    }
    
    loadInitialData()
  }, [applyLocalAccountCounts, refreshAccountCounts])

  /**
   * 渠道账号在 Worker 内变化后（登录成功、增删账号、开关账号），池子自己会广播
   * `channels:changed`；这里跟一次，供应商卡片才不用手动刷新页面才更新。
   */
  useEffect(() => {
    if (!window.electronAPI?.channels?.onChanged) return
    const unsubscribe = window.electronAPI.channels.onChanged(() => {
      void refreshAccountCounts()
    })
    return unsubscribe
  }, [refreshAccountCounts])

  const filteredProviders = store.providers.filter((provider) => {
    const matchesSearch = 
      provider.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      provider.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      provider.supportedModels?.some(model => 
        model.toLowerCase().includes(searchQuery.toLowerCase())
      )

    if (!matchesSearch) return false

    switch (typeFilter) {
      case 'builtin':
        if (provider.type !== 'builtin') return false
        break
      case 'custom':
        if (provider.type !== 'custom') return false
        break
      case 'enabled':
        if (!provider.enabled) return false
        break
      case 'disabled':
        if (provider.enabled) return false
        break
    }

    if (statusFilter !== 'all') {
      if (store.providerStatuses[provider.id] !== statusFilter) return false
    }

    return true
  })

  const handleToggleProvider = async (id: string, enabled: boolean) => {
    try {
      await window.electronAPI.providers.update(id, { enabled })
      store.updateProvider(id, { enabled })
      toast({
        title: enabled ? t('providers.enabled') : t('providers.disabled'),
        description: enabled ? t('providers.providerEnabled') : t('providers.providerDisabled'),
      })
    } catch (error) {
      toast({
        title: t('providers.operationFailed'),
        description: t('providers.cannotUpdateProviderStatus'),
        variant: 'destructive',
      })
    }
  }

  const handleEditProvider = (id: string) => {
    const provider = store.providers.find(p => p.id === id)
    if (provider) {
      setEditingProvider(provider)
      setShowCustomProviderForm(true)
    }
  }

  const handleDeleteProvider = async (id: string) => {
    try {
      const success = await window.electronAPI.providers.delete(id)
      if (success) {
        store.removeProvider(id)
        toast({
          title: t('providers.deleteSuccess'),
          description: t('providers.providerDeleted'),
        })
      }
    } catch (error) {
      toast({
        title: t('providers.deleteFailed'),
        description: error instanceof Error ? error.message : t('providers.cannotDeleteProvider'),
        variant: 'destructive',
      })
    }
  }

  const handleConfirmDeleteProvider = async () => {
    if (!deleteProviderId) return
    const id = deleteProviderId
    setDeleteProviderId(null)
    await handleDeleteProvider(id)
  }

  const handleDuplicateProvider = async (id: string) => {
    try {
      const newProvider = await window.electronAPI.providers.duplicate(id)
      store.addProvider(newProvider)
      toast({
        title: t('providers.duplicateSuccess'),
        description: t('providers.providerDuplicated'),
      })
    } catch (error) {
      toast({
        title: t('providers.duplicateFailed'),
        description: t('providers.cannotDuplicateProvider'),
        variant: 'destructive',
      })
    }
  }

  const handleCheckProviderStatus = async (id: string) => {
    try {
      const result = await window.electronAPI.providers.checkStatus(id)
      store.updateProviderStatus(id, result.status)
      // 供应商记录里那份状态快照也一起刷新，别让它一直停在旧值
      store.updateProvider(id, { status: result.status })
      const title = result.status === 'online'
        ? t('providers.providerOnline')
        : result.status === 'unknown'
          ? t('providers.statusUnknown')
          : t('providers.providerOffline')
      const fallback = result.error || `${t('providers.latency')}: ${result.latency}ms`
      const description = result.reason
        ? t(`providers.statusReasons.${result.reason}`, { error: result.error || '', defaultValue: fallback })
        : fallback
      toast({
        title,
        description,
        variant: result.status === 'offline' ? 'destructive' : 'default',
      })
    } catch (error) {
      toast({
        title: t('providers.checkFailed'),
        description: t('providers.cannotCheckProviderStatus'),
        variant: 'destructive',
      })
    }
  }

  const handleCheckAllStatus = async () => {
    setIsRefreshing(true)
    try {
      const statuses = await window.electronAPI.providers.checkAllStatus()
      const newStatusMap: Record<string, ProviderStatus> = {}
      for (const [id, result] of Object.entries(statuses)) {
        newStatusMap[id] = result.status
        // 供应商记录里那份状态快照也一起刷新，别让它一直停在旧值
        store.updateProvider(id, { status: result.status })
      }
      store.setProviderStatuses(newStatusMap)
      toast({
        title: t('providers.statusRefreshed'),
        description: `${t('providers.onlineCount')}: ${Object.values(newStatusMap).filter(s => s === 'online').length} / ${store.providers.length}`,
      })
    } catch (error) {
      toast({
        title: t('providers.refreshFailed'),
        description: t('providers.cannotRefreshProviderStatus'),
        variant: 'destructive',
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleUpdateModels = async (providerId: string) => {
    toast({
      title: t('providers.updatingModels'),
      description: t('providers.updatingModels'),
    })

    try {
      const result = await window.electronAPI.providers.updateModels?.(providerId)

      if (!result) {
        toast({
          title: t('providers.updateModelsFailed'),
          description: t('common.error'),
          variant: 'destructive',
        })
        return
      }

      if (result.success) {
        const providers = await window.electronAPI.providers.getAll()
        useProvidersStore.getState().setProviders(providers)
        const summary = result.addedCount
          ? t('providers.updateModelsCountDesc', {
              fetched: result.fetchedCount ?? 0,
              added: result.addedCount,
            })
          : t('providers.updateModelsNoChangeDesc', { fetched: result.fetchedCount ?? 0 })
        toast({
          title: t('providers.updateModelsSuccess'),
          description: result.detail ? `${summary} ${result.detail}` : summary,
        })
        return
      }

      const failureDescriptions: Record<string, string> = {
        unsupported: t('providers.updateModelsNotSupported'),
        no_active_account: t('providers.updateModelsNoAccountDesc'),
        missing_credential_field: t('providers.updateModelsMissingFieldDesc', { detail: result.detail ?? '' }),
        http_status: t('providers.updateModelsHttpStatusDesc', { detail: result.detail ?? '' }),
        empty: t('providers.updateModelsEmptyDesc'),
        unrecognized_shape: t('providers.updateModelsShapeDesc', { detail: result.detail ?? '' }),
        network_error: t('providers.updateModelsNetworkDesc', { detail: result.detail ?? '' }),
        // 聚合同步特有：端点拒绝全部 Key（401/403），细节里带尝试过的 Key 数
        invalid_api_key: t('providers.updateModelsInvalidKeyDesc', { detail: result.detail ?? '' }),
      }

      toast({
        title: t('providers.updateModelsFailed'),
        description:
          failureDescriptions[result.reason ?? 'network_error'] ?? t('providers.updateModelsFailed'),
        variant: 'destructive',
      })
    } catch (error) {
      console.error('Failed to update models:', error)
      toast({
        title: t('providers.updateModelsFailed'),
        description: t('common.error'),
        variant: 'destructive',
      })
    }
  }

  const handleManageModels = (providerId: string) => {
    const provider = store.providers.find(p => p.id === providerId)
    if (provider) {
      setModelEditorProvider({ id: provider.id, name: provider.name })
      setShowModelEditor(true)
    }
  }

  const handleManageAccounts = (providerId: string) => {
    store.setSelectedProviderId(providerId)
    setViewMode('accounts')
  }

  const handleSelectBuiltinProvider = async (provider: BuiltinProviderConfig, credentials: Record<string, string>) => {
    let targetProvider = store.providers.find(p => p.id === provider.id)
    
    if (!targetProvider) {
      const newProvider = await window.electronAPI.providers.add({
        id: provider.id,
        name: provider.name,
        type: 'builtin',
        authType: provider.authType,
        apiEndpoint: provider.apiEndpoint,
        headers: provider.headers,
        description: provider.description,
        supportedModels: provider.supportedModels,
        credentialFields: provider.credentialFields,
      })
      store.addProvider(newProvider)
      targetProvider = newProvider
    }
    
    if (credentials && Object.keys(credentials).length > 0) {
      const account = await window.electronAPI.accounts.add({
        providerId: targetProvider.id,
        name: `${provider.name} ${t('providers.accounts')}`,
        credentials: credentials,
      })
      store.addAccount(account)
    }

    // 无凭据的内置供应商（OpenCode）由主进程建一个本地账号，渲染层要把它读回来，
    // 否则卡片上永远是 0 个账号，看着像没接上
    const providerAccounts = await window.electronAPI.accounts.getByProvider(targetProvider.id)
    const knownAccountIds = new Set(store.getAccountsByProvider(targetProvider.id).map(a => a.id))
    for (const account of providerAccounts) {
      if (!knownAccountIds.has(account.id)) {
        store.addAccount(account)
      }
    }
    applyLocalAccountCounts()
    void refreshAccountCounts()

    setShowAddProviderDialog(false)
    toast({
      title: t('providers.addSuccess'),
      description: `${provider.name} ${t('providers.accounts')} ${t('providers.accountAdded')}`,
    })
  }

  const handleCreateCustomProvider = () => {
    setShowAddProviderDialog(false)
    setShowCustomProviderForm(true)
  }

  const handleCustomProviderFormSubmit = async (data: CustomProviderFormData) => {
    try {
      if (editingProvider) {
        const updated = await window.electronAPI.providers.update(editingProvider.id, {
          name: data.name,
          authType: data.authType,
          apiEndpoint: data.apiEndpoint,
          headers: data.headers,
          description: data.description,
          supportedModels: data.supportedModels,
        })
        if (updated) {
          store.updateProvider(editingProvider.id, updated)
          toast({
            title: t('providers.updateSuccess'),
            description: t('providers.providerConfigUpdated'),
          })
        }
      } else {
        const newProvider = await window.electronAPI.providers.add({
          name: data.name,
          authType: data.authType,
          apiEndpoint: data.apiEndpoint,
          headers: data.headers,
          description: data.description,
          supportedModels: data.supportedModels,
          credentialFields: data.credentialFields,
        })
        store.addProvider(newProvider)
        toast({
          title: t('providers.createSuccess'),
          description: t('providers.customProviderCreated'),
        })
      }
      setShowCustomProviderForm(false)
      setEditingProvider(null)
    } catch (error) {
      toast({
        title: editingProvider ? t('providers.updateFailed') : t('providers.createFailed'),
        description: error instanceof Error ? error.message : t('providers.operationFailed'),
        variant: 'destructive',
      })
    }
  }

  const handleAddAccount = async (data: {
    name: string
    email?: string
    credentials: Record<string, string>
    dailyLimit?: number
  }) => {
    if (!store.selectedProviderId) return
    
    try {
      const account = await window.electronAPI.accounts.add({
        providerId: store.selectedProviderId,
        name: data.name,
        email: data.email,
        credentials: data.credentials,
        dailyLimit: data.dailyLimit,
      })
      store.addAccount(account)
      
      applyLocalAccountCounts()
      void refreshAccountCounts()
      
      setShowAddAccountDialog(false)
      toast({
        title: t('providers.addSuccess'),
        description: t('providers.accountAdded'),
      })
    } catch (error) {
      toast({
        title: t('providers.addFailed'),
        description: error instanceof Error ? error.message : t('providers.cannotAddAccount'),
        variant: 'destructive',
      })
    }
  }

  const handleUpdateAccount = async (id: string, updates: Partial<Account>) => {
    try {
      const account = store.getAccountById(id)
      if (!account) return
      
      const updated = await window.electronAPI.accounts.update(id, updates)
      if (updated) {
        store.updateAccount(id, updates)
        
        applyLocalAccountCounts()
        void refreshAccountCounts()
        
        toast({
          title: t('providers.updateSuccess'),
          description: t('providers.accountUpdated'),
        })
      }
    } catch (error) {
      toast({
        title: t('providers.updateFailed'),
        description: error instanceof Error ? error.message : t('providers.operationFailed'),
        variant: 'destructive',
      })
    }
  }

  const handleDeleteAccount = async (id: string) => {
    try {
      const success = await window.electronAPI.accounts.delete(id)
      if (success) {
        store.removeAccount(id)
        
        applyLocalAccountCounts()
        void refreshAccountCounts()
        
        toast({
          title: t('providers.deleteSuccess'),
          description: t('providers.accountDeleted'),
        })
      }
    } catch (error) {
      toast({
        title: t('providers.deleteFailed'),
        description: error instanceof Error ? error.message : t('providers.operationFailed'),
        variant: 'destructive',
      })
    }
  }

  const handleValidateAccount = async (id: string) => {
    try {
      const isValid = await window.electronAPI.accounts.validate(id)
      if (isValid) {
        store.updateAccount(id, { status: 'active' })
        
        applyLocalAccountCounts()
        void refreshAccountCounts()
        
        toast({
          title: t('providers.validateSuccess'),
          description: t('providers.credentialsValid'),
        })
      } else {
        store.updateAccount(id, { status: 'error', errorMessage: t('providers.validateFailed') })
        
        applyLocalAccountCounts()
        void refreshAccountCounts()
        
        toast({
          title: t('providers.validateFailed'),
          description: t('providers.credentialsInvalid'),
          variant: 'destructive',
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('providers.operationFailed')
      store.updateAccount(id, { status: 'error', errorMessage })
      
      applyLocalAccountCounts()
      void refreshAccountCounts()
      
      toast({
        title: t('providers.validateFailed'),
        description: errorMessage,
        variant: 'destructive',
      })
    }
  }

  const handleValidateToken = async (providerId: string, credentials: Record<string, string>) => {
    return await window.electronAPI.accounts.validateToken(providerId, credentials)
  }

  const handleViewAccountDetail = (account: Account) => {
    store.setSelectedAccountId(account.id)
    setViewMode('account-detail')
  }

  const handleBackToProviders = () => {
    setViewMode('providers')
    store.setSelectedProviderId(null)
    store.setSelectedAccountId(null)
  }

  const handleBackToAccounts = () => {
    setViewMode('accounts')
    store.setSelectedAccountId(null)
  }

  const stats = {
    total: store.providers.length,
    builtin: store.providers.filter(p => p.type === 'builtin').length,
    custom: store.providers.filter(p => p.type === 'custom').length,
    enabled: store.providers.filter(p => p.enabled).length,
    online: Object.values(store.providerStatuses).filter(s => s === 'online').length,
  }

  if (store.isLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="text-muted-foreground">{t('providers.loading')}</div>
      </div>
    )
  }

  const selectedProvider = store.selectedProviderId 
    ? store.getProviderById(store.selectedProviderId) 
    : null

  const selectedAccount = store.selectedAccountId 
    ? store.getAccountById(store.selectedAccountId) 
    : null

  const providerAccounts = store.selectedProviderId 
    ? store.getAccountsByProvider(store.selectedProviderId) 
    : []

  if (viewMode === 'account-detail' && selectedAccount && selectedProvider) {
    return (
      <div className="space-y-6">
        <AccountDetail
          account={selectedAccount}
          provider={selectedProvider}
          onBack={handleBackToAccounts}
          onEdit={async () => {
            // 不再向主进程要明文凭据：编辑框用空值 + 「留空 = 不修改」表达这一层，
            // 真实 Key 只在主进程内部解密使用。
            const fullAccount = await window.electronAPI.accounts.getById(selectedAccount.id)
            setEditingAccount(fullAccount || selectedAccount)
            setViewMode('accounts')
            setShowAddAccountDialog(true)
          }}
          onDelete={() => handleDeleteAccount(selectedAccount.id)}
          onValidate={() => handleValidateAccount(selectedAccount.id)}
        />
      </div>
    )
  }

  if (viewMode === 'accounts' && selectedProvider) {
    return (
      <div>
        <PageHeader
          title={`${selectedProvider.name} · ${t('providers.accountManagement')}`}
          description={t('providers.manageAllAccounts')}
          onBack={handleBackToProviders}
          backLabel={t('providers.backToProviderList')}
        />

        <AccountList
          accounts={providerAccounts}
          onAddAccount={() => setShowAddAccountDialog(true)}
          onEditAccount={async (account) => {
            // 同上：编辑框不再预填真实凭据。
            const fullAccount = await window.electronAPI.accounts.getById(account.id)
            setEditingAccount(fullAccount || account)
            setShowAddAccountDialog(true)
          }}
          onDeleteAccount={handleDeleteAccount}
          onValidateAccount={handleValidateAccount}
          onViewDetail={handleViewAccountDetail}
        />

        <AddAccountDialog
          open={showAddAccountDialog}
          onOpenChange={(open) => {
            setShowAddAccountDialog(open)
            if (!open) setEditingAccount(null)
          }}
          provider={selectedProvider}
          onAddAccount={handleAddAccount}
          onValidateToken={handleValidateToken}
          editingAccount={editingAccount}
          onUpdateAccount={handleUpdateAccount}
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={t('providers.title')}
        description={t('providers.subtitle')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleCheckAllStatus} disabled={isRefreshing}>
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
              {t('providers.checkStatus')}
            </Button>
            <Button size="sm" onClick={() => setShowAddProviderDialog(true)}>
              <Plus className="h-4 w-4" />
              {t('providers.addProvider')}
            </Button>
          </>
        }
      />

      <ProviderFilter
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        stats={stats}
      />

      {filteredProviders.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Server className="h-5 w-5" />
            </div>
            <p className="empty-state-title">{t('providers.noProvidersFound')}</p>
            <p className="empty-state-hint">
              {searchQuery || typeFilter !== 'all' || statusFilter !== 'all'
                ? t('providers.tryAdjustingFilters')
                : t('providers.clickToAddProvider')}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredProviders.map((provider) => (
            <ProviderCard
                key={provider.id}
                provider={provider}
                status={store.providerStatuses[provider.id]}
                accountCount={store.accountCounts[provider.id]?.total || 0}
                activeAccountCount={store.accountCounts[provider.id]?.active || 0}
                onToggle={handleToggleProvider}
                onEdit={handleEditProvider}
                onDelete={(id) => setDeleteProviderId(id)}
                onDuplicate={handleDuplicateProvider}
                onCheckStatus={handleCheckProviderStatus}
                onManageAccounts={handleManageAccounts}
                onUpdateModels={handleUpdateModels}
                onManageModels={handleManageModels}
              />
            ))}
        </div>
      )}

      <Dialog
        open={deleteProviderId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteProviderId(null)
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[var(--warning)]" />
              {t('providers.deleteProvider')}
            </DialogTitle>
            <DialogDescription>{t('providers.confirmDelete')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteProviderId(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteProvider}>
              {t('providers.deleteProvider')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddProviderDialog
        open={showAddProviderDialog}
        onOpenChange={setShowAddProviderDialog}
        builtinProviders={store.builtinProviders}
        onSelectBuiltin={handleSelectBuiltinProvider}
        onCreateCustom={handleCreateCustomProvider}
        onValidateToken={handleValidateToken}
      />

      <CustomProviderForm
        open={showCustomProviderForm}
        onOpenChange={(open) => {
          setShowCustomProviderForm(open)
          if (!open) setEditingProvider(null)
        }}
        onSubmit={handleCustomProviderFormSubmit}
        initialData={editingProvider ? {
          name: editingProvider.name,
          authType: editingProvider.authType,
          apiEndpoint: editingProvider.apiEndpoint,
          headers: editingProvider.headers,
          description: editingProvider.description || '',
          supportedModels: editingProvider.supportedModels || [],
        } : undefined}
      />

      {modelEditorProvider && (
        <ModelEditor
          open={showModelEditor}
          onOpenChange={(open) => {
            setShowModelEditor(open)
            if (!open) setModelEditorProvider(null)
          }}
          providerId={modelEditorProvider.id}
          providerName={modelEditorProvider.name}
        />
      )}
    </div>
  )
}

export default Providers
