/**
 * 「按渠道走系统代理」开关的回归测试。
 *
 * 需求原话：**只要一个开关，在每个渠道上设置是否走系统代理**。所以这里钉的是三件事：
 *
 * 1. 缺省条目读作「走系统代理」（`!== false`）—— 升级前所有渠道都在走自动出口，
 *    缺省若读成「直连」，一次升级就会静默改掉正在工作的出网路径；
 * 2. 关闭必须是真的直连：连插件出口也不走（否则界面上写「直连」，出口 IP 却变了）；
 * 3. 关闭只作用于绑定了渠道身份的请求（`fetchFor(id)`）；未绑定的 `fetch` 保持历史行为，
 *    否则渠道包里的通用调用会因为某个渠道的快照被误伤。
 *
 * vendor 源码不能直接 import（`.js`→`.ts` 解析 + `undici` 垫片），按
 * `tests/channels/host-proxy.test.ts` 的同一套别名打成临时 bundle 再加载。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  channelUsesSystemProxy,
  sanitizeChannelSystemProxyMap,
  validateChannelSystemProxyWrite,
} from '../../src/shared/channelProxy.ts'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

async function loadChannelFetch(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-system-proxy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { createChannelFetch } from ${JSON.stringify(join(VENDOR_SRC, 'channel-fetch.ts'))}`,
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    plugins: [{
      name: 'channel-pack-compat',
      setup(build) {
        build.onResolve({ filter: /^undici$/ }, (args) => {
          if (!args.importer.startsWith(VENDOR_SRC)) return undefined
          return { path: join(COMPAT, 'undici.ts') }
        })
      },
    }],
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module'",
        'const require = __createRequire(import.meta.url)',
      ].join('\n'),
    },
  })
  return await import(pathToFileURL(outfile).href)
}

const TARGET = 'https://cloudcode-pa.googleapis.com/v1internal'

/** 建一个只记录「实际走了哪条路」的出口。 */
function harness(t, pack, { map, proxy = 'http://172.29.144.1:7890', outlet = false } = {}) {
  const used = []
  const outletCalls = []
  let passed
  const channel = pack.createChannelFetch({
    environment: { HTTPS_PROXY: proxy },
    platform: 'linux',
    hostProxy: async () => undefined,
    systemProxy: id => channelUsesSystemProxy(map, id),
    dispatcherFor: (selected) => {
      used.push(selected.url)
      return { destroy: async () => {} }
    },
    fetchImpl: async (_input, init) => {
      passed = init?.dispatcher
      return new Response('ok')
    },
    outlet: !outlet ? undefined : {
      active: () => true,
      fetch: async () => {
        outletCalls.push(1)
        return new Response('outlet')
      },
    },
  })
  t.after(() => channel.close())
  return { channel, used, outletCalls, dispatcher: () => passed }
}

test('缺省读作「走系统代理」：仅在显式 false 时返回 false', () => {
  assert.equal(channelUsesSystemProxy(undefined, 'trae'), true)
  assert.equal(channelUsesSystemProxy({}, 'trae'), true)
  assert.equal(channelUsesSystemProxy({ trae: true }, 'trae'), true)
  assert.equal(channelUsesSystemProxy({ trae: false }, 'trae'), false)
  // 别的渠道的例外不串门
  assert.equal(channelUsesSystemProxy({ qoder: false }, 'trae'), true)
})

test('读取侧归一：坏键/坏值丢条目，字符串布尔保留，条数封顶', () => {
  assert.deepEqual(sanitizeChannelSystemProxyMap(null), {})
  assert.deepEqual(sanitizeChannelSystemProxyMap([]), {})
  assert.deepEqual(sanitizeChannelSystemProxyMap('nope'), {})
  assert.deepEqual(
    sanitizeChannelSystemProxyMap({
      trae: false,
      qoder: 'true',
      zcode: 'false',
      '坏键!': false,
      buddy: 'yes',
      workbuddy: 0,
    }),
    { trae: false, qoder: true, zcode: false },
  )
  const many = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`ch${i}`, false]))
  assert.equal(Object.keys(sanitizeChannelSystemProxyMap(many)).length, 64)
})

test('写入侧整批校验：坏值连同原因拒掉，不静默丢弃', () => {
  const nullish = validateChannelSystemProxyWrite(null)
  assert.equal(nullish.ok, false)
  assert.match(nullish.errors[0], /必须是「渠道 id → 布尔」的对象/)
  const badKey = validateChannelSystemProxyWrite({ 'Trae!': true })
  assert.equal(badKey.ok, false)
  assert.match(badKey.errors[0], /不是合法的渠道 id/)
  const badValue = validateChannelSystemProxyWrite({ trae: 'false' })
  assert.equal(badValue.ok, false)
  assert.match(badValue.errors[0], /必须是 true 或 false/)
  const tooMany = validateChannelSystemProxyWrite(
    Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`ch${i}`, true])),
  )
  assert.equal(tooMany.ok, false)
  const ok = validateChannelSystemProxyWrite({ trae: false, qoder: true })
  assert.deepEqual(ok, { ok: true, map: { trae: false, qoder: true } })
})

test('渠道开关关闭 ⇒ 真的直连：环境代理与插件出口都不碰', async (t) => {
  const pack = await loadChannelFetch(t)
  const h = harness(t, pack, { map: { trae: false }, outlet: true })

  await h.channel.fetchFor('trae')(TARGET)
  assert.deepEqual(h.used, [], '关闭后不得建代理 dispatcher')
  assert.deepEqual(h.outletCalls, [], '关闭后连插件出口也不得走')
  assert.equal(h.dispatcher(), undefined)
})

test('渠道开关打开/缺省 ⇒ 走系统代理链', async (t) => {
  const pack = await loadChannelFetch(t)
  const enabled = harness(t, pack, { map: { trae: true } })
  await enabled.channel.fetchFor('trae')(TARGET)
  assert.deepEqual(enabled.used, ['http://172.29.144.1:7890'])
  assert.notEqual(enabled.dispatcher(), undefined, 'dispatcher 必须真的交给 fetch')

  const absent = harness(t, pack, { map: {} })
  await absent.channel.fetchFor('trae')(TARGET)
  assert.deepEqual(absent.used, ['http://172.29.144.1:7890'], '缺省条目读作「开」')
})

test('未绑定渠道的 fetch 不被任何渠道的例外影响', async (t) => {
  const pack = await loadChannelFetch(t)
  const h = harness(t, pack, { map: { trae: false } })

  await h.channel.fetch(TARGET)
  assert.deepEqual(h.used, ['http://172.29.144.1:7890'])
})

test('关闭后请求失败：错误文案的路由段要说清是「该渠道已关闭」', async (t) => {
  const pack = await loadChannelFetch(t)
  const channel = pack.createChannelFetch({
    environment: {},
    platform: 'linux',
    hostProxy: async () => undefined,
    systemProxy: id => channelUsesSystemProxy({ trae: false }, id),
    fetchImpl: async () => {
      throw Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' })
    },
  })
  t.after(() => channel.close())
  await assert.rejects(
    () => channel.fetchFor('trae')(TARGET),
    (error) => {
      assert.match(error.message, /关闭系统代理/)
      assert.match(error.message, /ENETUNREACH/)
      return true
    },
  )
})