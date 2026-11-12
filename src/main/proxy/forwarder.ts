/**
 * Proxy Service Module - Request Forwarder
 * Forwards requests to corresponding API based on provider configuration
 */

import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios'
import http2 from 'http2'
import { PassThrough, type Readable } from 'stream'
import { Account, Provider } from '../store/types'
import {
  ForwardResult,
  ChatCompletionRequest,
  ProxyContext,
  type ChatMessage as ContextChatMessage,
  type UpstreamErrorDetails,
} from './types'
import { storeManager } from '../store/store'
import {
  DEFAULT_AUTO_ROUTING_CONFIG,
  type AutoAttemptFailure,
  type RequestAttemptTrace,
} from '../../shared/types'
import { AnthropicAdapter } from './adapters/anthropic'
import { loadBalancer } from './loadbalancer'
import { autoRouter, type AutoCandidate } from './autoRouter'
import {
  pickUpstreamErrorDetails,
  readUpstreamErrorData,
  summarizeUpstreamErrorBody,
} from './upstreamErrorBody'

/** 一个可尝试的目标：与 AutoCandidate 同形，供裸名跨家链复用同一个切换循环。 */
export interface ChainCandidate {
  account: Account
  provider: Provider
  displayName: string
  actualModel: string
}

/**
 * 换家循环的产出：最终赢家 + **每一次被跳过候选的失败样貌**。
 *
 * `failures` 只含被跳过的家（成功那轮不进列表），全部失败时含最后一家 ——
 * 那正是客户端拿到的错误。上限 {@link MAX_LOGGED_ATTEMPT_FAILURES} 条。
 */
export interface ForwardChainOutcome<T extends ChainCandidate> {
  result: ForwardResult
  candidate: T
  attempts: number
  failures: AutoAttemptFailure[]
  /** Structured per-attempt rows for the request log (winner included). */
  attemptTrace: RequestAttemptTrace[]
}

/**
 * 日志里最多留几次失败。
 *
 * 候选链不再在选号阶段裁到 6 家（见 `autoRouter.ts::select`），所以这个数不再是
 * 「防御异常循环」而是真实的排障预算：一整条链可能是几十家可恢复类失败，而请求日志
 * 的保留下限要求一次突发不能把正在被诊断的那条失败挤掉。取 20 条封顶，超出部分不进
 * 这一行的 `failures`，但 `attempts` 记的是真实尝试数，两者差额就是被裁掉的尾部。
 */
const MAX_LOGGED_ATTEMPT_FAILURES = 20

/**
 * 池语义下，「这一家拒收这次请求」（裸 400）最多换几次家。
 *
 * 一次 400 可能是某一家的接入怪癖（另一家就接受同样的请求体），接连两家都拒收
 * 则更可能是请求本身写坏了 —— 再换下去只是把同一次拒绝在池里重演一遍，还先把
 * 客户端的时间耗光。
 */
const MAX_REJECTED_REQUEST_SWITCHES = 2

/**
 * axios 流在提交响应头之前的首帧探测窗口。
 *
 * 只等这么久：首帧（包括上游的流内错误帧）通常随响应头一起到达；窗口内没数据
 * 就照常把响应头交给客户端，不把慢模型的 prefill 一并拖慢。窗口内读到的帧
 * 若已经报错，就能在「写 200」之前换下一家。
 */
const STREAM_HEAD_PROBE_MS = 200

/**
 * 换家循环的预算：随**本次决策**传入，不在循环里读全局配置。
 *
 * `baseCap` 是账号故障类（5xx/网络）的尝试上限。auto 路径由命中的那条路由给出，
 * 没有路由上下文的裸名链由调用方给出厂默认 —— 两者的取值口径都写在各自入口的
 * 注释里，不共用一个「读 config」的暗通道。
 */
export interface FailoverBudget {
  baseCap: number
  /**
   * 池语义：这一家**拒收这次请求**（裸 400，既不是能力不符也不是账号故障）也算换家
   * 理由。auto 路由是一整池候选，一家不认这个请求体不等于整条路由不可用 —— 换一家
   * 可能当场就成。裸名链不开：客户端点名的那个名字就在这几家之间，400 说明请求本身
   * 有问题，继续换只是把同一次拒绝重演。
   */
  switchOnRejectedRequest?: boolean
}
import { attemptTraceOf } from './attemptTrace.ts'
import { accountRuntime } from './accountRuntime'
import { dispatchLedger } from './dispatchLedger.ts'
import { FIRST_ATTEMPT_CAP_MS, MIN_REMAINING_FOR_NEXT_ATTEMPT_MS, planAttemptDeadline, planFirstEventWait, planForwardRetries, planRecoveryWaitMs, sleep } from './retryPolicy'
import { stripUnsupportedForBuiltin } from './parameterPolicy'
import { ensureAnthropicOutputCap, outputCapFallbackOf } from './utils/outputCap.ts'
import { opencodeAffinityHeaders } from './utils/opencodeAffinity.ts'
import { createContextManagementService, trimAppliesToProvider } from './services/contextManagementService'
import { accountChannelManager } from '../providers/accountChannels/manager'
import { sanitizeChatToolDefinitions } from '../channelPack/toolCallValidation'
import { getAggregateEntry } from '../providers/aggregate/registry'
import { resolveAggregateEndpoint, aggregateEndpointMissingMessage } from '../providers/aggregate/endpoint'
import { applyAggregateDropParams } from './aggregateParams'
import {
  chatToResponsesRequest,
  responsesBodyToChat,
  responsesEventToChatChunks,
  type ResponsesEvent,
} from '../../shared/responsesWire'
import { applyCompression, recordCompressionReport } from './compression'
import { resolveCompressionConfig } from '../store/compressionConfig.ts'
import { cacheEconomicsOf, promptCacheOf } from '../../shared/promptCache.ts'
import { measureCrossTurnDuplication, recordDuplication } from './compression/duplication.ts'
import { recordConversationTurn, recordConversationTurnForRequest, readSurvivorshipStats } from './compression/survivorship.ts'
import { summarizeDuplication } from './compression/duplicationSummary.ts'
import { readFoldDecision } from './compression/foldGate.ts'
import {
  applyGatewayText,
  ccrProtocolText,
  conversationHasCompressionMarker,
  outputContractText,
} from './gatewayText'
import { readDegradationWindow } from './outputContractGuard'
import {
  conversationHasProtocolBlock,
  rememberProtocolBlock,
} from './gatewayProtocolMemory.ts'
import { conversationKey } from './autoRouting.ts'

// 换家判据与流首事件等待：本体与测试在 failover.ts（forwarder 背着 electron
// 依赖，node --test 拉不动，见该模块头注释）。isFailoverEligibleStatus 从这里
// 再导出，chat 路由的既有 import 路径不变。
import {
  AUTO_WALL_CLOCK_BUDGET_MS,
  createIdleWatchdog,
  describeAttemptFailure,
  firstStreamEvent,
  isChannelHumanRequiredFailure,
  isChannelModelUnavailableError,
  isContextOverflowError,
  isFailoverEligibleStatus,
  isForcedToolChoiceUnsupported,
  isMissingReasoningHistoryError,
  isMissingSessionAffinityError,
  isAccountArrearsError,
  isReasoningEffortUnsupportedError,
  isOpaqueAggregateBadRequest,
  isRecoverableChainExhaustion,
  isRecoverableChannelFailure,
  isSameTargetRetryableStatus,
  isToolOverflowError,
  isToolCallOrderingError,
  isUpstreamCatalogMissError,
  parseRetryAfterSeconds,
  probeSseHead,
  shouldTryNextAutoCandidate,
} from './failover.ts'
export { isFailoverEligibleStatus }
import { qualifyChannelModel } from '../providers/accountChannels/modelCatalog'
import { requestDeadlines } from './requestBudget'
import { recordCatalogMiss } from './modelCatalogCooldown'
import { isForbiddenProviderHeader } from '../../shared/providerHeaders'
import {
  injectReasoningEcho,
  reasoningEchoApplies,
  recordReasoningEchoCompletion,
} from './reasoningEcho.ts'

/** 上游 `Retry-After` 的原始值；数组按 HTTP 语义拼成单值，空白值视为没给。 */
function retryAfterOf(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const record = headers as Record<string, unknown>
  const value = record['retry-after'] ?? record['Retry-After']
  if (value === undefined || value === null) return undefined
  const text = Array.isArray(value) ? value.join(', ') : String(value)
  return text.trim() || undefined
}

/**
 * Upstream request id exposed by common gateways. It is the one value a
 * provider's support team will ask for, so capture it without logging headers.
 */
function upstreamRequestIdOf(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const record = headers as Record<string, unknown>
  const names = new Set([
    'x-request-id',
    'request-id',
    'x-openai-request-id',
    'cf-ray',
    'x-amzn-requestid',
    'x-amzn-request-id',
  ])
  for (const [key, value] of Object.entries(record)) {
    if (!names.has(key.toLowerCase())) continue
    const text = Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : ''
    if (text.trim() !== '') return text.trim()
  }
  return undefined
}

/**
 * 本地准入拒绝的连击降采样 warn。每次拒绝本来就有请求行与 chat 路由的
 * 「Request failed」错误行，缺的是 AIMD 状态本身 —— 「卡在几、首字 EWMA
 * 多少」只能靠请求行时间差反推（2026-11-11 codearts 429 风暴复盘里这半
 * 天的反推本可省掉）。按 (账号, 模型) 每 10s 补一条快照 warn。
 */
const LOCAL_ADMISSION_WARN_INTERVAL_MS = 10_000
const LOCAL_ADMISSION_WARN_MAX_KEYS = 256
const localAdmissionWarnAt = new Map<string, number>()

function warnLocalAdmissionRejected(
  providerId: string,
  account: Account,
  model: string,
  requestId: string | undefined,
): void {
  const key = `${account.id}\u0000${model}`
  const now = Date.now()
  const last = localAdmissionWarnAt.get(key)
  if (last !== undefined && now - last < LOCAL_ADMISSION_WARN_INTERVAL_MS) return
  localAdmissionWarnAt.set(key, now)
  // 键域 = (账号, 模型)，量级有界；超限摘最旧，防自定义模型名把表撑大。
  if (localAdmissionWarnAt.size > LOCAL_ADMISSION_WARN_MAX_KEYS) {
    const oldest = localAdmissionWarnAt.keys().next()
    if (!oldest.done) localAdmissionWarnAt.delete(oldest.value)
  }
  const snapshot = accountRuntime.snapshot(account.id, now, model)
  const inFlight = snapshot.modelInFlight ?? snapshot.inFlight
  const ewma = snapshot.ewmaFirstTokenMs
  storeManager.addLog(
    'warn',
    `Local per-model admission saturated: inFlight=${inFlight}/${snapshot.modelLimit ?? '?'}` +
      ` ewmaFirstTokenMs=${ewma === undefined ? 'n/a' : Math.round(ewma)}` +
      ` rateLimitedRate=${snapshot.rateLimitedRate ?? 'n/a'}`,
    { requestId, providerId, accountId: account.id, model },
  )
}

interface ExtractedUpstreamError {
  message: string
  details: UpstreamErrorDetails
  body?: string
  retryAfter?: string
  upstreamRequestId?: string
}

/** 只有一句话可交时，仍给出最小结构化错误，避免下游两套形状。 */
function errorDetailsOf(message: string): UpstreamErrorDetails {
  return { message }
}

/**
 * 渠道包错误 → 上游错误体。
 *
 * 包的 `code`（QUOTA_EXCEEDED / RATE_LIMIT / AUTH / MISSING_CREDENTIAL …）是它唯一的
 * 机读分类，旧实现只把 message 交给路由层，客户端因此拿不到「额度/限流/换一条」这类
 * 可判断的信号，只能读中文散文。
 */
function channelErrorDetails(message: string, code?: unknown): UpstreamErrorDetails {
  return typeof code === 'string' && code ? { message, code } : errorDetailsOf(message)
}

type ProviderForwarder = {
  name: string
  matches: (provider: Provider) => boolean
  forward: (
    request: ChatCompletionRequest,
    account: Account,
    provider: Provider,
    actualModel: string,
    startTime: number
  ) => Promise<ForwardResult>
}

/** 每模型参数不允许覆盖的请求骨架字段（与 shared/aggregate 的保留清单一致）。 */
const RESERVED_MODEL_PARAM_KEYS: readonly string[] = ['model', 'messages', 'stream']

/**
 * Request Forwarder
 */
export class RequestForwarder {
  private axiosInstance = axios.create({
    timeout: 120000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  })

  private readonly providerForwarders: ProviderForwarder[] = [
    {
      name: 'anthropic-messages',
      matches: AnthropicAdapter.isAnthropicProvider,
      forward: (request, account, provider, actualModel) => {
        const capability = promptCacheOf(
          provider.type === 'aggregate' && provider.aggregateId
            ? getAggregateEntry(provider.aggregateId)
            : undefined
        )
        return new AnthropicAdapter(provider, account).chatCompletion(request, actualModel, {
          capability,
          config: storeManager.getConfig().promptCaching,
        })
      },
    },
    {
      name: 'account-channel',
      matches: (provider: Provider) => provider.type === 'account',
      forward: (request, _account, provider, actualModel) =>
        this.forwardAccountChannel(request, actualModel, provider.id),
    },
  ]

  /**
   * Forward Chat Completions Request
   */
  async forwardChatCompletion(
    request: ChatCompletionRequest,
    account: Account,
    provider: Provider,
    actualModel: string,
    context: ProxyContext,
    options: { maxRetries?: number; probe?: boolean } = {}
  ): Promise<ForwardResult> {
    const startTime = Date.now()
    const config = storeManager.getConfig()
    // 探测请求（模型元数据实测）与真实流量隔离：照常走准入与上游，但不进
    // 派发账本、不更新 AIMD/Bandit/冷却 —— 一次手动探测不能改变路由判断。
    const isProbe = options.probe === true
    // 重试预算按 provider 分类：账号渠道的排队/额度/换号退避都在渠道 Worker 里
    // 自己跑过了，宿主再叠一层 5s×3 只是把等待累加（详见 `retryPolicy.ts`）。
    const retryProfile = planForwardRetries(provider.type, options.maxRetries ?? config.retryCount)
    const maxRetries = retryProfile.maxRetries

    // stream_options 等客户端默认参数对内建供应商无效，发送前丢弃而不是报 400
    request = stripUnsupportedForBuiltin(request, provider)

    // 每模型参数覆盖：在丢弃内建默认参数之后应用，配置的值不会被丢弃策略吞掉，
    // 并覆盖客户端传来的同名字段（保留字段 model/messages/stream 不允许覆盖）。
    request = this.applyModelParameters(request, provider, actualModel)
    // anthropic wire 的 max_tokens 必填：客户端与每模型参数都没给时，补设置里的
    // `defaultMaxOutputTokens`（可改，不是代码常量），免得代理自己造一个截断上限。
    request = ensureAnthropicOutputCap(
      request,
      provider.wire,
      outputCapFallbackOf(config.defaultMaxOutputTokens)
    )

    // 跨轮重复度测量：纯观测，一个字节都不改。与 compression 开关无关 —— 它存在的
    // 目的就是在"要不要做去重"还没有依据时先拿到依据。单轮请求在这里只花一次长度
    // 遍历就退出，所以对当前流量零成本。
    //
    // 必须排在压缩之前：它要回答的是"客户端原本发来的请求里有多少重复"。若放在
    // 压缩之后，live-zone 改写与 verbosity 追加都会混进这个指标，测出的就不再是
    // 客户端行为，也无法与"如果做跨轮去重能省多少"比较。
    if (request.requestId) {
      try {
        recordDuplication(
          request.requestId,
          measureCrossTurnDuplication(request.messages)
        )
        // 会话存活观测：同一处、同一个 try —— 两者都是纯观测，且都必须排在压缩
        // 之前（都要看客户端原样发来的字节）。轮号写进日志，供日后估算 P4 门禁
        // 所需的 expected_reads。
        const survivorship = recordConversationTurn(request.messages)
        if (survivorship.turn > 0) {
          recordConversationTurnForRequest(request.requestId, survivorship.turn)
        }
      } catch (error) {
        // 观测绝不能影响请求。
        console.error('[Compression] duplication measurement failed:', error)
      }
    }

    // 上下文压缩：只改 live zone（最新一条 tool / user 消息），历史字节不动，
    // 这样上游前缀缓存不被打掉。必须排在托管工具层注入之前 —— 注入的提示属于
    // 受管标记，绝不能再过一遍内容压缩器。重复调用是幂等的：已带 CCR 标记的
    // 文本会被识别并跳过，所以链式重试不会二次压缩。
    const compressionConfig = resolveCompressionConfig(config.compression, provider)
    const promptCacheCapability = promptCacheOf(
      provider.type === 'aggregate' && provider.aggregateId
        ? getAggregateEntry(provider.aggregateId)
        : undefined
    )
    const cachePolicy = cacheEconomicsOf(promptCacheCapability, config.promptCaching?.anthropicTtl)

    // 跨轮重复折叠：配置只是开关的一半。另一半是测量门（重复占比 + 会话还能活多久），
    // 决策按 5 分钟缓存 —— 它的输入是整份请求日志窗口，不该每个请求重算一遍。
    const foldDecision =
      config.compression.foldDuplicates === true
        ? readFoldDecision(() => ({
            optIn: true,
            summary: summarizeDuplication(storeManager.getRequestLogs()),
            survivorship: readSurvivorshipStats(),
          }))
        : undefined

    const compression = applyCompression({
      messages: request.messages,
      n: request.n,
      config: compressionConfig,
      ...(cachePolicy === undefined ? {} : { cachePolicy }),
      ...(foldDecision?.fold === true ? { fold: true } : {}),
    })
    // Taken before the rewrite: routing keys stickiness and survivorship off the
    // client's own messages, so the memory has to use the same basis or one
    // conversation would look like two.
    const conversationId = conversationKey(request)
    if (compression.messages && compression.messages !== request.messages) {
      request = { ...request, messages: compression.messages }
    }

    // 网关自有文本（2026-11-12 裁定放开的两处，见 `gatewayText.ts`）。
    //
    // 压缩协议块的「存在与否」就是提示词前缀的第一个字节：只在压缩发生的回合出现、
    // 下一回合又消失，等于每翻一次就作废整段前缀缓存。所以它按**会话**记（键取
    // `conversationKey`，客户端自己的系统提示+首条用户消息，跨轮稳定）：第一次真正
    // 压缩的回合引入它，之后这个会话每轮都在。没压缩过的会话一分不付。
    //
    // 输出契约要用户显式选档，且只在带工具的请求上生效：纯聊天里「少说」不是收益，
    // 是替用户改变表达。同时受退化窗口熔断（`outputContractGuard.ts`）。
    const contractLevel = config.compression.outputContract?.level ?? 'default'
    const blocks: string[] = []
    const hasMarker = conversationHasCompressionMarker(request.messages)
    const compressedThisTurn = (compression.report?.applied.length ?? 0) > 0
    const protocolInjected =
      hasMarker || compressedThisTurn || conversationHasProtocolBlock(conversationId)
    if (protocolInjected) {
      blocks.push(ccrProtocolText())
      // Only the turn that introduced the block (or that carries markers the
      // client echoed back) starts the memory; a merely remembered conversation
      // must not extend its own TTL.
      if (hasMarker || compressedThisTurn) rememberProtocolBlock(conversationId)
    }

    let contractState: 'default' | 'injected' | 'suspended' = 'default'
    if (contractLevel !== 'default' && (request.tools?.length ?? 0) > 0) {
      const window = readDegradationWindow({
        entries: storeManager.getRequestLogs(),
        providerId: provider.id,
        model: actualModel,
      })
      const contract = window.suspended ? null : outputContractText(contractLevel)
      if (contract) {
        blocks.push(contract)
        contractState = 'injected'
      } else {
        contractState = 'suspended'
      }
    }

    const withGatewayText = applyGatewayText(request.messages, blocks)
    if (withGatewayText !== request.messages) {
      request = { ...request, messages: withGatewayText }
    }

    if (compression.report && request.requestId) {
      recordCompressionReport(request.requestId, {
        ...compression.report,
        gatewayText: { protocol: protocolInjected, outputContract: contractState },
      })
    }

    // 输出侧：2026-11-03 退役的是「追加到用户 system 尾部」的那一版。2026-11-12
    // 换形态回来了 —— 独立的前导 system 块、默认关闭、带工具才生效、受退化窗口熔断，
    // 见 `gatewayText.ts` 与 `outputContractGuard.ts`。

    let lastError: string | undefined
    let lastStatus: number | undefined
    let lastErrorDetails: UpstreamErrorDetails | undefined
    let lastErrorBody: string | undefined
    let lastRetryAfter: string | undefined
    let lastLocalAdmissionRejected = false
    const attempts: RequestAttemptTrace[] = []

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await this.delay(retryProfile.retryDelayMs)
      }

      let modifiedRequest = request

      // 探测请求的提示词长度就是被测的档位；上下文管理会把它裁短，必须跳过。
      // 裁剪只在 `channelIds` 点名的渠道上运行：头切会把历史前缀逐轮变异，
      // 对有前缀缓存的渠道是每轮全价重读（2026-11-10 回归，PLAN §9.12）。
      if (
        !isProbe &&
        trimAppliesToProvider(config.contextManagement ?? {}, provider.id) &&
        modifiedRequest.messages &&
        modifiedRequest.messages.length > 0
      ) {
        try {
          // 摘要压缩那条策略已于 2026-11-03 退役（它会另起一次模型调用、再把产物
          // 包成 `[Conversation Summary]` 塞进历史 —— 那是网关替用户写内容）。
          // 留下的 slidingWindow / tokenLimit 只做删除，不做改写。
          const contextService = createContextManagementService(config.contextManagement || {})

          const originalCount = modifiedRequest.messages.length
          const contextMessages: ContextChatMessage[] = modifiedRequest.messages.map(msg => ({
            ...msg,
            role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
            content: msg.content,
            timestamp: Date.now(),
          }))

          const processResult = await contextService.process(contextMessages)

          if (processResult.finalCount !== originalCount) {
            console.log(
              `[Forwarder] Context management applied: ${originalCount} -> ${processResult.finalCount} messages`
            )

            processResult.strategyResults.forEach(result => {
              if (result.trimmed) {
                console.log(
                  `[Forwarder] Strategy ${result.strategyName}: ${result.originalCount} -> ${result.processedCount} messages`
                )
              }
            })

            modifiedRequest = {
              ...modifiedRequest,
              messages: processResult.messages.map(msg => ({ ...msg })),
            }
          }
        } catch (error) {
          console.error('[Forwarder] Context management failed:', error)
        }
      }

      // 每模型 AIMD 准入：并发已满时不把请求继续压给同一家，交给换家循环。
      // 探测（`probe: true`）不占真实流量名额：阶梯探测单请求可能跑 30s，
      // 若计入 AIMD，长探测会把正常请求的准入额度挤掉。探测自身由
      // `modelProbeRunner` 的全局串行队列限制并发，不需要这一层。
      const admission = isProbe
        ? { ok: true as const }
        : accountRuntime.tryBeginAttempt(account.id, actualModel)
      if (!admission.ok) {
        const message = 'Local per-model concurrency limit reached'
        const retryAfter = String(Math.max(1, Math.ceil(admission.retryAfterMs / 1000)))
        warnLocalAdmissionRejected(provider.id, account, actualModel, request.requestId)
        const result: ForwardResult = {
          success: false,
          status: 429,
          error: message,
          errorDetails: { message, code: 'local_concurrency_limit' },
          localAdmissionRejected: true,
          retryAfter,
          latency: 0,
        }
        attempts.push(attemptTraceOf({
          provider,
          account,
          model: actualModel,
          result,
          retryIndex: attempt,
        }))
        lastError = message
        lastStatus = 429
        lastErrorDetails = result.errorDetails
        lastRetryAfter = retryAfter
        lastLocalAdmissionRejected = true
        break
      }

      let result: ForwardResult
      // 派发记账：份额轮转的读数源。记「真的发到上游去了」而不是「成功返回」——
      // 一次失败的尝试同样占掉了这一家的当日额度与一次完整往返，只数成功会让
      // 一直失败的候选停在「没被派过」上，被公平规则一遍遍重新推上来。
      // 本地 AIMD 准入被拒（上面 break 那条）不进账：那一次根本没出网关。
      if (!isProbe) dispatchLedger.record(provider.id, actualModel)
      try {
        result = await this.doForward(modifiedRequest, account, provider, actualModel, context)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        lastError = message
        if (!isProbe) {
          accountRuntime.recordAttemptOutcome(account.id, actualModel, {
            success: false,
            clientAborted: request.signal?.aborted === true,
          })
          accountRuntime.endAttempt(account.id, actualModel)
        }
        attempts.push({
          providerId: provider.id,
          ...(provider.name === undefined ? {} : { providerName: provider.name }),
          accountId: account.id,
          ...(account.name === undefined ? {} : { accountName: account.name }),
          model: actualModel,
          errorMessage: message.slice(0, 500),
          outcome: request.signal?.aborted === true ? 'client_abort' : 'fatal',
          retryIndex: attempt,
        })
        continue
      }
      if (!isProbe) {
        accountRuntime.endAttempt(account.id, actualModel)
        accountRuntime.recordAttemptOutcome(account.id, actualModel, {
          success: result.success,
          ...(result.status === undefined ? {} : { status: result.status }),
          // 流式的首字/整笔由路由层在流结束时补报；这里只给非流式的整笔耗时。
          ...(request.stream === true || result.latency === undefined ? {} : { totalMs: result.latency }),
          clientAborted: request.signal?.aborted === true,
          degraded: false,
        })
      }

      attempts.push(attemptTraceOf({
        provider,
        account,
        model: actualModel,
        result,
        retryIndex: attempt,
        aborted: request.signal?.aborted === true,
      }))

      if (result.success) {
        // 带 actualModel：成功只清这个模型自己的限流档，不牵连同渠道别的模型
        if (!isProbe) accountRuntime.recordSuccess(account.id, actualModel)
        return { ...result, attempts }
      }

      lastError = result.error
      lastStatus = result.status
      lastErrorDetails = result.errorDetails
      lastErrorBody = result.errorBody
      lastRetryAfter = result.retryAfter

      // 同目标只重试 5xx / 网络错误：4xx 换一家才有意义（另一家的凭据/目录不同），
      // 408/504/524 重打同一家只会再赔一遍等待。冷却记录照旧，循环到此为止。
      if (!isSameTargetRetryableStatus(result.status)) {
        break
      }

      // 凭据类 502 也不重试，理由与 429 那一段同构但更强：它不是「隔一会儿就
      // 好」，而是「要人来处理」（重新登录 / 补 Key / 换出口 IP）。重试等于把同一
      // 笔等待再付一遍 —— 宿主截止时间 60s 时，一次多余重试就是把 60s 变成 120s。
      if (isChannelHumanRequiredFailure(result.error)) {
        break
      }
    }

    // 429 说明这个账号跑**这个模型**被上游限流了，按 (账号, 模型) 记指数退避，供后续
    // auto 路由避开；上游的限流窗本来就是按模型计的，整账号清零会让同渠道别的模型
    // 一次成功就把这里的退避抹掉（见 accountRuntime.ts 头部）。
    // 渠道包上报的 `providerRetryAfterMs` 已经在 bridge → forwardAccountChannel → ForwardResult.retryAfter
    // 里透下来了（秒字符串），这里解析成毫秒数喂进冷却，取「自己指数退避」与「上游时刻」更晚的那个。
    // 本地准入拒绝不是上游 429，不能给它记冷却。
    if (lastStatus === 429 && !lastLocalAdmissionRejected) {
      let retryAfterMs: number | undefined
      if (typeof lastRetryAfter === 'string') {
        const parsed = Number.parseInt(lastRetryAfter, 10)
        if (Number.isFinite(parsed)) retryAfterMs = parsed * 1000
      }
      if (!isProbe) {
        accountRuntime.recordFailure(account.id, 429, Date.now(), actualModel, retryAfterMs)
      }
    }

    const error = lastError || 'Request failed after retries'
    // 客户端取消不是上游故障：Axios 的中止错误没有 response，status 会是
    // undefined，换家循环会把它当网络错误继续试、账号还会被记一次失败。
    // 统一落成 400（与账号渠道的客户端断开分支同义），让环立刻停手。
    const aborted = request.signal?.aborted === true
    return {
      success: false,
      // 丢掉状态码的话，路由层会把它映射成 500，客户端就看不到"被限流/请求有问题"
      status: aborted ? 400 : lastStatus,
      error,
      errorDetails: lastErrorDetails ?? errorDetailsOf(error),
      ...(lastErrorBody === undefined ? {} : { errorBody: lastErrorBody }),
      ...(lastRetryAfter === undefined ? {} : { retryAfter: lastRetryAfter }),
      ...(lastLocalAdmissionRejected ? { localAdmissionRejected: true } : {}),
      attempts,
      latency: Date.now() - startTime,
    }
  }

  /**
   * 每模型参数覆盖（键为上游模型 id）：把配置值并进请求。保留字段与空值不参与。
   */
  private applyModelParameters(
    request: ChatCompletionRequest,
    provider: Provider,
    actualModel: string
  ): ChatCompletionRequest {
    const overrides = provider.modelParameters?.[actualModel]
    if (!overrides) return request

    const entries = Object.entries(overrides).filter(([key, value]) =>
      !RESERVED_MODEL_PARAM_KEYS.includes(key) && value !== null && value !== undefined && value !== ''
    )
    if (entries.length === 0) return request
    return { ...request, ...Object.fromEntries(entries) } as ChatCompletionRequest
  }

  /**
   * Auto 路由执行：按候选**排序**依次尝试，失败就换下一家 —— 包括下一个模型。
   *
   * 这里是一个池，不是泳道（2026-11-12 策略改）：排序决定先试谁（同名账号相邻、
   * 首模型的家族紧随其后），但一个候选失败不再意味着「这条路由到此为止」。原先
   * 「默认停在队首模型」的栅栏让客户端在第一发硬故障后当场中断，而池里还有几十个
   * 候选从未被试。
   *
   * 每次尝试把 request.model 替换为候选的显示名，与普通映射请求的上下文一致：
   * forwarder 之后会以 actualModel 作为上游模型、显示名作为 originalModel 传给 adapter。
   *
   * `budget.baseCap` 是**这条路由**的账号故障类换家上限（取自
   * `autoRouter.select()` 返回的 decision，见 AutoRouteDecision.baseCap）。转发层
   * 不许再自己去读全局 `config.autoRouting.maxAttempts`：那是 legacy 字段，逐路由
   * 设置落在它上面读就等于「候选裁剪按路由、失败换家按全局」的口径分裂。
   */
  async forwardAutoCompletion(
    request: ChatCompletionRequest,
    candidates: AutoCandidate[],
    context: ProxyContext,
    budget: FailoverBudget
  ): Promise<ForwardChainOutcome<AutoCandidate> | null> {
    return this.forwardFirstReachable(request, candidates, context, {
      ...budget,
      switchOnRejectedRequest: true,
    })
  }

  /**
   * 裸模型名的跨家候选：同名换到下一家继续尝试，判据是状态码策略（429/5xx/404 等才换）。
   * 两条路径共用一个循环，避免"auto 会换、具名不会换"这种口径分裂。
   */
  async forwardChainCompletion(
    request: ChatCompletionRequest,
    candidates: ChainCandidate[],
    context: ProxyContext
  ): Promise<ForwardChainOutcome<ChainCandidate> | null> {
    // 聚合裸名链与同供应商换 Key 都**没有路由上下文**：请求里那个模型名就是它自己，
    // 表里没有哪一条配置可查。这里用出厂默认，而不是 legacy `config.autoRouting`
    // 的 maxAttempts —— 迁移之后那个字段只是「`auto` 路由当年的值」，用户改任何
    // 一条路由都不会再动它，读它等于读一份永远不会被写的新旧混杂配置。
    return this.forwardFirstReachable(
      request,
      candidates,
      context,
      { baseCap: DEFAULT_AUTO_ROUTING_CONFIG.maxAttempts }
    )
  }

  private async forwardFirstReachable<T extends ChainCandidate>(
    request: ChatCompletionRequest,
    candidates: T[],
    context: ProxyContext,
    budget: FailoverBudget,
    /**
     * 恢复轮状态（见 `planRecoveryWaitMs`）。默认给一次机会；递归调用时传
     * `roundsLeft: 0`，所以**最多一轮**，不会滚成循环重试。
     */
    recovery: {
      roundsLeft: number
      failures: AutoAttemptFailure[]
      attemptTrace: RequestAttemptTrace[]
    } = { roundsLeft: 1, failures: [], attemptTrace: [] }
  ): Promise<ForwardChainOutcome<T> | null> {
    let last: { result: ForwardResult; candidate: T; attempts: number } | null = null
    // 被跳过的候选各自的失败样貌（判据与换家分支同源，见 describeAttemptFailure）。
    // 请求日志只记最终赢家，没有这个数组就分不清「这家天天错」和「这家偶发排队」。
    const failures: AutoAttemptFailure[] = recovery.failures
    const attemptTrace: RequestAttemptTrace[] = recovery.attemptTrace
    let attempts = 0
    // 账号故障类（5xx/网络）失败计数：达到基础上限就停手 —— 积分账号每次失败
    // 都可能烧钱，5xx 通常意味着系统性问题，多试只是多烧（PLAN P0-1）。
    let accountFailures = 0
    // 墙钟预算基线：context.startTime 是整个请求的起点（含预检与已完成候选的
    // 耗时），换家循环每轮对照预算检查，超了就不再继续换家。
    const budgetStart = context.startTime ?? Date.now()
    // 账号故障类的尝试上限：由调用方随本次决策传入（auto 走命中的那条路由，
    // 无路由的裸名链走出厂默认），见 forwardAutoCompletion 的注释。
    const baseCap = budget.baseCap
    // 池内换家：候选顺序由 `autoRouter.select` 排好（同名账号相邻、首模型家族紧随），
    // 循环本身只有一个条件 —— 还有预算就发下一发。没有任何模型栅栏。
    //
    // 裸 400 只在池语义下换家（`switchOnRejectedRequest`）：一家不认这个请求体不等于
    // 整池都不认。但那种拒绝几乎瞬时返回，若真是客户端把请求写坏了，换下去只会把同一
    // 次拒绝重演一遍 —— 所以最多换两次就收口。
    const switchOnRejectedRequest = budget.switchOnRejectedRequest === true
    let rejectedRequestFailures = 0
    // 循环的每个出口都带上失败清单（`failures` 是同一数组引用，退出时的内容
    // 就是「被跳过的家」，成功那轮从不进入）。
    const finish = (): ForwardChainOutcome<T> | null =>
      last === null
        ? null
        : {
            ...last,
            failures: failures.slice(0, MAX_LOGGED_ATTEMPT_FAILURES),
            attemptTrace: attemptTrace.slice(),
          }

    for (const candidate of candidates) {
      const budgetElapsedMs = Date.now() - budgetStart
      const remainingBudgetMs = AUTO_WALL_CLOCK_BUDGET_MS - budgetElapsedMs
      // 分级尝试上限 + 墙钟预算（分级判据本体与测试在 failover.ts）。
      // `extendedCap` 现在就是整条候选链的长度：选号阶段不再裁家数，所以可恢复类
      // 失败实际由墙钟预算收口，账号故障类由 `baseCap` 收口。
      if (attempts > 0 && !shouldTryNextAutoCandidate({
        attempts,
        accountFailures,
        baseCap,
        extendedCap: candidates.length,
        elapsedMs: budgetElapsedMs,
        budgetMs: AUTO_WALL_CLOCK_BUDGET_MS,
      })) {
        break
      }
      // 预算见底就不再新开一次尝试。`planAttemptDeadline` 在预算归零时返回**下限**
      // 而不是 0，于是循环照常用 5s 开一发注定假超时的请求 —— 客户端多等 5s、
      // 拿回一句「渠道未产出首块」，而这一发本来就不可能成。直接收口回 503 +
      // `Retry-After`（Codex 语义里 503 才是「等一会再来」）才是诚实的结局。
      // 第一次尝试不受此限：一上来就不打，等于整条路由不可用。
      if (attempts > 0 && remainingBudgetMs < MIN_REMAINING_FOR_NEXT_ATTEMPT_MS) {
        break
      }

      const attemptDeadlineMs = planAttemptDeadline({
        completeMs: requestDeadlines().completeMs,
        elapsedMs: budgetElapsedMs,
        budgetMs: AUTO_WALL_CLOCK_BUDGET_MS,
        // 首轮切片压低：一发慢首块不该吃掉 90s 预算的 2/3，让后面几家连一次
        // 像样的等待都分不到（见 `FIRST_ATTEMPT_CAP_MS` 的实测依据）。
        ...(attempts === 0 ? { capMs: FIRST_ATTEMPT_CAP_MS } : {}),
      })
      const attemptRequest: ChatCompletionRequest = {
        ...request,
        model: candidate.displayName,
        attemptDeadlineMs,
      }
      const attemptContext: ProxyContext = {
        ...context,
        providerId: candidate.provider.id,
        accountId: candidate.account.id,
        actualModel: candidate.actualModel,
      }

      const result = await this.forwardChatCompletion(
        attemptRequest,
        candidate.account,
        candidate.provider,
        candidate.actualModel,
        attemptContext,
        { maxRetries: 0 }
      )

      attemptTrace.push(...(result.attempts ?? []))
      attempts += 1
      last = { result, candidate, attempts }

      if (result.success) {
        return finish()
      }

      // 上游目录明确没有这个模型：给 (provider, model) 记一个目录缺失冷却，
      // 让下一笔请求不再把它送进候选池。只影响选路，不记账号故障。
      if (isUpstreamCatalogMissError(result.error)) {
        recordCatalogMiss(candidate.provider.id, candidate.actualModel)
      }

      // 「换一家就能成」类失败（工具数超限、历史缺 reasoning_content、渠道目录不认
      // 这个模型、这一家的上下文窗口装不下这次请求）：请求在生成之前就被拒，账号
      // 本身是健康的，既不该记冷却也不该计账号失败 —— 小工具请求/无思考历史的会话/
      // 一次目录漂移/一份超长上下文都不该连坐整个账号。
      // 其中 `isToolCallOrderingError`：这一家要求 tool 结果紧跟产生它的那条
      // assistant，而历史里的顺序不满足（MiniMax 实测
      // `tool call result does not follow tool call (2013)`）。入向翻译已把并行调用
      // 并成同一条 assistant（`shared/responsesInbound.ts`），判据保留是为了让仍然
      // 拼坏历史的老客户端不至于在第一家就打死整轮。
      const capabilityMismatch = isToolOverflowError(result.error)
        || isMissingReasoningHistoryError(result.error)
        || isToolCallOrderingError(result.error)
        || isChannelModelUnavailableError(result.error)
        // 上游目录里没有这个模型（ModelScope `has no provider supported` /
        // BazaarLink `Unknown model: … not in our catalog`）：静态目录是编译期
        // 快照，上游改名/下架后它不会跟着变，于是宿主把「目录说有、请求时不认」
        // 的模型广告成候选并给了高分。请求在生成之前就被拒，账号健康 ——
        // 换下一家，不记账号冷却/故障；只在 `(provider, model)` 上记一个短期
        // 目录缺失冷却（见上面的 `recordCatalogMiss`），避免每笔请求重撞。
        || isUpstreamCatalogMissError(result.error)
        || isForcedToolChoiceUnsupported(result.error)
        // 窗口不够是「这一家装不下这次请求」，池里窗口更大的候选能成：原先 400 一律
        // 终止，第一个候选超长就把整场打死（客户端读成「这条路由不可用」）。
        || isContextOverflowError(result.error)
        // 这一家不接受 `reasoning_effort`（OVH 的 Llama 3.3 70B 实测 400）：换一个
        // 候选就能成，账号健康。这类模型常常没有推理标注，路由侧硬筛拦不住。
        || isReasoningEffortUnsupportedError(result.error)
        // 这一家要求一个我们没发的会话亲和头（OpenCode Go 的 `x-opencode-session`
        // 实测 400）：说的是这一家的接入契约，不是客户端写错了什么。换一个候选就能成，
        // 账号健康 —— 但它同时意味着这一家在聚合路上**还没法用**，见判据注释。
        || isMissingSessionAffinityError(result.error)
        // 这一家的账号欠费（百炼 `Arrearage` 实测 400）：说的是账务状态，不是客户端
        // 写错了什么。原先 400 终止整条链，一家欠费就把后面所有候选一起打死。
        || isAccountArrearsError(result.error)
        // 普通 404 同样是「这一家供不了这个模型」（目录漂移/能力差异），不是账号
        // 故障：换下一家，但不给账号记冷却 —— 否则一次模型改名会连坐整个账号。
        || result.status === 404
      // 聚合条目的不透明 400（空错误体 / `Unknown error`）同样是「这一家供不了」，
      // 但账号本身健康：换下一家，不计账号故障、不进冷却。
      const opaqueAggregateBadRequest = isOpaqueAggregateBadRequest(
        result.status,
        result.error,
        candidate.provider.type,
      )
      // 「要人工介入」类失败（风控按账号生效、凭据失效）：换下一家。池语义下这
      // 可以是下一个账号，也可以是下一个模型 —— 风控按账号生效，换一个模型可能
      // 当场就成；留在原地只是重演同一次失败。
      const humanRequiredFailure = isChannelHumanRequiredFailure(result.error)
      // 客户端自己按了取消：上游的 400 只是沿路映回来的取消（见
      // `forwardChatCompletion` 的 aborted 分支），不是这一家的意见。
      const clientAborted = result.status === 400 && request.signal?.aborted === true
      // 「这一家拒收这次请求」：池语义下换下一家，裸名链不换（见 FailoverBudget）。
      const rejectedRequest = result.status === 400
        && !clientAborted
        && !capabilityMismatch
        && switchOnRejectedRequest
      // 无论后面走哪个分支，这次尝试都已经发生且没有成功 —— 先记账（含 fatal：
      // 它同时是客户端拿到的错误，日志里两处都能看到，宁重不漏）。
      failures.push(describeAttemptFailure({
        candidate: candidate.displayName,
        error: result.error,
        status: result.status,
        providerType: candidate.provider.type,
        rejectableRequest: rejectedRequest,
        // 预算读数原样落到日志：没有它们，「为什么只试了一家就收口」永远只能猜。
        budgetElapsedMs,
        attemptDeadlineMs,
      }))
      // 本地并发准入拒绝不是上游故障：换下一家，但不给账号记冷却/失败。
      if (result.localAdmissionRejected) continue
      if (humanRequiredFailure) {
        // 「这一家当前供不了，且要人或时间恢复」：凭据失效（`no usable credential`
        // /`凭据未配置`/`没有可用通道`）与上游风控（`request illegal`）。
        // 两类都不能让整条链停手 —— 风控落的是 400，不在 failover 的状态码里，
        // 原先第一个候选就 `return last`（2026-11-01 实测 3 笔 `auto` 整场失败）；
        // 也不占账号故障上限（换一家就能成）；但必须按人工介入档冷却：真流量里
        // 这一类 9+5 笔，没有长冷却时每一笔新请求都再付一遍完整加密 prefill
        // 与排队等待（同一家单次实测 214s–245s）。
        autoRouter.markCredentialCooldown(candidate.account.id)
        loadBalancer.markAccountFailed(candidate.account.id)
        continue
      }

      if (rejectedRequest) {
        // 不记账号冷却/故障：账号是健康的，是「这家不认这份请求体」。但换两次之后
        // 就该承认这多半是请求本身的问题 —— 再换下去只是把同一次拒绝在池里重演。
        rejectedRequestFailures += 1
        if (rejectedRequestFailures >= MAX_REJECTED_REQUEST_SWITCHES) return finish()
        continue
      }

      if (!capabilityMismatch) {
        if (!this.isFailoverEligible(result.status) && !opaqueAggregateBadRequest) {
          return finish()
        }

        // 分级：429 / 排队 / 额度类失败是「渠道暂时不可服务」，请求在生成之前
        // 就被拒绝（几乎不烧积分），换下一家值得多试 —— 不占账号故障类的上限；
        // 5xx / 网络错误才是账号故障，累计撞满基础上限后由循环头的分级检查收口。
        if (result.status !== 429 && !opaqueAggregateBadRequest && !isRecoverableChannelFailure(result.error)) {
          accountFailures += 1
        }

        // 429 的冷却已由 forwardChatCompletion 记进 (账号, 模型) 档，这里只补记
        // 5xx / 网络错误那类账号级故障
        if (result.status !== 429 && !opaqueAggregateBadRequest) {
          autoRouter.markAccountCooldown(candidate.account.id, result.status, candidate.actualModel)
        }
        if (!opaqueAggregateBadRequest) {
          loadBalancer.markAccountFailed(candidate.account.id)
        }
      }
    }

    // 恢复轮（2026-11-12 用户裁定）：链被**可恢复类**失败耗尽时，网关自己等一次再
    // 走一遍，而不是把 503 甩给客户端。协议上 503 + Retry-After 叫「稍后再试」，
    // 但 Codex 不会自动重试 agent 回合 —— 对用户那就是任务断了。
    //
    // 三条边界：预算只用 A2 腾出的剩余墙钟（总预算不提高）；最多一轮
    // （`recovery.roundsLeft`）；等待发生在所有 `endAttempt` 之后，所以不持有
    // AIMD 并发槽。欠费/未订阅不在范围内 —— 那些不会在十几秒内自己变好。
    if (last !== null
      && recovery.roundsLeft > 0
      && isRecoverableChainExhaustion({
        status: last.result.status,
        error: last.result.error,
        localAdmissionRejected: last.result.localAdmissionRejected,
      })) {
      const waitMs = planRecoveryWaitMs({
        retryAfterSeconds: parseRetryAfterSeconds(last.result.retryAfter),
        elapsedMs: Date.now() - budgetStart,
        budgetMs: AUTO_WALL_CLOCK_BUDGET_MS,
      })
      if (waitMs !== undefined) {
        await sleep(waitMs)
        return this.forwardFirstReachable(request, candidates, context, budget, {
          roundsLeft: 0,
          failures,
          attemptTrace,
        })
      }
    }

    return finish()
  }

  /** 429 / 5xx / 无状态码（网络错误、超时）才值得换目标；4xx 换目标没有意义 */
  private isFailoverEligible(status?: number): boolean {
    return isFailoverEligibleStatus(status)
  }

  /**
   * 账号渠道（account channel）转发。
   *
   * 上游协议、账号池、积分与重试全部在渠道 Worker 里；这里只做两件事：
   * 把内部字段（`requestId` / `signal` / `originalModel`）摘掉后交出 OpenAI 形状的
   * 请求体，以及把 Worker 的 SSE 文本原样接到响应流上（`skipTransform`）。
   * 不做工具提示注入：渠道适配器都支持原生工具调用。
   */
  private async forwardAccountChannel(
    request: ChatCompletionRequest,
    actualModel: string,
    providerId: string
  ): Promise<ForwardResult> {
    const startTime = Date.now()
    const requestId = request.requestId ?? `channel-${startTime}`
    // Worker 只认 `<channel>/<model>`；旧写法目录里的裸 id 在这里补回前缀
    // （判据本体与三种输入的取舍见 `qualifyChannelModel`）。
    const channelModel = qualifyChannelModel(providerId, actualModel)
    // 单次等待的截止：换家循环会按剩余墙钟预算给一个更紧的值，没有则用出厂计划。
    const deadlineMs = request.attemptDeadlineMs ?? requestDeadlines().completeMs
    // 思考回灌：与聚合线路共用主线程同一份缓存。渠道包跑在独立 worker 线程里，
    // 看不见这份 Map，所以补回只能在这里做（观测点在下行 SSE，见 chat 路由）。
    const echoReasoning = reasoningEchoApplies({ type: 'account' })
    const inbound = echoReasoning
      ? this.withReplayedReasoning(request, { id: providerId })
      : request
    const {
      requestId: _internalRequestId,
      signal: _signal,
      originalModel: _originalModel,
      attemptDeadlineMs: _internalDeadline,
      ...rest
    } = inbound
    const openAi = { ...rest, model: channelModel } as Record<string, unknown>
    // Codex 的延迟工具发现会发 `function.name: ''` 的占位定义；chat 上游会整条
    // 拒绝（Raccoon 实测 `tools[14].function.name is invalid or missing`）。
    // 空名字工具本身不可调用，删掉比让整轮失败更安全。
    if (openAi.tools !== undefined) {
      openAi.tools = sanitizeChatToolDefinitions(openAi.tools)
    }

    try {
      if (request.stream !== true) {
        const body = await accountChannelManager.complete({ requestId, model: channelModel, openAi }, deadlineMs)
        // 非流式：响应体里的 `message.tool_calls`/`reasoning_content` 就是下一轮要的成对内容。
        if (echoReasoning) recordReasoningEchoCompletion(body)
        return {
          success: true,
          status: 200,
          body,
          latency: Date.now() - startTime,
          providerSessionId: requestId,
        }
      }
      const upstream = await accountChannelManager.openStream({ requestId, model: channelModel, openAi })
      // 客户端在「等首块」期间断开时中止上游：chat 路由把 request.signal 接在
      // res close 上，但那套联动要到结果返回后才建立，这个窗口里只有 signal 能
      // 看到。销毁源流既停掉渠道 Worker 的上游请求，也让下面的首事件等到关闭。
      const signal = request.signal
      if (signal !== undefined) {
        if (signal.aborted) upstream.destroy()
        else signal.addEventListener('abort', () => upstream.destroy(), { once: true })
      }
      // 等「首块 vs 首错」再定成败：渠道包的流是延迟流，建流阶段的失败（上游
      // 4xx、凭据失效、模型不存在……）以流的 error 事件浮现。原先直接把流交给
      // 响应层，这些失败只能变成 200 + 流内错误帧 —— auto 的换家机制看不到
      // 失败，撞上「工具数超限」这类渠道装不下的 400 就整场失败
      // （用户报障 2026-10-30：auto 命中 cline 的 Vercel 网关 tools ≤ 128）。
      // 这里等首个事件：有首块才算成功（首块原样补发），首错转成普通
      // ForwardResult 失败，交给既有的换家 / 错误映射逻辑。
      const firstEventPlan = planFirstEventWait({
        firstEventMs: requestDeadlines().firstEventMs,
        deadlineMs,
        attemptDeadlineMs: request.attemptDeadlineMs,
      })
      const first = await firstStreamEvent(upstream, firstEventPlan.waitMs)
      if (first.kind === 'timeout') {
        // 等首事件超时：渠道假死（HTTP 200 但零字节，无首块也无首错 —— 实测
        // qoder 挂过 165s/285s/625s）。墙钟预算只在尝试之间检查，单次悬挂时
        // 它永远等不到检查点，所以超时必须在这里兑现：销毁源流触发 openStream
        // 的 close → cancel，渠道 worker 才会中止上游请求；504 参与换家。
        upstream.destroy()
        // ⚠️ 文案不能再无条件写「已中止并换下一家」。2026-11-12 现网两笔
        // （`chatcmpl-mwceepbp-zsfoaf`、`chatcmpl-mwcekfbq-0fmjrm`）都是
        // `tried=1` + 池里还有 10 个候选 + 耗时 ~100s：`firstEventMs` 是
        // `min(出厂值, 剩余墙钟预算)`，那一发打印出的「5s」其实是**剩余预算**，
        // 说明预算在第一次尝试之前就被吃光了，换家根本无从发生。
        // 承诺一个不会执行的下一步，比报一个错更难查 —— 用户据此判断「网关会自己换」
        // 而一直等下去。
        //
        // 两处截断的归因必须分开（`planFirstEventWait`）：`attempt-budget` 是链内
        // 剩余预算，`single-candidate` 是「这条模型没有下家」（码道 2026-11-12：
        // 39 笔失败全在客户端自己的 60s 超时处收尾，网关 60s 预算白等）。
        const factoryFirstEventMs = requestDeadlines().firstEventMs
        const waitedSec = Math.round(firstEventPlan.waitMs / 1000)
        const explained = firstEventPlan.clampedBy === 'attempt-budget'
          ? `；${waitedSec}s 是剩余墙钟预算（出厂上限 ${Math.round(factoryFirstEventMs / 1000)}s），预算耗尽时不再换家`
          : firstEventPlan.clampedBy === 'single-candidate'
            ? '；该模型没有可换的下家，等更久只会被客户端自己的超时截断'
            : ''
        const timeoutMessage = `渠道 ${waitedSec}s 内未产出任何首块（疑似假死），已中止${explained}`
        return {
          success: false,
          status: 504,
          error: timeoutMessage,
          errorDetails: errorDetailsOf(timeoutMessage),
          latency: Date.now() - startTime,
        }
      }
      if (first.kind === 'error') {
        const failure = first.error as { message?: string; status?: number; retryAfterMs?: number; code?: string }
        const message = failure.message ?? '渠道请求失败'
        // 首块前的流式失败（含 429）同样要透传渠道包上报的解禁时刻，否则这段
        // 与 catch 块（非流式 / 建流阶段）两套口径，流式 429 又退回「只用自退避」。
        const retryAfter =
          typeof failure.retryAfterMs === 'number' && Number.isFinite(failure.retryAfterMs)
            ? String(Math.max(1, Math.ceil(failure.retryAfterMs / 1000)))
            : undefined
        return {
          success: false,
          status: failure.status ?? 502,
          error: message,
          errorDetails: channelErrorDetails(message, failure.code),
          ...(retryAfter === undefined ? {} : { retryAfter }),
          latency: Date.now() - startTime,
        }
      }
      if (first.kind === 'closed') {
        // 客户端已断开的中止也走这里：400 让换家循环立刻停手 —— 请求已死，
        // 换下一家只是白打上游。
        const message = signal?.aborted
          ? '客户端已断开，渠道请求已中止'
          : '渠道在建流阶段提前结束，没有产出任何响应'
        return {
          success: false,
          status: signal?.aborted ? 400 : 502,
          error: message,
          errorDetails: errorDetailsOf(message),
          latency: Date.now() - startTime,
        }
      }
      const stream = new PassThrough()
      // 头部嗅探：cline 类上游是 HTTP 200 的 SSE 流，工具数超限的 400 以流内
      // 错误帧浮现（用户报障 2026-10-30 二次反馈「错误依旧」的直接原因——首块
      // 到达即记 success，auto 换家依旧看不到失败）。在转发前按帧解析头部：
      // 错误帧 → 转成普通失败参与换家；实质内容帧 → 把嗅探期间缓冲的块原样
      // 补发后 pipe 接管（正常流第一帧就是 role delta，零额外延迟）。
      const probe = await probeSseHead(upstream, first.chunk)
      if (probe.kind === 'error') {
        upstream.destroy()
        return {
          success: false,
          // 帧里的状态码优先（与 `probeAndWrapStream` 同一口径）：渠道包把上游的
          // 404/403/429 放在 `error.status` 里带出来，只按文案判 400/502 会把
          // 「这一家供不了这个模型」记成账号故障，白占换家上限。
          status: probe.details?.status
            ?? (isToolOverflowError(probe.message)
            || isMissingReasoningHistoryError(probe.message)
            || isToolCallOrderingError(probe.message)
            || isContextOverflowError(probe.message)
            || isReasoningEffortUnsupportedError(probe.message)
            || isUpstreamCatalogMissError(probe.message)
            ? 400
            : 502),
          error: probe.message,
          errorDetails: channelErrorDetails(probe.message, probe.details?.code),
          latency: Date.now() - startTime,
        }
      }
      for (const chunk of probe.buffered) {
        stream.write(chunk)
      }
      upstream.pipe(stream)
      // 源流错误 → 包装流：chat 路由在包装流上挂了自己的 error 处理（回流内
      // 错误帧 + [DONE]），转发时绝不能走 destroy(error) —— destroy 会先把
      // destroyed 置真，路由的「已销毁不再回写」守卫会把错误帧吞掉，客户端只
      // 看到断流。completions 路由没有挂 error 监听，无监听的 'error' 事件会
      // 抛未捕获异常 —— 故按有无监听者分派：有则 emit 交给路由，无则销毁响应
      // 流（no-op 兜底），与原先把桥流直接交给 completions 的行为一致。
      upstream.on('error', (error: Error) => {
        if (stream.listenerCount('error') > 1) {
          stream.emit('error', error)
        } else {
          stream.destroy(error)
        }
      })
      // 销毁兜底：无监听者时 destroy(error) 发出的 'error' 会抛未捕获异常。
      stream.on('error', () => {})
      // 反向：包装流被销毁（客户端提前断开，路由层会 destroy result.stream）
      // 时把源流一并销毁 —— 渠道包的 cancel 才能发出去，上游配额不会被白烧
      // 到自然结束。正常结束（readableEnded）不销毁。
      stream.once('close', () => {
        if (!upstream.destroyed && !upstream.readableEnded) upstream.destroy()
      })
      return {
        success: true,
        status: 200,
        stream,
        // SSE 已由渠道包按 OpenAI 规范投影，这里再转一次只会让流形状漂移。
        skipTransform: true,
        // 响应头先回、正文随后（首字要等上游），耗时口径按整笔计。
        deferred: true,
        latency: Date.now() - startTime,
        providerSessionId: requestId,
      }
    } catch (error) {
      const failure = error as { message?: string; status?: number; retryAfterMs?: number; code?: string }
      const message = failure.message ?? '渠道请求失败'
      const retryAfter =
        typeof failure.retryAfterMs === 'number' && Number.isFinite(failure.retryAfterMs)
          ? String(Math.max(1, Math.ceil(failure.retryAfterMs / 1000)))
          : undefined
      return {
        success: false,
        status: failure.status ?? 502,
        error: message,
        errorDetails: channelErrorDetails(message, failure.code),
        ...(retryAfter === undefined ? {} : { retryAfter }),
        latency: Date.now() - startTime,
      }
    }
  }

  /**
   * 在把响应头交给客户端之前，先看一眼 axios 流的头。
   *
   * 解决的问题：很多网关先回 HTTP 200、再把上游的 400/403 以**流内错误帧**
   * 发出来。旧路径拿到 200 就判成功并 flushHeaders，之后任何错误都只能作为
   * 一条已经开始的流死在客户端，换家循环再也看不到它。这里在写头之前等一个
   * 很短的窗口：窗口内读到错误帧就按失败返回并换家；没数据就照常放行，不把
   * 慢模型的 prefill 拖长。
   */
  private async probeAndWrapStream(source: Readable): Promise<
    | { ok: true; stream: Readable }
    | { ok: false; status: number; message: string; details: UpstreamErrorDetails }
  > {
    const first = await firstStreamEvent(source, STREAM_HEAD_PROBE_MS)
    if (first.kind === 'timeout') {
      return { ok: true, stream: this.withIdleWatchdog(source) }
    }
    if (first.kind === 'error') {
      const failure = first.error as { message?: string; status?: number; code?: string }
      const message = failure.message ?? '上游在建流阶段失败'
      return { ok: false, status: failure.status ?? 502, message, details: channelErrorDetails(message, failure.code) }
    }
    if (first.kind === 'closed') {
      const message = '上游在产出任何内容之前就结束了'
      return { ok: false, status: 502, message, details: errorDetailsOf(message) }
    }

    const probe = await probeSseHead(source, first.chunk, STREAM_HEAD_PROBE_MS)
    if (probe.kind === 'error') {
      const message = probe.details?.message ?? probe.message
      const status = probe.details?.status
        ?? (isToolOverflowError(message) || isMissingReasoningHistoryError(message)
          || isToolCallOrderingError(message)
          || isContextOverflowError(message) || isReasoningEffortUnsupportedError(message)
          || isUpstreamCatalogMissError(message) ? 400 : 502)
      const details: UpstreamErrorDetails = probe.details
        ? {
            message,
            ...(probe.details.type === undefined ? {} : { type: probe.details.type }),
            ...(probe.details.code === undefined ? {} : { code: probe.details.code }),
            ...(probe.details.param === undefined ? {} : { param: probe.details.param }),
          }
        : errorDetailsOf(message)
      source.destroy()
      return { ok: false, status, message, details }
    }

    // probe 已经读走首块（可能还有更多），先原样补发再 pipe 接管，不能丢块。
    const replay = new PassThrough()
    replay.on('error', () => {})
    for (const chunk of probe.buffered) replay.write(chunk)
    source.once('error', (error) => replay.destroy(error))
    replay.once('close', () => {
      if (!source.destroyed && !source.readableEnded) source.destroy()
    })
    source.pipe(replay)
    return { ok: true, stream: this.withIdleWatchdog(replay) }
  }

  /** 首块之后的块间静默看门狗：与账号渠道共用同一判据。 */
  private withIdleWatchdog(source: Readable): Readable {
    const idleMs = requestDeadlines().idleMs
    if (!(idleMs > 0)) return source
    const out = new PassThrough()
    out.on('error', () => {})
    const watchdog = createIdleWatchdog(idleMs, () => {
      const error = Object.assign(
        new Error(`上游流在 ${Math.round(idleMs / 1000)}s 内没有新数据，已中止`),
        { status: 504 },
      )
      source.destroy(error)
      if (!out.destroyed) out.destroy(error)
    })
    watchdog.arm()
    source.once('error', (error) => {
      watchdog.clear()
      if (!out.destroyed) out.destroy(error)
    })
    source.once('end', () => watchdog.clear())
    source.once('close', () => {
      watchdog.clear()
      if (!out.destroyed && !out.readableEnded) out.end()
    })
    out.once('close', () => {
      watchdog.clear()
      if (!source.destroyed && !source.readableEnded) source.destroy()
    })
    source.pipe(out)
    // pipe 之后再挂 data 监听，避免先进入 flowing 模式把首块丢掉。
    source.on('data', () => watchdog.arm())
    return out
  }

  /**
   * Execute Forward
   */
  private async doForward(
    request: ChatCompletionRequest,
    account: Account,
    provider: Provider,
    actualModel: string,
    context: ProxyContext
  ): Promise<ForwardResult> {
    const startTime = Date.now()

    const dedicatedForwarder = this.providerForwarders.find(forwarder => forwarder.matches(provider))
    if (dedicatedForwarder) {
      return dedicatedForwarder.forward(request, account, provider, actualModel, startTime)
    }

    // 出向 responses：不做 chat 的请求体构建与 prompt 工具注入。
    // responses 自己就有原生 tools，把工具描述塞进 messages 会变成双重提示。
    if (provider.wire === 'openai-responses') {
      return this.forwardResponsesWire(request, account, provider, actualModel, startTime)
    }

    try {
      const chatPath = provider.chatPath || '/chat/completions'
      const url = this.buildUrl(provider, chatPath, account)
      const headers = this.buildHeaders(provider, account, request)
      // 工具三件套原生透传，`buildRequestBody` 自己按 `request.tools` 组装。
      // 托管层（把工具描述写进 system、再把回复文本解析回 tool_calls）已于 2026-11-03
      // 退役：网关不写提示词，不支持工具的模型由能力路由（`autoRouting::hardFilterFailure`
      // 的 `needsTools`）在候选池阶段处理，而不是靠改写对话内容去将就。
      // 聚合 DeepSeek 端点：客户端不回传带 tool_calls 轮的 reasoning_content，
      // 上游下一轮直接 400。渠道包侧由 `worker.ts` 观测并回灌，聚合线路此前缺这一步。
      const reasoningEcho = reasoningEchoApplies(provider)
      const outbound = reasoningEcho
        ? this.withReplayedReasoning(request, provider)
        : request
      const body = this.buildRequestBody(outbound, actualModel, account)

      // buildRequestBody 只挑白名单字段；每模型参数里的其余键（top_k、seed、reasoning_effort…）
      // 在这里显式补进上游请求体。保留字段 model/messages/stream 不允许被覆盖。
      const modelParams = provider.modelParameters?.[actualModel]
      if (modelParams) {
        for (const [key, value] of Object.entries(modelParams)) {
          if (RESERVED_MODEL_PARAM_KEYS.includes(key)) continue
          if (value === null || value === undefined || value === '') continue
          body[key] = value
        }
      }

      // 条目级剥离放在最后：schema 严格的上游对"多出来的字段"直接 400，
      // 用户覆盖也不该把被剥离的字段带回来。
      const dropRules =
        provider.type === 'aggregate' && provider.aggregateId
          ? getAggregateEntry(provider.aggregateId)?.dropParams
          : undefined
      const sanitizedBody = applyAggregateDropParams(body, dropRules)

      const axiosConfig: AxiosRequestConfig = {
        method: 'POST',
        url,
        headers,
        data: sanitizedBody,
        timeout: requestDeadlines().completeMs,
        responseType: request.stream ? 'stream' : 'json',
        validateStatus: () => true,
        // 客户端断开要中止上游：流式路径另有 `res close` → `upstream.destroy()` 的联动，
        // 非流式以前没有任何 signal，用户在 IDE 里按下取消后上游照常推理完并计费
        // （最长到 completeMs），还会继续走重试。
        signal: request.signal,
      }

      const response: AxiosResponse = await this.axiosInstance.request(axiosConfig)
      const latency = Date.now() - startTime

      if (response.status >= 400) {
        const failure = await this.extractErrorInfo(response)
        return {
          success: false,
          status: response.status,
          error: failure.message,
          errorDetails: failure.details,
          ...(failure.body === undefined ? {} : { errorBody: failure.body }),
          ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter }),
          ...(failure.upstreamRequestId === undefined
            ? {}
            : { upstreamRequestId: failure.upstreamRequestId }),
          latency,
        }
      }

      if (request.stream) {
        const headers = this.extractHeaders(response.headers)
        const probed = await this.probeAndWrapStream(response.data as Readable)
        if (!probed.ok) {
          const retryAfter = retryAfterOf(response.headers)
          return {
            success: false,
            status: probed.status,
            error: probed.message,
            errorDetails: probed.details,
            ...(retryAfter === undefined ? {} : { retryAfter }),
            upstreamRequestId: upstreamRequestIdOf(response.headers),
            latency: Date.now() - startTime,
          }
        }
        return {
          success: true,
          status: response.status,
          headers,
          upstreamRequestId: upstreamRequestIdOf(response.headers),
          stream: probed.stream as any,
          latency: Date.now() - startTime,
        }
      }

      if (reasoningEcho) recordReasoningEchoCompletion(response.data)

      return {
        success: true,
        status: response.status,
        headers: this.extractHeaders(response.headers),
        upstreamRequestId: upstreamRequestIdOf(response.headers),
        body: response.data,
        latency,
      }
    } catch (error) {
      const latency = Date.now() - startTime

      if (error instanceof AxiosError) {
        return {
          success: false,
          status: error.response?.status,
          error: error.message,
          latency,
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latency,
      }
    }
  }

  /**
   * 出向 responses：把 chat 请求翻成 Responses API，再把上游的响应/事件流翻回
   * chat 形状。供应商只会 `/responses` 时走这里（`wire: 'openai-responses'`）。
   *
   * 与默认分支的三处不同：
   * 1. **不走 prompt 工具注入** —— responses 自带原生 tools，双重提示只会让模型混乱；
   * 2. 请求体由 `chatToResponsesRequest` 重建，不是白名单搬运；
   * 3. 流式响应要把上游事件先攒齐再重编成 chat SSE，因此这里自己管理结尾
   *    （主线只负责把 `[DONE]` 变成唯一那一个）。
   */
  private async forwardResponsesWire(
    request: ChatCompletionRequest,
    account: Account,
    provider: Provider,
    actualModel: string,
    startTime: number
  ): Promise<ForwardResult> {
    try {
      const url = this.buildUrl(provider, provider.chatPath || '/responses', account)
      const headers = this.buildHeaders(provider, account, request)
      const body = chatToResponsesRequest(request, actualModel)

      const modelParams = provider.modelParameters?.[actualModel]
      if (modelParams) {
        for (const [key, value] of Object.entries(modelParams)) {
          if (RESERVED_MODEL_PARAM_KEYS.includes(key)) continue
          if (value === null || value === undefined || value === '') continue
          body[key] = value
        }
      }

      const response: AxiosResponse = await this.axiosInstance.request({
        method: 'POST',
        url,
        headers,
        data: body,
        timeout: requestDeadlines().completeMs,
        responseType: request.stream ? 'stream' : 'json',
        validateStatus: () => true,
        signal: request.signal,
      })
      const latency = Date.now() - startTime

      if (response.status >= 400) {
        const failure = await this.extractErrorInfo(response)
        return {
          success: false,
          status: response.status,
          error: failure.message,
          errorDetails: failure.details,
          ...(failure.body === undefined ? {} : { errorBody: failure.body }),
          ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter }),
          ...(failure.upstreamRequestId === undefined
            ? {}
            : { upstreamRequestId: failure.upstreamRequestId }),
          latency,
        }
      }

      if (!request.stream) {
        return {
          success: true,
          status: response.status,
          headers: this.extractHeaders(response.headers),
          upstreamRequestId: upstreamRequestIdOf(response.headers),
          body: responsesBodyToChat(response.data, actualModel),
          latency,
        }
      }

      return {
        success: true,
        status: response.status,
        headers: this.extractHeaders(response.headers),
        upstreamRequestId: upstreamRequestIdOf(response.headers),
        stream: this.translateResponsesStream(response.data, actualModel),
        // 已经是 chat 形状，主线不必再转一次
        skipTransform: true,
        latency,
      }
    } catch (error) {
      const latency = Date.now() - startTime
      if (error instanceof AxiosError) {
        return {
          success: false,
          status: error.response?.status,
          error: error.message,
          latency,
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latency,
      }
    }
  }

  /**
   * 把上游 responses SSE 事件流读成 chat SSE 文本。
   *
   * 逐事件重编而不是攒齐——攒齐会把"上游已经开始输出"这个事实推迟到最后一刻，
   * 客户端的首字节时间等于整轮耗时。`responsesEventToChatChunks` 每处理一个事件
   * 就返回该事件对应的行，这里逐块写出。
   */
  private translateResponsesStream(source: NodeJS.ReadableStream, model: string): NodeJS.ReadableStream {
    const out = new PassThrough()
    const requestId = Math.random().toString(36).slice(2, 10)
    let buffer = ''
    let doneEmitted = false

    const writeEvents = (events: ResponsesEvent[]): void => {
      if (events.length === 0) return
      for (const line of responsesEventToChatChunks(events, model, requestId)) {
        if (line.startsWith('data: [DONE]')) {
          // 结尾只发一次：上游可能既不报 completed 又被中断，重复 [DONE] 会让客户端二次结束
          if (doneEmitted) continue
          doneEmitted = true
        }
        out.write(line)
      }
    }

    source.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      const events: ResponsesEvent[] = []
      for (const part of parts) {
        for (const raw of part.split('\n')) {
          if (!raw.startsWith('data: ')) continue
          const payload = raw.slice(6).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload)
            if (parsed && typeof parsed === 'object') events.push(parsed as ResponsesEvent)
          } catch {
            // 上游发了无法解析的帧：不把它当内容，也不中断 —— 由 completed/failed 决定结局
          }
        }
      }
      writeEvents(events)
    })

    const end = (): void => {
      if (!doneEmitted) {
        // 上游正常关闭但没发 completed：补一个 finish + [DONE]，否则客户端会挂住
        out.write(
          `data: ${JSON.stringify({
            id: `resp_${requestId}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`
        )
        out.write('data: [DONE]\n\n')
        doneEmitted = true
      }
      out.end()
    }

    source.on('end', end)
    source.on('error', (error: Error) => {
      out.write(
        `data: ${JSON.stringify({
          error: { message: error.message, type: 'api_error', code: 'api_error' },
        })}\n\n`
      )
      out.end()
    })

    return out
  }


  /**
   * Build URL
   */
  private buildUrl(provider: Provider, path: string, account?: Account): string {
    let baseUrl = provider.apiEndpoint

    // 聚合端点的路径里可能带账号（Cloudflare 的 `{account_id}`）：模板落盘、按这把
    // Key 的凭据在请求前展开。缺值时不发一个带花括号的地址，直接给出缺哪个字段。
    if (provider.type === 'aggregate') {
      const endpoint = resolveAggregateEndpoint(provider, account?.credentials)
      if (endpoint.missing.length > 0) throw new Error(aggregateEndpointMissingMessage(endpoint.missing))
      baseUrl = endpoint.url
    }

    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1)
    }

    if (!path.startsWith('/')) {
      path = '/' + path
    }

    // 只有 baseUrl 自己就以 `/v1` 这一段结尾时，才把 path 的同名前缀去掉。
    // 原来的 `baseUrl.includes('/v1')` 会被 `https://host/notreally/v1x`、
    // `https://host/v1/gateway` 这类地址误判，把路径截错一截。
    if (/\/v1$/.test(baseUrl) && path.startsWith('/v1')) {
      path = path.slice(3)
    }

    return `${baseUrl}${path}`
  }

  /**
   * Build Request Headers
   */
  private buildHeaders(
    provider: Provider,
    account: Account,
    request?: unknown,
  ): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    // 逐条滤而不是整串展开：`...provider.headers` 让配置里的 `Host` / `Content-Length`
    // 直接顶掉 axios 自己算出来的值，而配置可以来自导入文件或渠道包。
    for (const [name, value] of Object.entries(provider.headers ?? {})) {
      if (isForbiddenProviderHeader(name)) continue
      headers[name] = value
    }

    const credentials = account.credentials
    const apiKey = credentials.token || credentials.apiKey || credentials.accessToken || credentials.refreshToken

    // Aggregate endpoints declare where their key goes (anthropic: x-api-key,
    // azure: api-key); everything else keeps the OpenAI Authorization header.
    if (apiKey) {
      const headerName = provider.authHeader || 'Authorization'
      const prefix = provider.authPrefix ?? 'Bearer '
      headers[headerName] = `${prefix}${apiKey}`
    }

    if (credentials.cookie) {
      headers['Cookie'] = credentials.cookie
    }

    if (credentials.sessionKey) {
      headers['X-Session-Key'] = credentials.sessionKey
    }

    // OpenCode 上游把「没有会话亲和头」判成 400（`MissingSessionID`），聚合这一路
    // 此前从不发。只发它点名要的四个同值头，不发 project / client / 铸造 id ——
    // 受控探测证明那些不是过闸所需，带上就是替这台机认领 OpenCode 客户端身份。
    // 取值口径、探测读数与「补头也不解决订阅资格」的边界都在模块注释里。
    const affinity = opencodeAffinityHeaders({
      baseUrl: provider.apiEndpoint,
      request,
      accountId: account.id,
    })
    if (affinity !== undefined) Object.assign(headers, affinity)

    return headers
  }

  /**
   * 把缓存的思考补进入站历史（DeepSeek 官方端点与全部账号渠道）。
   *
   * 只补「客户端没回传」的轮次：已带回的一字节不动，没有可信思考的轮次宁可留空
   * 也不编造（判据与有界性都在 `channelPack/reasoningReplay.ts`）。两条泳道共用
   * 主线程这份缓存，所以上一轮无论落在哪条线，这一轮都补得回来。
   */
  private withReplayedReasoning(
    request: ChatCompletionRequest,
    provider: { id: string }
  ): ChatCompletionRequest {
    const { request: recovered, injected } = injectReasoningEcho(request)
    if (injected === 0) return request
    storeManager.addLog('info', `补回 reasoning_content：${injected} 轮客户端未回传`, {
      requestId: request.requestId,
      providerId: provider.id,
      data: { injected },
    })
    return recovered
  }

  /**
   * Build Request Body
   */
  private buildRequestBody(
    request: ChatCompletionRequest,
    actualModel: string,
    account: Account
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: actualModel,
      messages: request.messages,
      stream: request.stream || false,
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }

    if (request.top_p !== undefined) {
      body.top_p = request.top_p
    }

    if (request.n !== undefined) {
      body.n = request.n
    }

    if (request.stop !== undefined) {
      body.stop = request.stop
    }

    if (request.max_tokens !== undefined) {
      body.max_tokens = request.max_tokens
    }

    if (request.presence_penalty !== undefined) {
      body.presence_penalty = request.presence_penalty
    }

    if (request.frequency_penalty !== undefined) {
      body.frequency_penalty = request.frequency_penalty
    }

    if (request.logit_bias !== undefined) {
      body.logit_bias = request.logit_bias
    }

    if (request.user !== undefined) {
      body.user = request.user
    }

    // 工具三件套只在**有工具**时成组发出。
    // 定义先清洗：Codex 的 `tool_search` 占位定义 `function.name:''` 会被严格
    // 上游整条拒绝；缺 `parameters` 的 freeform 工具同样会被 Agnes 等拒收。
    if (request.tools !== undefined && request.tools.length > 0) {
      const sanitizedTools = sanitizeChatToolDefinitions(request.tools)
      if (Array.isArray(sanitizedTools) && sanitizedTools.length > 0) {
        body.tools = sanitizedTools
        if (request.tool_choice !== undefined) body.tool_choice = request.tool_choice
        if (request.parallel_tool_calls !== undefined) body.parallel_tool_calls = request.parallel_tool_calls
      }
    }

    if (request.reasoning_effort !== undefined) {
      body.reasoning_effort = request.reasoning_effort
    }

    // 这三格由 `ChatCompletionRequest` 的**未声明字段**承载（类型里没有，但客户端
    // 确实会发，`parameterPolicy.STRIPPED_FOR_BUILTIN` 认得它们）。此前白名单不转，
    // 后果各有不同：
    // - `stream_options` 丢了 → 上游永远不发最后一个 usage 块 → 流式响应的 `usage`
    //   对**所有**客户端都是 null，`/v1/messages` 那半边只好用估算值顶（见 A2）；
    // - `response_format` 丢了 → JSON 模式静默变自由文本；
    // - `seed` 丢了 → 可复现性承诺失效。
    // - `prompt_cache_key` 丢了 → 客户端自己的 prompt caching 命中率归零（它看不出来
    //   为什么变慢，只会以为上游慢了）。
    // 聚合条目的地盘很严时由条目自己的 `dropParams` 剥（`applyAggregateDropParams`
    // 就在这之后跑），内建供应商仍由 `stripUnsupportedForBuiltin` 先删掉它们。
    for (const key of [
      'response_format',
      'stream_options',
      'seed',
      'prompt_cache_key',
      'logprobs',
      'top_logprobs',
      'prediction',
      'modalities',
      'audio',
      'service_tier',
      'reasoning',
      'top_k',
    ] as const) {
      const value = (request as unknown as Record<string, unknown>)[key]
      if (value !== undefined) body[key] = value
    }

    return body
  }

  /**
   * Extract Response Headers
   */
  private extractHeaders(headers: unknown): Record<string, string> {
    const result: Record<string, string> = {}
    if (headers === null || typeof headers !== 'object') return result

    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof value === 'string') {
        result[key] = value
      } else if (Array.isArray(value)) {
        result[key] = value.join(', ')
      }
    }

    return result
  }

  /**
   * Extract Error Message
   *
   * 流式请求的 4xx 体是一条流，必须先读成文本再查键：不读的话上游那句真实原因
   * 一个字节都留不下（机制与实测见 `upstreamErrorBody.ts` 的文档块）。
   */
  private async extractErrorInfo(response: AxiosResponse): Promise<ExtractedUpstreamError> {
    const data = await readUpstreamErrorData(response.data)
    const details = pickUpstreamErrorDetails(data, response.status)
    const body = summarizeUpstreamErrorBody(data)
    const retryAfter = retryAfterOf(response.headers)
    const upstreamRequestId = upstreamRequestIdOf(response.headers)
    return {
      message: details.message,
      details,
      ...(body === undefined ? {} : { body }),
      ...(retryAfter === undefined ? {} : { retryAfter }),
      ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
    }
  }

  /**
   * Delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Forward Request to Specified URL
   */
  async forwardToUrl(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: unknown,
    isStream: boolean = false
  ): Promise<ForwardResult> {
    const startTime = Date.now()

    try {
      const config: AxiosRequestConfig = {
        method,
        url,
        headers,
        data: body,
        timeout: requestDeadlines().completeMs,
        responseType: isStream ? 'stream' : 'json',
        validateStatus: () => true,
      }

      const response: AxiosResponse = await this.axiosInstance.request(config)
      const latency = Date.now() - startTime

      if (response.status >= 400) {
        const failure = await this.extractErrorInfo(response)
        return {
          success: false,
          status: response.status,
          error: failure.message,
          errorDetails: failure.details,
          ...(failure.body === undefined ? {} : { errorBody: failure.body }),
          ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter }),
          ...(failure.upstreamRequestId === undefined
            ? {}
            : { upstreamRequestId: failure.upstreamRequestId }),
          latency,
        }
      }

      if (isStream) {
        return {
          success: true,
          status: response.status,
          headers: this.extractHeaders(response.headers),
          upstreamRequestId: upstreamRequestIdOf(response.headers),
          stream: response.data,
          latency,
        }
      }

      return {
        success: true,
        status: response.status,
        headers: this.extractHeaders(response.headers),
        upstreamRequestId: upstreamRequestIdOf(response.headers),
        body: response.data,
        latency,
      }
    } catch (error) {
      const latency = Date.now() - startTime

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latency,
      }
    }
  }
}

export const requestForwarder = new RequestForwarder()
export default requestForwarder
