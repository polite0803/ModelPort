/**
 * 最近一次「续轮丢锚」的现场快照，纯内存、固定容量 FIFO。
 *
 * 这是**只读旁路**：既不参与路由/压缩/预热判决，也不进请求体，更不写日志。
 * 它只回答一个问题——下一次 `coldResumed` 发生在哪一台账号、哪一个模型上。
 * 进程重启即清空；跨重启的目标统计走按天桶的 `cacheMissColdResumedByAccount`。
 */
import { createHash } from 'node:crypto'
import type { CacheMissIdleGap } from '../../shared/tokenAccounting'

const CAPACITY = 128
const MAX_TEXT_CHARS = 128
const VALID_GAPS: ReadonlySet<string> = new Set(['under5m', 'from5mTo30m', 'over30m'])

export interface ColdResumeTraceInput {
  /** 入站时刻，不是落账时刻 —— 长流式会把落账时刻的空档系统性记小。 */
  at: number
  providerId: string
  accountId: string
  modelId: string
  /** 会话键原文只在内存里过一遍哈希，绝不落库。 */
  conversationKey?: string
  prevPromptTokens: number
  promptTokens: number
  idleGap: CacheMissIdleGap
  missTokens: number
}

export interface ColdResumeTraceEntry {
  at: number
  providerId: string
  accountId: string
  modelId: string
  conversationKeyHash?: string
  prevPromptTokens: number
  promptTokens: number
  idleGap: CacheMissIdleGap
  missTokens: number
}

export interface ColdResumeTraceSnapshot {
  capacity: number
  /** 最新在前。 */
  entries: ColdResumeTraceEntry[]
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_CHARS) : ''
}

function cleanNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

class ColdResumeTrace {
  private readonly entries: ColdResumeTraceEntry[] = []

  append(input: ColdResumeTraceInput): void {
    // 非法间隔档不是观测数据，宁可不记，也不把坏值伪装成某个已知档位。
    if (!VALID_GAPS.has(input.idleGap)) return
    const key = typeof input.conversationKey === 'string' ? input.conversationKey : ''
    this.entries.push({
      at: cleanNumber(input.at),
      providerId: cleanText(input.providerId),
      accountId: cleanText(input.accountId),
      modelId: cleanText(input.modelId),
      ...(key === ''
        ? {}
        : { conversationKeyHash: createHash('sha256').update(`cold-resume-trace:${key}`).digest('hex').slice(0, 16) }),
      prevPromptTokens: cleanNumber(input.prevPromptTokens),
      promptTokens: cleanNumber(input.promptTokens),
      idleGap: input.idleGap,
      missTokens: cleanNumber(input.missTokens),
    })
    if (this.entries.length > CAPACITY) this.entries.shift()
  }

  snapshot(): ColdResumeTraceSnapshot {
    return {
      capacity: CAPACITY,
      entries: this.entries.slice().reverse().map(entry => ({ ...entry })),
    }
  }

  /** 仅供测试。 */
  reset(): void {
    this.entries.length = 0
  }
}

export const coldResumeTrace = new ColdResumeTrace()
