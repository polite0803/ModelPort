/**
 * Proxy Service Module - Models Route
 * Implements /v1/models route
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { ModelsResponse, ModelInfo } from '../types'
import { loadBalancer } from '../loadbalancer'
import { storeManager } from '../../store/store'
import { modelMapper } from '../modelMapper'
import { autoRouter } from '../autoRouter'
import { enabledModelRoutes, findModelRoute } from '../../store/modelRoutes'
import { aliasMappingKeys, contextWindowOf, matchesCatalogueName } from '../../store/modelServing'
import { modelsToAnthropicList } from '../../../shared/anthropicWire'

const router = new Router({ prefix: '/v1' })

/**
 * 所有供应商目录里的名字（含已停用的）。这些由供应商自己按「是否在服务」广告；
 * 聚合与账号通道每次同步都会按模型往全局映射表里写一条，所以映射表只能用来
 * 补用户自己建的别名，否则刚停用的模型会从这里回到客户端清单。
 */
function providerCatalogueNames(): Set<string> {
  const names = new Set<string>()
  for (const provider of storeManager.getProviders()) {
    for (const model of storeManager.getModelCatalogue(provider.id)) {
      names.add(model.displayName)
    }
  }
  return names
}

/**
 * 合成条目：路由不是模型，没有上游目录可查，所以带的是**那条路由自己的候选池**里
 * 最小的那个窗口（`autoRouter::advertisedContextFloor`，未标注按 64000 参与）——
 * 这是可证的下界，不是编的数：路由会落到它池里的任意候选上，广告比某个候选更大的
 * 窗口就是让它把请求发给装不下的那一家。池策略与手动移除只会**剔掉**候选（剔掉小窗
 * 的会让这条路由的真实下界变大），所以按路由自己的池算不会把数说大；手动加回的模型
 * 也参与，因为那条路由真的会把请求交给它。候选收敛到一个模型时就是那个模型自己的
 * 窗口。空池省略键。
 * owned_by 沿用 legacy 的 `auto-router`：所有路由都由同一个路由引擎服务，客户端
 * 按 owned_by 分组时不该把它们拆开。
 */
function routeEntry(name: string, createdAtSeconds: number, contextFloor?: number): ModelInfo {
  return {
    id: name,
    object: 'model',
    created: createdAtSeconds,
    owned_by: 'auto-router',
    ...(contextFloor === undefined ? {} : { context_window: contextFloor }),
  }
}

/**
 * Get all available models
 *
 * 去重按**大小写不敏感**：路由名在解析时是大小写不敏感的（`Fast` 与 `fast` 是同
 * 一条），广告里出现两条只差大小写的同名条目会让客户端按 id 建 Map 时互相覆盖，
 * 而按 id 精确匹配的调用方根本分不出该发哪一条。顺序：路由 **优先于** 同名模型
 * （请求解析就是这个优先级，广告必须与之一致，否则 `/v1/models` 会否认自己能服务
 * 一个请求已经能用的名字）。
 */
router.get('/models', async (ctx: Context) => {
  const providers = storeManager.getProviders().filter(p => p.enabled)
  const models: ModelInfo[] = []
  const addedNames = new Set<string>()
  const now = Math.floor(Date.now() / 1000)

  // 虚拟模型：每条**已启用**的路由一项，由 autoRouter 按那条路由的配置在全部
  // 可用供应商/模型中挑目标。停用的不广告；`auto` 被删了就不再出现（迁移判据
  // 见 store.ts::normalizeRoutes —— 键存在即永不重放迁移）。
  // 排序由 enabledModelRoutes 显式给出，不依赖 Record 的迭代顺序（纯数字名如
  // `2026` 会被 JS 整数键提升而插到最前）。
  const config = storeManager.getConfig()
  const enabledRoutes = enabledModelRoutes(config.routes)
  // 下界按**每条路由自己的池**算：一次采集、逐路由折叠（`advertisedContextFloors`）。
  // 用全局未筛池会让一条只钉了大窗模型的路由被别家小窗模型压到 64K，报出来的数
  // 跟这条路由毫无关系。
  const routeFloors = autoRouter.advertisedContextFloors(enabledRoutes)
  for (const route of enabledRoutes) {
    if (addedNames.has(route.name)) continue
    addedNames.add(route.name)
    models.push(routeEntry(route.name, now, routeFloors.get(route.name)))
  }

  for (const provider of providers) {
    const accounts = storeManager.getAccountsByProviderId(provider.id)
      .filter(account => account.status === 'active')

    if (accounts.length === 0) {
      continue
    }

    const effectiveModels = storeManager.getEffectiveModels(provider.id)
    for (const model of effectiveModels) {
      const canonical = model.displayName.trim().toLowerCase()
      if (!addedNames.has(canonical)) {
        addedNames.add(canonical)
        // 只有上游报过窗口才发这个键；用户自建/聚合未标注的都保持省略。
        const window = contextWindowOf(provider.modelCapabilities, model.displayName)
        models.push({
          id: model.displayName,
          object: 'model',
          created: Math.floor(provider.createdAt / 1000),
          owned_by: provider.name,
          ...(window === undefined ? {} : { context_window: window }),
        })
      }
    }
  }

  for (const requestModel of aliasMappingKeys(config.modelMappings, providerCatalogueNames())) {
    const canonical = requestModel.trim().toLowerCase()
    if (!addedNames.has(canonical)) {
      addedNames.add(canonical)
      models.push({
        id: requestModel,
        object: 'model',
        created: now,
        owned_by: 'model-mapping',
      })
    }
  }

  ctx.set('Content-Type', 'application/json')
  // 只会说 anthropic 的客户端（Claude Code / 官方 SDK）带着 `anthropic-version` 来列
  // 模型，它们按 `{data:[{type:'model',display_name,created_at}],has_more}` 解析；
  // 发 OpenAI 形状会让它们拿到一个「有 data 键但字段全缺」的空壳清单。判别只用
  // 这一个请求头，不看 Accept —— 后者会被中间层改写。
  if (ctx.get('anthropic-version')) {
    ctx.body = modelsToAnthropicList(models)
    return
  }

  const response: ModelsResponse = {
    object: 'list',
    data: models,
  }

  ctx.body = response
})

/**
 * Get specified model info
 *
 * 顺序与 `/v1/models`、与请求解析都一致：路由优先。legacy 的 `auto` 单模型分支
 * 已被「路由」这一条通用路径吃掉（迁移保证表里默认就有 `auto`），所以这里不再
 * 留第二份「auto 是否在服务」的真值。
 */
router.get('/models/:model', async (ctx: Context) => {
  const modelId = ctx.params.model
  const config = storeManager.getConfig()

  const route = findModelRoute(config.routes, modelId)
  if (route !== undefined) {
    // 停用的路由不广告，单查也不许冒充在服；被删的路由压根不会走到这里（表里没有），
    // 会自然落到下面的模型/别名查找，最后 404 —— 那正是「这个名字不再被路由」。
    if (!route.enabled) {
      ctx.status = 404
      ctx.body = {
        error: {
          message: `Model '${modelId}' not found`,
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found',
        },
      }
      return
    }

    ctx.set('Content-Type', 'application/json')
    ctx.body = routeEntry(
      route.name,
      Math.floor(Date.now() / 1000),
      autoRouter.advertisedContextFloor(route)
    )
    return
  }

  const mappings = config.modelMappings || {}
  if (mappings[modelId] && !providerCatalogueNames().has(modelId)) {
    ctx.set('Content-Type', 'application/json')
    ctx.body = {
      id: modelId,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'model-mapping',
    }
    return
  }

  const providers = storeManager.getProviders().filter(p => p.enabled)

  for (const provider of providers) {
    const accounts = storeManager.getAccountsByProviderId(provider.id)
      .filter(account => account.status === 'active')

    if (accounts.length === 0) {
      continue
    }

    const effectiveModels = storeManager.getEffectiveModels(provider.id)
    // 用 find 而不是 some：命中那个**目录名**才是能力表的键，通配别名请求也要能查到窗口。
    const matched = effectiveModels.find(model => matchesCatalogueName(modelId, model.displayName))

    if (matched !== undefined) {
      const window = contextWindowOf(provider.modelCapabilities, matched.displayName)
      ctx.set('Content-Type', 'application/json')
      ctx.body = {
        id: modelId,
        object: 'model',
        created: Math.floor(provider.createdAt / 1000),
        owned_by: provider.name,
        ...(window === undefined ? {} : { context_window: window }),
      }
      return
    }
  }

  ctx.status = 404
  ctx.body = {
    error: {
      message: `Model '${modelId}' not found`,
      type: 'invalid_request_error',
      param: 'model',
      code: 'model_not_found',
    },
  }
})

export default router
