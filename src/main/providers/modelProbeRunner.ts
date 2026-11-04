/**
 * 手动探测入口：能力（文本/工具/图片）、上下文窗口、输出上限。
 *
 * 探测永远由用户点击触发；本模块不做任何定时/自动探测。所有探测共用一条
 * 串行队列（`createSerialTaskQueue`），所以同一模型串行、跨模型并发上限 1。
 *
 * 探测请求与真实流量隔离：`probe: true` 让 forwarder 跳过派发账本、AIMD 准入
 * （不占用真实请求的并发名额）、Bandit 与冷却；请求日志行带 `kind: 'probe'`，
 * 统计口径不把它算进成功率。
 *
 * 上下文/输出用阶梯推进（见 `shared/modelProbe.ts`），429/401/403/5xx/网络/超时
 * 一律只记 `inconclusive`，绝不写成上限。
 *
 * 三道闸门在**发第一条请求之前**（判据全部在 `shared/probeDisposition.ts`）：
 * provider 已停用、条目声明的模态无法由 chat 报文行使、以及上一轮换来的确定性
 * 终局结论仍在有效期内。被闸门拦下的探测不产生上游请求，也就不产生
 * `kind:'probe'` 的错误请求行 —— 2026-11-04 那天 73 条探测错误行就是这么来的。
 */
import { randomUUID } from 'crypto'
import { storeManager } from '../store/store.ts'
import { requestForwarder } from '../proxy/forwarder.ts'
import type { ChatCompletionRequest, ForwardResult, ProxyContext } from '../proxy/types.ts'
import type { Account, Provider } from '../store/types.ts'
import {
  buildContextProbePrompt,
  buildOutputProbePrompt,
  classifyOutputSuccess,
  classifyProbeFailure,
  createSerialTaskQueue,
  evaluateContextProbe,
  evaluateOutputProbe,
  indexProbeRows,
  planContextProbe,
  planOutputProbe,
  probeFailureKind,
  probeFreshness,
  probeRowKey,
  probeTerminalOf,
  PROBE_REQUEST_TIMEOUT_MS,
  shouldSkipProbe,
  type ModelProbeRow,
  type ModelProbeRunResult,
  type ProbeFailureKind,
  type ProbeObservation,
  type ProbePlan,
  type ProbeProgressEvent,
  type ProbeScope,
} from '../../shared/modelProbe.ts'
import {
  classifyProbeModality,
  classifyProbeTerminal,
  decideProbeGate,
  probeTerminalFresh,
  type ProbeGateDecision,
  type ProbeModalityFacts,
  type ProbeTerminalVerdict,
} from '../../shared/probeDisposition.ts'
import { familyRuleLayer } from '../../shared/modelFamilyRules.ts'
import type { ModelMetadata } from '../../shared/modelMetadata.ts'
import { normalizeOutputCap } from '../proxy/utils/outputCap.ts'
import { quotaBlockReason } from '../proxy/quota/gate.ts'
import {
  clearModelProbeTerminal,
  getProbeRowsSync,
  readModelProbeSidecar,
  recordModelProbe,
} from './modelProbeStore.ts'
import { getResolvedModelMetadata } from './modelMetadataService.ts'

/** 1×1 透明 PNG：只用来验证「上游是否接受图片输入」，不承载内容。 */
const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const serialQueue = createSerialTaskQueue()

interface ProbeFailure {
  status?: number
  error?: string
  errorDetails?: { message?: string }
  errorBody?: string
}

function errorTextOf(result: ProbeFailure): string {
  return `${result.error ?? ''} ${result.errorDetails?.message ?? ''} ${result.errorBody ?? ''}`.toLowerCase()
}

/** 同一条上游回答，但**不**转小写：终局结论要把原话当证据留进行内。 */
function errorRawOf(result: ProbeFailure): string {
  return `${result.error ?? ''} ${result.errorDetails?.message ?? ''} ${result.errorBody ?? ''}`
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 探测的发起方。
 *
 * `manual` 是用户点出来的（IPC 单模型探测），`batch` 是「全部补齐」编排里按计划
 * 发的那一条。只有 batch 会吃终局缓存：缓存存在的意义就是「别每轮都去问一遍」，
 * 而用户点击是一次明确的重问请求 —— 它必须真的发出去，并且把缓存作废。
 */
export type ProbeOrigin = 'manual' | 'batch'

/**
 * 条目声明的模态事实。只取 `declared` 置信度（人工标记 / 上游同步），
 * 第三方旁表与家族推定都不足以阻断一次探测 —— 「没有声明 ≠ 非 chat」。
 */
function declaredModalityFacts(
  metadata: ModelMetadata | undefined,
): ProbeModalityFacts {
  const fact = metadata?.modalities
  if (fact?.state !== 'known' || fact.confidence !== 'declared') return {}
  return { inputModalities: fact.value }
}

function planForScope(scope: ProbeScope): ProbePlan {
  if (scope === 'context') return planContextProbe()
  if (scope === 'output') return planOutputProbe()
  return { scope, tiers: [], requestCount: 3, estimatedInputTokens: 3 * 32, estimatedOutputTokens: 3 * 16 }
}

function skippedProbeResult(scope: ProbeScope, reason: string): ModelProbeRunResult {
  const plan = planForScope(scope)
  return {
    scope,
    status: 'skipped',
    plan,
    requests: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    reason,
  }
}

/**
 * 三条闸门的唯一裁决：provider 停用 / 模态不可行使 / 终局结论仍在有效期。
 *
 * 批量编排走同一个函数预筛计划，所以「预演说发多少条」与「执行时真的发多少条」
 * 是同一个判据，不会出现界面承诺 8 条、实际 0 条的对不上账。
 */
async function gateProbeRun(input: {
  provider: Provider
  displayName: string
  origin: ProbeOrigin
  metadata: ModelMetadata | undefined
}): Promise<ProbeGateDecision> {
  const now = Date.now()
  const ownTerminal = input.origin === 'batch'
    ? probeTerminalOf(
      indexProbeRows(getProbeRowsSync()).get(probeRowKey({ providerId: input.provider.id, displayName: input.displayName })),
      now,
    )
    : undefined
  const accountTerminal = input.origin === 'batch'
    ? getProbeRowsSync().find(
      (row) =>
        row.providerId === input.provider.id
        && row.terminal !== undefined
        && row.terminal.scope === 'account'
        && probeTerminalFresh(row.terminal.asOf, now),
    )?.terminal
    : undefined
  return decideProbeGate({
    providerEnabled: input.provider.enabled,
    modality: classifyProbeModality(declaredModalityFacts(input.metadata)),
    ...(ownTerminal === undefined ? {} : { terminal: ownTerminal }),
    ...(accountTerminal === undefined ? {} : { accountTerminal }),
  })
}

function looksLikeCapabilityRejection(
  result: ProbeFailure,
  keywords: readonly string[],
): boolean {
  if (result.status !== 400 && result.status !== 415 && result.status !== 422 && result.status !== 501) {
    return false
  }
  const text = errorTextOf(result)
  return keywords.some((keyword) => text.includes(keyword))
}

function baseProbeRequest(
  actualModel: string,
  requestId: string,
  content: ChatCompletionRequest['messages'][number]['content'],
): ChatCompletionRequest {
  return {
    model: actualModel,
    requestId,
    messages: [{ role: 'user', content }],
    max_tokens: 16,
    stream: false,
  }
}

function probeContextOf(
  requestId: string,
  provider: Provider,
  account: Account,
  actualModel: string,
): ProxyContext {
  return {
    requestId,
    providerId: provider.id,
    accountId: account.id,
    model: actualModel,
    actualModel,
    startTime: Date.now(),
    isStream: false,
  }
}

/** 一次探测的后台上下文：进度回传 + 取消/整体超时信号。 */
export interface ProbeRunOptions {
  jobId?: string
  signal?: AbortSignal
  onProgress?: (event: ProbeProgressEvent) => void
}

interface ProbeEmitter {
  emit: (
    phase: 'prepare' | 'tier' | 'awaiting' | 'done' | 'cancelled',
    extra?: {
      tierIndex?: number
      tierCount?: number
      tierTokens?: number
      errorKind?: ProbeFailureKind
      message?: string
    },
  ) => void
  sent: () => void
}

function createEmitter(input: {
  run: ProbeRunOptions
  providerId: string
  displayName: string
  scope: ProbeScope
  startedAt: number
  requestLimit: number
}): ProbeEmitter {
  let requestsSent = 0
  const emit: ProbeEmitter['emit'] = (phase, extra = {}) => {
    input.run.onProgress?.({
      jobId: input.run.jobId ?? '',
      providerId: input.providerId,
      displayName: input.displayName,
      scope: input.scope,
      phase,
      elapsedMs: Date.now() - input.startedAt,
      requestsSent,
      requestLimit: input.requestLimit,
      startedAt: new Date(input.startedAt).toISOString(),
      ...extra,
    })
  }
  return { emit, sent: () => { requestsSent += 1 } }
}

/** 整体信号被中止时区分「用户取消」与「整体超时」。 */
function abortReasonOf(run: ProbeRunOptions): 'cancelled' | 'timeout' | undefined {
  if (run.signal?.aborted !== true) return undefined
  return run.signal.reason === 'timeout' ? 'timeout' : 'cancelled'
}

function abortReasonText(reason: 'cancelled' | 'timeout'): string {
  return reason === 'timeout' ? '整体探测超时（5 分钟），按 inconclusive 收敛' : '已取消，保留已完成档位的结论'
}

/**
 * 单条请求：30s 硬超时 + 外层整体信号。`timedOut` 只用于人读提示与分类，
 * 判定仍按 `inconclusive`——超时永远不写成上限。
 */
async function forwardProbe(
  request: ChatCompletionRequest,
  account: Account,
  provider: Provider,
  actualModel: string,
  run: ProbeRunOptions = {},
): Promise<{ result: ForwardResult; timedOut: boolean }> {
  const requestController = new AbortController()
  const timer = setTimeout(() => requestController.abort('timeout'), PROBE_REQUEST_TIMEOUT_MS)
  const signal = run.signal
    ? AbortSignal.any([requestController.signal, run.signal])
    : requestController.signal
  try {
    const result = await requestForwarder.forwardChatCompletion(
      { ...request, signal },
      account,
      provider,
      actualModel,
      probeContextOf(request.requestId ?? randomUUID(), provider, account, actualModel),
      { maxRetries: 0, probe: true },
    )
    return {
      result,
      timedOut: requestController.signal.aborted === true || run.signal?.reason === 'timeout',
    }
  } finally {
    clearTimeout(timer)
  }
}

function bodyOf(result: ForwardResult): Record<string, unknown> | undefined {
  const body = result.body
  if (body && typeof body === 'object') return body as Record<string, unknown>
  return undefined
}

function finishReasonOf(result: ForwardResult): string | undefined {
  const choices = bodyOf(result)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const first = choices[0] as { finish_reason?: unknown }
  return typeof first.finish_reason === 'string' ? first.finish_reason : undefined
}

function completionTokensOf(result: ForwardResult): number | undefined {
  const usage = bodyOf(result)?.usage
  if (!usage || typeof usage !== 'object') return undefined
  const tokens = (usage as { completion_tokens?: unknown }).completion_tokens
  return typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : undefined
}

/**
 * 探测行落进请求日志，`kind: 'probe'` 与真实流量区分。
 * `X-Request-Id` 口径不变：行内 `requestId` 就是这次探测请求的 id。
 */
function logProbeRequest(input: {
  provider: Provider
  account: Account
  displayName: string
  actualModel: string
  result: ForwardResult
  requestId: string
  startedAt: number
  tier?: number
}): void {
  const statusCode = input.result.status ?? (input.result.success ? 200 : 0)
  storeManager.addRequestLog({
    timestamp: input.startedAt,
    kind: 'probe',
    status: input.result.success ? 'success' : 'error',
    statusCode,
    requestId: input.requestId,
    method: 'POST',
    url: '/__modelport/probe',
    model: input.displayName,
    actualModel: input.actualModel,
    providerId: input.provider.id,
    providerName: input.provider.name ?? input.provider.id,
    accountId: input.account.id,
    accountName: input.account.name ?? input.account.id,
    ...(input.tier === undefined ? {} : { maxTokens: input.tier }),
    responseStatus: statusCode,
    ...(finishReasonOf(input.result) ? { finishReason: finishReasonOf(input.result) } : {}),
    latency: input.result.latency ?? Math.max(0, Date.now() - input.startedAt),
    isStream: false,
    ...(input.result.error ? { errorMessage: input.result.error } : {}),
    ...(input.result.status === undefined ? {} : { upstreamStatus: input.result.status }),
    ...(input.result.attempts === undefined ? {} : { attempts: input.result.attempts }),
  })
}

function mergeProbeRow(input: {
  previous: ModelProbeRow | undefined
  providerId: string
  displayName: string
  actualModelId: string
  nowIso: string
  scopeFields: Partial<ModelProbeRow>
  latencyMs?: number
  /**
   * 终局结论的去留：`undefined` = 沿用上一行（这一次什么都没说到），
   * 给出对象 = 本次判定，给出 `null` = 本次探测把它推翻（上游真的回话了）。
   */
  terminal?: ProbeTerminalVerdict | null
}): ModelProbeRow {
  const previous = input.previous && probeFreshness(input.previous.asOf) === 'fresh'
    ? input.previous
    : undefined
  const carriedTerminal = input.terminal === undefined
    ? (input.previous?.terminal ?? undefined)
    : input.terminal === null
      ? undefined
      : input.terminal
  const base: ModelProbeRow = {
    providerId: input.providerId,
    displayName: input.displayName,
    actualModelId: input.actualModelId,
    asOf: input.nowIso,
    ...(previous?.tools ? { tools: previous.tools } : {}),
    ...(previous?.vision ? { vision: previous.vision } : {}),
    ...(previous?.contextTokens !== undefined ? { contextTokens: previous.contextTokens } : {}),
    ...(previous?.maxOutputTokens !== undefined ? { maxOutputTokens: previous.maxOutputTokens } : {}),
    ...(previous?.contextStatus ? { contextStatus: previous.contextStatus } : {}),
    ...(previous?.contextReason ? { contextReason: previous.contextReason } : {}),
    ...(previous?.contextRange ? { contextRange: previous.contextRange } : {}),
    ...(previous?.contextEvidence ? { contextEvidence: previous.contextEvidence } : {}),
    ...(previous?.maxOutputStatus ? { maxOutputStatus: previous.maxOutputStatus } : {}),
    ...(previous?.maxOutputReason ? { maxOutputReason: previous.maxOutputReason } : {}),
    ...(previous?.maxOutputRange ? { maxOutputRange: previous.maxOutputRange } : {}),
    ...(previous?.maxOutputEvidence ? { maxOutputEvidence: previous.maxOutputEvidence } : {}),
    ...(previous?.evidence ? { evidence: previous.evidence } : {}),
    ...(previous?.latencyMs !== undefined ? { latencyMs: previous.latencyMs } : {}),
  }
  return {
    ...base,
    ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
    ...(carriedTerminal === undefined ? {} : { terminal: carriedTerminal }),
    ...input.scopeFields,
  }
}

async function previousRowFor(providerId: string, displayName: string): Promise<ModelProbeRow | undefined> {
  const sidecar = await readModelProbeSidecar()
  const key = probeRowKey({ providerId, displayName })
  return sidecar.rows.find((row) => probeRowKey(row) === key)
}

function probeFailureReason(result: ForwardResult, timedOut = false): string {
  if (timedOut) return `探测请求超时（${PROBE_REQUEST_TIMEOUT_MS / 1000}s）`
  const status = result.status ?? '无状态'
  const detail = result.error ?? result.errorDetails?.message ?? ''
  return `HTTP ${status}${detail ? `：${detail}` : ''}`
}

function failureKindOf(result: ForwardResult, timedOut = false): ProbeFailureKind {
  return probeFailureKind({
    ...(result.status === undefined ? {} : { status: result.status }),
    timedOut,
    ...(result.localAdmissionRejected === undefined
      ? {}
      : { localAdmissionRejected: result.localAdmissionRejected }),
  })
}

/** 阶梯里第一条失败请求的上游回答。 */
interface FirstFailure {
  status?: number
  errorText: string
  timedOut: boolean
}

/**
 * 这一次跑完能不能落下「重探也不会变」的终局结论。
 *
 * 只在一种情况给结论：整个阶梯**恰好一条观测**、且它是 `inconclusive` ——
 * 也就是第一条请求就被上游一句确定的「不给」挡了回来。中途通过过档位之后才失败的
 * 是一次区间证据或一次故障，都不是终局；把已经到手的下界换成终局，等于反过来伪造
 * 「没测出来」。
 */
function terminalVerdictOfRun(input: {
  observations: readonly ProbeObservation[]
  firstFailure?: FirstFailure
  cancelled?: 'cancelled' | 'timeout'
}): ProbeTerminalVerdict | undefined {
  if (input.cancelled !== undefined) return undefined
  if (input.observations.length !== 1) return undefined
  const only = input.observations[0] as ProbeObservation | undefined
  if (only?.outcome !== 'inconclusive') return undefined
  const failure = input.firstFailure
  if (failure === undefined) return undefined
  const verdict = classifyProbeTerminal({
    ...(failure.status === undefined ? {} : { status: failure.status }),
    errorText: failure.errorText,
    timedOut: failure.timedOut,
  })
  if (verdict === undefined) return undefined
  return { ...verdict, asOf: new Date().toISOString() }
}

/**
 * 上游这一轮回话了（任一档通过、或给出明确的超限拒绝）→ 旧的终局被推翻。
 * 一次超时/限流既不确立也不推翻，沿用上一份。
 */
function terminalDispositionOfRun(input: {
  observations: readonly ProbeObservation[]
  firstFailure?: FirstFailure
  cancelled?: 'cancelled' | 'timeout'
}): ProbeTerminalVerdict | null | undefined {
  const armed = terminalVerdictOfRun(input)
  if (armed !== undefined) return armed
  const answered = input.observations.some(
    (item) => item.outcome === 'accepted' || item.outcome === 'rejected',
  )
  return answered ? null : undefined
}

/** 上下文探测：从低档向上推，遇到明确超限或不可判定原因即停。 */
async function probeContext(input: {
  provider: Provider
  account: Account
  displayName: string
  actualModelId: string
  hintTokens: number | undefined
  hintSource: 'family-rule' | 'declared' | undefined
  run: ProbeRunOptions
}): Promise<{ result: ModelProbeRunResult; row?: ModelProbeRow }> {
  const plan = planContextProbe({ hintTokens: input.hintTokens, hintSource: input.hintSource })
  const previous = await previousRowFor(input.provider.id, input.displayName)
  const observations: ProbeObservation[] = []
  const startedAt = Date.now()
  const emitter = createEmitter({
    run: input.run,
    providerId: input.provider.id,
    displayName: input.displayName,
    scope: 'context',
    startedAt,
    requestLimit: plan.requestCount,
  })
  emitter.emit('prepare')
  let requests = 0
  let latencyMs: number | undefined
  let lastFailureKind: ProbeFailureKind | undefined
  let firstFailure: FirstFailure | undefined
  let cancelled: 'cancelled' | 'timeout' | undefined

  for (let index = 0; index < plan.tiers.length; index++) {
    const abort = abortReasonOf(input.run)
    if (abort) {
      cancelled = abort
      break
    }
    const tier = plan.tiers[index] as number
    const blocked = quotaBlockReason(
      { id: input.provider.id, type: input.provider.type },
      input.account.id,
      input.actualModelId,
    )
    if (blocked) {
      observations.push({ tier, outcome: 'deferred', detail: `额度闸门：${blocked}` })
      break
    }

    emitter.emit('tier', { tierIndex: index + 1, tierCount: plan.tiers.length, tierTokens: tier })
    const requestId = `${randomUUID()}-ctx-${tier}`
    const requestStartedAt = Date.now()
    const request = baseProbeRequest(
      input.actualModelId,
      requestId,
      buildContextProbePrompt(tier),
    )
    emitter.emit('awaiting', { tierIndex: index + 1, tierCount: plan.tiers.length, tierTokens: tier })
    const { result, timedOut } = await forwardProbe(
      request, input.account, input.provider, input.actualModelId, input.run,
    )
    requests += 1
    emitter.sent()
    logProbeRequest({
      provider: input.provider,
      account: input.account,
      displayName: input.displayName,
      actualModel: input.actualModelId,
      result,
      requestId,
      startedAt: requestStartedAt,
      tier: undefined,
    })
    if (latencyMs === undefined) latencyMs = result.latency ?? Date.now() - requestStartedAt

    // 整体超时/用户取消：不追加观测，保留已通过的档位结论。
    const abortAfter = abortReasonOf(input.run)
    if (abortAfter) {
      cancelled = abortAfter
      break
    }

    if (result.success) {
      observations.push({ tier, outcome: 'accepted', detail: `${tier} 档输入被接受` })
      continue
    }

    const classified = classifyProbeFailure({
      scope: 'context',
      status: result.status,
      errorText: errorTextOf(result),
      localAdmissionRejected: result.localAdmissionRejected,
      timedOut,
    })
    lastFailureKind = failureKindOf(result, timedOut)
    if (firstFailure === undefined) {
      firstFailure = {
        ...(result.status === undefined ? {} : { status: result.status }),
        errorText: errorRawOf(result),
        timedOut,
      }
    }
    if (classified === 'rejected') {
      observations.push({
        tier,
        outcome: 'rejected',
        detail: probeFailureReason(result, timedOut),
      })
      break
    }
    observations.push({
      tier,
      outcome: classified === 'deferred' ? 'deferred' : 'inconclusive',
      detail: probeFailureReason(result, timedOut),
    })
    break
  }

  const timeoutSeen = observations.some((item) => item.outcome === 'inconclusive' && (item.detail ?? '').includes('超时'))
  const verdict = cancelled === 'timeout' || timeoutSeen
    ? {
      status: 'inconclusive' as const,
      reason: cancelled === 'timeout' ? abortReasonText('timeout') : `探测请求超时（${PROBE_REQUEST_TIMEOUT_MS / 1000}s），按 inconclusive 收敛`,
      bound: undefined,
    }
    : cancelled === 'cancelled'
      ? { ...evaluateContextProbe(observations), reason: abortReasonText('cancelled') }
      : evaluateContextProbe(observations)
  const recorded = cancelled !== undefined && observations.length === 0
    ? undefined
    : mergeProbeRow({
      previous,
      providerId: input.provider.id,
      displayName: input.displayName,
      actualModelId: input.actualModelId,
      nowIso: new Date().toISOString(),
      latencyMs,
      terminal: terminalDispositionOfRun({ observations, firstFailure, cancelled }),
      scopeFields: {
        contextStatus: verdict.status,
        contextReason: verdict.reason,
        contextRange: verdict.bound,
        contextTokens: verdict.bound?.atLeast,
        contextEvidence: `上下文阶梯探测：${plan.tiers.join(' / ')}；${observations.map((item) => `${item.tier}=${item.outcome}`).join('，')}`,
      },
    })
  if (recorded) await recordModelProbe(recorded)
  emitter.emit(cancelled === undefined ? 'done' : 'cancelled', {
    ...(cancelled === 'timeout'
      ? { errorKind: 'timeout' as const }
      : lastFailureKind === undefined ? {} : { errorKind: lastFailureKind }),
    ...(verdict.reason === undefined ? {} : { message: verdict.reason }),
  })

  return {
    ...(recorded === undefined ? {} : { row: recorded }),
    result: {
      scope: 'context',
      status: verdict.status,
      plan,
      requests,
      estimatedInputTokens: plan.estimatedInputTokens,
      estimatedOutputTokens: plan.estimatedOutputTokens,
      ...(verdict.reason ? { reason: verdict.reason } : {}),
      ...(verdict.status === 'measured'
        ? {}
        : cancelled === 'timeout'
          ? { errorKind: 'timeout' as const }
          : lastFailureKind === undefined ? {} : { errorKind: lastFailureKind }),
      ...(recorded === undefined ? {} : { row: recorded }),
    },
  }
}

/** 输出上限探测：`max_tokens` 阶梯 + `finish_reason`/`completion_tokens` 判定。 */
async function probeOutput(input: {
  provider: Provider
  account: Account
  displayName: string
  actualModelId: string
  hintTokens: number | undefined
  hintSource: 'family-rule' | 'declared' | undefined
  run: ProbeRunOptions
}): Promise<{ result: ModelProbeRunResult; row?: ModelProbeRow }> {
  const plan = planOutputProbe({ hintTokens: input.hintTokens, hintSource: input.hintSource })
  const previous = await previousRowFor(input.provider.id, input.displayName)
  const observations: ProbeObservation[] = []
  const startedAt = Date.now()
  const emitter = createEmitter({
    run: input.run,
    providerId: input.provider.id,
    displayName: input.displayName,
    scope: 'output',
    startedAt,
    requestLimit: plan.requestCount,
  })
  emitter.emit('prepare')
  let requests = 0
  let latencyMs: number | undefined
  let lastFinishReason: string | undefined
  let lastCompletionTokens: number | undefined
  let lastFailureKind: ProbeFailureKind | undefined
  let firstFailure: FirstFailure | undefined
  let cancelled: 'cancelled' | 'timeout' | undefined

  for (let index = 0; index < plan.tiers.length; index++) {
    const abort = abortReasonOf(input.run)
    if (abort) {
      cancelled = abort
      break
    }
    const tier = plan.tiers[index] as number
    const blocked = quotaBlockReason(
      { id: input.provider.id, type: input.provider.type },
      input.account.id,
      input.actualModelId,
    )
    if (blocked) {
      observations.push({ tier, outcome: 'deferred', detail: `额度闸门：${blocked}` })
      break
    }

    emitter.emit('tier', { tierIndex: index + 1, tierCount: plan.tiers.length, tierTokens: tier })
    const requestId = `${randomUUID()}-out-${tier}`
    const requestStartedAt = Date.now()
    // 两种入参名按既有折叠逻辑：别名优先，折成 `max_tokens` 再发。
    const request = normalizeOutputCap({
      ...baseProbeRequest(input.actualModelId, requestId, buildOutputProbePrompt()),
      max_completion_tokens: tier,
    })
    emitter.emit('awaiting', { tierIndex: index + 1, tierCount: plan.tiers.length, tierTokens: tier })
    const { result, timedOut } = await forwardProbe(
      request, input.account, input.provider, input.actualModelId, input.run,
    )
    requests += 1
    emitter.sent()
    lastFinishReason = finishReasonOf(result)
    lastCompletionTokens = completionTokensOf(result)
    logProbeRequest({
      provider: input.provider,
      account: input.account,
      displayName: input.displayName,
      actualModel: input.actualModelId,
      result,
      requestId,
      startedAt: requestStartedAt,
      tier,
    })
    if (latencyMs === undefined) latencyMs = result.latency ?? Date.now() - requestStartedAt

    const abortAfter = abortReasonOf(input.run)
    if (abortAfter) {
      cancelled = abortAfter
      break
    }

    if (result.success) {
      const outcome = classifyOutputSuccess({
        finishReason: lastFinishReason ?? null,
        completionTokens: lastCompletionTokens ?? null,
        tier,
      })
      observations.push({
        tier,
        outcome,
        detail: outcome === 'accepted'
          ? `finish_reason=${lastFinishReason ?? 'length'}，completion_tokens=${lastCompletionTokens ?? '未报'}`
          : `成功但提前停止：finish_reason=${lastFinishReason ?? '未知'}，completion_tokens=${lastCompletionTokens ?? '未报'}`,
      })
      if (outcome === 'suspect') break
      continue
    }

    const classified = classifyProbeFailure({
      scope: 'output',
      status: result.status,
      errorText: errorTextOf(result),
      localAdmissionRejected: result.localAdmissionRejected,
      timedOut,
    })
    lastFailureKind = failureKindOf(result, timedOut)
    if (firstFailure === undefined) {
      firstFailure = {
        ...(result.status === undefined ? {} : { status: result.status }),
        errorText: errorRawOf(result),
        timedOut,
      }
    }
    if (classified === 'rejected') {
      observations.push({
        tier,
        outcome: 'rejected',
        detail: probeFailureReason(result, timedOut),
      })
      break
    }
    observations.push({
      tier,
      outcome: classified === 'deferred' ? 'deferred' : 'inconclusive',
      detail: probeFailureReason(result, timedOut),
    })
    break
  }

  const timeoutSeen = observations.some((item) => item.outcome === 'inconclusive' && (item.detail ?? '').includes('超时'))
  const verdict = cancelled === 'timeout' || timeoutSeen
    ? {
      status: 'inconclusive' as const,
      reason: cancelled === 'timeout' ? abortReasonText('timeout') : `探测请求超时（${PROBE_REQUEST_TIMEOUT_MS / 1000}s），按 inconclusive 收敛`,
      bound: undefined,
    }
    : cancelled === 'cancelled'
      ? { ...evaluateOutputProbe(observations), reason: abortReasonText('cancelled') }
      : evaluateOutputProbe(observations)
  const recorded = cancelled !== undefined && observations.length === 0
    ? undefined
    : mergeProbeRow({
      previous,
      providerId: input.provider.id,
      displayName: input.displayName,
      actualModelId: input.actualModelId,
      nowIso: new Date().toISOString(),
      latencyMs,
      terminal: terminalDispositionOfRun({ observations, firstFailure, cancelled }),
      scopeFields: {
        maxOutputStatus: verdict.status,
        maxOutputReason: verdict.reason,
        maxOutputRange: verdict.bound,
        maxOutputTokens: verdict.bound?.atLeast,
        maxOutputEvidence: `输出阶梯探测：${plan.tiers.join(' / ')}；${observations
          .map((item) => `${item.tier}=${item.outcome}`)
          .join('，')}${lastFinishReason === undefined ? '' : `；最后一次 finish_reason=${lastFinishReason}`}`,
      },
    })
  if (recorded) await recordModelProbe(recorded)
  emitter.emit(cancelled === undefined ? 'done' : 'cancelled', {
    ...(cancelled === 'timeout'
      ? { errorKind: 'timeout' as const }
      : lastFailureKind === undefined ? {} : { errorKind: lastFailureKind }),
    ...(verdict.reason === undefined ? {} : { message: verdict.reason }),
  })

  return {
    ...(recorded === undefined ? {} : { row: recorded }),
    result: {
      scope: 'output',
      status: verdict.status,
      plan,
      requests,
      estimatedInputTokens: plan.estimatedInputTokens,
      estimatedOutputTokens: plan.estimatedOutputTokens,
      ...(verdict.reason ? { reason: verdict.reason } : {}),
      ...(verdict.status === 'measured'
        ? {}
        : cancelled === 'timeout'
          ? { errorKind: 'timeout' as const }
          : lastFailureKind === undefined ? {} : { errorKind: lastFailureKind }),
      ...(recorded === undefined ? {} : { row: recorded }),
    },
  }
}

/** 能力探测：三条极小请求（文本 / 工具声明 / 图片输入）。 */
async function probeCapability(input: {
  provider: Provider
  account: Account
  displayName: string
  actualModelId: string
  run: ProbeRunOptions
}): Promise<{ result: ModelProbeRunResult; row?: ModelProbeRow }> {
  const plan: ProbePlan = {
    scope: 'capability',
    tiers: [],
    requestCount: 3,
    estimatedInputTokens: 3 * 32,
    estimatedOutputTokens: 3 * 16,
  }
  const previous = await previousRowFor(input.provider.id, input.displayName)
  const requestId = randomUUID()
  const startedAt = Date.now()
  const emitter = createEmitter({
    run: input.run,
    providerId: input.provider.id,
    displayName: input.displayName,
    scope: 'capability',
    startedAt,
    requestLimit: 3,
  })
  emitter.emit('prepare')
  let requests = 0
  let cancelled: 'cancelled' | 'timeout' | undefined

  const abort = abortReasonOf(input.run)
  if (abort) {
    emitter.emit('cancelled', {
      ...(abort === 'timeout' ? { errorKind: 'timeout' as const } : {}),
      message: abortReasonText(abort),
    })
    return {
      result: {
        scope: 'capability',
        status: 'inconclusive',
        plan,
        requests: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        reason: abortReasonText(abort),
      },
    }
  }

  emitter.emit('tier', { tierIndex: 1, tierCount: 3 })
  emitter.emit('awaiting', { tierIndex: 1, tierCount: 3 })
  const { result: textResult, timedOut } = await forwardProbe(
    baseProbeRequest(input.actualModelId, `${requestId}-text`, 'Reply with the single word ok.'),
    input.account,
    input.provider,
    input.actualModelId,
    input.run,
  )
  requests += 1
  emitter.sent()
  logProbeRequest({
    provider: input.provider,
    account: input.account,
    displayName: input.displayName,
    actualModel: input.actualModelId,
    result: textResult,
    requestId: `${requestId}-text`,
    startedAt,
  })
  cancelled = abortReasonOf(input.run)
  if (cancelled) {
    const kind = cancelled === 'timeout' ? 'timeout' : failureKindOf(textResult, timedOut)
    emitter.emit('cancelled', {
      ...(kind === 'unknown' ? {} : { errorKind: kind }),
      message: abortReasonText(cancelled),
    })
    return {
      result: {
        scope: 'capability',
        status: 'inconclusive',
        plan,
        requests,
        estimatedInputTokens: plan.estimatedInputTokens,
        estimatedOutputTokens: plan.estimatedOutputTokens,
        reason: abortReasonText(cancelled),
      },
    }
  }
  if (!textResult.success) {
    const classified = classifyProbeFailure({
      scope: 'context',
      status: textResult.status,
      errorText: errorTextOf(textResult),
      localAdmissionRejected: textResult.localAdmissionRejected,
      timedOut,
    })
    // 能力探测的第一条文本请求同样可以换来终局结论：上游说的是「这条目不给」，
    // 后面两条档位再问也不会有新信息。
    const armed = classifyProbeTerminal({
      ...(textResult.status === undefined ? {} : { status: textResult.status }),
      errorText: errorRawOf(textResult),
      timedOut,
      ...(textResult.localAdmissionRejected === undefined
        ? {}
        : { localAdmissionRejected: textResult.localAdmissionRejected }),
    })
    emitter.emit('done', {
      errorKind: failureKindOf(textResult, timedOut),
      message: probeFailureReason(textResult, timedOut),
    })
    return {
      row: mergeProbeRow({
        previous,
        providerId: input.provider.id,
        displayName: input.displayName,
        actualModelId: input.actualModelId,
        nowIso: new Date().toISOString(),
        terminal: armed === undefined ? undefined : { ...armed, asOf: new Date().toISOString() },
        scopeFields: {},
      }),
      result: {
        scope: 'capability',
        status: classified === 'deferred' ? 'deferred' : 'inconclusive',
        plan,
        requests,
        estimatedInputTokens: plan.estimatedInputTokens,
        estimatedOutputTokens: plan.estimatedOutputTokens,
        reason: probeFailureReason(textResult, timedOut),
      },
    }
  }
  const latencyMs = Date.now() - startedAt

  emitter.emit('tier', { tierIndex: 2, tierCount: 3 })
  emitter.emit('awaiting', { tierIndex: 2, tierCount: 3 })
  // 工具：声明一个 no-op 工具，成功即代表上游接受 tools 字段。
  const toolsStart = Date.now()
  // GATEWAY-TEXT: probe-capability — 能力探测的工具请求文本，只进 `probe: true` 的
  // 探测请求，不进任何客户端会话。
  const { result: toolsResult } = await forwardProbe(
    {
      ...baseProbeRequest(input.actualModelId, `${requestId}-tools`, 'Reply with the single word ok.'),
      tools: [
        {
          type: 'function',
          function: {
            name: 'modelport_probe_noop',
            description: 'No-op probe tool. Do not call it.',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      tool_choice: 'auto',
    },
    input.account,
    input.provider,
    input.actualModelId,
    input.run,
  )
  requests += 1
  emitter.sent()
  logProbeRequest({
    provider: input.provider,
    account: input.account,
    displayName: input.displayName,
    actualModel: input.actualModelId,
    result: toolsResult,
    requestId: `${requestId}-tools`,
    startedAt: toolsStart,
  })
  const tools: 'yes' | 'no' | undefined = toolsResult.success
    ? 'yes'
    : looksLikeCapabilityRejection(toolsResult, ['tool', 'function'])
      ? 'no'
      : undefined
  cancelled = abortReasonOf(input.run)
  if (cancelled) {
    emitter.emit('cancelled', {
      ...(cancelled === 'timeout' ? { errorKind: 'timeout' as const } : {}),
      message: abortReasonText(cancelled),
    })
    return {
      result: {
        scope: 'capability',
        status: 'inconclusive',
        plan,
        requests,
        estimatedInputTokens: plan.estimatedInputTokens,
        estimatedOutputTokens: plan.estimatedOutputTokens,
        reason: abortReasonText(cancelled),
      },
    }
  }

  emitter.emit('tier', { tierIndex: 3, tierCount: 3 })
  emitter.emit('awaiting', { tierIndex: 3, tierCount: 3 })
  // 图片：1×1 PNG，成功即代表上游接受 image_url 内容块。
  // GATEWAY-TEXT: probe-capability — 能力探测的图片请求文本，只进探测请求。
  const visionStart = Date.now()
  const { result: visionResult } = await forwardProbe(
    baseProbeRequest(input.actualModelId, `${requestId}-vision`, [
      { type: 'text', text: 'What color is this pixel? One word.' },
      { type: 'image_url', image_url: { url: ONE_PIXEL_PNG, detail: 'low' } },
    ]),
    input.account,
    input.provider,
    input.actualModelId,
    input.run,
  )
  requests += 1
  emitter.sent()
  logProbeRequest({
    provider: input.provider,
    account: input.account,
    displayName: input.displayName,
    actualModel: input.actualModelId,
    result: visionResult,
    requestId: `${requestId}-vision`,
    startedAt: visionStart,
  })
  const vision: 'yes' | 'no' | undefined = visionResult.success
    ? 'yes'
    : looksLikeCapabilityRejection(visionResult, ['image', 'vision', 'mode', 'content type'])
      ? 'no'
      : undefined
  cancelled = abortReasonOf(input.run)

  const observed: string[] = ['文本可达']
  if (tools === 'yes') observed.push('tools 已接受')
  if (tools === 'no') observed.push('tools 被拒绝')
  if (vision === 'yes') observed.push('图片输入已接受')
  if (vision === 'no') observed.push('图片输入被拒绝')

  const row = mergeProbeRow({
    previous,
    providerId: input.provider.id,
    displayName: input.displayName,
    actualModelId: input.actualModelId,
    nowIso: new Date().toISOString(),
    latencyMs,
    // 文本请求成功了：上一次「这条目服务不了」的结论被这一次回答推翻。
    terminal: null,
    scopeFields: {
      ...(tools === undefined ? {} : { tools }),
      ...(vision === undefined ? {} : { vision }),
      evidence: `手动探测：${observed.join('；')}`,
    },
  })
  await recordModelProbe(row)
  emitter.emit(cancelled === undefined ? 'done' : 'cancelled', {
    ...(cancelled === 'timeout' ? { errorKind: 'timeout' as const } : {}),
    ...(cancelled === undefined ? {} : { message: abortReasonText(cancelled) }),
  })

  return {
    row,
    result: {
      scope: 'capability',
      status: cancelled === undefined ? 'measured' : 'inconclusive',
      plan,
      requests,
      estimatedInputTokens: plan.estimatedInputTokens,
      estimatedOutputTokens: plan.estimatedOutputTokens,
      ...(cancelled === undefined ? {} : { reason: abortReasonText(cancelled) }),
      ...(cancelled === 'timeout' ? { errorKind: 'timeout' as const } : {}),
      row,
    },
  }
}

/**
 * 探测一个模型并写入 sidecar。`scope` 缺省为能力探测（兼容旧调用）。
 * 上下文/输出在已有声明级证据时默认跳过，`force` 才重测。
 *
 * `origin` 缺省 `manual`：调用方没说自己是谁时，一律按「用户刚点了一下」处理 ——
 * 宁可多发一条被闸门该拦的请求，也不要把用户明确要的探测悄悄吞掉。
 */
export async function runModelCapabilityProbe(input: {
  providerId: string
  displayName: string
  scope?: ProbeScope
  force?: boolean
  origin?: ProbeOrigin
  run?: ProbeRunOptions
}): Promise<ModelProbeRunResult> {
  return serialQueue(() => runProbeInner(input))
}

async function runProbeInner(input: {
  providerId: string
  displayName: string
  scope?: ProbeScope
  force?: boolean
  origin?: ProbeOrigin
  run?: ProbeRunOptions
}): Promise<ModelProbeRunResult> {
  const run = input.run ?? {}
  const origin: ProbeOrigin = input.origin ?? 'manual'
  const provider = storeManager.getProviderById(input.providerId)
  if (!provider) throw new Error('供应商不存在')
  const model = storeManager
    .getModelCatalogue(input.providerId)
    .find((candidate) => candidate.displayName === input.displayName)
  if (!model) throw new Error('模型不在该供应商目录中')

  const scope: ProbeScope = input.scope ?? 'capability'
  const metadata = await getResolvedModelMetadata({
    providerId: provider.id,
    displayName: model.displayName,
  })

  // 手动重探先把终局缓存作废：用户既然重新点了，上一次「上游说不提供」就不作数。
  // 顺序是有意的 —— 闸门读的是同步快照，不清就还是旧结论。
  if (origin === 'manual') {
    await clearModelProbeTerminal(provider.id, model.displayName)
  }

  const gate = await gateProbeRun({
    provider,
    displayName: model.displayName,
    origin,
    metadata,
  })
  if (!gate.probe) {
    // 一条上游请求都不发，也就不落 `kind:'probe'` 的错误行。
    run.onProgress?.({
      jobId: run.jobId ?? '',
      providerId: provider.id,
      displayName: model.displayName,
      scope,
      phase: 'done',
      elapsedMs: 0,
      requestsSent: 0,
      requestLimit: 0,
      startedAt: new Date().toISOString(),
      message: gate.message,
    })
    return skippedProbeResult(scope, `${gate.reason}：${gate.message}`)
  }

  const account = storeManager
    .getAccountsByProviderId(input.providerId, true)
    .find((candidate) => candidate.status === 'active')
  if (!account) throw new Error('该供应商没有可用账号，无法探测')

  if (scope === 'capability') {
    return (await probeCapability({
      provider, account, displayName: model.displayName, actualModelId: model.actualModelId, run,
    })).result
  }

  const fact = metadata?.[scope === 'context' ? 'contextTokens' : 'maxOutputTokens']
  if (shouldSkipProbe(fact, input.force === true)) {
    const plan = scope === 'context' ? planContextProbe() : planOutputProbe()
    run.onProgress?.({
      jobId: run.jobId ?? '',
      providerId: provider.id,
      displayName: model.displayName,
      scope,
      phase: 'done',
      elapsedMs: 0,
      requestsSent: 0,
      requestLimit: 0,
      startedAt: new Date().toISOString(),
      message: '已有声明级来源，无需探测（可强制重测）',
    })
    return {
      scope,
      status: 'skipped',
      plan,
      requests: 0,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      reason: '已有声明级来源，无需探测（可强制重测）',
    }
  }

  const familyHint = familyRuleLayer(model.actualModelId)?.hint
  const hintTokens = fact?.state === 'known'
    ? fact.value
    : scope === 'context'
      ? familyHint?.contextTokens
      : familyHint?.maxOutputTokens
  const hintSource: 'family-rule' | 'declared' | undefined = fact?.state === 'known'
    ? 'declared'
    : hintTokens === undefined
      ? undefined
      : 'family-rule'

  if (scope === 'context') {
    return (await probeContext({
      provider, account, displayName: model.displayName, actualModelId: model.actualModelId,
      hintTokens, hintSource, run,
    })).result
  }
  return (await probeOutput({
    provider, account, displayName: model.displayName, actualModelId: model.actualModelId,
    hintTokens, hintSource, run,
  })).result
}
