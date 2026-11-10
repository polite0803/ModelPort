import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
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

interface ConversationState {
  conversationId: number
  taskId: number
  /** 已经成功下发过的消息指纹；下一轮据此只发增量。 */
  seen: string[]
  updatedAt: number
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
    lastUser: number,
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
      && lastUser >= state.seen.length
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

    // 本渠道不实现客户端工具调用：agent 会自己尝试服务端工具，客户端给的
    // tools 无法执行。带工具的请求必须显式失败，不能假装已经调用。
    if (options.tools !== undefined && options.tools.length > 0) {
      throw new LlmError(
        'comate: this channel does not support client tool calling; use a tools-capable channel',
        'INVALID_REQUEST',
      )
    }

    const entry = (await this.loadModels()).find(model => model.id === options.model)
    const messages = normalizeHarnessMessages(options.messages as readonly HarnessMessageLike[])
    const fingerprints = messages.map(messageFingerprint)
    const key = conversationKey(options.system, messages)
    const lastUser = lastUserIndex(messages)

    let state = this.lookupConversation(key, fingerprints, lastUser)
    if (state !== undefined && lastUser < state.seen.length) {
      // 没有新的用户轮次（客户端重试/回滚历史）——新建会话，避免把同一轮再喂一遍。
      // 不删旧缓存：同键的其它会话可能仍在用。
      state = undefined
    }
    let isFirstQuery = false
    let query: string

    if (state === undefined) {
      const title = lastUserText(messages) || firstUserText(messages) || 'Comate'
      const created = await this.createConversation(credential, title, options.signal)
      state = { ...created, seen: [], updatedAt: Date.now() }
      isFirstQuery = true
      query = renderWithSystem(options.system, messages)
    } else {
      // 服务端会话已经记住了上一轮的 assistant 回复；这里只发最新的用户轮次，
      // 不要把客户端回显的 assistant 消息再喂回去。
      query = renderTranscript(messages.slice(lastUser))
    }

    if (query.trim().length === 0) {
      throw new LlmError('comate: nothing to send (empty transcript)', 'INVALID_REQUEST')
    }

    const payload: Record<string, unknown> = {
      ...comateClientInfo(credential.license),
      conversationId: state.conversationId,
      taskId: state.taskId,
      query,
      modelKey: options.model,
      thinkingEnabled: options.reasoningEffort !== 'off',
      ...entry?.contextWindow !== undefined
        ? { contextWindow: Math.round(entry.contextWindow / 1024) }
        : {},
      isUserQuery: true,
      isFirstQuery,
      contexts: [],
      subAgents: [],
      subAgentsChanged: false,
      toolUseResults: [],
      agentInfo: AGENT_INFO,
      agentVersion: '',
      enableMemory: false,
      uploadBaseInfo: comateUploadBaseInfo(credential.license),
    }

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
    let nextIndex = 0
    let textIndex: number | undefined
    let reasoningIndex: number | undefined
    let text = ''
    let reasoning = ''
    let usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number } | undefined

    const handleFrame = (frame: ComateFrame): StreamChunk[] => {
      const chunks: StreamChunk[] = []
      const content = frame.content
      if (content === undefined) return chunks
      const type = content.type
      const detail = content.detail
      if (type === 'ANSWER') {
        const reasoningDelta = typeof detail?.reasoningDelta === 'string' ? detail.reasoningDelta : ''
        if (reasoningDelta.length > 0) {
          if (reasoningIndex === undefined) {
            reasoningIndex = nextIndex
            nextIndex += 1
            chunks.push({ type: 'block-start', index: reasoningIndex, blockType: 'reasoning' })
          }
          reasoning += reasoningDelta
          chunks.push({ type: 'reasoning-delta', index: reasoningIndex, text: reasoningDelta })
        }
        const delta = typeof detail?.delta === 'string' ? detail.delta : ''
        if (delta.length > 0) {
          if (textIndex === undefined) {
            textIndex = nextIndex
            nextIndex += 1
            chunks.push({ type: 'block-start', index: textIndex, blockType: 'text' })
          }
          text += delta
          chunks.push({ type: 'text-delta', index: textIndex, text: delta })
        }
        return chunks
      }
      if (type === 'TOKEN_USAGE' && detail?.usage !== undefined) {
        const input = typeof detail.usage.inputTokens === 'number' ? detail.usage.inputTokens : 0
        const cached = typeof detail.usage.cachedInputTokens === 'number' ? detail.usage.cachedInputTokens : 0
        const output = typeof detail.usage.outputTokens === 'number' ? detail.usage.outputTokens : 0
        usage = { inputTokens: input, cachedInputTokens: cached, outputTokens: output }
        return chunks
      }
      if (type === 'QUOTA_EXCEED' || type === 'DOWNGRADE') {
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
      }
      if (type === 'EXCEPTION' || type === 'NEED_RETRY_EXCEPTION') {
        const message = typeof detail?.exceptionMsg === 'string' && detail.exceptionMsg.length > 0
          ? detail.exceptionMsg
          : 'agent execution failed'
        throw new LlmError(`comate: ${message}`, 'INVALID_REQUEST')
      }
      if (type === 'TOOL_CALL' || type === 'TOOL_CALL_END' || type === 'FUNCTION_CALL_END' || detail?.toolUse !== undefined) {
        throw new LlmError(
          'comate: the agent requested a tool call, but this channel cannot execute client tools',
          'INVALID_REQUEST',
        )
      }
      return chunks
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
                for (const chunk of handleFrame(frame)) yield chunk
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
      this.forgetConversation(key, state.conversationId)
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }

    if (textIndex !== undefined) {
      yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }
    }
    if (reasoningIndex !== undefined && reasoning.trim().length > 0) {
      yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
    }
    if (textIndex === undefined && (reasoningIndex === undefined || reasoning.trim().length === 0)) {
      throw new LlmError('comate: agent returned no content', 'EMPTY_RESPONSE')
    }
    if (usage !== undefined) {
      const input = usage.cachedInputTokens > 0
        ? Math.max(0, usage.inputTokens - usage.cachedInputTokens)
        : usage.inputTokens
      yield {
        type: 'usage',
        usage: {
          inputTokens: input,
          outputTokens: usage.outputTokens,
          ...usage.cachedInputTokens > 0 ? { cacheReadTokens: usage.cachedInputTokens } : {},
        },
      }
    }
    // 付费模型真的成功出流，说明套餐已升级或额度已恢复：清掉免费套餐窗口。
    if (options.model !== COMATE.freeModelId) {
      this.freeOnlyUntil.delete(credential.license)
    } else {
      // Auto-Free 成功出流 = 免费额度此刻可用（面板据此显示“可用”）。
      recordComateFreeQuota(credential.license, 'available')
    }
    this.rememberConversation(key, {
      conversationId: state.conversationId,
      taskId: state.taskId,
      seen: fingerprints,
      updatedAt: Date.now(),
    }, state)
    yield { type: 'finish', reason: 'stop' }
  }
}

export function registerComateLlm(ctx: Context, options: ComateAdapterOptions): ComateAdapter {
  const adapter = new ComateAdapter(options)
  registerAdapterIdempotent(ctx.llm, [PROVIDER], adapter)
  return adapter
}
