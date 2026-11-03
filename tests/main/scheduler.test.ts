import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Scheduler } from '../../src/main/scheduler/Scheduler.ts'

const DAY_MS = 24 * 60 * 60 * 1000

function tick(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('runs a task on schedule and records lastRunAt', async () => {
  const scheduler = new Scheduler()
  let runs = 0
  scheduler.register({ name: 't', intervalMs: 20, run: () => { runs++ } })
  scheduler.start()
  // 首轮等一个周期（默认不立即跑），60ms 覆盖约 3 个窗口。
  await tick(80)
  scheduler.stop()
  assert.ok(runs >= 2, `expected >=2 runs, got ${runs}`)
  const status = scheduler.status().find(s => s.name === 't')
  assert.ok(status)
  assert.ok(status.lastRunAt !== null)
  assert.equal(status.lastError, null)
})

test('runOnStart fires one round immediately on register+start', async () => {
  const scheduler = new Scheduler()
  let runs = 0
  scheduler.register({ name: 'hot', intervalMs: 10_000, run: () => { runs++ }, runOnStart: true })
  scheduler.start()
  await tick(20)
  scheduler.stop()
  assert.equal(runs, 1, 'runOnStart should fire exactly once immediately')
})

test('serializes overlapping runs: never more than one in flight', async () => {
  const scheduler = new Scheduler()
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
      await tick(40) // 比周期长，下一轮应被跳过
      active--
    },
  })
  scheduler.start()
  await tick(120) // 约 8 个周期窗口，但每次 run 40ms 串行
  scheduler.stop()
  // 真正的不变量：任意时刻最多一个 run 在执行。
  assert.equal(maxActive, 1, 'overlapping runs were allowed to overlap')
  assert.ok(runs >= 2, `expected repeated runs, got ${runs}`)
})

test('fail-soft: a throwing task keeps the timer alive', async () => {
  const scheduler = new Scheduler()
  let runs = 0
  scheduler.register({
    name: 'flaky',
    intervalMs: 10,
    run: async () => {
      runs++
      // 每一轮都抛：若定时器被清掉，runs 会停在 1。
      throw new Error('boom')
    },
  })
  scheduler.start()
  await tick(120)
  scheduler.stop()
  const status = scheduler.status().find(s => s.name === 'flaky')
  assert.ok(status)
  // 第一次抛了，但定时器没被清掉，后续仍继续跑。
  assert.ok(runs >= 3, `expected continued runs after throw, got ${runs}`)
  // 最后仍然是失败态（最近一次），但任务没停摆。
  assert.equal(status.lastError, 'boom')
  assert.equal(status.running, false)
})

test('unregister stops a single task without killing others', async () => {
  const scheduler = new Scheduler()
  let a = 0
  let b = 0
  scheduler.register({ name: 'a', intervalMs: 15, run: () => { a++ } })
  scheduler.register({ name: 'b', intervalMs: 15, run: () => { b++ } })
  scheduler.start()
  await tick(50)
  scheduler.unregister('a')
  const afterUnregister = a
  await tick(50)
  scheduler.stop()
  assert.ok(a >= 2, 'a should have run before unregister')
  assert.ok(b >= 4, 'b should keep running after a was unregistered')
  assert.equal(a, afterUnregister, 'a must not run after unregister')
})

test('triggerNow runs immediately; concurrent triggers are serialized', async () => {
  const scheduler = new Scheduler()
  let runs = 0
  scheduler.register({ name: 't', intervalMs: 10_000, run: async () => { runs++; await tick(20) } })
  scheduler.start()
  // 周期 10s 不会自然触发；两次**并发** triggerNow 中第二次应被串行化守卫跳过。
  const first = scheduler.triggerNow('t')
  const second = scheduler.triggerNow('t')
  await Promise.all([first, second])
  scheduler.stop()
  assert.equal(runs, 1, 'concurrent trigger must not overlap')
})

test('setIntervalMs reschedules without duplicate timers', async () => {
  const scheduler = new Scheduler()
  let runs = 0
  scheduler.register({ name: 't', intervalMs: 15, run: () => { runs++ } })
  scheduler.start()
  await tick(50)
  const firstBurst = runs
  scheduler.setIntervalMs('t', 30)
  await tick(50)
  scheduler.stop()
  assert.ok(firstBurst >= 2, 'should run at original interval')
  // 改周期后不应出现定时器叠加（runs 不会因叠加而暴增）
  assert.ok(runs < firstBurst * 4, `runs should not multiply via duplicate timers, got ${runs}`)
})

test('sub-25-day intervals are not degraded to high-frequency by Node clamp', async () => {
  const scheduler = new Scheduler()
  let runs = 0
  // 30 天 = 2.59e9 ms，超过 Node 原生 setInterval 的 2^31−1（≈24.8 天）上限。
  // 原 bug：Node 把超限时长 clamp 成 1ms，于是 500ms 内触发 ~500 次——用户在 UI
  // 选「1 月」等于每毫秒打一次上游 HTTP。分片实现必须保持"到真实触发点才跑一次"。
  scheduler.register({ name: 'monthly', intervalMs: 30 * DAY_MS, run: () => { runs++ } })
  scheduler.start()
  await tick(500)
  scheduler.stop()
  assert.ok(runs <= 1, `30-day interval must not fire more than once in 500ms, got ${runs}`)
  // nextRunAt 仍按真实周期算（约 30 天后），供 UI 展示，不因分片而失真。
  const status = scheduler.status().find(s => s.name === 'monthly')
  assert.ok(status)
  assert.ok(
    status.nextRunAt !== null && status.nextRunAt - Date.now() > 29 * DAY_MS,
    `nextRunAt should reflect a real ~30-day horizon, got ${status.nextRunAt}`,
  )
})
