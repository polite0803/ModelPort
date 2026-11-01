import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ACCOUNT_CHANNELS,
  channelModelName,
  getChannelDefinition,
  isAccountChannelId,
} from '../../src/main/providers/accountChannels/catalogue.ts'
import { channelAddFlowOf } from '../../src/shared/channels.ts'

const PACK_STORE = join(process.cwd(), 'vendor', 'channel-pack', 'src', 'channel-pack-store.ts')

/**
 * 渠道包认定的 provider 全集。
 *
 * 判据取 `channel-pack-store.ts` 的 `REF_PREFIX_TO_PROVIDER`，不取 index.ts 的文本：
 * 那张表既是 `isSupportedProvider()` 的唯一依据（不在表里的 provider，渠道管理 RPC
 * 直接回 `provider-unsupported`），也是备份恢复建索引的依据 —— 拿它当权威，测的就是
 * 「这个渠道能不能被本应用真正驱动」这件事本身。
 */
function packProviderIds(): string[] {
  const source = readFileSync(PACK_STORE, 'utf8')
  const table = source.slice(source.indexOf('REF_PREFIX_TO_PROVIDER'))
  return [...table.matchAll(/^\s*\['[A-Z]+', '([a-z]+)'\],/gm)].map(match => match[1])
}

test('the catalogue ships exactly thirteen channels with unique ids', () => {
  assert.equal(ACCOUNT_CHANNELS.length, 13)
  const ids = new Set<string>()
  for (const channel of ACCOUNT_CHANNELS) {
    assert.equal(ids.has(channel.id), false, `duplicate channel id: ${channel.id}`)
    ids.add(channel.id)
    assert.ok(channel.name.length > 0)
    assert.ok(channel.vendor.length > 0)
  }
})

test('目录与渠道包的 provider 全集双向对齐', () => {
  // 不 import vendor 源码（它会拉到 dsh-llm 等虚拟模块，node --test 里无法解析），
  // 只在源码文本里读那张表。这一条防两个方向：目录里凭空加一个上游没有的渠道，
  // 以及上游合并了新渠道而目录静默漏接（历史上漏加过 minimax/opencode/gemini/buddy）。
  const shipped = ACCOUNT_CHANNELS.map(channel => channel.id).sort()
  const inPack = packProviderIds().sort()
  assert.deepEqual(shipped, inPack, `shipped=${shipped} pack=${inPack}`)
})

test('每种登录方式在两种语言里都有标签和操作提示', () => {
  const kinds = [...new Set(ACCOUNT_CHANNELS.map(channel => channel.loginKind))]
  for (const locale of ['zh-CN', 'en-US']) {
    const json = JSON.parse(
      readFileSync(join(process.cwd(), `src/renderer/src/i18n/locales/${locale}.json`), 'utf8'),
    )
    for (const kind of kinds) {
      for (const group of ['loginKind', 'login.hint'] as const) {
        const message = group === 'loginKind'
          ? json.channels?.loginKind?.[kind]
          : json.channels?.login?.hint?.[kind]
        assert.equal(
          typeof message, 'string',
          `${locale} is missing channels.${group}.${kind}`,
        )
        assert.ok(message.length > 0)
      }
    }
  }
})

test('model names are namespaced by the channel id', () => {
  assert.equal(channelModelName('qoder', 'claude-sonnet-4'), 'qoder/claude-sonnet-4')
  assert.equal(isAccountChannelId('qoder'), true)
  assert.equal(isAccountChannelId('openai'), false)
  assert.equal(getChannelDefinition('qoder')?.name, 'Qoder')
  assert.equal(getChannelDefinition('nope'), undefined)
})

test('渠道 tools 硬上限：cline 必须声明 maxTools=128（用户报障 2026-10-30）', () => {
  // cline 上游走 Vercel AI Gateway，超限 400（且以 HTTP 200 的 SSE 流内错误帧浮现，
  // 换家循环拦不到）—— auto 选候选时前置跳过依赖这个声明，漏了就会复发。
  assert.equal(getChannelDefinition('cline')?.maxTools, 128)
})

test('opencode 渠道：不跳浏览器，且没有签到接口', () => {
  // 这两条是它和其余 12 家的结构性差别，界面上的「登录」与「签到」入口都按它们决定。
  assert.equal(getChannelDefinition('opencode')?.loginKind, 'api-key')
  // 用户报障 2026-11-02：这条以前只有标题说了「没有签到接口」，断言里却没有它 ——
  // 于是界面照常渲染「领取积分」，点下去拿到渠道包的 `unsupported provider: opencode`。
  assert.equal(getChannelDefinition('opencode')?.dailyCheckin, false)
})

test('宿主没有把任何在册渠道重新关掉', () => {
  // 渠道包允许宿主用 apply(ctx, { disableOpencode }) 关掉一家。关掉后目录仍然列着它、
  // RPC 却一律回 provider-disabled —— 界面上是一个永远加不进账号的渠道。
  // 2026-11-01 的裁定是「上线第 3 条」，所以这里钉住开关没被加回来。
  const workerSource = readFileSync(
    join(process.cwd(), 'src/main/channelPack/worker.ts'),
    'utf8',
  )
  assert.match(workerSource, /apply\(ctx\)/)
  assert.doesNotMatch(workerSource, /disableOpencode/)
})

test('表单型登录的渠道必须声明加账号方法，且方法名属于它自己', () => {
  for (const channel of ACCOUNT_CHANNELS) {
    const flow = channelAddFlowOf(channel.loginKind)
    assert.equal(
      channel.credentialAdd !== undefined,
      flow === 'credential',
      `${channel.id}: credentialAdd 与 loginKind(${channel.loginKind}) 不一致`,
    )
    if (channel.credentialAdd === undefined) continue
    // 方法名写错渠道（例如把别人的方法抄过来）会直接落到 provider-unsupported 分支，
    // 界面只显示「不支持此渠道」，看不出是抄错了方法名。
    assert.ok(
      channel.credentialAdd.withKey.startsWith(`${channel.id}.`),
      `${channel.id}: withKey 必须属于本渠道`,
    )
    if (channel.credentialAdd.anonymous !== undefined) {
      assert.ok(
        channel.credentialAdd.anonymous.startsWith(`${channel.id}.`),
        `${channel.id}: anonymous 必须属于本渠道`,
      )
    }
  }
})

test('分流只有两种，且只由 loginKind 决定', () => {
  assert.equal(channelAddFlowOf('api-key'), 'credential')
  for (const kind of ['browser', 'device-code', 'sms', 'oauth'] as const) {
    assert.equal(channelAddFlowOf(kind), 'redirect')
  }
})

test('表单型对话框的文案在两种语言里齐备且键集一致', () => {
  const read = (locale: string) => JSON.parse(
    readFileSync(join(process.cwd(), `src/renderer/src/i18n/locales/${locale}.json`), 'utf8'),
  ).channels.credential as Record<string, string>
  const zh = read('zh-CN')
  const en = read('en-US')

  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of Object.keys(zh)) {
    assert.equal(typeof zh[key], 'string', `zh-CN 缺 channels.credential.${key}`)
    assert.ok(zh[key].length > 0)
    assert.ok(en[key].length > 0)
  }
  // 标题必须带渠道名插值：没有它，用户看不出自己在给哪一家加账号。
  assert.ok(zh.title.includes('{{name}}'))
  assert.ok(en.title.includes('{{name}}'))
})

/**
 * 「领取积分」这条能力的三方对齐（用户报障 2026-11-02）。
 *
 * 症状：OpenCode 卡片点「领取积分」→ 红色 toast `unsupported provider: opencode`。
 * 根因是这条能力在三处各说各话，中间没人对齐：
 * - 渠道包 `credits.claimAll`：只有写了分支的渠道会真去领，其余一律落到 case 末尾
 *   的泛化兜底 —— 那句本来是给「provider 根本没注册」准备的，用它回答「这家产品
 *   没有签到能力」，排查者会去找一个不存在的注册项；
 * - 目录 `dailyCheckin`：界面据此决定渲染不渲染按钮；
 * - 界面 `Channels.tsx`：原先对 13 家无条件渲染。
 *
 * 这里刻意**不写死**「哪几家能领」的名单，而是从渠道包源码现读分支：判据变了（渠道
 * 包给某家补上领取、或把某家的领取撤掉）时，目录没跟着改就直接红。
 */
const PACK_SRC_DIR = join(process.cwd(), 'vendor', 'channel-pack', 'src')
const RPC_FILE = join(PACK_SRC_DIR, 'channel-pack-rpc.ts')

/** 渠道包的产品常量名 → provider id（`export const TRAE: TraeProduct = { … id: 'trae'`）。 */
function productIdsByConstant(): Map<string, string> {
  const map = new Map<string, string>()
  for (const file of readdirSync(PACK_SRC_DIR)) {
    if (!file.endsWith('.ts')) continue
    const source = readFileSync(join(PACK_SRC_DIR, file), 'utf8')
    for (const match of source.matchAll(/export const ([A-Z_]+):[^\n]*\{([\s\S]{0,600}?)\n {2}id: '([a-z]+)',/g)) {
      map.set(match[1], match[3])
    }
  }
  return map
}

/** `credits.claimAll` 那一段 case 的源码（到下一个 `case '` 之前）。 */
function claimAllCase(): string {
  const source = readFileSync(RPC_FILE, 'utf8')
  const start = source.indexOf("case 'credits.claimAll'")
  assert.notEqual(start, -1, '渠道包里找不到 credits.claimAll 分支')
  const end = source.indexOf("\n      case '", start + 5)
  assert.notEqual(end, -1, 'credits.claimAll 之后没有别的 case，切片口径失效')
  return source.slice(start, end)
}

/** 该 case 里每个 provider 分支 → 它是「明确拒绝签到」(true) 还是「真去领取」(false)。 */
function claimBranches(): Map<string, boolean> {
  const block = claimAllCase()
  const constants = productIdsByConstant()
  const pattern = /if \((?:req\.provider === ([A-Z_]+)\.id|isQoderFamily\(req\.provider\))\)/g
  const hits: Array<{ start: number; end: number; constant: string | undefined; family: boolean }> = []
  for (const match of block.matchAll(pattern)) {
    const at = match.index ?? 0
    hits.push({
      start: at,
      end: at + match[0].length,
      constant: match[1],
      family: match[1] === undefined,
    })
  }
  // 扫不到分支＝扫描式样失效，下面的断言会全红；先在这里说清是哪种。
  assert.ok(hits.length > 0, 'credits.claimAll 里一个 provider 分支都没扫到')

  const branches = new Map<string, boolean>()
  hits.forEach((hit, index) => {
    // 分支体 = 本条 `if` 之后到下一条 `if`（最后一条到 case 末尾）之间的源码。
    const stop = index + 1 < hits.length ? hits[index + 1].start : block.length
    const refused = block.slice(hit.end, stop).includes('不支持每日签到')
    if (hit.family) {
      // qoder 与 qodercn 共用一条 `isQoderFamily` 分支
      branches.set('qoder', refused)
      branches.set('qodercn', refused)
      return
    }
    const id = constants.get(String(hit.constant))
    assert.ok(id !== undefined, `分支用了扫不到 id 的产品常量 ${String(hit.constant)}`)
    branches.set(id, refused)
  })
  return branches
}

test('目录的 dailyCheckin 与渠道包 credits.claimAll 的分支逐家对齐', () => {
  const branches = claimBranches()
  for (const channel of ACCOUNT_CHANNELS) {
    const refused = branches.get(channel.id)
    // ① 在册 13 家都要有自己的分支。没有分支＝走到 case 末尾的泛化兜底，
    //    界面拿到的就是本次报障的那句 `unsupported provider: <id>`。
    assert.ok(
      refused !== undefined,
      `${channel.id}: 渠道包 credits.claimAll 没有它的分支，会落到泛化文案 unsupported provider`,
    )
    // ② 目录说能领 ⇒ 渠道包必须真去领；目录说不能领 ⇒ 渠道包必须给可读拒绝。
    assert.equal(
      channel.dailyCheckin,
      refused === false,
      `${channel.id}: 目录 dailyCheckin=${String(channel.dailyCheckin)}，`
        + `而渠道包分支${refused ? '明确拒绝签到' : '真的执行领取'}`,
    )
  }
})
