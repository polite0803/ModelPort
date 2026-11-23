/**
 * 派发账本：滚动窗口内每个 (供应商, 模型) 被派出去过几次。
 *
 * 它是「分数优先 + 份额轮转」里份额那一半的唯一数据源：全池展开后打分本身是
 * 确定性的，同一个池永远由分数最高的那一个候选服务，账本存在的唯一理由就是让
 * 已经派发过的候选退到队后，把机会让给池里还没被路由到的模型。
 *
 * 口径三条：
 * - **记派发而不是成功**：一次尝试无论成败都占用了这一家的额度和这一次往返，
 *   只数成功会让永远失败的候选停留在「没被派过」，被公平规则一遍遍重新推上去。
 * - **窗口而不是累计**：目录漂移下线、用户停用、渠道换池之后，历史欠债不该跟着
 *   这个模型一辈子；过期条目直接掉。
 * - **纯内存、不依赖 electron**：与 `accountRuntime` 同一纪律，进程重启即清零。
 */

/** 滚动窗口：30 分钟内的派发参与份额判定 */
export const DISPATCH_WINDOW_MS = 30 * 60 * 1000

/**
 * 计数桶的粒度：一分钟一桶。
 *
 * 存桶而不是存每次派发的时间戳，是为了让这张表的大小与流量无关：一个高频客户端在
 * 窗口里可以派几千次，时间戳表就跟着长几千个元素，而每请求一次的读要扫它们全部；
 * 桶数只由窗口长度决定（`DISPATCH_WINDOW_MS / BUCKET_MS + 1` 个封顶）。代价是份额的
 * 窗口边界最多宽一分钟，而那一点只挪动「谁先退到队后」的次序，不改变谁能被派出。
 */
const BUCKET_MS = 60 * 1000

/**
 * 最多记多少个 (供应商, 模型) 键。
 *
 * 自定义供应商能接受任意模型名，不设上限就是一张随请求增长的表。超限时先摘窗口内
 * 已空的键，仍满再按插入序摘最旧的 —— 最旧那批同时也是最不可能再次命中的（与
 * `accountRuntime` 的限流档上限同一思路）。
 */
const MAX_LEDGER_KEYS = 4096

/**
 * 份额键：与 Bandit 同一身份域（`(providerId, actualModel)`），两处必须说同一个
 * 「模型」，否则战绩惩罚与份额轮转会各自数一套。
 */
export function dispatchKeyOf(providerId: string, actualModel: string): string {
  return `${providerId}\u0000${actualModel}`
}

/**
 * 路由作用域前缀。硬比例配额要数「这条路由自己派了几次」，但全池公平轮转仍要数
 * 所有路由的合计。两套账共用一个桶表，用前缀隔开；`snapshot(route)` 只返回该前缀的
 * 读数，并把前缀剥掉，键口径因此仍是 `dispatchKeyOf(providerId, actualModel)`。
 */
const ROUTE_SCOPE_PREFIX = '\u0001route\u0001'

function scopedKeyOf(providerId: string, actualModel: string, route?: string): string {
  const base = dispatchKeyOf(providerId, actualModel)
  return route === undefined || route === '' ? base : `${ROUTE_SCOPE_PREFIX}${route}\u0000${base}`
}

/** `snapshot()` 的读数：窗口内每键派发次数与总数 */
export interface DispatchSnapshot {
  counts: Map<string, number>
  /**
   * 窗口内的总派发次数。
   *
   * 份额门槛**不**从这里取，也不在这张表里取最小值：门槛必须是「本次候选池里的
   * 最小派发数」，而池里必然有从没派发的模型（键都不存在，读作 0）。拿在册键的最小
   * 值当门槛，会在表里只剩一个热键时把门槛抬到那个键自己头上 —— 它永远 ≤ 门槛，
   * 于是份额轮转在最需要它的时候（只有一个模型在派）恰好不生效。
   */
  total: number
}

class DispatchLedger {
  /** key → (分钟桶起点 → 该桶内的派发次数) */
  private buckets = new Map<string, Map<number, number>>()

  /**
   * 记一次派发（换家循环里每一次真实的上游尝试，含失败的）。
   *
   * O(1)：不排序、不扫描。出窗的桶交给 `snapshot()` 摘 —— 一个不再被派发的模型
   * 不该靠写路径清自己的历史，而高并发下写比读频繁得多。
   */
  record(providerId: string, actualModel: string, now: number = Date.now(), route?: string): void {
    const key = scopedKeyOf(providerId, actualModel, route)
    let perKey = this.buckets.get(key)
    if (perKey === undefined) {
      this.boundTable(now)
      perKey = new Map()
      this.buckets.set(key, perKey)
    }
    const bucket = Math.floor(now / BUCKET_MS) * BUCKET_MS
    perKey.set(bucket, (perKey.get(bucket) ?? 0) + 1)
  }

  /**
   * 读出窗口内的份额表，顺手清理（整键出窗就摘掉）。
   *
   * 每请求读一遍（`collectCandidates` 取一次），逐候选读会让一次选号扫一遍全表。
   */
  snapshot(now: number = Date.now(), route?: string): DispatchSnapshot {
    const from = now - DISPATCH_WINDOW_MS
    const scope = route === undefined || route === ''
      ? undefined
      : `${ROUTE_SCOPE_PREFIX}${route}\u0000`
    const counts = new Map<string, number>()
    let total = 0
    for (const [key, perKey] of this.buckets) {
      if (scope !== undefined) {
        if (!key.startsWith(scope)) continue
      } else if (key.startsWith(ROUTE_SCOPE_PREFIX)) {
        continue
      }
      let sum = 0
      for (const [bucketStart, hitCount] of perKey) {
        if (bucketStart < from) perKey.delete(bucketStart)
        else sum += hitCount
      }
      if (sum === 0) {
        this.buckets.delete(key)
        continue
      }
      counts.set(scope === undefined ? key : key.slice(scope.length), sum)
      total += sum
    }
    return { counts, total }
  }

  /** 代理服务重启时清零（与 `accountRuntime.reset()` 同一生命周期） */
  reset(): void {
    this.buckets.clear()
  }

  /**
   * 摘掉全表（含路由作用域）出窗的桶。不能复用 `snapshot(now)`：它按调用方的
   * 作用域过滤，全局快照看不到路由键，那些键就再也没机会自己过期了。
   */
  private pruneAll(now: number): void {
    const from = now - DISPATCH_WINDOW_MS
    for (const [key, perKey] of this.buckets) {
      for (const bucketStart of perKey.keys()) {
        if (bucketStart < from) perKey.delete(bucketStart)
      }
      if (perKey.size === 0) this.buckets.delete(key)
    }
  }

  /** 新键入场前的表大小闸门：先摘窗口内已空的，仍满才按插入序摘最旧 */
  private boundTable(now: number): void {
    if (this.buckets.size < MAX_LEDGER_KEYS) return
    this.pruneAll(now)
    if (this.buckets.size < MAX_LEDGER_KEYS) return
    const oldest = this.buckets.keys().next()
    if (!oldest.done) this.buckets.delete(oldest.value)
  }
}

export const dispatchLedger = new DispatchLedger()
export default dispatchLedger
