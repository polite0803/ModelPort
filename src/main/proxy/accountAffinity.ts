/**
 * 具名车道的账号亲和（按会话，内存，进程生命周期）。
 *
 * 具名模型不走 auto 路由，原先每个请求都重跑 `selectAccount`：同一个多账号池里，
 * 同一段会话可能这一轮落账号 A、下一轮落账号 B。上游前缀缓存按 org/key 隔离，
 * 换号就是换缓存域 —— 每轮一次全额冷启动。auto 车道早有
 * `(provider, account, model)` 的会话粘性（`autoRouter.sticky`），这条账本补的
 * 正是具名车道那一格。
 *
 * 只由「成功一轮」写入：没跑通的目标不该被钉住。只对能力已知的供应商写
 * （写入方 `autoRouter.rememberNamedAccountAffinity` 内部判），能力未知不等于缓存友好。
 */
const CAPACITY = 2048

interface Entry {
  accountId: string
  expiresAt: number
}

class AccountAffinity {
  private readonly entries = new Map<string, Entry>()

  /** 命中的账号；过期即删除，不返回一个已经失效的锚点。 */
  get(key: string | undefined, now: number = Date.now()): string | undefined {
    if (key === undefined) return undefined
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= now) {
      this.entries.delete(key)
      return undefined
    }
    return entry.accountId
  }

  remember(key: string | undefined, accountId: string, minutes: number, now: number = Date.now()): void {
    if (key === undefined || accountId === '') return
    if (!Number.isFinite(minutes) || minutes <= 0) return
    // delete + set：Map 保留首次插入位，不重排的话常驻会话会被当成"最旧"淘汰。
    this.entries.delete(key)
    this.entries.set(key, { accountId, expiresAt: now + minutes * 60 * 1000 })
    while (this.entries.size > CAPACITY) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      this.entries.delete(oldest.value)
    }
  }

  /** 仅供测试：清空读数。 */
  reset(): void {
    this.entries.clear()
  }
}

export const accountAffinity = new AccountAffinity()

/** 账本键：会话 + 具名模型。缓存域跟着账号走，但「哪个模型」决定了窗口与计费。 */
export function accountAffinityKey(conversationKey: string | undefined, model: string): string | undefined {
  return conversationKey === undefined ? undefined : `${conversationKey}::${model}`
}