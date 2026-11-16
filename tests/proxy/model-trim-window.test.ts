/**
 * 裁剪预算的证据来源（`modelTrimWindow.ts`）：**只认这个模型自己的标注**。
 *
 * 它回答的是「这一跳真正要派的那个模型，自己声明了多大窗口」。上一层
 * `context-trim-budget.test.ts` 已经钉住「模型标注 > 档位 > 渠道/全局」的取值顺序，
 * 这里钉住的是**谁算证据**：手工标注、供应商同步记录、聚合官方旁表、实测 probe 四层
 * 是这家上游对这个模型的声明；静态表与家族规则是**转述的类比**（`glm-5.3` → 128000
 * 那类），绝不能进裁剪预算 —— 那是同一个缺陷换个来源：一个真跑 1M 的模型会被静态表
 * 按 128K 裁掉，一个真跑 32K 的模型会被按 128K 放行到上游撞 context 400。
 *
 * 判据与对外广告完全同一道闸（`advertisedContextTokens`）：客户端看到的窗口与网关
 * 自己裁剪用的窗口若各有一套可信度标准，就一定会出现「客户端按 X 发、网关按 Y 裁」。
 *
 * 层次：真 `storeManager`（harness 的临时目录）+ 真解析链，无 electron、无网络。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const harness = await bootstrapStore({
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: { proxyPort: 0, proxyHost: '127.0.0.1' },
  },
})
const sm = harness.storeManager
const { declaredContextWindowOf } = await loadModule('main/proxy/modelTrimWindow.ts')

after(() => {
  harness.dispose()
})

function providerFixture(id: string, displayName: string, caps?: number) {
  return {
    id,
    name: `Trim Window Provider ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    supportedModels: [displayName],
    modelMappings: { [displayName]: `${id}-upstream` },
    ...(caps === undefined ? {} : { modelCapabilities: { [displayName]: { contextTokens: caps } } }),
  }
}

// `glm` 家 `glm-5.3` 在静态表里是 128000 —— 专门用来证明那一层**不进**裁剪预算
sm.addProvider(providerFixture('glm', 'glm-5.3') as never)
// 供应商同步记录就是「这家上游自己说的」
sm.addProvider(providerFixture('volc', 'Volc-1M', 1_000_000) as never)
// 完全没有标注
sm.addProvider(providerFixture('mute', 'Mute-X') as never)
for (const id of ['glm', 'volc', 'mute']) {
  sm.addAccount({
    id: `${id}-acct`,
    providerId: id,
    name: `${id} account`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  } as never)
}

const providerOf = (id: string) => sm.getProviderById(id)
const windowOf = (id: string, actualModelId: string) =>
  declaredContextWindowOf(providerOf(id) as never, actualModelId)

test('供应商同步记录直接作为预算 —— 这就是火山 Agent Plan 那一格的修法', () => {
  assert.equal(windowOf('volc', 'volc-upstream'), 1_000_000)
})

test('静态表与家族规则不算这个模型的声明：一律回到「不知道」', () => {
  // 静态表里 glm-5.3 写着 128000，但那是按名字推的类比，不是这家上游此刻的声明。
  // 采信它 = 一个真跑 1M 的模型被裁到 128K，正是 2026-11-16 那个缺陷的另一种来源。
  assert.equal(windowOf('glm', 'glm-upstream'), undefined)
})

test('完全没有证据 → undefined，由配置档位兜底（不猜一个数）', () => {
  assert.equal(windowOf('mute', 'mute-upstream'), undefined)
})

test('目录里没有这一行、映射表也反查不到 → undefined，不是瞎猜', () => {
  // `actualModelId` 对不上任何目录行：真正服务的模型未知，未知就交给档位。
  assert.equal(windowOf('volc', 'not-in-catalogue'), undefined)
})

test('手工标注覆盖同步记录：用户说了算，且不被模型同步清掉', () => {
  sm.setUserModelMark('volc', 'Volc-1M', { contextTokens: 262_144 })
  assert.equal(windowOf('volc', 'volc-upstream'), 262_144, '手工标注优先')

  sm.setUserModelMark('volc', 'Volc-1M', null)
  assert.equal(windowOf('volc', 'volc-upstream'), 1_000_000, '撤掉标注后回到同步记录')
})

test('手工标注能给没有任何同步记录的模型一个窗口', () => {
  assert.equal(windowOf('mute', 'mute-upstream'), undefined)
  sm.setUserModelMark('mute', 'Mute-X', { contextTokens: 131_072 })
  assert.equal(windowOf('mute', 'mute-upstream'), 131_072)
  sm.setUserModelMark('mute', 'Mute-X', null)
})

test('映射表反查：目录行缺失时按 modelMappings 的键找回展示名', () => {
  // 手写映射、目录还没同步到这一行的情形：展示名仍在映射表里，标注照常命中。
  sm.addProvider({
    ...providerFixture('manual', 'Manual-Name'),
    supportedModels: [],
    modelMappings: { 'Manual-Name': 'manual-upstream' },
    modelCapabilities: { 'Manual-Name': { contextTokens: 200_000 } },
  } as never)
  sm.addAccount({
    id: 'manual-acct',
    providerId: 'manual',
    name: 'manual account',
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  } as never)
  assert.equal(windowOf('manual', 'manual-upstream'), 200_000)
})