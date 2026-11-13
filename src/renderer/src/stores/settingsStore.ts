import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppConfig } from '@/types/electron'
import i18n from '@/i18n'
import {
  LEGACY_SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  containsPersistedSecrets,
  pickPersistedPreferences,
  sanitizePersistedSettings,
} from '@shared/persistedSettings'

// 数据迁移（Chat2API → ModelPort）：localStorage key 随品牌改名。旧品牌的这份里可能带着
// 明文凭据，所以搬运前先按偏好白名单收敛一遍 —— 迁移不是清洗的豁免通道。
try {
  const current = localStorage.getItem(SETTINGS_STORAGE_KEY)
  if (current === null) {
    const legacy = localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY)
    if (legacy !== null) {
      const cleaned = sanitizePersistedSettings(legacy)
      if (cleaned !== null) localStorage.setItem(SETTINGS_STORAGE_KEY, cleaned)
      localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY)
    }
  } else if (containsPersistedSecrets(current)) {
    // 升级清洗：历史版本把整个 `config`（含上游 API Key 与管理密钥）写进了浏览器存储。
    // 不主动抹掉，这一份会一直留在 leveldb 里，即使新的写入路径已经不再包含它。
    const cleaned = sanitizePersistedSettings(current)
    if (cleaned !== null) localStorage.setItem(SETTINGS_STORAGE_KEY, cleaned)
    console.warn('[Settings] Removed non-preference keys (including credentials) from persisted settings')
  }
} catch (error) {
  console.warn('[Migration] settings localStorage migration failed:', error)
}

export type Theme = 'light' | 'dark' | 'system'
export type Language = 'zh-CN' | 'en-US'
export type CloseBehavior = 'minimize' | 'close' | 'ask'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type OAuthProxyMode = 'system' | 'none'

interface SettingsState {
  theme: Theme
  setTheme: (theme: Theme) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  proxyEnabled: boolean
  setProxyEnabled: (enabled: boolean) => void
  oauthProxyMode: OAuthProxyMode
  setOauthProxyMode: (mode: OAuthProxyMode) => void
  language: Language
  setLanguage: (language: Language) => void
  autoStart: boolean
  setAutoStart: (enabled: boolean) => void
  autoStartProxy: boolean
  setAutoStartProxy: (enabled: boolean) => void
  minimizeToTray: boolean
  setMinimizeToTray: (enabled: boolean) => void
  closeBehavior: CloseBehavior
  setCloseBehavior: (behavior: CloseBehavior) => void
  enableNotifications: boolean
  setEnableNotifications: (enabled: boolean) => void
  logLevel: LogLevel
  setLogLevel: (level: LogLevel) => void
  logRetentionDays: number
  setLogRetentionDays: (days: number) => void
  maxLogs: number
  setMaxLogs: (count: number) => void
  config: AppConfig | null
  setConfig: (config: AppConfig) => void
  updateConfig: (updates: Partial<AppConfig>) => Promise<void>
  fetchConfig: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      proxyEnabled: false,
      setProxyEnabled: (enabled) => set({ proxyEnabled: enabled }),
      oauthProxyMode: 'system',
      setOauthProxyMode: async (mode) => {
        set({ oauthProxyMode: mode })
        try {
          await window.electronAPI.config.update({ oauthProxyMode: mode })
        } catch (error) {
          console.error('Failed to update oauthProxyMode:', error)
        }
      },
      // 首访跟随浏览器语言检测（i18n 初始化时已同步完成）；硬编码 en-US 会在 rehydrate 时
      // 把检测结果覆盖掉，中文浏览器首访也只见英文。显式选择仍由持久化偏好与网关配置接管。
      language: i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US',
      setLanguage: async (language) => {
        set({ language })
        await i18n.changeLanguage(language)
        try {
          await window.electronAPI.config.update({ language: language })
        } catch (error) {
          console.error('Failed to update language:', error)
        }
      },
      autoStart: false,
      setAutoStart: async (enabled) => {
        set({ autoStart: enabled })
        try {
          await window.electronAPI.config.update({ autoStart: enabled })
        } catch (error) {
          console.error('Failed to update autoStart:', error)
        }
      },
      autoStartProxy: false,
      setAutoStartProxy: async (enabled) => {
        set({ autoStartProxy: enabled })
        try {
          await window.electronAPI.config.update({ autoStartProxy: enabled })
        } catch (error) {
          console.error('Failed to update autoStartProxy:', error)
        }
      },
      minimizeToTray: true,
      setMinimizeToTray: (enabled) => set({ minimizeToTray: enabled }),
      closeBehavior: 'minimize',
      setCloseBehavior: (behavior) => set({ closeBehavior: behavior }),
      enableNotifications: true,
      setEnableNotifications: (enabled) => set({ enableNotifications: enabled }),
      logLevel: 'info',
      setLogLevel: (level) => set({ logLevel: level }),
      logRetentionDays: 30,
      setLogRetentionDays: (days) => set({ logRetentionDays: days }),
      maxLogs: 10000,
      setMaxLogs: (count) => set({ maxLogs: count }),
      config: null,
      setConfig: (config) => set({ config }),
      updateConfig: async (updates) => {
        const currentConfig = get().config
        if (!currentConfig) return
        
        const newConfig = {
          ...currentConfig,
          ...updates,
          requestLogConfig: updates.requestLogConfig
            ? {
                ...currentConfig.requestLogConfig,
                ...updates.requestLogConfig,
              }
            : currentConfig.requestLogConfig,
        }
        set({ config: newConfig })
        
        try {
          await window.electronAPI.config.update(updates)
        } catch (error) {
          console.error('Failed to update config:', error)
          set({ config: currentConfig })
        }
      },
      fetchConfig: async () => {
        try {
          const config = await window.electronAPI.config.get()
          set({ 
            config,
            autoStart: config.autoStart,
            autoStartProxy: config.autoStartProxy,
            oauthProxyMode: config.oauthProxyMode || 'system',
            language: config.language || 'en-US',
          })
        } catch (error) {
          console.error('Failed to fetch config:', error)
        }
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      // 只持久化界面偏好：`config` 是主进程运行期配置的镜像，`fetchConfig()` 随时能重新
      // 取回。把它写进浏览器存储等于把上游 Key 与管理密钥交给 leveldb、备份盘和「导出配置」，
      // 而主进程那份是整文件加密的，这一份没有任何保护层。白名单见 shared/persistedSettings。
      partialize: (state) => pickPersistedPreferences(state),
      onRehydrateStorage: () => (state) => {
        if (state?.language) {
          i18n.changeLanguage(state.language)
        }
      },
    }
  )
)
