/**
 * Proxy Service Module - Request Forwarder
 * Forwards requests to corresponding API based on provider configuration
 */

import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios'
import http2 from 'http2'
import { PassThrough } from 'stream'
import { Account, Provider } from '../store/types'
import {
  ForwardResult,
  ChatCompletionRequest,
  ProxyContext,
  type ChatMessage as ContextChatMessage,
} from './types'
import { proxyStatusManager } from './status'
import { storeManager } from '../store/store'
import { DEFAULT_AUTO_ROUTING_CONFIG } from '../../shared/types'
import { wrapStreamWithPlan } from './toolCalling/streamPlanWrapper'
import { AnthropicAdapter } from './adapters/anthropic'
import { ToolCallingEngine } from './toolCalling/ToolCallingEngine'
import type { ToolCallingTransformResult } from './toolCalling/types'
import { sessionManager } from './sessionManager'
import { loadBalancer } from './loadbalancer'
import { autoRouter, type AutoCandidate } from './autoRouter'

/** 一个可尝试的目标：与 AutoCandidate 同形，供裸名跨家链复用同一个切换循环。 */
export interface ChainCandidate {
  account: Account
  provider: Provider
  displayName: string
  actualModel: string
}

/**
 * 换家循环的预算：随**本次决策**传入，不在循环里读全局配置。
 *
 * `baseCap` 是账号故障类（5xx/网络）的尝试上限。auto 路径由命中的那条路由给出，
 * 没有路由上下文的裸名链由调用方给出厂默认 —— 两者的取值口径都写在各自入口的
 * 注释里，不共用一个「读 config」的暗通道。
 */
export interface FailoverBudget {
  baseCap: number
}
import { accountRuntime } from './accountRuntime'
import { planForwardRetries } from './retryPolicy'
import { stripUnsupportedForBuiltin } from './parameterPolicy'
import { ensureAnthropicOutputCap, outputCapFallbackOf } from './utils/outputCap.ts'
import { createContextManagementService, SummaryGenerator } from './services/contextManagementService'
import { accountChannelManager } from '../providers/accountChannels/manager'
import { getAggregateEntry } from '../providers/aggregate/registry'
import { applyAggregateDropParams } from './aggregateParams'
import {
  chatToResponsesRequest,
  responsesBodyToChat,
  responsesEventToChatChunks,
  type ResponsesEvent,
} from '../../shared/responsesWire'
import { applyCompression, recordCompressionReport } from './compression'
import { applyVerbositySteering } from './compression/outputSteering.ts'
import { measureCrossTurnDuplication, recordDuplication } from './compression/duplication.ts'
import { recordConversationTurn, recordConversationTurnForRequest } from './compression/survivorship.ts'

// 换家判据与流首事件等待：本体与测试在 failover.ts（forwarder 背着 electron
// 依赖，node --test 拉不动，见该模块头注释）。isFailoverEligibleStatus 从这里
// 再导出，chat 路由的既有 import 路径不变。
import {
  AUTO_WALL_CLOCK_BUDGET_MS,
  FIRST_EVENT_TIMEOUT_MS,
  firstStreamEvent,
  isChannelModelUnavailableError,
  isFailoverEligibleStatus,
  isMissingReasoningHistoryError,
  isRecoverableChannelFailure,
  isToolOverflowError,
  probeSseHead,
  shouldTryNextAutoCandidate,
} from './failover.ts'
export { isFailoverEligibleStatus }

function shouldDeleteSession(): boolean {
  return sessionManager.shouldDeleteAfterChat()
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
      forward: (request, account, provider, actualModel) =>
        new AnthropicAdapter(provider, account).chatCompletion(request, actualModel),
    },
    {
      name: 'account-channel',
      matches: (provider: Provider) => provider.type === 'account',
      forward: (request, _account, _provider, actualModel) =>
        this.forwardAccountChannel(request, actualModel),
    },
  ]

  /**
   * Transform request for prompt-based tool calling
   * For models that don't support native function calling
   * Delegates tool normalization, prompt injection, and parser planning to ToolCallingEngine.
   */
  private transformRequestForPromptToolUse(
    request: ChatCompletionRequest,
    provider?: Provider
  ): ToolCallingTransformResult {
    const config = storeManager.getConfig().toolCallingConfig
    const engine = new ToolCallingEngine(config)

    return engine.transformRequest({
      request,
      provider: provider ?? {
        id: 'custom',
        name: 'Custom',
        type: 'custom',
        authType: 'token',
        apiEndpoint: '',
        headers: {},
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      },
      actualModel: request.model,
      requestId: request.requestId,
    })
  }

  private applyToolCallsToResponse(result: any, transformed: ToolCallingTransformResult): void {
    const engine = new ToolCallingEngine(storeManager.getConfig().toolCallingConfig)
    engine.applyNonStreamResponse(result, transformed.plan)
  }

  /**
   * Create summary generator function for context management
   * Uses the current provider and account to generate summaries
   */
  private createSummaryGenerator(
    account: Account,
    provider: Provider,
    actualModel: string,
    context: ProxyContext
  ): SummaryGenerator {
    return async (messages: ContextChatMessage[], prompt?: string): Promise<string> => {
      try {
        console.log('[SummaryGenerator] Generating summary for', messages.length, 'messages')

        const summaryPrompt = prompt || 'Please summarize the following conversation concisely, keeping key information and context:'

        const conversationText = messages
          .map(msg => {
            const role = msg.role.toUpperCase()
            const content = typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content
                    .filter(part => part.type === 'text' && part.text)
                    .map(part => part.text)
                    .join('\n')
                : ''
            return `${role}: ${content}`
          })
          .join('\n\n')

        const summaryRequest: ChatCompletionRequest = {
          model: actualModel,
          messages: [
            {
              role: 'system',
              content: summaryPrompt,
            },
            {
              role: 'user',
              content: conversationText,
            },
          ],
          stream: false,
          temperature: 0.3,
        }

        const result = await this.doForward(
          summaryRequest,
          account,
          provider,
          actualModel,
          context
        )

        if (result.success && result.body) {
          const summaryContent = result.body.choices?.[0]?.message?.content || ''
          console.log('[SummaryGenerator] Summary generated successfully, length:', summaryContent.length)
          return summaryContent
        }

        console.warn('[SummaryGenerator] Failed to generate summary:', result.error)
        return 'Failed to generate conversation summary.'
      } catch (error) {
        console.error('[SummaryGenerator] Error generating summary:', error)
        return 'Failed to generate conversation summary due to an error.'
      }
    }
  }

  /**
   * Forward Chat Completions Request
   */
  async forwardChatCompletion(
    request: ChatCompletionRequest,
    account: Account,
    provider: Provider,
    actualModel: string,
    context: ProxyContext,
    options: { maxRetries?: number } = {}
  ): Promise<ForwardResult> {
    const startTime = Date.now()
    const config = storeManager.getConfig()
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
    const compression = applyCompression({
      messages: request.messages,
      n: request.n,
      config: config.compression,
    })
    if (compression.messages && compression.messages !== request.messages) {
      request = { ...request, messages: compression.messages }
    }
    if (compression.report && request.requestId) {
      recordCompressionReport(request.requestId, compression.report)
    }

    // 输出侧 verbosity：只往 system 消息尾部追加一段定长指令，省的是 completion
    // token。与压缩是两个独立开关 —— 那个改请求字节、受缓存经济学约束，这个改
    // 模型写回来的量。放在压缩之后、托管工具层之前：托管层稍后会把工具协议追加到
    // 同一条 system 消息尾部，那是硬契约，必须排在我们的风格提示之后。
    if (config.outputSteering?.enabled) {
      const steering = applyVerbositySteering(
        request.messages,
        config.outputSteering.level
      )
      if (steering.changed) {
        request = { ...request, messages: steering.messages }
      }
    }

    // 记录在途与 RPM：仅用于路由打分，下一次请求即可读到
    accountRuntime.beginAttempt(account.id)

    let lastError: string | undefined
    let lastStatus: number | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await this.delay(retryProfile.retryDelayMs)
      }

      let modifiedRequest = request

      if (config.contextManagement?.enabled && modifiedRequest.messages && modifiedRequest.messages.length > 0) {
        try {
          const summaryGenerator = this.createSummaryGenerator(
            account,
            provider,
            actualModel,
            context
          )

          const contextService = createContextManagementService(
            config.contextManagement || {},
            summaryGenerator
          )

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

      try {
        const result = await this.doForward(modifiedRequest, account, provider, actualModel, context)

        if (result.success) {
          accountRuntime.recordSuccess(account.id)
          accountRuntime.endAttempt(account.id)
          return result
        }

        lastError = result.error
        lastStatus = result.status

        // 429 是上游限流：同一个账号隔 5 秒再打一次基本没用，只会把配额和等待
        // 一起赔进去（OpenCode 配额耗尽时一次失败就要 20 多秒，重试 3 次就是两分钟）。
        // 冷却记录照旧，循环到此为止。
        if (result.status && result.status < 500) {
          break
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error'
      }
    }

    accountRuntime.endAttempt(account.id)

    // 429 说明账号已被上游限流，记录指数退避冷却，供后续 auto 路由避开
    if (lastStatus === 429) {
      accountRuntime.recordFailure(account.id, 429)
    }

    return {
      success: false,
      // 丢掉状态码的话，路由层会把它映射成 500，客户端就看不到"被限流/请求有问题"
      status: lastStatus,
      error: lastError || 'Request failed after retries',
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
   * Auto 路由执行：按候选顺序尝试，在流式首包之前失败时切换到下一个账号/供应商。
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
  ): Promise<{ result: ForwardResult; candidate: AutoCandidate; attempts: number } | null> {
    return this.forwardFirstReachable(request, candidates, context, budget)
  }

  /**
   * 裸模型名的跨家候选：同名换到下一家继续尝试，判据与 auto 完全一致（429/5xx/无状态码才换）。
   * 两条路径共用一个循环，避免"auto 会换、具名不会换"这种口径分裂。
   */
  async forwardChainCompletion(
    request: ChatCompletionRequest,
    candidates: ChainCandidate[],
    context: ProxyContext
  ): Promise<{ result: ForwardResult; candidate: ChainCandidate; attempts: number } | null> {
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
    budget: FailoverBudget
  ): Promise<{ result: ForwardResult; candidate: T; attempts: number } | null> {
    let last: { result: ForwardResult; candidate: T; attempts: number } | null = null
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

    for (const candidate of candidates) {
      // 分级尝试上限 + 墙钟预算（分级判据本体与测试在 failover.ts；候选列表
      // 已由 autoRouter.select 裁剪为「基础上限 + 可恢复余量」家）。
      if (attempts > 0 && !shouldTryNextAutoCandidate({
        attempts,
        accountFailures,
        baseCap,
        extendedCap: candidates.length,
        elapsedMs: Date.now() - budgetStart,
        budgetMs: AUTO_WALL_CLOCK_BUDGET_MS,
      })) {
        break
      }

      const attemptRequest: ChatCompletionRequest = {
        ...request,
        model: candidate.displayName,
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

      attempts += 1
      last = { result, candidate, attempts }

      if (result.success) {
        return last
      }

      // 「换一家就能成」类失败（工具数超限、历史缺 reasoning_content、渠道目录不认
      // 这个模型）：请求在生成之前就被拒，账号本身是健康的，既不该记冷却也不该
      // 计账号失败 —— 小工具请求/无思考历史的会话/一次目录漂移不该连坐整个账号。
      const capabilityMismatch = isToolOverflowError(result.error)
        || isMissingReasoningHistoryError(result.error)
        || isChannelModelUnavailableError(result.error)
      if (!capabilityMismatch) {
        if (!this.isFailoverEligible(result.status)) {
          return last
        }

        // 分级：429 / 排队 / 额度类失败是「渠道暂时不可服务」，请求在生成之前
        // 就被拒绝（几乎不烧积分），换下一家值得多试 —— 不占账号故障类的上限；
        // 5xx / 网络错误才是账号故障，累计撞满基础上限后由循环头的分级检查收口。
        if (result.status !== 429 && !isRecoverableChannelFailure(result.error)) {
          accountFailures += 1
        }

        // 429 的冷却已由 forwardChatCompletion 记录，这里只补记 5xx / 网络错误
        if (result.status !== 429) {
          autoRouter.markAccountCooldown(candidate.account.id, result.status)
        }
        loadBalancer.markAccountFailed(candidate.account.id)
      }
    }

    return last
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
    actualModel: string
  ): Promise<ForwardResult> {
    const startTime = Date.now()
    const requestId = request.requestId ?? `channel-${startTime}`
    const {
      requestId: _internalRequestId,
      signal: _signal,
      originalModel: _originalModel,
      ...rest
    } = request
    const openAi = { ...rest, model: actualModel } as Record<string, unknown>

    try {
      if (request.stream !== true) {
        const body = await accountChannelManager.complete({ requestId, model: actualModel, openAi })
        return {
          success: true,
          status: 200,
          body,
          latency: Date.now() - startTime,
          providerSessionId: requestId,
        }
      }
      const upstream = await accountChannelManager.openStream({ requestId, model: actualModel, openAi })
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
      const first = await firstStreamEvent(upstream)
      if (first.kind === 'timeout') {
        // 等首事件超时：渠道假死（HTTP 200 但零字节，无首块也无首错 —— 实测
        // qoder 挂过 165s/285s/625s）。墙钟预算只在尝试之间检查，单次悬挂时
        // 它永远等不到检查点，所以超时必须在这里兑现：销毁源流触发 openStream
        // 的 close → cancel，渠道 worker 才会中止上游请求；504 参与换家。
        upstream.destroy()
        return {
          success: false,
          status: 504,
          error: `渠道 ${Math.round(FIRST_EVENT_TIMEOUT_MS / 1000)}s 内未产出任何首块（疑似假死），已中止并换下一家`,
          latency: Date.now() - startTime,
        }
      }
      if (first.kind === 'error') {
        const failure = first.error as { message?: string; status?: number }
        return {
          success: false,
          status: failure.status ?? 502,
          error: failure.message ?? '渠道请求失败',
          latency: Date.now() - startTime,
        }
      }
      if (first.kind === 'closed') {
        // 客户端已断开的中止也走这里：400 让换家循环立刻停手 —— 请求已死，
        // 换下一家只是白打上游。
        return {
          success: false,
          status: signal?.aborted ? 400 : 502,
          error: signal?.aborted
            ? '客户端已断开，渠道请求已中止'
            : '渠道在建流阶段提前结束，没有产出任何响应',
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
          status: isToolOverflowError(probe.message) || isMissingReasoningHistoryError(probe.message)
            ? 400
            : 502,
          error: probe.message,
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
      const failure = error as { message?: string; status?: number }
      return {
        success: false,
        status: failure.status ?? 502,
        error: failure.message ?? '渠道请求失败',
        latency: Date.now() - startTime,
      }
    }
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
      const transformed = this.transformRequestForPromptToolUse(request, provider)
      const chatPath = provider.chatPath || '/chat/completions'
      const url = this.buildUrl(provider, chatPath)
      const headers = this.buildHeaders(provider, account)
      const body = this.buildRequestBody({ ...request, messages: transformed.messages }, actualModel, account)

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
      const sanitizedBody = applyAggregateDropParams(body, dropRules) as typeof body

      const axiosConfig: AxiosRequestConfig = {
        method: 'POST',
        url,
        headers,
        data: sanitizedBody,
        timeout: proxyStatusManager.getConfig().timeout,
        responseType: request.stream ? 'stream' : 'json',
        validateStatus: () => true,
      }

      const response: AxiosResponse = await this.axiosInstance.request(axiosConfig)
      const latency = Date.now() - startTime

      if (response.status >= 400) {
        return {
          success: false,
          status: response.status,
          error: this.extractErrorMessage(response),
          latency,
        }
      }

      if (request.stream) {
        return {
          success: true,
          status: response.status,
          headers: this.extractHeaders(response.headers),
          stream: wrapStreamWithPlan(response.data, transformed.plan) as any,
          skipTransform: transformed.plan.shouldParseResponse,
          latency,
        }
      }

      this.applyToolCallsToResponse(response.data, transformed)

      return {
        success: true,
        status: response.status,
        headers: this.extractHeaders(response.headers),
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
      const url = this.buildUrl(provider, provider.chatPath || '/responses')
      const headers = this.buildHeaders(provider, account)
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
        timeout: proxyStatusManager.getConfig().timeout,
        responseType: request.stream ? 'stream' : 'json',
        validateStatus: () => true,
      })
      const latency = Date.now() - startTime

      if (response.status >= 400) {
        return {
          success: false,
          status: response.status,
          error: this.extractErrorMessage(response),
          latency,
        }
      }

      if (!request.stream) {
        return {
          success: true,
          status: response.status,
          headers: this.extractHeaders(response.headers),
          body: responsesBodyToChat(response.data, actualModel),
          latency,
        }
      }

      return {
        success: true,
        status: response.status,
        headers: this.extractHeaders(response.headers),
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
  private buildUrl(provider: Provider, path: string): string {
    let baseUrl = provider.apiEndpoint

    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1)
    }

    if (!path.startsWith('/')) {
      path = '/' + path
    }

    if (baseUrl.includes('/v1') && path.startsWith('/v1')) {
      path = path.slice(3)
    }

    return `${baseUrl}${path}`
  }

  /**
   * Build Request Headers
   */
  private buildHeaders(provider: Provider, account: Account): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...provider.headers,
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

    return headers
  }

  /**
   * Build Request Body
   */
  private buildRequestBody(
    request: ChatCompletionRequest,
    actualModel: string,
    account: Account
  ): any {
    const body: any = {
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

    return body
  }

  /**
   * Extract Response Headers
   */
  private extractHeaders(headers: any): Record<string, string> {
    const result: Record<string, string> = {}

    for (const [key, value] of Object.entries(headers)) {
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
   */
  private extractErrorMessage(response: AxiosResponse): string {
    if (response.data) {
      if (typeof response.data === 'string') {
        return response.data
      }

      if (response.data.error?.message) {
        return response.data.error.message
      }

      if (response.data.message) {
        return response.data.message
      }

      if (response.data.msg) {
        return response.data.msg
      }

      try {
        return JSON.stringify(response.data)
      } catch {
        return 'Unknown error'
      }
    }

    return `HTTP ${response.status}`
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
    body: any,
    isStream: boolean = false
  ): Promise<ForwardResult> {
    const startTime = Date.now()

    try {
      const config: AxiosRequestConfig = {
        method,
        url,
        headers,
        data: body,
        timeout: proxyStatusManager.getConfig().timeout,
        responseType: isStream ? 'stream' : 'json',
        validateStatus: () => true,
      }

      const response: AxiosResponse = await this.axiosInstance.request(config)
      const latency = Date.now() - startTime

      if (response.status >= 400) {
        return {
          success: false,
          status: response.status,
          error: this.extractErrorMessage(response),
          latency,
        }
      }

      if (isStream) {
        return {
          success: true,
          status: response.status,
          headers: this.extractHeaders(response.headers),
          stream: response.data,
          latency,
        }
      }

      return {
        success: true,
        status: response.status,
        headers: this.extractHeaders(response.headers),
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
