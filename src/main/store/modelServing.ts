import type { CatalogueModel, Provider, ProviderModelOverrides } from './types.ts'

/**
 * The provider a catalogue-shaped name belongs to when the user wrote no alias
 * for it. Machine wiring used to be one row per model in the global mapping
 * table; after it moved to the provider ledgers this is the read-side
 * equivalent:
 *
 * - `<aggregateId>/<modelId>` → that aggregate provider (only its sync ever
 *   produces that name);
 * - a name the provider lists in its own ledger → that provider (account
 *   channels qualify their display names as `<渠道名> / <展示名>`).
 *
 * Without the pin, an `ovh/deepseek-chat`-style name would be "routable" for a
 * catalogue-less passthrough provider, because {@link isModelRoutable} answers
 * `true` whenever there is no catalogue to contradict the name.
 */
export function derivePreferredProvider(
  model: string,
  providers: ReadonlyArray<Pick<Provider, 'id' | 'type' | 'modelMappings'>>
): string | undefined {
  const slash = model.indexOf('/')
  if (slash > 0) {
    const prefix = model.slice(0, slash)
    const aggregate = providers.find(provider => provider.id === prefix && provider.type === 'aggregate')
    if (aggregate) return aggregate.id
  }

  for (const provider of providers) {
    if (provider.modelMappings?.[model] !== undefined) return provider.id
  }

  return undefined
}

/**
 * The single merge of a provider's model catalogue: shipped names, hand-added
 * models and the last online sync, each row carrying whether it is served now.
 * `getEffectiveModels()` is this filtered to the served rows, so the proxy, the
 * route pool and the provider card can never disagree about what may be routed.
 */
export function buildModelCatalogue(
  supportedModels: string[],
  modelMappings: Record<string, string>,
  overrides: Pick<ProviderModelOverrides, 'addedModels' | 'excludedModels' | 'fetchedModels'>
): CatalogueModel[] {
  const excluded = new Set(overrides.excludedModels || [])
  const catalogue: CatalogueModel[] = (supportedModels || []).map(displayName => ({
    displayName,
    actualModelId: modelMappings[displayName] || displayName,
    isCustom: false,
    source: 'builtin' as const,
    served: !excluded.has(displayName),
  }))

  for (const model of overrides.addedModels || []) {
    catalogue.push({
      displayName: model.displayName,
      actualModelId: model.actualModelId,
      isCustom: true,
      source: 'custom',
      served: !excluded.has(model.displayName),
    })
  }

  // A synced name the user already sees from the shipped list or added by hand is never duplicated.
  const known = new Set(catalogue.map(model => model.displayName))
  for (const model of overrides.fetchedModels || []) {
    if (known.has(model.displayName)) continue
    known.add(model.displayName)
    catalogue.push({
      displayName: model.displayName,
      actualModelId: model.actualModelId,
      isCustom: false,
      source: 'fetched',
      served: !excluded.has(model.displayName),
    })
  }

  return catalogue
}

/** 目录名匹配：大小写无关，结尾的 `*` 是前缀通配 */
export function matchesCatalogueName(modelName: string, pattern: string): boolean {
  const normalizedModel = modelName.toLowerCase()
  const normalizedPattern = pattern.toLowerCase()
  if (normalizedPattern.endsWith('*')) {
    return normalizedModel.startsWith(normalizedPattern.slice(0, -1))
  }
  return normalizedPattern === normalizedModel
}

export interface RoutableInput {
  /** 请求里的模型名 */
  model: string
  /** 该家当前在服务的目录名；已停用的不在里面 */
  servedNames: string[]
  /** 该家是否有目录。没有目录才是通配供应商 */
  hasCatalogue: boolean
  /** 全局映射表里这个名字的记录；已停用的别名按「没有记录」参与判断 */
  mapping?: { actualModel: string; preferredProviderId?: string; disabled?: boolean }
}

/**
 * 这条映射记录当前是否生效。停用一条别名是**名字域**里的操作，所以四个消费点
 * （`modelMapper` 的五条读路径、`loadbalancer` 的两处、`messages.gatewayKnowsModel`）
 * 都要认这同一个判据 —— 少认一处，那条别名就还能被点名。这里只做判定而不做整表
 * 过滤：`mapModel` 每次请求会按候选供应商调若干回，复制一张几百行的表不值得。
 */
export function isMappingActive<T extends { disabled?: boolean }>(mapping: T | undefined): mapping is T {
  return mapping !== undefined && mapping.disabled !== true
}

/**
 * 一家供应商能不能接某个模型名。在服务的目录是唯一权威：
 * 带 `preferredProviderId` 的映射只是那家的内部账本（聚合与账号通道按模型写），
 * 用它翻案会把刚停用的模型救回来照样发给上游。
 */
export function isModelRoutable({ model, servedNames, hasCatalogue, mapping }: RoutableInput): boolean {
  const active = isMappingActive(mapping) ? mapping : undefined
  if (!hasCatalogue) return true
  if (servedNames.some(name => matchesCatalogueName(model, name))) return true
  if (!active) return false
  if (active.preferredProviderId) return false
  return servedNames.some(name => matchesCatalogueName(active.actualModel, name))
}

/**
 * Stop or start `names` and return the new `excludedModels` without touching the
 * caller's array. Stopping takes a model out of every route's candidate pool and
 * out of the named-model request path, so the same ledger drives routing.
 * It no longer drives advertising: `/v1/models` advertises routes only.
 */
export function applyServed(excludedModels: string[], names: string[], served: boolean): string[] {
  if (served) {
    const targets = new Set(names)
    return (excludedModels || []).filter(name => !targets.has(name))
  }
  const next = new Set(excludedModels || [])
  for (const name of names) next.add(name)
  return [...next]
}

/**
 * 一次性改名：把一家供应商目录里的裸展示名搬进 `<prefix>/<id>` 命名空间。
 *
 * OpenCode 的模型此前以裸 id 对外（`deepseek-v4.1-flash-free`），现在与聚合条目、
 * 账号通道一样带 `opencode/` 前缀。启动同步会用随包配置重写供应商记录本身，但
 * `userModelOverrides` 里的旧数据不会自己改：旧同步写下的 fetchedModels 行还是裸名，
 * 不迁移的话目录会同时出现 `opencode/<id>`（随包快照）与裸 `<id>`（旧同步残留）两行，
 * 指向同一个上游模型。
 *
 * 规则（幂等：已经带前缀的名字原样保留）：
 * - fetchedModels：displayName 一律改写成 `prefix/<actualModelId>`（裸 id 是上游权威）；
 * - excludedModels：先按 fetchedModels 的旧名→新名对照表翻，翻不到的裸名直接加前缀——
 *   无论旧名是快照的裸 id 还是同步带回来的展示名，用户的停用状态都不丢；
 * - addedModels 是用户亲手加的，保持原样。
 */
export function namespaceModelOverrides(
  overrides: ProviderModelOverrides,
  prefix: string
): { next: ProviderModelOverrides; changed: boolean } {
  const prefixed = (modelId: string): string => `${prefix}/${modelId}`
  const renames = new Map<string, string>()
  let changed = false

  const fetchedModels = (overrides.fetchedModels || []).map(model => {
    if (model.displayName.includes('/')) return model
    const displayName = prefixed(model.actualModelId || model.displayName)
    if (displayName !== model.displayName) changed = true
    renames.set(model.displayName, displayName)
    return { ...model, displayName }
  })

  const excludedModels = (overrides.excludedModels || []).map(name => {
    const renamed = renames.get(name) ?? (name.includes('/') ? name : prefixed(name))
    if (renamed !== name) changed = true
    return renamed
  })

  return {
    next: changed ? { ...overrides, fetchedModels, excludedModels } : overrides,
    changed,
  }
}
