/**
 * 「宿主机代理」这条出网路径的回归测试。
 *
 * 背景（2026-11-11 现网）：浏览器经宿主机代理能登录 Gemini，而 WSL 里的渠道登录报
 * `渠道网络请求失败（直连；ETIMEDOUT）`。出口路由本身早就支持代理，缺的是**地址来源**：
 * systemd 单元不 source `.bashrc`，交互式 shell 里 `export HTTPS_PROXY` 到不了服务，
 * 而把代理写死进单元环境又会在「宿主机的代理没开」时把全部渠道一起打死。
 *
 * 契约：
 * 1. 配置文件由 `scripts/wsl-host-proxy.mjs` 维护，网关只读；`url` 为空/文件缺失/
 *    JSON 坏/协议不支持/端口探测失败 —— 一律当「没有宿主机代理」，**绝不抛错**；
 * 2. 优先级：环境代理 > 宿主机代理文件 > Windows 注册表 > 直连（`NO_PROXY` 对文件也生效）；
 * 3. 用宿主机代理失败时，错误文案的路由段必须写「宿主机代理」，否则运维按直连去排查；
 * 4. 代理端口关掉后，同一份配置要让网关自己退回直连（存活探测），不需要重启或重跑脚本。
 *
 * ⚠️ vendor 源码不能直接 import（`.js`→`.ts` 解析 + `undici` 垫片），这里按
 * `scripts/build-channel-pack.mjs` 的同一套别名打成临时 bundle 再加载。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer, type Server } from 'node:net'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

async function loadPack(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'host-proxy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { createChannelFetch } from ${JSON.stringify(join(VENDOR_SRC, 'channel-fetch.ts'))}`,
        `export { hostProxyConfigPath, parseHostProxyConfig, resolveHostProxy, resetHostProxyCache } from ${JSON.stringify(join(VENDOR_SRC, 'host-proxy.ts'))}`,
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
    plugins: [{
      name: 'channel-pack-compat',
      setup(build) {
        build.onResolve({ filter: /^undici$/ }, (args) => {
          if (!args.importer.startsWith(VENDOR_SRC)) return undefined
          return { path: join(COMPAT, 'undici.ts') }
        })
      },
    }],
    // 打进 bundle 的 CJS 依赖（undici）会用 require() 取 node 内置模块，
    // 与 `scripts/build-channel-pack.mjs` 同款补一条 createRequire 垫片。
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module'",
        'const require = __createRequire(import.meta.url)',
      ].join('\n'),
    },
  })
  return await import(pathToFileURL(outfile).href)
}

/** 一个只负责「端口有人听」的假代理；探测只看 TCP 建连。 */
async function listen(t): Promise<{ port: number; server: Server }> {
  const server = createServer(() => {})
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { port: address.port, server }
}

function tempFile(t) {
  const dir = mkdtempSync(join(tmpdir(), 'host-proxy-file-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'host-proxy.json')
}

test('配置文件只认「归一化得了的 url」，其余一律视为没有代理', async (t) => {
  const pack = await loadPack(t)
  assert.equal(pack.parseHostProxyConfig('{"url":"172.29.144.1:7890"}'), 'http://172.29.144.1:7890')
  assert.equal(pack.parseHostProxyConfig('{"url":"http://172.29.144.1:7890"}'), 'http://172.29.144.1:7890')
  // 脚本在「没探测到可达代理」时写的就是 null —— 必须是「无代理」而不是报错
  assert.equal(pack.parseHostProxyConfig('{"url":null}'), undefined)
  assert.equal(pack.parseHostProxyConfig('{"url":""}'), undefined)
  assert.equal(pack.parseHostProxyConfig('{ 坏掉的 json'), undefined)
  assert.equal(pack.parseHostProxyConfig('[]'), undefined)
  // 缺端口 / 协议不支持：normalizeProxy 建不出 dispatcher，这里提前判掉
  assert.equal(pack.parseHostProxyConfig('{"url":"http://172.29.144.1"}'), undefined)
  assert.equal(pack.parseHostProxyConfig('{"url":"ftp://172.29.144.1:21"}'), undefined)
})

test('MODELPORT_HOST_PROXY_FILE 决定读哪个文件，off 则彻底关闭', async (t) => {
  const pack = await loadPack(t)
  assert.equal(pack.hostProxyConfigPath({ MODELPORT_HOST_PROXY_FILE: 'off' }), undefined)
  assert.equal(pack.hostProxyConfigPath({ MODELPORT_HOST_PROXY_FILE: '0' }), undefined)
  assert.equal(pack.hostProxyConfigPath({ MODELPORT_HOST_PROXY_FILE: '/tmp/x.json' }), '/tmp/x.json')
  assert.match(pack.hostProxyConfigPath({}), /host-proxy\.json$/)

  const file = tempFile(t)
  const { port } = await listen(t)
  pack.resetHostProxyCache()
  writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${port}` }))
  assert.equal(await pack.resolveHostProxy({ MODELPORT_HOST_PROXY_FILE: file }), `http://127.0.0.1:${port}`)

  // 文件被删 = 代理停用：不抛错，返回「没有代理」
  unlinkSync(file)
  pack.resetHostProxyCache()
  assert.equal(await pack.resolveHostProxy({ MODELPORT_HOST_PROXY_FILE: file }), undefined)

  pack.resetHostProxyCache()
  assert.equal(await pack.resolveHostProxy({ MODELPORT_HOST_PROXY_FILE: 'off' }), undefined)
})

test('代理端口关掉后同一份配置自动退回无代理（存活探测，不需要重启）', async (t) => {
  const pack = await loadPack(t)
  const file = tempFile(t)
  const { port, server } = await listen(t)
  pack.resetHostProxyCache()
  writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${port}` }))
  const env = { MODELPORT_HOST_PROXY_FILE: file }
  assert.equal(await pack.resolveHostProxy(env), `http://127.0.0.1:${port}`)

  // 端口没人听了，但文件还在（脚本「保留上次地址」的语义）：判据只能来自探测本身
  await new Promise<void>(resolve => server.close(resolve))
  pack.resetHostProxyCache()
  assert.equal(await pack.resolveHostProxy(env), undefined)
})

test('出网路由：环境代理 > 宿主机代理文件 > 直连，NO_PROXY 对文件也生效', async (t) => {
  const pack = await loadPack(t)
  const fakeDispatcher = { destroy: async () => {} }

  const run = async ({ environment, hostProxy, url = 'https://cloudcode-pa.googleapis.com/v1internal' }) => {
    const used = []
    let passed = null
    const channel = pack.createChannelFetch({
      environment,
      platform: 'linux',
      hostProxy: async () => hostProxy,
      dispatcherFor: (proxy) => {
        used.push(proxy.url)
        return fakeDispatcher
      },
      fetchImpl: async (_input, init) => {
        passed = init?.dispatcher
        return new Response('ok')
      },
    })
    t.after(() => channel.close())
    await channel.fetch(url)
    return { used, passed }
  }

  const withFile = await run({ environment: {}, hostProxy: 'http://172.29.144.1:7890' })
  assert.deepEqual(withFile.used, ['http://172.29.144.1:7890'])
  assert.equal(withFile.passed, fakeDispatcher, '宿主机代理必须真的把 dispatcher 交给 fetch')

  const direct = await run({ environment: {}, hostProxy: undefined })
  assert.deepEqual(direct.used, [])
  assert.equal(direct.passed, undefined)

  const envWins = await run({
    environment: { HTTPS_PROXY: 'http://env-proxy.test:8080' },
    hostProxy: 'http://172.29.144.1:7890',
  })
  assert.deepEqual(envWins.used, ['http://env-proxy.test:8080'], '显式环境代理优先于脚本配置')

  const bypassed = await run({
    environment: { NO_PROXY: 'cloudcode-pa.googleapis.com' },
    hostProxy: 'http://172.29.144.1:7890',
  })
  assert.deepEqual(bypassed.used, [], 'NO_PROXY 命中时不得走宿主机代理')
})

test('走宿主机代理失败时，错误文案的路由段必须是「宿主机代理」', async (t) => {
  const pack = await loadPack(t)
  const channel = pack.createChannelFetch({
    environment: {},
    platform: 'linux',
    hostProxy: async () => 'http://172.29.144.1:7890',
    dispatcherFor: () => ({ destroy: async () => {} }),
    fetchImpl: async () => {
      throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
    },
  })
  t.after(() => channel.close())
  await assert.rejects(
    () => channel.fetch('https://cloudcode-pa.googleapis.com/v1internal'),
    (error) => {
      assert.match(error.message, /宿主机代理/, `路由段错了：${error.message}`)
      assert.match(error.message, /ETIMEDOUT/, `错误码要带上：${error.message}`)
      return true
    },
  )
})