/**
 * 上游 token 用量的读取与估算。
 *
 * 对客户端的响应体永不改动：本模块只负责「读到一个数」，估算值只用于本地账本，
 * 并始终带着 `source`，免得把估算消耗当成上游报的真值。
 */

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /**
   * 上游自己报的**缓存命中**输入 token（`prompt_tokens_details.cached_tokens`，
   * 部分实现写作 `prompt_cache_hit_tokens`）。它是 `prompt_tokens` 的子集。
   *
   * ⚠️ **上游没报就整个字段缺省**，绝不写 0：`0` 是一个断言（"这轮没有命中"），
   * 缺省才是事实（"这轮上游没告诉我们"）。绝大多数渠道不报 usage，也就都不报
   * 命中 —— 把它们统计成 0 会让仪表盘说"缓存完全没用上"，而那我们没有证据。
   */
  cacheReadTokens?: number
  /**
   * Whether the upstream supplied a cache field at all, **including an
   * explicit 0**. `cacheReadTokens` is omitted when the value is 0, so without
   * this flag a reader cannot tell "0 hits" from "no figure reported" — and a
   * per-model hit rate built on that ambiguity would report 0% for providers
   * that simply never report caching.
   */
  cacheReadReported?: boolean
}

export interface UsageReading extends TokenUsage {
  /** upstream = 上游自己报的；estimated = 按字符数折的，只能进账本 */
  source: 'upstream' | 'estimated'
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

/** 非流式响应体里的 `usage`。三项全缺或总数不可信时返回 null，绝不补 0。 */
export function readUsageFromBody(body: unknown): TokenUsage | null {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage
  if (!usage || typeof usage !== 'object') return null

  const prompt = nonNegativeInt(usage.prompt_tokens)
  const completion = nonNegativeInt(usage.completion_tokens)
  const total = nonNegativeInt(usage.total_tokens)

  if (prompt === null && completion === null && total === null) return null
  if (prompt === 0 && completion === 0 && (total === null || total === 0)) return null

  const promptTokens = prompt ?? 0
  const completionTokens = completion ?? 0
  // 缓存命中的来源写法不统一（OpenAI 用 details，部分网关平铺一个
  // `prompt_cache_hit_tokens`）。两个都读，但只在**真是正数**时才落字段。
  const details = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>
  const cached = nonNegativeInt(details.cached_tokens) ?? nonNegativeInt(usage.prompt_cache_hit_tokens)
  return {
    promptTokens,
    completionTokens,
    totalTokens: total ?? promptTokens + completionTokens,
    ...(cached !== null && cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(cached !== null ? { cacheReadReported: true } : {}),
  }
}

/**
 * 从已经汇聚好的原始 SSE 文本里取最后一个带 usage 的 chunk。
 * 上游把 usage 放在 `[DONE]` 前的最后一个 chunk，倒着找最先命中的就是它。
 */
export function readUsageFromSse(raw: string): TokenUsage | null {
  const lines = raw.split('\n')

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith('data:')) continue

    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }

    const usage = readUsageFromBody(parsed)
    if (usage) return usage
  }

  return null
}

/** 账本内部用驼峰，出网必须回到 OpenAI 的 snake_case 形状。 */
export function toWireUsage(usage: TokenUsage): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
} {
  return {
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
  }
}

/** 约 4 字符一 token：只在两处上游都没报数时用于本地计量，标注始终为 estimated。 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * 从原始 SSE 文本里抽出**模型真正写出来的字符**。
 *
 * ## 这条函数为什么必须存在（实测到的严重失真）
 *
 * 估算路径过去直接吃**原始 SSE**：`collectedContent` 是逐字节累积的响应流，
 * 于是每个 1-token 增量都连帧壳一起计价 ——
 * `data: {"id":…,"object":"chat.completion.chunk","created":…,"model":…,"choices":[{"index":0,"delta":{"content":"X"}}]}`
 * 约 150–260 字符换 1 个 token，即 **output 虚高 40–65 倍**。实测：TRAE 的
 * `deepseek-v4.1-flash`（我们上报的窗口只有 200K）在账本里平均
 * **503,769 token/请求** —— 物理上不可能，只能是这个口径造出来的。
 *
 * 被这个假数污染的不只是仪表盘：`smart` / `pace` 两个负载均衡策略读的就是同
 * 一份账本（`quota/ledger.ts`），于是它们按一个虚高 40 倍的"消耗"排序。
 *
 * ## 三条口径
 *
 * 1. **只取模型输出的内容**：`delta.content` + 思考文本 + 工具调用的
 *    `name`/`arguments`。工具参数是真实 output token，漏了会**低估** output；
 * 2. **不像 SSE 就原样返回**：非流式路径传进来的已经是纯正文，剥它没有意义，
 *    而对一个不含 `data:` 行的字符串返回 `''` 会把 output 直接抹成 0；
 * 3. **像 SSE 但抽不出内容时返回 `''`**（例如只有错误帧/只有 usage 帧）——
 *    那就是"模型没写正文"，估算成 0 是对的，帧壳不是它的 output。
 */
export function sseDeltaText(raw: string): string {
  if (!raw) return ''
  const lines = raw.split('\n')
  let sawDataFrame = false
  let out = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    sawDataFrame = true
    const payload = trimmed.slice(5).trim()
    if (payload.length === 0 || payload === '[DONE]') continue
    let parsed: { choices?: unknown }
    try {
      parsed = JSON.parse(payload) as { choices?: unknown }
    } catch {
      continue // 半截帧：跳过，不影响后面的完整帧
    }
    const choices = Array.isArray(parsed.choices) ? parsed.choices : []
    for (const item of choices) {
      const choice = item as {
        delta?: Record<string, unknown>
        message?: Record<string, unknown>
      }
      const part = (choice.delta ?? choice.message) as
        | { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown }
        | undefined
      if (!part || typeof part !== 'object') continue
      if (typeof part.content === 'string') out += part.content
      if (typeof part.reasoning_content === 'string') out += part.reasoning_content
      const calls = Array.isArray(part.tool_calls) ? part.tool_calls : []
      for (const call of calls) {
        const fn = (call as { function?: Record<string, unknown> })?.function
        if (typeof fn?.arguments === 'string') out += fn.arguments
        if (typeof fn?.name === 'string') out += fn.name
      }
    }
  }
  return sawDataFrame ? out : raw
}

/**
 * 估算用的**输入**文本：`messages` + `system` + **`tools`**。
 *
 * ⚠️ 旧写法是 `JSON.stringify(request.messages ?? [])`，**漏掉工具 schema**。
 * 走 DSH / Codex 这类 agent 客户端时 tools 往往就是 input 里最大的一块（几十个
 * 函数的 JSON Schema），漏它会让"每轮重放的代价"看起来比实际小得多 —— 而那个
 * 数字正是判断该不该做上下文压缩的依据，低估它等于把决策依据也一起弄错了。
 */
export function usageInputText(request: {
  messages?: unknown
  tools?: unknown
  system?: unknown
}): string {
  const parts: string[] = []
  if (request.messages !== undefined) parts.push(JSON.stringify(request.messages))
  if (request.system !== undefined) parts.push(JSON.stringify(request.system))
  if (request.tools !== undefined) parts.push(JSON.stringify(request.tools))
  return parts.join('')
}

/**
 * 账本用的唯一入口：有真值用真值，否则按输入+输出字符估算。
 * `estimated` 永远不会被写成 `upstream`。
 *
 * ⚠️ 两个参数都是**原始文本**（input 请用 {@link usageInputText} 组装），
 * output 在这里过一遍 {@link sseDeltaText}：调用方拿到的是原始 SSE，剥壳必须
 * 发生在本模块内，否则每个调用点都会各自决定"要不要剥"，而忘记的那个就是 40 倍。
 */
export function readOrEstimateUsage(inputText: string, outputText: string, body?: unknown): UsageReading {
  const upstream = readUsageFromBody(body) ?? readUsageFromSse(outputText)
  if (upstream) return { ...upstream, source: 'upstream' }

  const promptTokens = estimateTokens(inputText)
  const completionTokens = estimateTokens(sseDeltaText(outputText))
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    source: 'estimated',
  }
}
