/**
 * Proxy Service Module - Chat Completions Route
 * Implements /v1/chat/completions route
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { PassThrough, type Readable } from 'stream'
import { ChatCompletionRequest, ChatCompletionResponse, ProxyContext } from '../types'
import type { AccountSelection, ForwardResult } from '../types'
import { loadBalancer } from '../loadbalancer'
import { requestForwarder, isFailoverEligibleStatus } from '../forwarder'
import { streamHandler } from '../stream'
import { proxyStatusManager } from '../status'
import { modelMapper } from '../modelMapper'
import { autoRouter } from '../autoRouter'
import type { AutoCandidate, AutoRouteDecision } from '../autoRouter'
import { resolveRouteRequest, routePoolBreakMessage } from '../../store/modelRoutes'
import type { AutoAttemptFailure, RequestLogEntry } from '../../../shared/types'
import { buildStreamErrorFrame, mapUpstreamError, retryAfterHeader } from '../errorMapping'
import { findUnsupportedParameter, unsupportedParameterError } from '../parameterPolicy'
import { createToolViolationTap } from '../utils/toolViolationTap'
import { normalizeMessageRoles } from '../utils/messageRoles'
import { normalizeToolCallArguments } from '../utils/toolArguments'
import { normalizeOutputCap } from '../utils/outputCap'
import { toHeaderValue, routeHeaderValue } from '../utils/headerValue'
import { readStreamOutcome } from '../utils/streamOutcome'
import { accountChannelManager } from '../../providers/accountChannels/manager'
import { storeManager } from '../../store/store'
import { AUTO_PREFERENCES, type AutoPreference } from '../../../shared/types'
import { readOrEstimateUsage, usageInputText, type UsageReading } from '../quota/usage'
import { aggregateCostUsdOf } from '../../../shared/aggregateCost.ts'
import { getAggregateEntry } from '../../providers/aggregate/registry.ts'
import { learnFromErrorBody, learnFromHeaders } from '../quota/observations'
import { rejectionEntryFromContext } from '../rejectionLog'
import { clientHeaderValue, identifyClientByUserAgent } from '../../../shared/clientProfile'
import { takeCompressionReport } from '../compression'
import { takeDuplication } from '../compression/duplication.ts'
import { takeConversationTurn } from '../compression/survivorship.ts'
import { 
  isAnthropicToolFormat,
  transformResponseToAnthropic,
  transformChunkToAnthropic
} from '../utils/toolFormatConverter'

const router = new Router({ prefix: '/v1/chat' })

/** 请求日志里的 auto 决策记录；非 auto 请求返回 undefined（字段直接不出现） */
function autoLogRecord(
  decision: AutoRouteDecision | null,
  attempts: number,
  failures: AutoAttemptFailure[]
): RequestLogEntry['auto'] | undefined {
  if (!decision) return undefined
  return {
    // 路由名（legacy 路径为 `auto`）：日志与仪表盘要能区分「哪条路由跑的」，
    // 光看 prefer/reason 分不出来。字段是新增的可选键，老日志没有它照旧渲染。
    route: decision.routeName,
    prefer: decision.prefer,
    reason: decision.reason,
    attempts,
    candidates: decision.candidates.slice(0, 5).map(candidate => candidate.displayName),
    ...(decision.degraded.length > 0 ? { degraded: decision.degraded } : {}),
    // 第一家就命中时数组为空 —— 空数组不写，日志里没成功的请求不会出现空字段。
    ...(failures.length > 0 ? { failures } : {}),
  }
}

/**
 * `X-Auto-Prefer` 覆盖配置里的默认优化目标；非法值忽略，让配置继续生效，
 * 而不是把一次手写头发当作请求级错误。
 */
function autoPreferenceFromHeader(ctx: Context): AutoPreference | undefined {
  const raw = ctx.headers['x-auto-prefer']
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase()
  if (!value) return undefined
  return AUTO_PREFERENCES.includes(value as AutoPreference) ? (value as AutoPreference) : undefined
}

/**
 * 账本是旁路：写不进去只记一条错误日志，绝不改变用户已经拿到的响应。
 *
 * 按日 token 计数在同一处写入，共用同一个 `UsageReading`，这样账本与仪表盘
 * 永远看同一个口径 —— 两处各读一次响应体是最容易产生分歧的地方。
 * `reading.source` 原样传下去，仪表盘必须把 upstream 与 estimated 分开显示。
 * 费用也一样在这里算：它一旦离开这个函数去各算各的，"这一天的钱"就会和
 * "这一天的 token"对不上。
 */
function meterQuota(
  provider: { id: string; type?: string; aggregateId?: string },
  accountId: string,
  modelId: string,
  reading: UsageReading,
  savedTokens?: number
): void {
  try {
    storeManager.getQuotaLedger().record(provider.id, accountId, modelId, reading)
  } catch (error) {
    console.error('[Chat] quota ledger record failed:', error)
  }

  try {
    storeManager.recordTokenUsage({
      promptTokens: reading.promptTokens,
      completionTokens: reading.completionTokens,
      source: reading.source,
      savedTokens,
      // 上游没报就是 undefined，不是 0 —— 见 `TokenUsage.cacheReadTokens`。
      cacheReadTokens: reading.cacheReadTokens,
      providerId: provider.id,
      costUsd: estimateRequestCost(provider, modelId, reading),
    })
  } catch (error) {
    console.error('[Chat] token usage record failed:', error)
  }
}

/**
 * 这条请求值多少美元，或者「这个数字不存在」。
 *
 * 只有聚合条目有第三方标价：账号渠道按积分倍率计费、builtin 与自定义端点一条
 * 价格都没有。把它们都算成 `undefined` 而不是 0 是有意的 —— 0 是「知道不花钱」，
 * undefined 是「没人生成过这个数」，仪表盘对后者的显示是 "-"。
 */
function estimateRequestCost(
  provider: { id: string; type?: string; aggregateId?: string },
  modelId: string,
  reading: UsageReading
): number | undefined {
  if (provider.type !== 'aggregate') return undefined
  // 估算的 token 数乘上标价不是「估算的费用」，而是一张核对不了的账单。
  if (reading.source !== 'upstream') return undefined

  const entry = getAggregateEntry(provider.aggregateId ?? provider.id)
  if (entry === undefined) return undefined

  return aggregateCostUsdOf({
    entryId: entry.id,
    modelId,
    ...(entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}),
    usage: reading,
  })
}


/**
 * 额度学习：只在用户自己的正常请求已经带回来东西时读一次响应头与 429 文本，
 * 本仓不为此多发任何请求。写入一律「只填空、只下调」，见 quota/ledger.learn。
 */
function learnQuotaCaps(
  provider: { id: string; type: string },
  headers: unknown,
  errorText?: string
): void {
  if (provider.type !== 'aggregate') return

  try {
    const ledger = storeManager.getQuotaLedger()
    for (const cap of learnFromHeaders(headers as Record<string, string | number | string[] | undefined>)) {
      ledger.learn(provider.id, cap.metric, cap.limit)
    }
    for (const cap of learnFromErrorBody(errorText)) {
      ledger.learn(provider.id, cap.metric, cap.limit)
    }
  } catch (error) {
    console.error('[Chat] quota learning skipped:', error)
  }
}

/**
 * Generate Request ID
 */
function generateRequestId(): string {
  return `chatcmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 非流式响应里上游报告的结束原因；上游没报就留空，不补默认值。 */
function finishReasonOfBody(body: unknown): string | undefined {
  const reason = (body as { choices?: Array<{ finish_reason?: unknown }> } | undefined)?.choices?.[0]?.finish_reason
  return typeof reason === 'string' ? reason : undefined
}

/**
 * Get Client IP
 */
function getClientIP(ctx: Context): string {
  return ctx.headers['x-real-ip'] as string ||
    ctx.headers['x-forwarded-for'] as string ||
    ctx.ip ||
    'unknown'
}

/**
 * Extract user input from messages (last user message, full content)
 */
function extractUserInput(messages: Array<{ role: string; content?: string | any[] | null }>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && msg.content) {
      let content = ''
      if (typeof msg.content === 'string') {
        content = msg.content
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content.filter((p: any) => p.type === 'text')
        if (textParts.length > 0) {
          content = textParts.map((p: any) => p.text || '').join(' ')
        }
      }
      if (content) {
        return content
      }
    }
  }
  return undefined
}

/**
 * Handle Chat Completions Request
 */
router.post('/completions', async (ctx: Context) => {
  const startTime = Date.now()
  const requestId = generateRequestId()
  ctx.set('X-Request-Id', requestId)
  // 按 UA 归类调用方：只用于日志与响应头（Trae / WorkBuddy / Qoder / dsh …），
  // 不参与选路。识别失败不报错，落到 other + 原始产品名。
  const client = identifyClientByUserAgent(ctx.headers['user-agent'])
  ctx.set('X-ModelPort-Client', clientHeaderValue(client))
  const clientIP = getClientIP(ctx)

  let request: ChatCompletionRequest
  try {
    request = ctx.request.body as ChatCompletionRequest
  } catch (error) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Invalid request body',
        type: 'invalid_request_error',
        param: null,
        code: null,
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
        code: null,
      },
    }
    return
  }

  if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'Missing required field: messages',
        type: 'invalid_request_error',
        param: 'messages',
        code: null,
      },
    }
    return
  }

  // 历史里的 tool_calls.arguments 必须是合法 JSON，否则严格上游会让整段对话
  // 从这一轮起每轮 400（判据与降级口径见 toolArguments.ts）。
  const argNormalized = normalizeToolCallArguments(normalizeMessageRoles(request.messages))
  if (argNormalized.repaired > 0) {
    console.log(
      `[Chat] 历史 tool_calls.arguments 修复 ${argNormalized.repaired} 个调用`
      + (argNormalized.discarded > 0 ? `，其中 ${argNormalized.discarded} 个无法修复已降级为空参数` : ''),
    )
  }
  request = normalizeOutputCap({ ...request, messages: argNormalized.messages })

  // 客户端请求的输出上限；入口已把 max_completion_tokens 折进 max_tokens，这里只读一个字段。
  const requestedMaxTokens = typeof request.max_tokens === 'number' ? request.max_tokens : undefined

  request.requestId = requestId

  // 客户端提前断开时把上游也停掉：OpenCode 的一个回合要 30–60 秒，
  // 悬着的回合会占住它的串行队列，后面的请求全排着队。
  // 用不可枚举属性挂上去，免得混进请求日志的 JSON。
  const abortController = new AbortController()
  Object.defineProperty(request, 'signal', {
    value: abortController.signal,
    enumerable: false,
    configurable: true,
  })
  ctx.res.once('close', () => {
    if (!ctx.res.writableEnded) abortController.abort()
  })

  // Read feature parameters from Headers (lower priority than request body)
  const webSearchFromHeader = ctx.headers['x-web-search'] === 'true'
  const reasoningEffortFromHeader = ctx.headers['x-reasoning-effort'] as 'low' | 'medium' | 'high' | undefined
  const deepResearchFromHeader = ctx.headers['x-deep-research'] === 'true'

  // Handle reasoningEffort (camelCase) from AI SDK - convert to reasoning_effort (snake_case)
  const requestAny = request as any
  if (requestAny.reasoningEffort && !request.reasoning_effort) {
    request.reasoning_effort = requestAny.reasoningEffort
    console.log('[Chat] Reasoning effort set via reasoningEffort (camelCase):', requestAny.reasoningEffort)
    delete requestAny.reasoningEffort
  }

  // Merge into request (request body parameters take priority)
  if (webSearchFromHeader && request.web_search === undefined) {
    request.web_search = true
    console.log('[Chat] Web search enabled via X-Web-Search header')
  }
  if (reasoningEffortFromHeader && request.reasoning_effort === undefined) {
    request.reasoning_effort = reasoningEffortFromHeader
    console.log('[Chat] Reasoning effort set via X-Reasoning-Effort header:', reasoningEffortFromHeader)
  }
  if (deepResearchFromHeader && request.deep_research === undefined) {
    request.deep_research = true
    console.log('[Chat] Deep research enabled via X-Deep-Research header')
  }

  const config = storeManager.getConfig()

  // 路由优先：`request.model` 先在路由表里查（trim + 小写、大小写不敏感）。
  // 命中就是「点名一条路由」，同名模型不再参与解析 —— 与今天 `auto` 抢占同名
  // 模型的顺序一致，只是名字从此来自用户。没命中才走具名模型/聚合链。
  // 判定顺序（含「停用路由」这一条可读错误）在 store/modelRoutes.ts 的
  // `resolveRouteRequest` 里定一次，两条入口共用。
  //
  // 实时性：`getConfig()` 每请求现读，所以新建/改名/停用/删除路由**不需要重启
  // 代理**，下一个请求就按新表解析。两处进程内陈旧态是例外（粘性表在
  // autoRouter 头注释、渠道模型目录 30s 缓存在 accountChannels/manager.ts）。
  const routeOutcome = resolveRouteRequest(config.routes, request.model)

  // 路由名透出。写在**解析出路由的那一刻**，所以它在任何 return 之前：停用路由
  // 的 404、候选被剔光的 503 都带得上「这是哪条路由的答复」，流式分支更早于首块
  // commit（响应头一旦发出就补不上，见下面 Auto-Skipped 的同款教训）。
  // 名字是 `[a-z0-9_-]` 规范形，仍然过 toHeaderValue：持久化条目的 `name` 来自
  // 磁盘，任何读侧归一之外的手坏都不该把一个成功请求变成 500（ERR_INVALID_CHAR）。
  if (routeOutcome.kind === 'routable' || routeOutcome.kind === 'disabled' || routeOutcome.kind === 'broken-reference') {
    ctx.set('X-ModelPort-Route-Name', toHeaderValue(routeOutcome.route.name))
  }

  // 点名了一条存在但已停用的路由：给可读错误，别掉进「按普通模型名找账号」
  // 的分支变成 `no_available_account` —— 那会让用户以为模型掉了而不是路由关了。
  // 同时**留痕**：这条 404 到不了任何供应商，若不进请求日志（与 server.ts 的
  // recordRejectedRequest 同一份条目形状），客户端狂打停用路由在面板上读作「无流量」。
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

  // 点名了一条在服路由，但它的池来源（`basedOnRoute`）没了/停了/二级引用：给 404 并点名
  // 是哪一条引用断了。**不静默回落到全目录** —— 那条池是用户显式选的，回落等于把
  // 「写着 A 其实跑着整个目录」变成默认行为。
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
    const rejected = rejectionEntryFromContext(ctx, 404, 'route_reference_broken', breakMessage)
    rejected.client = client
    storeManager.addRequestLog(rejected)
    storeManager.recordRequestInStats(false, rejected.latency, rejected.model || undefined)
    return
  }

  // `not-a-route`（包括「点名 `auto` 但那条路由已被删除」）在这里**没有分支**：
  // 拍板语义是退回普通模型名解析，所以它走下面 `!autoDecision` 的具名路径，
  // 没有同名模型时拿到既有的 `503 no_available_account`（不是 404、更不是 500）。
  // 这里曾经为保留名报 `code:'route_not_found'`，与 URL 层未挂载（routeErrorPolicy.ts）
  // 共用一个 code 装两种语义，已删；`route ?? legacy` 的兜底只在 `routable` 时被调用，
  // 因此删除 `auto` 后不可能回退去读 legacy 全局 `autoRouting`。
  const route = routeOutcome.kind === 'routable' ? routeOutcome.route : undefined
  const autoDecision = route !== undefined
    ? autoRouter.select(request, config.loadBalanceStrategy, autoPreferenceFromHeader(ctx), route)
    : null

  // 限流预检：worker 内部账号池的模型级限流（loomy spark-x2.6 当日额度用尽、
  // 次日解禁）只存在于渠道 worker 内存，全账号受限时请求以 QUOTA_EXCEEDED 必败
  // —— 换家循环拿到的是 HTTP 失败，无法区分「渠道此刻不可服务」与账号故障。
  // 在发请求前逐渠道查询（走 worker 内存副本 rpc，TTL 缓存 60s）并把必败模型
  // 的候选剔掉（用户报障 2026-10-30，与 maxTools 前置跳过同一思路）。
  if (autoDecision && autoDecision.candidates.length > 0) {
    const modelIdsByChannel = new Map<string, Set<string>>()
    for (const candidate of autoDecision.candidates) {
      if (candidate.provider.type !== 'account') continue
      let ids = modelIdsByChannel.get(candidate.provider.id)
      if (ids === undefined) {
        ids = new Set<string>()
        modelIdsByChannel.set(candidate.provider.id, ids)
      }
      ids.add(candidate.actualModel)
    }
    const rateLimitsByChannel = new Map<string, Record<string, { limited: true; resetAtMs: number }>>()
    for (const [channelId, modelIds] of modelIdsByChannel) {
      rateLimitsByChannel.set(channelId, await accountChannelManager.modelRateLimits(channelId, [...modelIds]))
    }
    autoDecision.candidates = autoDecision.candidates.filter(candidate => {
      if (candidate.provider.type !== 'account') return true
      const table = rateLimitsByChannel.get(candidate.provider.id)
      const limited = table === undefined ? undefined : table[candidate.actualModel]
      if (limited === undefined) return true
      // 跳过原因透出（PLAN P0-2）：客户端据此提示「已跳过 xx（额度 x 分钟后复位）」，
      // 而不是看着候选静默消失。
      const resetMinutes = Math.max(1, Math.ceil((limited.resetAtMs - Date.now()) / 60_000))
      autoDecision.skipped.push(
        `${candidate.provider.id}/${candidate.displayName}:quota_reset_in_${resetMinutes}m`
      )
      return false
    })
  }

  // 跳过清单透出：与 X-ModelPort-Auto-Degraded 并列。必须写在任何 return 之前
  // —— 候选被剔光导致 503 时正是最需要解释的场景。动态部分（供应商名可能是
  // 中文）一律过 toHeaderValue。
  if (autoDecision && autoDecision.skipped.length > 0) {
    ctx.set('X-ModelPort-Auto-Skipped', toHeaderValue(autoDecision.skipped.join(',')))
  }

  let selection: AccountSelection | null = null
  let chainCandidates: AccountSelection[] = []
  // 用户通过模型映射点名了具体账号时是硬性指定：命中它失败后不再轮换到同供应商其他 Key
  let preferredAccountId: string | undefined = undefined
  if (!autoDecision) {
    const preferredProviderId = modelMapper.getPreferredProvider(request.model)
    preferredAccountId = modelMapper.getPreferredAccount(request.model)

    selection = loadBalancer.selectAccount(
      request.model,
      config.loadBalanceStrategy,
      preferredProviderId,
      preferredAccountId
    )

    // 裸名被哪家聚合条目接住，写进响应头；带前缀的名字本来就是点名，不打这个头。
    if (selection && !request.model.includes('/') && selection.provider.type === 'aggregate') {
      ctx.set('X-ModelPort-Aggregate-Chain', toHeaderValue(selection.provider.id))
    }

    // 同名能落到 ≥2 家时走跨家链；用户点过具体账号时不换家。
    chainCandidates = preferredAccountId
      ? []
      : loadBalancer.selectChainCandidates(request.model, preferredAccountId)

    if (!selection) {
      ctx.status = 503
      ctx.body = {
        error: {
          message: `No available account for model: ${request.model}`,
          type: 'service_unavailable_error',
          param: null,
          code: 'no_available_account',
        },
      }
      return
    }
  }

  const firstCandidate = autoDecision?.candidates[0]

  // `n > 1` 没有任何候选能完整满足时，与具名路径同样报 400，而不是退回 503
  if (autoDecision?.missing.includes('n')) {
    ctx.status = 400
    ctx.body = unsupportedParameterError('n')
    return
  }

  if (autoDecision && !firstCandidate) {
    ctx.status = 503
    ctx.body = {
      error: {
        // 带上路由名（多条路由都可能报这个错，客户端要能看出是哪条没选出候选）
        message: `No available model for route '${autoDecision.routeName}'${autoDecision.profile.needsVision ? ' (vision required)' : ''}`,
        type: 'service_unavailable_error',
        param: null,
        code: 'no_available_model',
        details: autoDecision.missing.length > 0 ? { missing: autoDecision.missing } : undefined,
      },
    }
    return
  }

  // 没有满足结构化输出的候选时仍然路由，但必须写明降级，不能假装满足
  if (autoDecision && autoDecision.degraded.length > 0) {
    ctx.set('X-ModelPort-Auto-Degraded', autoDecision.degraded.join(','))
  }
  if (autoDecision) {
    ctx.set('X-ModelPort-Auto-Prefer', autoDecision.prefer)
    ctx.set('X-ModelPort-Auto-Reason', autoDecision.reason)
  }

  // auto 路由时先按排名第一的候选记录请求开始，成功后再用真实命中的账号结算用量
  let account = selection ? selection.account : firstCandidate!.account
  let provider = selection ? selection.provider : firstCandidate!.provider
  let actualModel = selection ? selection.actualModel : firstCandidate!.actualModel
  let chosenCandidate: AutoCandidate | null = null
  let autoAttempts = 0
  // 换家循环里被跳过的候选（判据与循环分支同源）；第一家命中时为空。
  let autoFailures: AutoAttemptFailure[] = []

  // auto 的候选可能分属内置与自定义供应商，只有所有候选都拒绝时才整体报错
  const unsupportedParam = autoDecision
    ? autoDecision.candidates.every(candidate => findUnsupportedParameter(request, candidate.provider) !== null)
      ? findUnsupportedParameter(request, firstCandidate!.provider)
      : null
    : findUnsupportedParameter(request, provider)
  if (unsupportedParam) {
    ctx.status = 400
    ctx.body = unsupportedParameterError(unsupportedParam)
    return
  }

  const context: ProxyContext = {
    requestId,
    providerId: provider.id,
    accountId: account.id,
    model: request.model,
    actualModel,
    startTime,
    isStream: request.stream || false,
    clientIP,
  }

  proxyStatusManager.recordRequestStart(request.model, provider.id, account.id)

  try {
    let result: ForwardResult

    if (autoDecision) {
      const outcome = await requestForwarder.forwardAutoCompletion(
        request,
        autoDecision.candidates,
        context,
        // 换家预算随 decision 走：这条路由的 maxAttempts，而不是转发层自己去读
        // 全局 legacy `autoRouting.maxAttempts`。
        { baseCap: autoDecision.baseCap }
      )

      if (!outcome) {
        ctx.status = 503
        ctx.body = {
          error: {
            message: `Route '${autoDecision.routeName}' produced no forward result`,
            type: 'service_unavailable_error',
            param: null,
            code: 'no_available_model',
          },
        }
        return
      }

      result = outcome.result
      autoAttempts = outcome.attempts
      autoFailures = outcome.failures
      ctx.set('X-ModelPort-Auto-Attempts', String(outcome.attempts))
      chosenCandidate = outcome.candidate
      account = outcome.candidate.account
      provider = outcome.candidate.provider
      actualModel = outcome.candidate.actualModel
      // 供应商名可能含中文（账号渠道如 `TRAE (字节)`、自定义供应商由用户命名），
      // 直接写进头值会让 Node 抛 ERR_INVALID_CHAR、把一次成功的路由变成 500，
      // 所以动态部分一律过 toHeaderValue（非 ASCII 按 UTF-8 百分号编码）。
      ctx.set('X-ModelPort-Route', routeHeaderValue(actualModel, provider.name))
    } else if (chainCandidates.length > 1) {
      const outcome = await requestForwarder.forwardChainCompletion(
        request,
        chainCandidates.map(selection => ({
          account: selection.account,
          provider: selection.provider,
          displayName: `${selection.provider.id}/${selection.actualModel}`,
          actualModel: selection.actualModel,
        })),
        context
      )

      if (!outcome) {
        ctx.status = 503
        ctx.body = {
          error: {
            message: 'Aggregate chain produced no forward result',
            type: 'service_unavailable_error',
            param: null,
            code: 'no_available_model',
          },
        }
        return
      }

      result = outcome.result
      account = outcome.candidate.account
      provider = outcome.candidate.provider
      actualModel = outcome.candidate.actualModel
      ctx.set('X-ModelPort-Aggregate-Chain', toHeaderValue(provider.id))
    } else {
      result = await requestForwarder.forwardChatCompletion(
        request,
        account,
        provider,
        actualModel,
        context
      )

      // 同一聚合供应商配了多把 Key：这把失败且属于可切换错误（429/5xx/网络错误）时，
      // 轮换到该供应商其余 Key 继续试；客户端拿到的是最后一次尝试的结果，
      // 全部失败时失败样貌不变（429 仍带 Retry-After）。用户点名了具体账号（硬性指定）时不轮换。
      if (!result.success && !preferredAccountId && isFailoverEligibleStatus(result.status)) {
        const siblings = loadBalancer.selectSameProviderCandidates(request.model, provider.id, account.id)
        if (siblings.length > 0) {
          const outcome = await requestForwarder.forwardChainCompletion(
            request,
            siblings.map(sibling => ({
              account: sibling.account,
              provider: sibling.provider,
              displayName: request.model,
              actualModel: sibling.actualModel,
            })),
            context
          )
          if (outcome) {
            result = outcome.result
            account = outcome.candidate.account
            provider = outcome.candidate.provider
            actualModel = outcome.candidate.actualModel
          }
        }
      }
    }

    const latency = Date.now() - startTime

    // 压缩记录：转发器写在 live zone 上的改动，在这里一次性取出，
    // 既写响应头（客户端无需读日志就能看到省了多少），也写进请求日志。
    // 数字是估算值，绝不写进响应体的 usage。
    const compressionReport = takeCompressionReport(requestId)
    if (compressionReport && compressionReport.applied.length > 0) {
      ctx.set('X-ModelPort-Compression', compressionReport.applied.join(','))
      ctx.set('X-ModelPort-Compression-Saved', String(compressionReport.saved))
      ctx.set('X-ModelPort-Compression-Ratio', compressionReport.ratio.toFixed(3))
    }

    // 跨轮重复度：纯观测，请求字节未被改动。只在日志里留一行，供日后判断
    // "要不要做跨轮去重"；不写响应头，因为它不改变任何客户端可见行为。
    const duplication = takeDuplication(requestId)
    // 同一请求属于其会话的第几轮（1 = 首次观测）。纯观测，供日后估算 P4 的
    // expected_reads —— 这个数在请求当时无法得知，只能事后从会话寿命学到。
    const conversationTurn = takeConversationTurn(requestId)

    if (!result.success) {
      proxyStatusManager.recordRequestFailure(latency)

      // auto 路由的失败账号已在 forwardAutoCompletion 内逐个标记，这里不重复计数
      if (!autoDecision && result.status && result.status >= 400) {
        loadBalancer.markAccountFailed(account.id)
      }

      const mapped = mapUpstreamError(result.status, result.error)
      ctx.status = mapped.status
      if (mapped.status === 429) {
        const retryAfter = retryAfterHeader(result.headers as Record<string, unknown> | undefined)
        if (retryAfter) ctx.set('Retry-After', retryAfter)
      }
      learnQuotaCaps(provider, result.headers, result.error)
      ctx.body = {
        error: {
          message: result.error || 'Request failed',
          type: mapped.type,
          param: null,
          code: mapped.code,
        },
      }

      storeManager.addLog('error', `Request failed: ${result.error}`, {
        requestId,
        providerId: provider.id,
        accountId: account.id,
        model: request.model,
        latency,
      })

      const userInput = extractUserInput(request.messages)
      const errorResponseBody = JSON.stringify({
        error: {
          message: result.error || 'Request failed',
          type: mapped.type,
          param: null,
          code: mapped.code,
        },
      })
      storeManager.addRequestLog({
        timestamp: startTime,
        status: 'error',
        statusCode: result.status || 500,
        method: 'POST',
        url: '/v1/chat/completions',
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        userInput,
        client,
        auto: autoLogRecord(autoDecision, autoAttempts, autoFailures),
        compression: compressionReport,
        duplication,
        conversationTurn,
        webSearch: request.web_search,
        reasoningEffort: request.reasoning_effort,
        maxTokens: requestedMaxTokens,
        responseStatus: result.status || 500,
        responseBody: errorResponseBody,
        latency,
        isStream: request.stream || false,
        errorMessage: result.error,
      })

      storeManager.recordRequestInStats(false, latency, request.model, provider.id, account.id)

      return
    }

    loadBalancer.clearAccountFailure(account.id)
    // 带 actualModel：只清这一档的限流退避。整账号清零会让同渠道别的模型的成功
    // 顺手把正在限流的那个模型放出去，每一轮再付一次完整 prefill。
    autoRouter.clearAccountCooldown(account.id, actualModel)
    learnQuotaCaps(provider, result.headers)

    if (autoDecision && chosenCandidate) {
      autoRouter.rememberRoute(autoDecision.conversationKey, chosenCandidate, autoDecision.route)
    }

    proxyStatusManager.recordRequestSuccess(latency)

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

    const userInput = extractUserInput(request.messages)
    // Prepare response body for logging (only for non-stream requests)
    const responseBodyForLog = !request.stream && result.body
      ? JSON.stringify(result.body)
      : undefined

    // For streaming requests, we'll collect content and update the log later
    let logEntryId: string | undefined

    if (!request.stream) {
      // Non-streaming: record log with response body now
      const logEntry = storeManager.addRequestLog({
        timestamp: startTime,
        status: 'success',
        statusCode: 200,
        method: 'POST',
        url: '/v1/chat/completions',
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        userInput,
        client,
        auto: autoLogRecord(autoDecision, autoAttempts, autoFailures),
        compression: compressionReport,
        duplication,
        conversationTurn,
        webSearch: request.web_search,
        reasoningEffort: request.reasoning_effort,
        maxTokens: requestedMaxTokens,
        responseStatus: 200,
        responseBody: responseBodyForLog,
        finishReason: finishReasonOfBody(result.body),
        latency,
        isStream: false,
      })
      logEntryId = logEntry.id
    } else {
      // Streaming: record log now, will update response body later
      const logEntry = storeManager.addRequestLog({
        timestamp: startTime,
        status: 'success',
        statusCode: 200,
        method: 'POST',
        url: '/v1/chat/completions',
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        userInput,
        client,
        auto: autoLogRecord(autoDecision, autoAttempts, autoFailures),
        compression: compressionReport,
        duplication,
        conversationTurn,
        webSearch: request.web_search,
        reasoningEffort: request.reasoning_effort,
        maxTokens: requestedMaxTokens,
        responseStatus: 200,
        latency,
        isStream: true,
      })
      logEntryId = logEntry.id
    }

    storeManager.recordRequestInStats(true, latency, request.model, provider.id, account.id)

    if (!request.stream) {
      const outputText = String((result.body as Record<string, any> | undefined)?.choices?.[0]?.message?.content ?? '')
      meterQuota(
        provider,
        account.id,
        actualModel,
        readOrEstimateUsage(usageInputText(request), outputText, result.body),
        // 只计真正生效的压缩节省；跳过的请求不计入（那是反事实）。
        compressionReport && compressionReport.applied.length > 0
          ? compressionReport.saved
          : 0
      )
    }

    if (request.stream === true && result.stream) {
      ctx.set('Content-Type', 'text/event-stream')
      ctx.set('Cache-Control', 'no-cache')
      ctx.set('Connection', 'keep-alive')
      ctx.set('X-Accel-Buffering', 'no')

      // Create a wrapper stream to handle errors and collect content
      const wrapperStream = new PassThrough()

      // Collect stream content for logging (raw SSE output)
      let collectedContent = ''

      // Handle stream errors
      result.stream.once('error', (err: Error) => {
        // 流失败必须回写请求日志：日志条目是在响应头阶段按 success 建的，
        // 不翻成 error 的话这条请求在日志里永远显示成功（且耗时为响应头时间）。
        // 客户端已断开也要写 —— 那正是用户看到失败、日志却全绿的情形。
        if (logEntryId) {
          const failureStatus = (err as { status?: number }).status ?? 502
          storeManager.updateRequestLog(logEntryId, {
            status: 'error',
            statusCode: failureStatus,
            responseStatus: failureStatus,
            responsePreview: err.message,
            // 错误页签读的是 errorMessage，只写 responsePreview 的话这条失败在详情里是空的。
            errorMessage: err.message,
          })
        }

        // 客户端已断开时不再回写错误帧，避免 write after end
        if (wrapperStream.destroyed || ctx.res.writableEnded || ctx.res.destroyed) return

        console.error('[Chat] Stream error:', err.message)

        wrapperStream.write(buildStreamErrorFrame(err.message))
        wrapperStream.write('data: [DONE]\n\n')
        wrapperStream.end()

        storeManager.addLog('error', `Stream error: ${err.message}`, {
          requestId,
          providerId: provider.id,
          accountId: account.id,
          model: request.model,
        })
      })

      // Check if stream is already in correct SSE format (from adapters like Kimi, GLM, DeepSeek)
      if (result.skipTransform) {
        // Stream is already formatted, pipe through wrapper and collect
        result.stream.on('data', (chunk: Buffer) => {
          collectedContent += chunk.toString()
        })

        result.stream.pipe(wrapperStream, { end: false })

        // When source stream ends normally, update log and end wrapper
        result.stream.once('end', () => {
          const elapsed = Date.now() - startTime
          // 这条流的输出就是上游 SSE 本身，结束原因与「有没有结束原因」直接从它读。
          const outcome = readStreamOutcome(collectedContent)
          // Update log with collected response
          if (logEntryId) {
            storeManager.updateRequestLog(logEntryId, {
              responseBody: collectedContent || undefined,
              finishReason: outcome.finishReason,
              streamTruncated: !outcome.sawFinish,
              // 延迟型响应（响应头先发、正文后补）的耗时是整段，不是首字节
              ...(result.deferred ? { latency: elapsed } : {}),
            })
          }
          meterQuota(
            provider,
            account.id,
            actualModel,
            readOrEstimateUsage(usageInputText(request), collectedContent),
            compressionReport && compressionReport.applied.length > 0
              ? compressionReport.saved
              : 0
          )
          wrapperStream.end()
        })
      } else {
        // Need to transform the stream
        const transformStream = streamHandler.createTransformStream(
          actualModel,
          requestId,
          () => {
            storeManager.addLog('debug', `Stream response completed`, { requestId })
          }
        )

        // Collect from transform stream output
        transformStream.on('data', (chunk: Buffer) => {
          collectedContent += chunk.toString()
        })

        // 断流判定必须看上游原始 SSE：转换器在上游没给结束原因时会补一个 stop，
        // 只看输出就再也分不出「答完」和「被掐断」。结束帧都在流尾，留 8KB 够判。
        let upstreamTail = ''
        result.stream.on('data', (chunk: Buffer) => {
          upstreamTail = (upstreamTail + chunk.toString()).slice(-8192)
        })

        result.stream.pipe(transformStream)
        transformStream.pipe(wrapperStream, { end: false })

        transformStream.once('end', () => {
          const delivered = readStreamOutcome(collectedContent)
          const upstream = readStreamOutcome(upstreamTail)
          // Update log with collected response
          if (logEntryId) {
            storeManager.updateRequestLog(logEntryId, {
              responseBody: collectedContent || undefined,
              finishReason: delivered.finishReason,
              streamTruncated: !upstream.sawFinish,
            })
          }
          meterQuota(
            provider,
            account.id,
            actualModel,
            readOrEstimateUsage(usageInputText(request), collectedContent),
            compressionReport && compressionReport.applied.length > 0
              ? compressionReport.saved
              : 0
          )
          wrapperStream.end()
        })
      }

      const requiresToolCall =
        request.tool_choice === 'required' ||
        (typeof request.tool_choice === 'object' && request.tool_choice?.type === 'function')

      ctx.body = requiresToolCall ? wrapperStream.pipe(createToolViolationTap()) : wrapperStream

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

      const requiresToolCall =
        request.tool_choice === 'required' ||
        (typeof request.tool_choice === 'object' && request.tool_choice?.type === 'function')
      const bodyToolCalls = (result.body as any)?.choices?.[0]?.message?.tool_calls
      if (requiresToolCall && (!Array.isArray(bodyToolCalls) || bodyToolCalls.length === 0)) {
        ctx.set('X-ModelPort-Tool-Violation', 'required')
      }

      if (result.body) {
        // Check if we need to transform to Anthropic format
        if (isAnthropicToolFormat(request.tool_format)) {
          ctx.body = transformResponseToAnthropic(result.body)
          console.log('[Chat] Transformed response to Anthropic tool format')
        } else {
          ctx.body = result.body
        }
      } else {
        ctx.body = {
          id: requestId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: actualModel,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: '',
            },
            finish_reason: 'stop',
          }],
          usage: null,
        }
      }
    }
  } catch (error) {
    const latency = Date.now() - startTime
    proxyStatusManager.recordRequestFailure(latency)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined

    ctx.status = 500
    ctx.body = {
      error: {
        message: errorMessage,
        type: 'internal_error',
        param: null,
        code: null,
      },
    }

    storeManager.addLog('error', `Request exception: ${errorMessage}`, {
      requestId,
      providerId: provider.id,
      accountId: account.id,
      model: request.model,
      latency,
      error: errorMessage,
    })

    const userInput = extractUserInput(request.messages)
    const exceptionResponseBody = JSON.stringify({
      error: {
        message: errorMessage,
        type: 'internal_error',
        param: null,
        code: null,
      },
    })
    storeManager.addRequestLog({
      timestamp: startTime,
      status: 'error',
      statusCode: 500,
      method: 'POST',
      url: '/v1/chat/completions',
      model: request.model,
      actualModel,
      providerId: provider.id,
      providerName: provider.name,
      accountId: account.id,
      accountName: account.name,
      requestBody: JSON.stringify(request),
      userInput,
      auto: autoLogRecord(autoDecision, autoAttempts, autoFailures),
      webSearch: request.web_search,
      reasoningEffort: request.reasoning_effort,
      maxTokens: requestedMaxTokens,
      responseStatus: 500,
      responseBody: exceptionResponseBody,
      latency,
      isStream: request.stream || false,
      errorMessage,
      errorStack,
    })

    storeManager.recordRequestInStats(false, latency, request.model, provider.id, account.id)
  }
})

export default router
