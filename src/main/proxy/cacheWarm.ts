/**
 * 压缩后的前缀预热判定。
 *
 * 实测（2026-11-20，`opencode_go/deepseek-v4.1-flash` 同一会话逐轮）：
 *
 *   turn 87  input=159978 cached=159872  99.9%
 *   turn 88  input=185789 cached=0        0.0%   ← 客户端把整段历史发去生成摘要
 *   turn 89  input=28910  cached=4480    15.5%   ← 压缩完成，前缀变了
 *   turn 90  input=44082  cached=28800   65.3%   ← 新前缀逐步变长，每轮重读
 *   turn 91  输入 46103 命中 42112 91.3%
 *
 * 压缩本身那次请求无法命中（它的输入与上一轮不同），这是压缩的固有代价；但
 * **压缩之后的前缀**在头几轮里每轮重读一遍，这部分是可以省掉的：压缩产物一旦
 * 出现，用同一份前缀发一次最小请求把它写进缓存，后续轮次就直接命中。
 *
 * 这里只做判定，不做网络调用 —— 发不发、发什么由调用方决定，便于单测与关停。
 */

/** 判定「这一轮之后发生了压缩」需要的最小输入落差比例。 */
export const COMPACTION_SHRINK_RATIO = 0.5
/** 压缩后输入低于这个量时不值得预热：缓存写入门槛通常在这个量级以上。 */
export const WARM_MIN_TOKENS = 8_000
/** 同一条会话两次预热之间的最短间隔，避免连续压缩把请求数打上去。 */
export const WARM_COOLDOWN_MS = 5 * 60 * 1_000
/**
 * 连续失败达这个数就暂停预热：2026-11-20 现网 67 次预热里 47 次 400，
 * 每笔失败仍按全价买了整份前缀。错误体未取到之前，不猜根因、先止血。
 */
export const WARM_FAILURE_LIMIT = 2
/** 失败后的暂停窗口；与正常冷却同量级，下一次压缩后再试。 */
export const WARM_FAILURE_BACKOFF_MS = 5 * 60 * 1_000

/** 失败冷却判定：纯函数，不持有跨请求状态。 */
export function shouldPauseWarmAfterFailures(input: {
  consecutiveFailures: number
  lastFailureAt?: number
  now?: number
}): boolean {
  if (input.consecutiveFailures < WARM_FAILURE_LIMIT) return false
  if (input.lastFailureAt === undefined) return false
  const now = input.now ?? Date.now()
  return now - input.lastFailureAt < WARM_FAILURE_BACKOFF_MS
}

export interface CompactionReading {
  /** 上一轮发给上游的 prompt token 数。 */
  previousPromptTokens: number
  /** 这一轮的 prompt token 数。 */
  currentPromptTokens: number
}

/**
 * 这一轮是不是「压缩之后的第一轮」。
 *
 * 判据只有一条：输入比上一轮少了一半以上，且上一轮本身不小。压缩是客户端行为，
 * 它把长历史换成一份摘要，输入随之骤降 —— 这是唯一可靠的信号，不去猜内容。
 */
export function isPostCompactionTurn(reading: CompactionReading): boolean {
  const { previousPromptTokens, currentPromptTokens } = reading
  if (previousPromptTokens < WARM_MIN_TOKENS) return false
  if (currentPromptTokens <= 0) return false
  return currentPromptTokens < previousPromptTokens * COMPACTION_SHRINK_RATIO
}

export interface WarmDecision {
  warm: boolean
  reason:
    | 'not_compaction'
    | 'too_small'
    | 'cooldown'
    | 'unsupported_cache'
    | 'disabled'
    | 'not_continuation'
    | 'ok'
}

/** 上一轮距今超过这么久，就把这次压缩当作「会话已经停了」——不预热。 */
const WARM_CONTINUATION_GAP_MS = 5 * 60 * 1000
/** 这一轮之前至少跑过这么多轮，才算「还在跑的会话」。 */
const WARM_MIN_PRIOR_TURNS = 2

/**
 * 决定是否预热。
 *
 * `cacheMode` 只认 `implicit-prefix` 与 `explicit-breakpoints` 两种：上游没有可验证
 * 的缓存能力时（`unknown`），发一次请求既不能证明缓存被写入，也只是白花额度。
 */
export function shouldWarmAfterCompaction(
  reading: CompactionReading,
  options: {
    cacheMode: 'implicit-prefix' | 'explicit-breakpoints' | 'unknown'
    enabled: boolean
    lastWarmAt?: number
    /** 上一轮的发生时刻。会话停了很久才回来，压完多半也就结束了。 */
    lastTurnAt?: number
    /** 这一轮之前的轮数。只有一两轮的会话，预热写进去没人接着读。 */
    previousTurns?: number
    now?: number
  },
): WarmDecision {
  if (!options.enabled) return { warm: false, reason: 'disabled' }
  if (options.cacheMode === 'unknown') return { warm: false, reason: 'unsupported_cache' }
  if (!isPostCompactionTurn(reading)) return { warm: false, reason: 'not_compaction' }
  if (reading.currentPromptTokens < WARM_MIN_TOKENS) return { warm: false, reason: 'too_small' }
  const now = options.now ?? Date.now()
  if (options.lastWarmAt !== undefined && now - options.lastWarmAt < WARM_COOLDOWN_MS) {
    return { warm: false, reason: 'cooldown' }
  }
  // 「压完即结束」是净亏：预热写进去的缓存没人读，白花一整份前缀的输入 token。
  // 只对「明显还在跑」的会话预热 —— 上一轮就在几分钟内，且此前已经跑过至少两轮。
  if (options.lastTurnAt !== undefined && now - options.lastTurnAt > WARM_CONTINUATION_GAP_MS) {
    return { warm: false, reason: 'not_continuation' }
  }
  if (options.previousTurns !== undefined && options.previousTurns < WARM_MIN_PRIOR_TURNS) {
    return { warm: false, reason: 'not_continuation' }
  }
  return { warm: true, reason: 'ok' }
}

/**
 * 预热请求体：**逐字复用**这一轮的前缀，只把输出上限与流式开关改小。
 *
 * 缓存按前缀字节匹配，所以前缀必须与真实请求**逐字一致**：`tools` / `tool_choice`
 * 都渲染在当前提示词里（工具声明是前缀的一部分），剥掉它们会让写进去的缓存对不上
 * 后续真实轮次。2026-11-20 实测：保留 tools 的预热发完后，紧随的真实请求命中
 * 97%（3712/3827）；剥掉 tools 的预热写的是另一个前缀（3574 tok），真实请求用不上，
 * 且「有 tool 消息、却没有 tools 声明」还会被严格上游整条 400（百炼实测）。
 *
 * 只改 `max_tokens` / `stream`（以及流式专用的 `stream_options`）：这些都不进提示词
 * 前缀、不破坏缓存比对。`max_tokens` 取 1 是因为这次调用只为了把前缀写进上游缓存，
 * 不需要它产出内容。`stream_options` 必须随 `stream: true` 一起删 —— 2026-11-21
 * 部署后首笔预热 400 的错误体明确写着 `stream_options should be set along with stream = true`：
 * 真实请求是流式的，`anthropicWire` 为它注入了 `stream_options`；预热把 `stream` 关成
 * false 却把这个字段留下，上游直接拒收整条（前缀一个 token 都没写进去）。
 */
export function warmRequestOf<T extends Record<string, unknown>>(body: T): T {
  const warm = { ...body, max_tokens: 1, stream: false } as Record<string, unknown>
  delete warm.stream_options
  return warm as unknown as T
}

/** 压缩回合的请求形态：网关不构造这些文本，只识别客户端已经发来的结构。 */
export type CompactionTurn = 'none' | 'summarize' | 'resume'

/** 客户端压缩链路自己在 user 文本里打的标记（2026-11-21 现网请求原文）。 */
const COMPACTION_MARKERS: ReadonlyArray<{ kind: Exclude<CompactionTurn, 'none'>; pattern: RegExp }> = [
  // CLI 把「写交接摘要」这一轮标成 compaction request；同一个回合里也会出现 handoff summary。
  { kind: 'summarize', pattern: /context checkpoint compaction|compaction request|handoff summary/i },
  // 前端拿到摘要后重建会话时，把摘要原文塞回第一条 user。
  { kind: 'resume', pattern: /another language model started|produced a summary of its thinking process/i },
]

/**
 * 识别「压缩写摘要」与「摘要后重建会话」两类请求。
 *
 * 2026-11-21 现网窗口的未命中 token 有 85% 集中在这对回合：前者把整段历史发给模型写
 * handoff summary（前缀与上一轮必然不同），后者又用摘要重建会话（前缀同样断裂）。
 * 两者都不能靠预热消除 —— 预热只适合「压缩后新前缀被逐轮重读」的场景。这里只认
 * 客户端实际发来的请求文本，网关不写任何提示词；匹配很窄，宁可漏判也不要误伤普通对话。
 *
 * 匹配范围覆盖 `content` 的字符串与 OpenAI 多模态 content part 中的 `text`，但**只读**
 * user 消息：assistant 的历史摘要、工具回执里出现同样字样不能代表本轮请求形态。
 */
export function compactionTurnOf(messages: unknown): CompactionTurn {
  if (!Array.isArray(messages)) return 'none'
  let text = ''
  for (const message of messages) {
    if (message === null || typeof message !== 'object' || (message as { role?: unknown }).role !== 'user') continue
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') {
      text += `${content}\n`
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part === null || typeof part !== 'object') continue
        if ((part as { type?: unknown }).type !== 'text') continue
        const partText = (part as { text?: unknown }).text
        if (typeof partText === 'string') text += `${partText}\n`
      }
    }
  }
  for (const marker of COMPACTION_MARKERS) {
    if (marker.pattern.test(text)) return marker.kind
  }
  return 'none'
}

/**
 * 预热失败日志只留状态码与错误摘要，绝不把提示词、工具定义或凭据写进磁盘。
 * 换行会被日志切分成多行，破坏一行一条 NDJSON 的读取契约。
 */
export function warmErrorSummaryOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const oneLine = value.replace(/[\r\n]+/g, ' ').trim()
  if (oneLine === '') return undefined
  return oneLine.slice(0, 200)
}