import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')

/**
 * vendor 源码不能直接在 `node --test` 里 import（它会依赖虚拟模块）；这里只挑
 * **零外部依赖**的 buddy 文件（`product.ts`、`buddy.ts`、`buddy-credits.ts`），
 * 用 esbuild 打成临时 bundle 再驱动真实源码。
 */
async function loadVendor(t, exports) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'workbuddy-vendor-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: { contents: exports, resolveDir: ROOT, loader: 'ts' },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
  })
  return await import(pathToFileURL(outfile).href)
}

test('WorkBuddy product points at the international endpoint and its own credential ref', async (t) => {
  const mod = await loadVendor(t, [
    `export { WORKBUDDY, CODEBUDDY } from ${JSON.stringify(join(VENDOR_SRC, 'product.ts'))}`,
  ].join('\n'))

  assert.equal(mod.WORKBUDDY.id, 'workbuddy')
  assert.equal(mod.CODEBUDDY.id, 'buddy')
  assert.equal(mod.WORKBUDDY.endpoint, 'https://www.workbuddy.ai')
  assert.equal(mod.WORKBUDDY.defaultCredentialRef, 'WORKBUDDY_ACCESS_TOKEN')
  assert.equal(mod.CODEBUDDY.defaultCredentialRef, 'BUDDY_ACCESS_TOKEN')
  // 两个产品共用同一套积分，但凭据 ref 必须分开，否则续期会串号。
  assert.notEqual(mod.WORKBUDDY.defaultCredentialRef, mod.CODEBUDDY.defaultCredentialRef)
})

test('credentialExpiresAtMs reads the string millisecond timestamp the vendor sends', async (t) => {
  const mod = await loadVendor(t, [
    `export { credentialExpiresAtMs } from ${JSON.stringify(join(VENDOR_SRC, 'buddy.ts'))}`,
  ].join('\n'))

  const expires = 1_700_000_000_000
  assert.equal(mod.credentialExpiresAtMs({ access_token: 'x', expires_at: String(expires) }), expires)
  assert.equal(mod.credentialExpiresAtMs({ access_token: 'x' }), undefined)
})

test('buddy-credits exposes the balance reader the M3 selector will use', async (t) => {
  const mod = await loadVendor(t, [
    `export { fetchCreditBalance } from ${JSON.stringify(join(VENDOR_SRC, 'buddy-credits.ts'))}`,
  ].join('\n'))

  assert.equal(typeof mod.fetchCreditBalance, 'function')
})

test('WorkBuddy is wired into the pack (store prefix, auth, adapter, login, check-in guard)', () => {
  const store = readFileSync(join(VENDOR_SRC, 'channel-pack-store.ts'), 'utf8')
  assert.match(store, /\['BUDDY', 'buddy'\]/)
  assert.match(store, /\['WORKBUDDY', 'workbuddy'\]/)

  const index = readFileSync(join(VENDOR_SRC, 'index.ts'), 'utf8')
  assert.match(index, /new BuddyAuth\(ctx, \{ product: CODEBUDDY/)
  assert.match(index, /new BuddyAuth\(ctx, \{ product: WORKBUDDY/)
  assert.match(index, /registerBuddyLlm\(ctx, \{/)
  assert.match(index, /\['workbuddy', \(p\) => workbuddy\.refreshAll\(p\)\]/)
  assert.match(index, /\['buddy', \(p\) => buddy\.refreshAll\(p\)\]/)
  assert.match(index, /workbuddy: pruned\(WORKBUDDY\.id, workbuddyAdapter\)/)
  assert.match(index, /buddy: pruned\(CODEBUDDY\.id, buddyAdapter\)/)
  // M3：按到期分档选号，两个产品各一份缓存；锁定永久积分时不得回落到池顺序。
  assert.match(index, /new BuddyBalanceSelector\(/)
  assert.match(index, /pickBuddyAccount\(/)
  assert.match(index, /pool\.permanentLocked\(options\.product\.id\)/)

  // 账号池必须注入 createBuddyAdapter：缺了它，适配器的换号、账号归属与 11140
  // 冷却全是死代码（日志打成 `账号 (current)`，池里零冷却记录），而报错仍声称
  // 「已逐个换号重试」。只认 createBuddyAdapter 自己那一段，别的适配器也有这行。
  const factoryStart = index.indexOf('const createBuddyAdapter')
  assert.ok(factoryStart > 0, 'createBuddyAdapter not found in index.ts')
  const factory = index.slice(factoryStart, index.indexOf('const buddyAdapter =', factoryStart))
  assert.match(factory, /accountPool: pool,/)

  // 报错范围必须从「本轮是否真换了号」推出来，不能写死：400 形态的 11140 分支
  // 曾被写成 `true`，单账号池一次都没换号却报「已逐个换号重试」。
  const buddy = readFileSync(join(VENDOR_SRC, 'buddy-adapter.ts'), 'utf8')
  assert.doesNotMatch(buddy, /contentRejectionError\([^)]*?,\s*(true|false)\s*[,)]/)

  // 池化安装里没有 `*_ACCESS_TOKEN` 那个默认 ref：账号全在冷却时回落到它只会报
  // 「no usable credential; log in from the Channel Pack panel first」。文案必须带
  // 宿主 `isRecoverableChannelFailure` 认的这句，否则会按账号故障吃上限。
  assert.match(factory, /账号池中的账号当前均不可用/)

  const rpc = readFileSync(join(VENDOR_SRC, 'channel-pack-rpc.ts'), 'utf8')
  assert.match(rpc, /runBuddyLoginFlow\(/)
  assert.match(rpc, /buddy\.refreshAccountCredential\(entry\.credentialRef, pool, entry\.id\)/)
  assert.match(rpc, /workbuddy\.refreshAccountCredential\(entry\.credentialRef, pool, entry\.id\)/)
  // 只有中国版有每日签到；国际版必须显式拒绝而不是静默失败。
  assert.match(rpc, /claimDailyCheckin\(credential, product\)/)
  assert.match(rpc, /WorkBuddy 国际版不支持每日签到/)
})
