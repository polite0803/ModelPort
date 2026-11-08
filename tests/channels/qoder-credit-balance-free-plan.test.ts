/**
 * Qoder 余额门控的「免费档 ≠ 余额耗尽」回归测试（2026-11-09）。
 *
 * 起因：WSL 网关的 app 日志出现
 * `[channel-pack] 1 个 qoder 账号不可用，已跳过：qoder-9a54823f: 余额为 0（余额门控跳过）`，
 * 而该号随后照常返回 200 —— 门控把一个**仍能服务**的号排掉了。
 *
 * 锁死两条语义：
 *
 * 1. **免费/标准档不是「0 余额」**：`userQuota` 为 `{total:0,used:0,remaining:0}`
 *    且没有 `addOnQuota`/专用包时，`qoderPlanGrantsCredits` 返回 false，
 *    门控据此拿到 `null`（未知）→ **放行**。响应键名取自
 *    `qoder-credits.ts` 顶部 2026-09-19 的真实抓样（键必须真，值可自定）。
 * 2. **发放过又烧光仍要拦**：任一包 `total>0`（示例里 `addOnQuota` 领过 100
 *    用完）时返回 true，`remaining` 合计 0 是确凿读数 → 门控返回 `false`
 *    → 跳过。这条正是门控 2026-10-30 要修的原问题，不能被 1 顺带回退。
 *
 * ⚠️ 被测模块 import 了 vendor 里的兄弟模块，`node --test` 解析不了
 *    `.js` → `.ts`，故按 `scripts/build-channel-pack.mjs` 的口径用 esbuild
 *    打成临时 bundle 再 import（同 `lobsterai-credits.test.ts`）。
 *    在禁 esbuild 子进程的沙箱里本文件会以 `spawn EPERM` 红，属环境问题。
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

async function loadVendorBundle(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-qoder-credits-'))
  t?.after?.(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { fetchQoderCreditBalance, qoderPlanGrantsCredits } from ${JSON.stringify(join(VENDOR_SRC, 'qoder-credits.ts'))}`,
        `export { AccountBalanceGate } from ${JSON.stringify(join(VENDOR_SRC, 'account-balance-gate.ts'))}`,
        `export { QODER } from ${JSON.stringify(join(VENDOR_SRC, 'qoder-product.ts'))}`,
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    alias: { '@deepseek-ai/dsh-llm': COMPAT_LLM },
  })
  return await import(pathToFileURL(outfile).href)
}

const CREDENTIAL = { access_token: 'test-token', refresh_token: 'r' }

/** 造一个 fetcher：返回给定 JSON 体，并记录被请求的 URL。 */
function fakeFetch(body) {
  const urls = []
  return {
    urls,
    fetcher: async url => {
      urls.push(String(url))
      return {
        ok: true,
        status: 200,
        json: async () => body,
      }
    },
  }
}

/** 免费/标准档：套餐额度存在但三个数全 0，且没有任何资源包。 */
const FREE_PLAN_BODY = {
  displayMode: 'qoder',
  qoderUsage: {
    userType: 'personal_standard',
    userQuota: { total: 0, used: 0, remaining: 0, unit: 'credits' },
    expiresAt: 253402214400000,
  },
}

/** 领过积分又烧光的号：`total>0`、`remaining=0` 是确凿读数。 */
const BURNED_BODY = {
  displayMode: 'qoder',
  qoderUsage: {
    userType: 'personal_professional',
    userQuota: { total: 0, used: 0, remaining: 0, unit: 'credits' },
    addOnQuota: { total: 100, used: 100, remaining: 0, unit: 'credits' },
    expiresAt: 253402214400000,
  },
}

test('free plan reports no credit quota, so the gate must not read it as 0', async t => {
  const { fetchQoderCreditBalance, qoderPlanGrantsCredits, QODER } = await loadVendorBundle(t)
  const { fetcher, urls } = fakeFetch(FREE_PLAN_BODY)

  const balance = await fetchQoderCreditBalance(CREDENTIAL, QODER, fetcher)
  assert.ok(balance !== null, '响应形状合法，必须解析出余额对象而不是「查不到」')
  assert.equal(balance.total, 0)
  assert.equal(
    urls[0].endsWith('/sash/api/v2/me/usage'),
    true,
    `端点应为用量接口，实际 ${urls[0]}`,
  )
  // 「有包但从未发放」：展示层仍拿到 0，门控侧拿到「未知」。
  assert.equal(qoderPlanGrantsCredits(balance.packages), false)
})

test('a granted-then-exhausted plan still reads as a real 0', async t => {
  const { fetchQoderCreditBalance, qoderPlanGrantsCredits, QODER } = await loadVendorBundle(t)
  const { fetcher } = fakeFetch(BURNED_BODY)

  const balance = await fetchQoderCreditBalance(CREDENTIAL, QODER, fetcher)
  assert.ok(balance !== null)
  assert.equal(balance.total, 0)
  assert.equal(qoderPlanGrantsCredits(balance.packages), true)
})

test('gate: unknown releases the account, confirmed 0 skips it', async () => {
  const { AccountBalanceGate } = await loadVendorBundle(t => t)
  // 探针组合与装配层（`index.ts` 的 `qoderCreditTotal`）同一判据。
  const gateFor = total => new AccountBalanceGate({ probe: async () => total })

  assert.equal(await gateFor(null).usable('qoder-free', {}), undefined, '免费档 → 未知 → 放行')
  assert.equal(await gateFor(0).usable('qoder-burned', {}), false, '确凿 0 → 拦截')
  assert.equal(await gateFor(100).usable('qoder-funded', {}), true, '有余额 → 放行')
})
