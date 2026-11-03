/**
 * Proxy Service Module - API Definition Route
 * Implements GET /v1/api-definition/providers
 */

import { randomUUID } from 'node:crypto'
import Router from '@koa/router'
import type { Context } from 'koa'
import { storeManager } from '../../store/store'
import { autoRouter } from '../autoRouter'
import { enabledModelRoutes, resolvePoolRoute } from '../../store/modelRoutes'
import type { ModelRoute } from '../../../shared/types'

const router = new Router({ prefix: '/v1' })

/**
 * Get route names exposed by the gateway.
 *
 * This is a ModelPort-specific discovery shape. It is not a Claude Desktop or
 * Anthropic API contract; clients should treat the body as gateway-defined.
 * Like /v1/models, only active, resolvable routes are advertised. The optional
 * context_window is the same conservative route floor used by /v1/models.
 */
router.get('/api-definition/providers', async (ctx: Context) => {
  ctx.set('X-Request-Id', randomUUID())

  const config = storeManager.getConfig()
  const enabledRoutes = enabledModelRoutes(config.routes)
  const advertisedRoutes = enabledRoutes
    .map(route => resolvePoolRoute(config.routes, route))
    .filter((outcome): outcome is { ok: true; route: ModelRoute } => outcome.ok)
    .map(outcome => outcome.route)
  const routeFloors = autoRouter.advertisedContextFloors(advertisedRoutes)

  const providers = advertisedRoutes.map(route => {
    const contextWindow = routeFloors.get(route.name)
    return {
      name: route.name,
      ...(contextWindow === undefined ? {} : { context_window: contextWindow }),
    }
  })

  ctx.set('Content-Type', 'application/json')
  ctx.body = {
    object: 'list',
    data: providers,
  }
})

export default router
