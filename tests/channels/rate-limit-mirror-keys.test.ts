/**
 * 渠道限流镜像的**键形状**：同一份读数有两个写入方、一个读取方。
 *
 * 2026-11-17 现网实测出的缺陷：路由页 `blocked` 对渠道限流恒为 0，而账号渠道页
 * 正在报「限流 · {{model}} → {{time}}」。两边读的是同一张 `rateLimitMarks`，
 * 差在键上：
 *
 * - 预热（`prewarmRateLimits`）传目录里的**裸** id（`hy4flash-free`）；
 * - 选路（`autoRouter.collectCandidates`）传映射后的 `actualModelId`
 *   （`buddy/hy4flash-free`）。
 *
 * 两条路各写各的键，查询只命中其中一类 —— 于是路由页看不到渠道限流，
 * 用户读到一个自相矛盾的两处读数。本测试钉住「两种形状写进去，一个查询都看得见」。
 *
 * 证明层次：真 `accountChannelManager` 的镜像读写（同一张私有表），不经 worker。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const harness = await bootstrapStore({ initialData: { providers: [], accounts: [] } })
const { accountChannelManager } = await loadModule('main/providers/accountChannels/manager.ts')

const NOW = Date.now()
const UNTIL = NOW + 3600_000

type MirrorInternals = {
  noteRateLimits: (
    id: string,
    table: Record<string, { limited: true; resetAtMs: number }>,
    models: string[],
  ) => void
}
const internals = accountChannelManager as unknown as MirrorInternals

after(() => harness.dispose())

test('预热的裸名读数，选路用带前缀的 actualModelId 也查得到', () => {
  // 预热路径的真实形状：目录 id 是裸名，worker 回的表也按裸名键。
  internals.noteRateLimits('buddy', { 'hy4flash-free': { limited: true, resetAtMs: UNTIL } }, ['hy4flash-free'])

  // 选路路径的真实形状：`ModelMapping` 的 actualModelId 带 `<channelId>/` 前缀。
  assert.equal(
    accountChannelManager.modelRateLimitResetAt('buddy', 'buddy/hy4flash-free', NOW),
    UNTIL,
    '带前缀的查询必须命中裸名写入的读数',
  )
  // 两种形状都要能查：预热侧也可能直接按裸名查。
  assert.equal(accountChannelManager.modelRateLimitResetAt('buddy', 'hy4flash-free', NOW), UNTIL)
})

test('带前缀写入的读数，裸名查询也命中（反向形状同样成立）', () => {
  // 请求路径预检（`chat.ts`）传的是 `candidate.actualModel`（带前缀），
  // worker 按请求的 id 回表 —— 于是镜像里出现带前缀的键。
  internals.noteRateLimits('buddy', { 'buddy/hy4std': { limited: true, resetAtMs: UNTIL } }, ['buddy/hy4std'])

  assert.equal(
    accountChannelManager.modelRateLimitResetAt('buddy', 'hy4std', NOW),
    UNTIL,
    '裸名查询必须命中带前缀写入的读数',
  )
  // 镜像快照对外是 `(渠道) -> (裸模型 id -> 解禁时刻)`：账号页与模型页徽章按这个键读，
  // 两种写入形状都要归一到同一把键上，否则同一条限流会被画成两条。
  const snap = accountChannelManager.rateLimitMarksSnapshot(NOW)
  assert.equal(snap.buddy?.['hy4std'], UNTIL)
  assert.equal(snap.buddy?.['hy4flash-free'], UNTIL)
  assert.equal(Object.keys(snap.buddy ?? {}).filter(key => key.startsWith('buddy/')).length, 0,
    '快照里不许留带渠道前缀的键')
})

test('另一家的前缀不被当成自家前缀剥掉', () => {
  internals.noteRateLimits('buddy', { 'other/x': { limited: true, resetAtMs: UNTIL } }, ['other/x'])
  assert.equal(accountChannelManager.modelRateLimitResetAt('buddy', 'other/x', NOW), UNTIL)
  assert.equal(accountChannelManager.modelRateLimitResetAt('buddy', 'x', NOW), undefined,
    '别家的前缀不是本渠道前缀，不归一')
})
