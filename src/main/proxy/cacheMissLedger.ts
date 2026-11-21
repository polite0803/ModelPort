/**
 * 缓存缺口成因分类（按会话，内存，进程生命周期）。
 *
 * 「命中率 97%」本身不回答「差在哪」：同样是 3% 的缺口，冷启动、客户端把
 * 历史改小、上游清理、正常新增尾部，四种成因的处置完全不同。分类只需要一个
 * 跨轮读数（上一轮同一会话的 prompt 大小）：
 *
 * - 历史被**改小**（本轮 prompt < 上轮 × 0.9）⇒ `rewrite`：客户端压缩/删改，
 *   前缀在删除点断裂，网关无法消除。
 * - 无上一轮读数，或 > 50% 未命中 ⇒ `cold`：会话首轮、锚点过期或上游清理。
 * - 2% < 未命中 ≤ 50% ⇒ `break`：锚点还在却从中间断开（上游清理 / 未知重写）。
 * - 未命中 ≤ 2% ⇒ `tail`：正常的新增尾部（上一轮输出 + 本轮输入）。
 *
 * 只对**上报了缓存字段**的请求分类：没报就没有可归因的缺口，写 0 会把
 * 「没测到」伪装成「测到了」。
 */
import {
  emptyCacheMissDetail,
  type CacheMissClass,
  type CacheMissDetail,
  type CacheMissIdleGap,
} from '../../shared/tokenAccounting.ts'

export interface CacheMissReading {
  class: CacheMissClass
  /** 上一轮同一会话的 prompt token；首次出现时缺省。 */
  prevPromptTokens?: number
  /** 四类的再切分（cold/break 才有）。只读归因，不参与任何处置。 */
  detail?: CacheMissDetail
  /** 续轮丢锚距上一轮的间隔档（只有 `coldResumed` 才有）。 */
  idleGap?: CacheMissIdleGap
}

/** 「续轮丢锚」的间隔分档边界：5 分钟 / 30 分钟。 */
const IDLE_GAP_5M_MS = 5 * 60 * 1000
const IDLE_GAP_30M_MS = 30 * 60 * 1000

function idleGapOf(gapMs: number): CacheMissIdleGap {
  if (gapMs <= IDLE_GAP_5M_MS) return 'under5m'
  if (gapMs <= IDLE_GAP_30M_MS) return 'from5mTo30m'
  return 'over30m'
}

/** 进程启动时刻：用来标「重启后不久的首轮」，与真·新会话分开。 */
const PROCESS_STARTED_AT = Date.now()
/** 重启后的这段窗口内、本会话又没有上轮读数 ⇒ 疑似账本被重启清掉。 */
const RESTART_GRACE_MS = 10 * 60 * 1000

/**
 * 「未命中 ≈ 本轮新增」的测量余量：上游的 prompt/cache 读数是整数，估算与真实
 * 分词之间有误差；余量给足一点，宁可把边界判成 `append`（结构性上限），
 * 不把正常追加算成前缀断裂。
 */
const APPEND_SLACK_MIN = 1024

/** 6 小时的会话读数保留窗：超过它的一轮视为新会话，不拿旧大小比。 */
const READING_TTL_MS = 6 * 60 * 60 * 1000
const CAPACITY = 2048
/** 本轮 prompt 比上轮小到这条线以下，判「历史被改小」。 */
const REWRITE_RATIO = 0.9
/** 未命中占比超过它且没有可信上轮读数时，判整段冷启动。 */
const COLD_RATIO = 0.5
/** 正常新增尾部的上限：超过它就有东西在断，不是「新内容」。 */
const TAIL_RATIO = 0.02

interface Reading {
  prompt: number
  at: number
  /** 本会话已记录到的轮数（含这一轮）。只给「会话是否还在继续」这类判据读。 */
  turns: number
}

class CacheMissLedger {
  private readonly last = new Map<string, Reading>()

  classify(input: {
    key: string | undefined
    promptTokens: number
    cacheReadTokens: number | undefined
    cacheReported: boolean | undefined
    now?: number
    /** 仅供测试：把进程启动时刻钉到某个时间点。 */
    processStartedAt?: number
  }): CacheMissReading | undefined {
    if (input.cacheReported !== true || input.cacheReadTokens === undefined) return undefined
    // 没有会话键就没有「上一轮」可比，判成 cold 会把「无从归因」伪装成「冷启动」。
    if (input.key === undefined) return undefined
    const prompt = Math.max(0, Math.floor(input.promptTokens))
    if (prompt <= 0) return undefined
    const now = input.now ?? Date.now()

    const stored = this.last.get(input.key)
    const previous = stored !== undefined && now - stored.at <= READING_TTL_MS ? stored : undefined

    const read = Math.max(0, Math.min(prompt, Math.floor(input.cacheReadTokens)))
    const ratio = (prompt - read) / prompt

    // 未命中量 = 本轮 prompt 里没读到缓存的那部分。与「本轮新增」比，才能把
    // 「新内容本来就没缓存」和「已有前缀被改写」分开。
    const missTokens = Math.max(0, prompt - read)
    let reading: CacheMissReading
    if (previous !== undefined && prompt < previous.prompt * REWRITE_RATIO) {
      reading = { class: 'rewrite', prevPromptTokens: previous.prompt }
    } else if (previous === undefined || ratio > COLD_RATIO) {
      const detail = emptyCacheMissDetail()
      if (previous === undefined) {
        detail.coldFirst = 1
        if (now - (input.processStartedAt ?? PROCESS_STARTED_AT) <= RESTART_GRACE_MS) {
          detail.afterRestart = 1
        }
        reading = { class: 'cold', detail }
      } else {
        detail.coldResumed = 1
        // 间隔是区分「上游过期」与「上游提前清缓存」的唯一客观依据。
        reading = {
          class: 'cold',
          prevPromptTokens: previous.prompt,
          detail,
          idleGap: idleGapOf(now - previous.at),
        }
      }
    } else if (ratio > TAIL_RATIO) {
      const delta = Math.max(0, prompt - previous.prompt)
      const slack = Math.max(APPEND_SLACK_MIN, Math.ceil(delta * 0.1))
      const detail = emptyCacheMissDetail()
      if (missTokens <= delta + slack) detail.breakAppend = 1
      else detail.breakDiverged = 1
      reading = { class: 'break', prevPromptTokens: previous.prompt, detail }
    } else {
      reading = { class: 'tail', prevPromptTokens: previous.prompt }
    }

    this.remember(input.key, prompt, now)
    return reading
  }

  /**
   * 这一轮之前的读数（只返回还活着的）。调用点必须在 `classify` **之前**读，
   * 否则拿到的就是本轮自己。给「压缩后预热是否值得发」用：会话已经放了很久、
   * 或者只有一两轮，预热写进去的缓存没人接着读，那是净亏。
   */
  snapshot(key: string | undefined, now: number = Date.now()): { at: number; prompt: number; turns: number } | undefined {
    if (key === undefined) return undefined
    const stored = this.last.get(key)
    if (stored === undefined) return undefined
    if (now - stored.at > READING_TTL_MS) {
      this.last.delete(key)
      return undefined
    }
    return { at: stored.at, prompt: stored.prompt, turns: stored.turns }
  }

  private remember(key: string, prompt: number, now: number): void {
    const stored = this.last.get(key)
    const live = stored !== undefined && now - stored.at <= READING_TTL_MS
    // delete + set：Map 保留首次插入位，不重排的话常驻会话会被当成"最旧"淘汰。
    this.last.delete(key)
    this.last.set(key, { prompt, at: now, turns: live ? stored.turns + 1 : 1 })
    while (this.last.size > CAPACITY) {
      const oldest = this.last.keys().next()
      if (oldest.done === true) break
      this.last.delete(oldest.value)
    }
  }

  /** 仅供测试：清空读数。 */
  reset(): void {
    this.last.clear()
  }
}

export const cacheMissLedger = new CacheMissLedger()