/**
 * Aggregate provider manager.
 *
 * The catalogue ships as data (see `registry.ts`); a provider record is only
 * created once the user saves a key or a key-less endpoint, keeping the
 * provider list free of 70+ unusable rows. Aggregate records are `type:
 * 'aggregate'`, which startup leaves untouched (it only repairs builtins) and
 * which the parameter policy passes through unchanged.
 */

import axios from 'axios'
import {
  AGGREGATE_REGISTRY,
  getAggregateEntry,
  aggregateAuthHeader,
  aggregateChatPath,
  aggregateModelName,
} from './registry'
import { readModelList } from '../modelListReaders'
import { MODELS_DEV_URL, listModelsDevModels, planSyncModelIds } from '../../../shared/modelsDev'
import { aggregateCostOf } from '../../../shared/aggregateCost.ts'
import AccountManager from '../../store/accounts'
import { storeManager } from '../../store/store'
import type { Account, ModelMapping, Provider } from '../../store/types'
import type { FetchedModel } from '../../../shared/types'
import type {
  AggregateDetail,
  AggregateEntry,
  AggregateEntryState,
  AggregateKeyInfo,
  AggregateListResult,
  AggregateModelInfo,
  AggregateModelParams,
  AggregateModelTestResult,
  AggregateMutationResult,
  AggregateOperationResult,
  AggregateQuotaUsage,
  AggregateSaveInput,
} from '../../../shared/aggregate'
import { normalizeAggregateKeys, normalizeAggregateModelParams, mergeAggregateModelIds } from '../../../shared/aggregate'
import type { AggregateQuotaProbe } from '../../../shared/aggregate'
import type {
  AggregateCreditKeyRow,
  AggregateCreditQueryFailure,
  AggregateCreditQueryResult,
  AggregateCreditReading,
} from '../../../shared/aggregateCredit'
import { CREDIT_QUERY_KEY_CAP } from '../../../shared/aggregateCredit'
import { buildCreditSnapshot, creditUnitOfReader, parseQuotaProbe } from './quotaProbe'

const PROBE_TIMEOUT_MS = 20000
/** 单模型测试是一次真实补全，给推理型模型留出余量。 */
const MODEL_TEST_TIMEOUT_MS = 30000

/** Key 的展示掩码：首 5 位 + 尾 4 位，短 Key 只留前 2 位。 */
function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 10) return `${key.slice(0, 2)}••••`
  return `${key.slice(0, 5)}••••${key.slice(-4)}`
}

/** 用户可能粘贴带 `<entry>/` 前缀的显示名，统一还原成上游模型 id。 */
function normalizeModelId(entryId: string, modelId: string): string {
  const raw = (modelId ?? '').trim()
  const prefix = `${entryId}/`
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
}

/** 上游错误体的可读摘要；没有就返回空串，避免拼出 "HTTP 400undefined"。 */
function errorMessageOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const error = (data as { error?: unknown }).error
  if (typeof error === 'string') return ` - ${error}`
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return ` - ${message}`
  }
  const message = (data as { message?: unknown }).message
  return typeof message === 'string' && message ? ` - ${message}` : ''
}

/**
 * 把文本里出现过的密钥字面量换成掩码。
 * 失败详情（HTTP 正文摘要、axios 的报错句）都要进界面和日志，所以脱敏必须在
 * 它们被拼出来的这一刻做，而不是等调用方记得处理。
 */
function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  return secrets.reduce<string>(
    (acc, secret) => (secret && secret.length >= 4 ? acc.split(secret).join('••••') : acc),
    text
  )
}

/**
 * 目录里换过 host 的条目：记录里仍指向旧地址的，迁到当前目录地址。
 * 只在 baseUrl 精确等于旧目录地址时改写，用户自己改过地址的记录一律不动。
 */
const RETIRED_BASE_URLS: Record<string, string> = {
  'https://apihub.agnes-ai.com/v1': 'https://api.agnes-ai.cn/v1',
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

function isUsableBaseUrl(baseUrl: string): boolean {
  if (!baseUrl) return false
  if (baseUrl.includes('{')) return false
  return /^https?:\/\//i.test(baseUrl)
}

class AggregateProviderManager {
  list(): AggregateListResult {
    this.repairRetiredBaseUrls()
    const states: Record<string, AggregateEntryState> = {}
    const quotaUsage: Record<string, AggregateQuotaUsage> = {}
    for (const entry of AGGREGATE_REGISTRY) {
      states[entry.id] = this.getState(entry)
      const usage = this.usageOf(entry.id)
      if (usage) quotaUsage[entry.id] = usage
    }
    return { entries: AGGREGATE_REGISTRY, states, quotaUsage }
  }

  /**
   * 把仍指向已退役 host 的聚合记录迁到目录当前地址。幂等：迁过之后不再命中，
   * 所以页面每次打开都调用也不会反复写盘。
   */
  private repairRetiredBaseUrls(): void {
    for (const provider of storeManager.getProviders()) {
      if (provider.type !== 'aggregate') continue
      const next = RETIRED_BASE_URLS[trimmed(provider.apiEndpoint)]
      if (!next) continue
      storeManager.updateProvider(provider.id, { apiEndpoint: next, updatedAt: Date.now() })
    }
  }

  /**
   * 本应用账本里这一家的用量。聚合每家通常只有一把 Key，出现多把时取用量最高的那把，
   * 所以这个数字回答的是"至少有一把到了这个数"，不是所有 Key 的合计。
   */
  private usageOf(providerId: string): AggregateQuotaUsage | null {
    const accounts = AccountManager.getByProviderId(providerId, false)
    if (accounts.length === 0) return null

    try {
      const ledger = storeManager.getQuotaLedger()
      const snapshots = accounts.map(account => ledger.providerSnapshot(providerId, account.id))
      const highest = (key: keyof AggregateQuotaUsage): number =>
        snapshots.reduce((max, snapshot) => Math.max(max, snapshot[key]), 0)

      return {
        rpm: highest('rpm'),
        rpd: highest('rpd'),
        tpm: highest('tpm'),
        tpd: highest('tpd'),
        monthlyTokens: highest('monthlyTokens'),
      }
    } catch (error) {
      console.error('[Aggregate] quota usage unavailable:', error)
      return null
    }
  }

  getState(entry: AggregateEntry): AggregateEntryState {
    const provider = storeManager.getProviderById(entry.id)
    if (!provider || provider.type !== 'aggregate') {
      return {
        configured: false,
        enabled: false,
        hasApiKey: false,
        apiKeyCount: 0,
        baseUrl: entry.baseUrl,
        modelCount: entry.models.length,
      }
    }

    return {
      configured: true,
      enabled: provider.enabled,
      hasApiKey: entry.authKind === 'apiKey'
        ? AccountManager.getByProviderId(entry.id, true).some(a => Boolean(a.credentials.apiKey))
        : false,
      apiKeyCount: entry.authKind === 'apiKey'
        ? AccountManager.getByProviderId(entry.id, true).filter(a => Boolean(a.credentials.apiKey)).length
        : 0,
      baseUrl: provider.apiEndpoint,
      modelCount: provider.supportedModels?.length ?? 0,
      // 配置对话框的清单初值必须来自记录本身：用目录当初值的话，
      // 一次普通的"改 Key 保存"就会把在线同步来的模型再退回旧目录。
      modelIds: Object.values(provider.modelMappings ?? {}),
      ...(provider.modelParameters && Object.keys(provider.modelParameters).length > 0
        ? { modelParameters: { ...provider.modelParameters } }
        : {}),
    }
  }

  /**
   * Creates or updates the provider record for a catalogue entry and stores the
   * keys. Throws on invalid input; the IPC layer turns the message into a UI
   * failure rather than a half-written record.
   */
  save(input: AggregateSaveInput): Provider {
    const entry = getAggregateEntry(input.id)
    if (!entry) throw new Error('unknown_entry')
    if (entry.authKind === 'unsupported') throw new Error('unsupported_auth')

    const baseUrl = trimmed(input.baseUrl ?? entry.baseUrl)
    if (!baseUrl) throw new Error('missing_base_url')
    if (baseUrl.includes('{')) throw new Error('placeholder_base_url')
    if (!isUsableBaseUrl(baseUrl)) throw new Error('invalid_base_url')

    const existing = storeManager.getProviderById(entry.id)
    // 没给 Key（或只给了空列表）= 沿用已存的那组；给了非空列表 = 整组替换。
    const keyList = normalizeAggregateKeys(input)
    if (entry.authKind === 'apiKey' && (keyList === undefined || keyList.length === 0) && !this.hasStoredKey(entry.id)) {
      throw new Error('missing_api_key')
    }

    const rawModels = (input.models && input.models.length > 0 ? input.models : entry.models.map(model => model.id))
      .map(id => id.trim())
      .filter(id => id.length > 0)
    // 显式给出的清单就是权威的：在线同步会带来目录之外的新模型，手改的 id 也应当
    // 原样生效（打错会在请求时以上游 4xx 暴露出来），而不是被静态目录静默吞掉。
    // 目录只在完全没给清单时作为默认值。
    const models = [...new Set(rawModels)]

    const supportedModels = models.map(id => aggregateModelName(entry.id, id))
    const modelMappings: Record<string, string> = {}
    models.forEach((id, index) => {
      modelMappings[supportedModels[index]] = id
    })

    // 每模型参数：本次给了就用本次的（显式清空 = {}），没给就沿用旧的；
    // 无论来源，都按最终模型清单裁剪，模型被移除后参数不会变成孤儿。
    const modelParameters = normalizeAggregateModelParams(
      (input.modelParams ?? existing?.modelParameters) as Record<string, AggregateModelParams> | undefined,
      new Set(models)
    )

    const auth = aggregateAuthHeader(entry)
    const now = Date.now()
    const record: Provider = {
      id: entry.id,
      name: entry.name,
      type: 'aggregate',
      authType: 'token',
      apiEndpoint: baseUrl,
      chatPath: aggregateChatPath(entry),
      headers: {
        'Content-Type': 'application/json',
        ...(entry.headers || {}),
      },
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      description: entry.notes,
      supportedModels,
      modelMappings,
      credentialFields: entry.authKind === 'apiKey'
        ? [{
            name: 'apiKey',
            label: 'API Key',
            type: 'password',
            required: true,
            placeholder: entry.envVar || 'Enter API Key',
            helpText: entry.authUrl,
          }]
        : [],
      // 聚合条目都能在线同步：目录给了 modelsUrl 就用它，没给就按通用约定请求
      // `<baseUrl>/models`（见 probe）。
      supportsModelFetch: true,
      aggregateId: entry.id,
      wire: entry.wire,
      authHeader: auth.header,
      authPrefix: auth.prefix,
      ...(Object.keys(modelParameters).length > 0 ? { modelParameters } : {}),
    }

    if (existing) {
      storeManager.updateProvider(entry.id, record)
    } else {
      storeManager.addProvider(record)
    }

    if (entry.authKind === 'none') {
      this.ensureLocalAccount(entry.id, entry.name)
    } else if (keyList && keyList.length > 0) {
      this.writeKeys(entry.id, entry.name, keyList)
    }

    this.writeMappings(entry.id, modelMappings)
    return storeManager.getProviderById(entry.id) ?? record
  }

  setEnabled(id: string, enabled: boolean): Provider {
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') throw new Error('not_configured')
    const updated = storeManager.updateProvider(id, { enabled, updatedAt: Date.now() })
    if (!updated) throw new Error('not_configured')
    return updated
  }

  remove(id: string): void {
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') return
    for (const account of AccountManager.getByProviderId(id, true)) {
      AccountManager.delete(account.id)
    }
    storeManager.deleteProvider(id)
    // 记录都没了，那次"问过余额"的读数也不该继续影响路由。
    storeManager.deleteAggregateCreditSnapshot(id)
    this.writeMappings(id, {})
    // 用户显式删除的免验证条目记入黑名单：自动开通不再复活它。
    // 只对真正标了 autoProvision 的条目落盘，普通条目不因此多写一次配置。
    if (getAggregateEntry(id)?.autoProvision) {
      const dismissed = new Set(storeManager.getConfig().dismissedAutoProviders ?? [])
      if (!dismissed.has(id)) {
        dismissed.add(id)
        storeManager.updateConfig({ dismissedAutoProviders: [...dismissed] })
      }
    }
  }

  /**
   * 启动期自动开通免验证条目（autoProvision 且 authKind 'none'）：没有记录的
   * 直接建记录并启用 —— 免 key 本就无凭据可填，静态目录先行兜底 —— 随后并入
   * 上游模型清单。只在首次创建时同步一次清单，之后尊重用户裁剪（删除/停用某
   * 些模型不会被下次启动偷偷加回来，想要刷新走面板上的在线同步）。用户删过的
   * 条目在黑名单里，绝不复活。全程失败只告警，不阻塞启动。
   */
  async autoProvisionKeyless(): Promise<void> {
    let dismissed: Set<string>
    try {
      dismissed = new Set(storeManager.getConfig().dismissedAutoProviders ?? [])
    } catch {
      return // 存储不可用：什么都做不了，也不要往启动路径上抛错
    }
    for (const entry of AGGREGATE_REGISTRY) {
      if (entry.authKind !== 'none' || !entry.autoProvision || dismissed.has(entry.id)) continue
      try {
        const existing = storeManager.getProviderById(entry.id)
        if (existing && existing.type === 'aggregate') continue
        this.save({ id: entry.id, enabled: true })
        console.log(`[Aggregate] auto-provisioned keyless entry: ${entry.id}`)
        const synced = await this.syncModels(entry.id)
        if (!synced.success) {
          console.warn(`[Aggregate] auto sync skipped for ${entry.id}: ${synced.reason ?? 'unknown'}`)
        }
      } catch (error) {
        console.warn(
          `[Aggregate] auto-provision failed for ${entry.id}:`,
          error instanceof Error ? error.message : error
        )
      }
    }
  }

  /** Probes the catalogue's model list and reports what the endpoint answered. */
  async test(id: string): Promise<AggregateOperationResult> {
    const entry = getAggregateEntry(id)
    if (!entry) return { success: false, reason: 'unknown_entry' }
    this.repairRetiredBaseUrls()
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') {
      return { success: false, reason: 'not_configured' }
    }

    const probe = await this.probe(entry, provider)
    if (!probe.ok) return probe.result
    return { success: true, modelCount: probe.models.length }
  }

  /**
   * 在线同步模型清单：带 Key 轮换探测上游清单，把上游报告的模型**并入**当前暴露清单。
   * 只增不减 —— 用户裁剪过的清单、每模型参数、账号与 Key 都不会被一次同步抹掉。
   * 新模型（包括静态目录之外的新 id）拿到 `<entryId>/<id>` 显示名并进入路由映射，
   * 这就是"在有效 Key 支持下同步获取有效模型"。
   */
  async syncModels(id: string): Promise<AggregateOperationResult> {
    const entry = getAggregateEntry(id)
    if (!entry) return { success: false, reason: 'unknown_entry' }
    this.repairRetiredBaseUrls()
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') {
      return { success: false, reason: 'not_configured' }
    }

    const probe = await this.probe(entry, provider)

    // 上游清单读不到时退到 models.dev：它按同一个条目 id 聚合厂商的模型元数据，
    // 于是"这家没有 /models 端点"或"探测被 401 挡下"不再等于"无法同步"。
    // 判定本身在 `planSyncModelIds` 里：探测成功但返回空**不是**可降级条件。
    const fallback = probe.ok ? null : await this.fetchModelsDevModels(entry.id)
    const plan = planSyncModelIds({
      upstream: probe.ok ? probe.models : null,
      modelsDev: fallback,
    })
    if (!probe.ok && plan.source === 'none') return probe.result

    const fetchedIds = plan.ids
    if (fetchedIds.length === 0) return { success: false, reason: 'empty' }

    const currentIds = Object.values(provider.modelMappings ?? {})
    const merged = mergeAggregateModelIds(currentIds, fetchedIds)
    const currentSet = new Set(currentIds)
    const addedCount = merged.filter(modelId => !currentSet.has(modelId)).length

    if (addedCount > 0) {
      try {
        this.save({ id, baseUrl: provider.apiEndpoint, models: merged, enabled: provider.enabled })
      } catch (error) {
        return { success: false, reason: 'save_failed', detail: error instanceof Error ? error.message : String(error) }
      }
    }

    return {
      success: true,
      fetchedCount: fetchedIds.length,
      addedCount,
      modelCount: merged.length,
      // 面板要能说出"这份清单是上游答的，还是第三方目录补的"。
      ...(plan.source === 'upstream' ? { modelSource: 'upstream' as const } : { modelSource: 'models.dev' as const }),
    }
  }

  /**
   * 详情面板的一次读取：条目状态、已存 Key（掩码）、模型目录（含停用标记与
   * 每模型参数）以及本应用账本计量。目录里没配置的条目也返回一份空壳，
   * 让右侧面板能显示"尚未添加"的引导，而不是整页空白。
   */
  detail(id: string): AggregateDetail | null {
    const entry = getAggregateEntry(id)
    if (!entry) return null
    this.repairRetiredBaseUrls()

    const state = this.getState(entry)
    const quotaUsage = this.usageOf(id) ?? undefined
    const provider = storeManager.getProviderById(id)
    // 上一次手点出来的余额读数（可能已过期）。它只是"带过去显示"，不参与五态徽章的判定。
    const credit = storeManager.getAggregateCreditSnapshot(id)
    if (!provider || provider.type !== 'aggregate') {
      return {
        entryId: id,
        state,
        keys: [],
        models: [],
        ...(quotaUsage ? { quotaUsage } : {}),
        ...(credit ? { credit } : {}),
      }
    }

    const models: AggregateModelInfo[] = storeManager.getModelCatalogue(id).map(row => {
      const params = provider.modelParameters?.[row.actualModelId]
      return {
        id: row.actualModelId,
        displayName: row.displayName,
        served: row.served,
        source: row.source,
        // 消耗分类统一由 shared/aggregateCost 判定，界面只渲染，不自己从价格推。
        cost: aggregateCostOf({
          entryId: id,
          modelId: row.actualModelId,
          ...(entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}),
        }),
        ...(params ? { params: { ...params } } : {}),
      }
    })

    return {
      entryId: id,
      state,
      keys: this.listKeys(id),
      models,
      ...(quotaUsage ? { quotaUsage } : {}),
      ...(credit ? { credit } : {}),
    }
  }

  /**
   * 新增一把 Key。先带着这把 Key 探测一次模型清单：端点拒绝就不落库，
   * 免得用户在列表里看到一把永远 401 的 Key。重复的 Key 直接视为成功。
   */
  async addKey(id: string, apiKey: string): Promise<AggregateMutationResult> {
    const entry = getAggregateEntry(id)
    if (!entry) return { success: false, reason: 'unknown_entry' }
    if (entry.authKind !== 'apiKey') return { success: false, reason: 'keyless_entry' }
    this.repairRetiredBaseUrls()
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') return { success: false, reason: 'not_configured' }

    const key = apiKey.trim()
    if (!key) return { success: false, reason: 'missing_api_key' }

    const stored = AccountManager.getByProviderId(id, true).find(account => account.credentials.apiKey === key)
    if (stored) {
      if (stored.status !== 'active') {
        AccountManager.update(stored.id, { status: 'active', errorMessage: undefined })
      }
      return { success: true, detail: this.detail(id) ?? undefined }
    }

    const probe = await this.probeKey(entry, provider, key)
    if (probe.kind === 'auth') {
      return { success: false, reason: 'invalid_api_key', message: probe.detail }
    }

    const keyCount = this.listKeys(id).length
    AccountManager.create({
      providerId: id,
      name: `${entry.name} key ${keyCount + 1}`,
      credentials: { apiKey: key },
    })
    return { success: true, detail: this.detail(id) ?? undefined }
  }

  /** 删除一把 Key；账号与它的用量计数一并移除，Key 之间互不影响。 */
  removeKey(accountId: string): AggregateMutationResult {
    const account = AccountManager.getById(accountId, false)
    if (!account) return { success: false, reason: 'unknown_account' }
    const provider = storeManager.getProviderById(account.providerId)
    if (!provider || provider.type !== 'aggregate') return { success: false, reason: 'not_configured' }
    AccountManager.delete(accountId)
    return { success: true, detail: this.detail(account.providerId) ?? undefined }
  }

  /** 启用 / 停用一把 Key（停用后不再被负载均衡选中）。 */
  setKeyEnabled(accountId: string, enabled: boolean): AggregateMutationResult {
    const account = AccountManager.getById(accountId, false)
    if (!account) return { success: false, reason: 'unknown_account' }
    const provider = storeManager.getProviderById(account.providerId)
    if (!provider || provider.type !== 'aggregate') return { success: false, reason: 'not_configured' }
    AccountManager.update(accountId, {
      status: enabled ? 'active' : 'inactive',
      ...(enabled ? { errorMessage: undefined } : {}),
    })
    return { success: true, detail: this.detail(account.providerId) ?? undefined }
  }

  /** 用真实请求复查一把已存 Key，并把结果写回账号状态。 */
  async validateKey(id: string, accountId: string): Promise<AggregateMutationResult> {
    const entry = getAggregateEntry(id)
    if (!entry) return { success: false, reason: 'unknown_entry' }
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') return { success: false, reason: 'not_configured' }
    const account = AccountManager.getById(accountId, true)
    if (!account || account.providerId !== id) return { success: false, reason: 'unknown_account' }
    const key = account.credentials.apiKey
    if (!key) return { success: false, reason: 'missing_api_key' }

    const probe = await this.probeKey(entry, provider, key)
    if (probe.kind === 'ok' || probe.kind === 'http') {
      AccountManager.update(accountId, { status: 'active', errorMessage: undefined, lastStatusCheck: Date.now() })
      return { success: true, detail: this.detail(id) ?? undefined }
    }

    AccountManager.update(accountId, {
      status: 'error',
      errorMessage: probe.detail,
      lastStatusCheck: Date.now(),
    })
    return {
      success: false,
      reason: probe.kind === 'auth' ? 'invalid_api_key' : 'network_error',
      message: probe.detail,
      detail: this.detail(id) ?? undefined,
    }
  }

  /** 手动新增一个上游模型；显示名与全局映射由 save 统一写入。 */
  addModel(id: string, modelId: string): AggregateMutationResult {
    const entry = getAggregateEntry(id)
    if (!entry) return { success: false, reason: 'unknown_entry' }
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') return { success: false, reason: 'not_configured' }

    const raw = normalizeModelId(id, modelId)
    if (!raw) return { success: false, reason: 'missing_model' }

    const current = this.currentUpstreamIds(provider)
    if (current.includes(raw)) return { success: true, detail: this.detail(id) ?? undefined }

    try {
      this.save({ id, models: [...current, raw], baseUrl: provider.apiEndpoint, enabled: provider.enabled })
      // 手动添回来的模型应当立即可用：清掉它可能残留的停用标记。
      storeManager.setModelsServed(id, [aggregateModelName(id, raw)], true)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
    return { success: true, detail: this.detail(id) ?? undefined }
  }

  /**
   * 删除一个模型。目录至少保留一个：清空的聚合记录会被 `providerSupportsModel`
   * 当作通配供应商，把所有模型名都吞掉，所以最后一个模型不允许删。
   */
  removeModel(id: string, modelId: string): AggregateMutationResult {
    const entry = getAggregateEntry(id)
    if (!entry) return { success: false, reason: 'unknown_entry' }
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') return { success: false, reason: 'not_configured' }

    const raw = normalizeModelId(id, modelId)
    const current = this.currentUpstreamIds(provider)
    if (!current.includes(raw)) return { success: false, reason: 'unknown_model' }
    if (current.length <= 1) return { success: false, reason: 'last_model' }

    try {
      this.save({
        id,
        models: current.filter(model => model !== raw),
        baseUrl: provider.apiEndpoint,
        enabled: provider.enabled,
      })
      // 删除的模型不应把停用标记留给未来重新添加的同名模型。
      storeManager.setModelsServed(id, [aggregateModelName(id, raw)], true)
    } catch (error) {
      return { success: false, reason: 'save_failed', message: error instanceof Error ? error.message : String(error) }
    }
    return { success: true, detail: this.detail(id) ?? undefined }
  }

  /**
   * 启用 / 停用一个模型。停用走 `setModelsServed`（excludedModels），
   * 模型仍留在目录里、参数也保留，只是不再出现在 /v1/models 与路由里。
   */
  setModelEnabled(id: string, modelId: string, enabled: boolean): AggregateMutationResult {
    const entry = getAggregateEntry(id)
    if (!entry) return { success: false, reason: 'unknown_entry' }
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') return { success: false, reason: 'not_configured' }

    const displayName = aggregateModelName(id, normalizeModelId(id, modelId))
    const known = storeManager.getModelCatalogue(id).some(row => row.displayName === displayName)
    if (!known) return { success: false, reason: 'unknown_model' }

    storeManager.setModelsServed(id, [displayName], enabled)
    return { success: true, detail: this.detail(id) ?? undefined }
  }

  /** 写入（或清除）一个模型的请求参数覆盖，返回刷新后的面板数据。 */
  setModelParams(id: string, modelId: string, params: Record<string, unknown>): AggregateMutationResult {
    const entry = getAggregateEntry(id)
    if (!entry) return { success: false, reason: 'unknown_entry' }
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') return { success: false, reason: 'not_configured' }

    const raw = normalizeModelId(id, modelId)
    if (!this.currentUpstreamIds(provider).includes(raw)) return { success: false, reason: 'unknown_model' }

    const normalized = normalizeAggregateModelParams({ [raw]: params }, new Set([raw]))[raw]
    const next: Record<string, AggregateModelParams> = { ...(provider.modelParameters ?? {}) }
    if (normalized) next[raw] = normalized
    else delete next[raw]

    storeManager.updateProvider(id, { modelParameters: next, updatedAt: Date.now() })
    return { success: true, detail: this.detail(id) ?? undefined }
  }

  /**
   * 用一次最小真实请求测试单个模型：返回可用与否和延迟。Keyed 条目在
   * 401/403/429 时换下一把 Key 再试，其余失败直接如实返回。
   */
  async testModel(id: string, modelId: string): Promise<AggregateModelTestResult> {
    const entry = getAggregateEntry(id)
    if (!entry) return { success: false, reason: 'unknown_entry' }
    this.repairRetiredBaseUrls()
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') return { success: false, reason: 'not_configured' }

    const raw = normalizeModelId(id, modelId)
    if (!this.currentUpstreamIds(provider).includes(raw)) return { success: false, reason: 'unknown_model' }

    const accounts = entry.authKind === 'apiKey'
      ? AccountManager.getByProviderId(id, true).filter(account => Boolean(account.credentials.apiKey))
      : []
    if (entry.authKind === 'apiKey' && accounts.length === 0) {
      return { success: false, reason: 'missing_api_key' }
    }
    const candidates: (Account | undefined)[] = entry.authKind === 'apiKey' ? accounts : [undefined]

    const url = `${trimmed(provider.apiEndpoint)}${aggregateChatPath(entry)}`
    let lastFailure: AggregateModelTestResult | null = null

    for (const account of candidates) {
      const startedAt = Date.now()
      try {
        const headers = this.buildChatHeaders(entry, provider, account)
        // GATEWAY-TEXT: liveness-ping — 目录存活探测，不进任何用户对话（`ddc566a` 2026-10-30）。
        const body = entry.wire === 'anthropic-messages'
          ? { model: raw, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
          : { model: raw, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }

        const response = await axios.post(url, body, {
          headers,
          timeout: MODEL_TEST_TIMEOUT_MS,
          validateStatus: () => true,
        })
        const latencyMs = Date.now() - startedAt

        if (response.status >= 200 && response.status < 300) {
          return { success: true, latencyMs }
        }

        lastFailure = {
          success: false,
          reason: response.status === 401 || response.status === 403 ? 'invalid_api_key' : 'http_status',
          detail: `HTTP ${response.status}${errorMessageOf(response.data)}`,
          latencyMs,
        }
        if (response.status === 401 || response.status === 403 || response.status === 429) continue
        return lastFailure
      } catch (error) {
        return {
          success: false,
          reason: 'network_error',
          detail: error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - startedAt,
        }
      }
    }

    return lastFailure ?? { success: false, reason: 'network_error' }
  }

  /**
   * 查询账号级实时额度（美元 / 人民币余额）。
   *
   * 触发方式只有一种：聚合详情页上那一个按钮。没有周期轮询、没有开页自动发，
   * 所以这里的每一次出网都是用户此刻明确要求的。
   *
   * 三条实现约束：
   * - **URL 跟着用户配的 base 走**：基址取记录里的 `apiEndpoint`，拼目录声明的相对
   *   `quotaProbe.path`。聊天流量去哪个 host，额度查询就去哪个 host；转录来的那个
   *   `.com` 是否成立，也只在这一处体现，不会和另写的主机名分家。
   * - **鉴权复用既有通路**：`buildProbeHeaders`（Keyed 条目从账号表取 `credentials.apiKey`），
   *   不新建任何凭据路径。Key 不进返回值、不进日志，报文摘要与错误详情都先脱敏。
   * - **解析层不在这个文件里**：形状判断全部在 `./quotaProbe.ts`（纯函数，不碰网络也不写盘），
   *   所以"猜错字段"这件事只会以 `unexpected-shape` 的形式出现在界面上。
   */
  async queryCredits(id: string): Promise<AggregateCreditQueryResult> {
    const asOf = new Date().toISOString()
    const stopped = (kind: AggregateCreditQueryFailure): AggregateCreditQueryResult => ({
      entryId: id,
      asOf,
      ok: false,
      failure: kind,
      rows: [],
      accounts: 0,
      skipped: 0,
    })

    const entry = getAggregateEntry(id)
    if (!entry) return stopped('unknown_entry')
    const probe = entry.quotaProbe
    if (!probe) return stopped('no_probe')

    this.repairRetiredBaseUrls()
    const provider = storeManager.getProviderById(id)
    if (!provider || provider.type !== 'aggregate') return stopped('not_configured')

    const accounts = entry.authKind === 'apiKey'
      ? AccountManager.getByProviderId(id, true).filter(account => Boolean(account.credentials.apiKey))
      : []
    if (accounts.length === 0) return stopped('missing_api_key')

    // 超过上限只查前 N 把，并把"其余没查"如实带回去：静默截断会让面板显示成"全部都查过了"。
    const attempts = accounts.slice(0, CREDIT_QUERY_KEY_CAP)
    const skipped = accounts.length - attempts.length
    const path = probe.path.startsWith('/') ? probe.path : `/${probe.path}`
    const url = `${trimmed(provider.apiEndpoint)}${path}`

    const rows: AggregateCreditKeyRow[] = []
    for (const account of attempts) {
      const key = account.credentials.apiKey
      rows.push({
        keyId: account.id,
        keyName: account.name,
        maskedKey: maskKey(key),
        reading: await this.readCreditAt(url, entry, provider, probe, key),
      })
    }

    const snapshot = buildCreditSnapshot({
      asOf,
      unit: creditUnitOfReader(probe.reader),
      rows,
      accounts: attempts.length,
      skipped,
    })

    // 只在"尝试过的每一把都问出了可比较的数"时落盘：问得不全时留着上一行，
    // 面板继续按它自己的 `asOf` 显示并标过期，绝不把旧数当现值、也不把旧数抹成 0。
    if (snapshot.ok) storeManager.setAggregateCreditSnapshot(id, snapshot)

    return {
      entryId: id,
      asOf,
      ok: snapshot.ok,
      ...(snapshot.ok ? {} : { reason: snapshot.reason }),
      rows,
      accounts: attempts.length,
      skipped,
      ...(snapshot.ok ? { snapshot } : {}),
      docUrl: probe.docUrl,
      probeAsOf: probe.asOf,
    }
  }

  /** 一把 Key 的一次额度查询：状态码分类与解析都在外面判，这里只管出网和脱敏。 */
  private async readCreditAt(
    url: string,
    entry: AggregateEntry,
    provider: Provider,
    probe: AggregateQuotaProbe,
    apiKey: string,
  ): Promise<AggregateCreditReading> {
    try {
      const response = await axios.get(url, {
        headers: this.buildProbeHeaders(entry, provider, apiKey),
        timeout: PROBE_TIMEOUT_MS,
        validateStatus: () => true,
      })
      if (response.status >= 400) {
        // 状态码不是"余额为 0"：它只是上游拒绝了这一次询问。
        // 上游原话（SiliconFlow 的 `Token is invalid.`、OpenRouter 的 error.message）要一起带回去，
        // 否则界面只能说"上游拒绝了这次查询"，用户分不清"这把 Key 无效"和"端点被墙"。
        // 与 testModel 同一套 errorMessageOf；先脱敏再拼，401 正文可能反射请求里的 Key。
        return {
          ok: false,
          reason: 'http-status',
          detail: redactSecrets(`HTTP ${response.status}${errorMessageOf(response.data)}`, [apiKey]),
        }
      }
      return parseQuotaProbe(probe.reader, response.data, [apiKey])
    } catch (error) {
      return {
        ok: false,
        reason: 'network',
        detail: redactSecrets(error instanceof Error ? error.message : String(error), [apiKey]),
      }
    }
  }

  /** 从 models.dev 取某一家的聊天模型。任何失败都返回 null（不是空数组），
   * 调用方据此保留原来的 typed failure，不会把"读不到"说成"这家没有模型"。
   */
  private async fetchModelsDevModels(entryId: string): Promise<FetchedModel[] | null> {
    try {
      const response = await axios.get(MODELS_DEV_URL, {
        timeout: PROBE_TIMEOUT_MS,
        validateStatus: () => true,
      })
      if (response.status >= 400) return null

      const models = listModelsDevModels(response.data, entryId)
      return models.length > 0 ? models : null
    } catch (error) {
      console.warn('[Aggregate] models.dev unavailable:', error instanceof Error ? error.message : error)
      return null
    }
  }

  private hasStoredKey(id: string): boolean {
    return AccountManager.getByProviderId(id, true).some(account => Boolean(account.credentials.apiKey))
  }

  /**
   * Reconciles the stored keyed accounts with `keyList`, so one account holds
   * one key and the load balancer rotates across all of them. Keys that
   * survive keep their account (and its usage counters); removed keys lose
   * their account; new keys get fresh ones.
   */
  private writeKeys(providerId: string, providerName: string, keyList: string[]): void {
    const existing = AccountManager.getByProviderId(providerId, true)
    const matched = new Set<string>()

    keyList.forEach((apiKey, index) => {
      const hit = existing.find(account => account.credentials.apiKey === apiKey)
      if (hit) {
        matched.add(hit.id)
        if (hit.status !== 'active') {
          AccountManager.update(hit.id, { status: 'active', errorMessage: undefined })
        }
        return
      }
      AccountManager.create({
        providerId,
        name: `${providerName} key ${index + 1}`,
        credentials: { apiKey },
      })
    })

    for (const account of existing) {
      if (!matched.has(account.id)) {
        AccountManager.delete(account.id)
      }
    }
  }

  private ensureLocalAccount(providerId: string, providerName: string): void {
    const existing = AccountManager.getByProviderId(providerId, false)
    if (existing.length > 0) return
    AccountManager.create({
      providerId,
      name: `${providerName} (keyless)`,
      credentials: {},
    })
  }

  /**
   * Rewrites the global model mappings owned by this provider. Existing entries
   * under the same `preferredProviderId` that are not in the new set are
   * dropped, so removing or replacing a catalogue never leaves stale names.
   */
  private writeMappings(providerId: string, mappings: Record<string, string>): void {
    const config = storeManager.getConfig()
    const next: Record<string, ModelMapping> = {}
    for (const [requestModel, mapping] of Object.entries(config.modelMappings || {})) {
      if (mapping.preferredProviderId !== providerId) next[requestModel] = mapping
    }
    for (const [requestModel, actualModel] of Object.entries(mappings)) {
      next[requestModel] = { requestModel, actualModel, preferredProviderId: providerId }
    }
    storeManager.updateConfig({ modelMappings: next })
  }

  private buildProbeHeaders(entry: AggregateEntry, provider: Provider, apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...provider.headers,
    }
    if (apiKey) {
      const auth = aggregateAuthHeader(entry)
      headers[auth.header] = `${auth.prefix}${apiKey}`
    }
    if (entry.wire === 'anthropic-messages') {
      headers['anthropic-version'] = provider.headers?.['anthropic-version'] || '2023-06-01'
    }
    return headers
  }

  /** 聊天请求头：探测头 + JSON 内容类型，Keyed 条目带上指定账号的 Key。 */
  private buildChatHeaders(entry: AggregateEntry, provider: Provider, account?: Account): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.buildProbeHeaders(entry, provider, account?.credentials.apiKey),
    }
  }

  /** 已存 Key 的展示列表：密钥只以掩码出现，状态与最近使用时间照实给出。 */
  private listKeys(providerId: string): AggregateKeyInfo[] {
    return AccountManager.getByProviderId(providerId, true)
      .filter(account => Boolean(account.credentials.apiKey))
      .map(account => ({
        id: account.id,
        name: account.name,
        maskedKey: maskKey(account.credentials.apiKey),
        status: account.status,
        createdAt: account.createdAt,
        ...(account.lastUsed ? { lastUsed: account.lastUsed } : {}),
        ...(account.errorMessage ? { errorMessage: account.errorMessage } : {}),
      }))
  }

  /**
   * 用一把指定 Key 探测模型清单。只有 401/403 才说明 Key 被拒；404/网络失败
   * 只能说明这家没提供可用的清单端点，不能据此判 Key 无效，所以分开报告。
   */
  private async probeKey(
    entry: AggregateEntry,
    provider: Provider,
    apiKey: string,
  ): Promise<
    | { kind: 'ok' }
    | { kind: 'auth'; detail: string }
    | { kind: 'http'; detail: string }
    | { kind: 'unreachable'; detail: string }
  > {
    const modelsPath = entry.modelsUrl ?? '/models'
    const url = /^https?:\/\//i.test(modelsPath)
      ? modelsPath
      : `${trimmed(provider.apiEndpoint)}${modelsPath.startsWith('/') ? '' : '/'}${modelsPath}`
    try {
      const response = await axios.get(url, {
        headers: this.buildProbeHeaders(entry, provider, apiKey),
        timeout: PROBE_TIMEOUT_MS,
        validateStatus: () => true,
      })
      if (response.status === 401 || response.status === 403) {
        return { kind: 'auth', detail: `HTTP ${response.status}` }
      }
      if (response.status >= 400) {
        return { kind: 'http', detail: `HTTP ${response.status}` }
      }
      return { kind: 'ok' }
    } catch (error) {
      return {
        kind: 'unreachable',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** 记录当前暴露的上游模型 id（按 supportedModels 的顺序）。 */
  private currentUpstreamIds(provider: Provider): string[] {
    const mappings = provider.modelMappings ?? {}
    const ids = (provider.supportedModels ?? []).map(name => mappings[name] ?? name)
    return [...new Set(ids.filter(id => Boolean(id)))]
  }

  /**
   * Probes the endpoint's model list. Keyed entries try every stored key in
   * turn and answer with the first valid one, so a dead key never blocks model
   * discovery while a good one exists.
   *
   * The catalogue declares `modelsUrl` for only part of the entries; when it is
   * absent, the OpenAI-compatible convention `<baseUrl>/models` is requested
   * against the endpoint the user actually configured. A vendor that does not
   * serve it answers with an HTTP status, which the UI reports verbatim.
   */
  private async probe(
    entry: AggregateEntry,
    provider: Provider,
  ): Promise<{ ok: true; models: { displayName: string; actualModelId: string }[] } | { ok: false; result: AggregateOperationResult }> {
    const modelsPath = entry.modelsUrl ?? '/models'
    const url = /^https?:\/\//i.test(modelsPath)
      ? modelsPath
      : `${trimmed(provider.apiEndpoint)}${modelsPath.startsWith('/') ? '' : '/'}${modelsPath}`

    const keyedAccounts = entry.authKind === 'apiKey'
      ? AccountManager.getByProviderId(entry.id, true).filter(account => Boolean(account.credentials.apiKey))
      : []
    if (entry.authKind === 'apiKey' && keyedAccounts.length === 0) {
      return { ok: false, result: { success: false, reason: 'missing_api_key' } }
    }
    const candidates: (Account | undefined)[] = entry.authKind === 'apiKey' ? keyedAccounts : [undefined]

    const reader = entry.id === 'kilo' ? 'openai-free-list' : 'auto'
    let lastFailure: AggregateOperationResult | null = null

    for (const account of candidates) {
      try {
        const response = await axios.get(url, {
          headers: this.buildProbeHeaders(entry, provider, account?.credentials.apiKey),
          timeout: PROBE_TIMEOUT_MS,
          validateStatus: () => true,
        })

        if (response.status >= 400) {
          // 401/403 是这把 Key 的问题，换下一把；其余状态码同样换，最后的失败拼上尝试次数。
          lastFailure = {
            success: false,
            reason: response.status === 401 || response.status === 403 ? 'invalid_api_key' : 'http_status',
            detail: `HTTP ${response.status}`,
          }
          continue
        }

        const parsed = readModelList(response.data, reader)
        if (!parsed.ok) {
          // 响应形状与 Key 无关：解析不出来就直接报，不必再换 Key。
          return { ok: false, result: { success: false, reason: parsed.reason } }
        }
        return { ok: true, models: parsed.models }
      } catch (error) {
        // 网络错误同样与 Key 无关，重试下一把只会重复等待。
        return {
          ok: false,
          result: {
            success: false,
            reason: 'network_error',
            detail: error instanceof Error ? error.message : String(error),
          },
        }
      }
    }

    if (lastFailure && lastFailure.reason === 'invalid_api_key' && candidates.length > 1) {
      lastFailure = {
        ...lastFailure,
        detail: `${lastFailure.detail ?? ''} (${candidates.length} keys tried)`.trim(),
      }
    }
    return { ok: false, result: lastFailure ?? { success: false, reason: 'network_error' } }
  }
}

export const aggregateProviderManager = new AggregateProviderManager()
