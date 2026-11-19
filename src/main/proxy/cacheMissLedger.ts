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
import type { CacheMissClass } from '../../shared/tokenAccounting.ts'

export interface CacheMissReading {
  class: CacheMissClass
  /** 上一轮同一会话的 prompt token；首次出现时缺省。 */
  prevPromptTokens?: number
}

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
}

class CacheMissLedger {
  private readonly last = new Map<string, Reading>()

  classify(input: {
    key: string | undefined
    promptTokens: number
    cacheReadTokens: number | undefined
    cacheReported: boolean | undefined
    now?: number
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

    let reading: CacheMissReading
    if (previous !== undefined && prompt < previous.prompt * REWRITE_RATIO) {
      reading = { class: 'rewrite', prevPromptTokens: previous.prompt }
    } else if (previous === undefined || ratio > COLD_RATIO) {
      reading = previous === undefined
        ? { class: 'cold' }
        : { class: 'cold', prevPromptTokens: previous.prompt }
    } else if (ratio > TAIL_RATIO) {
      reading = { class: 'break', prevPromptTokens: previous.prompt }
    } else {
      reading = { class: 'tail', prevPromptTokens: previous.prompt }
    }

    this.remember(input.key, prompt, now)
    return reading
  }

  private remember(key: string, prompt: number, now: number): void {
    // delete + set：Map 保留首次插入位，不重排的话常驻会话会被当成"最旧"淘汰。
    this.last.delete(key)
    this.last.set(key, { prompt, at: now })
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