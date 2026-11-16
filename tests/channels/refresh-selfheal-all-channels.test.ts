/**
 * 六个 provider 批量续期的「池布尔单向门」回归测试（2026-11-16）。
 *
 * 背景：`refreshAll` 若以 `if (!entry.refreshable) continue` 开头，池里的布尔
 * 就成了**单向门** —— 任何一次把它写成 false（服务端一次拒绝、并发重放烧掉
 * refresh_token、旧版本漏回写……），该账号此后**永远不进续期循环**，只能手动
 * 重新登录。这正是「一次登录却仍会掉线」的根因之一。
 *
 * 契约（与 `minimax-refresh-selfheal.test.ts`、`service.ts::refreshAll` 同口径）：
 * 1. 判据读**凭据**：池说不可续、凭据有续期材料 ⇒ 仍然续期并自愈池值；
 * 2. 凭据确实缺材料 ⇒ 不发请求，把池值改成 false（变了才写）；
 * 3. （raccoon）凭据仍在有效期内时池值也被对账回 true，不必等到过期。
 *
 * vendor 源码不能直接 import（虚拟模块 + `.js`→`.ts` 解析），按
 * `scripts/build-channel-pack.mjs` 的别名打成临时 bundle 再加载。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

async function loadChannelAuths(t: { after: (fn: () => void) => void }) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-refresh-selfheal-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  // 各家 auth 会传递拉进 adapter / store / llm 注册层，因此别名必须与
  // `scripts/build-channel-pack.mjs` 保持一致，否则 `@deepseek-ai/*` 与上游越界的
  // `../../../src/image-pricing.js` 解析不了。
  const lines = [
    `export { LobsteraiAuth } from ${JSON.stringify(join(VENDOR_SRC, 'lobsterai-auth.ts'))}`,
    `export { LobsteraiClientVersionResolver } from ${JSON.stringify(join(VENDOR_SRC, 'lobsterai.ts'))}`,
    `export { QoderAuth } from ${JSON.stringify(join(VENDOR_SRC, 'qoder-auth.ts'))}`,
    `export { TraeAuth } from ${JSON.stringify(join(VENDOR_SRC, 'trae-auth.ts'))}`,
    `export { ClineAuth } from ${JSON.stringify(join(VENDOR_SRC, 'cline-auth.ts'))}`,
    `export { BuddyAuth } from ${JSON.stringify(join(VENDOR_SRC, 'buddy-auth.ts'))}`,
    `export { RaccoonAuth } from ${JSON.stringify(join(VENDOR_SRC, 'raccoon-auth.ts'))}`,
  ]
  await esbuild.build({
    stdin: { contents: lines.join('\n'), resolveDir: ROOT, loader: 'ts' },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    alias: {
      '@deepseek-ai/dsh-llm': join(COMPAT, 'dshLlm.ts'),
      '@deepseek-ai/dsh-credentials': join(COMPAT, 'dshCredentials.ts'),
      '@deepseek-ai/cordis': join(COMPAT, 'cordis.ts'),
      '@deepseek-ai/schemastery': join(COMPAT, 'schemastery.ts'),
      '@deepseek-ai/dsh-agent': join(COMPAT, 'dshAgent.ts'),
    },
    plugins: [{
      name: 'channel-pack-compat',
      setup(build) {
        build.onResolve({ filter: /^undici$/ }, args => {
          if (!args.importer.startsWith(VENDOR_SRC + sep)) return undefined
          return { path: join(COMPAT, 'undici.ts') }
        })
        build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/src\/image-pricing\.js$/ }, args => {
          if (!args.importer.startsWith(VENDOR_SRC + sep)) return undefined
          return { path: join(COMPAT, 'imagePricing.ts') }
        })
      },
    }],
    banner: {
      js: [
        "import { createRequire as __testCreateRequire } from 'node:module'",
        'const require = __testCreateRequire(import.meta.url)',
      ].join('\n'),
    },
  })
  return await import(pathToFileURL(outfile).href)
}

const REF = 'ACCOUNT_TEST_REF'
const HOUR = 3_600_000
const PAST = Date.now() - 60_000
const FUTURE = Date.now() + HOUR

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface HarnessOptions {
  credential: Record<string, unknown>
  expiresAt?: number
  fetcher: () => Response
}

function makeHarness({ credential, expiresAt, fetcher }: HarnessOptions) {
  const store = new Map<string, string>([[REF, JSON.stringify(credential)]])
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const infos: string[] = []
  const warns: string[] = []
  let calls = 0
  const ctx = {
    credentials: {
      resolve: async (ref: string) => {
        const value = store.get(ref)
        return value === undefined ? undefined : { value }
      },
      set: async (ref: string, value: string) => {
        store.set(ref, value)
      },
    },
    logger: {
      info: (message: string) => infos.push(message),
      warn: (message: string) => warns.push(message),
    },
  }
  const pool = {
    listAccounts: async () => [{
      id: 'account-test',
      provider: 'test',
      credentialRef: REF,
      nickname: 'account-test',
      enabled: true,
      // ⚠️ 关键前提：池里被误标成不可续期。
      refreshable: false,
      ...expiresAt === undefined ? {} : { expiresAt },
    }],
    updateAccount: async (id: string, patch: Record<string, unknown>) => {
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
    fetchImpl: async () => {
      calls += 1
      return fetcher()
    },
  }
}

/** 每个 provider 的构造方式、凭据形态与续期响应。 */
interface Case {
  name: string
  className: string
  credential: Record<string, unknown>
  respond: () => Response
  accessTokenOf: (stored: Record<string, unknown>) => unknown
  /** 落盘后的期望访问令牌；缺省 `new-access`（cline 会补 `workos:` 前缀）。 */
  expectedAccessToken?: string
  options: (api: Record<string, any>) => Record<string, unknown>
}

const CASES: Case[] = [
  {
    name: 'lobsterai',
    className: 'LobsteraiAuth',
    credential: { access_token: 'old-access', refresh_token: 'old-refresh', expires_at: String(PAST) },
    respond: () => json({
      code: 0,
      msg: 'OK',
      data: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 },
    }),
    accessTokenOf: (stored: Record<string, unknown>) => stored.access_token,
    options: (api: Record<string, any>) => ({
      versionResolver: new api.LobsteraiClientVersionResolver({
        fetcher: async () => json({ data: { value: { version: '2026.9.4' } } }),
      }),
    }),
  },
  {
    name: 'qoder',
    className: 'QoderAuth',
    credential: {
      access_token: 'old-access',
      security_oauth_token: 'old-access',
      refresh_token: 'old-refresh',
      expire_time: PAST,
      machine_id: 'machine-test',
    },
    respond: () => json({
      token: 'new-access',
      refresh_token: 'new-refresh',
      expires_at: Math.floor(FUTURE / 1000),
    }),
    accessTokenOf: (stored: Record<string, unknown>) => stored.access_token,
    options: () => ({}),
  },
  {
    name: 'trae',
    className: 'TraeAuth',
    credential: { access_token: 'old-access', refresh_token: 'old-refresh', expires_at: String(PAST) },
    respond: () => json({
      Result: {
        Token: 'new-access',
        RefreshToken: 'new-refresh',
        TokenExpireAt: Math.floor(FUTURE / 1000),
        TokenExpireDuration: 3600,
      },
    }),
    accessTokenOf: (stored: Record<string, unknown>) => stored.access_token,
    options: () => ({}),
  },
  {
    name: 'cline',
    className: 'ClineAuth',
    credential: { access_token: 'old-access', refresh_token: 'old-refresh', expire_time: PAST },
    respond: () => json({
      success: true,
      data: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: FUTURE },
    }),
    // Cline 的令牌必须保留 `workos:` 前缀（`clineBearerValue`），落盘会自动补上。
    accessTokenOf: (stored: Record<string, unknown>) => stored.access_token,
    expectedAccessToken: 'workos:new-access',
    options: () => ({}),
  },
  {
    name: 'buddy',
    className: 'BuddyAuth',
    credential: { access_token: 'old-access', refresh_token: 'old-refresh', expires_at: String(PAST) },
    respond: () => json({
      code: 0,
      data: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: FUTURE },
    }),
    accessTokenOf: (stored: Record<string, unknown>) => stored.access_token,
    options: () => ({}),
  },
  {
    name: 'raccoon',
    className: 'RaccoonAuth',
    credential: { access_token: 'old-access', refresh_token: 'old-refresh', expires_at: String(PAST) },
    respond: () => json({ code: 0, data: { access_token: 'new-access', refresh_token: 'new-refresh' } }),
    accessTokenOf: (stored: Record<string, unknown>) => stored.access_token,
    options: () => ({}),
  },
]

for (const item of CASES) {
  test(`${item.name}：池说不可续但凭据有续期材料 ⇒ 仍然续期并自愈池值`, async (t) => {
    const api = await loadChannelAuths(t)
    const h = makeHarness({ credential: item.credential, expiresAt: PAST, fetcher: item.respond })
    const Auth = api[item.className]
    const auth = new Auth(h.ctx, { fetcher: h.fetchImpl, ...item.options(api) })

    await auth.refreshAll(h.pool)

    assert.equal(h.calls(), 1, '必须真的发一次续期请求（不得被池里的 false 挡住）')
    const stored = JSON.parse(h.store.get(REF) as string) as Record<string, unknown>
    assert.equal(item.accessTokenOf(stored), item.expectedAccessToken ?? 'new-access', '新凭据必须落盘')
    const patch = h.updates.find(update => update.patch.refreshable === true)
    assert.ok(patch !== undefined, '续期后必须把池里的 refreshable 对账回 true')
    assert.ok(
      h.infos.some(message => /恢复自动续期/.test(message)),
      '池值与凭据不符时要留下自愈日志',
    )
  })

  test(`${item.name}：凭据确实缺续期材料 ⇒ 不发请求，池值改为不可续期`, async (t) => {
    const api = await loadChannelAuths(t)
    const credential: Record<string, unknown> = { ...item.credential }
    // Buddy 的 `refresh_token` 是必填字符串（`parseTokenData` 缺失时给空串），
    // 故「没有续期材料」在那家的真实形态是空串，而不是删掉整个键。
    if (item.name === 'buddy') credential.refresh_token = ''
    else delete credential.refresh_token
    const h = makeHarness({ credential, expiresAt: PAST, fetcher: item.respond })
    const Auth = api[item.className]
    // 池里这次标成可续期，验证「凭据说了算」的反方向。
    const pool = { ...h.pool, listAccounts: async () => [{ ...(await h.pool.listAccounts())[0], refreshable: true }] }
    const auth = new Auth(h.ctx, { fetcher: h.fetchImpl, ...item.options(api) })

    await auth.refreshAll(pool)

    assert.equal(h.calls(), 0, '没有续期材料时绝不发请求')
    assert.equal(
      h.updates.find(update => update.id === 'account-test')?.patch.refreshable,
      false,
      '池里的 true 是错的，必须按凭据改成 false',
    )
  })
}

test('raccoon：凭据仍有效时也把误标的 refreshable 对账回 true（不发请求）', async (t) => {
  const api = await loadChannelAuths(t)
  const h = makeHarness({
    credential: { access_token: 'old-access', refresh_token: 'old-refresh', expires_at: String(FUTURE) },
    expiresAt: FUTURE,
    fetcher: () => json({ code: 0, data: { access_token: 'unused', refresh_token: 'unused' } }),
  })
  const auth = new api.RaccoonAuth(h.ctx, { fetcher: h.fetchImpl })

  await auth.refreshAll(h.pool)

  assert.equal(h.calls(), 0, '未过期不发续期请求')
  assert.equal(
    h.updates.find(update => update.id === 'account-test')?.patch.refreshable,
    true,
    '误标的 false 必须在有效期内就被纠正',
  )
})