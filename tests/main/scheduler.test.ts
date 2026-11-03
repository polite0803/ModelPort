import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Scheduler } from '../../src/main/scheduler/Scheduler.ts'
import type { SchedulerClock } from '../../src/main/scheduler/Scheduler.ts'

const DAY_MS = 24 * 60 * 60 * 1000

interface FakeTimer {
  due: number
  seq: number
  handler: () => void
}

/**
 * 受控时钟：只推进到断言需要的时间点，按 due/注册顺序串行执行定时器。
 *
 * 原来的测试用真实 `setTimeout` + 固定 sleep，全量并发跑时线程调度会把
 * 「80ms 内至少 2 轮」变成赌时序。这里把时间完全交给测试，周期语义可以
 * 断言到**精确次数**，而不是放宽阈值。
 */
class FakeClock implements SchedulerClock {
  private current = 0
  private seq = 0
  private readonly timers = new Map<number, FakeTimer>()

  now(): number {
    return this.current
  }

  setTimeout(handler: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const handle = ++this.seq
    this.timers.set(handle, {
      due: this.current + Math.max(0, delayMs),
      seq: handle,
      handler,
    })
    return handle as unknown as ReturnType<typeof setTimeout>
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>): void {
    this.timers.delete(handle as unknown as number)
  }

  /** 任务内部用它模拟耗时，等价于真实 `setTimeout(resolve, ms)`。 */
  wait(ms: number): Promise<void> {
    return new Promise(resolve => this.setTimeout(resolve, ms))
  }

  /**
   * 推进 `ms`，依次触发到期定时器；每触发一个就让微任务链跑完，
   * 这样异步 `run()` 完成后的续订才会被下一轮看到。
   */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms
    for (;;) {
      await flushMicrotasks()
      let nextHandle: number | null = null
      let nextTimer: FakeTimer | null = null
      for (const [handle, timer] of this.timers) {
        if (timer.due > target) continue
        if (
          nextTimer === null
          || timer.due < nextTimer.due
          || (timer.due === nextTimer.due && timer.seq < nextTimer.seq)
        ) {
          nextHandle = handle
          nextTimer = timer
        }
      }
      if (nextHandle === null || nextTimer === null) break
      this.timers.delete(nextHandle)
      this.current = Math.max(this.current, nextTimer.due)
      nextTimer.handler()
    }
    await flushMicrotasks()
    this.current = Math.max(this.current, target)
    await flushMicrotasks()
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

test('runs a task on schedule and records lastRunAt', async () => {
  const clock = new FakeClock()
  const scheduler = new Scheduler(clock)
  let runs = 0
  scheduler.register({ name: 't', intervalMs: 20, run: () => { runs++ } })
  scheduler.start()
  // 首轮等一个周期：20/40/60/80 各一次，80 之后的下一次排在 100。
  await clock.advance(80)
  scheduler.stop()
  assert.equal(runs, 4, 'a 20ms interval must fire once per window, not "at least twice"')
  const status = scheduler.status().find(s => s.name === 't')
  assert.ok(status)
  assert.equal(status.lastRunAt, 80)
  assert.equal(status.nextRunAt, 100)
  assert.equal(status.lastError, null)
})

test('runOnStart fires one round immediately on register+start', async () => {
  const clock = new FakeClock()
  const scheduler = new Scheduler(clock)
  let runs = 0
  scheduler.register({ name: 'hot', intervalMs: 10_000, run: () => { runs++ }, runOnStart: true })
  scheduler.start()
  await clock.advance(20)
  scheduler.stop()
  assert.equal(runs, 1, 'runOnStart should fire exactly once immediately')
  assert.equal(scheduler.status().find(s => s.name === 'hot')?.lastRunAt, 0)
})

test('serializes overlapping runs: never more than one in flight', async () => {
  const clock = new FakeClock()
  const scheduler = new Scheduler(clock)
  let active = 0
  let maxActive = 0
  let runs = 0
  scheduler.register({
    name: 'slow',
    intervalMs: 15,
    run: async () => {
      runs++
      active++
      maxActive = Math.max(maxActive, active)
      await clock.wait(40) // 比周期长：下一轮在 run 结束后才续订，不得并发
      active--
    },
  })
  scheduler.start()
  await clock.advance(120)
  scheduler.stop()
  // 15 起跑 40ms → 55 续订并立即补一轮 → 95 再补一轮；110 时仍在跑，下一轮排到 135。
  assert.equal(maxActive, 1, 'overlapping runs were allowed to overlap')
  assert.equal(runs, 3, 'serialized runs should fire at 15, 55 and 95')
})

test('fail-soft: a throwing task keeps the timer alive', async () => {
  const clock = new FakeClock()
  const scheduler = new Scheduler(clock)
  let runs = 0
  scheduler.register({
    name: 'flaky',
    intervalMs: 10,
    run: async () => {
      runs++
      throw new Error('boom')
    },
  })
  scheduler.start()
  await clock.advance(120)
  scheduler.stop()
  const status = scheduler.status().find(s => s.name === 'flaky')
  assert.ok(status)
  // 第一次抛了，但定时器没被清掉：10..120 共 12 轮。
  assert.equal(runs, 12, 'the timer must keep firing after every throw')
  assert.equal(status.lastError, 'boom')
  assert.equal(status.running, false)
})

test('unregister stops a single task without killing others', async () => {
  const clock = new FakeClock()
  const scheduler = new Scheduler(clock)
  let a = 0
  let b = 0
  scheduler.register({ name: 'a', intervalMs: 15, run: () => { a++ } })
  scheduler.register({ name: 'b', intervalMs: 15, run: () => { b++ } })
  scheduler.start()
  await clock.advance(50)
  scheduler.unregister('a')
  const afterUnregister = a
  await clock.advance(50)
  scheduler.stop()
  assert.equal(a, 3, 'a should have run at 15/30/45 before unregister')
  assert.equal(b, 6, 'b should keep running at 15..90')
  assert.equal(a, afterUnregister, 'a must not run after unregister')
})

test('triggerNow runs immediately; concurrent triggers are serialized', async () => {
  const clock = new FakeClock()
  const scheduler = new Scheduler(clock)
  let runs = 0
  scheduler.register({ name: 't', intervalMs: 10_000, run: async () => { runs++; await clock.wait(20) } })
  scheduler.start()
  // 周期 10s 不会自然触发；两次**并发** triggerNow 中第二次应被串行化守卫跳过。
  const first = scheduler.triggerNow('t')
  const second = scheduler.triggerNow('t')
  const settled = Promise.all([first, second])
  await clock.advance(20)
  await settled
  scheduler.stop()
  assert.equal(runs, 1, 'concurrent trigger must not overlap')
  assert.equal(scheduler.status().find(s => s.name === 't')?.lastRunAt, 0)
})

test('setIntervalMs reschedules without duplicate timers', async () => {
  const clock = new FakeClock()
  const scheduler = new Scheduler(clock)
  let runs = 0
  scheduler.register({ name: 't', intervalMs: 15, run: () => { runs++ } })
  scheduler.start()
  await clock.advance(50)
  const firstBurst = runs
  scheduler.setIntervalMs('t', 30)
  await clock.advance(50)
  scheduler.stop()
  assert.equal(firstBurst, 3, 'three 15ms windows in 50ms')
  // 改周期后旧定时器被清掉：只剩 80 那一轮，而不是 60/75/90 叠加。
  assert.equal(runs, 4, `expected exactly one run after reschedule, got ${runs}`)
  assert.ok(runs < firstBurst * 4, 'runs should not multiply via duplicate timers')
})

test('sub-25-day intervals are not degraded to high-frequency by Node clamp', async () => {
  const clock = new FakeClock()
  const scheduler = new Scheduler(clock)
  let runs = 0
  // 30 天 = 2.59e9 ms，超过 Node 原生 setInterval 的 2^31−1（≈24.8 天）上限。
  // 原 bug：Node 把超限时长 clamp 成 1ms，于是 500ms 内触发 ~500 次——用户在 UI
  // 选「1 月」等于每毫秒打一次上游 HTTP。分片实现必须保持"到真实触发点才跑一次"。
  scheduler.register({ name: 'monthly', intervalMs: 30 * DAY_MS, run: () => { runs++ } })
  scheduler.start()
  await clock.advance(500)
  assert.equal(runs, 0, 'a 30-day interval must not fire in the first 500ms')
  // nextRunAt 仍按真实周期算（约 30 天后），供 UI 展示，不因分片而失真。
  const status = scheduler.status().find(s => s.name === 'monthly')
  assert.ok(status)
  assert.equal(status.nextRunAt, 30 * DAY_MS)
  // 推进到真实触发点：分片续订后只执行一次，而不是每段都执行。
  await clock.advance(30 * DAY_MS)
  scheduler.stop()
  assert.equal(runs, 1, 'sharded 30-day timer must fire exactly once at the true horizon')
  assert.equal(scheduler.status().find(s => s.name === 'monthly')?.nextRunAt, 60 * DAY_MS)
})
