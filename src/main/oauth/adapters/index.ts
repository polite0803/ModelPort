/**
 * OAuth Adapter Index
 *
 * 现在没有任何供应商走宿主授权流：OpenCode 的适配器随本机运行时一起退役，
 * 网页登录型供应商更早之前就已退役。工厂与查询函数保留成扩展点——
 * 授权 IPC 面（`OAUTH_*`）与渲染层调用方还在，等新供应商接进来时直接加 case。
 */

export { BaseOAuthAdapter } from './base'
import { BaseOAuthAdapter } from './base'
import { ProviderType, AdapterConfig } from '../types'

/**
 * Adapter factory function
 */
export function createAdapter(
  providerType: ProviderType,
  config: AdapterConfig
): BaseOAuthAdapter {
  switch (providerType) {
    default:
      throw new Error(`Unsupported provider type: ${providerType}`)
  }
}

/**
 * Get supported authentication methods for provider
 */
export function getSupportedAuthMethods(_providerType: ProviderType): string[] {
  return ['manual']
}
