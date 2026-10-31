/**
 * LobsterAI（有道）余额查询的回归测试。
 *
 * 锁死两条 2026-11-01 修掉的语义：
 *
 * 1. **失败原因透出**：`profile-summary` 对失效凭据回的是 HTTP 200 +
 *    `{"code":-1,"message":"未登录"}`。这层以前把它压成 `null`，到
 *    `collectCreditBalances` 只剩「余额查询失败」——官网封禁、登录过期、
 *    上游改字段三种情况在界面上长得一模一样。
 * 2. **「0 分」是读数，不是失败**：以前 `total===0 && packages.length===0`
 *    直接返回 null，于是真 0 分的账号显示成「查询失败」，选号侧也拿不到
 *    确凿的 0。现在只有**两个字段都缺失**才算查不到。
 *
 * ⚠️ 被测模块 import 了 vendor 里的兄弟模块（`./lobsterai.js`），
 *    `node --test` 解析不了 `.js` → `.ts`，故按 `scripts/build-channel-pack.mjs`
 *    的口径用 esbuild 打成临时 bundle 再 import（同 minimax-tool-call-name.test.ts）。
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
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-lobsterai-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { fetchLobsteraiCreditBalance, fetchLobsteraiCreditBalanceDetailed } from ${JSON.stringify(join(VENDOR_SRC, 'lobsterai-credits.ts'))}`,
        `export { LOBSTERAI } from ${JSON.stringify(join(VENDOR_SRC, 'lobsterai-product.ts'))}`,
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

const CREDENTIAL = { access_token: 'jwt-token', refresh_token: 'r' }

/** 造一个 fetcher：按顺序返回给定响应，并记录被请求的 URL。 */
function fakeFetch(responses) {
  const urls = []
  let index = 0
  const fetcher = async (url) => {
    urls.push(String(url))
    const next = responses[index] ?? responses[responses.length - 1]
    index += 1
    if (next.throw) throw new Error(next.throw)
    return {
      status: next.status ?? 200,
      async text() {
        return typeof next.body === 'string' ? next.body : JSON.stringify(next.body) ?? ''
      },
    }
  }
  return { fetcher, urls }
}

test('信封失败（HTTP 200 + code:-1 未登录）→ 带上游原文，不再只给 null', async (t) => {
  const { fetchLobsteraiCreditBalanceDetailed, LOBSTERAI } = await loadVendorBundle(t)
  const { fetcher } = fakeFetch([{ body: { code: -1, message: '未登录', data: null } }])
  const result = await fetchLobsteraiCreditBalanceDetailed(CREDENTIAL, LOBSTERAI, fetcher)
  assert.equal(result.balance, null)
  assert.match(result.error, /未登录/, '上游自己的文案必须原样透出')
})

test('网络失败与 HTML 错误页各自的原因都不被吞掉', async (t) => {
  const { fetchLobsteraiCreditBalanceDetailed, LOBSTERAI } = await loadVendorBundle(t)

  const net = fakeFetch([{ throw: 'socket hang up' }])
  const netResult = await fetchLobsteraiCreditBalanceDetailed(CREDENTIAL, LOBSTERAI, net.fetcher)
  assert.equal(netResult.balance, null)
  assert.match(netResult.error, /socket hang up/)

  const html = fakeFetch([{ status: 403, body: '<html>blocked</html>' }])
  const htmlResult = await fetchLobsteraiCreditBalanceDetailed(CREDENTIAL, LOBSTERAI, html.fetcher)
  assert.equal(htmlResult.balance, null)
  assert.match(htmlResult.error, /HTTP 403/, '非 JSON 响应要带状态码')
})

test('真 0 分返回余额 0（不是「查不到」）', async (t) => {
  const { fetchLobsteraiCreditBalanceDetailed, LOBSTERAI } = await loadVendorBundle(t)
  const { fetcher } = fakeFetch([
    { body: { code: 0, msg: 'ok', data: { totalCreditsRemaining: 0, creditItems: [] } } },
  ])
  const result = await fetchLobsteraiCreditBalanceDetailed(CREDENTIAL, LOBSTERAI, fetcher)
  assert.equal(result.error, undefined, '0 分是业务事实，不带失败原因')
  assert.equal(result.balance.total, 0)
})

test('两个积分字段都缺失 → 才算「查不到」并说明缺了什么', async (t) => {
  const { fetchLobsteraiCreditBalanceDetailed, LOBSTERAI } = await loadVendorBundle(t)
  const { fetcher } = fakeFetch([{ body: { code: 0, msg: 'ok', data: { nickname: 'x' } } }])
  const result = await fetchLobsteraiCreditBalanceDetailed(CREDENTIAL, LOBSTERAI, fetcher)
  assert.equal(result.balance, null)
  assert.match(result.error, /totalCreditsRemaining/)
  assert.match(result.error, /creditItems/)
})

test('正常响应：总额取 totalCreditsRemaining，明细按 label 建包；兼容签名只回数值', async (t) => {
  const { fetchLobsteraiCreditBalance, fetchLobsteraiCreditBalanceDetailed, LOBSTERAI } = await loadVendorBundle(t)
  const body = {
    code: 0,
    msg: 'ok',
    data: {
      totalCreditsRemaining: 5297.723,
      creditItems: [
        { label: '每日登录奖励', type: 'campaign', creditsRemaining: 100, expiresAt: '2026-10-23T01:21:23' },
        { label: '每日登录奖励', type: 'campaign', creditsRemaining: 92.73, expiresAt: '2026-10-24T01:21:23' },
      ],
    },
  }

  const a = fakeFetch([{ body }])
  const detailed = await fetchLobsteraiCreditBalanceDetailed(CREDENTIAL, LOBSTERAI, a.fetcher)
  assert.equal(detailed.error, undefined)
  assert.equal(detailed.balance.total, 5297.72, '只规整到分，不四舍五入成整数')
  assert.equal(detailed.balance.packages.length, 2)
  assert.equal(detailed.balance.packages[0].name, '每日登录奖励', '包名用 label 而不是 type')

  const b = fakeFetch([{ body }])
  const legacy = await fetchLobsteraiCreditBalance(CREDENTIAL, LOBSTERAI, b.fetcher)
  assert.equal(legacy.total, 5297.72, '旧的只要数值的签名行为不变（余额门控依赖它）')

  assert.match(a.urls[0], /\/api\/user\/profile-summary$/)
})

test('负数读数 clamp 到 0，不显示成欠费', async (t) => {
  const { fetchLobsteraiCreditBalanceDetailed, LOBSTERAI } = await loadVendorBundle(t)
  const { fetcher } = fakeFetch([
    { body: { code: 0, msg: 'ok', data: { totalCreditsRemaining: -12.5, creditItems: [] } } },
  ])
  const result = await fetchLobsteraiCreditBalanceDetailed(CREDENTIAL, LOBSTERAI, fetcher)
  assert.equal(result.balance.total, 0)
})
