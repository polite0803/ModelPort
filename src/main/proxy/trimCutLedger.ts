/**
 * 裁剪点账本（按会话 + 供应商 + 模型，内存，进程生命周期）。
 *
 * 上下文裁剪是「从头部丢」，裁剪点随每轮增长而前移：即使客户端把历史原样送回，
 * 网关这一侧保留的窗口起点也每轮变一次，上游前缀缓存从那个点起全部作废 ——
 * 长会话因此读起来像「每轮冷启动」。
 *
 * 这里记住上一轮真正的窗口起点与那条消息的指纹。下一轮只要它**仍然装得下**就
 * 沿用它，于是这一轮的序列化是上一轮的追加；装不下才前移一次（预算的真实要求）。
 * 指纹挡住「客户端压缩/删改历史」：下标还在、内容已换，绝不沿用。
 */
const READING_TTL_MS = 6 * 60 * 60 * 1000
const CAPACITY = 2048

export interface TrimCut {
  /** 非 system 输入数组里的下标。 */
  start: number
  /** 那条消息的指纹（见 `cutFingerprintOf`）。 */
  fingerprint: string
}

interface Entry extends TrimCut {
  at: number
}

class TrimCutLedger {
  private readonly last = new Map<string, Entry>()

  get(key: string | undefined, now: number = Date.now()): TrimCut | undefined {
    if (key === undefined) return undefined
    const entry = this.last.get(key)
    if (entry === undefined) return undefined
    if (now - entry.at > READING_TTL_MS) {
      this.last.delete(key)
      return undefined
    }
    return { start: entry.start, fingerprint: entry.fingerprint }
  }

  remember(key: string | undefined, cut: TrimCut, now: number = Date.now()): void {
    if (key === undefined) return
    // delete + set：Map 保留首次插入位，不重排的话常驻会话会被当成"最旧"淘汰。
    this.last.delete(key)
    this.last.set(key, { ...cut, at: now })
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

export const trimCutLedger = new TrimCutLedger()

/** 账本键：会话 + 真正服务的供应商与模型（窗口与预算是按模型算的）。 */
export function trimCutKey(
  sessionKey: string | undefined,
  providerId: string,
  actualModel: string
): string | undefined {
  return sessionKey === undefined ? undefined : `${sessionKey}::${providerId}::${actualModel}`
}