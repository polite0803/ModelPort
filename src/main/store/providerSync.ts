import type { BuiltinProviderConfig, Provider } from './types'

/**
 * Rebuilds a stored provider record from the shipped builtin config.
 *
 * The id is the authority on builtin-ness: records written before `type` existed,
 * or edited to `custom` by an older build, otherwise never get the shipped fields
 * (which is how one provider can keep a stale model list or lose its sync button
 * while its siblings stay correct).
 */
export function syncBuiltinProvider(provider: Provider, config: BuiltinProviderConfig): Provider {
  return {
    ...provider,
    type: 'builtin',
    apiEndpoint: config.apiEndpoint,
    chatPath: config.chatPath,
    supportedModels: config.supportedModels,
    modelMappings: config.modelMappings,
    modelCapabilities: config.modelCapabilities,
    headers: config.headers,
    credentialFields: config.credentialFields,
    description: config.description,
    supportsModelFetch: Boolean(config.modelsFetch),
  }
}
