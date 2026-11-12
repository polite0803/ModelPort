import type { RequestLogEntry } from '../store/types.ts'

/**
 * A request the proxy refused never reaches a provider, so no route records it.
 * Without these rows a client hammering a wrong path or a stale key reads as
 * "no traffic" on the same dashboard that reports the refusals as errors.
 */
export function buildRejectionLogEntry(input: {
  method: string
  path: string
  statusCode: number
  code: string
  message: string
  startedAt: number
  now: number
  /** The model a client asked for; empty when the body was never parsed. */
  model: string
  /** Client UA; the only way to name a caller that was refused before any route. */
  userAgent?: string
}): Omit<RequestLogEntry, 'id'> {
  const latency = Math.max(0, input.now - input.startedAt)

  return {
    timestamp: input.startedAt,
    status: 'error',
    statusCode: input.statusCode,
    method: input.method,
    url: input.path,
    model: input.model,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    responseStatus: input.statusCode,
    latency,
    isStream: false,
    errorMessage: `${input.code}: ${input.message}`,
  }
}

/**
 * The key check runs before the body parser on purpose, so an unauthenticated
 * request has no readable model. Read it only when the body was actually parsed,
 * and never guess one.
 */
export function requestedModelOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return ''
  }
  const model = (body as { model?: unknown }).model
  return typeof model === 'string' ? model : ''
}

/**
 * The same refusal row, built from a live Koa context. `server.ts` inlines this
 * for the refusals its own middleware sees (bad key, unmounted path); a route
 * that answers mid-handler (`route_disabled`) calls it instead, so every
 * refusal shares one format and one stats path. Kept pure (no store import) so
 * `node --test` can exercise it without an Electron runtime.
 */
/** The slice of a Koa context these rows read; spelled out so tests can pass a literal. */
export interface RefusalLogContext {
  method: string
  path: string
  state?: { startedAt?: unknown }
  request?: { body?: unknown }
  get?: (name: string) => string
}

export function rejectionEntryFromContext(
  ctx: RefusalLogContext,
  statusCode: number,
  code: string,
  message: string,
  /** The id this response already carries (`X-Request-Id`); a row without it cannot be joined. */
  requestId?: string,
): Omit<RequestLogEntry, 'id'> {
  const startedAt = typeof ctx.state?.startedAt === 'number' ? ctx.state.startedAt : Date.now()

  return {
    ...buildRejectionLogEntry({
      method: ctx.method,
      path: ctx.path,
      statusCode,
      code,
      message,
      startedAt,
      now: Date.now(),
      model: requestedModelOf(ctx.request?.body),
      ...(typeof ctx.get === 'function' ? { userAgent: ctx.get('user-agent') } : {}),
    }),
    ...(requestId === undefined ? {} : { requestId }),
  }
}

/**
 * The row for a request the **router** refused: the pool produced zero candidates
 * (503 `no_available_model`) or only candidates that reset on their own (429
 * `model_temporarily_unavailable`). Both answer before any provider is called, so
 * nothing downstream writes a row - and the retained log window then holds no
 * trace of the failure the client quotes back at us. That is how a live
 * `503 No available model for route 'codex-deepseek'` ended up with zero rows to
 * explain it: the message named a route, the panel showed nothing.
 *
 * The body is stored verbatim so the console can show the same `details` the
 * client received, instead of making the reader infer the branch from prose.
 */
export function selectionRefusalEntry(
  ctx: RefusalLogContext,
  input: {
    statusCode: number
    code: string
    /** The `error.type` of the body; the log panel filters on it. */
    type: string
    message: string
    /** Exactly what was written to the client. */
    body: unknown
    requestId: string
    /** `identifyClientByUserAgent`'s record, not the raw UA string. */
    client: RequestLogEntry['client']
  },
): Omit<RequestLogEntry, 'id'> {
  return {
    ...rejectionEntryFromContext(ctx, input.statusCode, input.code, input.message, input.requestId),
    ...(input.client === undefined ? {} : { client: input.client }),
    errorType: input.type,
    errorCode: input.code,
    responseBody: JSON.stringify(input.body),
  }
}

/**
 * Fold window for unmounted-route 404s. The observed poller hits each path
 * every ~5 minutes; 30 minutes keeps at most two warns per hour per path while
 * still surfacing a client that never stops probing the wrong surface.
 */
export const UNMOUNTED_ROUTE_FOLD_WINDOW_MS = 30 * 60_000

/** Paths are attacker-controllable - the fold table must stay bounded. */
export const MAX_TRACKED_UNMOUNTED_ROUTES = 100

export interface UnmountedRouteHit {
  method: string
  path: string
  clientIP: string
  /** The X-Request-Id this response carries; quoted in the warn so the line resolves. */
  requestId: string
  now: number
}

interface UnmountedRouteFold {
  count: number
  firstSeenAt: number
  lastEmittedAt: number
  clientIP: string
}

/**
 * App-log trace for `route_not_found` 404s, replacing the request-log error row.
 *
 * These probes are clients mistaking ModelPort for Ollama; they are traffic
 * facts, not gateway faults, so the row (and its stats fold-in) goes away - but
 * "the client is polling wrong paths from 192.168.85.1" must stay diagnosable.
 * The tracer keeps one line per method+path: the first hit warns immediately
 * (method/path/clientIP/requestId), repeats fold into a silent counter, and the
 * next hit after the fold window re-warns with the cumulative count and the
 * first-seen timestamp. Aligned precedent: probe traffic is excluded from
 * `RequestLogManager::getRequestLogStats` via `kind: 'probe'` - the same "not
 * real traffic, still traceable" shape, one level down in the log stack.
 *
 * Pure: the sink (warn logger) is injected so `node --test` runs it without an
 * Electron runtime, and every state update replaces the record instead of
 * mutating it in place.
 */
export function createUnmountedRouteTracer(deps: {
  log: (message: string, data: Record<string, unknown>) => void
  foldWindowMs?: number
  maxTracked?: number
}): { observe: (hit: UnmountedRouteHit) => void } {
  const foldWindowMs = deps.foldWindowMs ?? UNMOUNTED_ROUTE_FOLD_WINDOW_MS
  const maxTracked = deps.maxTracked ?? MAX_TRACKED_UNMOUNTED_ROUTES
  const folds = new Map<string, UnmountedRouteFold>()

  const emit = (hit: UnmountedRouteHit, fold: UnmountedRouteFold, headline: string): void => {
    deps.log(
      `${headline}: ${hit.method.toUpperCase()} ${hit.path} -> 404 route_not_found ` +
        `from ${hit.clientIP} (${fold.count} hit${fold.count === 1 ? '' : 's'} ` +
        `since ${new Date(fold.firstSeenAt).toISOString()}, requestId ${hit.requestId})`,
      {
        method: hit.method.toUpperCase(),
        path: hit.path,
        status: 404,
        code: 'route_not_found',
        clientIP: hit.clientIP,
        requestId: hit.requestId,
        hits: fold.count,
        firstSeenAt: fold.firstSeenAt,
      },
    )
  }

  return {
    observe(hit: UnmountedRouteHit): void {
      const key = `${hit.method.toUpperCase()} ${hit.path}`
      const existing = folds.get(key)

      if (!existing) {
        // Flood of distinct paths: evict the longest-unseen key first so memory
        // stays bounded; the re-appeared old key simply re-warns as "first seen".
        if (folds.size >= maxTracked) {
          const oldest = folds.keys().next().value
          if (oldest !== undefined) folds.delete(oldest)
        }
        const fold: UnmountedRouteFold = {
          count: 1,
          firstSeenAt: hit.now,
          lastEmittedAt: hit.now,
          clientIP: hit.clientIP,
        }
        folds.set(key, fold)
        emit(hit, fold, 'Unmounted route probe')
        return
      }

      const next: UnmountedRouteFold = {
        ...existing,
        count: existing.count + 1,
        clientIP: hit.clientIP,
      }

      if (hit.now - existing.lastEmittedAt >= foldWindowMs) {
        next.lastEmittedAt = hit.now
        folds.set(key, next)
        emit(hit, next, 'Repeated unmounted route probe')
        return
      }

      folds.set(key, next)
    },
  }
}
