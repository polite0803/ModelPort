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
import { clientSessionKey } from '../../../shared/clientSessionKey.ts'
import { CLIENT_HEADER, clientStatsKey, identifyClient } from '../../../shared/clientProfile'
import { describeTransportError, mapForwardFailure, withRequestId } from '../errorMapping'
import { startSseHeartbeat } from '../utils/sseHeartbeat'
import {
  chatResponseToResponseBody,
  createResponsesStreamTranslator,
  freeformToolNamesOf,
  namespaceChildrenOf,
  responsesHasInput,
  responsesToChatRequest,
  responsesUnsupportedParams,
  undeliverableToolDeclarations,
} from '../../../shared/responsesInbound'
import { toHeaderValue } from '../utils/headerValue'
import {
  DEFAULT_REPETITION_GUARD,
  RUNAWAY_MIN_CHARS,
  createChatStreamProbe,
  judgeRunawayText,
  judgeRunawayTurn,
  type RunawayTurnReading,
} from '../../../shared/streamRepetition'

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
 * 行上的 id 取响应头已挂的那把，否则客户端拿着 id 也查不到这条行。
 */
function recordRejection(ctx: Context, status: number, code: string, message: string): void {
  const entry = rejectionEntryFromContext(ctx, status, code, message, ctx.response.get('X-Request-Id'))
  storeManager.addRequestLog(entry)
  const client = identifyClient({
    declared: ctx.headers[CLIENT_HEADER],
    userAgent: ctx.headers['user-agent'],
    apiKeyName: typeof ctx.state.clientKeyName === 'string' ? ctx.state.clientKeyName : undefined,
  })
  storeManager.recordRequestInStats(
    false,
    entry.latency,
    entry.model || undefined,
    undefined,
    undefined,
    clientStatsKey(client),
  )
}

/**
 * 「重发」是网关单方面的决定，客户端看不见（响应头早已发出），因此必须留一行日志：
 * 否则同一回合的两次上游消耗在面板上只是两条互不相关、都写 success 的请求行。
 */
function logRunawayRetry(
  requestId: string,
  model: string,
  attempt: number,
  verdict: RunawayTurnReading,
): void {
  storeManager.addLog('warn', `Responses runaway turn re-issued (attempt ${attempt} -> ${attempt + 1})`, {
    requestId,
    data: {
      model,
      contentChars: verdict.contentChars,
      toolCallDeltas: verdict.toolCallDeltas,
      lines: verdict.repetition?.lines,
      dedupRatio: verdict.repetition?.dedupRatio,
    },
  })
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
  // 自由文本工具（Codex 的 apply_patch）的名字要一路带到出向：回来的调用项得是
  // `custom_tool_call`，客户端才会真的执行它。
  const freeformTools = freeformToolNamesOf(body)
  // 声明了但 chat 协议表达不了的条目（无名托管工具），逐请求报出来。
  // `type:'namespace'` 分组不在这里：子工具已展开成可调用条目，另有 `…-Expanded` 头。
  const undeliverable = undeliverableToolDeclarations(body)
  if (undeliverable.length > 0) {
    ctx.set(
      'X-ModelPort-Tools-Dropped',
      toHeaderValue(undeliverable.map(entry => (entry.name === '' ? entry.kind : `${entry.kind}/${entry.name}`)).join(',')),
    )
  }
  // namespace 分组的子工具已展开送出：数量写进响应头，排障时能分清「模型不肯用」
  // 与「网关没送到」。
  const expandedChildren = namespaceChildrenOf(body)
  if (expandedChildren.length > 0) {
    ctx.set(
      'X-ModelPort-Tools-Expanded',
      toHeaderValue(`${expandedChildren.length}(${[...new Set(expandedChildren.map(child => child.namespace))].join('+')})`),
    )
  }
  // 客户端声明了工具、最后一条都没送到上游：这一轮模型手里没有任何可调用对象。
  // 不伪造占位定义（那等于网关替客户端发明工具），也不退回原始定义（严格上游会整条
  // 400，把本来能用的回合打没），但必须让这件事可见 —— 2026-11-20 实测正是这种
  // 「空工具集」促使模型自己发明调用语法（`<tool_call>` / DSML 文本）。
  const declaredCount = Array.isArray((body as Payload)?.tools) ? (body as Payload).tools.length : 0
  if (declaredCount > 0 && chatRequest.tools === undefined) {
    ctx.set('X-ModelPort-Tools-Empty', '1')
    storeManager.addLog('warn', '客户端声明了工具但一条都没送到上游', {
      requestId,
      data: { declared: declaredCount, dropped: undeliverable.map(entry => entry.kind) },
    })
  }

  // 客户端申报「允许保存这次 response」。本代理没有 response 存储，这一格是 no-op，
  // 但必须说出来：不然客户端会以为后面能按 id 取回（而那个 GET 本来也不存在）。
  if (body.store === true) ctx.set('X-ModelPort-Responses-Store', 'not-retained')

  const endpoint = `http://${loopbackHostOf(config)}:${config.proxyPort}/v1/chat/completions`
  // 「本轮带了工具」是跑飞判据的前提：纯问答客户端里一段长正文就是合法答案，只有
  // agent 回合里「一个工具调用都没有」才等于这一轮什么也没做。
  const toolsOffered = Array.isArray(chatRequest.tools) && chatRequest.tools.length > 0
  const repetitionGuard = config.streamRepetitionGuard ?? DEFAULT_REPETITION_GUARD
  // 重发上限：两发都跑飞说明上游这一刻就是这个状态，再重发只是多烧一遍配额。
  const maxAttempts = toolsOffered && repetitionGuard.enabled ? 2 : 1

  // 客户端断开就掐掉回环请求：否则已经在跑的转发会继续占着账号和上游配额。
  // 每次重发换一个 controller，但「断开」是粘的 —— 断开之后不再发起新的一发。
  let clientGone = false
  let attemptAbort = new AbortController()
  ctx.res.once('close', () => {
    if (ctx.res.writableEnded) return
    clientGone = true
    attemptAbort.abort()
  })

  const requestChat = (): Promise<Response> => {
    attemptAbort = new AbortController()
    if (clientGone) attemptAbort.abort()
    return fetch(endpoint, {
      method: 'POST',
      headers: loopbackRequestHeaders({
        authorization: ctx.get('Authorization'),
        xApiKey: ctx.get('x-api-key'),
        userAgent: ctx.get('User-Agent'),
        trace: ctx.get('x-modelport-trace'),
        // 客户端给的会话标识（Responses 的 prompt_cache_key / user，Anthropic 的
        // metadata.user_id）—— chat 侧拿它当粘性键，摘要改历史就不会中途换家
        ...(() => {
          const session = clientSessionKey({ body, headers: ctx.headers })
          return session === undefined
            ? {}
            : { sessionId: session.value, sessionSource: session.source }
        })(),
      }),
      body: JSON.stringify(chatRequest),
      signal: attemptAbort.signal,
    })
  }

  let response: Response
  try {
    response = await requestChat()
  } catch (error) {
    if (attemptAbort.signal.aborted) return
    const detail = error instanceof Error ? error.message : String(error)
    const cause = (error as { cause?: unknown }).cause
    // Node 的 `fetch failed` 把真正的原因（ECONNREFUSED / ENETUNREACH）藏在 cause 里，
    // 只印 message 会让回环失败在日志里永远是一句查不下去的「fetch failed」。
    const reason = cause === undefined ? detail : `${detail} (${describeTransportError(cause)})`
    const message = `Cannot reach internal chat endpoint: ${reason}`
    failWith(ctx, 502, message, 'internal_relay_failed')
    recordRejection(ctx, 502, 'internal_relay_failed', message)
    return
  }

  // 之后客户端可见的 id 引用一律用认领后的这把：外层 id 没有日志行。
  const relayRequestId = adoptInnerRequestId(ctx, response, requestId)
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
        message: withRequestId(mapped.message, relayRequestId),
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
    for (let attempt = 1; ; attempt += 1) {
      try {
        payload = await response.json()
      } catch {
        failWith(ctx, 502, 'Upstream returned a non-JSON response', 'invalid_upstream_response')
        return
      }
      if (attempt >= maxAttempts) break
      const message = (payload as Payload | undefined)?.choices?.[0]?.message as Payload | undefined
      const text = typeof message?.content === 'string' ? message.content : ''
      const calls = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0
      const verdict = judgeRunawayText(text, calls, toolsOffered, repetitionGuard)
      if (!verdict.degenerate) break
      // 跑飞的一发不进客户端历史：重发同一条请求，把第二发当交付物。
      logRunawayRetry(relayRequestId, requestedModel, attempt, verdict)
      let next: Response | undefined
      try {
        next = await requestChat()
      } catch {
        next = undefined
      }
      if (next === undefined || !next.ok) break // 重发打不通：第一发至少有内容，交它
      response = next
    }
    // 回显客户端发来的模型名：它按这个名字做上下文预算与计费，换成网关内部
    // 名字（比如客户端点名路由、实际跑的是某个真模型）会被读成「模型被换了」。
    ctx.set('Content-Type', 'application/json')
    ctx.body = chatResponseToResponseBody(payload, {
      model: requestedModel,
      fallbackId: relayRequestId,
      clientPlatform: process.platform,
      freeformTools,
    })
    return
  }

  if (!response.body) {
    failWith(ctx, 502, 'Upstream returned an empty stream', 'invalid_upstream_response')
    return
  }

  // Responses 的 `usage` 在没报到时就是 `null`（本仓不变量），没有 anthropic 那个
  // 「`message_start` 必须给数字」的坑，所以这里不需要估算，也不需要估算声明头。
  const makeTranslator = () => createResponsesStreamTranslator({
    model: requestedModel,
    fallbackId: relayRequestId,
    clientPlatform: process.platform,
    freeformTools,
  })
  const out = new PassThrough()
  out.on('error', () => {})

  /** 一发里攒下的、**还没交给客户端**的翻译帧（重发时整发丢弃）。 */
  type Held = { pieces: string[]; translator: ReturnType<typeof makeTranslator> }

  const finishHeld = (held: Held): void => {
    if (!out.destroyed) for (const piece of held.pieces) out.write(piece)
    held.pieces.length = 0
    const tail = held.translator.end()
    if (tail !== '' && !out.destroyed) out.write(tail)
  }

  type AttemptResult =
    | { kind: 'delivered' }
    | { kind: 'end'; held: Held }
    | { kind: 'retry'; held: Held; verdict: RunawayTurnReading }

  /**
   * 跑一发回环流，并决定「交出去」还是「整发丢掉重发」。
   *
   * 为什么要缓冲：重发的前提是客户端还没看到第一发。assistant 正文从第一个字节起
   * 就压着不交，直到 (a) 出现工具调用增量 —— 说明这一轮确实在干活，立刻放行并转为
   * 实时转发；或 (b) 流结束 —— 判跑飞（0 调用 + ≥6000 字 + 尾部去重率塌了），
   * 判中就整发丢弃；或 (c) 中途已经攒到 6000 字还没调用且尾部塌了 —— 不必等模型
   * 把输出上限撞满（2026-11-19 那一轮跑了 5 分钟），当场掐掉这一发上游再重发。
   *
   * 代价：带工具且「只有正文」的回合，正文会等到回合结束才一次出现。这类回合在
   * Codex goal 循环里通常只有一两句计划（本机实测 ~4-11 s）；长正文回合很少。
   * 换来的是客户端历史里不会再落进 16 KB 的 `执行。` 复读。
   */
  const runAttempt = async (incoming: Response, attempt: number): Promise<AttemptResult> => {
    const translator = makeTranslator()
    const held: Held = { pieces: [], translator }
    let holding = true
    const probe = createChatStreamProbe()
    let raw = ''
    const flush = (): void => {
      holding = false
      if (out.destroyed) return
      for (const piece of held.pieces) out.write(piece)
      held.pieces.length = 0
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      reader = (incoming.body as ReadableStream<Uint8Array>).getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value).toString('utf8')
        raw += chunk
        probe.push(chunk)
        const piece = translator.push(chunk)
        if (!holding) {
          if (piece !== '' && !out.destroyed) out.write(piece)
          continue
        }
        if (piece !== '') held.pieces.push(piece)
        const reading = probe.reading()
        if (reading.toolCallDeltas > 0) {
          flush()
          continue
        }
        if (reading.contentChars < RUNAWAY_MIN_CHARS) continue
        const verdict = judgeRunawayTurn(raw, toolsOffered, repetitionGuard)
        if (!verdict.degenerate || attempt >= maxAttempts) continue
        await reader.cancel().catch(() => {})
        return { kind: 'retry', held, verdict }
      }
    } catch (error) {
      if (out.destroyed) return { kind: 'delivered' }
      const message = error instanceof Error ? error.message : 'stream failed'
      if (!holding) {
        const frame = translator.fail(message)
        if (frame !== '' && !out.destroyed) out.write(frame)
        storeManager.addLog('error', `Responses stream error: ${message}`, {
          requestId: relayRequestId,
          data: { requestedModel, latency: Date.now() - started },
        })
        return { kind: 'delivered' }
      }
      // 一个字节都还没交出去：把这一发的部分帧与错误帧一起给出，不能静默断开。
      const frame = translator.fail(message)
      if (frame !== '') held.pieces.push(frame)
      return { kind: 'end', held }
    } finally {
      if (reader !== undefined) {
        try {
          reader.releaseLock()
        } catch {
          // 已 cancel 的 reader releaseLock 会抛，这里不关心。
        }
      }
    }
    if (holding) {
      const verdict = judgeRunawayTurn(raw, toolsOffered, repetitionGuard)
      if (verdict.degenerate && attempt < maxAttempts) return { kind: 'retry', held, verdict }
      flush()
    }
    const tail = translator.end()
    if (tail !== '' && !out.destroyed) out.write(tail)
    return { kind: 'delivered' }
  }

  void (async () => {
    let current = response
    for (let attempt = 1; ; attempt += 1) {
      const result = await runAttempt(current, attempt)
      if (result.kind === 'delivered') return
      if (result.kind === 'end') {
        finishHeld(result.held)
        return
      }
      logRunawayRetry(relayRequestId, requestedModel, attempt, result.verdict)
      let next: Response | undefined
      try {
        next = await requestChat()
      } catch {
        next = undefined
      }
      if (next === undefined || !next.ok) {
        // 重发打不通：把跑飞的那一发交出去并正常收尾。它至少是上游的真实回答，
        // 比让客户端空等到超时强。
        finishHeld(result.held)
        return
      }
      current = next
    }
  })().finally(() => {
    if (!out.destroyed) out.end()
  })

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
