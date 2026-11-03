/**
 * 统一调度器单例
 *
 * ## 为什么要有它
 *
 * 本应用里 `setInterval` / `setTimeout` 散落在 oauth / proxy / appLogs / tray 各处，
 * 没有统一收口，退出时容易漏 `clear`，而且合盖休眠后周期会漂移。模型清单定时刷新
 * 是第四个散落点，先把"调度"这件事单独成层，后续其它周期任务也能挂进来。
 *
 * ## 设计纪律（与既有代码一致）
 *
 * - **不引 node-cron**：asar 不带 node_modules，主进程运行时依赖必须 rollup 打包，
 *   原生 `setInterval` 已足够表达"固定周期"。需要"精确到时刻"时再单独评估，不在本层。
 * - **串行化执行**：每个任务自带 `running` 守卫。任务还在跑时周期又到了 → 直接跳过这一轮，
 *   不叠加。这是 `AccountChannelManager.syncing` 与 `quotaProbe`「未知≠没有」同一条纪律：
 *   一次没完成的刷新不该逼出第二次并发刷新，否则渠道包/聚合目录会被两路写互相踩。
 * - **fail-soft**：任务抛错只记 `lastError`，绝不把定时器清掉（清掉等于永久停摆），
 *   也不向上抛（一个任务炸了不该拖垮其它任务）。
 * - **退出清理**：`stop()` 统一 `clearInterval`，由 `index.ts` 在 `before-quit` 调用。
 *
 * 本文件刻意不 import electron / axios，纯逻辑，便于 `tests/scheduler.test.ts` 不启动应用就测。
 */

import type { SchedulerTaskStatus } from '../../shared/types'

/**
 * Node 原生 `setInterval` / `setTimeout` 的毫秒上限。
 *
 * 超过这个值，Node 会抛 `TimeoutOverflowWarning` 并把时长**改成 1ms**——
 * 于是「1 月 / 3 月 / 6 月」这种周月级周期会退化成每毫秒触发一次，
 * 用户选「1 月」等于每毫秒打一次上游 HTTP。上限约 24.8 天，而默认值
 * （2 周）恰好卡在安全线内，所以单测没抓到，只有真实档位才会踩。
 *
 * 因此 `arm()` 用 **setTimeout 链**替代 setInterval：每次只排「到下一个真实
 * 触发点」或 `MAX_INTERVAL_MS` 两者中较短的那一段，到期后若还没到真实触发点
 * 就续订下一段。这样任意长的周期都能精确表达，且不会退化。
 */
export const MAX_INTERVAL_MS = 2 ** 31 - 1

/**
 * 时间源与定时器的最小可注入面。
 *
 * 生产环境用系统时钟；单测注入假时钟，避免「真实 setTimeout + 并发线程调度」让
 * 周期断言变成赌时序。只暴露调度器真正用到的三个能力，不把整块 Date 塞进来。
 */
export interface SchedulerClock {
  now(): number
  setTimeout(handler: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
}

export interface SchedulerTask {
  name: string
  intervalMs: number
  run: () => Promise<void> | void
  /** 注册后是否立刻跑一轮；默认 false（首轮等一个完整周期，避免启动期抢资源）。 */
  runOnStart?: boolean
  /** 瞬时运行失败后的退避毫秒；默认不重试（= 0）。 */
  retryBackoffMs?: number
}

interface RegisteredTask extends SchedulerTask {
  timer: ReturnType<typeof setTimeout> | null
  running: boolean
  lastRunAt: number | null
  nextRunAt: number | null
  lastError: string | null
  lastSuccessAt: number | null
  retryTimer: ReturnType<typeof setTimeout> | null
}

export class Scheduler {
  private tasks = new Map<string, RegisteredTask>()
  private started = false
  private readonly clock: SchedulerClock

  constructor(clock: SchedulerClock = systemClock) {
    this.clock = clock
  }

  /**
   * 注册（或覆盖）一个命名任务。同名任务第二次注册会清掉旧的定时器再重挂，
   * 不报错，方便运行时更新周期（`setIntervalMs` 的底层就是它）。
   */
  register(task: SchedulerTask): void {
    const existing = this.tasks.get(task.name)
    if (existing) this.disposeTimers(existing)

    const registered: RegisteredTask = {
      ...task,
      timer: null,
      running: false,
      lastRunAt: null,
      nextRunAt: null,
      lastError: null,
      lastSuccessAt: null,
      retryTimer: null,
    }
    this.tasks.set(task.name, registered)

    if (this.started) this.arm(registered)
  }

  /** 启动所有已注册任务（幂等）。在 `app.on('ready')` 里调用一次。 */
  start(): void {
    if (this.started) return
    this.started = true
    for (const task of this.tasks.values()) this.arm(task)
  }

  /** 停止并清理所有定时器。在 `app.on('before-quit')` 里调用。 */
  stop(): void {
    for (const task of this.tasks.values()) this.disposeTimers(task)
    this.started = false
  }

  /** 注销单个命名任务（清其定时器并从注册表移除）。停掉单个类别时用。 */
  unregister(name: string): void {
    const task = this.tasks.get(name)
    if (!task) return
    this.disposeTimers(task)
    this.tasks.delete(name)
  }

  /** 立即跑一次（不等待周期），仍受串行化守卫约束。 */
  async triggerNow(name: string): Promise<void> {
    const task = this.tasks.get(name)
    if (!task) return
    await this.execute(task)
  }

  /** 运行时改周期：先清旧定时器，再按新间隔重新挂（start 状态保持）。 */
  setIntervalMs(name: string, intervalMs: number): void {
    const task = this.tasks.get(name)
    if (!task) return
    task.intervalMs = intervalMs
    if (this.started) {
      this.disposeTimers(task)
      this.arm(task)
    }
  }

  /** 当前所有任务的状态快照，供 IPC 透传给 UI。 */
  status(): SchedulerTaskStatus[] {
    return Array.from(this.tasks.values()).map(task => ({
      name: task.name,
      intervalMs: task.intervalMs,
      running: task.running,
      lastRunAt: task.lastRunAt,
      nextRunAt: task.nextRunAt,
      lastError: task.lastError,
      lastSuccessAt: task.lastSuccessAt,
    }))
  }

  private arm(task: RegisteredTask): void {
    // 首轮默认**等一个完整周期**再跑：模型清单刷新（尤其聚合/内置要真打上游）不该
    // 在启动瞬间和应用初始化抢资源。需要"启动即热"的任务自行传 `runOnStart: true`。
    task.nextRunAt = this.clock.now() + task.intervalMs
    if (task.runOnStart) void this.execute(task)
    else this.armTimer(task)
  }

  /**
   * 排一段到真实触发点的定时器（不超 `MAX_INTERVAL_MS`）。
   *
   * 用 setTimeout 链而非 setInterval：到点后若还没到真实触发点就续订下一段，
   * 否则执行一次，执行结束后由 `execute` 负责 armTimer 排下一次。
   */
  private armTimer(task: RegisteredTask): void {
    if (!this.started) return
    const remaining = Math.max(0, (task.nextRunAt ?? this.clock.now()) - this.clock.now())
    const delay = Math.min(remaining, MAX_INTERVAL_MS)
    task.timer = this.clock.setTimeout(() => {
      task.timer = null
      if (!this.started) return
      if ((task.nextRunAt ?? 0) > this.clock.now()) {
        // 分片续订：真实触发点还没到，排下一段（周期超过 24.8 天时走这里）。
        this.armTimer(task)
        return
      }
      void this.execute(task)
    }, delay)
  }

  private async execute(task: RegisteredTask): Promise<void> {
    if (!this.started) return
    if (task.running) {
      // 串行化守卫：上一轮还没跑完，这一轮直接跳过，不叠加。
      // 注意仍要续订下一次，否则 setTimeout 链会断（setInterval 是自动续的）。
      this.armTimer(task)
      return
    }
    task.running = true
    task.lastRunAt = this.clock.now()
    task.nextRunAt = this.clock.now() + task.intervalMs
    try {
      await task.run()
      task.lastSuccessAt = this.clock.now()
      task.lastError = null
    } catch (error) {
      // fail-soft：记下来，但不清定时器、不向上抛。
      task.lastError = error instanceof Error ? error.message : String(error)
      if (task.retryBackoffMs && task.retryBackoffMs > 0) {
        task.retryTimer = this.clock.setTimeout(() => {
          task.retryTimer = null
          void this.execute(task).finally(() => this.armTimer(task))
        }, task.retryBackoffMs)
        return
      }
    } finally {
      task.running = false
    }
    // Reschedule only if the task is still registered
    if (this.tasks.has(task.name)) {
      this.armTimer(task)
    }
  }

  private disposeTimers(task: RegisteredTask): void {
    if (task.timer !== null) {
      this.clock.clearTimeout(task.timer)
      task.timer = null
    }
    if (task.retryTimer !== null) {
      this.clock.clearTimeout(task.retryTimer)
      task.retryTimer = null
    }
  }
}

export const scheduler = new Scheduler()
