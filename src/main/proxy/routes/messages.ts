/**
 * Proxy Service Module - Anthropic Messages Route
 *
 * 给只会说 anthropic 的客户端（Claude Code / Claude Desktop / 其它带
 * `anthropic-version` 的工具）提供 `/v1/messages`。
 *
 * 实现方式是**入向翻译 + 回环复用**：请求在这里被翻成 chat 请求体，再以本机
 * HTTP 请求打回同一进程的 `/v1/chat/completions`。这样路由选择、故障转移、
 * 账号池、配额计量、上下文压缩、请求日志、Tool 违规检测全部原样复用，
 * 一条都不需要在这个文件里重写（重写就会出现两套行为，日后必然分叉）。
 *
 * 代价是每次请求多一次本机环回，没有网络开销，只是多一个 socket。
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { PassThrough } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { storeManager } from '../../store/store'
import { rejectionEntryFromContext } from '../rejectionLog'
import { toHeaderValue } from '../utils/headerValue'
import {
  adoptInnerRequestId,
  copyModelPortHeaders,
  loopbackHostOf,
  loopbackRequestHeaders,
  readUpstreamError,
  setSseHeaders,
  type InboundUpstreamError,
} from '../utils/inboundLoopback'
import { clientSessionKey } from '../../../shared/clientSessionKey.ts'
import { findModelRoute, enabledModelRoutes, resolveRouteRequest } from '../../store/modelRoutes'
import { isMappingActive } from '../../store/modelServing'
import {
  anthropicErrorBody,
  anthropicErrorTypeOf,
  anthropicErrorTypeOr,
  anthropicToChatRequest,
  chatResponseToAnthropicMessage,
  createAnthropicStreamTranslator,
  estimateAnthropicInputTokens,
  estimateAnthropicInputTokensDetailed,
} from '../../../shared/anthropicWire'
import type { AppConfig } from '../../../shared/types'
import { mapForwardFailure, withRequestId } from '../errorMapping'
import { startSseHeartbeat } from '../utils/sseHeartbeat'

type Payload = Record<string, any>

const router = new Router({ prefix: '/v1' })

/**
 * 网关是否认识这个名字。
 *
 * 顺序必须与 `/v1/models`、与 chat 的请求解析一致：路由优先，其次用户自建别名，
 * 最后才是供应商目录里的模型名。认识与否只看名字，不看账号是否可用 —— 那是
 * 转发层的事，这里越权判断只会让「有名字但账号临时不可用」的模型被提前拒掉。
 *
 * `routableOnly`：解析**兜底目标**（defaultModel / modelMap 目标 / `auto`）时，
 * 只看 `resolveRouteRequest` 判定为 `routable` 的路由；停用或池引用断掉的路由
 * 不能当兜底，否则请求会在内层 chat 立刻拿到 404。客户端显式点名的名字仍走
 * 默认口径（`routableOnly = false`），保留可读的 `route_disabled` / `route_reference_broken`。
 */
function gatewayKnowsModel(
  name: string,
  config: AppConfig,
  routableOnly = false,
): boolean {
  const trimmed = name.trim()
  if (trimmed === '') return false
  const lower = trimmed.toLowerCase()

  if (findModelRoute(config.routes, trimmed) !== undefined) {
    return routableOnly
      ? resolveRouteRequest(config.routes, trimmed).kind === 'routable'
      : true
  }

  for (const [key, mapping] of Object.entries(config.modelMappings ?? {})) {
    // 停用的别名不认 —— 与 modelMapper / loadbalancer 同一个判据，否则 anthropic
    // 入口会「认识」一个 chat 入口根本跑不了的名字。
    if (isMappingActive(mapping) && key.trim().toLowerCase() === lower) return true
  }

  for (const provider of storeManager.getProviders()) {
    if (!provider.enabled) continue
    const models = storeManager.getEffectiveModels(provider.id)
    if (models.some((model) => model.displayName.trim().toLowerCase() === lower)) return true
  }

  return false
}

export interface ResolvedAnthropicModel {
  model: string
  /** 解析来源，只用于日志：`as-requested` / `model-map` / `default` / `fallback`。 */
  source: string
}

/**
 * 客户端发来的 anthropic 模型名（`claude-sonnet-4-5-20250929` 之类）→ 网关模型名。
 *
 * 网关没有 `claude-*`，所以只有三种情形能通：
 * 1. 客户端**本来就发着网关模型名**（用户手填的配置），原样透传；
 * 2. 用户在 `anthropicInbound.modelMap` 里配了映射（精确键优先，否则按最长前缀）；
 * 3. 落到 `anthropicInbound.defaultModel`，缺省 `auto`。
 *
 * 四条来源，顺序即优先级：
 * 1. 客户端**本来就发着网关认识的名字**（用户手填的配置），原样透传（`as-requested`）；
 * 2. 用户在 `anthropicInbound.modelMap` 里配了映射（精确键优先，否则按最长前缀）（`model-map`）；
 * 3. `anthropicInbound.defaultModel`，没配则落到 `auto`（`default`）；
 * 4. 连 `auto` 都没有时，取第一条**可路由的**（启用且池引用完整）路由名（`fallback`）。
 *
 * ⚠️ 3 与 4 是**有意的兜底**（Claude Code 只会发 `claude-*` 这类名字，硬报 400
 * 等于这个入口对本应用永远不可用），代价是「说的模型」与「跑的模型」可能不一致。
 * 因此这条兜底必须可被外部看见：响应头 `X-ModelPort-Anthropic-Resolved` + 一条
 * debug 日志（见调用处）。只有四条来源全部落空才报错，那时报的是「怎么修」而不是
 * 一句「模型不存在」。
 */
export function resolveAnthropicModel(requested: string, config: AppConfig): ResolvedAnthropicModel {
  const raw = requested.trim()
  if (raw !== '' && gatewayKnowsModel(raw, config)) {
    return { model: raw, source: 'as-requested' }
  }

  const inbound = config.anthropicInbound
  const map = inbound?.modelMap ?? {}

  if (raw !== '') {
    const lower = raw.toLowerCase()
    const exactKey = Object.keys(map).find((key) => key.trim().toLowerCase() === lower)
    if (exactKey !== undefined) {
      const target = String(map[exactKey] ?? '').trim()
      if (target !== '' && gatewayKnowsModel(target, config, true)) {
        return { model: target, source: 'model-map' }
      }
    }

    // 前缀匹配：`claude-*` 这种通配写法只可能配前缀，取最长的一个（最具体）。
    let best: { key: string; target: string } | null = null
    for (const [key, value] of Object.entries(map)) {
      const prefix = key.trim().toLowerCase()
      if (prefix === '' || !lower.startsWith(prefix)) continue
      const target = String(value ?? '').trim()
      if (target === '' || !gatewayKnowsModel(target, config, true)) continue
      if (best === null || prefix.length > best.key.length) best = { key: prefix, target }
    }
    if (best !== null) return { model: best.target, source: 'model-map' }
  }

  const configured = String(inbound?.defaultModel ?? '').trim()
  if (configured !== '' && gatewayKnowsModel(configured, config, true)) {
    return { model: configured, source: 'default' }
  }
  if (gatewayKnowsModel('auto', config, true)) {
    return { model: 'auto', source: 'default' }
  }

  const routes = enabledModelRoutes(config.routes).filter(
    (route) => resolveRouteRequest(config.routes, route.name).kind === 'routable'
  )
  if (routes.length > 0) {
    return { model: routes[0].name, source: 'fallback' }
  }

  throw new Error(
    `Model '${requested}' cannot be resolved: no route or model of that name is configured. ` +
      `Configure anthropicInbound.defaultModel (or anthropicInbound.modelMap) to point anthropic clients at a gateway model.`
  )
}

function failWith(ctx: Context, status: number, message: string): void {
  ctx.status = status
  ctx.set('Content-Type', 'application/json')
  ctx.body = anthropicErrorBody(message, anthropicErrorTypeOf(status))
}

/**
 * 上游失败交给 Anthropic 信封：状态码、type、message 原样保留。
 *
 * Anthropic 的错误对象只有 `{type, message}`，没有 `code/param` 的位置；把上游的
 * 机读字段放进响应头，既不破坏客户端解析，也不让信息在回环处消失。
 */
function failWithUpstream(ctx: Context, error: InboundUpstreamError, requestId: string): void {
  const mapped = mapForwardFailure({
    status: error.status,
    message: error.message,
    details: error,
    retryAfter: error.retryAfter,
  }, 'anthropic')
  ctx.status = mapped.status
  ctx.set('Content-Type', 'application/json')
  ctx.body = anthropicErrorBody(
    withRequestId(mapped.message, requestId),
    anthropicErrorTypeOr(mapped.status, mapped.type),
  )
  if ((mapped.status === 429 || mapped.status === 503) && mapped.retryAfter) {
    ctx.set('Retry-After', mapped.retryAfter)
  }
  if (mapped.code !== null && mapped.code !== undefined) {
    ctx.set('X-ModelPort-Upstream-Code', toHeaderValue(String(mapped.code)))
  }
  if (mapped.param) {
    ctx.set('X-ModelPort-Upstream-Param', toHeaderValue(mapped.param))
  }
}

/**
 * 本入口自己拒掉的请求（名字解析失败、回环不可达）到不了 chat 泳道，也就没有
 * 任何路由会记它。不写这行，客户端报错里携带的 id 在请求日志里查不到现场。
 * 行上的 id 取响应头已挂的那把，与 `/v1/responses` 同一口径。
 */
function recordRejection(ctx: Context, status: number, code: string, message: string): void {
  const entry = rejectionEntryFromContext(ctx, status, code, message, ctx.response.get('X-Request-Id'))
  storeManager.addRequestLog(entry)
  storeManager.recordRequestInStats(false, entry.latency, entry.model || undefined)
}

router.post('/messages', async (ctx: Context) => {
  const requestId = randomUUID()
  const started = Date.now()
  const body = (ctx.request.body ?? {}) as Payload
  // 每个 `/v1/*` 响应都要带 `X-Request-Id`（Public API Contract 里的不变量）。先挂
  // 本路由自己的 id，保证「任何一条出口都有 id」；拿到回环那笔 chat 的 id 后再覆盖
  // 成它 —— 请求日志行归的是 chat 那一笔，对不上就等于客户端报错时查不到现场。
  ctx.set('X-Request-Id', requestId)

  const requestedModel = typeof body.model === 'string' ? body.model : ''
  const wantsStream = body.stream === true

  const config = storeManager.getConfig()

  let resolved: ResolvedAnthropicModel
  try {
    resolved = resolveAnthropicModel(requestedModel, config)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model cannot be resolved'
    failWith(ctx, 400, message)
    recordRejection(ctx, 400, 'model_not_resolved', message)
    return
  }

  if (resolved.source !== 'as-requested') {
    // 客户端点名了一个网关里没有的名字，而这条链路**照旧要跑**（落到 `auto` 或
    // 设置里指定的默认模型）。响应体里回显的是客户端自己那个名字（否则 Claude Code
    // 认为模型被换了直接报错），所以「实际跑的是谁」只能在这里透明化：
    // 日志一条 + 响应头一条。二者缺一，这个兜底就从「省事」变成「骗人」。
    ctx.set('X-ModelPort-Anthropic-Resolved', toHeaderValue(`${resolved.model} (${resolved.source})`))
    storeManager.addLog('debug', `Anthropic model mapped: ${requestedModel || '(empty)'} -> ${resolved.model}`, {
      requestId,
      data: { requestedModel, resolvedModel: resolved.model, source: resolved.source },
    })
  }

  const { request: chatRequest, dropped } = anthropicToChatRequest(body, {
    model: resolved.model,
    stream: wantsStream,
    // 显式 `false` 才关：默认把附件真的送出去，让「上游不吃 file 块」以报错的形式
    // 暴露，而不是以「模型答非所问」的形式。
    documentsAsFileParts: config.anthropicInbound?.documentPassThrough !== false,
  })

  if (dropped.length > 0) {
    // 客户端发来了本网关翻不出去的东西（`document` 附件块、`thinking`、`top_k`…）。
    // 请求照发 —— 拒掉整个请求对客户端更糟 —— 但这一格缺席必须留痕：日志一条 + 响应头
    // 一条，与 `X-ModelPort-Usage-Estimated` 同一套做法。少了这两条，用户附件传不上去时
    // 看到的就是一次「模型答非所问」，而现场什么都查不到。
    const summary = dropped.join(',')
    ctx.set('X-ModelPort-Anthropic-Dropped', toHeaderValue(summary))
    storeManager.addLog('warn', `Anthropic inbound not translated: ${summary}`, {
      requestId,
      data: { requestedModel, resolvedModel: resolved.model, dropped },
    })
  }

  const endpoint = `http://${loopbackHostOf(config)}:${config.proxyPort}/v1/chat/completions`

  // 客户端断开就掐掉回环请求：否则 sentry 已经在跑的转发会继续占着账号和上游配额。
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
      signal: abort.signal,
    })
  } catch (error) {
    if (abort.signal.aborted) return
    const message = `Cannot reach internal chat endpoint: ${error instanceof Error ? error.message : String(error)}`
    failWith(ctx, 502, message)
    recordRejection(ctx, 502, 'internal_relay_failed', message)
    return
  }

  // 回环那笔 chat 请求才是日志行的归属（`chatcmpl-*`），拿到就把头换成它。
  // 之后客户端可见的 id 引用一律用认领后的这把：外层 id 没有日志行。
  const relayRequestId = adoptInnerRequestId(ctx, response, requestId)
  // chat 那条链算好的诊断头（路由名、被剔除的渠道、降级说明、压缩读数、client）在这里
  // 透出去。不透的话，走 anthropic 的客户端只看得见回答、看不见依据，而
  // `/v1/responses` 那半边已经透 —— 同一份机制不该差这一格。
  copyModelPortHeaders(ctx, response)

  if (!response.ok) {
    failWithUpstream(ctx, await readUpstreamError(response), relayRequestId)
    return
  }

  if (!wantsStream) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      failWith(ctx, 502, 'Upstream returned a non-JSON response')
      return
    }
    // 回显客户端自己发的模型名：它按这个名字做上下文预算与 UI 显示，
    // 换成网关内部名字会让 Claude Code 认为「模型被换了」。
    ctx.set('Content-Type', 'application/json')
    ctx.body = chatResponseToAnthropicMessage(payload, {
      model: requestedModel || resolved.model,
      fallbackId: relayRequestId,
    })
    return
  }

  if (!response.body) {
    failWith(ctx, 502, 'Upstream returned an empty stream')
    return
  }

  // `message_start.usage.input_tokens` 在 anthropic 形状里是必填数字，而那一刻上游
  // 还没报任何用量，所以填本机估算并**用响应头声明这一格是估的**；真数到达后会出现在
  // `message_delta.usage.input_tokens` 里。填 0 不是「没有数」而是「申报这次没消耗」。
  const estimatedInputTokens = estimateAnthropicInputTokens(body)
  const translator = createAnthropicStreamTranslator({
    model: requestedModel || resolved.model,
    fallbackId: relayRequestId,
    estimatedInputTokens,
  })
  ctx.set('X-ModelPort-Usage-Estimated', 'message_start.input_tokens')
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
      storeManager.addLog('error', `Anthropic stream error: ${message}`, {
        requestId: relayRequestId,
        data: { requestedModel, resolvedModel: resolved.model, latency: Date.now() - started },
      })
    } finally {
      reader.releaseLock?.()
      if (!out.destroyed) out.end()
    }
  })()

  setSseHeaders(ctx)
  ctx.status = 200
  ctx.body = out
  // 先把响应头发出去：客户端（Claude Code）对「响应头超时」有自己的计时，
  // 上游首个 token 可能远晚于此，等数据再发头会被判超时。
  ctx.res.flushHeaders()
  const heartbeat = startSseHeartbeat(out)
  const stopPing = heartbeat.stop
  out.once('finish', stopPing)
  out.once('close', stopPing)

  ctx.res.once('close', () => {
    stopPing()
    if (!out.destroyed) out.destroy()
  })
})

/**
 * `/v1/messages/count_tokens`：客户端发请求前用它判断上下文装不装得下。
 *
 * 只做粗估，不转发 —— 逐请求转发会给上游多一倍流量，而这里只要「数量级对」。
 */
router.post('/messages/count_tokens', async (ctx: Context) => {
  const body = (ctx.request.body ?? {}) as Payload
  const estimate = estimateAnthropicInputTokensDetailed(body)
  ctx.set('Content-Type', 'application/json')
  // `uncounted_blocks` 是本网关加的一格（Anthropic 的响应只有 `input_tokens`）：
  // 附件里数不出页数的 PDF 与读不到宽高的图片不计入，所以这个数是**声明过的下界**。
  // 不声明的话，客户端会把它当准数安排字节，到上游才被硬拒 —— 那正是最贵的一种沉默。
  ctx.body = estimate.uncounted.length === 0
    ? { input_tokens: estimate.tokens }
    : { input_tokens: estimate.tokens, uncounted_blocks: estimate.uncounted }
})

export default router
