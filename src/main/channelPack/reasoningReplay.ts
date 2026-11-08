/**
 * 把「我们下行发过的思考」在下一轮补回客户端历史。
 *
 * ## 为什么需要（2026-10-30 实测）
 *
 * DeepSeek 系上游（qodercn/DeepSeek-Flash、raccoon/sn-deepseek-v4-1-flash）要求
 * **带 `tool_calls` 的 assistant 历史消息必须把当时的 `reasoning_content` 一并回传**
 * （见 `vendor/channel-pack/src/openai-gateway/messages.ts` 里 reasoning 那段注释）。
 *
 * 实测客户端**不会**回传：对同一次 274 轮的抓样统计，`trae/deepseek-v4.1-flash`
 * 的 274 个「带 tool_calls 的 assistant 轮」里 **253 个缺 reasoning_content（92%）**，
 * 而 `loomy/GLM-5.3-Flash` 41 轮只缺 4 个（10%）。后果是整段对话在 DeepSeek 系上
 * 失败并回一句笼统的 `assistant.tool_calls contains an invalid function call`。
 *
 * 修在代理侧的理由：客户端不归我们管，而上游要求是明确的 —— JD 的两次会话双方
 * 都要求"思考与工具调用成对"，而**我们手里恰好有那份思考**：它是我们自己发出去的。
 *
 * ## 为什么观测"我们下行发出的"而不是"上游给的"
 *
 * 上游表达思考有两种形态：独立字段（`delta.reasoning_content`）与**写进正文的
 * inline 标签**（`<think>…</think>`，由 `sse.ts::splitThinkTaggedContent` 归位）。
 * 若按上游形态做缓存，就得在每条适配器里分叉实现；而**下行**只有一个出口
 * （`openai-gateway/stream.ts` 组装的 OpenAI 形状），那里两种形态已经合成
 * `reasoning_content` 了。观测下行 ⇒ 一次覆盖全部渠道。
 *
 * ## 为什么要按 `tool_call.id` 做键
 *
 * 客户端回放历史时会原样带回我们下发的 `tool_calls`（含 `id`，形如
 * `call_<requestId>-<n>`），所以 id 是**双方唯一共享的稳定锚点**。内容/文本都
 * 可能被客户端改写（压缩、裁剪、重排），不能当键。
 *
 * ## 有界性（关键）
 *
 * 这是一个**跨请求**状态，无界就是内存泄漏、就是变相会话表。所以：
 * 固定容量 + 最旧先淘汰（`REPLAY_MAX_IDS`，默认 4096 个 id）；
 * 空思考**不入缓存**（真无思考轮本来就不要求成对，也避免把空串当成"已补齐"）。
 *
 * ⚠️ 本模块只做"补"不做"改"：客户端已经回传 reasoning 的消息**一个字节都不动**。
 *
 * 2026-11-08：聚合线路（`proxy/reasoningEcho.ts`）接上了同一份缓存。渠道包这边只
 * 覆盖 `type: 'account'` 的渠道；客户端直连聚合 `deepseek`（api.deepseek.com）时走
 * 的是 `forwarder.ts` 的通用 openai-chat 分支，此前从来没有回灌过 —— 实测 400
 * `The reasoning_content in the thinking mode must be passed back to the API.`
 */
export interface ReplayLogger {
  debug?: (message: string) => void
}

/** 缓存容量（按 id 计数）。超出按插入顺序淘汰最旧的。 */
export const REPLAY_MAX_IDS = 4096

/**
 * 总开关：`DSH_REASONING_REPLAY=0` 关闭回放，其它任何值（含未设置）都启用。
 *
 * 与仓库其它开关同口径（默认开、只有字面 `0` 关）。**默认开**是因为它修的是
 * 一个确定性失败：DeepSeek 系上游拒收「带 tool_calls 却缺 reasoning_content」的
 * 历史，而客户端不回传（实测 92%），不补就是整段对话报废。
 *
 * **什么时候该关掉它**：回放等于替客户端改写入站历史。若上游开始校验「思考必须与
 * 该会话本轮真实产出一致」（我们缓存的是我们自己发出去的原文，正常情况就是一致的，
 * 但跨实例重启后缓存为空、客户端仍缺字段时就是真缺），这种更严的校验会让补回
 * 变成新的失败源 —— 那时把开关置 0，回到「如实转发客户端历史」的旧行为。
 */
export function reasoningReplayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DSH_REASONING_REPLAY !== '0'
}

/** 一次下行响应里累积到的思考与工具调用 id。 */
interface PendingTurn {
  reasoning: string
  ids: string[]
}

export class ReasoningReplay {
  /**
   * id → 思考文本（Map 的插入顺序即淘汰顺序）。
   *
   * 可由多个实例共享（见 {@link ReasoningReplayCache}）：缓存本身是跨请求的，
   * 而 `pending` 必须是一次响应独有 —— 同一个对象既当缓存又当累积器时，两个
   * 并发请求的增量会混在一起，把 A 的思考挂到 B 的 `tool_call.id` 上。
   */
  private readonly byId: Map<string, string>
  private pending: PendingTurn = { reasoning: '', ids: [] }
  private readonly maxIds: number

  constructor(maxIds: number = REPLAY_MAX_IDS, sharedById?: Map<string, string>) {
    this.maxIds = maxIds > 0 ? maxIds : REPLAY_MAX_IDS
    this.byId = sharedById ?? new Map<string, string>()
  }

  /** 开始一轮新响应：清空未提交的累积。 */
  begin(): void {
    this.pending = { reasoning: '', ids: [] }
  }

  /**
   * 观测一段 **SSE 文本**（`toOpenAiSse` 的输出）。
   *
   * 只对含 `reasoning_content` 或 `tool_calls` 的 `data:` 行做 `JSON.parse` ——
   * 普通正文帧用 `indexOf` 预筛后直接跳过，不为观测付全量解析的代价。
   */
  observeSseChunk(text: string): void {
    if (text.length === 0) return
    const lines = text.split('\n')
    for (const line of lines) {
      const trimmed = line.trimStart()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload.length === 0 || payload === '[DONE]') continue
      // 预筛：绝大多数帧只是 content 增量，既无思考也无工具调用。
      if (payload.indexOf('reasoning_content') < 0 && payload.indexOf('tool_calls') < 0) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        // 半帧/非 JSON 帧不是错误（可能是上游注释行），跳过。
        continue
      }
      this.absorbRecord(parsed)
    }
  }

  /** 观测一次**非流式**响应体（`collectOpenAiCompletion` 的输出）。 */
  observeCompletion(body: unknown): void {
    this.absorbRecord(body)
  }

  /** 把本轮累积提交进缓存。没有工具调用或没有思考时不提交。 */
  commit(): void {
    const reasoning = this.pending.reasoning.trim()
    const ids = this.pending.ids
    if (ids.length === 0 || reasoning.length === 0) {
      this.begin()
      return
    }
    for (const id of ids) {
      // 已知 id 重复提交时刷新到最新（同一 id 理论上不会重复，但重试会）。
      this.byId.delete(id)
      this.byId.set(id, reasoning)
    }
    this.trim()
    this.begin()
  }

  /** 缓存里的 id 数量（诊断用）。 */
  size(): number {
    return this.byId.size
  }

  /**
   * 补回：返回**新数组**（不改入参），只在"带 tool_calls 且缺 reasoning"的
   * assistant 轮上做插入。
   *
   * 判据与 `countToolCallShapes` 的 `missingReasoning` 完全一致，所以补过之后
   * 影子诊断的缺失计数应当归零 —— 这是本次修复的验收口径。
   */
  recover(messages: unknown): { messages: unknown; injected: number } {
    if (!Array.isArray(messages)) return { messages, injected: 0 }
    let injected = 0
    const next = messages.map(message => {
      if (message === null || typeof message !== 'object') return message
      const record = message as { role?: unknown; reasoning_content?: unknown; tool_calls?: unknown }
      if (record.role !== 'assistant' || !Array.isArray(record.tool_calls)) return message
      const existing = record.reasoning_content
      if (typeof existing === 'string' && existing.length > 0) return message
      const reasoning = this.lookup(record.tool_calls)
      if (reasoning === undefined) return message
      injected += 1
      return { ...record, reasoning_content: reasoning }
    })
    return { messages: next, injected }
  }

  private lookup(toolCalls: readonly unknown[]): string | undefined {
    for (const call of toolCalls) {
      const id = (call as { id?: unknown } | null)?.id
      if (typeof id !== 'string' || id.length === 0) continue
      const hit = this.byId.get(id)
      if (hit !== undefined) return hit
    }
    return undefined
  }

  private absorbRecord(value: unknown): void {
    if (value === null || typeof value !== 'object') return
    const choices = (value as { choices?: unknown }).choices
    if (!Array.isArray(choices) || choices.length === 0) return
    const choice = choices[0] as { delta?: unknown; message?: unknown } | null
    if (choice === null || typeof choice !== 'object') return
    const payload = (choice.delta ?? choice.message) as
      | { reasoning_content?: unknown; reasoning?: unknown; tool_calls?: unknown }
      | undefined
    if (payload === undefined || payload === null || typeof payload !== 'object') return

    // 思考：两种拼写都认（与 `messages.ts::inboundReasoning` 同口径）。
    const reasoning = typeof payload.reasoning_content === 'string'
      ? payload.reasoning_content
      : typeof payload.reasoning === 'string' ? payload.reasoning : undefined
    if (reasoning !== undefined) this.pending.reasoning += reasoning

    const toolCalls = payload.tool_calls
    if (!Array.isArray(toolCalls)) return
    for (const call of toolCalls) {
      const id = (call as { id?: unknown } | null)?.id
      if (typeof id === 'string' && id.length > 0 && !this.pending.ids.includes(id)) {
        this.pending.ids.push(id)
      }
    }
  }

  private trim(): void {
    while (this.byId.size > this.maxIds) {
      const oldest = this.byId.keys().next()
      if (oldest.done === true) break
      this.byId.delete(oldest.value)
    }
  }
}

/**
 * 一个进程内共享的思考缓存。
 *
 * 用法：观测（每个响应一个 `createReplay()`）与回灌（`recover`）都指向同一份 id 表。
 * 单独持有缓存而不是复用一个 `ReasoningReplay`，是为了让并发响应各自累积。
 */
export class ReasoningReplayCache {
  private readonly byId = new Map<string, string>()

  /** 缓存里的 id 数量（诊断用）。 */
  size(): number {
    return this.byId.size
  }

  /** 新建一个与缓存共享 id 表、但独立累积的响应观测器。 */
  createReplay(maxIds: number = REPLAY_MAX_IDS): ReasoningReplay {
    return new ReasoningReplay(maxIds, this.byId)
  }

  /** 在共享缓存上做一次补回（只读，不产生观测器状态）。 */
  recover(messages: unknown): { messages: unknown; injected: number } {
    return this.createReplay().recover(messages)
  }
}
