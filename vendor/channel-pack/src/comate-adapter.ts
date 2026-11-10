import { LlmAdapter, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { providerCatalogVisible } from './account-pool.js'
import type { AccountPool } from './account-pool.js'
import { RemoteCatalogGate } from './remote-catalog-gate.js'
import { registerAdapterIdempotent } from './llm-register-compat.js'
import { normalizeHarnessMessages, type HarnessMessageLike } from './message-shape.js'
import {
  buildToolUseResults,
  extractClientToolResults,
  mapComateToolCall,
  mergeToolInput,
  type ClientToolDefinition,
  type PendingToolCall,
} from './comate-bridge.js'
import { COMATE } from './comate-product.js'
import {
  COMATE_FREE_MODEL,
  comateClientInfo,
  comateHeaders,
  comateUploadBaseInfo,
  recordComateFreeQuota,
  type ComateCredential,
  type ComateModelEntry,
} from './comate.js'

export const PROVIDER = COMATE.id

/** 单凭据回退 ref（无账号池时）；实际登录写 `COMATE_ACCOUNT_*`。 */
export interface ComateAdapterOptions {
  credentialRef: CredentialRef
  resolveCredential: (modelId?: string) => Promise<ComateCredential | undefined>
  refresh: () => Promise<void>
  fetchRemoteModels?: () => Promise<readonly ComateModelEntry[]>
  accountPool?: AccountPool
}

/** 执行接口要求的 agent 描述；与官方 CLI 的默认主 agent 一致。 */
const AGENT_INFO = Object.freeze({
  agentName: 'Agent',
  isProjectAgent: false,
  canInvokeAgents: false,
})

/** 同一段对话在本地缓存 30 分钟；超过后重新建会话。 */
const CONVERSATION_TTL_MS = 30 * 60 * 1_000
const CONVERSATION_CACHE_MAX = 64
/**
 * 命中 `QUOTA_EXCEED` 且上游标明试用/免费账号后，在该窗口内直接本地拒绝
 * 付费模型，不再向 Comate 发请求。
 *
 * 目的：避免用户/客户端反复选择付费模型时，把同一个「额度不足」请求
 * 重复打到上游（风控意义上的无效重试）。窗口取 30 分钟，短于免费额度
 * 的小时级重置；升级套餐后重启或等窗口过去即可恢复。
 */
const FREE_ONLY_TTL_MS = 30 * 60 * 1_000

const EXECUTE_PATH = '/aidevops/autocomate/rest/autowork/v2/execute'
const CONVERSATION_PATH = '/aidevops/autocomate/rest/autowork/v2/conversation'
const TASK_PATH = '/aidevops/autocomate/rest/autowork/v2/task'
/** 一次请求内“全部工具都无法映射”的连续轮次上限（正常不会触发）。 */
const MAX_UNMAPPED_ROUNDS = 12

interface ConversationState {
  conversationId: number
  taskId: number
  /** 已经成功下发过的消息指纹；下一轮据此只发增量。 */
  seen: string[]
  updatedAt: number
  /** 已发给客户端、等待 tool result 的 agent 工具调用。 */
  pending?: PendingToolCall[]
}

interface AgentToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

interface StreamState {
  nextIndex: number
  textIndex?: number
  reasoningIndex?: number
  text: string
  reasoning: string
  usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number }
}

interface CreatedConversation {
  conversationId: number
  taskId: number
}

/** 后端帧（只声明用到的部分）。 */
interface ComateFrame {
  content?: {
    type?: string
    end?: boolean
    detail?: {
      delta?: unknown
      reasoningDelta?: unknown
      end?: unknown
      usage?: {
        inputTokens?: unknown
        cachedInputTokens?: unknown
        outputTokens?: unknown
      }
      exceptionMsg?: unknown
      autoModel?: unknown
      userType?: unknown
      userActions?: { cards?: Array<{ message?: unknown }> }
      toolUse?: unknown
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 把 harness 内容块展平为 transcript 文本。
 *
 * ⚠️ 遇到图片必须**抛错**，不能静默丢掉 —— 本渠道不实现图片上传，丢图会让
 * 用户以为模型看到了。工具调用/结果保留为带标签的文本，保证历史不丢内容。
 */
function contentToTranscript(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const raw of content) {
    if (!isRecord(raw)) continue
    const type = raw.type
    if (type === 'text') {
      if (typeof raw.text === 'string') parts.push(raw.text)
      continue
    }
    if (type === 'image') {
      throw new LlmError('comate: image input is not supported by this channel', 'UNSUPPORTED_CONTENT')
    }
    if (type === 'reasoning') continue
    if (type === 'tool-call') {
      const name = typeof raw.name === 'string' ? raw.name : 'unknown'
      const args = typeof raw.arguments === 'string' ? raw.arguments : JSON.stringify(raw.arguments ?? {})
      parts.push(`[tool-call ${name}: ${args}]`)
      continue
    }
    if (type === 'tool-result') {
      const inner = contentToTranscript(raw.content)
      if (inner.length > 0) parts.push(`[tool-result: ${inner}]`)
    }
  }
  return parts.join('')
}

function messageFingerprint(message: HarnessMessageLike): string {
  const content = Array.isArray(message.content)
    ? JSON.stringify(message.content)
    : contentToTranscript(message.content)
  return `${message.role}\u0000${content}\u0000${String(message.toolCallId ?? '')}`
}

/** 把消息序列渲染成 agent 能理解的 transcript。 */
function renderTranscript(messages: readonly HarnessMessageLike[]): string {
  const rendered: string[] = []
  for (const message of messages) {
    const text = contentToTranscript(message.content).trim()
    if (text.length === 0) continue
    const role = message.role === 'tool' ? 'tool' : message.role
    rendered.push(`[${role}]\n${text}\n[/${role}]`)
  }
  return rendered.join('\n\n')
}

function renderWithSystem(system: string | undefined, messages: readonly HarnessMessageLike[]): string {
  const body = renderTranscript(messages)
  if (system === undefined || system.trim().length === 0) return body
  return `[system]\n${system.trim()}\n[/system]\n\n${body}`
}

/** 稳定哈希（FNV-1a），只用于本地会话缓存键。 */
function hashKey(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

function firstUserText(messages: readonly HarnessMessageLike[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = contentToTranscript(message.content).trim()
    if (text.length > 0) return text
  }
  return ''
}

function lastUserText(messages: readonly HarnessMessageLike[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const text = contentToTranscript(message.content).trim()
    if (text.length > 0) return text
  }
  return ''
}

/** 会话身份：system + 第一条用户消息。同一会话的后续轮次键不变。 */
function conversationKey(system: string | undefined, messages: readonly HarnessMessageLike[]): string {
  return hashKey(`${system ?? ''}\u0001${firstUserText(messages)}`)
}

function isPrefix(prefix: readonly string[], values: readonly string[]): boolean {
  if (prefix.length > values.length) return false
  return prefix.every((item, index) => item === values[index])
}

function lastUserIndex(messages: readonly HarnessMessageLike[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index
  }
  return -1
}

function quotaMessage(
  detail: NonNullable<ComateFrame['content']>['detail'],
): string {
  const cards = Array.isArray(detail?.userActions?.cards) ? detail.userActions.cards : []
  const card = cards.find(item => typeof item.message === 'string' && item.message.length > 0)
  const upstream = typeof card?.message === 'string' && card.message.length > 0 ? card.message : ''
  const autoModel = typeof detail?.autoModel === 'string' && detail.autoModel.length > 0
    ? `（当前可用：${detail.autoModel}）`
    : ''
  return upstream.length > 0
    ? `Comate 额度不足：${upstream}${autoModel}`
    : `Comate 额度不足，请改用 Auto-Free 或升级账号${autoModel}`
}

export class ComateAdapter extends LlmAdapter {
  private remoteModels: readonly ComateModelEntry[] | undefined
  private readonly catalogGate = new RemoteCatalogGate()
  /**
   * 会话缓存：`hash(system + 首条用户消息)` → 该键下的多个会话。
   *
   * 为什么是**列表**而不是单值：两个不同客户端完全可能以同一句「你好」开场。
   * 只按首条消息做键会让它们共用同一个服务端会话，把彼此的上下文串在一起。
   * 复用前还要用 `seen` 做前缀匹配，只有历史确实在该会话上继续增长时才复用。
   */
  private readonly conversations = new Map<string, ConversationState[]>()
  /** License → 免费套餐窗口截止时刻（见 {@link FREE_ONLY_TTL_MS}）。 */
  private readonly freeOnlyUntil = new Map<string, number>()

  constructor(private readonly options: ComateAdapterOptions) {
    super()
  }

  providerInfo(provider: string): LlmProviderInfo {
    const id = typeof provider === 'string' && provider.length > 0 ? provider : PROVIDER
    return { id, name: COMATE.displayName }
  }

  private async loadModels(): Promise<readonly ComateModelEntry[]> {
    if (this.remoteModels !== undefined) return this.remoteModels
    const fetchRemote = this.options.fetchRemoteModels
    if (fetchRemote !== undefined) {
      await this.catalogGate.run(async () => {
        const fetched = await fetchRemote()
        if (fetched.length === 0) return false
        this.remoteModels = fetched
        return true
      })
      if (this.remoteModels !== undefined) return this.remoteModels
    }
    return [COMATE_FREE_MODEL]
  }

  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    if (!await providerCatalogVisible(this.options.accountPool, PROVIDER)) return []
    const all = await this.loadModels()
    const disabled = this.options.accountPool?.disabledModelsFor(PROVIDER)
    const listed = disabled === undefined || disabled.size === 0
      ? all
      : all.filter(model => !disabled.has(model.id))
    return listed.map(model => ({
      provider: PROVIDER,
      id: model.id,
      name: model.name,
      // 图片未实现：无论上游是否声明，都只播报文本。
      inputModalities: ['text'] as const,
    }))
  }

  async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const entry = (await this.loadModels()).find(item => item.id === model)
    const resolved: LlmResolvedModelInfo = {
      provider,
      id: model,
      name: entry?.name ?? model,
      inputModalities: ['text'] as const,
    }
    if (entry?.contextWindow !== undefined && entry.contextWindow > 0) {
      resolved.context = { contextWindow: entry.contextWindow }
    }
    // 实测 `thinkingEnabled:false` 仍会输出 reasoningDelta（服务端不认这个开关），
    // 因此不声明「关闭思考」档位 —— 声明一个不生效的开关比不声明更糟。
    return resolved
  }

  /** Channel Pack 的「显示列表」要求同步返回。 */
  listAllModels(): readonly { id: string; name: string; supportsImage: boolean }[] {
    const source = this.remoteModels ?? [COMATE_FREE_MODEL]
    return source.map(model => ({
      id: model.id,
      name: model.name,
      supportsImage: false,
    }))
  }

  async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{ model: LlmResolvedModelInfo; stream: (options: GenerateOptions) => AsyncIterable<StreamChunk> }> {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options: GenerateOptions) => this.stream(options),
    }
  }

  private async ensureCredential(): Promise<ComateCredential> {
    let credential = await this.options.resolveCredential()
    if (credential === undefined) {
      await this.options.refresh()
      credential = await this.options.resolveCredential()
    }
    if (credential === undefined || credential.license.length === 0) {
      throw new LlmError('comate: no usable credential; log in first', 'MISSING_CREDENTIAL')
    }
    return credential
  }

  private apiUrl(path: string): string {
    return `${COMATE.apiOrigin}${COMATE.apiPrefix}${path}`
  }

  private async postJson(
    path: string,
    credential: ComateCredential,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ code?: number; message?: string; data?: unknown }> {
    const response = await fetch(this.apiUrl(path), {
      method: 'POST',
      headers: comateHeaders(credential.license),
      body: JSON.stringify(payload),
      signal,
    })
    const text = await response.text()
    let body: { code?: number; message?: string; data?: unknown }
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      throw new LlmError(`comate: invalid JSON from ${path} (HTTP ${response.status})`, 'TRANSPORT')
    }
    if (!response.ok) {
      throw new LlmError(`comate: ${path} HTTP ${response.status}: ${body.message ?? text.slice(0, 200)}`, 'TRANSPORT')
    }
    if (body.code !== undefined && body.code !== 200) {
      const code = body.code === 401 ? 'MISSING_CREDENTIAL' : body.code === 429 ? 'QUOTA' : 'INVALID_REQUEST'
      throw new LlmError(`comate: ${body.message ?? `${path} failed`}`, code)
    }
    return body
  }

  private async createConversation(
    credential: ComateCredential,
    title: string,
    signal?: AbortSignal,
  ): Promise<CreatedConversation> {
    const clientInfo = comateClientInfo(credential.license)
    const conversation = await this.postJson(CONVERSATION_PATH, credential, {
      ...clientInfo,
      title: title.slice(0, 80) || 'Comate',
    }, signal)
    const conversationId = isRecord(conversation.data) && typeof conversation.data.id === 'number'
      ? conversation.data.id
      : undefined
    if (conversationId === undefined) {
      throw new LlmError('comate: conversation endpoint returned no id', 'INVALID_REQUEST')
    }
    const task = await this.postJson(TASK_PATH, credential, {
      ...clientInfo,
      conversationId,
      agentInfo: AGENT_INFO,
    }, signal)
    const taskId = isRecord(task.data) && typeof task.data.taskId === 'number'
      ? task.data.taskId
      : undefined
    if (taskId === undefined) {
      throw new LlmError('comate: task endpoint returned no taskId', 'INVALID_REQUEST')
    }
    return { conversationId, taskId }
  }

  private lookupConversation(
    key: string,
    fingerprints: readonly string[],
  ): ConversationState | undefined {
    const states = this.conversations.get(key)
    if (states === undefined || states.length === 0) return undefined
    const now = Date.now()
    const fresh = states.filter(state => now - state.updatedAt <= CONVERSATION_TTL_MS)
    if (fresh.length === 0) {
      this.conversations.delete(key)
      return undefined
    }
    if (fresh.length !== states.length) this.conversations.set(key, fresh)
    const candidates = fresh.filter(state =>
      fingerprints.length > state.seen.length
      && isPrefix(state.seen, fingerprints),
    )
    if (candidates.length === 0) return undefined
    // 前缀最长的那个最具体；两支候选同长时取最近使用的一支。
    return candidates.reduce((best, state) => {
      if (state.seen.length !== best.seen.length) {
        return state.seen.length > best.seen.length ? state : best
      }
      return state.updatedAt > best.updatedAt ? state : best
    })
  }

  private rememberConversation(
    key: string,
    state: ConversationState,
    previous?: ConversationState,
  ): void {
    const states = (this.conversations.get(key) ?? []).filter(item =>
      item.conversationId !== state.conversationId
      && item.conversationId !== previous?.conversationId,
    )
    states.push(state)
    // 每个首句最多留 8 支会话；超出时丢最久未用的。
    states.sort((left, right) => left.updatedAt - right.updatedAt)
    while (states.length > 8) states.shift()
    this.conversations.set(key, states)

    // 键总量上限：超过时丢掉全局最久未用的一支。
    if (this.conversations.size <= CONVERSATION_CACHE_MAX) return
    let oldestKey: string | undefined
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [candidateKey, candidateStates] of this.conversations) {
      const latest = candidateStates.reduce((max, candidate) => Math.max(max, candidate.updatedAt), 0)
      if (latest < oldestAt) {
        oldestAt = latest
        oldestKey = candidateKey
      }
    }
    if (oldestKey !== undefined && oldestKey !== key) this.conversations.delete(oldestKey)
  }

  private forgetConversation(key: string, conversationId: number): void {
    const states = this.conversations.get(key)
    if (states === undefined) return
    const remaining = states.filter(state => state.conversationId !== conversationId)
    if (remaining.length === 0) this.conversations.delete(key)
    else this.conversations.set(key, remaining)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const credential = await this.ensureCredential()

    // 已知是试用/免费套餐时，付费模型直接在本地拒绝：不把同一个必然失败的
    // 请求反复打到上游。Auto-Free 不受影响。
    const freeOnlyUntil = this.freeOnlyUntil.get(credential.license)
    if (freeOnlyUntil !== undefined && freeOnlyUntil <= Date.now()) {
      this.freeOnlyUntil.delete(credential.license)
    } else if (
      freeOnlyUntil !== undefined
      && options.model !== COMATE.freeModelId
    ) {
      throw new LlmError(
        `comate: 该账号是试用/免费套餐，只能使用 ${COMATE.freeModelId}（Auto-Free）；`
        + '请升级套餐或改用 Auto-Free 模型',
        'QUOTA_EXCEEDED',
        { status: 429 },
      )
    }

    const entry = (await this.loadModels()).find(model => model.id === options.model)
    const messages = normalizeHarnessMessages(options.messages as readonly HarnessMessageLike[])
    const fingerprints = messages.map(messageFingerprint)
    const key = conversationKey(options.system, messages)
    const lastUser = lastUserIndex(messages)
    const clientTools = (options.tools ?? []) as readonly ClientToolDefinition[]

    let state = this.lookupConversation(key, fingerprints)
    let isContinuation = false
    let continuationResults: ReturnType<typeof buildToolUseResults> = []

    if (state !== undefined && state.pending !== undefined) {
      const results = extractClientToolResults(messages)
      if (results.length > 0) {
        isContinuation = true
        continuationResults = buildToolUseResults(state.pending, results)
      } else {
        // 客户端没有带回 tool result（例如用户直接发了新问题）：旧会话仍停在
        // 工具调用上，继续复用会污染上下文，直接重建。
        this.forgetConversation(key, state.conversationId)
        state = undefined
      }
    } else if (state !== undefined && lastUser < state.seen.length) {
      // 没有新的用户轮次（重试/回滚历史）——新建会话，避免把同一轮再喂一遍。
      state = undefined
    }

    let isFirstQuery = false
    let query = ''

    if (state === undefined) {
      const title = lastUserText(messages) || firstUserText(messages) || 'Comate'
      const created = await this.createConversation(credential, title, options.signal)
      state = { ...created, seen: [], updatedAt: Date.now() }
      isFirstQuery = true
      query = renderWithSystem(options.system, messages)
    } else if (!isContinuation) {
      // 服务端会话已经记住了上一轮的 assistant 回复；这里只发最新的用户轮次，
      // 不要把客户端回显的 assistant 消息再喂回去。
      query = renderTranscript(messages.slice(lastUser))
    }

    if (!isContinuation && query.trim().length === 0) {
      throw new LlmError('comate: nothing to send (empty transcript)', 'INVALID_REQUEST')
    }

    const basePayload: Record<string, unknown> = {
      ...comateClientInfo(credential.license),
      conversationId: state.conversationId,
      taskId: state.taskId,
      modelKey: options.model,
      thinkingEnabled: options.reasoningEffort !== 'off',
      ...entry?.contextWindow !== undefined
        ? { contextWindow: Math.round(entry.contextWindow / 1024) }
        : {},
      contexts: [],
      subAgents: [],
      subAgentsChanged: false,
      agentInfo: AGENT_INFO,
      agentVersion: '',
      enableMemory: false,
      uploadBaseInfo: comateUploadBaseInfo(credential.license),
    }

    let payload: Record<string, unknown> = isContinuation
      ? {
          ...basePayload,
          query: '',
          isUserQuery: false,
          isFirstQuery: false,
          toolUseResults: continuationResults,
        }
      : {
          ...basePayload,
          query,
          isUserQuery: true,
          isFirstQuery,
          toolUseResults: [],
        }

    const streamState: StreamState = { nextIndex: 0, text: '', reasoning: '' }
    let unmappedRounds = 0

    try {
      for (;;) {
        const round = yield* this.consumeExecution(payload, credential, options, streamState)
        if (round.toolCalls.length === 0) {
          state.pending = undefined
          break
        }

        const pendingCalls: PendingToolCall[] = round.toolCalls.map(call => {
          const mapped = mapComateToolCall(call.name, call.input, clientTools)
          return {
            agentId: call.id,
            agentName: call.name,
            agentInput: call.input,
            clientId: call.id,
            clientName: mapped.name,
            clientArgs: mapped.arguments,
            mapped: mapped.mapped,
            noop: mapped.noop,
            ...mapped.failure !== undefined ? { failure: mapped.failure } : {},
          }
        })
        const mappedCalls = pendingCalls.filter(call => call.mapped)

        if (mappedCalls.length > 0) {
          // 把 agent 的工具调用翻译成客户端 tools；工具由客户端执行，结果在
          // 下一次请求里返回。网关只保存 pending 状态。
          for (const call of mappedCalls) {
            const index = streamState.nextIndex
            streamState.nextIndex += 1
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield {
              type: 'tool-call-delta',
              index,
              id: ToolCallId(call.clientId),
              name: call.clientName,
              argumentsDelta: call.clientArgs,
            }
            yield {
              type: 'block-end',
              index,
              block: {
                type: 'tool-call',
                id: ToolCallId(call.clientId),
                name: call.clientName,
                arguments: call.clientArgs,
              },
            }
          }
          state.pending = pendingCalls
          state.seen = fingerprints
          state.updatedAt = Date.now()
          this.rememberConversation(key, state, state)
          yield* this.finishResponse(streamState, 'tool-calls')
          return
        }

        // 所有工具都无法映射：把失败/no-op 结果直接回给 agent，继续同一轮。
        // 这里不涉及任何客户端执行，纯粹是让 agent 换一种工具继续。
        unmappedRounds += 1
        if (unmappedRounds > MAX_UNMAPPED_ROUNDS) {
          throw new LlmError(`comate: too many unmapped tool rounds (${MAX_UNMAPPED_ROUNDS})`, 'INVALID_REQUEST')
        }
        const results = buildToolUseResults(pendingCalls, [])
        payload = {
          ...basePayload,
          query: '',
          isUserQuery: false,
          isFirstQuery: false,
          toolUseResults: results,
        }
      }
    } catch (error) {
      this.forgetConversation(key, state.conversationId)
      throw error
    }

    // 付费模型真的成功出流，说明套餐已升级或额度已恢复：清掉免费套餐窗口。
    if (options.model !== COMATE.freeModelId) {
      this.freeOnlyUntil.delete(credential.license)
    } else {
      // Auto-Free 成功出流 = 免费额度此刻可用（面板据此显示“可用”）。
      recordComateFreeQuota(credential.license, 'available')
    }
    state.pending = undefined
    state.seen = fingerprints
    state.updatedAt = Date.now()
    this.rememberConversation(key, state, state)
    yield* this.finishResponse(streamState, 'stop')
  }

  /**
   * 发一轮 execute 并消费 SSE；返回本轮 agent 请求的工具调用。
   *
   * 工具调用不会在这里执行：mapped 的工具以 StreamChunk 交给客户端；
   * 无法映射的工具由 `stream` 直接回失败结果给 agent。`*_PARAMS_APPEND`
   * 的 input 是**增量字符串分片**，由 `mergeToolInput` 拼接；
   * `FUNCTION_CALL_END` 的 input 通常为空。
   */
  private async *consumeExecution(
    payload: Record<string, unknown>,
    credential: ComateCredential,
    options: GenerateOptions,
    state: StreamState,
  ): AsyncGenerator<StreamChunk, { toolCalls: AgentToolCall[] }, void> {
    const response = await fetch(this.apiUrl(EXECUTE_PATH), {
      method: 'POST',
      headers: comateHeaders(credential.license),
      body: JSON.stringify(payload),
      signal: options.signal,
    })

    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.includes('text/event-stream')) {
      const text = await response.text()
      let message = text.slice(0, 300)
      try {
        const body = JSON.parse(text) as { message?: unknown; code?: unknown }
        if (typeof body.message === 'string' && body.message.length > 0) {
          message = body.message
        }
      } catch {
        // 非 JSON 错误体：保留原文片段
      }
      const code = response.status === 401 ? 'MISSING_CREDENTIAL' : response.status === 429 ? 'QUOTA' : 'INVALID_REQUEST'
      throw new LlmError(`comate: execute failed (HTTP ${response.status}): ${message}`, code, {
        status: response.status,
      })
    }
    if (response.body === null) {
      throw new LlmError('comate: empty response body', 'EMPTY_RESPONSE')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const calls = new Map<string, AgentToolCall>()

    const applyToolUse = (detail: NonNullable<ComateFrame['content']>['detail']): void => {
      const toolUses = Array.isArray(detail?.toolUse)
        ? detail.toolUse as Array<{ id?: unknown; name?: unknown; input?: unknown }>
        : []
      for (const raw of toolUses) {
        if (!isRecord(raw)) continue
        const id = typeof raw.id === 'string' ? raw.id : ''
        const name = typeof raw.name === 'string' ? raw.name : ''
        if (id.length === 0) continue
        let call = calls.get(id)
        if (call === undefined) {
          call = { id, name, input: {} }
          calls.set(id, call)
        }
        if (name.length > 0) call.name = name
        if (typeof raw.input === 'string') {
          // apply_patch 的 input 可能是字符串（整段补丁）；其他工具按增量拼接。
          if (call.name === 'apply_patch') call.input.input = raw.input
          else if (typeof call.input.input === 'string') call.input.input += raw.input
          else call.input.input = raw.input
          continue
        }
        if (isRecord(raw.input)) mergeToolInput(call.input, raw.input, call.name === 'apply_patch')
      }
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '')
          buffer = buffer.slice(newline + 1)
          if (line.startsWith('data:')) {
            const raw = line.slice(5).trim()
            if (raw.length > 0) {
              try {
                const frame = JSON.parse(raw) as ComateFrame
                const content = frame.content
                const type = content?.type
                const detail = content?.detail
                if (type === 'ANSWER') {
                  const reasoningDelta = typeof detail?.reasoningDelta === 'string' ? detail.reasoningDelta : ''
                  if (reasoningDelta.length > 0) {
                    if (state.reasoningIndex === undefined) {
                      state.reasoningIndex = state.nextIndex
                      state.nextIndex += 1
                      yield { type: 'block-start', index: state.reasoningIndex, blockType: 'reasoning' }
                    }
                    state.reasoning += reasoningDelta
                    yield { type: 'reasoning-delta', index: state.reasoningIndex, text: reasoningDelta }
                  }
                  const delta = typeof detail?.delta === 'string' ? detail.delta : ''
                  if (delta.length > 0) {
                    if (state.textIndex === undefined) {
                      state.textIndex = state.nextIndex
                      state.nextIndex += 1
                      yield { type: 'block-start', index: state.textIndex, blockType: 'text' }
                    }
                    state.text += delta
                    yield { type: 'text-delta', index: state.textIndex, text: delta }
                  }
                } else if (type === 'TOKEN_USAGE' && detail?.usage !== undefined) {
                  const input = typeof detail.usage.inputTokens === 'number' ? detail.usage.inputTokens : 0
                  const cached = typeof detail.usage.cachedInputTokens === 'number' ? detail.usage.cachedInputTokens : 0
                  const output = typeof detail.usage.outputTokens === 'number' ? detail.usage.outputTokens : 0
                  const previous = state.usage ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
                  state.usage = {
                    inputTokens: previous.inputTokens + input,
                    cachedInputTokens: previous.cachedInputTokens + cached,
                    outputTokens: previous.outputTokens + output,
                  }
                } else if (type === 'QUOTA_EXCEED' || type === 'DOWNGRADE') {
                  const userType = typeof detail?.userType === 'string' ? detail.userType : ''
                  // TRIAL_INDIVIDUAL / FREE 等：本账号只能走免费模型。记一个窗口，
                  // 避免后续付费模型请求反复打上游。
                  if (/TRIAL|FREE/i.test(userType)) {
                    this.freeOnlyUntil.set(credential.license, Date.now() + FREE_ONLY_TTL_MS)
                  }
                  // Auto-Free 自己被限额，才是“免费额度已用尽”的证据；付费模型被拒
                  // 只说明套餐不含该模型，不代表免费额度不可用。
                  if (options.model === COMATE.freeModelId) {
                    recordComateFreeQuota(credential.license, 'limited', quotaMessage(detail))
                  }
                  throw new LlmError(quotaMessage(detail), 'QUOTA', { status: 429 })
                } else if (type === 'EXCEPTION' || type === 'NEED_RETRY_EXCEPTION') {
                  const message = typeof detail?.exceptionMsg === 'string' && detail.exceptionMsg.length > 0
                    ? detail.exceptionMsg
                    : 'agent execution failed'
                  throw new LlmError(`comate: ${message}`, 'INVALID_REQUEST')
                } else if (type !== undefined && (type.startsWith('FUNCTION_CALL') || type.startsWith('TOOL_CALL'))) {
                  applyToolUse(detail)
                }
              } catch (error) {
                if (error instanceof LlmError) throw error
                // 畸形帧（心跳/增量 JSON）跳过，不终止整段流。
              }
            }
          }
          newline = buffer.indexOf('\n')
        }
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }

    const toolCalls = [...calls.values()]
      .filter(call => call.name.length > 0)
      .map(call => ({ id: call.id, name: call.name, input: call.input }))
    return { toolCalls }
  }

  /** 收尾：关闭文本/推理块、发 usage，再发 finish。 */
  private *finishResponse(state: StreamState, reason: 'stop' | 'tool-calls'): Iterable<StreamChunk> {
    if (state.textIndex !== undefined) {
      yield { type: 'block-end', index: state.textIndex, block: { type: 'text', text: state.text } }
    }
    if (state.reasoningIndex !== undefined && state.reasoning.trim().length > 0) {
      yield { type: 'block-end', index: state.reasoningIndex, block: { type: 'reasoning', text: state.reasoning } }
    }
    if (
      reason === 'stop'
      && state.textIndex === undefined
      && (state.reasoningIndex === undefined || state.reasoning.trim().length === 0)
    ) {
      throw new LlmError('comate: agent returned no content', 'EMPTY_RESPONSE')
    }
    if (state.usage !== undefined) {
      const input = state.usage.cachedInputTokens > 0
        ? Math.max(0, state.usage.inputTokens - state.usage.cachedInputTokens)
        : state.usage.inputTokens
      yield {
        type: 'usage',
        usage: {
          inputTokens: input,
          outputTokens: state.usage.outputTokens,
          ...state.usage.cachedInputTokens > 0 ? { cacheReadTokens: state.usage.cachedInputTokens } : {},
        },
      }
    }
    // StreamChunk 的 finish.reason 是 `{kind}` 对象，不是字符串；发字符串会让
    // 渠道包投影读不到 finishReason，最终以 `incomplete_stream` 收场（Qoder
    // 显示 “upstream stream ended before finish”）。
    yield { type: 'finish', reason: { kind: reason } }
  }

}

export function registerComateLlm(ctx: Context, options: ComateAdapterOptions): ComateAdapter {
  const adapter = new ComateAdapter(options)
  registerAdapterIdempotent(ctx.llm, [PROVIDER], adapter)
  return adapter
}
