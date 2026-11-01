/**
 * Proxy Service Module - Completions Route (Optional)
 * Implements /v1/completions route (legacy API)
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import type { Readable } from 'stream'
import { loadBalancer } from '../loadbalancer'
import { requestForwarder } from '../forwarder'
import { streamHandler } from '../stream'
import { proxyStatusManager } from '../status'
import { modelMapper } from '../modelMapper'
import { autoRouter } from '../autoRouter'
import type { AutoCandidate } from '../autoRouter'
import type { AccountSelection, ForwardResult } from '../types'
import { storeManager } from '../../store/store'
import { resolveRouteRequest } from '../../store/modelRoutes'
import { rejectionEntryFromContext } from '../rejectionLog'
import { createTextCompletionChunkTransform, toTextCompletion } from '../utils/textCompletion'
import { routeHeaderValue, toHeaderValue } from '../utils/headerValue'
import { clientHeaderValue, identifyClientByUserAgent } from '../../../shared/clientProfile'

const router = new Router({ prefix: '/v1' })

interface CompletionRequest {
  model: string
  prompt: string | string[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  n?: number
  stream?: boolean
  stop?: string | string[]
  echo?: boolean
}

/**
 * Generate request ID
 */
function generateRequestId(): string {
  return `cmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Convert prompt to messages format
 */
function promptToMessages(prompt: string | string[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (Array.isArray(prompt)) {
    return prompt.map((p, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: p,
    }))
  }

  return [{ role: 'user', content: prompt }]
}

/**
 * Handle Completions request
 */
router.post('/completions', async (ctx: Context) => {
  const startTime = Date.now()
  const requestId = generateRequestId()
  ctx.set('X-Request-Id', requestId)
  // 与 chat 路由同口径：UA 归类只进日志与响应头，不参与选路
  const client = identifyClientByUserAgent(ctx.headers['user-agent'])
  ctx.set('X-ModelPort-Client', clientHeaderValue(client))

  let request: CompletionRequest
  try {
    request = ctx.request.body as CompletionRequest
  } catch (error) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Invalid request body',
        type: 'invalid_request_error',
      },
    }
    return
  }

  if (!request.model) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Missing required field: model',
        type: 'invalid_request_error',
        param: 'model',
      },
    }
    return
  }

  if (request.prompt === undefined) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Missing required field: prompt',
        type: 'invalid_request_error',
        param: 'prompt',
      },
    }
    return
  }

  const config = storeManager.getConfig()
  const promptMessages = promptToMessages(request.prompt)

  // `prompt: []` 过得了上面的 `undefined` 检查，却会投影成 `messages: []`。账号渠道
  // 的网关按 OpenAI 规范拒空数组，报的是 `messages must be a non-empty array` —— 那
  // 句里被拒的字段名是代理内部的，客户端只会以为自己什么都没发，而不是 prompt 为空。
  if (promptMessages.length === 0) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'prompt must be a non-empty string or string array',
        type: 'invalid_request_error',
        param: 'prompt',
      },
    }
    return
  }

  // 路由优先 + 可读错误：判定与 chat 路由共用 `resolveRouteRequest`（见该函数注释），
  // 两条入口不许对同一个名字给出两种答案。
  const routeOutcome = resolveRouteRequest(config.routes, request.model)

  // 路由名透出（与 chat 路由同因）：必须在任何 return 之前、也在流式首块 commit
  // 之前写；值过 toHeaderValue。
  if (routeOutcome.kind === 'routable' || routeOutcome.kind === 'disabled') {
    ctx.set('X-ModelPort-Route-Name', toHeaderValue(routeOutcome.route.name))
  }

  // 与 chat 路由同因：停用路由的 404 到不了供应商，必须进请求日志留痕
  // （`rejectionEntryFromContext` 与 server.ts 的 recordRejectedRequest 同一份条目形状）。
  if (routeOutcome.kind === 'disabled') {
    const disabledMessage = `Route '${routeOutcome.route.name}' is disabled`
    ctx.status = 404
    ctx.body = {
      error: {
        message: disabledMessage,
        type: 'invalid_request_error',
        param: 'model',
        code: 'route_disabled',
      },
    }
    const rejected = rejectionEntryFromContext(ctx, 404, 'route_disabled', disabledMessage)
    rejected.client = client
    storeManager.addRequestLog(rejected)
    storeManager.recordRequestInStats(false, rejected.latency, rejected.model || undefined)
    return
  }

  // `not-a-route`（含「点名 `auto` 而那条路由已被删除」）与 chat 路由同构：这里没有
  // 分支，直接落到下面 `!autoDecision` 的具名模型路径，找不到模型就是既有的
  // `503 no_available_account`。曾经的 `404 code:'route_not_found'` 与 URL 层未挂载
  // 共用一个 code 装两种语义，已删（见 `resolveRouteRequest` 注释）。
  const route = routeOutcome.kind === 'routable' ? routeOutcome.route : undefined
  const autoDecision = route !== undefined
    ? autoRouter.select(
        {
          model: request.model,
          messages: promptMessages,
          stream: request.stream,
        },
        config.loadBalanceStrategy,
        undefined,
        route
      )
    : null

  let selection: AccountSelection | null = null
  if (!autoDecision) {
    const preferredProviderId = modelMapper.getPreferredProvider(request.model)
    const preferredAccountId = modelMapper.getPreferredAccount(request.model)

    selection = loadBalancer.selectAccount(
      request.model,
      config.loadBalanceStrategy,
      preferredProviderId,
      preferredAccountId
    )

    if (!selection) {
      ctx.status = 503
      ctx.body = {
        error: {
          message: `No available account for model: ${request.model}`,
          type: 'service_unavailable_error',
          code: 'no_available_account',
        },
      }
      return
    }
  }

  const firstCandidate = autoDecision?.candidates[0]

  // 跳过清单透出（与 chat 路由同因）：候选被前置剔除不能静默消失，503 也带得上
  if (autoDecision && autoDecision.skipped.length > 0) {
    ctx.set('X-ModelPort-Auto-Skipped', toHeaderValue(autoDecision.skipped.join(',')))
  }

  if (autoDecision && !firstCandidate) {
    ctx.status = 503
    ctx.body = {
      error: {
        // 带上路由名：多条路由都可能报这个错，客户端要能看出是哪条没选出候选
        message: `No available model for route '${autoDecision.routeName}'`,
        type: 'service_unavailable_error',
        code: 'no_available_model',
      },
    }
    return
  }

  let account = selection ? selection.account : firstCandidate!.account
  let provider = selection ? selection.provider : firstCandidate!.provider
  let actualModel = selection ? selection.actualModel : firstCandidate!.actualModel
  let chosenCandidate: AutoCandidate | null = null

  const chatRequest = {
    // auto 路由时 chatRequest.model 由 forwardAutoCompletion 按候选替换
    model: autoDecision ? request.model : actualModel,
    messages: promptMessages,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    top_p: request.top_p,
    n: request.n,
    stream: request.stream,
    stop: request.stop,
  }

  proxyStatusManager.recordRequestStart(request.model, provider.id, account.id)

  try {
    let result: ForwardResult

    if (autoDecision) {
      const outcome = await requestForwarder.forwardAutoCompletion(
        chatRequest,
        autoDecision.candidates,
        {
          requestId,
          providerId: provider.id,
          accountId: account.id,
          model: request.model,
          actualModel,
          startTime,
          isStream: request.stream || false,
        },
        // 换家预算随 decision 走（与 chat 路由同因）
        { baseCap: autoDecision.baseCap }
      )

      if (!outcome) {
        ctx.status = 503
        ctx.body = {
          error: {
            message: `Route '${autoDecision.routeName}' produced no forward result`,
            type: 'service_unavailable_error',
            code: 'no_available_model',
          },
        }
        return
      }

      result = outcome.result
      chosenCandidate = outcome.candidate
      account = outcome.candidate.account
      provider = outcome.candidate.provider
      actualModel = outcome.candidate.actualModel
      // 与 chat 路由同因：供应商名可能是中文（账号渠道 `TRAE (字节)`、自定义
      // 供应商），直接写头值会让 Node 抛 ERR_INVALID_CHAR 并变成 500。
      ctx.set('X-ModelPort-Route', routeHeaderValue(actualModel, provider.name))
    } else {
      result = await requestForwarder.forwardChatCompletion(
        chatRequest,
        account,
        provider,
        actualModel,
        {
          requestId,
          providerId: provider.id,
          accountId: account.id,
          model: request.model,
          actualModel,
          startTime,
          isStream: request.stream || false,
        }
      )
    }

    const latency = Date.now() - startTime

    if (!result.success) {
      proxyStatusManager.recordRequestFailure(latency)

      ctx.status = result.status || 500
      ctx.body = {
        error: {
          message: result.error || 'Request failed',
          type: 'api_error',
        },
      }
      return
    }

    proxyStatusManager.recordRequestSuccess(latency)

    if (autoDecision) {
      // 只清这一档的限流退避，理由同 chat 路由：整账号清零会牵连同渠道别的模型
      autoRouter.clearAccountCooldown(account.id, actualModel)
      if (chosenCandidate) {
        autoRouter.rememberRoute(autoDecision.conversationKey, chosenCandidate, autoDecision.route)
      }
    }

    storeManager.updateAccount(account.id, {
      lastUsed: Date.now(),
      requestCount: (account.requestCount || 0) + 1,
      todayUsed: (account.todayUsed || 0) + 1,
    })

    storeManager.addLog('debug', `Request succeeded`, {
      requestId,
      providerId: provider.id,
      accountId: account.id,
      model: request.model,
      actualModel,
      latency,
      isStream: request.stream,
    })

    if (request.stream && result.stream) {
      ctx.set('Content-Type', 'text/event-stream')
      ctx.set('Cache-Control', 'no-cache')
      ctx.set('Connection', 'keep-alive')
      ctx.set('X-Accel-Buffering', 'no')

      const textTransform = createTextCompletionChunkTransform()
      if (result.skipTransform) {
        result.stream.pipe(textTransform)
      } else {
        const chatTransform = streamHandler.createTransformStream(actualModel, requestId)
        result.stream.pipe(chatTransform).pipe(textTransform)
      }
      ctx.body = textTransform

      // 立即发送响应头：客户端通常只对“响应头”计时（例如 10s），首个 token 可能远晚于此
      ctx.res.flushHeaders()

      // 客户端提前断开时中止上游流，避免继续占用账号与上游配额
      ctx.res.once('close', () => {
        if (ctx.res.writableEnded) return
        const source = result.stream as Readable
        if (!source.destroyed) source.destroy()
      })
    } else {
      ctx.set('Content-Type', 'application/json')
      ctx.body = toTextCompletion(result.body)
    }
  } catch (error) {
    const latency = Date.now() - startTime
    proxyStatusManager.recordRequestFailure(latency)

    ctx.status = 500
    ctx.body = {
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'internal_error',
      },
    }
  }
})

export default router
