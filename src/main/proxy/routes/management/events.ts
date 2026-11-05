/**
 * Management API - event stream (the headless form of `webContents.send`).
 *
 * The desktop shell pushes to windows; a remote client needs the same events, and the
 * handlers already call `getHost().push(channel, payload)` for both. This route is the
 * Node host's sink: it subscribes to the push bus and relays frames.
 *
 * Auth is the management secret in a header, so the client reads this with
 * `fetch().body.getReader()` rather than `EventSource` - the latter cannot set headers,
 * and putting the secret in the query string would land it in every proxy and request
 * log on the way. Heartbeat is a comment line, never a fabricated event: a client that
 * stops receiving comments knows the link died, and gets no data it could mistake for
 * a real update.
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { managementAuthMiddleware } from '../../middleware/managementAuth'
import { onHeadlessPush } from '../../../runtime/host'

const router = new Router({ prefix: '/v1/management/events' })

router.use(managementAuthMiddleware)

const HEARTBEAT_MS = 25_000

router.get('/', (ctx: Context) => {
  ctx.status = 200
  ctx.set('Content-Type', 'text/event-stream; charset=utf-8')
  ctx.set('Cache-Control', 'no-cache, no-transform')
  ctx.set('Connection', 'keep-alive')
  // Every event is one JSON frame already; compression would only delay the first byte.
  ctx.set('X-Accel-Buffering', 'no')
  ctx.respond = false

  const stream = ctx.res

  const send = (channel: string, payload: unknown): void => {
    try {
      stream.write(`event: ${channel}\ndata: ${JSON.stringify(payload ?? null)}\n\n`)
    } catch {
      // A dead socket must not break the code path that pushed to it.
    }
  }

  const unsubscribe = onHeadlessPush(send)
  const heartbeat = setInterval(() => {
    try {
      stream.write(': ping\n\n')
    } catch {
      // ignore
    }
  }, HEARTBEAT_MS)

  const finish = (): void => {
    clearInterval(heartbeat)
    unsubscribe()
  }

  stream.on('close', finish)
  stream.on('error', finish)

  // Announce the stream so a client can tell "connected, nothing yet" from "connected
  // to something else entirely".
  send('events:ready', { heartbeatMs: HEARTBEAT_MS })
})

export default router
