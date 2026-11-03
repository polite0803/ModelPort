/**
 * 手动探测入口：能力（文本/工具/图片）、上下文窗口、输出上限。
 *
 * 探测永远由用户点击触发；本模块不做任何定时/自动探测。所有探测共用一条
 * 串行队列（`createSerialTaskQueue`），所以同一模型串行、跨模型并发上限 1。
 *
 * 探测请求与真实流量隔离：`probe: true` 让 forwarder 跳过派发账本、AIMD、
 * Bandit 与冷却；请求日志行带 `kind: 'probe'`，统计口径不把它算进成功率。
 *
 * 上下文/输出用阶梯推进（见 `shared/modelProbe.ts`），429/401/403/5xx/网络/超时
 * 一律只记 `inconclusive`，绝不写成上限。
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
  planContextProbe,
  planOutputProbe,
  probeFreshness,
  probeRowKey,
  shouldSkipProbe,
  type ModelProbeRow,
  type ModelProbeRunResult,
  type ProbeObservation,
  type ProbePlan,
  type ProbeScope,
} from '../../shared/modelProbe.ts'
import { familyRuleLayer } from '../../shared/modelFamilyRules.ts'
import { normalizeOutputCap } from '../proxy/utils/outputCap.ts'
import { quotaBlockReason } from '../proxy/quota/gate.ts'
import { readModelProbeSidecar, recordModelProbe } from './modelProbeStore.ts'
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

async function forwardProbe(
  request: ChatCompletionRequest,
  account: Account,
  provider: Provider,
  actualModel: string,
): Promise<ForwardResult> {
  return requestForwarder.forwardChatCompletion(
    request,
    account,
    provider,
    actualModel,
    probeContextOf(request.requestId ?? randomUUID(), provider, account, actualModel),
    { maxRetries: 0, probe: true },
  )
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
}): ModelProbeRow {
  const previous = input.previous && probeFreshness(input.previous.asOf) === 'fresh'
    ? input.previous
    : undefined
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
    ...input.scopeFields,
  }
}

async function previousRowFor(providerId: string, displayName: string): Promise<ModelProbeRow | undefined> {
  const sidecar = await readModelProbeSidecar()
  const key = probeRowKey({ providerId, displayName })
  return sidecar.rows.find((row) => probeRowKey(row) === key)
}

function probeFailureReason(result: ForwardResult): string {
  const status = result.status ?? '无状态'
  const detail = result.error ?? result.errorDetails?.message ?? ''
  return `HTTP ${status}${detail ? `：${detail}` : ''}`
}

/** 上下文探测：从低档向上推，遇到明确超限或不可判定原因即停。 */
async function probeContext(input: {
  provider: Provider
  account: Account
  displayName: string
  actualModelId: string
  hintTokens: number | undefined
  hintSource: 'family-rule' | 'declared' | undefined
}): Promise<{ result: ModelProbeRunResult; row: ModelProbeRow }> {
  const plan = planContextProbe({ hintTokens: input.hintTokens, hintSource: input.hintSource })
  const previous = await previousRowFor(input.provider.id, input.displayName)
  const observations: ProbeObservation[] = []
  let requests = 0
  let latencyMs: number | undefined

  for (const tier of plan.tiers) {
    const blocked = quotaBlockReason(
      { id: input.provider.id, type: input.provider.type },
      input.account.id,
      input.actualModelId,
    )
    if (blocked) {
      observations.push({ tier, outcome: 'deferred', detail: `额度闸门：${blocked}` })
      break
    }

    const requestId = `${randomUUID()}-ctx-${tier}`
    const startedAt = Date.now()
    const request = baseProbeRequest(
      input.actualModelId,
      requestId,
      buildContextProbePrompt(tier),
    )
    const result = await forwardProbe(request, input.account, input.provider, input.actualModelId)
    requests += 1
    logProbeRequest({
      provider: input.provider,
      account: input.account,
      displayName: input.displayName,
      actualModel: input.actualModelId,
      result,
      requestId,
      startedAt,
      tier: undefined,
    })
    if (latencyMs === undefined) latencyMs = result.latency ?? Date.now() - startedAt

    if (result.success) {
      observations.push({ tier, outcome: 'accepted', detail: `${tier} 档输入被接受` })
      continue
    }

    const classified = classifyProbeFailure({
      scope: 'context',
      status: result.status,
      errorText: errorTextOf(result),
      localAdmissionRejected: result.localAdmissionRejected,
    })
    if (classified === 'rejected') {
      observations.push({ tier, outcome: 'rejected', detail: probeFailureReason(result) })
      break
    }
    observations.push({
      tier,
      outcome: classified === 'deferred' ? 'deferred' : 'inconclusive',
      detail: probeFailureReason(result),
    })
    break
  }

  const verdict = evaluateContextProbe(observations)
  const row = mergeProbeRow({
    previous,
    providerId: input.provider.id,
    displayName: input.displayName,
    actualModelId: input.actualModelId,
    nowIso: new Date().toISOString(),
    latencyMs,
    scopeFields: {
      contextStatus: verdict.status,
      contextReason: verdict.reason,
      contextRange: verdict.bound,
      contextTokens: verdict.bound?.atLeast,
      contextEvidence: `上下文阶梯探测：${plan.tiers.join(' / ')}；${observations.map((item) => `${item.tier}=${item.outcome}`).join('，')}`,
    },
  })
  await recordModelProbe(row)

  return {
    row,
    result: {
      scope: 'context',
      status: verdict.status,
      plan,
      requests,
      estimatedInputTokens: plan.estimatedInputTokens,
      estimatedOutputTokens: plan.estimatedOutputTokens,
      ...(verdict.reason ? { reason: verdict.reason } : {}),
      row,
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
}): Promise<{ result: ModelProbeRunResult; row: ModelProbeRow }> {
  const plan = planOutputProbe({ hintTokens: input.hintTokens, hintSource: input.hintSource })
  const previous = await previousRowFor(input.provider.id, input.displayName)
  const observations: ProbeObservation[] = []
  let requests = 0
  let latencyMs: number | undefined
  let lastFinishReason: string | undefined
  let lastCompletionTokens: number | undefined

  for (const tier of plan.tiers) {
    const blocked = quotaBlockReason(
      { id: input.provider.id, type: input.provider.type },
      input.account.id,
      input.actualModelId,
    )
    if (blocked) {
      observations.push({ tier, outcome: 'deferred', detail: `额度闸门：${blocked}` })
      break
    }

    const requestId = `${randomUUID()}-out-${tier}`
    const startedAt = Date.now()
    // 两种入参名按既有折叠逻辑：别名优先，折成 `max_tokens` 再发。
    const request = normalizeOutputCap({
      ...baseProbeRequest(input.actualModelId, requestId, buildOutputProbePrompt()),
      max_completion_tokens: tier,
    })
    const result = await forwardProbe(request, input.account, input.provider, input.actualModelId)
    requests += 1
    lastFinishReason = finishReasonOf(result)
    lastCompletionTokens = completionTokensOf(result)
    logProbeRequest({
      provider: input.provider,
      account: input.account,
      displayName: input.displayName,
      actualModel: input.actualModelId,
      result,
      requestId,
      startedAt,
      tier,
    })
    if (latencyMs === undefined) latencyMs = result.latency ?? Date.now() - startedAt

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
    })
    if (classified === 'rejected') {
      observations.push({ tier, outcome: 'rejected', detail: probeFailureReason(result) })
      break
    }
    observations.push({
      tier,
      outcome: classified === 'deferred' ? 'deferred' : 'inconclusive',
      detail: probeFailureReason(result),
    })
    break
  }

  const verdict = evaluateOutputProbe(observations)
  const row = mergeProbeRow({
    previous,
    providerId: input.provider.id,
    displayName: input.displayName,
    actualModelId: input.actualModelId,
    nowIso: new Date().toISOString(),
    latencyMs,
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
  await recordModelProbe(row)

  return {
    row,
    result: {
      scope: 'output',
      status: verdict.status,
      plan,
      requests,
      estimatedInputTokens: plan.estimatedInputTokens,
      estimatedOutputTokens: plan.estimatedOutputTokens,
      ...(verdict.reason ? { reason: verdict.reason } : {}),
      row,
    },
  }
}

/** 能力探测：三条极小请求（文本 / 工具声明 / 图片输入）。 */
async function probeCapability(input: {
  provider: Provider
  account: Account
  displayName: string
  actualModelId: string
}): Promise<{ result: ModelProbeRunResult; row: ModelProbeRow }> {
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

  const textResult = await forwardProbe(
    baseProbeRequest(input.actualModelId, `${requestId}-text`, 'Reply with the single word ok.'),
    input.account,
    input.provider,
    input.actualModelId,
  )
  logProbeRequest({
    provider: input.provider,
    account: input.account,
    displayName: input.displayName,
    actualModel: input.actualModelId,
    result: textResult,
    requestId: `${requestId}-text`,
    startedAt,
  })
  if (!textResult.success) {
    const classified = classifyProbeFailure({
      scope: 'context',
      status: textResult.status,
      errorText: errorTextOf(textResult),
      localAdmissionRejected: textResult.localAdmissionRejected,
    })
    return {
      row: mergeProbeRow({
        previous,
        providerId: input.provider.id,
        displayName: input.displayName,
        actualModelId: input.actualModelId,
        nowIso: new Date().toISOString(),
        scopeFields: {},
      }),
      result: {
        scope: 'capability',
        status: classified === 'deferred' ? 'deferred' : 'inconclusive',
        plan,
        requests: 1,
        estimatedInputTokens: plan.estimatedInputTokens,
        estimatedOutputTokens: plan.estimatedOutputTokens,
        reason: probeFailureReason(textResult),
      },
    }
  }
  const latencyMs = Date.now() - startedAt

  // 工具：声明一个 no-op 工具，成功即代表上游接受 tools 字段。
  const toolsStart = Date.now()
  const toolsResult = await forwardProbe(
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
  )
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

  // 图片：1×1 PNG，成功即代表上游接受 image_url 内容块。
  const visionStart = Date.now()
  const visionResult = await forwardProbe(
    baseProbeRequest(input.actualModelId, `${requestId}-vision`, [
      { type: 'text', text: 'What color is this pixel? One word.' },
      { type: 'image_url', image_url: { url: ONE_PIXEL_PNG, detail: 'low' } },
    ]),
    input.account,
    input.provider,
    input.actualModelId,
  )
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
    scopeFields: {
      ...(tools === undefined ? {} : { tools }),
      ...(vision === undefined ? {} : { vision }),
      evidence: `手动探测：${observed.join('；')}`,
    },
  })
  await recordModelProbe(row)

  return {
    row,
    result: {
      scope: 'capability',
      status: 'measured',
      plan,
      requests: 3,
      estimatedInputTokens: plan.estimatedInputTokens,
      estimatedOutputTokens: plan.estimatedOutputTokens,
      row,
    },
  }
}

/**
 * 探测一个模型并写入 sidecar。`scope` 缺省为能力探测（兼容旧调用）。
 * 上下文/输出在已有声明级证据时默认跳过，`force` 才重测。
 */
export async function runModelCapabilityProbe(input: {
  providerId: string
  displayName: string
  scope?: ProbeScope
  force?: boolean
}): Promise<ModelProbeRunResult> {
  return serialQueue(() => runProbeInner(input))
}

async function runProbeInner(input: {
  providerId: string
  displayName: string
  scope?: ProbeScope
  force?: boolean
}): Promise<ModelProbeRunResult> {
  const provider = storeManager.getProviderById(input.providerId)
  if (!provider) throw new Error('供应商不存在')
  const model = storeManager
    .getModelCatalogue(input.providerId)
    .find((candidate) => candidate.displayName === input.displayName)
  if (!model) throw new Error('模型不在该供应商目录中')

  const account = storeManager
    .getAccountsByProviderId(input.providerId, true)
    .find((candidate) => candidate.status === 'active')
  if (!account) throw new Error('该供应商没有可用账号，无法探测')

  const scope: ProbeScope = input.scope ?? 'capability'
  if (scope === 'capability') {
    return (await probeCapability({
      provider, account, displayName: model.displayName, actualModelId: model.actualModelId,
    })).result
  }

  const metadata = await getResolvedModelMetadata({
    providerId: provider.id,
    displayName: model.displayName,
  })
  const fact = metadata?.[scope === 'context' ? 'contextTokens' : 'maxOutputTokens']
  if (shouldSkipProbe(fact, input.force === true)) {
    const plan = scope === 'context' ? planContextProbe() : planOutputProbe()
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
      hintTokens, hintSource,
    })).result
  }
  return (await probeOutput({
    provider, account, displayName: model.displayName, actualModelId: model.actualModelId,
    hintTokens, hintSource,
  })).result
}
