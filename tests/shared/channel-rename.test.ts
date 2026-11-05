/**
 * 渠道改名的显示名迁移（2026-11-05，CodeBuddy/WorkBuddy 命名统一）。
 *
 * 渠道展示名是模型对外名的一部分（`<渠道名> / <上游展示名>`），而用户的
 * 「关掉某个模型」标记与路由的 pin/include/exclude 都按这个显示名存。改名
 * 不迁移会静默丢配置，所以判据必须与迁移表一起被钉住：
 *
 * 1. 纯函数只改带旧前缀的名字，其余原样、不修改入参；
 * 2. 迁移表里的 `from` 必须**不等于**渠道当前名（否则迁移永远空转），且
 *    每条都指向一个真实存在的渠道 id；
 * 3. 目录里两条渠道已经是新名，且不再出现 `(腾讯)` 这种会混淆的后缀。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

async function loadShared() {
  return await import(pathToFileURL(join(ROOT, 'src', 'shared', 'channelRename.ts')).href)
}

async function loadChannels() {
  const module = await import(
    pathToFileURL(join(ROOT, 'src', 'main', 'providers', 'accountChannels', 'catalogue.ts')).href
  )
  return module.ACCOUNT_CHANNELS
}

test('只改带旧前缀的名字，其他原样返回 undefined', async () => {
  const { renamedDisplayName } = await loadShared()
  assert.equal(renamedDisplayName('CodeBuddy (腾讯) / Hy3', 'CodeBuddy (腾讯)', 'WorkBuddy (国内版)'), 'WorkBuddy (国内版) / Hy3')
  assert.equal(renamedDisplayName('WorkBuddy (腾讯) / gpt-5', 'WorkBuddy (腾讯)', 'WorkBuddy (国际版)'), 'WorkBuddy (国际版) / gpt-5')
  // 前缀必须带分隔符，否则 "CodeBuddy (腾讯) 2 / x" 这类名字会被误改。
  assert.equal(renamedDisplayName('CodeBuddy (腾讯)2 / Hy3', 'CodeBuddy (腾讯)', 'X'), undefined)
  assert.equal(renamedDisplayName('Other / Hy3', 'CodeBuddy (腾讯)', 'X'), undefined)
  // from === to 时不产生迁移（幂等）。
  assert.equal(renamedDisplayName('A / m', 'A', 'A'), undefined)
})

test('引用重命名只动命中的项，未命中返回 undefined 以免无谓落盘', async () => {
  const { renameDisplayNameRefs } = await loadShared()
  const refs = [
    { providerId: 'buddy', displayName: 'CodeBuddy (腾讯) / Hy3' },
    { providerId: 'lobsterai', displayName: 'LobsterAI (有道) / kimi' },
  ]
  const renamed = renameDisplayNameRefs(refs, 'CodeBuddy (腾讯)', 'WorkBuddy (国内版)')
  assert.deepEqual(renamed, [
    { providerId: 'buddy', displayName: 'WorkBuddy (国内版) / Hy3' },
    { providerId: 'lobsterai', displayName: 'LobsterAI (有道) / kimi' },
  ])
  // 入参不被修改。
  assert.equal(refs[0].displayName, 'CodeBuddy (腾讯) / Hy3')
  // 没有命中 / 空数组 → undefined。
  assert.equal(renameDisplayNameRefs([refs[1]], 'CodeBuddy (腾讯)', 'X'), undefined)
  assert.equal(renameDisplayNameRefs([], 'CodeBuddy (腾讯)', 'X'), undefined)
  assert.equal(renameDisplayNameRefs(undefined, 'CodeBuddy (腾讯)', 'X'), undefined)
})

test('迁移表与目录一致：旧名不是当前名，id 真实存在', async () => {
  const { CHANNEL_DISPLAY_RENAMES } = await loadShared()
  const channels = await loadChannels()
  const byId = new Map(channels.map(channel => [channel.id, channel.name]))
  for (const rename of CHANNEL_DISPLAY_RENAMES) {
    assert.ok(byId.has(rename.id), `迁移表引用了不存在的渠道: ${rename.id}`)
    assert.notEqual(rename.from, byId.get(rename.id), `${rename.id} 的旧名与当前名相同，迁移会永远空转`)
  }
})

test('目录里两条渠道已是新名，且不再出现「(腾讯)」后缀', async () => {
  const channels = await loadChannels()
  const byId = new Map(channels.map(channel => [channel.id, channel.name]))
  assert.equal(byId.get('buddy'), 'WorkBuddy (国内版)')
  assert.equal(byId.get('workbuddy'), 'WorkBuddy (国际版)')
  for (const channel of channels) {
    assert.ok(!channel.name.includes('(腾讯)'), `${channel.id} 仍带会混淆的后缀: ${channel.name}`)
  }
})
