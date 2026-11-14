/**
 * Management API - RPC bridge over the main-process handler registry.
 *
 * Why a bridge instead of hand-written REST routes for the same actions: the UI needs
 * ~150 actions (routes CRUD, probe jobs, catalog batches, log queries, model marks...)
 * and every one of them already exists as a handler in `ipc/handlers.ts`. Writing a
 * second set of bodies is how a management surface drifts - the classic form being a
 * switch that the screen can set but nothing reads, or an action that works in the
 * window and silently does nothing over the network.
 *
 * So the **allowlist is the registry itself** (`listRegisteredChannels()`), which
 * cannot drift, minus one short list of install-level actions that must never be
 * triggerable over a socket. Desktop-only channels stay reachable but answer
 * `desktop-only`, because "this host has no tray/updater/window" is a fact the UI can
 * show, not a button that appears to work.
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { managementAuthMiddleware } from '../../middleware/managementAuth'
import {
  DesktopOnlyError,
} from '../../../runtime/host'
import { hasHandler, invokeMainHandler, listRegisteredChannels, UnknownHandlerError } from '../../../ipc/registry'
import { IpcChannels } from '../../../ipc/channels'
import { storeManager } from '../../../store/store'
import type { ManagementApiResponse } from '../../../../shared/types'

const router = new Router({ prefix: '/v1/management/rpc' })

router.use(managementAuthMiddleware)

/**
 * Actions that replace or restart the installed program. They stay on IPC: a network
 * caller must not be able to quit-and-install while an operator is mid-session.
 *
 * The Docker gateway's `gateway:*Update` channels are deliberately NOT here: they
 * replace the container image, not the console install, and the whole point is that
 * a browser operator can trigger them. They are management-auth gated like every
 * other channel, and the swap itself runs in a one-shot helper container.
 */
const NOT_EXPOSED: readonly string[] = [
  IpcChannels.APP_INSTALL_UPDATE,
  IpcChannels.APP_DOWNLOAD_UPDATE,
]

function fail(ctx: Context, status: number, code: string, message: string, channel: string): ManagementApiResponse {
  ctx.status = status
  // The access-log middleware can only see the path, and every RPC shares it: a bare
  // `POST /v1/management/rpc 404` in the app log names neither the channel nor the reason,
  // which is how a missing registration costs a whole round trip to diagnose.
  //
  // `desktop-only` is the host telling the UI "there is no window here", not a fault:
  // the UI already catches it, so it must not add a warn per theme change (6 in the
  // 2026-11-06 WSL window). The access-log line is suppressed through ctx.state below.
  if (code === 'desktop-only') ctx.state.suppressAccessLog = true
  storeManager.addLog(code === 'desktop-only' ? 'info' : 'warn', `rpc ${code}`, {
    data: { channel, code, status },
  })
  return { success: false, error: { code, message } }
}

/** The channels a remote client may call right now, for discovery and for the UI. */
router.get('/channels', async (ctx) => {
  ctx.body = {
    success: true,
    data: listRegisteredChannels().filter(channel => !NOT_EXPOSED.includes(channel)),
  } satisfies ManagementApiResponse
})

router.post('/', async (ctx) => {
  const body = ctx.request.body as { channel?: unknown; args?: unknown } | undefined
  const channel = typeof body?.channel === 'string' ? body.channel : ''
  const args = Array.isArray(body?.args) ? body.args : []
  // 访问日志在上游中间件里、拿不到这里的局部变量：挂到 state 上，慢 200 与 4xx
  // 才能写出 `rpc=<channel>`，而不是一行认不出是谁的 `POST /v1/management/rpc`。
  if (channel !== '') ctx.state.managementRpcChannel = channel

  if (channel === '') {
    ctx.body = fail(ctx, 400, 'invalid_request', 'rpc requires { channel, args }', channel)
    return
  }
  if (NOT_EXPOSED.includes(channel)) {
    ctx.body = fail(ctx, 403, 'not_exposed', `${channel} is an install-level action and is not callable over the network`, channel)
    return
  }
  if (!hasHandler(channel)) {
    // Never a silent `undefined`: a typo in a method name has to look like a typo.
    ctx.body = fail(ctx, 404, 'unknown_channel', `No handler registered for channel: ${channel}`, channel)
    return
  }

  try {
    const data = await invokeMainHandler(channel, args)
    ctx.body = { success: true, data } satisfies ManagementApiResponse
  } catch (error) {
    if (error instanceof DesktopOnlyError) {
      ctx.body = fail(ctx, 403, error.code, error.message, channel)
      return
    }
    if (error instanceof UnknownHandlerError) {
      ctx.body = fail(ctx, 404, 'unknown_channel', error.message, channel)
      return
    }
    throw error
  }
})

export default router
