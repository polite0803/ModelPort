/**
 * Management API - Channel Client Identity Routes (B4)
 *
 * 暴露各动态渠道「下一笔请求实际会发」的客户端身份：版本号、来源、核对时间。
 * 用途：诊断封号/风控时，先确认网关发出去的身份值和它的证据来源，而不是翻日志。
 *
 * 静态身份的渠道（zcode/raccoon/loomy/cline/minimax/lobsterai/gemini/opencode）
 * 不在这份快照里 —— 它们没有动态状态，声明值仍由渠道目录的
 * `upstreamIdentity.declared` 承载（`GET /v1/management/channels` 的既有字段）。
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { managementAuthMiddleware } from '../../middleware/managementAuth'
import { accountChannelManager } from '../../../providers/accountChannels/manager'
import type { ChannelIdentitySnapshot } from '../../../../shared/channels'
import type { ManagementApiResponse } from '../../../../shared/types'

const router = new Router({ prefix: '/v1/management/channels/identity' })

router.use(managementAuthMiddleware)

function createErrorResponse(code: string, message: string): ManagementApiResponse {
  return {
    success: false,
    error: {
      code,
      message,
    },
  }
}

function createSuccessResponse<T>(data: T): ManagementApiResponse<T> {
  return {
    success: true,
    data,
  }
}

router.get('/', async (ctx: Context) => {
  try {
    const snapshot: ChannelIdentitySnapshot = await accountChannelManager.identitySnapshot()
    ctx.body = createSuccessResponse(snapshot)
  } catch (error) {
    ctx.status = 500
    ctx.body = createErrorResponse(
      'identity_snapshot_failed',
      error instanceof Error ? error.message : '读取渠道身份快照失败',
    )
  }
})

/**
 * 强制重拉官方版本源并返回刷新后的快照。
 *
 * 典型场景：官方客户端刚发了新版，用户不想等 6h 定时刷新，或者命中
 * `channel_risk_control` 后想立刻确认「刷新后身份是否跟上」。刷新是网络操作
 * （最多 ~8s 超时，各源并行），失败时返回当前快照并带 error。
 */
router.post('/refresh', async (ctx: Context) => {
  try {
    const snapshot: ChannelIdentitySnapshot = await accountChannelManager.identityRefresh()
    ctx.body = createSuccessResponse(snapshot)
  } catch (error) {
    ctx.status = 500
    ctx.body = createErrorResponse(
      'identity_refresh_failed',
      error instanceof Error ? error.message : '强制刷新渠道身份失败',
    )
  }
})

export default router
