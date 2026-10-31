import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GEMINI_HUB_MANIFEST_BASE,
  fetchAntigravityHubRelease,
  hubManifestName,
  parseAntigravityHubManifest,
} from '../../vendor/channel-pack/src/gemini-hub-manifest.ts'
import {
  ANTIGRAVITY_CHANGELOTS,
  ANTIGRAVITY_FALLBACK_VERSION,
  GEMINI_HUB_MANIFEST_TTL_MS,
  antigravityHubRelease,
  antigravityHubReleaseStale,
  antigravityUserAgent,
  describeGeminiIdentity,
  publishAntigravityHubRelease,
  resetAntigravityHubRelease,
  type GeminiIdentityEnv,
} from '../../vendor/channel-pack/src/gemini-identity.ts'

/** 更新站实测报文（2026-11-01 抓的 x64-win 清单，去掉无关字段）。 */
const WIN_MANIFEST = [
  'version: 2.28.2',
  'files:',
  '  - url: https://storage.googleapis.com/antigravity-public/antigravity-hub/2.28.2-5937220255875072/windows-x64/Antigravity.zip',
  '    sha512: aaa',
  'path: Antigravity.zip',
].join('\n')

const env: GeminiIdentityEnv = { env: {}, platform: 'win32', arch: 'x64' }

/** 走真的「取 + 发布」两步（调用方在生产里也是这么接的）。 */
async function prime(text: string): Promise<void> {
  resetAntigravityHubRelease()
  const release = await fetchAntigravityHubRelease({
    platform: 'win32',
    arch: 'x64',
    fetchImpl: async () => new Response(text, { status: 200 }),
  })
  publishAntigravityHubRelease(release)
}

test('manifest 文件名：认得清的组合才给 URL，认不出返回 undefined（不猜 URL）', () => {
  assert.equal(hubManifestName('win32', 'x64'), 'latest-x64-win.yml')
  assert.equal(hubManifestName('win32', 'arm64'), 'latest-arm64-win.yml')
  assert.equal(hubManifestName('darwin', 'arm64'), 'latest-arm64-mac.yml')
  assert.equal(hubManifestName('darwin', 'x64'), 'latest-x64-mac.yml')
  // Linux 的 arm64 清单实测 404 ⇒ Linux 一律走 x64 清单（只要版本号与 changelist，
  // 这几份清单当前给的是同一个号）。
  assert.equal(hubManifestName('linux', 'arm64'), 'latest-x64-linux.yml')
  assert.equal(hubManifestName('linux', 'x64'), 'latest-x64-linux.yml')
  assert.equal(hubManifestName('freebsd', 'x64'), undefined)
})

test('解析出版本号与藏在 url 段里的 changelist', () => {
  assert.deepEqual(parseAntigravityHubManifest(WIN_MANIFEST), {
    version: '2.28.2',
    changelist: '5937220255875072',
  })
})

test('changelist 认不出时**只给版本**，不编一个号；没有 version 行则整个不认', () => {
  assert.deepEqual(parseAntigravityHubManifest('version: 3.0.0\nurl: https://x/other/3.0.0/win.zip'), { version: '3.0.0' })
  assert.equal(parseAntigravityHubManifest('url: https://x/1.0.0-123/a.zip'), undefined)
  assert.equal(parseAntigravityHubManifest(''), undefined)
  // ⚠️ changelist 只认**与版本号一致**的那一段：别的号段的数字不得当成本次的号。
  assert.equal(parseAntigravityHubManifest('version: 2.28.2\nx: /1.0.0-99999/win/\n')?.changelist, undefined)
})

test('没发布过时用退档值 + 退档表（并钉住两份写死值）', () => {
  resetAntigravityHubRelease()
  assert.deepEqual(Object.keys(ANTIGRAVITY_CHANGELOTS).sort(), ['2.23.0', '2.24.0'])
  assert.equal(ANTIGRAVITY_FALLBACK_VERSION, '2.24.0')
  const ua = antigravityUserAgent(env)
  assert.ok(ua.startsWith('antigravity/hub/2.24.0 '), '退档：写死版本')
  assert.ok(ua.endsWith('cl=1000335682)'), '退档：写死表兜 changelist')
  assert.match(describeGeminiIdentity(env), /退档值/)
  assert.equal(antigravityHubReleaseStale(), true, '从没取到过 ⇒ 该取')
})

test('发布后现取值顶掉写死表（版本与 changelist 都跟 manifest 走）', async () => {
  await prime(WIN_MANIFEST)
  const ua = antigravityUserAgent(env)
  assert.ok(ua.startsWith('antigravity/hub/2.28.2 '), ua)
  assert.ok(ua.endsWith('cl=5937220255875072)'), 'manifest 的号顶掉写死表')
  assert.match(describeGeminiIdentity(env), /更新站现取/)
  assert.equal(antigravityHubReleaseStale(), false, 'TTL 内不该再打更新站')
})

test('TTL 过期后判成「该取」', () => {
  publishAntigravityHubRelease({ version: '2.28.2' }, Date.now() - GEMINI_HUB_MANIFEST_TTL_MS)
  assert.equal(antigravityHubReleaseStale(), true)
  publishAntigravityHubRelease({ version: '2.28.2' }, Date.now() - GEMINI_HUB_MANIFEST_TTL_MS + 60_000)
  assert.equal(antigravityHubReleaseStale(), false)
  resetAntigravityHubRelease()
})

test('取失败（undefined / 空版本）**不动已发布的值**，不把身份打回退档', async () => {
  await prime(WIN_MANIFEST)
  const before = antigravityHubRelease()?.version
  publishAntigravityHubRelease(undefined)
  publishAntigravityHubRelease({ version: '' })
  assert.equal(antigravityHubRelease()?.version, before)
  assert.ok(antigravityUserAgent(env).includes('2.28.2'))
  resetAntigravityHubRelease()
})

test('manifest 只给版本号时 cl 退到写死表；表里也没有就**不发 cl**', async () => {
  await prime('version: 2.24.0\n')
  assert.ok(antigravityUserAgent(env).endsWith('cl=1000335682)'), '表里有这一档 → 用表')

  await prime('version: 9.9.9\n')
  assert.equal(antigravityUserAgent(env).includes('cl='), false, '错号比不填更可疑')
  assert.ok(antigravityUserAgent(env).includes('9.9.9'), '版本照用现取值')
  resetAntigravityHubRelease()
})

test('显式覆盖赢过现取值', async () => {
  await prime(WIN_MANIFEST)
  assert.match(
    antigravityUserAgent({ ...env, env: { DSH_GEMINI_ANTIGRAVITY_VERSION: '2.10.0' } }),
    /^antigravity\/hub\/2\.10\.0/,
  )
  assert.match(describeGeminiIdentity({ ...env, env: { DSH_GEMINI_ANTIGRAVITY_VERSION: '2.10.0' } }), /覆盖值/)
  const noCl = antigravityUserAgent({ ...env, env: { DSH_GEMINI_CHANGELIST: '' } })
  assert.ok(noCl.includes('2.28.2'), '不发 cl 时版本照用现取值')
  assert.equal(noCl.includes('cl='), false)
  resetAntigravityHubRelease()
})

test('整条 UA 覆盖仍然最高优先，且空串不算覆盖', () => {
  assert.equal(
    antigravityUserAgent({ ...env, env: { DSH_GEMINI_USER_AGENT: ' antigravity/cli/1.2.3 (aidev_client) ' } }),
    'antigravity/cli/1.2.3 (aidev_client)',
  )
  assert.ok(antigravityUserAgent({ ...env, env: { DSH_GEMINI_USER_AGENT: '   ' } }).startsWith('antigravity/hub/'))
})

test('坏响应（非 2xx / 解析不出 / 抛错 / 认不出的平台）一律返回 undefined，不抛', async () => {
  const cases: Array<() => Promise<Response>> = [
    async () => new Response('{}', { status: 503 }),
    async () => new Response('nonsense', { status: 200 }),
    async () => {
      throw new Error('network down')
    },
  ]
  for (const fetchImpl of cases) {
    const release = await fetchAntigravityHubRelease({ platform: 'win32', arch: 'x64', fetchImpl })
    assert.equal(release, undefined)
  }
  // 认不出的平台：一次都不该打。
  let calls = 0
  const release = await fetchAntigravityHubRelease({
    platform: 'plan9',
    arch: 'x64',
    fetchImpl: async () => {
      calls++
      return new Response(WIN_MANIFEST, { status: 200 })
    },
  })
  assert.equal(release, undefined)
  assert.equal(calls, 0)
})

test('URL 走更新站基址 + 本平台清单', async () => {
  let seen = ''
  await fetchAntigravityHubRelease({
    platform: 'darwin',
    arch: 'arm64',
    fetchImpl: async (input) => {
      seen = String(input)
      return new Response(WIN_MANIFEST, { status: 200 })
    },
  })
  assert.equal(seen, `${GEMINI_HUB_MANIFEST_BASE}/latest-arm64-mac.yml`)
})
