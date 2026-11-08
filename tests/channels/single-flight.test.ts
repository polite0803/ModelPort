import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SingleFlight } from '../../src/main/providers/accountChannels/singleFlight.ts'

/**
 * 目录扫描的单飞与代次。
 *
 * 判据是「真共享 / 真作废」，不是源码里出现过 `SingleFlight`：
 * `models()` 只在整轮扫完才回填缓存，并发调用若各跑一轮，就是 2026-11-09
 * 429 风暴里同一秒 5 条「模型窗口覆盖」的那种读放大。
 */

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

test('并发调用共享同一轮，工作函数只跑一次', async () => {
  const flight = new SingleFlight<number>()
  const gate = deferred<void>()
  let runs = 0
  const work = async (version: number): Promise<number> => {
    runs += 1
    await gate.promise
    return version
  }

  const first = flight.run(work)
  const second = flight.run(work)
  assert.equal(runs, 1, '第二个调用必须并入在途那一轮')
  gate.resolve()
  assert.deepEqual(await Promise.all([first, second]), [0, 0])
})

test('一轮结束后下一次是新的一轮', async () => {
  const flight = new SingleFlight<number>()
  let runs = 0
  const work = async (): Promise<number> => {
    runs += 1
    return runs
  }
  assert.equal(await flight.run(work), 1)
  assert.equal(await flight.run(work), 2)
  assert.equal(runs, 2)
})

test('失效后：旧轮次拿到旧代次，新调用另起一轮且不被旧轮次收尾清掉', async () => {
  const flight = new SingleFlight<string>()
  const gate = deferred<void>()
  const versions: number[] = []
  const first = flight.run(async (version) => {
    versions.push(version)
    await gate.promise
    return `old-${version}`
  })
  assert.equal(flight.version, 0)

  flight.invalidate()
  assert.equal(flight.version, 1)
  const second = flight.run(async (version) => {
    versions.push(version)
    return `new-${version}`
  })

  assert.deepEqual(versions, [0, 1], '失效后新调用不许并入旧轮次')
  gate.resolve()
  assert.equal(await first, 'old-0', '旧轮次仍把结果交给自己那批调用方')
  assert.equal(await second, 'new-1')

  // 旧轮次的收尾不能抹掉「当前没有在途」之外的东西：下一轮照常开跑。
  const third = await flight.run(async (version) => `third-${version}`)
  assert.equal(third, 'third-1')
})

test('一轮失败不粘住：下一次调用重新开跑', async () => {
  const flight = new SingleFlight<number>()
  let runs = 0
  await assert.rejects(flight.run(async () => {
    runs += 1
    throw new Error('boom')
  }), /boom/)
  assert.equal(await flight.run(async () => {
    runs += 1
    return runs
  }), 2)
})