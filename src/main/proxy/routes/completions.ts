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
import { autoRouter, AUTO_SKIPPED_REPORT_LIMIT, describeTransientCause } from '../autoRouter'
import type { AutoCandidate } from '../autoRouter'
import type { AccountSelection, ForwardResult } from '../types'
import { storeManager } from '../../store/store'
import { resolveRouteRequest, routePoolBreakMessage } from '../../store/modelRoutes'
import { rejectionEntryFromContext, selectionRefusalEntry } from '../rejectionLog'
import { createTextCompletionChunkTransform, toTextCompletion } from '../utils/textCompletion'
import { routeHeaderValue, toHeaderValue } from '../utils/headerValue'
import { clientHeaderValue, identifyClientByUserAgent } from '../../../shared/clientProfile'
import { nextDailyUsage } from '../../../shared/dailyUsage.ts'
import { mapForwardFailure, retryAfterHeader, withRequestId } from '../errorMapping'
import { autoExhaustedResponse, parseRetryAfterSeconds } from '../failover'
import { startSseHeartbeat } from '../utils/sseHeartbeat'
import { normalizeOutputCap } from '../utils/outputCap'
import { createReasoningEchoObserver, reasoningEchoApplies } from '../reasoningEcho.ts'

const router = new Router({ prefix: '/v1' })

interface CompletionRequest {
  model: string
  prompt: string | string[]
  max_tokens?: number
  /** 现名写法：与 chat 入口同一把折叠（`normalizeOutputCap`），否则上限被静默丢弃。 */
  max_completion_tokens?: number
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
  const traceHeader = ctx.headers['x-modelport-trace']
  const traceRequested = String(Array.isArray(traceHeader) ? traceHeader[0] : traceHeader ?? '').trim() === '1'
  if (traceRequested) ctx.set('X-ModelPort-Trace', 'captured')
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

  // 折叠排在所有读取之前：`chatRequest.max_tokens` 是这条路由唯一的出口，
  // 不折的话 `max_completion_tokens` 到不了上游，上限被静默丢弃（与 chat 入口同口径）。
  request = normalizeOutputCap(request)

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
  if (routeOutcome.kind === 'routable' || routeOutcome.kind === 'disabled' || routeOutcome.kind === 'broken-reference') {
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
    const rejected = rejectionEntryFromContext(ctx, 404, 'route_disabled', disabledMessage, requestId)
    rejected.client = client
    storeManager.addRequestLog(rejected)
    storeManager.recordRequestInStats(false, rejected.latency, rejected.model || undefined)
    return
  }

  // 池来源断了：与 chat 路由同因同形状（404 + 点名哪条引用），不许静默回落全目录。
  if (routeOutcome.kind === 'broken-reference') {
    const breakMessage = routePoolBreakMessage(routeOutcome.route, routeOutcome.reason)
    ctx.status = 404
    ctx.body = {
      error: {
        message: breakMessage,
        type: 'invalid_request_error',
        param: 'model',
        code: 'route_reference_broken',
      },
    }
    const rejected = rejectionEntryFromContext(ctx, 404, 'route_reference_broken', breakMessage, requestId)
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

  // 跳过清单透出（与 chat 路由同因同形）：候选被前置剔除不能静默消失，503 也带得上。
// 条数与折叠规则跟 chat 那条头一致，否则同一个池子在两条入口上读到的解释不一样长。
  if (autoDecision && autoDecision.skipped.length > 0) {
    const shown = autoDecision.skipped.slice(0, AUTO_SKIPPED_REPORT_LIMIT)
    const hidden = autoDecision.skipped.length - shown.length
    ctx.set('X-ModelPort-Auto-Skipped', toHeaderValue(
      hidden > 0 ? `${shown.join(',')},+${hidden}` : shown.join(',')
    ))
  }

  // 本轮真实服务者的窗口（判据与 chat 路由同一处：只承诺过了来源闸门的数，没把握就不设头）
  if (autoDecision?.advertisedContextWindow !== undefined) {
    ctx.set('X-ModelPort-Context-Window', String(autoDecision.advertisedContextWindow))
  }

  if (autoDecision && !firstCandidate) {
    // 判据与 chat 路由同源：瞬时空池报 429 + `Retry-After`，配置筛空才报 503。
    // 空池行的 `auto` 段也要有：`chainLength: 0` + `skipped` 是「为什么没有候选」的唯一读数，
    // 而这一笔没有任何上游往返，别处不会替它写。
    const refusalAuto = {
      route: autoDecision.routeName,
      prefer: autoDecision.prefer,
      reason: autoDecision.reason,
      attempts: 0,
      candidates: [],
      chainLength: 0,
      ...(autoDecision.skipped.length > 0
        ? { skipped: autoDecision.skipped.slice(0, AUTO_SKIPPED_REPORT_LIMIT) }
        : {}),
      ...(autoDecision.modelScope === undefined ? {} : { modelScope: autoDecision.modelScope }),
      ...(autoDecision.pinMiss === undefined ? {} : { pinMiss: autoDecision.pinMiss }),
      ...(autoDecision.pinStale === undefined ? {} : { pinStale: autoDecision.pinStale }),
      ...(autoDecision.pinCooling === undefined ? {} : { pinCooling: autoDecision.pinCooling }),
      ...(autoDecision.pinBlocked === undefined ? {} : { pinBlocked: autoDecision.pinBlocked }),
    }
    // 与 chat 路由同形：钉子指向池外模型时选路已把软钉退役并返回空链，这一轮必须
    // 明确说出来（503 + `pin_stale`），沉默换模型才是更坏的失败。
    const stalePin = autoDecision.pinStale
    if (stalePin !== undefined && stalePin.action === 'retired') {
      const message = `The pinned model '${stalePin.displayName}' is no longer part of route '${autoDecision.routeName}'; ` +
        'the pin was retired - retry to use the route\'s normal order'
      const body = {
        error: {
          message,
          type: 'service_unavailable_error',
          code: 'pin_stale',
          details: {
            pin: stalePin.displayName,
            scope: stalePin.scope,
            source: stalePin.source,
            action: stalePin.action,
          },
        },
      }
      ctx.status = 503
      ctx.body = body
      ctx.set('X-ModelPort-Pin', toHeaderValue(`stale=${stalePin.displayName};action=retired`))
      const refused = {
        ...selectionRefusalEntry(ctx, {
          statusCode: 503,
          code: 'pin_stale',
          type: 'service_unavailable_error',
          message,
          body,
          requestId,
          client,
        }),
        auto: refusalAuto,
      }
      storeManager.addRequestLog(refused)
      storeManager.recordRequestInStats(false, refused.latency, refused.model || undefined)
      return
    }
    const coolingPin = autoDecision.pinCooling
    if (coolingPin) {
      // 与 chat 路由同形：钉子留着（模型仍在池里），只是它的账号在退避 —— 429
      // 可重试，而不是 503「这颗钉已经失效」。
      const message = `The pinned model '${coolingPin.displayName}' on route '${autoDecision.routeName}' is cooling down after an upstream failure; retry in ${coolingPin.retryAfterSeconds}s`
      const body = {
        error: {
          message,
          type: 'rate_limit_error',
          code: 'model_temporarily_unavailable',
          details: {
            pin: coolingPin.displayName,
            scope: coolingPin.scope,
            source: coolingPin.source,
            retry_after_seconds: coolingPin.retryAfterSeconds,
          },
        },
      }
      ctx.set('Retry-After', String(coolingPin.retryAfterSeconds))
      ctx.status = 429
      ctx.body = body
      ctx.set('X-ModelPort-Pin', toHeaderValue(`cooling=${coolingPin.displayName};retry=${coolingPin.retryAfterSeconds}`))
      const refused = {
        ...selectionRefusalEntry(ctx, {
          statusCode: 429,
          code: 'model_temporarily_unavailable',
          type: 'rate_limit_error',
          message,
          body,
          requestId,
          client,
        }),
        auto: refusalAuto,
      }
      storeManager.addRequestLog(refused)
      storeManager.recordRequestInStats(false, refused.latency, refused.model || undefined)
      return
    }
    const transient = autoDecision.transientUnavailable
    if (transient) {
      const message = `All candidates for route '${autoDecision.routeName}' are temporarily unavailable (${describeTransientCause(transient.cause)}); retry in ${transient.retryAfterSeconds}s`
      const body = {
        error: {
          message,
          type: 'rate_limit_error',
          code: 'model_temporarily_unavailable',
          details: {
            cause: transient.cause,
            skipped: transient.skipped,
            retry_after_seconds: transient.retryAfterSeconds,
          },
        },
      }
      ctx.set('Retry-After', String(transient.retryAfterSeconds))
      ctx.status = 429
      ctx.body = body
      const refused = {
        ...selectionRefusalEntry(ctx, {
          statusCode: 429,
          code: 'model_temporarily_unavailable',
          type: 'rate_limit_error',
          message,
          body,
          requestId,
          client,
        }),
        auto: refusalAuto,
      }
      storeManager.addRequestLog(refused)
      storeManager.recordRequestInStats(false, refused.latency, refused.model || undefined)
      return
    }
    const message = `No available model for route '${autoDecision.routeName}'`
    const body = {
      error: {
        // 带上路由名：多条路由都可能报这个错，客户端要能看出是哪条没选出候选
        message,
        type: 'service_unavailable_error',
        code: 'no_available_model',
        // 与 chat 路由同源：被钉住的模型挡下这一轮时，缺的能力来自那颗钉而不是整池
        details: autoDecision.pinBlocked !== undefined
          ? { pin: autoDecision.pinBlocked.displayName, missing: autoDecision.pinBlocked.missing }
          : autoDecision.missing.length > 0
            ? { missing: autoDecision.missing }
            : autoDecision.skipped.length > 0
              ? { skipped: autoDecision.skipped.slice(0, AUTO_SKIPPED_REPORT_LIMIT) }
              : undefined,
      },
    }
    ctx.status = 503
    ctx.body = body
    if (autoDecision.pinBlocked !== undefined) {
      ctx.set('X-ModelPort-Pin', toHeaderValue(`blocked=${autoDecision.pinBlocked.displayName}`))
    }
    const refused = {
      ...selectionRefusalEntry(ctx, {
        statusCode: 503,
        code: 'no_available_model',
        type: 'service_unavailable_error',
        message,
        body,
        requestId,
        client,
      }),
      auto: refusalAuto,
    }
    storeManager.addRequestLog(refused)
    storeManager.recordRequestInStats(false, refused.latency, refused.model || undefined)
    return
  }

  let account = selection ? selection.account : firstCandidate!.account
  let provider = selection ? selection.provider : firstCandidate!.provider
  let actualModel = selection ? selection.actualModel : firstCandidate!.actualModel
  let chosenCandidate: AutoCandidate | null = null
  let autoAttempts = 0

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
          clientUserAgent: ctx.headers['user-agent'],
        },
        // 换家预算随 decision 走（与 chat 路由同因）
        { baseCap: autoDecision.baseCap, ...(autoDecision.wallClockBudgetMs === undefined ? {} : { wallClockBudgetMs: autoDecision.wallClockBudgetMs }) }
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
      autoAttempts = outcome.attempts
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
          clientUserAgent: ctx.headers['user-agent'],
        }
      )
    }

    const latency = Date.now() - startTime

    if (!result.success) {
      proxyStatusManager.recordRequestFailure(latency)

      // 与 chat 路由同一个收口：多家候选都失败是「这一路没有可服务候选」，
      // 不是最后一一家渠道的错误，也不是客户端的额度。
      const exhausted = autoDecision
        ? autoExhaustedResponse(
            result.status,
            autoDecision.routeName,
            result.error,
            autoAttempts,
            parseRetryAfterSeconds(result.retryAfter)
              ?? parseRetryAfterSeconds(
                retryAfterHeader(result.headers as Record<string, unknown> | undefined),
              ),
          )
        : null
      const mapped = exhausted
        ? {
            status: exhausted.status,
            type: exhausted.type,
            message: exhausted.message,
            param: null,
            code: exhausted.code as string | number | null,
            metadata: undefined,
            retryAfter: String(exhausted.retryAfterSeconds),
          }
        : mapForwardFailure({
            status: result.status,
            message: result.error,
            details: result.errorDetails,
            retryAfter: result.retryAfter,
          })
      const message = withRequestId(mapped.message, requestId)
      ctx.status = mapped.status
      if (mapped.status === 429 || mapped.status === 503) {
        const retryAfter =
          mapped.retryAfter
          ?? retryAfterHeader(result.headers as Record<string, unknown> | undefined)
        if (retryAfter) ctx.set('Retry-After', retryAfter)
      }
      const errorBody = {
        error: {
          message,
          type: mapped.type,
          param: mapped.param,
          code: mapped.code,
          ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }),
        },
      }
      ctx.body = errorBody
      storeManager.addRequestLog({
        timestamp: startTime,
        status: 'error',
        statusCode: mapped.status,
        method: 'POST',
        url: '/v1/completions',
        requestId,
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        attempts: result.attempts,
        upstreamRequestId: result.upstreamRequestId,
        captureBodies: traceRequested,
        responseStatus: mapped.status,
        responseBody: JSON.stringify(errorBody),
        latency,
        isStream: request.stream || false,
        errorMessage: message,
        upstreamStatus: result.status,
        errorType: mapped.type,
        errorCode: mapped.code,
        errorParam: mapped.param,
      })
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
      ...nextDailyUsage(account),
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
      // 思考观测点：这条路由的 SSE 与 chat 路由同源（账号渠道直通 / 聚合原始帧），
      // 共用 `proxy/reasoningEcho.ts` 里那份主线程缓存。
      const reasoningEcho = reasoningEchoApplies(provider)
        ? createReasoningEchoObserver()
        : undefined
      if (reasoningEcho !== undefined) {
        result.stream.on('data', (chunk: Buffer | string) => reasoningEcho.push(chunk))
        result.stream.once('end', () => reasoningEcho.finish())
        result.stream.once('error', () => reasoningEcho.finish())
        ctx.res.once('close', () => reasoningEcho.finish())
      }
      if (result.skipTransform) {
        result.stream.pipe(textTransform)
      } else {
        const chatTransform = streamHandler.createTransformStream(actualModel, requestId)
        result.stream.pipe(chatTransform).pipe(textTransform)
      }
      ctx.body = textTransform

      // 立即发送响应头：客户端通常只对“响应头”计时（例如 10s），首个 token 可能远晚于此
      ctx.res.flushHeaders()
      const heartbeat = startSseHeartbeat(textTransform)
      const stopPing = heartbeat.stop
      textTransform.once('finish', stopPing)
      textTransform.once('close', stopPing)

      // 客户端提前断开时中止上游流，避免继续占用账号与上游配额
      ctx.res.once('close', () => {
        stopPing()
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
