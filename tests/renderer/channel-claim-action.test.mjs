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

/**
 * 「领取任务积分」（成长中心）与上面同构的四道门。
 *
 * 它与 `dailyCheckin` 是**两套独立能力**（签到 = 每天一次；任务 = 每项一次性且要
 * 服务端先认定做完），所以不共用一个开关：共用会让「这家只能签到」的渠道
 * 长出一个必然失败的第二个按钮，正如 2026-11-02 那次报障的形状。
 */
test('渠道卡片：任务按钮包在 growthTasks 条件里，且条件只包任务这一族入口', () => {
  const source = page()
  assert.match(
    source,
    /\{channel\.growthTasks && \(\s*<Button[^]*?claimTasks\(channel\)[^]*?\)\}/,
    '领取任务按钮必须由 channel.growthTasks 条件渲染',
  )
  // 2026-11-09 加了接单与清单两个入口，2026-11-12 又加了一键完成，所以这里锁
  // **数量与归属**而不是只锁一处：判据的本意是「能力位必须门住每一个入口」，
  // 不是「只能有一个入口」。出现第 5 处＝有人又挂了一个没被能力位管住的
  // 成长任务入口，要显式改这条。
  assert.equal(
    source.match(/\{channel\.growthTasks && \(/g)?.length,
    4,
    'growthTasks 应当恰好门住四个入口：领取任务、一键完成、接取任务、任务清单',
  )
  // 锁的是**调用点**（`rpc('…'`）而不是字符串出现次数：方法名也会出现在注释里，
  // 按字符串数会把「唯一入口」这条判据变成随机红。
  assert.equal(
    source.match(/rpc\('onboarding\.claimAll'/g)?.length,
    1,
    'onboarding.claimAll 只应有一处调用点',
  )
})

/**
 * 「一键完成」是接单 + 领取的组合入口（2026-11-12，用户点名加在领取之后）。
 *
 * 它**不新增 RPC**：只按顺序复用上面两个动作，所以能力位与「每个 RPC 一个调用点」
 * 两条判据都继续成立。这条门锁住「复用而不是另起一条」这件事 —— 若有人给它单写
 * 一遍 `rpc('onboarding.…')`，上面两条计数会红，这条会指出根因。
 */
test('一键完成入口：由 growthTasks 门住，且只复用接单/领取两个动作', () => {
  const source = page()
  // 从调用点往回截一段，断言它和守卫之间只有这个 <Button>：跨按钮的宽松匹配
  // 会让「按钮被复制到条件外面」照样绿。
  const callIndex = source.indexOf('finishTasks(channel)')
  assert.notEqual(callIndex, -1, '界面缺 finishTasks 调用点')
  assert.match(
    source.slice(Math.max(0, callIndex - 400), callIndex),
    /\{channel\.growthTasks && \(\s*<Button[^]*$/,
    '一键完成按钮必须由 channel.growthTasks 条件渲染',
  )
  assert.equal(
    source.match(/t\('channels\.tasks\.finish'\)/g)?.length,
    1,
    '一键完成只用一处文案（finish），不得与领取按钮共用 key',
  )
  assert.match(
    source,
    /const finishTasks = async[^]*?acceptTasks\(channel, false, false\)[^]*?claimTasks\(channel, false, false\)/,
    '一键完成必须先接单后领取，且复用既有动作函数而非直发 RPC',
  )
})

test('主进程把目录的 growthTasks 原样带进 ChannelView', () => {
  assert.match(
    manager(),
    /growthTasks: channel\.growthTasks,/,
    '漏这一行时类型照样编译（两边都叫 growthTasks），界面却永远看不到按钮',
  )
})

test('growthTasks 在目录与视图上都是必填，不是可选位', () => {
  const source = shared()
  assert.equal(
    source.match(/^\s*growthTasks: boolean$/gm)?.length,
    2,
    'ChannelDefinition 与 ChannelView 各一条必填声明',
  )
  assert.doesNotMatch(source, /growthTasks\?:/, '不得声明成可选位')
})

test('两个能力各自独立成句，界面文案不得共用一条 key', () => {
  const source = page()
  // 共用一个 i18n key 会让两个按钮显示同一句话 —— 用户分不清点的是哪套请求。
  assert.equal(
    source.match(/t\('channels\.claimTasks'\)/g)?.length,
    1,
    '任务按钮用 claimTasks 这条文案',
  )
  assert.equal(
    source.match(/t\('channels\.claim'\)/g)?.length,
    1,
    '签到按钮仍用 claim 这条文案',
  )
})

/**
 * 接单按钮与任务清单的静态门（成长任务，2026-11-09）。
 *
 * 接单与领取是**两种不同的动作**：接单不产生积分，只让服务端开始计进度。
 * 合成一个按钮会让结果文案不得不同时说两件事，而用户最需要分清「这次到账了吗」。
 */
test('渠道卡片：接单按钮包在 growthTasks 条件里，且 acceptAll 只有一处调用点', () => {
  const source = page()
  assert.match(
    source,
    /\{channel\.growthTasks && \(\s*<Button[^]*?acceptTasks\(channel\)[^]*?\)\}/,
    '接单按钮必须由 channel.growthTasks 条件渲染',
  )
  assert.equal(
    source.match(/rpc\('onboarding\.acceptAll'/g)?.length,
    1,
    'onboarding.acceptAll 只应有一处调用点：存在第二处就有绕过能力位的接单路径',
  )
  assert.equal(
    source.match(/rpc\('onboarding\.status'/g)?.length,
    1,
    '任务清单是唯一的 onboarding.status 调用点',
  )
})

test('服务端五种状态在两种语言里都有标签（动态 key 不能落空）', () => {
  const zh = JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n/locales/zh-CN.json'), 'utf8'))
  const en = JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n/locales/en-US.json'), 'utf8'))
  // 界面用 `t(\`channels.tasks.status.${status}\`)` 拼动态键：服务端下发一个没登记的
  // 状态时，i18next 会把**键名原样**显示出来（看着像 bug，其实是缺标签）。
  const statuses = ['not_accepted', 'accepted', 'in_progress', 'completed', 'claimed']
  for (const [name, locale] of [['zh-CN', zh], ['en-US', en]]) {
    const table = locale?.channels?.tasks?.status
    assert.ok(table !== undefined, `${name} 缺 channels.tasks.status 表`)
    for (const status of statuses) {
      assert.equal(
        typeof table?.[status] === 'string' && table[status].length > 0,
        true,
        `${name} 缺 channels.tasks.status.${status}`,
      )
    }
  }
})

test('渲染层的任务字段声明与渠道包 RpcOnboardingTaskItem 逐字同名', () => {
  const source = page()
  const pack = readFileSync(join(root, 'vendor/channel-pack/src/types.ts'), 'utf8')
  const packBlock = pack.slice(pack.indexOf('export interface RpcOnboardingTaskItem'))
  // 渲染层看不见 vendor 源码（`virtual:channel-pack` 是构建期虚模块），两边靠约定对齐：
  // 这里锁住字段集合，任何一侧改名都会让另一侧红。
  const fields = ['key', 'title', 'description', 'status', 'claimable', 'progress',
    'rewardCredit', 'rewardEnergy', 'rewardBuddy', 'locked']
  for (const field of fields) {
    assert.match(source, new RegExp(`^\\s{2}${field}\\??:`, 'm'), `渲染层缺字段 ${field}`)
    assert.ok(packBlock.includes(`${field}?:`) || packBlock.includes(`${field}:`), `渠道包缺字段 ${field}`)
  }
})
