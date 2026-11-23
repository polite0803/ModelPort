/**
 * 视觉读图两段式（PLAN-vision-relay，2026-11-19 用户批准）。
 *
 * 触发条件是「这一轮**真正服务的模型**不能收图」，不是「请求带图」：
 * - 目标已标注 vision=yes（路由池里有视觉候选 / 具名目标是视觉模型）→ 直发，本模块零介入；
 * - 路由池视觉候选为空、或钉住的模型收不下图、或具名目标 vision≠yes → 先把全部图片
 *   部件交给一个**免费**视觉模型转述成自解释文本标记，再按原文本目标继续。
 *
 * 只读判据、不新造：能不能收图复用选路同一套标注层（`capabilityOfCandidate`），
 * 本模块只做「转述」这件事。
 *
 * 铁律边界：图片**全部转述、绝不删除**（当轮 + 历史 + 工具结果）。1.8.29 的事故是
 * 「静默丢图」；替换成带出处的文本标记是合法形态。同一张图按内容哈希缓存转述文本，
 * 历史前缀逐字节稳定，prompt cache 不受措辞漂移影响。
 *
 * 隔离：转述请求走 `probe: true` 通路（不占 AIMD、不进 Bandit/冷却、独立 `kind:'probe'`
 * 日志行），usage 不并入主请求。主响应带 `X-ModelPort-Vision-Relay`。
 *
 * ⚠️ 模块加载纪律：`store` / `autoRouter` / `forwarder` 只做**动态导入**。它们带着
 * 无扩展名的值导入，Node 原生 TS 剥壳的单测一旦静态加载整条链就 `ERR_MODULE_NOT_FOUND`；
 * 纯判据部分（收集/触发/替换/读图器链）保持零重依赖，测试才能直接 import 本文件。
 */
import { createHash, randomUUID } from 'node:crypto'
import { capabilityOfCandidate, profileRequest } from './autoRouting.ts'
import type { PoolStrategyCandidate } from './autoRouting.ts'
import { getAggregateEntry } from '../providers/aggregate/registry.ts'
import { aggregateCostOf } from '../../shared/aggregateCost.ts'
import { normalizeVisionRelay, type VisionRelaySettings } from '../../shared/visionRelayConfig.ts'
import type { ChatCompletionRequest, ChatMessage, ForwardResult } from './types.ts'
import type { AutoRouteDecision } from './autoRouter'
import type { RequestLogEntry } from '../../shared/types.ts'

/** 转述指令（GATEWAY-TEXT: vision-relay-prompt）。固定模板：只报告图片内容，不回答问题。 */
const RELAY_PROMPT = 'Transcribe all visible text in this image verbatim, then describe its layout, colors, objects, charts and data precisely. Do not answer any question about the image; only report what it shows.'
/** 模板版本：改 RELAY_PROMPT 必须递增，否则旧缓存会冒充新模板的产物。 */
const RELAY_TEMPLATE_VERSION = 1
const RELAY_MAX_TOKENS = 2048
/** 整条 hop 的墙钟上限（含全部重试与多图）。 */
const RELAY_WALL_CLOCK_MS = 60_000
/** 单个读图器的退避档位：429/1305 最多 3 次。 */
const RELAY_BACKOFF_MS = [5_000, 15_000] as const
/** 转述缓存：LRU 64 条。 */
const RELAY_CACHE_LIMIT = 64

const relayCache = new Map<string, string>()

function cacheKeyOf(url: string, reader: string): string {
  return createHash('sha256')
    .update(`${RELAY_TEMPLATE_VERSION}\u0000${reader}\u0000${url}`)
    .digest('hex')
}

function cacheGet(key: string): string | undefined {
  const hit = relayCache.get(key)
  if (hit === undefined) return undefined
  // LRU：命中的条目移到队尾
  relayCache.delete(key)
  relayCache.set(key, hit)
  return hit
}

function cacheSet(key: string, value: string): void {
  if (relayCache.size >= RELAY_CACHE_LIMIT) {
    const oldest = relayCache.keys().next().value
    if (oldest !== undefined) relayCache.delete(oldest)
  }
  relayCache.set(key, value)
}

/** 仅测试用：清空转述缓存。 */
export function clearVisionRelayCache(): void {
  relayCache.clear()
}

/** 转述替换标记（GATEWAY-TEXT: vision-relay-marker）：自解释、无任何行为指令。 */
export function relayMarkerText(reader: string, description: string): string {
  return `[Image relayed via ${reader}: ${description}]`
}

/** 一个待转述的图片部件。 */
export interface RelayImageRef {
  messageIndex: number
  partIndex: number
  url: string
}

const RELAYABLE_PART_TYPES = new Set(['image_url', 'input_image', 'image'])
/** 这些部件也算「视觉输入」，但读图器转述不了：出现即整条 hop 放弃（走原 503）。 */
const UNRELAYABLE_VISION_TYPES = new Set(['file', 'file_url', 'video_url'])

function partTypeOf(part: unknown): string | undefined {
  if (typeof part !== 'object' || part === null) return undefined
  const type = (part as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}

function partUrlOf(part: unknown): string | undefined {
  if (typeof part !== 'object' || part === null) return undefined
  const record = part as Record<string, unknown>
  const imageUrl = record.image_url
  if (typeof imageUrl === 'object' && imageUrl !== null) {
    const url = (imageUrl as { url?: unknown }).url
    if (typeof url === 'string' && url.length > 0) return url
  }
  const url = record.url
  return typeof url === 'string' && url.length > 0 ? url : undefined
}

/**
 * 收集请求里**全部**图片部件（当轮 + 历史 + 工具结果）。
 * 返回 `null` = 不能转述：没有图片、或有读图器处理不了的视觉部件（file/video）。
 */
export function collectRelayImages(request: ChatCompletionRequest): RelayImageRef[] | null {
  const images: RelayImageRef[] = []
  for (let mi = 0; mi < request.messages.length; mi++) {
    const content = request.messages[mi]?.content
    if (!Array.isArray(content)) continue
    for (let pi = 0; pi < content.length; pi++) {
      const type = partTypeOf(content[pi])
      if (type === undefined) continue
      if (UNRELAYABLE_VISION_TYPES.has(type)) return null
      if (!RELAYABLE_PART_TYPES.has(type)) continue
      const url = partUrlOf(content[pi])
      if (url === undefined) return null
      images.push({ messageIndex: mi, partIndex: pi, url })
    }
  }
  return images.length === 0 ? null : images
}

/**
 * 路由路径的触发判据：`select` 自己就是「这一轮服务谁」的权威答案，与派发同源。
 * 候选非空 = 有能收图的候选（硬过滤保证）⇒ 不介入；
 * 候选为空且缺的正是 vision（整池或钉住的模型）⇒ 值得一次转述。
 */
export function routeDecisionNeedsVisionRelay(
  decision: Pick<AutoRouteDecision, 'profile' | 'candidates' | 'missing' | 'pinBlocked'>
): boolean {
  if (!decision.profile.needsVision) return false
  if (decision.candidates.length > 0) return false
  if (decision.missing.includes('vision')) return true
  return decision.pinBlocked?.missing.includes('vision') === true
}

/**
 * 把图片部件原位替换成转述文本标记。返回**新对象**，绝不就地修改；
 * `signal` 是不可枚举属性，展开会丢，这里原样挂回去。
 */
export function replaceRelayImages(
  request: ChatCompletionRequest,
  images: readonly RelayImageRef[],
  descriptions: ReadonlyMap<string, { description: string; reader: string }>,
): ChatCompletionRequest {
  const byMessage = new Map<number, Map<number, { description: string; reader: string }>>()
  for (const image of images) {
    const replacement = descriptions.get(image.url)
    if (replacement === undefined) continue
    let parts = byMessage.get(image.messageIndex)
    if (parts === undefined) {
      parts = new Map()
      byMessage.set(image.messageIndex, parts)
    }
    parts.set(image.partIndex, replacement)
  }
  const messages: ChatMessage[] = request.messages.map((message, mi) => {
    const parts = byMessage.get(mi)
    if (parts === undefined || !Array.isArray(message.content)) return message
    const content = message.content.map((part, pi) => {
      const replacement = parts.get(pi)
      return replacement === undefined
        ? part
        : { type: 'text' as const, text: relayMarkerText(replacement.reader, replacement.description) }
    })
    return { ...message, content }
  })
  const next: ChatCompletionRequest = { ...request, messages }
  const signal = request.signal
  if (signal !== undefined) {
    Object.defineProperty(next, 'signal', { value: signal, enumerable: false, configurable: true })
  }
  return next
}

/** 读图器候选。 */
export interface RelayReader {
  providerId: string
  providerName: string
  displayName: string
  actualModelId: string
  accountId: string
  accountName: string
}

/** 目标模型收不收图（与选路/hardFilter 同一判据 `capabilityOfCandidate`）。 */
export function acceptsRelayImages(candidate: PoolStrategyCandidate): boolean {
  return capabilityOfCandidate(candidate).vision === 'yes'
}

/** 免费判据：目录免费/官方免费/手工标了免费；`included`（套餐内）不算免费。 */
function isFreeRelayCandidate(candidate: PoolStrategyCandidate): boolean {
  if (candidate.costClass === 'free') return true
  if (candidate.costClass === 'included') return false
  return candidate.costBucket === 'free'
}

/** 排序权重：官方免费证据 0 < 目录免费 1 < 元路由（随机派模型）2。 */
function relayEvidenceRank(candidate: PoolStrategyCandidate): number {
  if (candidate.providerId === 'open_router' && candidate.actualModelId === 'openrouter/free') return 2
  if (candidate.providerType !== 'aggregate') return 1
  const entry = getAggregateEntry(candidate.providerId)
  if (entry === undefined) return 1
  const signal = aggregateCostOf({
    entryId: entry.id,
    modelId: candidate.actualModelId,
    ...(entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}),
  })
  return signal.evidence === 'official' ? 0 : 1
}

/**
 * 读图器候选链（纯函数，供测试与主流程共用）。
 * - 显式 `reader`：按显示名或 `<provider>/<model>` 精确命中，必须是 vision=yes；失败不换家。
 * - 自动：vision=yes 且免费的模型，官方免费证据优先，元路由最后；同模型只留一个账号。
 */
export function relayReaderChainOf(
  pool: readonly PoolStrategyCandidate[],
  explicitReader?: string,
  options: { includePaid?: boolean } = {}
): RelayReader[] {
  const toReader = (candidate: PoolStrategyCandidate): RelayReader => ({
    providerId: candidate.providerId,
    providerName: candidate.providerName,
    displayName: candidate.displayName,
    actualModelId: candidate.actualModelId,
    accountId: candidate.accountId,
    accountName: '',
  })
  const visionCapable = pool.filter(acceptsRelayImages)
  if (explicitReader !== undefined && explicitReader.length > 0) {
    const wanted = explicitReader.trim().toLowerCase()
    const match = visionCapable.find(candidate =>
      candidate.displayName.trim().toLowerCase() === wanted
      || `${candidate.providerId}/${candidate.actualModelId}`.toLowerCase() === wanted)
    return match === undefined ? [] : [toReader(match)]
  }
  // 自动链仍只收免费模型（2026-11-19 拍板：绝不静默用付费模型）。设置页若想看
  // 全部可点名的视觉模型，用 `includePaid: true`；成本门槛是拍板语义，不随
  // `ignoreTransientAvailability` 这类诊断口径松动。
  const seen = new Set<string>()
  const deduped: PoolStrategyCandidate[] = []
  for (const candidate of visionCapable.filter(item => options.includePaid === true || isFreeRelayCandidate(item))) {
    const key = `${candidate.providerId}\u0000${candidate.displayName}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(candidate)
  }
  return deduped
    .map((candidate, index) => ({ candidate, index, rank: relayEvidenceRank(candidate) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map(entry => toReader(entry.candidate))
}

/** base64 data URL 的字节数（解码后）；估算误差只在 padding，上限判断足够。 */
function dataUrlBytes(url: string): number | undefined {
  if (!url.startsWith('data:')) return undefined
  const comma = url.indexOf(',')
  if (comma < 0) return undefined
  const payload = url.slice(comma + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

function bodyOf(result: ForwardResult): Record<string, unknown> | undefined {
  return typeof result.body === 'object' && result.body !== null
    ? result.body as Record<string, unknown>
    : undefined
}

function contentOf(result: ForwardResult): string | undefined {
  const choices = bodyOf(result)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const message = (choices[0] as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string' && content.trim().length > 0) return content.trim()
  return undefined
}

function sleepAbortable(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise(resolve => {
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

interface AttemptOutcome {
  description: string | null
  /** true = 值得换下一个读图器/重试；false = 客户端已中止或预算耗尽，整条 hop 必须停。 */
  continueChain: boolean
}

async function relayOneImage(
  reader: RelayReader,
  url: string,
  parentSignal: AbortSignal | undefined,
  deadline: number,
  maxImageBytes: number,
): Promise<AttemptOutcome> {
  const cacheKey = cacheKeyOf(url, reader.displayName)
  const cached = cacheGet(cacheKey)
  if (cached !== undefined) return { description: cached, continueChain: true }

  const bytes = dataUrlBytes(url)
  if (bytes !== undefined && bytes > maxImageBytes) {
    // 超大图不静默压缩：判失败，走原 503
    return { description: null, continueChain: true }
  }

  // 重模块只在这里动态导入（见模块头：测试要能静态 import 本文件的纯判据）
  const [{ storeManager }, { requestForwarder }] = await Promise.all([
    import('../store/store.ts'),
    import('./forwarder.ts'),
  ])
  const account = storeManager.getAccountById(reader.accountId, true)
  const provider = storeManager.getProviderById(reader.providerId)
  if (account === undefined || provider === undefined) {
    return { description: null, continueChain: true }
  }

  for (let attempt = 0; attempt <= RELAY_BACKOFF_MS.length; attempt++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0 || parentSignal?.aborted === true) {
      return { description: null, continueChain: false }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), remaining)
    const signal = parentSignal === undefined
      ? controller.signal
      : AbortSignal.any([parentSignal, controller.signal])
    const requestId = `vr_${randomUUID().replace(/-/g, '').slice(0, 24)}`
    const startedAt = Date.now()
    const relayRequest: ChatCompletionRequest = {
      model: reader.actualModelId,
      messages: [{
        role: 'user',
        // GATEWAY-TEXT: vision-relay-prompt — 读图器的固定转述指令，只进这一笔 hop 请求
        content: [
          { type: 'text', text: RELAY_PROMPT },
          { type: 'image_url', image_url: { url } },
        ],
      }],
      max_tokens: RELAY_MAX_TOKENS,
      stream: false,
      requestId,
      signal,
    }
    let result: ForwardResult
    try {
      result = await requestForwarder.forwardChatCompletion(
        relayRequest,
        account,
        provider,
        reader.actualModelId,
        {
          requestId,
          providerId: reader.providerId,
          accountId: reader.accountId,
          model: reader.actualModelId,
          actualModel: reader.actualModelId,
          startTime: startedAt,
          isStream: false,
        },
        { maxRetries: 0, probe: true },
      )
    } finally {
      clearTimeout(timer)
    }
    logRelayAttempt(storeManager, reader, provider.name ?? reader.providerId, requestId, startedAt, result)
    if (result.success) {
      const description = contentOf(result)
      if (description !== undefined) {
        cacheSet(cacheKey, description)
        return { description, continueChain: true }
      }
      // 200 但正文为空（推理耗尽预算）：读图器不可用，换下一个
      return { description: null, continueChain: true }
    }
    const retryable = result.status === 429
    if (!retryable || attempt >= RELAY_BACKOFF_MS.length) {
      return { description: null, continueChain: true }
    }
    await sleepAbortable(RELAY_BACKOFF_MS[attempt]!, parentSignal)
  }
  return { description: null, continueChain: true }
}

/** 转述行的独立日志（`kind:'probe'`：不并入主请求统计与 usage）。 */
function logRelayAttempt(
  store: { addRequestLog: (entry: Omit<RequestLogEntry, 'id'>) => unknown },
  reader: RelayReader,
  providerName: string,
  requestId: string,
  startedAt: number,
  result: ForwardResult,
): void {
  const statusCode = result.status ?? (result.success ? 200 : 0)
  const body = bodyOf(result)
  const usage = typeof body?.usage === 'object' && body.usage !== null
    ? body.usage as { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } }
    : undefined
  store.addRequestLog({
    timestamp: startedAt,
    kind: 'probe',
    status: result.success ? 'success' : 'error',
    statusCode,
    requestId,
    method: 'POST',
    url: '/__modelport/vision-relay',
    model: reader.displayName,
    actualModel: reader.actualModelId,
    providerId: reader.providerId,
    providerName,
    accountId: reader.accountId,
    accountName: reader.accountName || reader.accountId,
    responseStatus: statusCode,
    latency: result.latency ?? Math.max(0, Date.now() - startedAt),
    isStream: false,
    ...(result.error === undefined ? {} : { errorMessage: result.error }),
    ...(result.status === undefined ? {} : { upstreamStatus: result.status }),
    ...(typeof usage?.prompt_tokens === 'number' && typeof usage?.completion_tokens === 'number'
      ? {
          usage: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            ...(typeof usage.prompt_tokens_details?.cached_tokens === 'number'
              ? { cacheReadTokens: usage.prompt_tokens_details.cached_tokens }
              : {}),
            source: 'upstream' as const,
          },
        }
      : {}),
  })
}

export interface VisionRelayOutcome {
  request: ChatCompletionRequest
  reader: string
  imagesRelayed: number
}

/**
 * 主入口：执行一次（或零次）读图 hop。返回 `null` 表示保持原请求不变。
 *
 * 调用方负责先判断「这一轮服务的模型收不下图」（路由路径用
 * `routeDecisionNeedsVisionRelay`，具名路径用 `autoRouter.visionOf`），
 * 本函数只回答「图转述成功了没有」。
 */
export async function applyVisionRelay(
  request: ChatCompletionRequest,
  rawSettings: unknown,
): Promise<VisionRelayOutcome | null> {
  const settings: VisionRelaySettings | undefined = normalizeVisionRelay(rawSettings)
  if (settings === undefined || settings.enabled !== true) return null
  if (!profileRequest(request).needsVision) return null
  const images = collectRelayImages(request)
  if (images === null) return null
  const { autoRouter } = await import('./autoRouter.ts')
  // 显式点名时按「目录里有没有这个读图器」找，而不是按「它此刻是否限流」找：
  // 用户已经承担了点名的代价，限流失败会落 probe 日志，但静默跳过只会让
  // 客户端拿到一句 `vision required`，永远不知道两段式为什没跑。
  const chain = relayReaderChainOf(
    autoRouter.relayCandidatePool(settings.reader === undefined ? {} : { ignoreTransientAvailability: true }),
    settings.reader,
  )
  if (chain.length === 0) return null

  const deadline = Date.now() + RELAY_WALL_CLOCK_MS
  const descriptions = new Map<string, { description: string; reader: string }>()
  let lastReader: string | undefined
  for (const image of images) {
    if (descriptions.has(image.url)) continue
    let relayed = false
    for (const reader of chain) {
      const outcome = await relayOneImage(reader, image.url, request.signal, deadline, settings.maxImageBytes)
      if (outcome.description !== null) {
        descriptions.set(image.url, { description: outcome.description, reader: reader.displayName })
        lastReader = reader.displayName
        relayed = true
        break
      }
      if (!outcome.continueChain) return null
    }
    if (!relayed) return null
  }
  if (lastReader === undefined) return null
  return {
    request: replaceRelayImages(request, images, descriptions),
    reader: lastReader,
    imagesRelayed: descriptions.size,
  }
}