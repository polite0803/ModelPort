/**
 * 账号渠道「上游客户端身份风险」标注的回归测试（用户要求，2026-11-05）。
 *
 * 背景：这些渠道以逆向出的官方客户端身份直连厂商接口。用户要的不是把身份
 * 对齐到官方当前版本（那件事本项目不做），而是**让使用者看得见自己在赌什么**：
 * 卡片上标出身份风险等级，悬停给出实际发出的身份串。
 *
 * 本测试钉三件事：
 *
 * 1. 13 条渠道**全部**有标注（新增渠道漏标会红）；
 * 2. 风险等级与 2026-11-05 的审计结论一致 —— 被上游实际停过号、或身份是
 *    冻结的官方客户端拷贝的，必须是 high；不得被后续改动悄悄降级；
 * 3. 呈现层与文案齐备：组件读的是 `channel.upstreamIdentity`，两个语言包都有
 *    三档标签与带 `{{declared}}` 插值的提示文案。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

async function loadChannels() {
  const module = await import(
    pathToFileURL(join(ROOT, 'src', 'main', 'providers', 'accountChannels', 'catalogue.ts')).href
  )
  return module.ACCOUNT_CHANNELS
}

const RISK_LEVELS = new Set(['high', 'medium', 'low'])

test('13 条账号渠道全部带身份标注，且字段有效', async () => {
  const ACCOUNT_CHANNELS = await loadChannels()
  assert.equal(ACCOUNT_CHANNELS.length, 13)
  for (const channel of ACCOUNT_CHANNELS) {
    const identity = channel.upstreamIdentity
    assert.ok(identity !== undefined, `${channel.id} 缺少 upstreamIdentity`)
    assert.equal(typeof identity.declared, 'string')
    assert.ok(identity.declared.length > 0, `${channel.id} 的 declared 不能为空`)
    assert.ok(RISK_LEVELS.has(identity.risk), `${channel.id} 的 risk 非法: ${identity.risk}`)
  }
})

test('风险等级与审计结论文致：被实际处置 / 冻结官方身份的是 high', async () => {
  const ACCOUNT_CHANNELS = await loadChannels()
  const risk = Object.fromEntries(ACCOUNT_CHANNELS.map(c => [c.id, c.upstreamIdentity.risk]))
  // 龙虾已被上游停服（2026-11-04）；其余是被冻结或内置的官方客户端身份。
  for (const id of ['lobsterai', 'qoder', 'qodercn', 'trae', 'zcode', 'gemini', 'buddy', 'workbuddy']) {
    assert.equal(risk[id], 'high', `${id} 必须是 high（不得被悄悄降级）`)
  }
  // 官方 SDK 形状 / 完全不发客户端身份的，才是 low。
  for (const id of ['cline', 'minimax']) {
    assert.equal(risk[id], 'low', `${id} 应为 low`)
  }
  for (const id of ['loomy', 'raccoon', 'opencode']) {
    assert.equal(risk[id], 'medium', `${id} 应为 medium`)
  }
})

test('声明必须与实际发出的身份一致（2026-11-05 审计）', async () => {
  const ACCOUNT_CHANNELS = await loadChannels()
  const byId = Object.fromEntries(ACCOUNT_CHANNELS.map(c => [c.id, c.upstreamIdentity.declared]))
  // WorkBuddy 实际发 WorkBuddy/...，不是 CodeBuddyIDE/...；声明不得再写错。
  assert.doesNotMatch(byId.workbuddy, /CodeBuddyIDE/)
  assert.match(byId.workbuddy, /WorkBuddy/)
  // 两条 WorkBuddy 渠道（国内版 buddy / 国际版 workbuddy）都是 WorkBuddy 品牌；
  // CodeBuddy（腾讯）2026-11-05 已更名为 WorkBuddy（国内版），不得再发旧品牌。
  for (const id of ['buddy', 'workbuddy'] as const) {
    assert.doesNotMatch(byId[id], /CodeBuddyIDE/, `${id} 仍声明旧品牌 CodeBuddyIDE`)
    assert.match(byId[id], /WorkBuddy/, `${id} 缺少 WorkBuddy 品牌字样`)
  }
  // Loomy 实际不发 UA，也没有官方签名；声明不得再声称有。
  assert.doesNotMatch(byId.loomy, /^ua:/i)
  assert.match(byId.loomy, /不发/)
  assert.match(byId.loomy, /没有官方签名/)
  // ZCode 实际 UA 是动态版本（ZCODE_APP_VERSION_FALLBACK / 官方源跟随），
  // 声明不再带具体版本号；旧值 3.14.4（transport 残留）仍不得出现。
  assert.match(byId.zcode, /动态版本/)
  assert.doesNotMatch(byId.zcode, /3\.14\.4/)
  // Trae 已改为现役客户端的动态字段，不再写死 0.1.52 / 20260811。
  assert.doesNotMatch(byId.trae, /0\.1\.52|20260811/)
  assert.match(byId.trae, /appVersion/)
})

test('呈现层：卡片渲染风险徽标，提示文案带 declared 插值', () => {
  const page = readFileSync(join(ROOT, 'src', 'renderer', 'src', 'pages', 'Channels.tsx'), 'utf8')
  assert.match(page, /channel\.upstreamIdentity !== undefined/, '卡片必须按标注渲染')
  assert.match(page, /channels\.identityRiskTooltip/, '徽标必须给出身份串提示')
  assert.match(page, /channels\.identityRisk\.\$\{channel\.upstreamIdentity\.risk\}/, '徽标文案必须按风险档取值')
})

test('呈现层：双色版本状态徽标（2026-11-05 G 系收口后追加）', () => {
  const page = readFileSync(join(ROOT, 'src', 'renderer', 'src', 'pages', 'Channels.tsx'), 'utf8')
  // 快照读不到（worker 崩 / 渠道不在快照）时不得渲染状态徽标——避免误导。
  assert.match(page, /\{live !== undefined && \(\(\) => \{/, '版本状态徽标必须有 live 守卫')
  // 双色判定：fallback → 黄（stale），其余（official/local-install/env）→ 绿（fresh）。
  assert.match(page, /live\.source === 'fallback'/, 'stale 判定必须钉在 fallback 上')
  assert.match(page, /identityLive\.badge\.stale/, '必须有 stale 文案取值')
  assert.match(page, /identityLive\.badge\.fresh/, '必须有 fresh 文案取值')
  assert.match(page, /bg-emerald-600/, 'fresh 必须是绿点')
  assert.match(page, /bg-amber-500/, 'stale 必须是黄点')
  // 徽标必须展示当前生效版本号，让用户不用展开 tooltip 就能看到 v 值。
  assert.match(page, /v\{live\.version\}/, '徽标必须内联当前生效版本号')
})

test('文案：两个语言包都有三档标签与带 {{declared}} 的提示', () => {
  for (const name of ['zh-CN', 'en-US']) {
    const json = JSON.parse(
      readFileSync(join(ROOT, 'src', 'renderer', 'src', 'i18n', 'locales', `${name}.json`), 'utf8'),
    )
    const channels = json.channels
    for (const level of ['high', 'medium', 'low']) {
      assert.equal(typeof channels.identityRisk?.[level], 'string', `${name} 缺少 identityRisk.${level}`)
      assert.ok(channels.identityRisk[level].length > 0)
    }
    assert.match(channels.identityRiskTooltip ?? '', /\{\{declared\}\}/, `${name} 的提示必须插值 declared`)
    // 双色徽标的四个键：短文案两态 + tooltip 与其内嵌的状态说明。
    const live = channels.identityLive
    assert.equal(typeof live?.badge?.fresh, 'string', `${name} 缺少 identityLive.badge.fresh`)
    assert.equal(typeof live?.badge?.stale, 'string', `${name} 缺少 identityLive.badge.stale`)
    assert.match(live.badgeTooltip ?? '', /\{\{version\}\}/, `${name} 徽标提示必须插值 version`)
    assert.match(live.badgeTooltip ?? '', /\{\{source\}\}/, `${name} 徽标提示必须插值 source`)
    assert.match(live.badgeTooltip ?? '', /\{\{state\}\}/, `${name} 徽标提示必须插值 state`)
    assert.equal(typeof live?.badgeState?.fresh, 'string', `${name} 缺少 identityLive.badgeState.fresh`)
    assert.equal(typeof live?.badgeState?.stale, 'string', `${name} 缺少 identityLive.badgeState.stale`)
  }
})
