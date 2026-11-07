/**
 * MiniMax 签到失败的归因（2026-11-08 用户报障「积分领取没有完整生效」）。
 *
 * 真实故障：令牌过期时上游回 HTTP 401 + `{"error":"invalid access token"}`，
 * 该响应没有 `base_resp`，旧解析器把「HTTP 失败」当成「业务成功」，最终报
 * 「签到响应缺少有效的 claim_result」—— 把「凭据失效」误诊成「响应形状变了」，
 * 自动签到便拿着同一枚死令牌每 30 分钟空转。
 *
 * 同名文件 import 了 vendor 里的兄弟模块，故用 esbuild 打成临时 bundle 再 import
 * （与 `auto-checkin-retry.test.ts` 同款；`node --test` 不解析 `.js` → `.ts`）。
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

async function loadMinimaxCredits(t: { after(fn: () => void): void }) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-minimax-credits-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export {
        claimMinimaxDailyCheckin,
        fetchMinimaxSigninStatus,
        parseMinimaxSigninPanel,
      } from ${JSON.stringify(join(VENDOR_SRC, 'minimax-credits.ts'))}`,
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

const CREDENTIAL = { access_token: 'dead-token', token_type: 'Bearer' }

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('HTTP 401 归为凭据失效，而不是「缺少 claim_result」', async (t) => {
  const { claimMinimaxDailyCheckin } = await loadMinimaxCredits(t)
  const outcome = await claimMinimaxDailyCheckin(
    CREDENTIAL,
    (async () => response(401, { error: 'invalid access token' })) as unknown as typeof fetch,
  )
  assert.equal(outcome.kind, 'failed')
  assert.equal(outcome.code, 401)
  assert.match(outcome.message, /凭据已失效/)
  assert.doesNotMatch(outcome.message, /claim_result/)
})

test('HTTP 500 保留状态码，不再落到形状错误', async (t) => {
  const { claimMinimaxDailyCheckin } = await loadMinimaxCredits(t)
  const outcome = await claimMinimaxDailyCheckin(
    CREDENTIAL,
    (async () => response(500, { error: 'boom' })) as unknown as typeof fetch,
  )
  assert.equal(outcome.kind, 'failed')
  assert.equal(outcome.code, 500)
  assert.match(outcome.message, /HTTP 500/)
})

test('HTTP 200 但缺 claim_result：消息里带上实际字段名', async (t) => {
  const { claimMinimaxDailyCheckin } = await loadMinimaxCredits(t)
  const outcome = await claimMinimaxDailyCheckin(
    CREDENTIAL,
    (async () => response(200, { base_resp: { status_code: 0 }, data: { points: 800 } })) as unknown as typeof fetch,
  )
  assert.equal(outcome.kind, 'failed')
  assert.match(outcome.message, /claim_result/)
  assert.match(outcome.message, /points/)
})

test('claim_result=2 仍是幂等的「今天已签到」', async (t) => {
  const { claimMinimaxDailyCheckin } = await loadMinimaxCredits(t)
  const outcome = await claimMinimaxDailyCheckin(
    CREDENTIAL,
    (async () => response(200, {
      base_resp: { status_code: 0 },
      data: { claim_result: 2 },
    })) as unknown as typeof fetch,
  )
  assert.equal(outcome.kind, 'already-claimed')
})

test('claim_result=1 返回领取积分，points 是总数（不叠加 bonus）', async (t) => {
  const { claimMinimaxDailyCheckin } = await loadMinimaxCredits(t)
  const outcome = await claimMinimaxDailyCheckin(
    CREDENTIAL,
    (async () => response(200, {
      base_resp: { status_code: 0 },
      data: { claim_result: 1, points: 800, bonus_points: 400 },
    })) as unknown as typeof fetch,
  )
  assert.equal(outcome.kind, 'claimed')
  assert.equal(outcome.credit, 800)
})

test('状态预检遇到 401 返回 null（由 claim 给出可读原因）', async (t) => {
  const { fetchMinimaxSigninStatus } = await loadMinimaxCredits(t)
  const status = await fetchMinimaxSigninStatus(
    CREDENTIAL,
    (async () => response(401, { error: 'invalid access token' })) as unknown as typeof fetch,
  )
  assert.equal(status, null)
})
