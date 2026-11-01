/**
 * 「领取积分」按钮只在该渠道有签到能力时渲染（用户报障 2026-11-02）。
 *
 * 症状：OpenCode 卡片点「领取积分」→ 红色 toast `unsupported provider: opencode`。
 * 渠道包对 OpenCode 没有签到分支，而界面对 13 家无条件渲染同一个按钮 ——
 * 结构性缺口在界面上伪装成「这个渠道也能领，只是这次失败了」。
 *
 * 这里走静态源码门（与 `provider-auth-label` 等同型）：判据是**整行字面量**，
 * 因为「页面把目录字段用进渲染条件」这一环一旦被删，其余各环（类型、目录、
 * 主进程下发）照样全绿。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const page = () => readFileSync(join(root, 'src/renderer/src/pages/Channels.tsx'), 'utf8')

const manager = () =>
  readFileSync(join(root, 'src/main/providers/accountChannels/manager.ts'), 'utf8')

const shared = () => readFileSync(join(root, 'src/shared/channels.ts'), 'utf8')

test('渠道卡片：领取按钮包在 dailyCheckin 条件里，且条件只包这一个按钮', () => {
  const source = page()
  // 守卫与按钮之间不许隔着别的控件：隔着的就是「条件管到了别人身上」。
  assert.match(
    source,
    /\{channel\.dailyCheckin && \(\s*<Button[^]*?claimCredits\(channel\)[^]*?\)\}/,
    '领取按钮必须由 channel.dailyCheckin 条件渲染',
  )
  assert.equal(
    source.match(/\{channel\.dailyCheckin && \(/g)?.length,
    1,
    'dailyCheckin 只该管这一个入口，出现多处说明条件被复制了',
  )
  // 领取这条 RPC 只可能由这个按钮发出：否则存在第二条不判能力的调用路径。
  assert.equal(
    source.match(/credits\.claimAll/g)?.length,
    1,
    'credits.claimAll 只应有一处调用点',
  )
})

test('主进程把目录的 dailyCheckin 原样带进 ChannelView', () => {
  assert.match(
    manager(),
    /dailyCheckin: channel\.dailyCheckin,/,
    '界面读的是 ChannelView，主进程漏这一行时类型照样编译（两边都叫 dailyCheckin）',
  )
})

test('dailyCheckin 在目录与视图上都是必填，不是可选位', () => {
  const source = shared()
  // 可选字段＝新渠道可以不表态，默认值会把本次这个缺陷重演一遍。
  assert.equal(
    source.match(/^\s*dailyCheckin: boolean$/gm)?.length,
    2,
    'ChannelDefinition 与 ChannelView 各一条必填声明',
  )
  assert.doesNotMatch(source, /dailyCheckin\?:/, '不得声明成可选位')
})
