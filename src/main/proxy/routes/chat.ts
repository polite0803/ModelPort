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
import { requestForwarder } from '../forwarder'
import type { ForwardChainOutcome } from '../forwarder'
import { isAccountFault, isSameProviderRotationStatus, isContextOverflowError, SILENT_CHANNEL_SKIP_CODE } from '../failover'
import { isAccountArrearsError, isRecoverableChannelFailure } from '../failover'
import { autoExhaustedResponse, parseRetryAfterSeconds } from '../failover'
import { SSEParser, extractStreamErrorFrame, streamHandler, type StreamErrorFrame } from '../stream'
import { proxyStatusManager } from '../status'
import { modelMapper } from '../modelMapper'
import { autoRouter, AUTO_SKIPPED_REPORT_LIMIT, describeTransientCause, summarizeTransientSkips } from '../autoRouter'
import type { AutoCandidate, AutoRouteDecision } from '../autoRouter'
import { resolveRouteRequest, routePoolBreakMessage } from '../../store/modelRoutes'
import type {
  AutoAttemptFailure,
  RequestAttemptTrace,
  RequestLogEntry,
  RequestStreamTrace,
} from '../../../shared/types'
import { buildStreamErrorFrame, mapForwardFailure, retryAfterHeader, withRequestId } from '../errorMapping'
import { nextDailyUsage } from '../../../shared/dailyUsage.ts'
import { startSseHeartbeat, type SseHeartbeat } from '../utils/sseHeartbeat'
import { findUnsupportedParameter, unsupportedParameterError } from '../parameterPolicy'
import { createToolViolationTap } from '../utils/toolViolationTap'
import {
  collectToolCallNames,
  createUndeclaredToolNameTap,
  declaredChatToolNames,
  findUndeclaredToolNames,
  formatUndeclaredToolNameLine,
  rawChatToolNames,
  undeclaredToolNameLimiter,
} from '../utils/undeclaredToolNameAudit'
import { normalizeMessageRoles } from '../utils/messageRoles'
import { normalizeToolCallArguments } from '../utils/toolArguments'
import { normalizeOutputCap } from '../utils/outputCap'
import { toHeaderValue, routeHeaderValue } from '../utils/headerValue'
import { readStreamOutcome } from '../utils/streamOutcome'
import { accountChannelManager } from '../../providers/accountChannels/manager'
import { accountRuntime } from '../accountRuntime'
import { storeManager } from '../../store/store'
import { AUTO_PREFERENCES, type AutoPreference } from '../../../shared/types'
import { INCOMPLETE_STEP_CODE, isEmptyTurnAfterStream, isAnnouncedStopAfterStream, modelQualityDegradation, shouldRevokeStickyAfterStream } from '../streamOutcomePolicy'
import { readRequestContextFit } from '../../../shared/requestContextFit.ts'
import { DEFAULT_REPETITION_GUARD, measureStreamEmptyTurn, measureStreamRepetition } from '../../../shared/streamRepetition.ts'
import { readOrEstimateUsage, usageInputText, type UsageReading } from '../quota/usage'
import { aggregateCostUsdOf } from '../../../shared/aggregateCost.ts'
import { getAggregateEntry } from '../../providers/aggregate/registry.ts'
import { learnFromErrorBody, learnFromHeaders } from '../quota/observations'
import { applyQuotaExhaustions } from '../quota/exhaustionMarks.ts'
import { rejectionEntryFromContext, selectionRefusalEntry } from '../rejectionLog'
import { clientHeaderValue, identifyClientByUserAgent } from '../../../shared/clientProfile'
import { takeCompressionReport, type CompressionReport } from '../compression'
import { takeDuplication } from '../compression/duplication.ts'
import { takeConversationTurn } from '../compression/survivorship.ts'
import { createReasoningEchoObserver, reasoningEchoApplies } from '../reasoningEcho.ts'
import { clientSessionKey } from '../../../shared/clientSessionKey.ts'
import { 
  isAnthropicToolFormat,
  transformResponseToAnthropic,
  transformChunkToAnthropic
} from '../utils/toolFormatConverter'

const router = new Router({ prefix: '/v1/chat' })

/**
 * 与 `channelPack/worker.ts` 请求前闸门抛出的 404 **逐字节同一**的原文。
 *
 * ⚠️ 依赖：`failover.ts::isChannelModelUnavailableError` 就是按这句原文做精确识别
 * （换候选、不冷却账号）。具名路径的服务清单预检用它在宿主本地复现 worker 的那笔
 * 404，改一个字节都会让识别失明、并把客户端可见错误体改掉。
 */
const CHANNEL_MODEL_UNSERVED_MESSAGE = '模型不存在或已停用'

/** 请求日志与状态页里列出的候选数上限（链长另有一格，见 `auto.chainLength`）。 */
const AUTO_LOG_CANDIDATES_SHOWN = 10

/** 请求日志里列出的前置剔除条数上限；尾部只留条数（`auto.skippedMore`）。 */
const AUTO_LOG_SKIPPED_SHOWN = 20

/**
 * 请求前预检剔掉的候选。`reason` 决定空池时是 429（等窗口复位）还是 503（配置筛空），
 * `resetAtMs` 给 `Retry-After` 用（只有 worker 的限流读数带时刻）。
 */
interface PreflightStrip {
  providerId: string
  providerName: string
  displayName: string
  actualModel: string
  reason: 'rate_limited' | 'pack_not_serving'
  resetAtMs?: number
}

/**
 * 预检剔空后的**重选**上限（含首次选路共 4 次）。每次重选都是一次同步排序加
 * 一次 TTL 命中的 worker 查询，代价远小于一次必败的上游往返。
 */
const MAX_PREFLIGHT_RESEELECTS = 3

/**
 * 上游额度类失败（零产出）在一个回合内最多再换几个模型。
 *
 * 与 `MAX_REJECTED_REQUEST_SWITCHES` 同一量级：每次换都近乎瞬时（请求在生成前
 * 被拒），但池子真全没额度时，多换只会把同一句 429 重演几遍、拖长客户端等待。
 */
const MAX_CAPACITY_MODEL_SWITCHES = 2

/** `X-ModelPort-Auto-Skipped` 的取值：前几条原因，超出折成 `+N`；空清单不发头。 */
function autoSkippedHeader(skipped: readonly string[]): string | undefined {
  if (skipped.length === 0) return undefined
  const shown = skipped.slice(0, AUTO_SKIPPED_REPORT_LIMIT)
  const hidden = skipped.length - shown.length
  return toHeaderValue(hidden > 0 ? `${shown.join(',')},+${hidden}` : shown.join(','))
}

/**
 * 上游在**产出任何字节之前**就拒绝、且成因是额度/限流：这一发可以安全地换模型重放。
 *
 * `stream === undefined` 是「零产出」的判据：流式请求只要拿到了首块，转发层会交回
 * 一个流（成败在流内结算），那种情况绝不能换 —— 切换只在「客户端还没看到任何
 * 内容」时才不伤上下文、工具协议与前缀缓存。
 */
function isZeroOutputCapacityFailure(result: ForwardResult): boolean {
  if (result.success || result.stream !== undefined) return false
  // 本地并发准入拒绝是我们自己的闸门，不是上游对额度的判决。
  if (result.localAdmissionRejected === true) return false
  if (result.status === 402 || result.status === 429) return true
  return isRecoverableChannelFailure(result.error) || isAccountArrearsError(result.error)
}

/**
 * 渠道侧的两道请求前预检：worker 的模型级限流、pack 的服务清单。
 *
 * 两者都只剔**这一轮**的候选并返回剔除清单，不改配置。调用方负责在剔空后带排除集
 * 重选——两道预检都跑在 `single` 作用域裁剪之后，剔掉头部而不重选就是整轮零候选：
 * 2026-11-14 `daily` 实测 27 笔 `503 no_available_model`，头部 `OpenCode / Big Pickle`
 * 的免费日额度在 00:00 UTC 前打满，池子里另外 51 个模型一次都没被派过。
 */
async function applyChannelPreflights(decision: AutoRouteDecision): Promise<PreflightStrip[]> {
  const stripped: PreflightStrip[] = []
  if (decision.candidates.length === 0) return stripped

  // 逐家一次、不是逐候选一次：同一家的几个候选读的是同一份 TTL 缓存。
  const modelIdsByChannel = (candidates: readonly AutoCandidate[]): Map<string, Set<string>> => {
    const byChannel = new Map<string, Set<string>>()
    for (const candidate of candidates) {
      if (candidate.provider.type !== 'account') continue
      let ids = byChannel.get(candidate.provider.id)
      if (ids === undefined) {
        ids = new Set<string>()
        byChannel.set(candidate.provider.id, ids)
      }
      ids.add(candidate.actualModel)
    }
    return byChannel
  }

  // 1) worker 内部账号池的模型级限流（免费日额度用尽、次日解禁这类）：状态只在
  //    worker 内存里，全账号受限时请求以 QUOTA_EXCEEDED 必败。读数是 worker 亲口
  //    说的，剔掉之后镜像会写进 manager，下一次选路在排序前就能看到。
  const rateLimitsByChannel = new Map<string, Record<string, { limited: true; resetAtMs: number }>>()
  for (const [channelId, modelIds] of modelIdsByChannel(decision.candidates)) {
    rateLimitsByChannel.set(channelId, await accountChannelManager.modelRateLimits(channelId, [...modelIds]))
  }
  decision.candidates = decision.candidates.filter(candidate => {
    if (candidate.provider.type !== 'account') return true
    const table = rateLimitsByChannel.get(candidate.provider.id)
    const limited = table === undefined ? undefined : table[candidate.actualModel]
    if (limited === undefined) return true
    // 跳过原因透出（PLAN P0-2）：客户端据此提示「已跳过 xx（额度 x 分钟后复位）」，
    // 而不是看着候选静默消失。
    const resetMinutes = Math.max(1, Math.ceil((limited.resetAtMs - Date.now()) / 60_000))
    decision.skipped.push(
      `${candidate.provider.id}/${candidate.displayName}:quota_reset_in_${resetMinutes}m`
    )
    stripped.push({
      providerId: candidate.provider.id,
      providerName: candidate.provider.name,
      displayName: candidate.displayName,
      actualModel: candidate.actualModel,
      reason: 'rate_limited',
      resetAtMs: limited.resetAtMs,
    })
    return false
  })

  // 候选已经空了就没有第二条预检要查的东西：省掉一次 pack 往返。
  if (decision.candidates.length === 0) return stripped

  // 2) pack 服务清单：宿主的可路由名单来自 `model.list`（`listAllModels()`，静态
  //    兜底、不套身份档），而 worker 的请求前闸门读的是分档后的 `listModels()`。
  //    两边一分歧，条目会在任何上游请求发出前被本地 404；这里把闸门提前。
  const unservedByChannel = new Map<string, Record<string, { unserved: true }>>()
  for (const [channelId, modelIds] of modelIdsByChannel(decision.candidates)) {
    unservedByChannel.set(channelId, await accountChannelManager.packUnservedModels(channelId, [...modelIds]))
  }
  decision.candidates = decision.candidates.filter(candidate => {
    if (candidate.provider.type !== 'account') return true
    const table = unservedByChannel.get(candidate.provider.id)
    const unserved = table === undefined ? undefined : table[candidate.actualModel]
    if (unserved === undefined) return true
    decision.skipped.push(
      `${candidate.provider.id}/${candidate.displayName}:pack_not_serving`
    )
    stripped.push({
      providerId: candidate.provider.id,
      providerName: candidate.provider.name,
      displayName: candidate.displayName,
      actualModel: candidate.actualModel,
      reason: 'pack_not_serving',
    })
    return false
  })
  return stripped
}

/**
 * 「本轮请求体量 vs 这一家窗口」的读数工厂。
 *
 * 只在路由决策存在时产出（非路由请求没有可信的估算入量，宁可不写也不写 0）。
 * `measuredOverflow` 来自上游真实报错，优先于判定值，并且带 `contextFitSource`
 * 标记 —— 判定不冒充实测。估算值绝不写进 usage（口径见 shared/requestContextFit.ts）。
 */
function contextReadingFor(
  decision: AutoRouteDecision | null,
  measuredOverflow: boolean
): Partial<RequestLogEntry> {
  if (decision === null) return {}
  return readRequestContextFit({
    estimatedTokens: decision.profile.estimatedTokens,
    ...(decision.contextWindow === undefined ? {} : { contextWindow: decision.contextWindow }),
    measuredOverflow,
  })
}

/**
 * 这一轮是否与上一轮落在同一个实现上。返回 `from -> to` 的主动换走那一侧；
 * 首轮（没有锚点）或锚点复用（同一 provider 同一模型）返回 `undefined`。
 *
 * 判据只比 `providerId` 与 `displayName`，不比账号：换账号是设计内的可用性动作，
 * 契约不变；换实现才是「客户端看起来莫名其妙崩掉」的来源。
 */
function autoSwitchOf(
  decision: AutoRouteDecision | null,
  served: { provider: { id: string }; displayName: string } | null
): { from: string; to: string } | null {
  const previous = decision?.previousHint
  if (previous === undefined || served === null) return null
  if (previous.providerId === served.provider.id && previous.displayName === served.displayName) return null
  return {
    from: `${previous.providerId}/${previous.displayName}`,
    to: `${served.provider.id}/${served.displayName}`,
  }
}

/** 请求日志里的 auto 决策记录；非 auto 请求返回 undefined（字段直接不出现） */
function autoLogRecord(
  decision: AutoRouteDecision | null,
  attempts: number,
  failures: AutoAttemptFailure[],
  served: { provider: { id: string }; displayName: string } | null = null
): RequestLogEntry['auto'] | undefined {
  if (!decision) return undefined
  const switched = autoSwitchOf(decision, served)
  return {
    // 路由名（legacy 路径为 `auto`）：日志与仪表盘要能区分「哪条路由跑的」，
    // 光看 prefer/reason 分不出来。字段是新增的可选键，老日志没有它照旧渲染。
    route: decision.routeName,
    prefer: decision.prefer,
    reason: decision.reason,
    attempts,
    // 链不再裁短之后，前 5 个名字不足以解释「为什么没走某家」：多列几个，
    // 同时把整条链的长度单独写成一格 —— 少了这一格，日志里的 10 个名字看起来
    // 就像池子的全部，而池子可能是几百个模型。
    candidates: decision.candidates.slice(0, AUTO_LOG_CANDIDATES_SHOWN).map(candidate => candidate.displayName),
    chainLength: decision.candidates.length,
    // 前置剔除的清单（`provider/model:原因`）。用户问「为什么没走某家」时，这一格
    // 与上面那格就是答案：链长说明池有多大，剔除说明有多少在排队之前就被闸掉了。
    ...(decision.skipped.length > 0
      ? {
        skipped: decision.skipped.slice(0, AUTO_LOG_SKIPPED_SHOWN),
        ...(decision.skipped.length > AUTO_LOG_SKIPPED_SHOWN
          ? { skippedMore: decision.skipped.length - AUTO_LOG_SKIPPED_SHOWN }
          : {}),
      }
      : {}),
    // 粘性键来自客户端会话标识还是内容指纹：中途换家的两种解释靠这一格分开
    sessionKeySource: decision.stickyKeySource,
    ...(switched === null ? {} : { switchedFrom: switched.from }),
    // 这一轮**读到**的锚点（不论是否换了家）：`switchedFrom` 只在「换了」时出现，
    // 读不出「这一轮根本没锚」。与 `stickyGated` / `latencyGateMs` 一起读，
    // 「锚了但被让位」与「压根没锚」才不会混成一件事。
    ...(decision.previousHint === undefined
      ? {}
      : { previousHint: `${decision.previousHint.providerId}/${decision.previousHint.displayName}` }),
    // 「池里几百个模型为什么只试了这几家」由这一格回答：每一次被跳过的候选
    // 都带原因（见下面的 `failures`），泳道栅栏退役后不再有「默认停在队首」。
    // 第 2 条：「这一轮为什么没粘回上一家」的答案。`latencyGateMs` 是池内 p75，
    // 流结束时同一格用来判「慢到该撤锚点」；`stickyGated` 说明这一轮硬粘性被跳过。
    ...(decision.latencyGateMs === undefined ? {} : { latencyGateMs: decision.latencyGateMs }),
    ...(decision.stickyGated === true ? { stickyGated: true as const } : {}),
    // 架构 A：这一轮的作用域、选定的模型、软钉与熔断读数。没有这四格，日志里
    // `chainLength` 从「池子大小」缩到「同模型账号数」会被读成池子塌了。
    ...(decision.modelScope === undefined ? {} : { modelScope: decision.modelScope }),
    ...(decision.model === undefined ? {} : { model: decision.model }),
    ...(decision.pin === undefined ? {} : { pin: decision.pin }),
    ...(decision.pinMiss === undefined ? {} : { pinMiss: decision.pinMiss }),
    ...(decision.pinStale === undefined ? {} : { pinStale: decision.pinStale }),
    ...(decision.pinCooling === undefined ? {} : { pinCooling: decision.pinCooling }),
    ...(decision.pinBlocked === undefined ? {} : { pinBlocked: decision.pinBlocked }),
    ...(decision.circuited === undefined || decision.circuited.length === 0
      ? {}
      : { circuited: decision.circuited }),
    ...(decision.degraded.length > 0 ? { degraded: decision.degraded } : {}),
    // 第一家就命中时数组为空 —— 空数组不写，日志里没成功的请求不会出现空字段。
    ...(failures.length > 0 ? { failures } : {}),
  }
}

/**
 * `X-ModelPort-Model`：客户端对本轮模型的点名（架构 A 的客户端侧快速切换）。
 *
 * 值按展示名匹配（`provider/model` 那种名字整体算一个），非 ASCII 允许按
 * `toHeaderValue` 的百分号编码传入。点名不中的结果不静默 —— 选路把 `pinMiss`
 * 写进日志与 `X-ModelPort-Pin`。
 */
function autoModelFromHeader(ctx: Context): { displayName: string } | undefined {
  const raw = ctx.headers['x-modelport-model']
  const first = Array.isArray(raw) ? raw[0] : raw
  if (typeof first !== 'string') return undefined
  let value = first.trim()
  if (value.length === 0) return undefined
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value)
    } catch {
      // 保留原文：一个写坏的百分号不该把整轮请求判成错误。
    }
  }
  return { displayName: value }
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
  savedTokens?: number,
  /**
   * 这次请求的压缩判决。按日桶要的不是"省了多少"，而是"为什么没省"——
   * 被拒候选的投影只活在这份报告里，请求日志一两天就滚掉了。
   */
  compression?: CompressionReport
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
      cacheReadReported: reading.cacheReadReported,
      providerId: provider.id,
      modelId,
      costUsd: estimateRequestCost(provider, modelId, reading),
      ...(compression === undefined ? {} : { compression }),
    })
  } catch (error) {
    console.error('[Chat] token usage record failed:', error)
  }
}

/**
 * Request-log projection of an upstream-reported reading.
 *
 * Estimated readings return `undefined`: the row must not present `chars/4`
 * arithmetic as usage, and the per-model cache table's denominator is exactly
 * this pool. `cacheReadTokens` keeps its "absent means not reported" rule.
 */
function upstreamUsageOf(reading: UsageReading): {
  promptTokens: number
  completionTokens: number
  cacheReadTokens?: number
  source: 'upstream'
} | undefined {
  if (reading.source !== 'upstream') return undefined
  return {
    promptTokens: reading.promptTokens,
    completionTokens: reading.completionTokens,
    ...(reading.cacheReadTokens === undefined ? {} : { cacheReadTokens: reading.cacheReadTokens }),
    source: 'upstream',
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
  // Explicit single-request trace: capture bodies even when global body logging
  // is off. The client sends `X-ModelPort-Trace: 1`; the response says whether
  // the capture was accepted so the caller knows it can reproduce the issue.
  const traceHeader = ctx.headers['x-modelport-trace']
  const traceRequested = String(Array.isArray(traceHeader) ? traceHeader[0] : traceHeader ?? '').trim() === '1'
  if (traceRequested) ctx.set('X-ModelPort-Trace', 'captured')
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
    // 降级不能静默：客户端至少能从响应头看到「这次历史里有坏参数被兜底了」。
    ctx.set('X-ModelPort-Tool-Args-Repaired', String(argNormalized.repaired))
    if (argNormalized.discarded > 0) {
      ctx.set('X-ModelPort-Tool-Args-Discarded', String(argNormalized.discarded))
    }
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
    const rejected = rejectionEntryFromContext(ctx, 404, 'route_disabled', disabledMessage, requestId)
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
    const rejected = rejectionEntryFromContext(ctx, 404, 'route_reference_broken', breakMessage, requestId)
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
  // 粘性用的会话标识：入向协议（Responses / Anthropic）把客户端 body 里读到的值经回环
  // 头带过来；直接打 `/v1/chat/completions` 的客户端就在 body / `session-id` 头里现读。
  // 两者都没有就是 undefined，粘性照旧用内容指纹（`shared/clientSessionKey.ts` 说明为什么
  // 需要它，以及为什么这条链只有一份判断）。
  const clientSession = clientSessionKey({ body: request, headers: ctx.headers })
  const autoPreference = autoPreferenceFromHeader(ctx)
  const headerModel = autoModelFromHeader(ctx)
  let autoDecision = route !== undefined
    ? autoRouter.select(request, config.loadBalanceStrategy, autoPreference, route, clientSession, headerModel)
    : null

  // 请求前预检：worker 的模型级限流与 pack 服务清单（两块合并进
  // `applyChannelPreflights`）。剔空之后必须**带着排除集重选** —— 两道预检都跑在
  // `single` 作用域裁剪之后，剔掉头部而不重选就是整轮零候选。重选发生在任何上游
  // 请求发出之前，仍是同一轮，不违反「一轮一个模型」。
  const preflightStripped: PreflightStrip[] = []
  const preflightSkipped: string[] = []
  let lastStripped: PreflightStrip[] = []
  if (autoDecision !== null) {
    let decision: AutoRouteDecision = autoDecision
    for (let attempt = 0; ; attempt++) {
      if (decision.candidates.length === 0) break
      const skippedBefore = decision.skipped.length
      lastStripped = await applyChannelPreflights(decision)
      preflightStripped.push(...lastStripped)
      // 预检写下的原因（`quota_reset_in_Nm` / `pack_not_serving`）要跟着决策走：重选
      // 会换一个新的决策对象，旧决策的 skipped 不会自己搬过来，客户端就只剩一个
      // `rate_limited`，读不出「多久之后会回来」。
      for (const marker of decision.skipped.slice(skippedBefore)) {
        if (!preflightSkipped.includes(marker)) preflightSkipped.push(marker)
      }
      if (decision.candidates.length > 0) break
      // 钉子（软钉或持久 `preferredModel`）不许被重选绕开：那等于静默换模型。
      // 这颗钉此刻不可用由下面的 429/503 投影说明，清钉仍是 `routes:unpin` 的事。
      if (decision.pin !== undefined || route === undefined || attempt >= MAX_PREFLIGHT_RESEELECTS) break
      const retry = autoRouter.select(
        request,
        config.loadBalanceStrategy,
        autoPreference,
        route,
        clientSession,
        headerModel,
        preflightStripped.map(strip => ({ providerId: strip.providerId, displayName: strip.displayName }))
      )
      // 重选的决策只记得自己那轮采集：把预检剔掉的名字并进来，面板与
      // `X-ModelPort-Auto-Skipped` 才能回答整条链为什么绕开了它们。
      for (const marker of preflightSkipped) {
        if (!retry.skipped.includes(marker)) retry.skipped.push(marker)
      }
      decision = retry
      autoDecision = retry
      // 重选之后，`lastStripped` 只代表**上一轮**的剔除：新一轮若一个候选都没有，
      // 循环在顶部就退出，不会覆盖它。清空，免得把上一轮的限流当成这一轮的成因。
      lastStripped = []
    }
  }

  // 跳过清单透出：与 X-ModelPort-Auto-Degraded 并列。必须写在任何 return 之前
  // —— 候选被剔光导致 503 时正是最需要解释的场景。动态部分（供应商名可能是
  // 中文）一律过 toHeaderValue。
  //
  // 候选链不再裁短之后，「渠道整条限流」这类跳过可以一次性攒几十条，而这个头每请求都发；
  // 头只留给客户端提示最前面那几条（超出折成 `+N`，客户端读到 `+N` 就知道还有隐情）。
  // 空池的那两条拒绝（429/503）另会把同一份前几条写进错误体与请求日志行 —— 客户端
  // 只转述一句话时，面板上的那一行是唯一能回答「为什么没有候选」的地方。
  if (autoDecision && autoDecision.skipped.length > 0) {
    const header = autoSkippedHeader(autoDecision.skipped)
    if (header !== undefined) ctx.set('X-ModelPort-Auto-Skipped', header)
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
      // 空池完全由会自己复位的状态（额度窗口/上游亲口拒/当日上限）造成时，与 auto
      // 路径同口径：429 + Retry-After。原先一律 503 `no_available_account` 实测让
      // 客户端把「等窗口复位」读成配置问题，硬重试 11 次后弹错误窗口。永久成因
      // （没有账号/模型不支持/失败冷却）诊断返回 undefined，仍走下面的 503。
      const transientSkips = loadBalancer.transientEmptyPoolSkips(
        request.model,
        preferredProviderId,
        config.loadBalanceStrategy === 'failover'
      )
      const transient = transientSkips === undefined
        ? undefined
        : summarizeTransientSkips(transientSkips, Date.now())
      if (transient) {
        const message = `All accounts for model '${request.model}' are temporarily unavailable (${describeTransientCause(transient.cause)}); retry in ${transient.retryAfterSeconds}s`
        const body = {
          error: {
            message,
            type: 'rate_limit_error',
            param: null,
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
        const refused = selectionRefusalEntry(ctx, {
          statusCode: 429,
          code: 'model_temporarily_unavailable',
          type: 'rate_limit_error',
          message,
          body,
          requestId,
          client,
        })
        storeManager.addRequestLog(refused)
        storeManager.recordRequestInStats(false, refused.latency, refused.model || undefined)
        return
      }
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

    // 服务清单预检（点名/显式选模路径）：与上面 auto 路径的预检同一判据、同一个
    // `packUnservedModels`。宿主可路由名单来自 `model.list`（不套身份档），渠道
    // worker 的请求前闸门读的却是**分档后**的 `listModels(provider)`
    // （`channelPack/worker.ts`）——不命中的条目在任何上游请求发出之前就被 worker
    // 本地 404 `模型不存在或已停用`。把那道闸门提前到宿主：pack 明确不服务的候选
    // 不再付 worker 往返；同一家多账号点名的也不再逐个空转。
    //
    // 客户端可见结果与今天**逐字相同**：404 错误体由既有的 `mapForwardFailure` +
    // `withRequestId` 产出（与 worker 那笔失败今天走的同一条映射），文案取
    // `CHANNEL_MODEL_UNSERVED_MESSAGE`——`failover.ts::isChannelModelUnavailableError`
    // 按这句原文识别，预检与请求之间的竞态仍由 worker 404 经它兜住，一个字节不许改。
    //
    // fail-open 纪律照抄 auto 路径：清单未知/空表 ⇒ 什么都不剔，绝不因读不到清单
    // 阻断请求。剔除原因 `pack_not_serving` 写进错误行的 `errorCode`——具名路径没有
    // `skipped` 透出通道（`X-ModelPort-Auto-Skipped` 只属于 autoDecision），不发明新响应字段。
    const packModelIdsByChannel = new Map<string, Set<string>>()
    for (const candidate of [selection, ...chainCandidates]) {
      if (candidate.provider.type !== 'account') continue
      let ids = packModelIdsByChannel.get(candidate.provider.id)
      if (ids === undefined) {
        ids = new Set<string>()
        packModelIdsByChannel.set(candidate.provider.id, ids)
      }
      ids.add(candidate.actualModel)
    }
    // 逐家一次、不是逐候选一次（与 auto 路径同形）。
    const packUnservedByChannel = new Map<string, Record<string, { unserved: true }>>()
    for (const [channelId, modelIds] of packModelIdsByChannel) {
      packUnservedByChannel.set(channelId, await accountChannelManager.packUnservedModels(channelId, [...modelIds]))
    }
    const isPackUnserved = (candidate: AccountSelection): boolean => {
      if (candidate.provider.type !== 'account') return false
      const table = packUnservedByChannel.get(candidate.provider.id)
      return table !== undefined && table[candidate.actualModel] !== undefined
    }

    // 本地交付 worker 那笔 404：状态码/错误体逐字复用今天的映射管线；错误行沿用
    // 本文件「发请求前 return」分支的既有形态（`rejectionEntryFromContext`），
    // 并补上今天失败行携带的相关字段，保住「每一行错误都能被 X-Request-Id 对上」。
    const respondPackModelUnserved = (dead: AccountSelection): void => {
      const mapped = mapForwardFailure({
        status: 404,
        message: CHANNEL_MODEL_UNSERVED_MESSAGE,
        details: { message: CHANNEL_MODEL_UNSERVED_MESSAGE },
      })
      const message = withRequestId(mapped.message, requestId)
      const errorBody = {
        error: {
          message,
          type: mapped.type,
          param: mapped.param,
          code: mapped.code,
        },
      }
      ctx.status = mapped.status
      ctx.body = errorBody
      const latency = Date.now() - startTime
      storeManager.addLog('error', `Request failed: ${message}`, {
        requestId,
        providerId: dead.provider.id,
        accountId: dead.account.id,
        model: request.model,
        actualModel: dead.actualModel,
        latency,
        data: { statusCode: mapped.status, errorCode: 'pack_not_serving' },
      })
      const rejected = rejectionEntryFromContext(ctx, mapped.status, 'pack_not_serving', message)
      rejected.client = client
      rejected.requestId = requestId
      rejected.providerId = dead.provider.id
      rejected.providerName = dead.provider.name
      rejected.accountId = dead.account.id
      rejected.accountName = dead.account.name
      rejected.actualModel = dead.actualModel
      rejected.errorType = mapped.type
      rejected.errorCode = 'pack_not_serving'
      rejected.errorParam = mapped.param
      // 今天失败行的 `errorMessage`/`responseBody` 口径：原文 message + 错误体 JSON；
      // rejection 行的 `code:` 前缀只留给无转发上下文的通用拒绝。
      rejected.errorMessage = message
      rejected.responseBody = JSON.stringify(errorBody)
      storeManager.addRequestLog(rejected)
      storeManager.recordRequestInStats(false, latency, request.model, dead.provider.id, dead.account.id)
    }

    if (chainCandidates.length > 1) {
      // 链分支今天就不把 selection 直接转发，pack 不服务的链上候选只贡献「一次
      // worker 本地 404 + 换下一家」；剔掉它们省掉空转，剩下的候选继续换家。
      // 整链都被剔光时，今天这一笔的可见结果就是最后一发 worker 404——由宿主
      // 逐字交付同一错误体，不再付任何 worker 往返（这条 404 只在剔除真的发生时
      // 出现：候选链为空**且确因** pack 不服务）。
      const survivingChain = chainCandidates.filter(candidate => !isPackUnserved(candidate))
      if (survivingChain.length === 0) {
        respondPackModelUnserved(chainCandidates[0])
        return
      }
      chainCandidates = survivingChain
      // 下面转发分支的判据是 `chainCandidates.length > 1`：剔除让它 2→1 时分支会
      // 翻成单发 `selection`，必须把 selection 指到剩余链首——那正是今天换家循环
      // 实际交付的那一发；链仍 ≥2 时不碰 selection，上下文/日志形态与今天一致。
      if (chainCandidates.length === 1) {
        selection = chainCandidates[0]
        // 链分支命中后会设 `X-ModelPort-Aggregate-Chain`；翻成单发分支后没人设，
        // 在这里补一发，头口径不丢。
        ctx.set('X-ModelPort-Aggregate-Chain', toHeaderValue(selection.provider.id))
      }
    } else if (isPackUnserved(selection)) {
      // 单发分支：今天这笔就是 worker 零上游调用的本地 404，原样交付。
      respondPackModelUnserved(selection)
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
    // 空池但成因是**瞬时**的（额度窗口打满 / 账号当日上限 / 上游亲口拒过额度）：
    // 这不是「路由没有模型」，等一会儿池子里就重新有人。报 503 会让客户端把它当
    // 配置问题、且不重试；`429 + Retry-After` 才是这件事的形状（客户端据此退避，
    // 退避期间不产生任何上游调用 —— 候选在选号阶段就被剔掉了）。
    // 这一行的 auto 段与成功行同源（`autoLogRecord`）：`route` + `chainLength: 0` +
    // `skipped` 一起回答「为什么一个候选都没有」。客户端只会转述一句 503，
    // 面板上没有这一段就再也查不回来了。
    const refusalAuto = autoLogRecord(autoDecision, 0, [], null)
    // 预检剔空、且每一次剔除都是 worker 亲口说的限流：这是「等窗口复位」，不是
    // 「配置里没有模型」。`Retry-After` 取最早解禁时刻（封顶 1 小时，避免客户端
    // 按一个十几小时的窗口禁用整条路由）。
    const preflightTransient = lastStripped.length > 0
      && lastStripped.every(strip => strip.reason === 'rate_limited')
      ? (() => {
          const now = Date.now()
          const until = Math.min(...lastStripped.map(strip => strip.resetAtMs ?? now + 60_000))
          return {
            cause: 'rate_limit' as const,
            skipped: lastStripped.length,
            retryAfterSeconds: Math.max(1, Math.min(3600, Math.ceil((until - now) / 1000))),
          }
        })()
      : undefined
    // 拒绝行必须指得出是哪个模型把池子掏空的：只写路由名的一行，事后既不能归因
    // 也给不了「下次别选它」的任何依据（capacity 失败按裁定不进 Bandit 能力轴，
    // 但面板和排障至少要知道是谁）。
    const strippedHead = lastStripped[lastStripped.length - 1] ?? preflightStripped[preflightStripped.length - 1]
    const refusalAttribution = strippedHead === undefined
      ? undefined
      : {
          providerId: strippedHead.providerId,
          providerName: strippedHead.providerName,
          actualModel: strippedHead.actualModel,
        }
    // 钉子失效（模型根本不在池里）时选路已经**把软钉撤了**并返回了空链：这一轮
    // 快速失败，下一次请求就走自动排序。原先「照常按池服务」实测是 3× 504 ——
    // 客户端以为还在跟钉住的模型对话，其实每一轮都在换实现。这里必须把这件事
    // 明确说出来（503 + `pin_stale` + 模型名），沉默换模型才是更坏的失败。
    const stalePin = autoDecision.pinStale
    if (stalePin !== undefined && stalePin.action === 'retired') {
      const message = `The pinned model '${stalePin.displayName}' is no longer part of route '${autoDecision.routeName}'; ` +
        'the pin was retired - retry to use the route\'s normal order'
      const body = {
        error: {
          message,
          type: 'service_unavailable_error',
          param: null,
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
        ...(refusalAuto === undefined ? {} : { auto: refusalAuto }),
      }
      storeManager.addRequestLog(refused)
      storeManager.recordRequestInStats(false, refused.latency, refused.model || undefined)
      return
    }
    const coolingPin = autoDecision.pinCooling
    if (coolingPin) {
      // 钉子还在，只是它名下的账号刚被上游拒过、正在退避（15s–10min）。这不是
      // 「模型没了」，所以不退役、也不换一个模型顶上：换家只在回合之间发生。
      // 429 + `Retry-After` 是这件事的形状 —— 客户端退避后回到同一颗钉。
      const message = `The pinned model '${coolingPin.displayName}' on route '${autoDecision.routeName}' is cooling down after an upstream failure; retry in ${coolingPin.retryAfterSeconds}s`
      const body = {
        error: {
          message,
          type: 'rate_limit_error',
          param: null,
          code: 'model_temporarily_unavailable',
          details: {
            pin: coolingPin.displayName,
            scope: coolingPin.scope,
            source: coolingPin.source,
            retry_after_seconds: coolingPin.retryAfterSeconds,
          },
        },
      }
      ctx.status = 429
      ctx.body = body
      ctx.set('Retry-After', String(coolingPin.retryAfterSeconds))
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
        ...(refusalAuto === undefined ? {} : { auto: refusalAuto }),
      }
      storeManager.addRequestLog(refused)
      storeManager.recordRequestInStats(false, refused.latency, refused.model || undefined)
      return
    }
    const transient = autoDecision.transientUnavailable ?? preflightTransient
    if (transient) {
      const message = `All candidates for route '${autoDecision.routeName}' are temporarily unavailable (${describeTransientCause(transient.cause)}); retry in ${transient.retryAfterSeconds}s`
      const body = {
        error: {
          message,
          type: 'rate_limit_error',
          param: null,
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
        ...(refusalAuto === undefined ? {} : { auto: refusalAuto }),
        ...(refusalAttribution === undefined ? {} : refusalAttribution),
      }
      storeManager.addRequestLog(refused)
      storeManager.recordRequestInStats(false, refused.latency, refused.model || undefined)
      return
    }
    // 空池而没有 `missing` 时，跳过清单是唯一线索（整池都在冷却/目录未命中里时
    // 一个能力名都写不出来）。消息仍保持既有那一句，客户端按它分支。
    const message = `No available model for route '${autoDecision.routeName}'${autoDecision.profile.needsVision ? ' (vision required)' : ''}`
    const body = {
      error: {
        // 带上路由名（多条路由都可能报这个错，客户端要能看出是哪条没选出候选）
        message,
        type: 'service_unavailable_error',
        param: null,
        code: 'no_available_model',
        // 被钉住的模型挡下这一轮时，缺的能力来自那颗钉而不是整池：不单说一句，
        // 客户端只能读到「这条路由没有可用模型」，而用户明明固定了一个模型。
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
      ...(refusalAuto === undefined ? {} : { auto: refusalAuto }),
      ...(refusalAttribution === undefined ? {} : refusalAttribution),
    }
    storeManager.addRequestLog(refused)
    storeManager.recordRequestInStats(false, refused.latency, refused.model || undefined)
    return
  }

  // 没有满足结构化输出的候选时仍然路由，但必须写明降级，不能假装满足
  if (autoDecision && autoDecision.degraded.length > 0) {
    ctx.set('X-ModelPort-Auto-Degraded', autoDecision.degraded.join(','))
  }
  if (autoDecision) {
    ctx.set('X-ModelPort-Auto-Prefer', autoDecision.prefer)
    ctx.set('X-ModelPort-Auto-Reason', autoDecision.reason)
    // 本轮真实服务者的窗口，逐请求给 —— `/v1/models` 那条静态下界覆盖不了「这一跳
    // 换了一家更小的」的情况。只承诺过了来源闸门的数（`advertisedContextWindow`），
    // 没把握就不设这个头，让客户端继续用它自己的先验，而不是给一个可能偏大的上界。
    // 流式也读得到：头在首帧之前就设，回环的 anthropic / responses 两道经
    // `copyModelPortHeaders` 自动带走。
    if (autoDecision.advertisedContextWindow !== undefined) {
      ctx.set('X-ModelPort-Context-Window', String(autoDecision.advertisedContextWindow))
    }
  }

  // auto 路由时先按排名第一的候选记录请求开始，成功后再用真实命中的账号结算用量
  let account = selection ? selection.account : firstCandidate!.account
  let provider = selection ? selection.provider : firstCandidate!.provider
  let actualModel = selection ? selection.actualModel : firstCandidate!.actualModel
  let chosenCandidate: AutoCandidate | null = null
  let autoAttempts = 0
  // 换家循环里被跳过的候选（判据与循环分支同源）；第一家命中时为空。
  let autoFailures: AutoAttemptFailure[] = []
  let attemptTrace: RequestAttemptTrace[] = []

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
    clientUserAgent: ctx.headers['user-agent'],
  }

  proxyStatusManager.recordRequestStart(request.model, provider.id, account.id)

  try {
    let result: ForwardResult

    if (autoDecision) {
// 上游亲口说「这个模型此刻没有额度」且**一个字节都没产出**：这一发在客户端
      // 看来还没开始，换下一个模型重放不伤上下文 / 工具协议 / 前缀缓存 ——
      // `single` 收口禁止的是「产出到一半换实现」，不是禁止在同一条空结果上重新
      // 开局。预检看得见的限流已在选号前重选（`applyChannelPreflights`），这里
      // 兜住预检看不见的那一类（渠道匿名池的 `free_usage_limit` 等）。
      const triedModels = new Map<string, { providerId: string; displayName: string }>()
      const capacitySkipped: string[] = []
      let outcome: ForwardChainOutcome<AutoCandidate> | null = null
      let attemptsTotal = 0
      let failuresTotal: AutoAttemptFailure[] = []
      let traceTotal: RequestAttemptTrace[] = []
      for (let hop = 0; ; hop += 1) {
        for (const candidate of autoDecision.candidates) {
          triedModels.set(`${candidate.provider.id}::${candidate.displayName}`, {
            providerId: candidate.provider.id,
            displayName: candidate.displayName,
          })
        }
        outcome = await requestForwarder.forwardAutoCompletion(
          request,
          autoDecision.candidates,
          context,
          // 换家预算随 decision 走：这条路由的 maxAttempts，而不是转发层自己去读
          // 全局 legacy `autoRouting.maxAttempts`。池语义（换下一家含下一个模型）由
          // `forwardAutoCompletion` 自己打开，调用方不再传栅栏。
          {
            baseCap: autoDecision.baseCap,
            ...(autoDecision.wallClockBudgetMs === undefined
              ? {}
              : { wallClockBudgetMs: autoDecision.wallClockBudgetMs }),
          }
        )
        if (!outcome) break
        attemptsTotal += outcome.attempts
        failuresTotal = [...failuresTotal, ...outcome.failures]
        traceTotal = [...traceTotal, ...outcome.attemptTrace]
        if (!isZeroOutputCapacityFailure(outcome.result)) break
        if (hop >= MAX_CAPACITY_MODEL_SWITCHES) break
        // 钉子与「一条都没选出来」都不换：钉子换模型等于静默违背用户选择；
        // 空链留给下面的 429/503 投影。
        if (autoDecision.pin !== undefined || route === undefined) break
        if (request.signal?.aborted === true) break
        const retry = autoRouter.select(
          request,
          config.loadBalanceStrategy,
          autoPreference,
          route,
          clientSession,
          headerModel,
          [...triedModels.values()]
        )
        if (retry.candidates.length === 0) break
        for (const { providerId, displayName } of triedModels.values()) {
          const marker = `${providerId}/${displayName}:quota-exhausted`
          if (!capacitySkipped.includes(marker)) capacitySkipped.push(marker)
        }
        for (const marker of capacitySkipped) {
          if (!retry.skipped.includes(marker)) retry.skipped.push(marker)
        }
        autoDecision = retry
        // 换模型发生在任何响应字节写出之前：把新的跳过清单补发一次，客户端看到的
        // 「为什么绕开上一家」与请求日志是同一份。
        const skippedHeader = autoSkippedHeader(retry.skipped)
        if (skippedHeader !== undefined) ctx.set('X-ModelPort-Auto-Skipped', skippedHeader)
      }

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
      autoAttempts = attemptsTotal
      autoFailures = failuresTotal
      attemptTrace = traceTotal
      ctx.set('X-ModelPort-Auto-Attempts', String(attemptsTotal))
      chosenCandidate = outcome.candidate
      // 循环外的窄化：赋值发生在循环里，控制流分析不会把窄化带出来。
      const served = chosenCandidate
      account = served.account
      provider = served.provider
      actualModel = served.actualModel
      // 供应商名可能含中文（账号渠道如 `TRAE (字节)`、自定义供应商由用户命名），
      // 直接写进头值会让 Node 抛 ERR_INVALID_CHAR、把一次成功的路由变成 500，
      // 所以动态部分一律过 toHeaderValue（非 ASCII 按 UTF-8 百分号编码）。
      ctx.set('X-ModelPort-Route', routeHeaderValue(actualModel, provider.name))
      // 中途换实现的客户端可见形态：只在这一轮服务者与上一轮锚点不同时出现。
      // 「模型名不变、行为变了」是客户端最难自查的一类故障，这个头把它变成可观察事实。
      const switched = autoSwitchOf(autoDecision, served)
      if (switched !== null) {
        ctx.set('X-ModelPort-Switch', toHeaderValue(`${switched.from} -> ${switched.to}`))
      }
      // 软钉的客户端可见形态：命中说明「这一轮是因你点名才跑的它」，失配说明
      // 「点了但没生效」。失配静默是这类功能最坏的失败方式 —— 用户会以为切换坏了。
      // 失效（模型已经不在池里）单独一种写法：它与「此刻没账号」不是一回事，
      // 客户端据此判断该不该继续按这颗钉重试。
      if (autoDecision.pinStale !== undefined) {
        ctx.set(
          'X-ModelPort-Pin',
          toHeaderValue(`stale=${autoDecision.pinStale.displayName};action=${autoDecision.pinStale.action}`)
        )
      } else if (autoDecision.pinMiss !== undefined) {
        ctx.set('X-ModelPort-Pin', toHeaderValue(`miss=${autoDecision.pinMiss}`))
      } else if (autoDecision.pin !== undefined
        && served.displayName === autoDecision.pin.displayName) {
        ctx.set('X-ModelPort-Pin', toHeaderValue(`hit=${autoDecision.pin.displayName}`))
      }
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
      attemptTrace = outcome.attemptTrace
      ctx.set('X-ModelPort-Aggregate-Chain', toHeaderValue(provider.id))
    } else {
      // 静默通道快速失败：具名单候选没有下家，首块超时的代价全部落在客户端这一
      // 次等待上。连续超时且长期没有成功的 (账号, 模型) 已被运行时判为「现在不会
      // 开口」（判据见 `accountRuntime.recordFirstBlockTimeout`），本轮直接收口成
      // 503 + Retry-After，而不是再陪它等 30–44s 后交回同一句超时。
      const silent = accountRuntime.silentChannel(account.id, actualModel)
      if (silent !== undefined) {
        const retryAfterSeconds = Math.max(1, Math.ceil(silent.retryAfterMs / 1000))
        const message = `渠道连续 ${silent.timeouts} 次在首块前超时、近期没有任何成功，本轮不再空等（${retryAfterSeconds}s 后再试）`
        result = {
          success: false,
          status: 503,
          error: message,
          errorDetails: { message, code: SILENT_CHANNEL_SKIP_CODE },
          retryAfter: String(retryAfterSeconds),
          latency: Date.now() - startTime,
          attempts: [],
        }
      } else {
        result = await requestForwarder.forwardChatCompletion(
          request,
          account,
          provider,
          actualModel,
          context
        )
      }
      const firstAttempts = result.attempts ?? []
      attemptTrace = firstAttempts

      // 同一聚合供应商配了多把 Key：这把失败且属于**账号级**故障（401/403/408/
      // 429/5xx/网络错误）时，轮换到该供应商其余 Key 继续试；客户端拿到的是最后
      // 一次尝试的结果，全部失败时失败样貌不变（429 仍带 Retry-After）。404 不在
      // 其中：同一供应商的其它 Key 看到的模型目录通常一样，轮换只是白打。
      // 用户点名了具体账号（硬性指定）时不轮换。
      if (!result.success && !preferredAccountId && isSameProviderRotationStatus(result.status)) {
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
            attemptTrace = [...firstAttempts, ...outcome.attemptTrace]
          }
        }
      }
    }

    const latency = Date.now() - startTime

    // 配额不足标记的唯一落点：三条分支（auto / 跨家链 / 单发+同家换 Key）都汇到
    // `attemptTrace` 上，所以记录与清除都在这里发生一次，不散进各分支。
    // 解禁时刻优先用客户端最终读到的那一发 Retry-After（上游给了就用它，没给退回 TTL）。
    const finalRetryAfterSeconds = parseRetryAfterSeconds(result.retryAfter)
      ?? parseRetryAfterSeconds(retryAfterHeader(result.headers as Record<string, unknown> | undefined))
    applyQuotaExhaustions(
      attemptTrace,
      finalRetryAfterSeconds === undefined ? undefined : finalRetryAfterSeconds * 1000
    )

    // 上下文超限的实测来源有两个：最终失败结果、换家循环里被跳过的候选。
    // 后者也必须算进来 —— 「A 家装不下、B 家承接了」正是这条读数要留下来的事实,
    // 只看最终结果会把它误记成 fits。
    const contextMeasuredOverflow = isContextOverflowError(result.error)
      || autoFailures.some(failure => isContextOverflowError(failure.reason))

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

      // auto 路由的失败账号已在 forwardAutoCompletion 内逐个标记，这里不重复计数。
      // 只有账号级故障（凭据/权限/超时/限流/5xx/网络）才记账：客户端自己写错的
      // 400/404/422 不该把健康账号打进失败池。
      if (
        !autoDecision
        && !request.signal?.aborted
        && !result.localAdmissionRejected
        && isAccountFault(result.status, result.error)
      ) {
        loadBalancer.markAccountFailed(account.id)
      }

      // 自动路由的 404 是「最后一个候选供不了」，不是「这条路由/模型不存在」。
      // 原样透传会让 Anthropic 客户端（Claude）把候选耗尽当成模型被删除，
      // 后续整段会话不再请求；路由确实存在时统一收口成可重试的 503。
      const exhausted = autoDecision
        ? autoExhaustedResponse(
            result.status,
            autoDecision.routeName,
            result.error,
            autoAttempts,
            finalRetryAfterSeconds,
            autoDecision.modelScope === 'single' ? autoDecision.model : undefined,
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
      learnQuotaCaps(provider, result.headers, result.error)
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

      // 失败行的结构化字段：消息是给人读的中文散文，机读事实（状态码、上游状态、
      // 错误码、真实模型）单独落 `data` —— 否则「40s 没首块」与「上游 504」在
      // 日志里只差一句话，统计脚本只能去解析散文。
      storeManager.addLog('error', `Request failed: ${message}`, {
        requestId,
        providerId: provider.id,
        accountId: account.id,
        model: request.model,
        actualModel,
        latency,
        data: {
          statusCode: mapped.status,
          ...(result.status === undefined ? {} : { upstreamStatus: result.status }),
          ...(mapped.code === null ? {} : { errorCode: mapped.code }),
        },
      })

      const userInput = extractUserInput(request.messages)
      const errorResponseBody = JSON.stringify(errorBody)
      storeManager.addRequestLog({
        timestamp: startTime,
        status: 'error',
        statusCode: mapped.status,
        method: 'POST',
        url: '/v1/chat/completions',
        requestId,
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        userInput,
        client,
        auto: autoLogRecord(autoDecision, autoAttempts, autoFailures, chosenCandidate),
        ...contextReadingFor(autoDecision, contextMeasuredOverflow),
        attempts: attemptTrace,
        upstreamRequestId: result.upstreamRequestId,
        captureBodies: traceRequested,
        compression: compressionReport,
        duplication,
        conversationTurn,
        webSearch: request.web_search,
        reasoningEffort: request.reasoning_effort,
        maxTokens: requestedMaxTokens,
        responseStatus: mapped.status,
        responseBody: errorResponseBody,
        latency,
        isStream: request.stream || false,
        errorMessage: message,
        upstreamStatus: result.status,
        errorType: mapped.type,
        errorCode: mapped.code,
        errorParam: mapped.param,
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

    const userInput = extractUserInput(request.messages)
    // Prepare response body for logging (only for non-stream requests)
    const responseBodyForLog = !request.stream && result.body
      ? JSON.stringify(result.body)
      : undefined

    // Read usage once: the log row and the quota ledger must show the same
    // numbers, and a second read of the same body is exactly how the two drift.
    const outputText = !request.stream
      ? String(
          (result.body as { choices?: Array<{ message?: { content?: unknown } }> } | undefined)
            ?.choices?.[0]?.message?.content ?? '',
        )
      : ''
    const nonStreamReading = !request.stream
      ? readOrEstimateUsage(usageInputText(request), outputText, result.body)
      : undefined
    const nonStreamUsage = nonStreamReading === undefined ? undefined : upstreamUsageOf(nonStreamReading)

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
        requestId,
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        userInput,
        client,
        auto: autoLogRecord(autoDecision, autoAttempts, autoFailures, chosenCandidate),
        ...contextReadingFor(autoDecision, contextMeasuredOverflow),
        attempts: attemptTrace,
        upstreamRequestId: result.upstreamRequestId,
        captureBodies: traceRequested,
        compression: compressionReport,
        duplication,
        conversationTurn,
        webSearch: request.web_search,
        reasoningEffort: request.reasoning_effort,
        maxTokens: requestedMaxTokens,
        responseStatus: 200,
        responseBody: responseBodyForLog,
        ...(nonStreamUsage === undefined ? {} : { usage: nonStreamUsage }),
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
        requestId,
        model: request.model,
        actualModel,
        providerId: provider.id,
        providerName: provider.name,
        accountId: account.id,
        accountName: account.name,
        requestBody: JSON.stringify(request),
        userInput,
        client,
        auto: autoLogRecord(autoDecision, autoAttempts, autoFailures, chosenCandidate),
        ...contextReadingFor(autoDecision, contextMeasuredOverflow),
        attempts: attemptTrace,
        upstreamRequestId: result.upstreamRequestId,
        captureBodies: traceRequested,
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

    // 上游返回了本次请求没声明的工具名时记一行（纯观测，不改响应字节）。
    // 没声明任何工具的请求不跑：那种请求里任何调用都算「越界」，只会变成噪声。
    const declaredToolNames = declaredChatToolNames(request.tools)
    const droppedToolNames = [...rawChatToolNames(request.tools)]
      .filter(name => !declaredToolNames.has(name))
    const auditUndeclaredToolNames = (offending: readonly string[]): void => {
      if (declaredToolNames.size === 0 || offending.length === 0) return
      if (!undeclaredToolNameLimiter.claim(`${actualModel}|${offending.join(',')}`)) return
      storeManager.addLog('warn', formatUndeclaredToolNameLine({
        model: actualModel,
        offending,
        declared: declaredToolNames,
        dropped: droppedToolNames,
        requestId,
      }), {
        requestId,
        providerId: provider.id,
        accountId: account.id,
        model: request.model,
        actualModel,
      })
    }

    if (nonStreamReading !== undefined) {
      meterQuota(
        provider,
        account.id,
        actualModel,
        nonStreamReading,
        // 只计真正生效的压缩节省；跳过的请求不计入（那是反事实）。
        compressionReport && compressionReport.applied.length > 0
          ? compressionReport.saved
          : 0,
        compressionReport
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
      // 每个响应恰好一个 [DONE]：直通路径可能由上游给，转换路径由转换器给；
      // 错误路径只在还没写过时补一个。
      let sawDone = false
      let streamSettled = false
      let firstTokenAt: number | undefined
      let bytesOut = 0
      let endReason: RequestStreamTrace['endReason']
      let heartbeat: SseHeartbeat | undefined
      let streamOutcomeReported = false
      wrapperStream.on('error', () => {})

      // 观测我们下行发出的思考，按 tool_call.id 缓存，下一轮由转发器回灌
      // （`proxy/reasoningEcho.ts`）。两条泳道共用这一份：账号渠道的 SSE 也在这里
      // 过手（worker 线程那份已退役，跨泳道切换时它看不见主线程的缓存）。
      const reasoningEcho = reasoningEchoApplies(provider)
        ? createReasoningEchoObserver()
        : undefined

      // 退化判据的阈值是设置项（默认即当前标定值）；关掉时连读数都不算。
      const repetitionGuard =
        storeManager.getConfig().streamRepetitionGuard ?? DEFAULT_REPETITION_GUARD

      const reportStreamOutcome = (
        reason: RequestStreamTrace['endReason'],
        totalMs: number,
        degraded = false,
        modelQuality = false,
      ): void => {
        if (streamOutcomeReported) return
        streamOutcomeReported = true
        accountRuntime.recordStreamOutcome(account.id, actualModel, {
          ...(firstTokenAt === undefined ? {} : { firstTokenMs: firstTokenAt - startTime }),
          totalMs,
          endReason: reason,
          degraded,
          modelQuality,
        })
      }

      const streamTraceOf = (
        reason: RequestStreamTrace['endReason'],
        totalMs: number,
      ): RequestStreamTrace => ({
        ...(firstTokenAt === undefined ? {} : { firstTokenMs: firstTokenAt - startTime }),
        totalMs,
        bytesOut,
        endReason: reason,
        sawDone,
        pingCount: heartbeat?.pingCount() ?? 0,
        ...(result.upstreamRequestId === undefined
          ? {}
          : { upstreamRequestId: result.upstreamRequestId }),
        repetition: measureStreamRepetition(collectedContent, repetitionGuard) ?? undefined,
        // 空转读数与去重率同源于这一份累计 SSE 文本：两次各读一遍就是两个数打架的开始。
        emptyTurn: measureStreamEmptyTurn(
          collectedContent,
          Array.isArray(request.tools) && request.tools.length > 0,
        ),
      })

      /**
       * 本轮不健康时撤粘性锚点：内容退化、首块后超时、上游流错误都算。
       *
       * 粘性在响应头阶段就写了（成功路径上的 `rememberRoute`），而这些问题要到
       * 流结束才算得出来。不撤的话，协议成功但内容塌掉/中途停摆的这一家会一直
       * 把会话钉住 —— 2026-11-03 的重复退化会话与 2026-11-06 qodercn 的三连
       * 停摆都是这个形状。
       */
      const settleSticky = (
        trace: RequestStreamTrace,
        truncated: boolean,
        errorCode?: string | null,
      ): void => {
        if (!autoDecision || !chosenCandidate) return
        // 架构 A：内容级退化（重复/空转/宣布即停/只说话不做事/合成不完整）落成
        // 一张**模型级**熔断票。这是「回合之间换模型」的唯一通路 —— 一轮之内不换
        // 模型，所以「这家干不了活」必须在回合边界变成「下一轮从别家开始」。账号级
        // AIMD 管的是账号能不能接，两者不合并（同模型三家账号全限流不代表模型该换）。
        const quality = modelQualityDegradation(trace, autoAttempts > 1, errorCode)
        if (quality !== undefined) {
          autoRouter.tripModelCircuit(autoDecision.routeName, chosenCandidate.displayName, quality)
        }
        // 第六类（第 2 条）：这一轮首字慢于池内 p75。门槛是选路阶段算好的同一格，
        // 与硬粘性「要不要提前」同源；读数缺失（非流式/首块没打点）时不判。
        // 第七类：这一轮是换家换来的，替补给了一句正文就收尾 —— 不钉在替补上。
        // `attempts > 1` 就是「首选没答上来」的现成读数，不另记一份。
        if (!shouldRevokeStickyAfterStream(
          trace,
          truncated,
          autoDecision.latencyGateMs,
          autoAttempts > 1,
        )) return
        autoRouter.revokeSticky(autoDecision.conversationKey, autoDecision.route)
      }

      const failStream = (err: Error) => {
        if (streamSettled) return
        streamSettled = true
        // 失败也提交：已产出的思考下一轮同样要回灌（与 `channelPack/worker.ts` 同口径）。
        reasoningEcho?.finish()
        const details = err as Error & Partial<StreamErrorFrame>
        const failureStatus = details.status ?? 502
        if (endReason === undefined) {
          endReason = failureStatus === 504 ? 'timeout' : 'error'
        }
        reportStreamOutcome(endReason, Date.now() - startTime)
        const trace = streamTraceOf(endReason, Date.now() - startTime)
        settleSticky(trace, false)

        // 流失败必须回写请求日志：日志条目是在响应头阶段按 success 建的，
        // 不翻成 error 的话这条请求在日志里永远显示成功（且耗时为响应头时间）。
        // 客户端已断开也要写 —— 那正是用户看到失败、日志却全绿的情形。
        if (logEntryId) {
          storeManager.updateRequestLog(logEntryId, {
            status: 'error',
            statusCode: failureStatus,
            responseStatus: failureStatus,
            responsePreview: err.message,
            // 错误页签读的是 errorMessage，只写 responsePreview 的话这条失败在详情里是空的。
            errorMessage: err.message,
            errorType: details.type,
            errorCode: details.code ?? null,
            errorParam: details.param ?? null,
            streamTrace: trace,
          })
        }

        // 已经正常收尾的流不再追加错误帧，避免 [DONE] 之后又冒出 data。
        // 逐块标志可能漏掉跨块拆开的 `[DONE]`，结算时按累计文本再确认一次。
        if (collectedContent.includes('data: [DONE]')) sawDone = true
        if (sawDone) {
          storeManager.addLog('error', `Stream error after completion: ${err.message}`, {
            requestId,
            providerId: provider.id,
            accountId: account.id,
            model: request.model,
          })
          return
        }

        // 客户端已断开时不再回写错误帧，避免 write after end
        if (wrapperStream.destroyed || ctx.res.writableEnded || ctx.res.destroyed) return

        console.error('[Chat] Stream error:', err.message)

        wrapperStream.write(buildStreamErrorFrame(err.message, {
          ...(details.type === undefined ? {} : { type: details.type }),
          code: details.code ?? null,
          param: details.param ?? null,
        }))
        sawDone = true
        wrapperStream.write('data: [DONE]\n\n')
        wrapperStream.end()

        storeManager.addLog('error', `Stream error: ${err.message}`, {
          requestId,
          providerId: provider.id,
          accountId: account.id,
          model: request.model,
        })
      }

      result.stream.once('error', failStream)

      // Check if stream is already in correct SSE format (from adapters like Kimi, GLM, DeepSeek)
      if (result.skipTransform) {
        // Stream is already formatted, pipe through wrapper and collect.
        // 同时扫一遍错误帧：直通路径把上游 SSE 原样交给客户端，但不该让请求
        // 日志继续显示成功；缺失 [DONE] 时由本层补一个，保证客户端契约。
        const errorScanner = new SSEParser()
        let streamError: StreamErrorFrame | undefined
        result.stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          if (firstTokenAt === undefined) firstTokenAt = Date.now()
          bytesOut += Buffer.byteLength(text)
          collectedContent += text
          // 账号渠道的思考观测点：worker 线程不再自己攒，全部落到主线程这份缓存。
          reasoningEcho?.push(chunk)
          for (const event of errorScanner.parse(text)) {
            const data = event.data.trim()
            if (data === '[DONE]') {
              sawDone = true
              continue
            }
            if (streamError) continue
            try {
              const frame = extractStreamErrorFrame(JSON.parse(data))
              if (frame) streamError = frame
            } catch {
              // 非 JSON / 半帧：交给下一次 parse；不把未知事件当错误。
            }
          }
        })

        result.stream.pipe(wrapperStream, { end: false })

        // When source stream ends normally, update log and end wrapper
        result.stream.once('end', () => {
          streamSettled = true
          // 流正常收尾：把本轮攒到的思考提交进缓存（与转换路径同一口径）。
          reasoningEcho?.finish()
          const elapsed = Date.now() - startTime
          // 这条流的输出就是上游 SSE 本身，结束原因与「有没有结束原因」直接从它读。
          const outcome = readStreamOutcome(collectedContent)
          const upstreamSawDone = sawDone
          if (endReason === undefined) {
            endReason = streamError ? 'error' : upstreamSawDone ? 'done' : 'eof'
          }
          // 先补 [DONE] 再结算 trace，这样 trace.sawDone 的口径是「客户端最终
          // 拿到的流里有没有收尾符」，同时 endReason 仍按上游是否真的宣布过来判。
          if (!sawDone && !wrapperStream.destroyed) {
            sawDone = true
            wrapperStream.write('data: [DONE]\n\n')
          }
          const trace = streamTraceOf(endReason, elapsed)
          // 客户端没给上限、上游却按自己的默认值截断：这一轮末尾是断的，锚点必须撤。
          const truncated = outcome.finishReason === 'length' && requestedMaxTokens === undefined
          // 渠道包合成的 incomplete（工具批被丢/连接被掐断…）走错误帧，码在这里读。
          // 它是模型级缺陷：上熔断票，但不按账号拥塞失败降 AIMD。
          const errorCode = streamError && typeof streamError.code === 'string' ? streamError.code : undefined
          const modelQuality = errorCode === INCOMPLETE_STEP_CODE
          settleSticky(trace, truncated, errorCode)
          reportStreamOutcome(
            endReason,
            elapsed,
            truncated
            || isEmptyTurnAfterStream(trace)
            || isAnnouncedStopAfterStream(trace),
            modelQuality,
          )
          // One reading feeds both the log row and the ledger; a second read of
          // the collected stream is how the two figures drift apart.
          const streamReading = readOrEstimateUsage(usageInputText(request), collectedContent)
          const streamUsage = upstreamUsageOf(streamReading)
          // Update log with collected response
          if (logEntryId) {
            storeManager.updateRequestLog(logEntryId, streamError
              ? {
                  status: 'error',
                  statusCode: streamError.status ?? 502,
                  responseStatus: streamError.status ?? 502,
                  responseBody: collectedContent || undefined,
                  responsePreview: streamError.message,
                  errorMessage: streamError.message,
                  errorType: streamError.type,
                  errorCode: streamError.code ?? null,
                  errorParam: streamError.param ?? null,
                  finishReason: outcome.finishReason,
                  streamTruncated: !outcome.sawFinish,
                  streamTrace: trace,
                  ...(streamUsage === undefined ? {} : { usage: streamUsage }),
                  ...(result.deferred ? { latency: elapsed } : {}),
                }
              : {
                  responseBody: collectedContent || undefined,
                  finishReason: outcome.finishReason,
                  streamTruncated: !outcome.sawFinish,
                  streamTrace: trace,
                  ...(streamUsage === undefined ? {} : { usage: streamUsage }),
                  // 延迟型响应（响应头先发、正文后补）的耗时是整段，不是首字节
                  ...(result.deferred ? { latency: elapsed } : {}),
                })
          }
          meterQuota(
            provider,
            account.id,
            actualModel,
            streamReading,
            compressionReport && compressionReport.applied.length > 0
              ? compressionReport.saved
              : 0,
            compressionReport
          )
          wrapperStream.end()
          if (streamError) {
            storeManager.addLog('error', `Stream error: ${streamError.message}`, {
              requestId,
              providerId: provider.id,
              accountId: account.id,
              model: request.model,
            })
          }
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
          const text = chunk.toString()
          bytesOut += Buffer.byteLength(text)
          collectedContent += text
          if (text.includes('data: [DONE]')) sawDone = true
        })

        // 转换器内部抛出的错误（例如上游错误帧）必须在这里接住：原先没有
        // error 监听者，事件会变成未捕获异常，客户端只看到流停住。
        transformStream.once('error', (err: Error) => {
          const source = result.stream as Readable
          if (!source.destroyed) source.destroy()
          failStream(err)
        })

        // 断流判定必须看上游原始 SSE：交付流只保留网关实际转发出去的帧，
        // 上游在流尾发了什么（finish_reason / [DONE]）只能从原始字节里读。
        // 结束帧都在流尾，留 8KB 够判。
        let upstreamTail = ''
        result.stream.on('data', (chunk: Buffer) => {
          if (firstTokenAt === undefined) firstTokenAt = Date.now()
          upstreamTail = (upstreamTail + chunk.toString()).slice(-8192)
          reasoningEcho?.push(chunk)
        })

        result.stream.pipe(transformStream)
        transformStream.pipe(wrapperStream, { end: false })

        transformStream.once('end', () => {
          streamSettled = true
          // 流正常收尾：把本轮攒到的思考提交进缓存。
          reasoningEcho?.finish()
          const elapsed = Date.now() - startTime
          const delivered = readStreamOutcome(collectedContent)
          const upstream = readStreamOutcome(upstreamTail)
          // 上游宣布了结束、交付流却没有结束帧，客户端会读成断流（Qoder 报 code=500），
          // 而行状态仍是 success。两者一旦分叉就必须留下可检索的证据。
          if (upstream.sawFinish && !delivered.sawFinish) {
            storeManager.addLog('warn', '交付流缺少上游已发出的结束帧', {
              requestId,
              data: { upstreamFinishReason: upstream.finishReason ?? null, bytesOut },
            })
          }
          const upstreamSawDone = sawDone
          if (endReason === undefined) endReason = upstreamSawDone ? 'done' : 'eof'
          if (!sawDone && !wrapperStream.destroyed) {
            sawDone = true
            wrapperStream.write('data: [DONE]\n\n')
          }
          const trace = streamTraceOf(endReason, elapsed)
          // 与直通路径同口径：客户端没点上限而上游截断，锚点必须撤。
          const truncated = delivered.finishReason === 'length' && requestedMaxTokens === undefined
          settleSticky(trace, truncated)
          reportStreamOutcome(
            endReason,
            elapsed,
            truncated
            || isEmptyTurnAfterStream(trace)
            || isAnnouncedStopAfterStream(trace),
          )
          const streamReading = readOrEstimateUsage(usageInputText(request), collectedContent)
          const streamUsage = upstreamUsageOf(streamReading)
          // Update log with collected response
          if (logEntryId) {
            storeManager.updateRequestLog(logEntryId, {
              responseBody: collectedContent || undefined,
              finishReason: delivered.finishReason,
              streamTruncated: !upstream.sawFinish,
              streamTrace: trace,
              ...(streamUsage === undefined ? {} : { usage: streamUsage }),
            })
          }
          meterQuota(
            provider,
            account.id,
            actualModel,
            streamReading,
            compressionReport && compressionReport.applied.length > 0
              ? compressionReport.saved
              : 0,
            compressionReport
          )
          wrapperStream.end()
        })
      }

      const requiresToolCall =
        request.tool_choice === 'required' ||
        (typeof request.tool_choice === 'object' && request.tool_choice?.type === 'function')

      let outStream: Readable = wrapperStream
      if (declaredToolNames.size > 0) {
        outStream = outStream.pipe(createUndeclaredToolNameTap({
          declared: declaredToolNames,
          onUndeclared: auditUndeclaredToolNames,
        }))
      }
      if (requiresToolCall) outStream = outStream.pipe(createToolViolationTap())
      ctx.body = outStream

      // 立即发送响应头：客户端通常只对“响应头”计时（例如 10s），首个 token 可能远晚于此
      ctx.res.flushHeaders()

      heartbeat = startSseHeartbeat(wrapperStream)
      const stopPing = heartbeat.stop
      wrapperStream.once('finish', stopPing)
      wrapperStream.once('close', stopPing)

      // 客户端提前断开时中止上游流，避免继续占用账号与上游配额
      ctx.res.once('close', () => {
        stopPing()
        if (ctx.res.writableEnded) return
        if (endReason === undefined) endReason = 'client_gone'
        reasoningEcho?.finish()
        const source = result.stream as Readable
        if (!source.destroyed) source.destroy()

        // 补充请求日志的结束记录：collectedContent 里已攒到断点前的所有 SSE 帧，
        // 可以从中读出 finish_reason（如果上游已发）并写出完整的 streamTrace。
        // 不触发 meterQuota/reportStreamOutcome，保持与 accountRuntime.recordStreamOutcome(…,'client_gone')
        // 的"不计分不扣分"策略一致。
        if (!streamSettled && logEntryId) {
          streamSettled = true
          const elapsed = Date.now() - startTime
          const outcome = readStreamOutcome(collectedContent)
          const trace = streamTraceOf(endReason, elapsed)
          storeManager.updateRequestLog(logEntryId, {
            responseBody: collectedContent || undefined,
            finishReason: outcome.finishReason,
            streamTruncated: !outcome.sawFinish,
            streamTrace: trace,
          })
        }
      })
    } else {
      ctx.set('Content-Type', 'application/json')

      const requiresToolCall =
        request.tool_choice === 'required' ||
        (typeof request.tool_choice === 'object' && request.tool_choice?.type === 'function')
      const bodyToolCalls = (
        result.body as { choices?: Array<{ message?: { tool_calls?: unknown } }> } | undefined
      )?.choices?.[0]?.message?.tool_calls
      if (requiresToolCall && (!Array.isArray(bodyToolCalls) || bodyToolCalls.length === 0)) {
        ctx.set('X-ModelPort-Tool-Violation', 'required')
      }

      if (result.body) {
        auditUndeclaredToolNames(
          findUndeclaredToolNames(collectToolCallNames(result.body), declaredToolNames),
        )
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
      requestId,
      model: request.model,
      actualModel,
      providerId: provider.id,
      providerName: provider.name,
      accountId: account.id,
      accountName: account.name,
      requestBody: JSON.stringify(request),
      userInput,
      auto: autoLogRecord(autoDecision, autoAttempts, autoFailures, chosenCandidate),
      attempts: attemptTrace,
      captureBodies: traceRequested,
      webSearch: request.web_search,
      reasoningEffort: request.reasoning_effort,
      maxTokens: requestedMaxTokens,
      responseStatus: 500,
      responseBody: exceptionResponseBody,
      latency,
      isStream: request.stream || false,
      errorMessage,
      errorStack,
      errorType: 'internal_error',
      errorCode: null,
      errorParam: null,
    })

    storeManager.recordRequestInStats(false, latency, request.model, provider.id, account.id)
  }
})

export default router
