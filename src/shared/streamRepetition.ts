/**
 * 流内重复退化读数。
 *
 * 网关原来只把 `finish_reason=length` 且客户端未请求上限当作 degraded。这一次
 * WorkBuddy 的 agent 会话里，退化的流全部是 `finish_reason=tool_calls` 的正常 200
 * （模型每轮从客户端注入的摘要重新盘点任务清单），而把流掐掉的是客户端自己的
 * REASONING_LOOP 守卫 —— 在评分上它等于 `client_abort`，既不加分也不扣分，于是
 * 粘性下一轮照样把会话送回同一家。这里补的就是「内容退化但协议正常」这一类信号。
 *
 * ⚠️ 只覆盖**流式**：非流式请求没有逐块过程，正文又只在开 body 日志时才留，
 *    所以那条路明确不判，界面上也这么写。
 *
 * 口径故意与客户端守卫对齐（尾部行去重率 + 连续循环字符量），两边的数才能对账。
 */

export interface RepetitionGuardSettings {
  /** Off means the reading is not even computed. */
  enabled: boolean
  /** Short answers legitimately repeat lines (paired `}` in code), so they are never judged. */
  minLines: number
  /** Unique lines / total lines at or below this counts as degenerate. */
  maxDedupRatio: number
}

/**
 * 出厂阈值来自 2026-11-03 那次 WorkBuddy agent 会话的实测分布（99 段真实 reasoning）：
 * 健康段的中位去重率是 **1.000**，p10 在 0.648-0.982 之间；0.80 命中 9/99 段，
 * 分布在四家模型上，而表现最干净的 `raccoon/sn-sensenova-6-8-flash-lite`（最低 0.982）
 * 一段都不中招。客户端守卫是在 0.35 中止的，网关仍比它宽松，不抢在客户端之前定罪。
 */
export const DEFAULT_REPETITION_GUARD: RepetitionGuardSettings = {
  enabled: true,
  minLines: 40,
  maxDedupRatio: 0.8,
}

/** How many trailing lines the verdict is computed over. */
export const REPETITION_TAIL_LINES = 128

export interface StreamRepetitionReading {
  /** Lines actually inspected (≤ {@link REPETITION_TAIL_LINES}). */
  lines: number
  uniqueLines: number
  dedupRatio: number
  /**
   * Longest run of consecutive identical lines, in characters.
   * Reported as evidence; deliberately **not** a judgement input - in the
   * reference session the long consecutive runs appeared mostly in healthy
   * blocks, so requiring one would have flagged almost nothing.
   */
  runChars: number
  /** True when this reading crosses the guard's thresholds. */
  degraded: boolean
  /** Present when the answer was too short to judge, so `degraded` is not a clean verdict. */
  notJudged?: 'too_short'
}

const DELTA_FIELDS = ['content', 'reasoning', 'reasoning_content'] as const

/**
 * 读取侧归一：缺字段回出厂值，脏值（负数、`NaN`、字符串、>1 的比例）收敛到合法区间。
 * 一个写坏的比例会让所有流都被判成退化，或让这条判据永不生效。
 */
export function normalizeStreamRepetitionGuard(value: unknown): RepetitionGuardSettings {
  const raw = (value ?? {}) as Partial<RepetitionGuardSettings>
  const minLines = Number(raw.minLines)
  const maxDedupRatio = Number(raw.maxDedupRatio)
  return {
    enabled: raw.enabled !== false,
    minLines: Number.isFinite(minLines) && minLines >= 1 ? Math.round(minLines) : DEFAULT_REPETITION_GUARD.minLines,
    maxDedupRatio:
      Number.isFinite(maxDedupRatio) && maxDedupRatio >= 0 && maxDedupRatio <= 1
        ? maxDedupRatio
        : DEFAULT_REPETITION_GUARD.maxDedupRatio,
  }
}

/**
 * Pulls the assistant-visible text out of an upstream SSE body.
 *
 * Anything that is not a `data:` frame with a parseable JSON payload contributes
 * nothing - `[DONE]`, `: PING` comments and malformed tails are skipped rather
 * than counted as text, because counting them would let a truncated stream look
 * like a repeated one.
 */
export function* chatDeltasInSse(sse: string): Generator<Record<string, unknown>> {
  for (const rawLine of sse.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    let frame: unknown
    try {
      frame = JSON.parse(payload)
    } catch {
      continue
    }
    const delta = (frame as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0]?.delta
    if (delta) yield delta
  }
}

export function extractStreamText(sse: string): string {
  const parts: string[] = []
  for (const delta of chatDeltasInSse(sse)) {
    for (const field of DELTA_FIELDS) {
      const value = delta[field]
      if (typeof value === 'string' && value !== '') parts.push(value)
    }
  }
  return parts.join('')
}

function longestRepeatedRunChars(lines: readonly string[]): number {
  let best = 0
  let index = 0
  while (index < lines.length) {
    const current = lines[index]
    if (current === '') {
      index += 1
      continue
    }
    let run = 1
    while (index + run < lines.length && lines[index + run] === current) run += 1
    best = Math.max(best, run * current.length)
    index += run
  }
  return best
}

/**
 * Judges the trailing window of one streamed answer.
 *
 * The ratio is measured over the tail, not the whole answer: an agent turn that
 * starts clean and then degenerates is exactly the case this guard exists for,
 * and averaging over the whole body would dilute it.
 */
export function measureStreamRepetition(
  sse: string,
  settings: RepetitionGuardSettings = DEFAULT_REPETITION_GUARD,
): StreamRepetitionReading | null {
  if (!settings.enabled) return null
  return measureTextRepetition(extractStreamText(sse), settings)
}

/**
 * 同一把尺子量「已拼好的正文」。非流式响应没有逐块过程，正文是 JSON 里的一个字符串；
 * 衰退判据（下面 {@link judgeRunawayTurn}）要求两条入口共用同一个去重读数，
 * 否则流式与非流式会对同一段文字给出两个结论。
 */
export function measureTextRepetition(
  text: string,
  settings: RepetitionGuardSettings = DEFAULT_REPETITION_GUARD,
): StreamRepetitionReading | null {
  // 关掉守卫就不产出读数：留一行「没判」比留一行假的健康读数诚实。
  if (!settings.enabled) return null
  const all = text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  if (all.length === 0) {
    return { lines: 0, uniqueLines: 0, dedupRatio: 1, runChars: 0, degraded: false, notJudged: 'too_short' }
  }
  const tail = all.slice(-REPETITION_TAIL_LINES)
  const uniqueLines = new Set(tail).size
  const dedupRatio = Number((uniqueLines / tail.length).toFixed(3))
  const runChars = longestRepeatedRunChars(tail)

  if (tail.length < settings.minLines) {
    return { lines: tail.length, uniqueLines, dedupRatio, runChars, degraded: false, notJudged: 'too_short' }
  }

  return {
    lines: tail.length,
    uniqueLines,
    dedupRatio,
    runChars,
    degraded: dedupRatio <= settings.maxDedupRatio,
  }
}

/**
 * 「这一发什么都没做」的读数 —— 第三类退化。
 *
 * ## 为什么去重率判据盖不住它（2026-11-12 现网 `chatcmpl-mwcghqtq-td1xm6`）
 *
 * 去重率读尾部行的重复度，而那一发是 176 KB、`[DONE]` 正常收尾、**行数为 0**：
 * 模型把 1108 个 output token 全花在思考上（OpenRouter 的 `reasoning_details` 是
 * 对象数组，不在 {@link extractStreamText} 认的三个字符串字段里），正文与工具调用
 * 都是空。客户端（Codex）拿到一个 `finish` 正常、却没有任何可执行动作的回合，界面
 * 就停在上一句「先确认当前 shell 位置」的承诺上，而网关这行记的是 `success`。
 *
 * 判据只看「本轮有没有交付任何东西」，不看思考量，因此没有阈值可调 —— 也调不出来：
 * 任何去重率都会把「零行」判成健康（`notJudged: too_short`）。
 */
export interface StreamEmptyTurnReading {
  /** 助手可见正文的字符数（`delta.content`，字符串与内容段数组都计入）。 */
  contentChars: number
  /** 工具调用增量的条数（`delta.tool_calls`）。 */
  toolCallDeltas: number
  /** 客户端本轮带了工具。没带工具时「只说不做」是合法答案，不判空。 */
  toolsOffered: boolean
  /** true = 带了工具、却既无正文也无工具调用 —— 这一轮不会产生任何动作。 */
  empty: boolean
  /** 正文最后一个非空白字符；没有正文时缺省。 */
  lastChar?: string
  /**
   * true = 带了工具、零工具调用、**有**正文且正文以冒号收尾 —— 「宣布接下来要做」
   * 却就地结束回合（第四类退化，2026-11-12 现网 `chatcmpl-mwcmniyx-797qi1`：
   * `cline/nemotron-3.5-lightning-free` 连发三句「现在我将修改 X：」然后 `stop`，
   * 零工具调用，84 个 output token）。
   *
   * 与 {@link StreamEmptyTurnReading.empty} 是互补的两格：`empty` 抓「一个字都没给」，
   * 这里抓「给了一句承诺、没给动作」。两者都只在 `done` 收尾上判（见
   * `streamOutcomePolicy.ts`）—— 被掐断的流零内容是**被掐**造成的，不判。
   */
  announcedStop: boolean
}

interface AssistantDeltaTally {
  contentChars: number
  toolCallDeltas: number
  lastChar?: string
}

/**
 * 一个 `delta` 对「助手可见正文 / 工具调用」的贡献。流式探测与整段读数共用这一个
 * 累加器 —— 早判（逐块）与终判（整段）数出两个不同的字符数，就是两把尺子。
 */
function accumulateAssistantDelta(tally: AssistantDeltaTally, delta: Record<string, unknown>): void {
  const content = delta.content
  if (typeof content === 'string') {
    tally.contentChars += content.length
    const trimmed = content.trimEnd()
    if (trimmed !== '') tally.lastChar = trimmed.slice(-1)
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        tally.contentChars += part.length
        const trimmedPart = part.trimEnd()
        if (trimmedPart !== '') tally.lastChar = trimmedPart.slice(-1)
      }
      else if (typeof (part as { text?: unknown })?.text === 'string') {
        tally.contentChars += (part as { text: string }).text.length
        const trimmedText = (part as { text: string }).text.trimEnd()
        if (trimmedText !== '') tally.lastChar = trimmedText.slice(-1)
      }
    }
  }
  if (Array.isArray(delta.tool_calls)) tally.toolCallDeltas += delta.tool_calls.length
}

export function measureStreamEmptyTurn(sse: string, toolsOffered: boolean): StreamEmptyTurnReading {
  const tally: AssistantDeltaTally = { contentChars: 0, toolCallDeltas: 0 }
  for (const delta of chatDeltasInSse(sse)) accumulateAssistantDelta(tally, delta)
  const { contentChars, toolCallDeltas, lastChar } = tally
  return {
    contentChars,
    toolCallDeltas,
    toolsOffered,
    empty: toolsOffered && contentChars === 0 && toolCallDeltas === 0,
    ...(lastChar === undefined ? {} : { lastChar }),
    // 半角 `:` 与全角 `：` 都算。判据要求「有工具、零调用、有正文、冒号收尾」四条同时
    // 成立，少任何一条都不判 —— 那可能是合法的最终答复。
    announcedStop: toolsOffered
      && toolCallDeltas === 0
      && contentChars > 0
      && (lastChar === ':' || lastChar === '：'),
  }
}

/**
 * 逐块累积的同一份读数 —— 给「发到一半就得判」的路径用。
 *
 * 整段读数（{@link measureStreamEmptyTurn}）只能等流结束；而 2026-11-19 那次跑飞
 * （`执行。` 复读到 16384 字才被输出上限截断，客户端等满 5 分钟）如果等到结束才判，
 * 截断已经发到客户端了。这里把同一个累加器搬到增量口：每块喂进来，随时能读。
 * 尾部没换行的残片留在 carry 里，等下一块补全再解析 —— 半个 JSON 不算数。
 */
export interface ChatStreamProbe {
  push(chunk: string): void
  reading(): Pick<StreamEmptyTurnReading, 'contentChars' | 'toolCallDeltas'>
}

export function createChatStreamProbe(): ChatStreamProbe {
  let carry = ''
  const tally: AssistantDeltaTally = { contentChars: 0, toolCallDeltas: 0 }
  return {
    push(chunk: string): void {
      carry += chunk
      const cut = carry.lastIndexOf('\n')
      if (cut === -1) return
      for (const delta of chatDeltasInSse(carry.slice(0, cut + 1))) accumulateAssistantDelta(tally, delta)
      carry = carry.slice(cut + 1)
    },
    reading() {
      return { contentChars: tally.contentChars, toolCallDeltas: tally.toolCallDeltas }
    },
  }
}

/**
 * 「跑飞」判据：客户端带了工具、模型一个工具调用都没发、正文长到 6000 字以上，
 * 且尾部去重率已经塌到守卫阈值以下。
 *
 * 为什么不是「零工具调用 + 长」就够：Codex 在 goal 循环里每轮就是「说一句计划、
 * 结束本回合」，合法的计划独白可以到几百上千字；把这些都判成跑飞会重发掉一半
 * 正常回合。重复度才是分水岭 —— 2026-11-19 18:54 那一轮尾部 128 行里
 * `执行。/现在。/调用。` 独占，去重率 0.08，健康回合的规划独白则在 0.9 以上。
 *
 * 阈值 6000 取自同一批读数：该轮跑到 6000 字时已进入循环（前 ~2000 字还是
 * 可读的计划），再早判容易误伤「详细解释」这类合法的长正文。
 */
export const RUNAWAY_MIN_CHARS = 6000

export interface RunawayTurnReading {
  degenerate: boolean
  contentChars: number
  toolCallDeltas: number
  repetition: StreamRepetitionReading | null
}

function judgeRunaway(
  contentChars: number,
  toolCallDeltas: number,
  text: string,
  toolsOffered: boolean,
  settings: RepetitionGuardSettings,
): RunawayTurnReading {
  const repetition = measureTextRepetition(text, settings)
  return {
    degenerate: toolsOffered
      && toolCallDeltas === 0
      && contentChars >= RUNAWAY_MIN_CHARS
      && repetition?.degraded === true,
    contentChars,
    toolCallDeltas,
    repetition,
  }
}

/** 流式入口：`sse` 是这一发到目前为止收到的全部 chat SSE 原文。 */
export function judgeRunawayTurn(
  sse: string,
  toolsOffered: boolean,
  settings: RepetitionGuardSettings = DEFAULT_REPETITION_GUARD,
): RunawayTurnReading {
  const turn = measureStreamEmptyTurn(sse, toolsOffered)
  return judgeRunaway(turn.contentChars, turn.toolCallDeltas, extractStreamText(sse), toolsOffered, settings)
}

/** 非流式入口：正文与工具调用已经在 JSON 里，读数从字段直接来。 */
export function judgeRunawayText(
  text: string,
  toolCallCount: number,
  toolsOffered: boolean,
  settings: RepetitionGuardSettings = DEFAULT_REPETITION_GUARD,
): RunawayTurnReading {
  return judgeRunaway(text.length, toolCallCount, text, toolsOffered, settings)
}
