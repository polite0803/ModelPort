/**
 * Proxy Service Module - Models Route
 * Implements /v1/models route
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { ModelsResponse, ModelInfo } from '../types'
import { storeManager } from '../../store/store'
import { autoRouter } from '../autoRouter'
import { enabledModelRoutes, findModelRoute, resolvePoolRoute } from '../../store/modelRoutes'
import {
  anthropicErrorBody,
  anthropicErrorTypeOf,
  anthropicNameShape,
  foldAnthropicRouteName,
  modelToAnthropicItem,
  modelsToAnthropicList,
} from '../../../shared/anthropicWire'
import type { ModelRoute } from '../../../shared/types'

const router = new Router({ prefix: '/v1' })

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
 * 对外面**只有路由**：每条已启用的路由一项，停用的不广告，删掉的连条目都没有。
 * 单个模型与用户自建别名不再进这张清单 —— 启用位从此只管一件事：这个名字进不进
 * 路由的候选池（`excludedModels` 与 `ModelMapping.disabled` 是两本账，别名不归目录管）。
 * 名字域因此只有一个：清单里能看见的，请求里才点得到；单查 `/v1/models/:model`
 * 与这里同口径。
 */
router.get('/models', async (ctx: Context) => {
  const config = storeManager.getConfig()
  // 排序由 `enabledModelRoutes` 显式给出，不依赖 Record 的迭代顺序（纯数字名如
  // `2026` 会被 JS 整数键提升而插到最前）。路由名落盘前已归一成
  // `[a-z0-9_-]{1,64}` 且键等于规范形，所以条目之间不可能只差大小写，这里不再去重。
  const enabledRoutes = enabledModelRoutes(config.routes)
  const now = Math.floor(Date.now() / 1000)
  // 先解开池引用再广告，两件事都在这里：
  // 1. 窗口下界必须来自**实际会服务的那个池**，引用别人的路由却报自己策略的窗口就是假数；
  // 2. 池来源断掉（删了/停用/二级引用）的这条现在答不了话，不广告 —— 与「清单里能看见的，
  //    请求里才点得到」同口径，点它会在 chat/completions 拿到点名的 404。
  // 名字仍是本路由的名字（`resolvePoolRoute` 只借「怎么选」，不借「它是谁」）。
  const advertisedRoutes = enabledRoutes
    .map(route => resolvePoolRoute(config.routes, route))
    .filter((outcome): outcome is { ok: true; route: ModelRoute } => outcome.ok)
    .map(outcome => outcome.route)
  // 下界按**每条路由自己的池**算：一次采集、逐路由折叠（`advertisedContextFloors`）。
  // 用全局未筛池会让一条只钉了大窗模型的路由被别家小窗模型压到 64K，报出来的数
  // 跟这条路由毫无关系。
  const routeFloors = autoRouter.advertisedContextFloors(advertisedRoutes)
  const models: ModelInfo[] = advertisedRoutes.map(route =>
    routeEntry(route.name, now, routeFloors.get(route.name)),
  )

  ctx.set('Content-Type', 'application/json')
  // 只会说 anthropic 的客户端（Claude Code / Claude Desktop / 官方 SDK）带着
  // `anthropic-version` 来列模型，它们按 `{data:[{type:'model',display_name,created_at}],has_more}`
  // 解析；发 OpenAI 形状会让它们拿到一个「有 data 键但字段全缺」的空壳清单。判别只用
  // 这一个请求头，不看 Accept —— 后者会被中间层改写。
  //
  // 这一支还要把 `anthropicInbound.modelMap` 的键放在最前面：Desktop 会按自己的 Anthropic
  // 名字表逐行筛，纯网关内部名（`auto`、`glm-5`）会被它整批丢掉，日志里就只剩
  // 「0 usable models」。详见 `modelsToAnthropicList` 的判据来源。
  if (ctx.get('anthropic-version')) {
    const mappedNames = config.anthropicInbound?.modelMap ?? {}
    // 只有三个参数：清单行的 `display_name` 恒等于 id，客户端筛的、发回来的、这里广告的是
    // 同一个名字，不再另存一份「只显示用的字」。
    const list = modelsToAnthropicList(models, mappedNames, config.anthropicInbound?.routeTiers)
    ctx.body = list
    // 「广告了几条」必须可查：客户端那边还有一层自己的名字过滤，没有这条日志，
    // 「网关发了 20 条」与「用户在客户端看到 0 条」之间的分歧无法对账。
    const advertisedRows = (list.data as Array<{ id?: unknown }>).map(row => String(row?.id ?? ''))
    // 客户端的选择器还有一道独立于档位的名字关（`anthropicNameShape`）：过不了这一关的
    // 行会被「发现」收下、被「下拉」丢掉，用户在客户端那边就读成「只有默认模型」。
    // 这一格把两关分开报，远程排障时不必再靠猜。
    const selectableRows = advertisedRows.filter(id => anthropicNameShape(id) === 'selectable').length
    storeManager.addLog('debug', `Anthropic model list: ${String(advertisedRows.length)} rows`, {
      data: {
        gatewayModels: models.length,
        declaredAnthropicNames: Object.keys(mappedNames).length,
        tieredRoutes: Object.keys(config.anthropicInbound?.routeTiers ?? {}).length,
        selectableRows,
      },
    })
    if (advertisedRows.length > 0 && selectableRows === 0) {
      storeManager.addLog('warn', 'Anthropic model list: no row can appear in the Claude model picker', {
        data: { advertisedRows: advertisedRows.length, rows: advertisedRows.slice(0, 12) },
      })
    }
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
 * 与列表同一个名字域：只有路由查得到。单模型名与用户别名一律 404 —— 它们不再
 * 是「客户端可以点名的名字」，单查若还答话就等于清单否认、单查承认。
 * 停用的路由不许冒充在服，被删的路由表里根本没有，两者同样是 404。
 *
 * 带 `anthropic-version` 时返回 anthropic 形状（与列表同一个构造处），否则 OpenAI 形状
 * 一字不变。这一支多认一类名字：`anthropicInbound.modelMap` 的**精确键** —— 列表把它
 * 当一行广告出去了（`modelsToAnthropicList`），客户端拿它来 retrieve 必须答话，
 * 否则就是「列表承认、单查否认」。前缀通配不在这一格：列表没广告那个名字。
 */
router.get('/models/:model', async (ctx: Context) => {
  const modelId = ctx.params.model
  const config = storeManager.getConfig()
  const routes = config.routes
  // 判别只用请求头（与列表同一格），不看 Accept —— 后者会被中间层改写。
  const wantsAnthropic = ctx.get('anthropic-version') !== ''
  const modelMap = config.anthropicInbound?.modelMap
  // 路由名优先于映射键（与 `findModelRoute`「路由优先于同名模型」同一顺序）。
  const mappedRouteName = wantsAnthropic ? foldAnthropicRouteName(modelId, modelMap) : undefined
  const route = findModelRoute(routes, modelId)
    ?? (mappedRouteName === undefined ? undefined : findModelRoute(routes, mappedRouteName))
  // 与列表同一个判据：池来源断掉的路由不广告，单查也不答话（清单否认、单查承认就是两套名字域）。
  const pool = route === undefined || !route.enabled
    ? null
    : resolvePoolRoute(routes, route)

  if (pool === null || !pool.ok) {
    ctx.status = 404
    if (wantsAnthropic) ctx.set('Content-Type', 'application/json')
    // 沿用仓里既有那一套：anthropic 客户端的错误信封（`messages.ts` 的 `failWith`
    // 与 `server.ts` 的鉴权分支都用它），状态码与 404 → `not_found_error` 的映射都不新造。
    ctx.body = wantsAnthropic
      ? anthropicErrorBody(`Model '${modelId}' not found`, anthropicErrorTypeOf(404))
      : {
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
  const entry = routeEntry(
    pool.route.name,
    Math.floor(Date.now() / 1000),
    autoRouter.advertisedContextFloor(pool.route)
  )
  if (!wantsAnthropic) {
    ctx.body = entry
    return
  }

  // 与列表逐字段同源（同一个 `anthropicModelRow`）；拿 `undefined` 就是这一行构造不出来，
  // 按「答不了」404，而不是把 OpenAI 形状当成 anthropic 答复发出去。
  const item = modelToAnthropicItem({
    requestedName: modelId,
    routeName: pool.route.name,
    entry,
    modelMap,
    routeTiers: config.anthropicInbound?.routeTiers,
  })
  if (item === undefined) {
    ctx.status = 404
    ctx.body = anthropicErrorBody(`Model '${modelId}' not found`, anthropicErrorTypeOf(404))
    return
  }
  ctx.body = item
})

export default router
