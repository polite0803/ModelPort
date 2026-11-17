/**
 * 腾讯内容级风控（11128）的指纹改写与判据分流回归。
 *
 * 背景（2026-11-15 用户报障「Qoder 报错而 Claude Desktop 正常」）现网读数：
 * - 触发句是 Qoder 每轮注入 system 的 `Main branch (you will usually use this for PRs)`；
 * - `rewriteTencentContentFingerprints` 当时**全仓零调用点**（死代码），改写从未发生；
 * - 11128 的 `msg` 与 11140 共用 `request illegal`，被 `isContentRejection` 误认成账号级
 *   → 换号 + 30 分钟冷却；其 `displayTips` 里的「official client」又命中当时的停服标记
 *   → 一个健康登录被永久 `enabled:false`，池子随后报「没有其它可用账号可换」。
 *
 * 本测试钉三件事：
 * 1. 改写只动 system、大小写不敏感、无命中时**同一数组引用**（前缀缓存逐字节不变）；
 * 2. 接线齐备：buddy-adapter 真的调用了它，且在派生 `prompt_cache_key` 之前；
 * 3. 11128 与 11140 分流：内容级不冷却、不停用账号，停服判定让位于内容级。
 *
 * ⚠️ 被测模块 `tencent-fingerprint.ts` 零 import，可直接以 TS 源加载
 *    （同 `account-stop.test.ts`），不走 esbuild。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')

async function loadFingerprints() {
  return await import(pathToFileURL(join(VENDOR_SRC, 'openai-gateway', 'tencent-fingerprint.ts')).href)
}

/** 表里两条有实发证据的指纹（被拦 + 改写后放行）。 */
const FIND = 'Main branch (you will usually use this for PRs)'
const REPLACE = 'Main branch (PRs usually go here)'
const CLAUDE_SENTENCE = "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."
const CLAUDE_REPLACE = 'You are an AI assistant working with the user toward their goals.'
const BILLING_LINE = 'x-anthropic-billing-header: cc_version=2.1.325.5be; cc_entrypoint=claude-desktop-3p;'

test('改写所有 system（含非首位），大小写不敏感，user/tool 原样', async () => {
  const { rewriteTencentSystemMessages } = await loadFingerprints()
  const messages = [
    { role: 'system', content: `# gitStatus\n${FIND}: main\n` },
    { role: 'user', content: FIND },
    { role: 'tool', content: FIND },
    { role: 'system', content: FIND.toUpperCase() },
    { role: 'system', content: `${FIND} 和 ${FIND}` },
  ]
  const out = rewriteTencentSystemMessages(messages, 'workbuddy')
  assert.equal(out[0].content, `# gitStatus\n${REPLACE}: main\n`)
  // user / tool 里同一句实测**不拦**，改它只会白白破坏用户原话与工具输出。
  assert.equal(out[1].content, FIND)
  assert.equal(out[2].content, FIND)
  // 全大写同样被拦，所以匹配带 i；替换文本是表里的等义句，不跟随原文大小写。
  assert.equal(out[3].content, REPLACE)
  // g：一条消息里的多次出现都要改。
  assert.equal(out[4].content, `${REPLACE} 和 ${REPLACE}`)
})

test('无命中时返回同一个数组引用（前缀缓存不得被无谓重建）', async () => {
  const { rewriteTencentSystemMessages } = await loadFingerprints()
  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'hi' },
  ]
  for (const provider of ['buddy', 'workbuddy']) {
    assert.equal(rewriteTencentSystemMessages(messages, provider), messages)
  }
  // 只差一个词 / 多一个空格都不拦（服务端认逐字符字面量），因此也不该改。
  const near = [{ role: 'system', content: 'Main branch (you will normally use this for PRs): main' }]
  assert.equal(rewriteTencentSystemMessages(near, 'workbuddy'), near)
  const spaced = [{ role: 'system', content: 'Main branch  (you will usually use this for PRs): main' }]
  assert.equal(rewriteTencentSystemMessages(spaced, 'workbuddy'), spaced)
})

test('Claude Desktop 3p：billing 标记行整行剥除，首句等义替换', async () => {
  const { rewriteTencentSystemMessages } = await loadFingerprints()
  // 真实形状：标记行与首句在同一行，剥行后该行整条消失。
  const messages = [{ role: 'system', content: `${BILLING_LINE}${CLAUDE_SENTENCE}\nYou are an agent working.` }]
  const out = rewriteTencentSystemMessages(messages, 'workbuddy')
  assert.equal(out[0].content, 'You are an agent working.')

  // 首句独立成行时（别的入口形态）走字面量等义替换。
  const onlySentence = [{ role: 'system', content: `${CLAUDE_SENTENCE}\nrest` }]
  const out2 = rewriteTencentSystemMessages(onlySentence, 'workbuddy')
  assert.equal(out2[0].content, `${CLAUDE_REPLACE}\nrest`)

  // 大小写不敏感的剥行（标记前缀大小写变了同样剥）。
  const upper = [{ role: 'system', content: `${BILLING_LINE.toUpperCase()}tail` }]
  assert.equal(rewriteTencentSystemMessages(upper, 'workbuddy')[0].content, '')

  // 非腾讯系不改。
  assert.equal(rewriteTencentSystemMessages(messages, 'qoder'), messages)
})

test('非腾讯系 provider 原样返回', async () => {
  const { rewriteTencentSystemMessages } = await loadFingerprints()
  const messages = [{ role: 'system', content: FIND }]
  for (const provider of ['qoder', 'qodercn', 'trae', 'cline', 'zcode', '']) {
    assert.equal(rewriteTencentSystemMessages(messages, provider), messages)
  }
})

test('多模态 content（parts 数组）不动，命中时也不 mutate 原对象', async () => {
  const { rewriteTencentSystemMessages } = await loadFingerprints()
  const parts = [{ type: 'text', text: FIND }]
  const multimodal = [{ role: 'system', content: parts }]
  assert.equal(rewriteTencentSystemMessages(multimodal, 'workbuddy'), multimodal)

  const user = { role: 'user', content: 'hi' }
  const system = { role: 'system', content: FIND }
  const out = rewriteTencentSystemMessages([user, system], 'workbuddy')
  assert.notEqual(out[1], system, '被改的那条是新对象')
  assert.equal(out[0], user, '其余元素保持同一引用')
  assert.equal(system.content, FIND, '入参不得被就地改写')
})

test('接线齐备：适配器在派生缓存键之前改写了 system', () => {
  const buddy = readFileSync(join(VENDOR_SRC, 'buddy-adapter.ts'), 'utf8')
  assert.match(
    buddy,
    /import \{ rewriteTencentSystemMessages \} from '\.\/openai-gateway\/tencent-fingerprint\.js'/,
    '必须 import 改写函数（此前它全仓零调用点，是死代码）',
  )
  const call = buddy.indexOf('rewriteTencentSystemMessages(serialized, this.product.id)')
  assert.ok(call > 0, '必须在出站构造处真的调用它')
  const cacheKey = buddy.indexOf('prompt_cache_key: this.promptCacheKey(')
  assert.ok(cacheKey > call, '改写必须先于缓存键派生，否则键与实际发出的前缀不一致')
})

test('11128 与 11140 分流：内容级不冷却、不停用账号', () => {
  const buddy = readFileSync(join(VENDOR_SRC, 'buddy-adapter.ts'), 'utf8')

  // 判据只认业务码 —— `request illegal` 两个码共用，靠文案分不开。
  const verifyStart = buddy.indexOf('function isChannelVerificationRejection(')
  assert.ok(verifyStart > 0)
  const verifyBody = buddy.slice(verifyStart, buddy.indexOf('\n}', verifyStart))
  assert.match(verifyBody, /11128/)
  assert.doesNotMatch(verifyBody, /request illegal/, '不得用共用文案当判据')

  // isContentRejection 必须先排除 11128，否则换号 + 30 分钟冷却白锁整池。
  const rejectionStart = buddy.indexOf('function isContentRejection(')
  const rejectionBody = buddy.slice(rejectionStart, buddy.indexOf('\n}', rejectionStart))
  assert.match(rejectionBody, /if \(isChannelVerificationRejection\(body\)\) return false/)

  // 停服判定让位于内容级：三条路径都走 helper，不再直接调共享判据。
  const stopStart = buddy.indexOf('function isAccountStop(')
  assert.ok(stopStart > 0)
  const stopBody = buddy.slice(stopStart, buddy.indexOf('\n}', stopStart))
  assert.match(stopBody, /!isContentRejection\(body\)/)
  assert.match(stopBody, /!isChannelVerificationRejection\(body\)/)
  assert.equal((buddy.match(/if \(isAccountStop\(/g) ?? []).length, 3, '换号 / 首发 / 限流换号三条路')
  assert.equal((buddy.match(/if \(isAccountStoppedMessage\(/g) ?? []).length, 0)

  // HTTP 与流内两条路都要如实报错，而不是冷却账号或静默丢帧。
  assert.equal((buddy.match(/throw channelVerificationError\(/g) ?? []).length, 2)
  const errorStart = buddy.indexOf('function channelVerificationError(')
  const errorBody = buddy.slice(errorStart, buddy.indexOf('\n}', errorStart))
  assert.match(errorBody, /'INVALID_REQUEST'/, '内容级请求问题；AUTH 会把用户引向重新登录')
  assert.doesNotMatch(errorBody, /markPolicyBlockedAccount|parkStoppedAccount/)
})