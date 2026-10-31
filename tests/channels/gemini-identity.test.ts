import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANTIGRAVITY_CHANGELOTS,
  GEMINI_LEGACY_IDENTITY_HEADERS,
  antigravityOsType,
  antigravityUserAgent,
  describeGeminiIdentity,
  geminiIdentityHeaders,
  type GeminiIdentityEnv,
} from '../../vendor/channel-pack/src/gemini-identity.ts'

/** 注入用的“假进程”：不碰真的 `process.env`，两条路径都能各测各的。 */
function env(overrides: Record<string, string | undefined> = {}, platform = 'win32', arch = 'x64'): GeminiIdentityEnv {
  return { env: { ...overrides }, platform, arch }
}

test('默认只发 User-Agent，而且不再带任何 cmdc-pak 字样', () => {
  const headers = geminiIdentityHeaders(env())
  assert.deepEqual(Object.keys(headers), ['User-Agent'], '默认头集合必须只有一个')
  const ua = headers['User-Agent'] ?? ''
  assert.equal(ua, 'antigravity/hub/2.24.0 (aidev_client; os_type=windows; arch=x64; cl=1000335682)')
  assert.equal(ua.toLowerCase().includes('cmdc-pak'), false, '第三方工具名不得再出现在身份里')
})

test('旧五件套只在回退开关下逐字恢复', () => {
  const legacy = env({ DSH_GEMINI_LEGACY_IDENTITY_HEADERS: '1' })
  assert.deepEqual(geminiIdentityHeaders(legacy), GEMINI_LEGACY_IDENTITY_HEADERS)
  assert.equal(GEMINI_LEGACY_IDENTITY_HEADERS['x-machine-id'], 'cmdc-pak')
  assert.equal(GEMINI_LEGACY_IDENTITY_HEADERS['User-Agent'], 'antigravity/4.3.0 (cmdc-pak)')
  assert.match(describeGeminiIdentity(legacy), /回退态/)
  assert.match(describeGeminiIdentity(env()), /^antigravity hub UA antigravity\/hub\//)
})

test('平台映射：win32→windows、darwin→darwin、其余→linux；架构原样透传', () => {
  assert.equal(antigravityOsType('win32'), 'windows')
  assert.equal(antigravityOsType('darwin'), 'darwin')
  assert.equal(antigravityOsType('freebsd'), 'linux')
  assert.ok(antigravityUserAgent(env({}, 'darwin', 'arm64')).includes('os_type=darwin; arch=arm64'))
  assert.ok(antigravityUserAgent(env({}, 'linux', 'arm64')).includes('os_type=linux; arch=arm64'))
})

test('版本号不在表里时**不发** cl=：错号比不填更可疑', () => {
  assert.deepEqual(Object.keys(ANTIGRAVITY_CHANGELOTS).sort(), ['2.23.0', '2.24.0'])
  const ua = antigravityUserAgent(env({ DSH_GEMINI_ANTIGRAVITY_VERSION: '2.99.0' }))
  assert.equal(ua, 'antigravity/hub/2.99.0 (aidev_client; os_type=windows; arch=x64)')
  assert.equal(ua.includes('cl='), false)
  assert.ok(
    antigravityUserAgent(env({ DSH_GEMINI_ANTIGRAVITY_VERSION: '2.23.0' })).endsWith('cl=998057262)'),
    '表里的版本号要带上对应 changelist',
  )
})

test('cl= 的三种写法：不填查表、显式空串=不发、显式值=照发', () => {
  assert.ok(antigravityUserAgent(env()).endsWith('cl=1000335682)'), '不填 → 查表')
  assert.equal(antigravityUserAgent(env({ DSH_GEMINI_CHANGELIST: '' })).includes('cl='), false, '显式空串 → 不发')
  assert.ok(antigravityUserAgent(env({ DSH_GEMINI_CHANGELIST: '1234567' })).endsWith('cl=1234567)'))
})

test('整条 UA 可覆盖（真机抓到不同拼写时不必改代码），空串不算覆盖', () => {
  assert.equal(
    antigravityUserAgent(env({ DSH_GEMINI_USER_AGENT: ' antigravity/cli/1.2.3 (aidev_client) ' })),
    'antigravity/cli/1.2.3 (aidev_client)',
  )
  assert.ok(antigravityUserAgent(env({ DSH_GEMINI_USER_AGENT: '   ' })).startsWith('antigravity/hub/2.24.0 '))
  assert.ok(
    antigravityUserAgent(env({ DSH_GEMINI_OS_TYPE: 'freebsd', DSH_GEMINI_ARCH: 'riscv' })).includes('os_type=freebsd; arch=riscv'),
    '两个字段各自可覆盖',
  )
})
