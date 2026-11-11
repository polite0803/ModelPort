/**
 * 模型管理页「测试」按钮：给一个模型发一次最小真实请求，回答「此刻能不能用」。
 *
 * 走的是**生产转发路径**（`requestForwarder`），端点、鉴权、报文形状都与真实流量一致，
 * 所以它测的是这条路由本身，而不是另写一份探测逻辑会给出的另一种答案。
 *
 * 两条纪律：
 * - `probe: true`：一次手动测试不能改变路由判断 —— 不进派发账本、不更新 AIMD/Bandit、
 *   不写冷却、不计入成功率。这与元数据探测（`modelProbeRunner`）同一条隔离规则。
 * - 聚合条目有按 Key 轮换的专用探测（`aggregateProviderManager.testModel`），此处直接
 *   复用：不再写第二份带轮换的请求体。
 */
import { randomUUID } from 'node:crypto'
import { storeManager } from '../store/store.ts'
import { requestForwarder } from '../proxy/forwarder.ts'
import { aggregateProviderManager } from './aggregate/index.ts'
import { channelRuntimeState } from './accountChannels/runtimeState.ts'
import type { ChatCompletionRequest, ProxyContext } from '../proxy/types.ts'
import type { Account, Provider } from '../store/types.ts'
import type { ProviderModelTestResult } from '../../shared/types.ts'

/** 一次测试的最长等待：到点按超时收敛，不把界面卡在上游的无限等待里。 */
const MODEL_TEST_TIMEOUT_MS = 30_000

/** 错误正文只留可读的一段：界面用 title 展示，不铺满表格。 */
const DETAIL_LIMIT = 300

function truncate(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return undefined
  return trimmed.length > DETAIL_LIMIT ? `${trimmed.slice(0, DETAIL_LIMIT)}…` : trimmed
}

interface TestTarget {
  provider: Provider
  /** 上游真正要的模型 id（目录行的 `actualModelId`，别名的 `actualModel`）。 */
  actualModel: string
}

/**
 * 把「一行目录/别名」解析成可测试的目标。
 *
 * 别名不归任何供应商目录管，它的落点写在全局映射表里：`preferredProviderId` 优先，
 * 缺省回落到调用方给的 owner（映射行里由界面算好）。
 */
function resolveTarget(input: {
  providerId: string
  displayName: string
  alias?: string
}): { target: TestTarget; reason?: undefined } | { target?: undefined; reason: string } {
  if (input.alias !== undefined) {
    const mapping = storeManager.getConfig().modelMappings?.[input.alias]
    if (!mapping) return { reason: 'unknown_model' }
    const ownerId = mapping.preferredProviderId ?? input.providerId
    const provider = storeManager.getProviderById(ownerId) ?? storeManager.getProviderById(input.providerId)
    if (!provider) return { reason: 'unknown_provider' }
    return { target: { provider, actualModel: mapping.actualModel } }
  }

  const provider = storeManager.getProviderById(input.providerId)
  if (!provider) return { reason: 'unknown_provider' }
  const model = storeManager
    .getModelCatalogue(input.providerId)
    .find((candidate) => candidate.displayName === input.displayName)
  if (!model) return { reason: 'unknown_model' }
  return { target: { provider, actualModel: model.actualModelId } }
}

function contextOf(
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

/**
 * 测试一个模型。`alias` 给出时，`displayName` 是别名行的名字，按全局映射表解析。
 */
export async function testProviderModel(input: {
  providerId: string
  displayName: string
  alias?: string
}): Promise<ProviderModelTestResult> {
  const resolved = resolveTarget(input)
  if (resolved.target === undefined) {
    return { success: false, reason: resolved.reason }
  }
  const { provider, actualModel } = resolved.target

  // 聚合条目：复用详情页那条带 Key 轮换的探测，两个入口对同一个模型给同一个答案。
  if (provider.type === 'aggregate') {
    const result = await aggregateProviderManager.testModel(provider.id, actualModel)
    return {
      success: result.success,
      ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(truncate(result.detail) === undefined ? {} : { detail: truncate(result.detail) }),
    }
  }

  // 渠道包的 Worker 没在跑时，任何请求都只会在桥上等超时：先如实说出这一层。
  if (provider.type === 'account' && !channelRuntimeState.running) {
    return { success: false, reason: 'channel_runtime_stopped' }
  }

  const account = storeManager
    .getAccountsByProviderId(provider.id, true)
    .find((candidate) => candidate.status === 'active')
  if (!account) {
    return { success: false, reason: 'no_active_account' }
  }

  const requestId = randomUUID()
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), MODEL_TEST_TIMEOUT_MS)
  const timedOut = (): boolean => controller.signal.aborted
  const request: ChatCompletionRequest = {
    model: actualModel,
    requestId,
    signal: controller.signal,
    // GATEWAY-TEXT: liveness-ping — 目录存活探测，不进任何用户对话（与 `aggregate.testModel` 同一类探针）。
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    stream: false,
  }

  try {
    const result = await requestForwarder.forwardChatCompletion(
      request,
      account,
      provider,
      actualModel,
      contextOf(requestId, provider, account, actualModel),
      { maxRetries: 0, probe: true },
    )
    const latencyMs = result.latency ?? Math.max(0, Date.now() - startedAt)
    if (result.success) {
      return { success: true, latencyMs }
    }
    const detail = truncate(
      [result.status === undefined ? undefined : `HTTP ${result.status}`, result.error]
        .filter((part): part is string => typeof part === 'string' && part !== '')
        .join(' · '),
    )
    return {
      success: false,
      latencyMs,
      reason: timedOut() ? 'timeout' : 'upstream_error',
      ...(detail === undefined ? {} : { detail }),
    }
  } catch (error) {
    return {
      success: false,
      latencyMs: Math.max(0, Date.now() - startedAt),
      reason: timedOut() ? 'timeout' : 'network_error',
      ...(truncate(error instanceof Error ? error.message : String(error)) === undefined
        ? {}
        : { detail: truncate(error instanceof Error ? error.message : String(error)) }),
    }
  } finally {
    clearTimeout(timer)
  }
}
