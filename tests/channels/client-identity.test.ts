/**
 * 客户端版本探测的回归测试（2026-11-05）。
 *
 * 覆盖：语义版本比较、env 覆盖优先级、缓存重置。不依赖本机是否安装官方客户端
 * —— 本机安装路径的读取由实现保证，测试只钉确定性的分支。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clientIdentitySnapshot,
  codebuddyClientVersion,
  compareVersions,
  normalizeBuildVersion,
  qoderClientVersion,
  resetClientVersionCache,
  traeClientIdentity,
  workbuddyClientVersion,
} from '../../vendor/channel-pack/src/client-identity.ts'

const ROOT = process.cwd()

test('语义版本比较按数字段逐位比较', () => {
  assert.ok(compareVersions('0.5.3', '0.5.1') > 0)
  assert.ok(compareVersions('5.9.3', '5.10.0') < 0)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
})

test('官方返回的构建号 normalize 成 UA 用的三段版本', () => {
  assert.equal(normalizeBuildVersion('5.9.3.42398134'), '5.9.3')
  assert.equal(normalizeBuildVersion('0.5.3'), '0.5.3')
  assert.equal(normalizeBuildVersion('v1.2.3'), undefined)
})

test('env 覆盖优先于本机安装', () => {
  const previous = process.env.MODELPORT_WORKBUDDY_VERSION
  process.env.MODELPORT_WORKBUDDY_VERSION = '9.9.9'
  resetClientVersionCache()
  try {
    const info = workbuddyClientVersion()
    assert.equal(info.version, '9.9.9')
    assert.equal(info.source, 'env')
  } finally {
    if (previous === undefined) delete process.env.MODELPORT_WORKBUDDY_VERSION
    else process.env.MODELPORT_WORKBUDDY_VERSION = previous
    resetClientVersionCache()
  }
})

test('Qoder 的 env 覆盖按渠道区分', () => {
  const previous = process.env.MODELPORT_QODERCN_VERSION
  process.env.MODELPORT_QODERCN_VERSION = '0.7.1'
  resetClientVersionCache()
  try {
    const info = qoderClientVersion('qodercn')
    assert.equal(info.version, '0.7.1')
    assert.equal(info.source, 'env')
  } finally {
    if (previous === undefined) delete process.env.MODELPORT_QODERCN_VERSION
    else process.env.MODELPORT_QODERCN_VERSION = previous
    resetClientVersionCache()
  }
})

test('CodeBuddy 的 env 覆盖生效', () => {
  const previous = process.env.MODELPORT_CODEBUDDY_VERSION
  process.env.MODELPORT_CODEBUDDY_VERSION = '1.200.0'
  resetClientVersionCache()
  try {
    const info = codebuddyClientVersion()
    assert.equal(info.version, '1.200.0')
    assert.equal(info.source, 'env')
  } finally {
    if (previous === undefined) delete process.env.MODELPORT_CODEBUDDY_VERSION
    else process.env.MODELPORT_CODEBUDDY_VERSION = previous
    resetClientVersionCache()
  }
})

test('Trae 的 appVersion / versionCode / ideVersion 分别映射到对应头', () => {
  const previous = {
    app: process.env.MODELPORT_TRAE_VERSION,
    code: process.env.MODELPORT_TRAE_VERSION_CODE,
    ide: process.env.MODELPORT_TRAE_IDE_VERSION,
  }
  process.env.MODELPORT_TRAE_VERSION = '9.9.9'
  process.env.MODELPORT_TRAE_VERSION_CODE = '20990101'
  process.env.MODELPORT_TRAE_IDE_VERSION = '2.0.0'
  resetClientVersionCache()
  try {
    const info = traeClientIdentity()
    assert.equal(info.appVersion, '9.9.9')
    assert.equal(info.versionCode, '20990101')
    assert.equal(info.ideVersion, '2.0.0')
    assert.equal(info.source, 'env')
  } finally {
    for (const [key, value] of [
      ['MODELPORT_TRAE_VERSION', previous.app],
      ['MODELPORT_TRAE_VERSION_CODE', previous.code],
      ['MODELPORT_TRAE_IDE_VERSION', previous.ide],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetClientVersionCache()
  }
})

test('Trae 请求头不再写死 macOS / 0.1.52', () => {
  const source = readFileSync(
    join(ROOT, 'vendor', 'channel-pack', 'src', 'trae.ts'),
    'utf8',
  )
  assert.match(source, /traeClientIdentity\(/)
  assert.match(source, /traeDeviceHeaders\(/)
  assert.doesNotMatch(source, /'X-Device-Type': 'macos'/)
  assert.doesNotMatch(source, /Trae\/0\.1\.52/)
})

test('本机安装发现覆盖 WSL 的 Windows 侧（Trae 不再恒 fallback）', () => {
  const previous = {
    localAppData: process.env.LOCALAPPDATA,
    traeVersion: process.env.MODELPORT_TRAE_VERSION,
  }
  const dir = mkdtempSync(join(tmpdir(), 'modelport-client-identity-'))
  const productDir = join(dir, 'Programs', 'Trae CN', 'resources', 'app')
  mkdirSync(productDir, { recursive: true })
  writeFileSync(join(productDir, 'product.json'), JSON.stringify({
    version: '1.107.1',
    appVersion: '3.5.1',
    traeVersionCode: '20251101',
  }))
  process.env.LOCALAPPDATA = dir
  delete process.env.MODELPORT_TRAE_VERSION
  resetClientVersionCache()
  try {
    const info = traeClientIdentity()
    assert.equal(info.appVersion, '3.5.1')
    assert.equal(info.versionCode, '20251101')
    assert.equal(info.source, 'local-install')
  } finally {
    if (previous.localAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previous.localAppData
    if (previous.traeVersion === undefined) delete process.env.MODELPORT_TRAE_VERSION
    else process.env.MODELPORT_TRAE_VERSION = previous.traeVersion
    resetClientVersionCache()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('官方版本源不再被宿主平台挡住（WSL / macOS 也能取 WorkBuddy 与 Qoder）', () => {
  const source = readFileSync(
    join(ROOT, 'vendor', 'channel-pack', 'src', 'client-identity.ts'),
    'utf8',
  )
  assert.doesNotMatch(source, /if \(process\.platform !== 'win32'\) return/)
  assert.match(source, /workbuddy-win32-/)
  // 国际版清单的静态站不可达时改走 download.qoder.com（2026-11-08 实测 200）。
  assert.match(source, /https:\/\/download\.qoder\.com\/qoder-app\/releases\/latest\.yml/)
  // WSL 下通过 /mnt/c 读 Windows 侧安装。
  assert.match(source, /\/mnt\/\$\{drive\}\/Users/)
})

test('B4 快照：五条动态渠道全覆盖、形状可跨 RPC 序列化', () => {
  const entries = clientIdentitySnapshot()
  assert.deepEqual(
    entries.map(entry => entry.channel).sort(),
    ['buddy', 'qoder', 'qodercn', 'trae', 'workbuddy'],
  )
  for (const entry of entries) {
    assert.match(entry.version, /^\d+(\.\d+)+$/, `${entry.channel} 版本号非法: ${entry.version}`)
    assert.ok(
      ['env', 'official', 'local-install', 'fallback'].includes(entry.source),
      `${entry.channel} 来源非法: ${entry.source}`,
    )
    assert.ok(Number.isFinite(entry.checkedAt) && entry.checkedAt > 0)
    // 快照要穿过 worker RPC 边界：必须可 JSON 序列化。
    JSON.stringify(entry)
  }
  const trae = entries.find(entry => entry.channel === 'trae')
  assert.match(trae?.detail ?? '', /X-Ide-Version-Code/, 'trae 快照缺版本码补充信息')
})

test('B4 接线：RPC case / 管理方法 / 管理路由 / 渠道页全部就位', () => {
  const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

  const rpc = read('vendor/channel-pack/src/channel-pack-rpc.ts')
  assert.match(rpc, /case 'identity\.snapshot':/)
  assert.match(rpc, /clientIdentitySnapshot\(\)/)

  const manager = read('src/main/providers/accountChannels/manager.ts')
  assert.match(manager, /async identitySnapshot\(\)/)

  const route = read('src/main/proxy/routes/management/identity.ts')
  assert.match(route, /\/v1\/management\/channels\/identity/)
  assert.match(route, /accountChannelManager\.identitySnapshot\(\)/)
  const routeIndex = read('src/main/proxy/routes/management/index.ts')
  assert.match(routeIndex, /identityRouter/)

  const page = read('src/renderer/src/pages/Channels.tsx')
  assert.match(page, /identity\.snapshot/)
})

test('B5 配套：identity.refresh 强制刷新链路就位', () => {
  const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

  const identity = read('vendor/channel-pack/src/client-identity.ts')
  assert.match(identity, /export async function forceIdentityRefresh/)

  const rpc = read('vendor/channel-pack/src/channel-pack-rpc.ts')
  assert.match(rpc, /case 'identity\.refresh':/)
  assert.match(rpc, /forceIdentityRefresh\(\)/)

  const manager = read('src/main/providers/accountChannels/manager.ts')
  assert.match(manager, /async identityRefresh\(\)/)

  const route = read('src/main/proxy/routes/management/identity.ts')
  assert.match(route, /router\.post\('\/refresh'/)
  assert.match(route, /accountChannelManager\.identityRefresh\(\)/)
})

test('请求头构造点已接入动态版本，不再写死 1.0.0', () => {
  const read = (rel: string): string =>
    readFileSync(join(ROOT, 'vendor', 'channel-pack', 'src', rel), 'utf8')

  const product = read('product.ts')
  assert.match(product, /workbuddyClientVersion\(\)\.version/)
  assert.match(product, /codebuddyClientVersion\(\)\.version/)
  // 2026-11-05 改名：CodeBuddy（腾讯）→ WorkBuddy（国内版），UA 品牌必须是
  // WorkBuddy 国内客户端形态，CodeBuddyIDE 只允许出现在历史说明注释里。
  // 2026-11-05 起 userAgent 是 getter（每次访问按取值链渲染当前版本），
  // 不再是模块级字面量 —— 断言改钉 getter + buddyUserAgent 渲染函数。
  assert.match(product, /get userAgent\(\): string/)
  assert.match(product, /buddyUserAgent\('cn', codebuddyClientVersion\(\)\.version\)/)
  assert.match(product, /buddyUserAgent\('intl', workbuddyClientVersion\(\)\.version\)/)
  assert.doesNotMatch(product, /userAgent: 'CodeBuddyIDE\//)
  const adapter = read('buddy-adapter.ts')
  assert.match(adapter, /workbuddyClientVersion\(\)\.version/)
  assert.match(adapter, /codebuddyClientVersion\(\)\.version/)
  const buddy = read('buddy.ts')
  // 凭据级基础头走 CODEBUDDY.userAgent getter；旧常量 BUDDY_USER_AGENT 已删
  // （模块级 IIFE 只在加载时求值一次，长驻进程会僵化在旧版本上）。
  assert.match(buddy, /'User-Agent': CODEBUDDY\.userAgent,/)
  assert.doesNotMatch(buddy, /BUDDY_USER_AGENT =/)
  assert.doesNotMatch(buddy, /CodeBuddyIDE\//)
  const qoder = read('qoder.ts')
  assert.match(qoder, /qoderClientVersion\(/)
  assert.doesNotMatch(qoder, /userAgentPrefix}\/1\.0\.0/)
  const auth = read('qoder-auth.ts')
  assert.match(auth, /qoderClientVersion\(/)
  assert.doesNotMatch(auth, /userAgentPrefix}\/1\.0\.0/)
  // G1（2026-11-05）：登录与积分路径的 UA 必须与聊天路径同源 —— 都经
  // product.userAgent getter（动态渲染）。这两个文件不允许再出现写死的
  // WorkBuddy/<版本> 字面量，也不允许发框架默认 UA。
  for (const rel of ['buddy-oauth.ts', 'buddy-credits.ts']) {
    const source = read(rel)
    assert.match(source, /product\.userAgent/, `${rel} 的 UA 必须取自 product.userAgent getter`)
    assert.doesNotMatch(source, /'User-Agent': 'WorkBuddy\//, `${rel} 不得写死 WorkBuddy 字面量 UA`)
    assert.doesNotMatch(source, /CodeBuddyIDE\//, `${rel} 不得发旧品牌`)
  }
})
