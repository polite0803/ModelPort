/**
 * Anthropic 客户端可发现名的 store 侧接线：从真实数据算方案、建**路由**。
 *
 * 为什么要在主进程再算一遍：生成器的输入是「当前启用了哪些条目、每家有哪些模型、
 * 哪些名字已被占用」，这些只有运行时有。UI 与 IPC 只拿结论，不带规则 —— 规则住在
 * `shared/anthropicDiscovery.ts` 那一层，两边共用同一份判据。
 *
 * 为什么落库走 `storeManager.createRoute()` 而不是直接改 `config.routes`：那条路才有
 * 名字校验、冲突判定与「键 == 规范形」的保证（`shared/modelRouteName.ts` 是唯一真值源），
 * 绕开它等于把校验复制第二遍。逐条建，失败的那条带原因回来，不整批回滚 ——
 * 已经建好的是可用产物，让用户看到「建了 6 条、1 条因为点号建不出」比整批失败有用。
 */

import { storeManager } from './store.ts'
import { planAnthropicDiscovery } from '../../shared/anthropicDiscovery.ts'
import type {
  AnthropicRouteApplyResult,
  AnthropicDiscoveryFailure,
  AnthropicDiscoveryResult,
  AnthropicDiscoveryRoute,
  DiscoveryProvider,
} from '../../shared/anthropicDiscovery.ts'

const storageFailure = (): { ok: false; error: AnthropicDiscoveryFailure } => ({
  ok: false,
  error: { code: 'storage_unavailable', message: 'Storage is not initialized yet' },
})

/**
 * 快照当前数据。
 *
 * `visibleNames` 取**全部条目**的目录展示名（含已停用的）：路由名不得与一个仍在目录里
 * 的名字冲突，停用的模型随时可能被启用，那时两条同名会打架。
 */
function collectInput(): {
  providers: DiscoveryProvider[]
  visibleNames: string[]
  routeNames: string[]
  mappingKeys: string[]
} | null {
  // 存储没起来时 `getProviders()` 会抛那句无从下手的 "Storage not initialized"；
  // 这里先取就绪信号，把错误变成 IPC 能返回的可读文本（`channels:*` 那批定的规矩）。
  if (storeManager.getStore() === null) return null
  const providers = storeManager.getProviders()

  const visibleNames: string[] = []
  for (const provider of providers) {
    for (const model of storeManager.getModelCatalogue(provider.id)) {
      visibleNames.push(model.displayName)
    }
  }

  const snapshots: DiscoveryProvider[] = providers
    .filter(provider => provider.enabled)
    .map(provider => ({
      id: provider.id,
      name: provider.name,
      hasActiveAccount: storeManager
        .getAccountsByProviderId(provider.id)
        .some(account => account.status === 'active'),
      models: storeManager.getEffectiveModels(provider.id).map(model => ({
        displayName: model.displayName,
        upstreamId: model.actualModelId,
      })),
    }))

  const config = storeManager.getConfig()
  return {
    providers: snapshots,
    visibleNames,
    routeNames: Object.keys(config.routes ?? {}),
    mappingKeys: Object.keys(config.modelMappings ?? {}),
  }
}

/** 只算不写：UI 用它先展示「会新增哪几条路由、为什么少了哪几条」。 */
export function planAnthropicRoutes(): AnthropicDiscoveryResult {
  const input = collectInput()
  if (input === null) return storageFailure()
  return { ok: true, plan: planAnthropicDiscovery(input) }
}

/**
 * 重算后逐条建路由。
 *
 * 这里**故意再算一次**而不是接受 UI 传回来的方案：客户端连点两次、或两个入口同时写，
 * 拿旧方案落库会把别人刚建的路由覆盖掉。重算的代价是一次本机遍历，换来的是幂等。
 */
export function applyAnthropicRoutes(): AnthropicRouteApplyResult {
  const input = collectInput()
  if (input === null) return storageFailure()

  const plan = planAnthropicDiscovery(input)
  const created: AnthropicDiscoveryRoute[] = []
  const failed: Array<{ name: string; message: string }> = []

  for (const route of plan.create) {
    const result = storeManager.createRoute({
      name: route.name,
      enabled: true,
      // 池策略留空 = 不过滤；钉定在前收基底（`applyModelNamePin`），所以这条路由的池
      // 恰好是 `pinModels` 那几个模型，不会漂到全目录。
      poolStrategies: [],
      pinModels: route.pinModels,
    })
    if (result.ok) created.push(route)
    else failed.push({ name: route.name, message: result.error.message })
  }

  return { ok: true, created, failed, plan }
}
