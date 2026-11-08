/**
 * Proxy Service Module - Model Mapper
 *
 * The global alias table (`config.modelMappings`) is user data: a rename, a
 * provider/account pin, or a stopped alias. Catalogue wiring lives in each
 * provider's own `modelMappings` ledger and is read by the load balancer and by
 * `getEffectiveModels` — never copied into the alias table.
 */

import { storeManager } from '../store/store'
import { derivePreferredProvider, isMappingActive } from '../store/modelServing'

/**
 * Model mapper
 */
export class ModelMapper {
  /**
   * Get preferred provider for a model.
   *
   * A user alias decides on its own — including "no pin", which is the fan-out
   * answer — so derivation only runs when the table has no row for the name.
   * A stopped alias answers `undefined` like it always did: stopping a name is a
   * name-domain decision, and it must not be overruled by the provider ledger.
   */
  getPreferredProvider(requestedModel: string): string | undefined {
    const mapping = storeManager.getConfig().modelMappings[requestedModel]
    if (mapping !== undefined) {
      return isMappingActive(mapping) ? mapping.preferredProviderId : undefined
    }
    return derivePreferredProvider(requestedModel, storeManager.getProviders())
  }

  /**
   * Get preferred account for a model
   */
  getPreferredAccount(requestedModel: string): string | undefined {
    const config = storeManager.getConfig()
    const mapping = config.modelMappings[requestedModel]

    return isMappingActive(mapping) ? mapping.preferredAccountId : undefined
  }
}

export const modelMapper = new ModelMapper()
export default modelMapper
