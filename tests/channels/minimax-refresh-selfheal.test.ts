/**
 * MiniMax 批量续期的「池布尔单向门」回归测试（2026-11-11 现网）。
 *
 * 真实故障：两个账号的池记录是 `refreshable: false`，而凭据里 `refresh_token`
 * 明明还在。`refreshAll` 原来在 `try` **之外**写 `if (!entry.refreshable) continue`，
 * 于是定时器每 30 分钟静默跳过 —— 日志里一行都没有，面板只能显示「余额查询失败」。
 *
 * 契约：
 * 1. 判据读凭据：池说不可续、凭据有 `refresh_token` ⇒ 仍然续期并自愈池值；
 * 2. 凭据确实没有 `refresh_token` ⇒ 不发行请求，并把池值改成 false（变了才写）；
 * 3. 续期被拒但凭据已被他处轮换（并发重放）⇒ 按最新凭据对账，**不得**标死账号。
 *
 * vendor 源码不能直接 import（虚拟模块 + `.js`→`.ts` 解析），按
 * `scripts/build-channel-pack.mjs` 的别名打成临时 bundle 再加载。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

async function loadMinimaxAuth(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'minimax-refresh-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { MinimaxAuth } from ${JSON.stringify(join(VENDOR_SRC, 'minimax-auth.ts'))}
export { MINIMAX } from ${JSON.stringify(join(VENDOR_SRC, 'minimax-product.ts'))}`,
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
      '@deepseek-ai/cordis': join(COMPAT, 'cordis.ts'),
      '@deepseek-ai/dsh-credentials': join(COMPAT, 'dshCredentials.ts'),
    },
  })
  return await import(pathToFileURL(outfile).href)
}

const REF = 'MINIMAX_ACCOUNT_TEST'

function makeHarness({ credential, entry, fetcher }) {
  const store = new Map([[REF, JSON.stringify(credential)]])
  const updates = []
  const infos = []
  const warns = []
  let calls = 0
  const ctx = {
    credentials: {
      resolve: async (ref) => {
        const value = store.get(ref)
        return value === undefined ? undefined : { value }
      },
      set: async (ref, value) => {
        store.set(ref, value)
      },
    },
    logger: {
      info: (message) => infos.push(message),
      warn: (message) => warns.push(message),
    },
  }
  const pool = {
    listAccounts: async () => [entry],
    updateAccount: async (id, patch) => {
      updates.push({ id, patch })
    },
    findAccountIdByCredential: async () => undefined,
  }
  return {
    ctx,
    pool,
    store,
    updates,
    infos,
    warns,
    calls: () => calls,
    fetchImpl: async (url, init) => {
      calls += 1
      return fetcher(String(url), init)
    },
  }
}

function expiredCredential(extra = {}) {
  return {
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    token_type: 'Bearer',
    scope: 'agent.default',
    expires_at: String(Date.now() - 60_000),
    ...extra,
  }
}

function grantResponse() {
  return new Response(JSON.stringify({
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'agent.default',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('池说不可续但凭据有 refresh_token：仍然续期并自愈池值', async (t) => {
  const { MinimaxAuth } = await loadMinimaxAuth(t)
  const h = makeHarness({
    credential: expiredCredential(),
    entry: {
      id: 'minimax-test',
      provider: 'minimax',
      credentialRef: REF,
      nickname: 'minimax-test',
      enabled: true,
      refreshable: false,
      expiresAt: Date.now() - 60_000,
    },
    fetcher: async () => grantResponse(),
  })
  const auth = new MinimaxAuth(h.ctx, { fetchImpl: h.fetchImpl })

  await auth.refreshAll(h.pool)

  assert.equal(h.calls(), 1, '必须真的发一次续期请求')
  const stored = JSON.parse(h.store.get(REF))
  assert.equal(stored.access_token, 'new-access')
  assert.equal(stored.refresh_token, 'new-refresh')
  const patch = h.updates.find(update => update.id === 'minimax-test')
  assert.ok(patch !== undefined, '续期成功后要把池值对账')
  assert.equal(patch.patch.refreshable, true)
  assert.ok(
    h.infos.some(message => /恢复自动续期/.test(message)),
    '池值与凭据不符时要留下自愈日志',
  )
})

test('凭据确实没有 refresh_token：不发请求，池值改为不可续期', async (t) => {
  const { MinimaxAuth } = await loadMinimaxAuth(t)
  const credential = expiredCredential()
  delete credential.refresh_token
  const h = makeHarness({
    credential,
    entry: {
      id: 'minimax-test',
      provider: 'minimax',
      credentialRef: REF,
      nickname: 'minimax-test',
      enabled: true,
      refreshable: true,
    },
    fetcher: async () => grantResponse(),
  })
  const auth = new MinimaxAuth(h.ctx, { fetchImpl: h.fetchImpl })

  await auth.refreshAll(h.pool)

  assert.equal(h.calls(), 0)
  assert.deepEqual(
    h.updates.find(update => update.id === 'minimax-test')?.patch.refreshable,
    false,
  )
})

test('续期被拒但凭据已被他处轮换：按最新凭据对账，不标死账号', async (t) => {
  const { MinimaxAuth } = await loadMinimaxAuth(t)
  const h = makeHarness({
    credential: expiredCredential(),
    entry: {
      id: 'minimax-test',
      provider: 'minimax',
      credentialRef: REF,
      nickname: 'minimax-test',
      enabled: true,
      refreshable: true,
      expiresAt: Date.now() - 60_000,
    },
    fetcher: async () => {
      // 模拟并发：本次请求还在路上时，另一个请求已把凭据换成了新的。
      h.store.set(REF, JSON.stringify(expiredCredential({
        access_token: 'newer-access',
        refresh_token: 'newer-refresh',
        expires_at: String(Date.now() + 3_600_000),
      })))
      return new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
  const auth = new MinimaxAuth(h.ctx, { fetchImpl: h.fetchImpl })

  await auth.refreshAll(h.pool)

  assert.equal(JSON.parse(h.store.get(REF)).refresh_token, 'newer-refresh')
  assert.ok(
    h.updates.every(update => update.patch.refreshable !== false),
    '并发重放不得把账号标为不可续期',
  )
  assert.ok(h.infos.some(message => /并发重放/.test(message)))
  assert.ok(h.warns.every(message => !/已失效/.test(message)))
})

test('余额查询与续期共用渠道出口（不得退回全局 fetch）', () => {
  const rpc = readFileSync(join(VENDOR_SRC, 'channel-pack-rpc.ts'), 'utf8')
  // 2026-11-11 起余额查询按渠道取出口（`fetchFor(id)`），让「按渠道走系统代理」
  // 这一格对 RPC 路径同样生效；缺 `fetchFor` 时仍回落到整体出口，绝不回全局 fetch。
  assert.match(
    rpc,
    /fetchMinimaxCreditBalanceDetailed\(\s*credential,\s*config\.fetchFor\?\.\(MINIMAX\.id\) \?\? config\.fetchImpl,?\s*\)/,
    'MiniMax 余额查询必须把渠道出口传进去',
  )
  assert.match(
    rpc,
    /fetcher: config\.fetchFor\?\.\(GEMINI\.id\) \?\? config\.fetchImpl/,
    'Gemini 配额查询必须把渠道出口传进去',
  )

  const index = readFileSync(join(VENDOR_SRC, 'index.ts'), 'utf8')
  assert.match(
    index,
    /new MinimaxAuth\(ctx, \{ fetchImpl: fetchFor\(MINIMAX\.id\) \}\)/,
    '登录/续期必须走 createChannelFetch 的出口',
  )
  assert.match(index, /fetchImpl: network\.fetch,/, 'RPC 配置要带上渠道出口')
})