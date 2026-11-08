/**
 * 「自动领取已完成的成长任务」执行体与文档的后台回归。
 *
 * ⚠️ 与 `auto-checkin-*.test.ts` 同款：被测模块 import 了 vendor 里的兄弟模块，
 * `node --test` 解析不了 `.js` → `.ts`，故用 esbuild 打成临时 bundle 再 import
 * （因此这条用例只能在本地镜像 / CI 里跑，共享盘上 esbuild 会 `spawn EPERM`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT_LLM = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'dshLlm.ts')
const COMPAT_SCHEMASTERY = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'schemastery.ts')

async function loadAutoGrowth(t, exports) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-auto-growth-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: exports.map((line) => line
        .replace('__AUTO_GROWTH__', JSON.stringify(join(VENDOR_SRC, 'auto-growth.ts')))
        .replace('__UTC8__', JSON.stringify(join(VENDOR_SRC, 'utc8-date.ts')))
        .replace('__MODEL_QUEUE__', JSON.stringify(join(VENDOR_SRC, 'model-queue.ts')))).join('\n'),
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

const EXPORTS = [
  'export { createAutoGrowth, sanitizeAutoGrowth, DEFAULT_AUTO_GROWTH, describeGrowthRun, createAutoGrowthStore } from __AUTO_GROWTH__',
  'export { utc8DateString, UTC8_OFFSET_MS } from __UTC8__',
  'export { QODER_BILLING_UTC_OFFSET_MS } from __MODEL_QUEUE__',
]

/** 可控时钟：不用真实 setTimeout，单测零等待。 */
function fakeClock(startMs) {
  let now = startMs
  return {
    now: () => now,
    advance: (ms) => { now += ms },
  }
}

/** 一次成功领取的响应（两域各给一点）。 */
function claimValue(overrides = {}) {
  return {
    accounts: 1,
    summary: {
      accounts: 1,
      claimedTasks: 2,
      failedTasks: 0,
      alreadyClaimedTasks: 1,
      notClaimableTasks: 3,
      errors: 0,
      gained: { credit: 200, energy: 10 },
      ...overrides,
    },
  }
}

function makeGrowth(mod, options) {
  const clock = options.clock ?? fakeClock(Date.UTC(2026, 10, 9, 2, 0, 0))
  const calls = []
  const doc = options.doc ?? { ...mod.DEFAULT_AUTO_GROWTH, enabled: true, decidedBy: 'user' }
  const growth = mod.createAutoGrowth({
    store: {
      kind: 'memory',
      load: () => ({ ...doc }),
      save: async (next) => { Object.assign(doc, next) },
    },
    listProviderIds: async () => (options.providers ?? ['buddy']),
    claim: async (provider) => {
      calls.push(provider)
      const result = options.claimResult ? options.claimResult(provider, calls.length) : { ok: true, value: claimValue() }
      return result
    },
    now: clock.now,
    delayMs: 0,
    retryMs: 60_000,
    // 不排定真实定时器：本用例只验「跑不跑 / 记不记账」，重试排定由 auto-checkin 的同款逻辑覆盖。
    schedule: () => ({ cancel: () => {} }),
    warn: () => {},
  })
  return { growth, calls, clock, doc }
}

test('默认关闭，且缺 decidedBy 的老文档一律按关处理', async (t) => {
  const mod = await loadAutoGrowth(t, EXPORTS)
  assert.equal(mod.DEFAULT_AUTO_GROWTH.enabled, false)
  assert.equal(mod.sanitizeAutoGrowth({ enabled: true }).enabled, false, '没有 decidedBy:user 的 true 不算用户选择')
  assert.equal(mod.sanitizeAutoGrowth({ enabled: true, decidedBy: 'user' }).enabled, true)
  const dirty = mod.sanitizeAutoGrowth({ enabled: 'yes', lastDate: '2026-13-99', providerDates: { buddy: '2026-11-09', '': 'x' } })
  assert.equal(dirty.enabled, false)
  assert.equal(dirty.lastDate, '', '非法日期要回落空串，不能把脏日期当「今天已跑」')
  assert.deepEqual(Object.keys(dirty.providerDates), ['buddy'])
})

test('开关落盘必须带 decidedBy，否则重启后又被读成关闭', async (t) => {
  const mod = await loadAutoGrowth(t, EXPORTS)
  const home = mkdtempSync(join(tmpdir(), 'modelport-auto-growth-'))
  const previous = process.env.DSH_CHANNEL_PACK_STATE_DIR
  process.env.DSH_CHANNEL_PACK_STATE_DIR = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR
    else process.env.DSH_CHANNEL_PACK_STATE_DIR = previous
    rmSync(home, { recursive: true, force: true })
  })
  const store = mod.createAutoGrowthStore({})
  const { growth } = makeGrowth(mod, { doc: { ...mod.DEFAULT_AUTO_GROWTH } })
  const withStore = mod.createAutoGrowth({
    store,
    listProviderIds: async () => [],
    claim: async () => ({ ok: true, value: claimValue() }),
    delayMs: 0,
    schedule: () => ({ cancel: () => {} }),
  })
  await withStore.setEnabled(true)
  const raw = JSON.parse(readFileSync(join(home, 'channel-pack', 'auto-growth.json'), 'utf8'))
  assert.equal(raw.decidedBy, 'user', '漏写 decidedBy 会让开关每次重启都变回关闭')
  assert.equal(store.load().enabled, true)
  void growth
})

test('领到就记账：当天不再重复跑，跨日后重新跑', async (t) => {
  const mod = await loadAutoGrowth(t, EXPORTS)
  const { growth, calls, clock } = makeGrowth(mod, {})
  await growth.runIfDue()
  assert.deepEqual(calls, ['buddy'])
  assert.equal(growth.state().ranToday, true)
  assert.match(growth.state().lastResult, /领到 2 项/)
  assert.match(growth.state().lastResult, /\+200积分/)
  assert.match(growth.state().lastResult, /\+10能量/)

  await growth.runIfDue()
  assert.deepEqual(calls, ['buddy'], '同一天第二次不该再发请求')

  clock.advance(25 * 3600_000)
  await growth.runIfDue()
  assert.deepEqual(calls, ['buddy', 'buddy'], '跨日后要重新跑')
})

test('有失败项时留在 pending，不记「今天已完成」', async (t) => {
  const mod = await loadAutoGrowth(t, EXPORTS)
  const { growth, doc } = makeGrowth(mod, {
    claimResult: () => ({ ok: true, value: claimValue({ failedTasks: 1 }) }),
  })
  await growth.runIfDue()
  assert.equal(growth.state().ranToday, false)
  assert.deepEqual(growth.state().pendingProviders, ['buddy'])
  assert.equal(doc.providerDates.buddy, undefined)
})

test('整号失败（如凭据失效）也算未完成，稍后重试', async (t) => {
  const mod = await loadAutoGrowth(t, EXPORTS)
  const { growth } = makeGrowth(mod, {
    claimResult: () => ({ ok: true, value: claimValue({ errors: 1, accounts: 0 }) }),
  })
  await growth.runIfDue()
  assert.equal(growth.state().pending, 1)
})

test('RPC 层报错（ok:false）不记完成，也不抛出', async (t) => {
  const mod = await loadAutoGrowth(t, EXPORTS)
  const { growth, calls } = makeGrowth(mod, {
    claimResult: () => ({ ok: false, error: { code: 'host_error', message: '渠道运行时未启动' } }),
  })
  await growth.runIfDue()
  assert.equal(calls.length, 1)
  assert.equal(growth.state().ranToday, false)
  assert.equal(growth.state().pending, 1)
})

test('开关关闭时一轮都不跑', async (t) => {
  const mod = await loadAutoGrowth(t, EXPORTS)
  const { growth, calls } = makeGrowth(mod, { doc: { ...mod.DEFAULT_AUTO_GROWTH, enabled: false } })
  await growth.runIfDue()
  assert.deepEqual(calls, [])
})

test('结果文案把两个量纲分开说，零的那一档不出现', async (t) => {
  const mod = await loadAutoGrowth(t, EXPORTS)
  const text = mod.describeGrowthRun({
    accounts: 1,
    claimedTasks: 1,
    failedTasks: 0,
    alreadyClaimedTasks: 2,
    notClaimableTasks: 0,
    errors: 0,
    gained: { credit: 100, energy: 0 },
  })
  assert.match(text, /\+100积分/)
  assert.doesNotMatch(text, /能量/, '能量为 0 时不该出现「+0能量」')
  assert.match(text, /2 项此前已领/)
})

test('UTC+8 日界与计费口径同源（两处算出的日期串必须一致）', async (t) => {
  const mod = await loadAutoGrowth(t, EXPORTS)
  assert.equal(mod.UTC8_OFFSET_MS, mod.QODER_BILLING_UTC_OFFSET_MS,
    'UTC+8 偏移必须与 model-queue 的计费口径相同')
  // 跨日边界两侧各取几个点：UTC 15:59 / 16:00 是 UTC+8 的分界。
  const samples = [
    Date.UTC(2026, 10, 8, 15, 59, 0),
    Date.UTC(2026, 10, 8, 16, 0, 0),
    Date.UTC(2026, 10, 9, 0, 0, 0),
    Date.UTC(2026, 11, 31, 16, 30, 0),
  ]
  for (const ms of samples) {
    const expected = new Date(ms + mod.QODER_BILLING_UTC_OFFSET_MS).toISOString().slice(0, 10)
    assert.equal(mod.utc8DateString(ms), expected, `时间戳 ${ms} 的 UTC+8 日期不一致`)
  }
  assert.equal(mod.utc8DateString(Date.UTC(2026, 10, 8, 16, 0, 0)), '2026-11-09')
})