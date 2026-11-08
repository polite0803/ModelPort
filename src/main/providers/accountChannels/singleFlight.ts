/**
 * 把同名并发调用折叠成同一轮，并给「失效」一个可见的代次。
 *
 * 目录扫描一次要发十几个 `model.list`，而结果只在**整轮结束后**才写缓存；没有
 * 单飞时，并发进来的每个调用都命中不了缓存、各跑一遍（2026-11-09 的 429 风暴里
 * 同一秒出现 5 条「模型窗口覆盖」就是这么来的）。
 *
 * `invalidate()` 同时管缓存一致性：在旧轮次途中被作废的结果不能再写回缓存，
 * 所以工作函数拿到自己开始时的 `version`，由调用方决定写不写；代次变化后新来的
 * 调用不会并入旧轮次，而是另起一轮。
 */
export class SingleFlight<T> {
  private inFlight: { version: number; promise: Promise<T> } | null = null
  private currentVersion = 0

  get version(): number {
    return this.currentVersion
  }

  /** 让在途结果作废：之后的调用开新一轮，旧轮次仍会拿到自己的返回值。 */
  invalidate(): void {
    this.currentVersion += 1
  }

  run(work: (version: number) => Promise<T>): Promise<T> {
    const version = this.currentVersion
    if (this.inFlight !== null && this.inFlight.version === version) {
      return this.inFlight.promise
    }
    const promise = work(version)
    this.inFlight = { version, promise }
    // 只清自己那一条：失效后已经另起的新轮次不能被旧轮次的收尾清掉。
    const settle = (): void => {
      if (this.inFlight?.promise === promise) this.inFlight = null
    }
    promise.then(settle, settle)
    return promise
  }
}