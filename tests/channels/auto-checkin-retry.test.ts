/**
 * 「自动领取签到积分」按渠道补领的回归。
 *
 * 锁死三条行为（旧实现是整轮一个 `lastDate`，一个渠道成功就把当天记掉）：
 * 1. 某个渠道失败 / 声明 `retryLater`（Qoder 10:00 刷新前）时留在待办，
 *    下一轮**只重跑它**，已完成的渠道当天不再发请求；
 * 2. 跨过 UTC+8 零点后，下一次重试会为新的一天重新跑全部渠道；
 * 3. 全部完成后的重试轮是零请求。
 *
 * ⚠️ 与 `auto-checkin-persistence.test.ts` 同款：被测模块 import 了 vendor 里的
 * 兄弟模块，`node --test` 解析不了 `.js` → `.ts`，故用 esbuild 打成临时 bundle
 * 再 import。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT_LLM = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'dshLlm.ts')
const COMPAT_SCHEMASTERY = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'schemastery.ts')

async function loadAutoCheckin(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-auto-checkin-retry-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { createAutoCheckin, DEFAULT_AUTO_CHECKIN } from ${JSON.stringify(join(VENDOR_SRC, 'auto-checkin.ts'))}`,
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    alias: {
      '@deepseek-ai/dsh-llm': COMPAT_LLM,
      '@deepseek-ai/schemastery': COMPAT_SCHEMASTERY,
    },
  })
  return await import(pathToFileURL(outfile).href)
}

/** 2026-11-07 09:00（UTC+8）—— Qoder 每日 10:00 刷新之前。 */
const START_MS = Date.UTC(2026, 10, 7, 1, 0, 0)
const RETRY_MS = 60_000

function summary(overrides = {}) {
  return {
    claimed: 0,
    totalCredit: 0,
    alreadyClaimed: 0,
    inactive: 0,
    failed: 0,
    coversToday: 0,
    retryLater: false,
    totalByUnit: { token: 0, credit: 0 },
    ...overrides,
  }
}

class MemoryStore {
  constructor(doc) {
    this.kind = 'memory'
    this.doc = doc
  }
  load() {
    return structuredClone(this.doc)
  }
  async save(doc) {
    this.doc = structuredClone(doc)
  }
}

/**
 * 装配一个可控的执行体。
 *
 * `behaviour[provider]` 返回 summary；返回 `{ ok: false, error }` 表示该渠道的
 * claim 失败（模拟 `unsupported provider` 等信封错误）。
 */
function setup(createAutoCheckin, DEFAULT_AUTO_CHECKIN, providers, behaviour, options = {}) {
  let now = options.nowMs ?? START_MS
  const timers = []
  const calls = []
  const store = new MemoryStore({
    ...DEFAULT_AUTO_CHECKIN,
    enabled: options.enabled ?? true,
    decidedBy: 'user',
  })
  const auto = createAutoCheckin({
    store,
    listProviderIds: async () => providers,
    claim: async (provider) => {
      calls.push(provider)
      const value = behaviour[provider]()
      if (value && value.ok === false) return value
      return { ok: true, value: { results: [], summary: value } }
    },
    now: () => now,
    delayMs: options.delayMs,
    retryMs: RETRY_MS,
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false, fired: false }
      timers.push(timer)
      return { cancel: () => { timer.cancelled = true } }
    },
    warn: () => {},
  })
  return {
    auto,
    store,
    calls,
    timers,
    advance: (ms) => { now += ms },
    /** 触发最近一次排定的重试，并等这一轮跑完。 */
    fireRetry: async () => {
      const timer = [...timers].reverse().find((entry) => !entry.cancelled && !entry.fired && entry.ms === RETRY_MS)
      assert.ok(timer, '应当已排定下一次重试')
      timer.fired = true
      timer.fn()
      await auto.runIfDue()
    },
  }
}

test('失败的渠道当天补领，已完成的渠道不重复请求', async (t) => {
  const { createAutoCheckin, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const behaviour = {
    a: () => summary({ claimed: 1, coversToday: 1 }),
    b: () => summary({ failed: 1 }),
  }
  const { auto, store, calls, advance, fireRetry } = setup(
    createAutoCheckin, DEFAULT_AUTO_CHECKIN, ['a', 'b'], behaviour,
  )

  await auto.runIfDue()
  assert.equal(auto.state().ranToday, false, '有渠道失败时不能把今天记成已完成')
  assert.deepEqual(auto.state().pendingProviders, ['b'])
  assert.equal(store.doc.lastDate, '', '整轮未完成时不写 lastDate')
  assert.equal(store.doc.providerDates.a, '2026-11-07', '已完成的渠道要按天记账')
  assert.deepEqual(calls, ['a', 'b'])

  advance(RETRY_MS)
  behaviour.b = () => summary({ claimed: 1, coversToday: 1 })
  await fireRetry()

  assert.equal(auto.state().ranToday, true)
  assert.equal(auto.state().pending, 0)
  assert.deepEqual(calls, ['a', 'b', 'b'], '重试只跑未完成的 b，a 不再发请求')
})

test('同一渠道「部分成功 + 部分失败」也保持待办', async (t) => {
  const { createAutoCheckin, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const behaviour = { a: () => summary({ claimed: 1, coversToday: 1, failed: 1 }) }
  const { auto } = setup(createAutoCheckin, DEFAULT_AUTO_CHECKIN, ['a'], behaviour)

  await auto.runIfDue()
  assert.deepEqual(auto.state().pendingProviders, ['a'])
  assert.equal(auto.state().ranToday, false, '失败账号还要在下一轮重试')
})

test('Qoder 刷新前（retryLater）保持待办，10:00 之后补领', async (t) => {
  const { createAutoCheckin, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  let refreshed = false
  const behaviour = {
    qoder: () => refreshed
      ? summary({ claimed: 1, coversToday: 1 })
      : summary({ inactive: 1, retryLater: true }),
  }
  const { auto, advance, fireRetry } = setup(createAutoCheckin, DEFAULT_AUTO_CHECKIN, ['qoder'], behaviour)

  await auto.runIfDue()
  assert.deepEqual(auto.state().pendingProviders, ['qoder'])
  assert.equal(auto.state().ranToday, false)

  advance(60 * 60_000)
  refreshed = true
  await fireRetry()

  assert.equal(auto.state().ranToday, true)
  assert.equal(auto.state().pending, 0)
})

test('当天全部完成后的重试轮是零请求', async (t) => {
  const { createAutoCheckin, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const behaviour = { a: () => summary({ alreadyClaimed: 1, coversToday: 1 }) }
  const { auto, calls, fireRetry } = setup(createAutoCheckin, DEFAULT_AUTO_CHECKIN, ['a'], behaviour)

  await auto.runIfDue()
  assert.equal(auto.state().ranToday, true)
  await fireRetry()
  assert.deepEqual(calls, ['a'], '已完成渠道不应在重试轮再次请求')
})

test('跨 UTC+8 零点后为新的一天重新领取', async (t) => {
  const { createAutoCheckin, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const behaviour = { a: () => summary({ claimed: 1, coversToday: 1 }) }
  const { auto, calls, advance, fireRetry } = setup(createAutoCheckin, DEFAULT_AUTO_CHECKIN, ['a'], behaviour)

  await auto.runIfDue()
  assert.equal(auto.state().ranToday, true)

  advance(24 * 60 * 60_000)
  assert.equal(auto.state().ranToday, false, '跨日后旧日期不再算今天')
  await fireRetry()

  assert.deepEqual(calls, ['a', 'a'])
  assert.equal(auto.state().ranToday, true)
})

test('zcode / 无签到接口 / 账号已停服都记为当天已处理', async (t) => {
  const { createAutoCheckin, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const behaviour = {
    zcode: () => { throw new Error('zcode 不应被自动签到调用') },
    cline: () => ({ ok: false, error: { code: 'bad-request', message: 'unsupported provider: cline' } }),
    parked: () => summary({ inactive: 1 }),
  }
  const { auto, calls } = setup(
    createAutoCheckin, DEFAULT_AUTO_CHECKIN, ['zcode', 'cline', 'parked'], behaviour,
  )

  await auto.runIfDue()
  assert.deepEqual(calls, ['cline', 'parked'], 'zcode 必须在任何上游请求之前被排除')
  assert.equal(auto.state().ranToday, true)
  assert.equal(auto.state().pending, 0)
})

test('start() 延迟后跑首轮，并排定当天重试；stop() 取消排定', async (t) => {
  const { createAutoCheckin, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const behaviour = { a: () => summary({ claimed: 1, coversToday: 1 }) }
  const { auto, calls, timers } = setup(
    createAutoCheckin, DEFAULT_AUTO_CHECKIN, ['a'], behaviour, { delayMs: 30_000 },
  )

  auto.start()
  assert.deepEqual(calls, [], '首轮要等延迟结束')
  const first = timers.find((entry) => entry.ms === 30_000)
  assert.ok(first, '应排定首轮延迟任务')
  first.fn()
  await auto.runIfDue()
  assert.deepEqual(calls, ['a'])
  assert.ok(timers.some((entry) => entry.ms === RETRY_MS && !entry.cancelled), '首轮后应排定重试')

  auto.stop()
  const retries = timers.filter((entry) => entry.ms === RETRY_MS && !entry.fired)
  assert.ok(retries.length > 0 && retries.every((entry) => entry.cancelled), 'stop 应取消未执行的重试')
})
