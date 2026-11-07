/**
 * 自动签到把「凭据失效」与「人数过多」分开（2026-11-08）。
 *
 * 旧行为：两者都显示「N 个失败，稍后重试」。前者再试一千次也不会变（死令牌），
 * 后者应当保留 pending 自动重试。本用例同时锁死**终态判定**：401 的渠道当天
 * 不再每 30 分钟空转，9074 的渠道继续补领。
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

async function loadAutoCheckin(t: { after(fn: () => void): void }) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-auto-checkin-text-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export {
        createAutoCheckin,
        DEFAULT_AUTO_CHECKIN,
        describeChannel,
      } from ${JSON.stringify(join(VENDOR_SRC, 'auto-checkin.ts'))}`,
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

/** 2026-11-08 09:00（UTC+8）。 */
const NOW_MS = Date.UTC(2026, 10, 8, 1, 0, 0)

class MemoryStore {
  kind = 'memory'
  constructor(doc: { [key: string]: unknown }) { this.doc = structuredClone(doc) }
  doc: { [key: string]: unknown }
  load() { return structuredClone(this.doc) }
  async save(doc: { [key: string]: unknown }) { this.doc = structuredClone(doc) }
}

function summary(overrides: { [key: string]: unknown } = {}) {
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

function failure(code: number, message: string) {
  return { accountId: 'a1', nickname: 'a1', outcome: { kind: 'failed', code, message } }
}

async function runOnce(t: { after(fn: () => void): void }, results: unknown[]) {
  const { createAutoCheckin, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const store = new MemoryStore({
    ...DEFAULT_AUTO_CHECKIN,
    enabled: true,
    decidedBy: 'user',
  })
  const runner = createAutoCheckin({
    store,
    listProviderIds: async () => ['demo'],
    claim: async () => ({
      ok: true,
      value: {
        results,
        summary: summary({ failed: results.length }),
      },
    }),
    now: () => NOW_MS,
    delayMs: 0,
    retryMs: 60_000,
    schedule: () => ({ cancel() {} }),
  })
  await runner.runIfDue()
  return runner.state()
}

test('401 归为「需重新登录」，且当天不再留在 pending', async (t) => {
  const state = await runOnce(t, [failure(401, '凭据已失效（HTTP 401），请重新登录该账号')])
  assert.equal(state.pending, 0, '凭据失效是终态，不应每 30 分钟空转')
  assert.match(state.channels[0].text, /需重新登录/)
  assert.doesNotMatch(state.channels[0].text, /稍后重试/)
  // 摘要行不能与逐渠道文案自相矛盾。
  assert.match(state.lastResult, /需重新登录/)
  assert.doesNotMatch(state.lastResult, /个失败/)
})

test('已处理渠道的逐渠道理由不会被下一轮覆盖', async (t) => {
  const { createAutoCheckin, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const store = new MemoryStore({
    ...DEFAULT_AUTO_CHECKIN,
    enabled: true,
    decidedBy: 'user',
  })
  let calls = 0
  const runner = createAutoCheckin({
    store,
    listProviderIds: async () => ['demo'],
    claim: async () => {
      calls += 1
      return {
        ok: true,
        value: {
          results: [failure(401, '凭据已失效（HTTP 401），请重新登录该账号')],
          summary: summary({ failed: 1 }),
        },
      }
    },
    now: () => NOW_MS,
    delayMs: 0,
    retryMs: 0,
    schedule: () => ({ cancel() {} }),
  })
  await runner.runIfDue()
  await runner.runIfDue()
  const state = runner.state()
  assert.equal(calls, 1, '当天已处理的渠道不应再次请求上游')
  assert.match(state.channels[0].text, /需重新登录/, '逐渠道理由必须跨轮保留')
})

test('9074 归为「人数过多」，保留 pending 继续补领', async (t) => {
  const state = await runOnce(t, [failure(9074, '当前参与用户太多，请稍后再试')])
  assert.equal(state.pending, 1, '人数过多是瞬时失败，必须继续重试')
  assert.match(state.channels[0].text, /人数过多/)
  assert.match(state.channels[0].text, /稍后重试/)
})

test('未知失败仍显示「失败 + 稍后重试」', async (t) => {
  const state = await runOnce(t, [failure(-1, '网络异常')])
  assert.equal(state.pending, 1)
  assert.match(state.channels[0].text, /1 个失败/)
  assert.match(state.channels[0].text, /稍后重试/)
})

test('describeChannel：混合失败按可操作结论分档', async (t) => {
  const { describeChannel } = await loadAutoCheckin(t)
  const text = describeChannel(
    summary({ failed: 3 }),
    [
      failure(401, '凭据已失效'),
      failure(9074, '人数过多'),
      failure(-1, '网络异常'),
    ],
  )
  assert.match(text, /1 个需重新登录/)
  assert.match(text, /1 个人数过多/)
  assert.match(text, /1 个失败/)
  assert.match(text, /稍后重试/)
})
