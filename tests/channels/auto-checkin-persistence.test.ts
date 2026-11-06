/**
 * 「自动领取签到积分」开关的持久化回归。
 *
 * 锁死 2026-11-05 默认值翻转引入的缺陷：`FileAutoCheckinStore.save()` 漏写
 * `decidedBy`，而 `sanitizeAutoCheckin()` 只认「`decidedBy === 'user'` 且
 * `enabled === true`」为开启 —— 用户打开开关后每次重启都变回关闭，自动领取
 * 再也不会在启动时跑。
 *
 * ⚠️ 与 `lobsterai-credits.test.ts` 同款：被测模块 import 了 vendor 里的兄弟模块，
 * `node --test` 解析不了 `.js` → `.ts`，故用 esbuild 打成临时 bundle 再 import。
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
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-auto-checkin-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { createAutoCheckinStore, sanitizeAutoCheckin, DEFAULT_AUTO_CHECKIN } from ${JSON.stringify(join(VENDOR_SRC, 'auto-checkin.ts'))}`,
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

/** 指向临时 state 目录的文档后端（`resolveChannelPackHome` 认这个环境变量）。 */
function storeInTempHome(t, createAutoCheckinStore) {
  const home = mkdtempSync(join(tmpdir(), 'modelport-auto-checkin-'))
  const previous = process.env.DSH_CHANNEL_PACK_STATE_DIR
  process.env.DSH_CHANNEL_PACK_STATE_DIR = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_CHANNEL_PACK_STATE_DIR
    else process.env.DSH_CHANNEL_PACK_STATE_DIR = previous
    rmSync(home, { recursive: true, force: true })
  })
  return { home, store: createAutoCheckinStore({}) }
}

test('用户打开开关后 decidedBy 必须落盘，重启（重新 load）仍是开启', async (t) => {
  const { createAutoCheckinStore, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const { store } = storeInTempHome(t, createAutoCheckinStore)
  await store.save({ ...DEFAULT_AUTO_CHECKIN, enabled: true, decidedBy: 'user' })

  const reloaded = createAutoCheckinStore({}).load()
  assert.equal(reloaded.decidedBy, 'user', 'off-by-user 标记是重启后仍生效的唯一凭据')
  assert.equal(reloaded.enabled, true, '漏写标记会让开关每次重启都自己关掉')
})

test('用户亲手关闭也要保持关闭（标记同样落盘）', async (t) => {
  const { createAutoCheckinStore, DEFAULT_AUTO_CHECKIN } = await loadAutoCheckin(t)
  const { store } = storeInTempHome(t, createAutoCheckinStore)
  await store.save({ ...DEFAULT_AUTO_CHECKIN, enabled: false, decidedBy: 'user' })

  const reloaded = createAutoCheckinStore({}).load()
  assert.equal(reloaded.decidedBy, 'user')
  assert.equal(reloaded.enabled, false)
})

test('旧文档的 enabled:true 没有 decidedBy 时按关闭处理（一次性迁移）', async (t) => {
  const { sanitizeAutoCheckin } = await loadAutoCheckin(t)
  const migrated = sanitizeAutoCheckin({ enabled: true, lastDate: '2026-11-01', lastAt: 1 })
  assert.equal(migrated.enabled, false, '旧默认值写下的 true 不是用户选择，必须回到关闭')
  assert.equal(migrated.decidedBy, undefined)
})
