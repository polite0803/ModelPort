/**
 * Routing failures are the answer a client gets when it misconfigures its
 * endpoint, so the reply has to name the call that was actually wrong.
 */

const CHAT_ENDPOINT = 'POST /v1/chat/completions'
const ENDPOINT_LIST_HINT = 'Call GET / for the endpoint list.'

export interface RouteMatchLayer {
  methods?: string[]
}

export interface RouteError {
  status: number
  allow?: string
  body: {
    error: {
      message: string
      type: string
      code: string
    }
  }
}

/**
 * `matched` is the layer list koa-router leaves on the context: every layer
 * whose *path* matched, whatever its method. Layers mounted with `use()` carry
 * no method and must not count as a route.
 */
export function buildRouteError(input: {
  method: string
  path: string
  matched?: RouteMatchLayer[]
}): RouteError {
  const method = (input.method ?? '').toUpperCase()
  const allowed = allowedMethodsOf(input.matched)

  if (allowed.length > 0 && !allowed.includes(method)) {
    const allow = allowed.join(', ')
    const hint = isModelApiPath(input.path) ? ` Chat requests go to ${CHAT_ENDPOINT}.` : ''
    return {
      status: 405,
      allow,
      body: {
        error: {
          message: `Method Not Allowed: ${method} ${input.path}. This route accepts ${allow}.${hint}`,
          type: 'invalid_request_error',
          code: 'method_not_allowed',
        },
      },
    }
  }

  return {
    status: 404,
    body: {
      error: {
        message: `Route not found: ${method} ${input.path}. ${ENDPOINT_LIST_HINT}`,
        type: 'invalid_request_error',
        code: 'route_not_found',
      },
    },
  }
}

/**
 * True only for the 404 *this gateway* raises from its own catch-all
 * (`route_not_found`): the client is polling a surface that was never mounted
 * here (Ollama-style `GET /v1/props`). It is a client-configuration fact, not a
 * gateway failure, so it must not join the request-log error rows - the
 * fallback traces it in the app log instead (folded per method+path).
 *
 * Deliberately keyed on our own code string: an upstream-shaped 404 that means
 * "this channel does not serve that model" (failover switches on it per
 * AGENTS.md) carries a different code and keeps its request-log row, and a 405
 * (`method_not_allowed`, a wrong call against a mounted route) keeps its row too.
 */
export function isUnmountedRouteNotFound(error: RouteError): boolean {
  return error.status === 404 && error.body.error.code === 'route_not_found'
}

function allowedMethodsOf(layers?: RouteMatchLayer[]): string[] {
  const methods = new Set<string>()
  for (const layer of layers ?? []) {
    for (const layerMethod of layer?.methods ?? []) {
      if (typeof layerMethod === 'string' && layerMethod.length > 0) {
        methods.add(layerMethod.toUpperCase())
      }
    }
  }
  return [...methods].sort()
}

/** Model-API paths (not the management surface) - shared by the reply hint and the rejection log. */
export function isModelApiPath(path: string): boolean {
  return path.startsWith('/v1/') && !path.startsWith('/v1/management')
}
