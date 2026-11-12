/**
 * opencode 匿名槽与账号级出口代理的行为门（2026-11-12）。
 *
 * 被测代码全在 vendored pack 里，而 pack 的源码用 `.js` 后缀写相对导入
 * （那是给 worker bundle 用的），Node 的 TS 类型剥离**不会**把 `.js` 映射回
 * `.ts` ⇒ 直接 `import '../../vendor/.../opencode.ts'` 在解析阶段就
 * `ERR_MODULE_NOT_FOUND`。故按 `tests/channels/account-pool-balance-demote.test.ts`
 * 的同一口径，先用 esbuild 打成临时 bundle 再 import。
 *
 * ⚠️ 与那批文件同属「禁子进程沙箱里会 spawn EPERM」的一类：那里的红是环境问题。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getChannelDefinition } from '../../src/main/providers/accountChannels/catalogue.ts'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

const ALIAS = {
  '@deepseek-ai/dsh-llm': join(COMPAT, 'dshLlm.ts'),
  '@deepseek-ai/dsh-credentials': join(COMPAT, 'dshCredentials.ts'),
  '@deepseek-ai/cordis': join(COMPAT, 'cordis.ts'),
  '@deepseek-ai/schemastery': join(COMPAT, 'schemastery.ts'),
  '@deepseek-ai/dsh-agent': join(COMPAT, 'dshAgent.ts'),
}

const bundleDir = mkdtempSync(join(tmpdir(), 'opencode-proxy-slots-'))
process.on('exit', () => rmSync(bundleDir, { recursive: true, force: true }))

const outfile = join(bundleDir, 'pack.mjs')
{
  const esbuild = await import('esbuild')
  await esbuild.build({
    stdin: {
      contents: [
        `export { normalizeProxy } from ${JSON.stringify(join(VENDOR_SRC, 'opencode.ts'))}`,
        `export { isAnonymousCredential, listIdentitySlots, pickSlot } from ${JSON.stringify(join(VENDOR_SRC, 'opencode-auth.ts'))}`,
        `export { OPENCODE } from ${JSON.stringify(join(VENDOR_SRC, 'opencode-product.ts'))}`,
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
    alias: ALIAS,
  })
}
const pack = await import(pathToFileURL(outfile).href)
const { isAnonymousCredential, listIdentitySlots, normalizeProxy, OPENCODE, pickSlot } = pack

/** 免费档模型（`isFree` 为真 —— 匿名槽只被免费模型接受）。 */
const FREE_MODEL = 'big-pickle'
/** 收费模型 —— 匿名槽必须跳过。 */
const PAID_MODEL = 'deepseek-v4-flash'
const UA = 'opencode/cli/2.0.0/test'

/** 匿名槽条目的最小快照（`api_key` 固定字面量 `public`）。 */
function anon(id: string, proxy?: string) {
  return {
    id,
    enabled: true,
    apiKey: OPENCODE.anonymousKey,
    ...(proxy === undefined ? {} : { proxy }),
  }
}

test('代理归一：裸 host:port 补 http，socks5h 归一为 socks5，口令进 label 时被掩码', () => {
  const bare = normalizeProxy('127.0.0.1:7897')
  assert.equal(bare.ok, true)
  assert.equal(bare.ok && bare.proxy.url, 'http://127.0.0.1:7897')
  assert.equal(bare.ok && bare.proxy.kind, 'http')

  const socks = normalizeProxy('socks5h://10.0.0.2:1080')
  assert.equal(socks.ok, true)
  assert.equal(socks.ok && socks.proxy.url, 'socks5://10.0.0.2:1080')

  const auth = normalizeProxy('http://user:secret@10.0.0.3:3128')
  assert.equal(auth.ok, true)
  assert.equal(auth.ok && auth.proxy.label, 'http://user:***@10.0.0.3:3128')
  assert.ok(auth.ok && !auth.proxy.label.includes('secret'), 'label 不能带明文口令')
})

test('代理归一：缺端口、空串与不支持的协议都要可读拒绝（空串归清理分支）', () => {
  const noPort = normalizeProxy('http://127.0.0.1')
  assert.equal(noPort.ok, false)
  assert.ok(!noPort.ok && noPort.reason.includes('端口'))

  const empty = normalizeProxy('   ')
  assert.equal(empty.ok, false)

  const badScheme = normalizeProxy('ftp://127.0.0.1:21')
  assert.equal(badScheme.ok, false)
  assert.ok(!badScheme.ok && badScheme.reason.includes('http/https/socks5'))

  // 显式默认端口是合法输入（`new URL().port` 会抹掉它，故判据必须取原始权威段）。
  const explicit = normalizeProxy('https://127.0.0.1:443')
  assert.equal(explicit.ok, true)
  assert.equal(explicit.ok && explicit.proxy.url, 'https://127.0.0.1:443')
})

test('槽摊平：两台不同出口的匿名槽互为独立槽，且指纹按条目 id 分离', () => {
  const slots = listIdentitySlots([anon('opencode-anon-aaa', 'http://10.0.0.2:7897'), anon('opencode-anon-bbb', 'socks5://10.0.0.3:1080')], UA)
  assert.equal(slots.length, 2)
  assert.deepEqual(slots.map(slot => slot.id), ['opencode-anon-aaa', 'opencode-anon-bbb'])
  assert.ok(slots.every(slot => slot.kind === 'anonymous'))
  assert.equal(slots[0]!.proxy?.url, 'http://10.0.0.2:7897')
  assert.equal(slots[1]!.proxy?.url, 'socks5://10.0.0.3:1080')
  // 两个匿名槽的 api_key 相同，指纹必须按条目 id 派生，否则两条槽在上游是同一份身份。
  assert.notEqual(slots[0]!.fingerprint.projectId, slots[1]!.fingerprint.projectId)
})

test('槽摊平：非法代理降级为直连并保留该槽，停用槽不进入序列', () => {
  const slots = listIdentitySlots(
    [anon('opencode-anon-bad', 'http://127.0.0.1'), anon('opencode-anon-off', 'http://10.0.0.4:7897')]
      .map((entry, index) => (index === 1 ? { ...entry, enabled: false } : entry)),
    UA,
  )
  assert.equal(slots.length, 1, '停用的槽不能被摊平进来')
  assert.equal(slots[0]!.id, 'opencode-anon-bad')
  assert.equal(slots[0]!.proxy, undefined, '非法代理降级为直连，而不是把整家打死')
})

test('槽选择：收费模型跳过匿名槽，免费模型才轮换匿名槽', () => {
  const free = listIdentitySlots([anon('opencode-anon-aaa', 'http://10.0.0.2:7897')], UA)
  assert.equal(pickSlot(free, FREE_MODEL, new Set())?.id, 'opencode-anon-aaa')
  assert.equal(pickSlot(free, PAID_MODEL, new Set()), undefined)
  assert.equal(pickSlot(free, FREE_MODEL, new Set(['opencode-anon-aaa'])), undefined, '每个槽最多试一次')
})

test('目录声明：只有 opencode 开放账号级出口，且方法名属于本渠道', () => {
  const opencode = getChannelDefinition('opencode')
  assert.deepEqual(opencode?.proxyEdit, { set: 'opencode.setProxy', test: 'opencode.testProxy' })
  assert.ok(opencode?.proxyEdit?.set.startsWith('opencode.'))
  assert.ok(opencode?.proxyEdit?.test.startsWith('opencode.'))

  for (const id of ['cline', 'qoder', 'trae', 'codearts']) {
    assert.equal(getChannelDefinition(id)?.proxyEdit, undefined, `${id} 不该凭空获得账号级出口`)
  }
})

test('「出口」对话框文案两种语言齐备且插值占位符完整', () => {
  const read = (locale: string) => JSON.parse(
    readFileSync(join(process.cwd(), `src/renderer/src/i18n/locales/${locale}.json`), 'utf8'),
  ).channels.proxy as Record<string, string>
  const zh = read('zh-CN')
  const en = read('en-US')
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of Object.keys(zh)) {
    assert.ok(zh[key].length > 0, `zh-CN 缺 channels.proxy.${key}`)
    assert.ok(en[key].length > 0)
  }
  const slots = (text: string): string[] => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort().join(',')
  for (const key of ['title', 'current', 'testOk']) {
    assert.equal(slots(zh[key]!), slots(en[key]!), `channels.proxy.${key} 的占位符不一致`)
  }
})

// 匿名槽的判定就是那个字面量，改它等于换凭据协议 —— 这里钉住。
test('匿名凭据判据只认 `public` 字面量', () => {
  assert.equal(isAnonymousCredential(OPENCODE.anonymousKey), true)
  assert.equal(isAnonymousCredential('sk-live'), false)
  assert.equal(isAnonymousCredential(undefined), false)
})