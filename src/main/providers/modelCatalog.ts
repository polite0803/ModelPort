/**
 * Provider Model Catalog
 * Fetches a provider's model list from its own site using the declarative
 * modelsFetch config on the built-in provider.
 */

import axios from 'axios'
import { randomUUID } from 'crypto'
import { getBuiltinProvider } from './builtin/index.ts'
import { resolveModelListSource } from './modelListSource.ts'
import { readModelList } from './modelListReaders'
import { buildAuthHeaders, buildRequestBody, buildRequestUrl } from './modelListRequest'
import { storeManager } from '../store/store'
import type { ModelsFetchResult } from '../store/types'

const TIMEOUT_MS = 15000

export async function fetchProviderModels(providerId: string): Promise<ModelsFetchResult> {
  const config = getBuiltinProvider(providerId)
  const source = resolveModelListSource(config)

  if (!config || source === 'unsupported') {
    return {
      ok: false,
      reason: 'unsupported',
      detail: config
        ? `provider ${providerId} declares no modelsFetch source`
        : `provider ${providerId} is not a built-in provider`,
    }
  }

  const fetchConfig = config.modelsFetch

  if (!fetchConfig) {
    return {
      ok: false,
      reason: 'unsupported',
      detail: `provider ${providerId} declares no modelsFetch`,
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(config.headers || {}),
    ...(fetchConfig.headers || {}),
  }

  const authRules = fetchConfig.auth || []
  if (authRules.length > 0) {
    const activeAccount = storeManager
      .getAccountsByProviderId(config.id)
      .find(account => account.status === 'active')

    if (!activeAccount) {
      return { ok: false, reason: 'no_active_account' }
    }

    const built = buildAuthHeaders(authRules, activeAccount.credentials)
    if (!built.ok) {
      // Field names only; never the values
      return { ok: false, reason: 'missing_credential_field', detail: built.missingFields.join(', ') }
    }

    Object.assign(headers, built.headers)
  }

  const uuid = randomUUID()
  const url = buildRequestUrl(fetchConfig.url, uuid)
  const body = buildRequestBody(fetchConfig.body, uuid)
  const request = { headers, timeout: TIMEOUT_MS, validateStatus: () => true }

  try {
    const response =
      fetchConfig.method === 'POST'
        ? await axios.post(url, body, request)
        : await axios.get(url, request)

    if (response.status !== 200) {
      return { ok: false, reason: 'http_status', detail: `HTTP ${response.status}` }
    }

    return readModelList(response.data, fetchConfig.reader ?? 'auto')
  } catch (error) {
    return {
      ok: false,
      reason: 'network_error',
      detail: error instanceof Error ? error.message : 'request failed',
    }
  }
}
