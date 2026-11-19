/**
 * Proxy Service Module - Type Definitions
 * Defines core data structures for proxy service
 */

import type { RequestAttemptTrace } from '../../shared/types'

/**
 * OpenAI Message Format
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatMessageContent[] | null
  name?: string
  tool_call_id?: string
  tool_calls?: ChatCompletionMessageToolCall[]
}

/**
 * Tool Call in Message
 */
export interface ChatCompletionMessageToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * Tool Definition for Function Calling (OpenAI compatible)
 */
export interface ChatCompletionTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, any>
  }
}

/**
 * Tool Choice Strategy
 */
export type ChatCompletionToolChoice = 'none' | 'auto' | 'required' | {
  type: 'function'
  function: { name: string }
}

/**
 * Message Content (supports multimodal)
 */
export interface ChatMessageContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
    detail?: 'auto' | 'low' | 'high'
  }
}

/**
 * Chat Completions Request
 */
export interface ChatCompletionRequest {
  model: string
  /** Internal correlation id assigned by the proxy (never forwarded upstream) */
  requestId?: string
  /** Aborted when the client disconnects, so long upstream turns can stop early */
  signal?: AbortSignal
  /**
   * 这一次尝试在宿主侧的最长等待（毫秒），由换家循环按**剩余墙钟预算**收紧。
   *
   * 为什么必须是它而不是 `request.signal`：`signal` 表达的是「客户端走了」，
   * 而墙钟预算要表达的是「这家不能再占了整条链的时间」。`AUTO_WALL_CLOCK_BUDGET_MS`
   * 原先只在尝试**之间**检查，一笔永不返回的渠道请求（实测 525s）会让预算永远
   * 等不到检查点 —— 预算要生效，必须传到单次等待里。未给 = 用出厂计划值。
   */
  attemptDeadlineMs?: number
  /** Original model name before mapping (used for feature detection like web search, thinking mode) */
  originalModel?: string
  messages: ChatMessage[]
  temperature?: number
  top_p?: number
  n?: number
  stream?: boolean
  stop?: string | string[]
  max_tokens?: number
  /**
   * Codex 系客户端（DSH、Codex CLI）唯一的输出上限写法，`max_tokens` 是被废弃的旧名。
   * 入口由 `normalizeOutputCap` 折进 `max_tokens`，下游只读那一个字段。
   */
  max_completion_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
  logit_bias?: Record<string, number>
  user?: string
  /** Enable web search (OpenAI compatible) */
  web_search?: boolean
  /** Web search options (OpenAI compatible) */
  web_search_options?: {
    search_context_size?: 'low' | 'medium' | 'high'
    user_location?: {
      type: 'approximate'
      approximate?: {
        country?: string
        city?: string
        region?: string
      }
    }
  }
  /** Reasoning effort level (OpenAI compatible) - enables thinking mode */
  reasoning_effort?: 'low' | 'medium' | 'high'
  /** Reasoning effort level (camelCase, for AI SDK compatibility) */
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** OpenAI 兼容的可选参数：白名单以前会把它们静默丢掉，这里显式承载。 */
  logprobs?: boolean
  top_logprobs?: number
  prediction?: unknown
  modalities?: string[]
  audio?: unknown
  service_tier?: string
  /** Responses/OpenRouter 风格的嵌套 reasoning 配置（与 reasoning_effort 并存）。 */
  reasoning?: unknown
  /** 部分 OpenAI 兼容上游（以及 Anthropic wire）接受的 top_k。 */
  top_k?: number
  /** Enable deep research mode (GLM specific) */
  deep_research?: boolean
  /** Tools for function calling */
  tools?: ChatCompletionTool[]
  /** Tool choice strategy */
  tool_choice?: ChatCompletionToolChoice
  /** When false the proxy keeps at most one tool call per response */
  parallel_tool_calls?: boolean
  /** Tool format - determines response format for tool calls */
  tool_format?: 'native' | 'json' | 'auto'
}

/**
 * Tool Definition for Function Calling
 */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters?: {
      type: 'object'
      properties: Record<string, {
        type: string
        description?: string
        enum?: string[]
      }>
      required?: string[]
    }
  }
}

/**
 * Chat Completions Response
 */
export interface ChatCompletionResponse {
  id: string
  object: 'chat.completion' | 'chat.completion.chunk'
  created: number
  model: string
  choices: ChatCompletionChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  } | null
}

/**
 * Chat Completions Choice
 */
export interface ChatCompletionChoice {
  index: number
  message?: {
    role: 'assistant'
    content: string | null
    reasoning_content?: string
    tool_calls?: ToolCall[]
  }
  delta?: {
    role?: 'assistant'
    content?: string
    reasoning_content?: string
    tool_calls?: ToolCall[]
  }
  finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null
}

/**
 * Tool Call in Response
 */
export interface ToolCall {
  index?: number
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
  /** Raw matched text, stripped before the call is emitted downstream */
  rawText?: string
}

/**
 * Model Information
 */
export interface ModelInfo {
  id: string
  object: 'model'
  created: number
  owned_by: string
  /**
   * 上游声明的上下文窗口。**没把握就整个键省略**，绝不发 0 或猜一个值。
   *
   * 为什么要发：Codex / DSH 这类客户端用它决定「什么时候该压缩」。没有这个字段时
   * 它们退回**自己的默认窗口**，而我们既不知道那个值、也无法解释「为什么它一直
   * 提前压缩 / 一直不压缩」。渠道 Worker 的网关本来就在发 `context_window`，此前
   * 是 ModelPort 自己重建清单时把它丢了。
   */
  context_window?: number
  permission?: ModelPermission[]
  root?: string
  parent?: string
}

/**
 * Model Permission
 */
export interface ModelPermission {
  id: string
  object: 'model_permission'
  created: number
  allow_create_engine: boolean
  allow_sampling: boolean
  allow_logprobs: boolean
  allow_search_indices: boolean
  allow_view: boolean
  allow_fine_tuning: boolean
  organization: string
  group: string
  is_blocking: boolean
}

/**
 * Models List Response
 */
export interface ModelsResponse {
  object: 'list'
  data: ModelInfo[]
}

/**
 * Proxy Request Context
 */
export interface ProxyContext {
  requestId: string
  providerId?: string
  accountId?: string
  model: string
  actualModel?: string
  startTime: number
  isStream: boolean
  clientIP?: string
  /** 入站客户端的 User-Agent 原值：聚合线出站转发它，让形状与客户端直连一致（见 utils/clientShape.ts）。 */
  clientUserAgent?: string
}

/**
 * 上游错误的结构化字段。
 *
 * 为什么不能只留 `error: string`：OpenAI/Claude 的错误体里 `code`、`param`、`type`
 * 是客户端做处置的机读依据（例如区分「凭据失效」与「参数写错」）。旧实现把整份
 * 错误体压成一句话，路由层再按状态码重建信封，`param/code` 恒为 null —— 上游说
 * 得再具体，客户端也只能看到一句通用文案。
 */
export interface UpstreamErrorDetails {
  message: string
  type?: string
  param?: string | null
  code?: string | number | null
  metadata?: unknown
}

/**
 * Request Forward Result
 */
export interface ForwardResult {
  success: boolean
  status?: number
  headers?: Record<string, string>
  /** Decoded upstream JSON. `unknown` on purpose: each reader narrows the fields it uses. */
  body?: unknown
  stream?: NodeJS.ReadableStream
  skipTransform?: boolean
  error?: string
  /** 上游错误体里的机读字段；`error` 仍是给人读的兜底文案。 */
  errorDetails?: UpstreamErrorDetails
  /** 上游错误体原文（已截断）；只进日志与诊断，不直接回给客户端。 */
  errorBody?: string
  /** 上游给的 `Retry-After`，由路由原样透传。 */
  retryAfter?: string
  /** Upstream request id exposed by the provider, if any. */
  upstreamRequestId?: string
  /** Every same-target attempt made for this forward (including retries). */
  attempts?: RequestAttemptTrace[]
  /** Rejected locally by the per-model concurrency gate; no upstream call was made. */
  localAdmissionRejected?: boolean
  latency?: number
  providerSessionId?: string
  parentMessageId?: string
  /**
   * The provider answered with headers first and finishes the body later
   * (OpenCode's agent turn takes 30-60s). The request's latency is then the
   * total time measured when the stream ends, not the time to first byte.
   */
  deferred?: boolean
}

/**
 * Account Selection Result
 */
export interface AccountSelection {
  account: import('../store/types').Account
  provider: import('../store/types').Provider
  actualModel: string
}

/**
 * SSE Event
 */
export interface SSEEvent {
  event?: string
  data: string
  id?: string
  retry?: number
}

/**
 * Proxy Statistics
 */
export interface ProxyStatistics {
  totalRequests: number
  successRequests: number
  failedRequests: number
  avgLatency: number
  requestsPerMinute: number
  activeConnections: number
  modelUsage: Record<string, number>
  providerUsage: Record<string, number>
  accountUsage: Record<string, number>
}

/**
 * Proxy Configuration
 */
export interface ProxyConfig {
  port: number
  host: string
  timeout: number
  retryCount: number
  retryDelay: number
  maxConnections: number
  enableCors: boolean
  corsOrigin: string | string[]
}
