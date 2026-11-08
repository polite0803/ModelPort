/**
 * Credential Storage Module - App Config Management API
 * Provides read/write operations for app configuration
 */

import { storeManager } from './store'
import {
  AppConfig,
  LoadBalanceStrategy,
  Theme,
  ModelMapping,
  DEFAULT_CONFIG,
} from './types'
import { validateRoutesForWrite } from './modelRoutes'
import { isLoopbackHost } from '../proxy/authPolicy'
import { validateHttpsConfig } from '../../shared/httpsConfig'
import { maskConfig } from '../logging/maskConfig'

/**
 * Config Manager class
 * Provides all operations related to app configuration
 */
export class ConfigManager {
  /**
   * Get complete configuration
   */
  static get(): AppConfig {
    return storeManager.getConfig()
  }

  /**
   * Update configuration
   * @param updates Configuration items to update
   * @returns Updated complete configuration
   */
  static update(updates: Partial<AppConfig>): AppConfig {
    const updated = storeManager.updateConfig(updates)

    storeManager.addLog('info', 'Update app configuration', {
      // 只记录被改动的键，且值一律过脱敏：整份 config 进日志既噪声大，
      // 又会把 managementApiSecret / apiKeys[].key 这类凭据原样写进日志文件。
      data: { changedKeys: Object.keys(updates), updates: maskConfig(updates) },
    })

    return updated
  }

  /**
   * Reset configuration to default values
   * @returns Default configuration
   */
  static reset(): AppConfig {
    storeManager.resetConfig()
    
    storeManager.addLog('info', 'Reset app configuration to default values')
    
    return DEFAULT_CONFIG
  }

  // ==================== Proxy Configuration ====================

  /**
   * Get proxy port
   */
  static getProxyPort(): number {
    const config = this.get()
    return config.proxyPort
  }

  /**
   * Set proxy port
   * @param port Port number
   */
  static setProxyPort(port: number): void {
    if (port < 1 || port > 65535) {
      throw new Error('Port number must be between 1-65535')
    }
    
    this.update({ proxyPort: port })
  }

  /**
   * Get load balance strategy
   */
  static getLoadBalanceStrategy(): LoadBalanceStrategy {
    const config = this.get()
    return config.loadBalanceStrategy
  }

  /**
   * Set load balance strategy
   * @param strategy Strategy type
   */
  static setLoadBalanceStrategy(strategy: LoadBalanceStrategy): void {
    this.update({ loadBalanceStrategy: strategy })
  }

  // ==================== Model Mapping Configuration ====================

  /**
   * Get all model mappings
   */
  static getModelMappings(): Record<string, ModelMapping> {
    const config = this.get()
    return config.modelMappings
  }

  /**
   * Get mapping config for specified model
   * @param model Model name
   */
  static getModelMapping(model: string): ModelMapping | undefined {
    const mappings = this.getModelMappings()
    return mappings[model]
  }

  /**
   * Add or update model mapping
   * @param mapping Mapping config
   */
  static setModelMapping(mapping: ModelMapping): void {
    const config = this.get()
    const mappings = { ...config.modelMappings }
    mappings[mapping.requestModel] = mapping
    
    this.update({ modelMappings: mappings })
    
    storeManager.addLog('info', `Set model mapping: ${mapping.requestModel} -> ${mapping.actualModel}`)
  }

  /**
   * Delete model mapping
   * @param model Model name
   */
  static removeModelMapping(model: string): boolean {
    const config = this.get()
    const mappings = { ...config.modelMappings }
    
    if (!(model in mappings)) {
      return false
    }
    
    delete mappings[model]
    this.update({ modelMappings: mappings })
    
    storeManager.addLog('info', `Delete model mapping: ${model}`)
    
    return true
  }

  // ==================== UI Configuration ====================

  /**
   * Get theme setting
   */
  static getTheme(): Theme {
    const config = this.get()
    return config.theme
  }

  /**
   * Set theme
   * @param theme Theme type
   */
  static setTheme(theme: Theme): void {
    this.update({ theme })
  }

  /**
   * Get auto-start on boot setting
   */
  static getAutoStart(): boolean {
    const config = this.get()
    return config.autoStart
  }

  /**
   * Set auto-start on boot
   * @param autoStart Whether to auto-start on boot
   */
  static setAutoStart(autoStart: boolean): void {
    this.update({ autoStart })
  }

  /**
   * Get minimize to tray setting
   */
  static getMinimizeToTray(): boolean {
    const config = this.get()
    return config.minimizeToTray
  }

  /**
   * Set minimize to tray
   * @param minimizeToTray Whether to minimize to tray
   */
  static setMinimizeToTray(minimizeToTray: boolean): void {
    this.update({ minimizeToTray })
  }

  // ==================== Log Configuration ====================

  /**
   * Get log level
   */
  static getLogLevel(): 'debug' | 'info' | 'warn' | 'error' {
    const config = this.get()
    return config.logLevel
  }

  /**
   * Set log level
   * @param level Log level
   */
  static setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.update({ logLevel: level })
  }

  /**
   * Get log retention days
   */
  static getLogRetentionDays(): number {
    const config = this.get()
    return config.logRetentionDays
  }

  /**
   * Set log retention days
   * @param days Number of days
   */
  static setLogRetentionDays(days: number): void {
    if (days < 1 || days > 365) {
      throw new Error('Log retention days must be between 1-365')
    }
    
    this.update({ logRetentionDays: days })
  }

  // ==================== Request Configuration ====================

  /**
   * Get request timeout
   */
  static getRequestTimeout(): number {
    const config = this.get()
    return config.requestTimeout
  }

  /**
   * Set request timeout
   * @param timeout Timeout in milliseconds
   */
  static setRequestTimeout(timeout: number): void {
    if (timeout < 1000 || timeout > 300000) {
      throw new Error('Request timeout must be between 1000-300000 milliseconds')
    }
    
    this.update({ requestTimeout: timeout })
  }

  /**
   * Get retry count
   */
  static getRetryCount(): number {
    const config = this.get()
    return config.retryCount
  }

  /**
   * Set retry count
   * @param count Retry count
   */
  static setRetryCount(count: number): void {
    if (count < 0 || count > 10) {
      throw new Error('Retry count must be between 0-10')
    }
    
    this.update({ retryCount: count })
  }

  // ==================== Utility Methods ====================

  /**
   * Validate if configuration is valid
   * @param config Configuration to validate
   * @returns Validation result
   */
  static validate(config: Partial<AppConfig>): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    
    if (config.proxyPort !== undefined) {
      if (config.proxyPort < 1 || config.proxyPort > 65535) {
        errors.push('Proxy port must be between 1-65535')
      }
    }
    
    if (config.logRetentionDays !== undefined) {
      if (config.logRetentionDays < 1 || config.logRetentionDays > 365) {
        errors.push('Log retention days must be between 1-365')
      }
    }

    if (config.proxyHost !== undefined && !isLoopbackHost(config.proxyHost)) {
      errors.push('Proxy host must be 127.0.0.1, ::1 or localhost')
    }

    errors.push(...validateHttpsConfig(config))

    if (config.enableApiKey !== undefined && typeof config.enableApiKey !== 'boolean') {
      errors.push('enableApiKey must be a boolean')
    }

    if (config.apiKeys !== undefined) {
      if (!Array.isArray(config.apiKeys)) {
        errors.push('apiKeys must be an array')
      } else if (config.apiKeys.some((entry) => !entry || typeof entry.key !== 'string' || entry.key.trim().length === 0)) {
        errors.push('apiKeys[].key must be a non-empty string')
      }
    }
    
    if (config.requestTimeout !== undefined) {
      if (config.requestTimeout < 1000 || config.requestTimeout > 300000) {
        errors.push('Request timeout must be between 1000-300000 milliseconds')
      }
    }
    
    if (config.retryCount !== undefined) {
      if (config.retryCount < 0 || config.retryCount > 10) {
        errors.push('Retry count must be between 0-10')
      }
    }

    // routes：这里过去**完全不看**，于是脏表会被读取侧的 `normalizeModelRoutes`
    // **静默丢条目**（键非法、条目不是对象 → 整条消失），用户看到的是一句「保存成功」
    // 和一条不见了的路由。写入侧必须报错，静默丢弃只允许发生在读取侧对付手坏的盘。
    //
    // 校验只复用既有那一个口径 `validateRoutesForWrite`（它与 IPC 的 `routes:*`
    // 共用），里面已经包含 `checkRouteName` 的三条规则（字符集 / routes 内大小写
    // 不敏感唯一 / 与在服模型名、用户别名的冲突）与 `checkPoolStrategyIds` 的池
    // 策略 id 检查；在这里再调一遍 `checkRouteName` 只会造出第二个口径。
    // 它刻意只拒绝**新出现**的名字冲突：已生效的路由不因后来同步进同名模型而写不进去。
    if (config.routes !== undefined) {
      // 存储没起来时这里抛，由调用方（管理 API 的 try/catch）变成 500 + 原因；
      // 不在校验函数里吞掉，否则「表读不到」会被显示成「你的表是空的」。
      errors.push(...validateRoutesForWrite(
        config.routes,
        storeManager.getModelRoutes(),
        storeManager.getRouteNameOccupants()
      ))
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Get configuration diff
   * @param newConfig New configuration
   * @returns Diff from default configuration
   */
  static getDiff(newConfig: Partial<AppConfig>): Partial<AppConfig> {
    const diff: Partial<AppConfig> = {}
    const current = this.get()
    
    for (const key of Object.keys(newConfig) as (keyof AppConfig)[]) {
      if (JSON.stringify(current[key]) !== JSON.stringify(newConfig[key])) {
        (diff as Record<string, unknown>)[key] = newConfig[key]
      }
    }
    
    return diff
  }

  /**
   * Export configuration (for backup)
   */
  static export(): AppConfig {
    return this.get()
  }

  /**
   * Import configuration (for restore)
   * @param config Configuration data
   */
  static import(config: Partial<AppConfig>): { success: boolean; errors: string[] } {
    const validation = this.validate(config)
    
    if (!validation.valid) {
      return { success: false, errors: validation.errors }
    }
    
    this.update(config)
    
    storeManager.addLog('info', 'Import app configuration')
    
    return { success: true, errors: [] }
  }
}

export default ConfigManager
