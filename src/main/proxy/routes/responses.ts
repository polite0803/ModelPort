/**
 * Proxy Service Module - OpenAI Responses Route
 *
 * 给只会说 Responses API 的客户端（Codex CLI、openai SDK 的 `client.responses.create`、
 * 各类 agent 框架）提供 `POST /v1/responses`。
 *
 * 实现与 `/v1/messages` 同一套做法：**入向翻译 + 回环复用** —— 请求在这里翻成 chat
 * 请求体，再以本机 HTTP 打回同一进程的 `/v1/chat/completions`。路由选择、故障转移、
 * 账号池、配额计量、上下文压缩、请求日志、Tool 违规检测因此只有一份实现；在这个文件里
 * 重写一遍迟早和 chat 那条分叉。代价是每次请求多一个本机 socket，没有网络开销。
 *
 * 与 anthropic 入口的两处**有意**不同：
 *
 * 1. **不做模型名兜底。** Claude Code 只会发 `claude-*`，改不了，所以那边必须落到
 *    `auto`；Codex 的模型名是用户自己的配置项，名字不认识就让它落到 chat 既有的
 *    `503 no_available_account`（或路由的 404），不替客户端猜一个模型跑 —— 那是
 *    「说的模型」与「跑的模型」不一致，比报错更糟。
 * 2. **有状态参数直接 400。** 本代理不保存任何 response，`previous_response_id`、
 *    `background: true`、`input[].item_reference` 都要求「网关记得上一次」，
 *    静默接受会让客户端以为后面还取得回来（见 `responsesUnsupportedParams`）。
 *    `store: true` 不拒绝（客户端只是申报允许保存），但用响应头声明这里没有留存。
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { PassThrough } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { storeManager } from '../../store/store'
import { rejectionEntryFromContext } from '../rejectionLog'
import {
  adoptInnerRequestId,
  copyModelPortHeaders,
  loopbackHostOf,
  loopbackRequestHeaders,
  readUpstreamError,
  setSseHeaders,
} from '../utils/inboundLoopback'
import { mapForwardFailure, withRequestId } from '../errorMapping'
import { startSseHeartbeat } from '../utils/sseHeartbeat'
import {
  chatResponseToResponseBody,
  createResponsesStreamTranslator,
  responsesHasInput,
  responsesToChatRequest,
  responsesUnsupportedParams,
} from '../../../shared/responsesInbound'

type Payload = Record<string, any>

const router = new Router({ prefix: '/v1' })

function errorTypeOf(status: number): string {
  if (status === 401 || status === 403) return 'authentication_error'
  if (status === 429) return 'rate_limit_error'
  if (status >= 400 && status < 500) return 'invalid_request_error'
  return 'api_error'
}

/** Responses 用的就是 OpenAI 的错误信封，所以这里只补形状、不改状态码。 */
function failWith(ctx: Context, status: number, message: string, code: string, param?: string): void {
  ctx.status = status
  ctx.set('Content-Type', 'application/json')
  ctx.body = {
    error: {
      message,
      type: errorTypeOf(status),
      ...(param ? { param } : {}),
      code,
    },
  }
}

/**
 * 本入口自己拒掉的请求到不了任何供应商，也就没有任何路由会记它。
 * 不写这行，客户端狂打一个错误参数在面板上读作「无流量」，而它自己看到的是错误。
 */
function recordRejection(ctx: Context, status: number, code: string, message: string): void {
  const entry = rejectionEntryFromContext(ctx, status, code, message)
  storeManager.addRequestLog(entry)
  storeManager.recordRequestInStats(false, entry.latency, entry.model || undefined)
}

router.post('/responses', async (ctx: Context) => {
  const requestId = randomUUID()
  const started = Date.now()
  const body = (ctx.request.body ?? {}) as Payload

  // 不变量：每个 `/v1/*` 响应都带 `X-Request-Id`。先挂本路由自己的 id，保证任何一条
  // 出口都有；拿到回环那笔 chat 的 id 后再换成它（日志行归的是那一笔）。
  ctx.set('X-Request-Id', requestId)

  const requestedModel = typeof body.model === 'string' ? body.model.trim() : ''
  if (requestedModel === '') {
    const message = "Missing required parameter: 'model'."
    failWith(ctx, 400, message, 'missing_required_parameter', 'model')
    recordRejection(ctx, 400, 'missing_required_parameter', message)
    return
  }

  // 语义上做不到的参数：点名拒绝，并给「怎么办」而不是只给参数名。
  const unsupported = responsesUnsupportedParams(body)
  if (unsupported.length > 0) {
    const message =
      `This proxy does not store responses, so ${unsupported.join(', ')} cannot be honored. ` +
      'Send the full conversation in `input` on every request instead.'
    failWith(ctx, 400, message, 'unsupported_parameter', unsupported[0])
    recordRejection(ctx, 400, 'unsupported_parameter', message)
    return
  }

  // 空 `input` 会投影成 `messages: []`，而那是上游按 OpenAI 规范直接拒的形状；被拒的
  // 字段名会变成代理内部的 `messages`，客户端只会以为自己什么都没发。这里按客户端
  // 自己那个名字报错。
  if (!responsesHasInput(body)) {
    const message = "Missing required parameter: 'input'."
    failWith(ctx, 400, message, 'missing_required_parameter', 'input')
    recordRejection(ctx, 400, 'missing_required_parameter', message)
    return
  }

  const wantsStream = body.stream === true
  const config = storeManager.getConfig()
  const chatRequest = responsesToChatRequest(body, { model: requestedModel, stream: wantsStream })

  // 客户端申报「允许保存这次 response」。本代理没有 response 存储，这一格是 no-op，
  // 但必须说出来：不然客户端会以为后面能按 id 取回（而那个 GET 本来也不存在）。
  if (body.store === true) ctx.set('X-ModelPort-Responses-Store', 'not-retained')

  const endpoint = `http://${loopbackHostOf(config)}:${config.proxyPort}/v1/chat/completions`

  // 客户端断开就掐掉回环请求：否则已经在跑的转发会继续占着账号和上游配额。
  const abort = new AbortController()
  ctx.res.once('close', () => {
    if (!ctx.res.writableEnded) abort.abort()
  })

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: loopbackRequestHeaders({
        authorization: ctx.get('Authorization'),
        xApiKey: ctx.get('x-api-key'),
        userAgent: ctx.get('User-Agent'),
        trace: ctx.get('x-modelport-trace'),
      }),
      body: JSON.stringify(chatRequest),
      signal: abort.signal,
    })
  } catch (error) {
    if (abort.signal.aborted) return
    failWith(ctx, 502, `Cannot reach internal chat endpoint: ${error instanceof Error ? error.message : String(error)}`, 'internal_relay_failed')
    return
  }

  adoptInnerRequestId(ctx, response)
  // 路由名、被剔除的渠道、降级说明都是 chat 那条链算好的，不透出去这个入口就成了
  // 「看得见答案、看不见依据」。
  copyModelPortHeaders(ctx, response)

  if (!response.ok) {
    // 内层已经是 OpenAI 信封（本代理自己的错误也在这个形状里）：保留状态码、
    // type、code、param，只补客户端可见的 request id。经过回环不应换名字。
    const innerError = await readUpstreamError(response)
    const mapped = mapForwardFailure({
      status: innerError.status,
      message: innerError.message,
      details: innerError,
      retryAfter: innerError.retryAfter,
    })
    ctx.status = mapped.status
    ctx.set('Content-Type', 'application/json')
    if ((mapped.status === 429 || mapped.status === 503) && mapped.retryAfter) {
      ctx.set('Retry-After', mapped.retryAfter)
    }
    ctx.body = {
      error: {
        message: withRequestId(mapped.message, requestId),
        type: mapped.type,
        param: mapped.param,
        code: mapped.code,
        ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }),
      },
    }
    return
  }

  if (!wantsStream) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      failWith(ctx, 502, 'Upstream returned a non-JSON response', 'invalid_upstream_response')
      return
    }
    // 回显客户端发来的模型名：它按这个名字做上下文预算与计费，换成网关内部
    // 名字（比如客户端点名路由、实际跑的是某个真模型）会被读成「模型被换了」。
    ctx.set('Content-Type', 'application/json')
    ctx.body = chatResponseToResponseBody(payload, {
      model: requestedModel,
      fallbackId: requestId,
      clientPlatform: process.platform,
    })
    return
  }

  if (!response.body) {
    failWith(ctx, 502, 'Upstream returned an empty stream', 'invalid_upstream_response')
    return
  }

  // Responses 的 `usage` 在没报到时就是 `null`（本仓不变量），没有 anthropic 那个
  // 「`message_start` 必须给数字」的坑，所以这里不需要估算，也不需要估算声明头。
  const translator = createResponsesStreamTranslator({
    model: requestedModel,
    fallbackId: requestId,
    clientPlatform: process.platform,
  })
  const out = new PassThrough()

  void (async () => {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = translator.push(Buffer.from(value).toString('utf8'))
        if (text !== '') out.write(text)
      }
      const tail = translator.end()
      if (tail !== '') out.write(tail)
    } catch (error) {
      if (out.destroyed) return
      const message = error instanceof Error ? error.message : 'stream failed'
      const frame = translator.fail(message)
      if (frame !== '') out.write(frame)
      storeManager.addLog('error', `Responses stream error: ${message}`, {
        requestId,
        data: { requestedModel, latency: Date.now() - started },
      })
    } finally {
      reader.releaseLock?.()
      if (!out.destroyed) out.end()
    }
  })()

  setSseHeaders(ctx)
  ctx.status = 200
  ctx.body = out
  // 与 /v1/messages 同口径：先交响应头，再用心跳覆盖上游的长 prefill。
  ctx.res.flushHeaders()
  const heartbeat = startSseHeartbeat(out)
  const stopPing = heartbeat.stop
  out.once('finish', stopPing)
  out.once('close', stopPing)
  ctx.res.once('close', () => {
    stopPing()
    if (!out.destroyed) out.destroy()
  })
  // 先把响应头发出去：客户端对「响应头超时」有自己的计时，上游首个 token 可能
  // 远晚于此，等数据再发头会被判超时。
  ctx.res.flushHeaders()

  ctx.res.once('close', () => {
    if (!out.destroyed) out.destroy()
  })
})

export default router
