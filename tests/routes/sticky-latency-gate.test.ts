/**
 * 第 2 条（2026-11-12）：「延迟从罚分升为门」在**硬粘性提前**这一处的形状。
 *
 * 被证明的缺陷：硬粘性无条件把上一轮成功的模型提到队首，而首字延迟在打分里只是
 * 封顶 0.2 的罚分（`autoRouting.ts::scoreCandidate`）。现网实测（任务 ② 的读数）
 * 路由 17 行首字 p50 15.3s / 直连 281 行 p50 1.9s，其中一个首字 9.7–35.1s 的
 * 模型被硬粘性锁了 30 分钟 —— 每一轮都先把整个等待付完才轮到别人。
 *
 * 证明层次：真 `storeManager`（四家供应商/账号/在服名单）+ 真 `autoRouter.select()`
 * + 真 `accountRuntime` 的 EWMA 读数。断言读的是决策返回值（`candidates[0]`、
 * `reason`、`latencyGateMs`、`stickyGated`），不是源码文本。
 *
 * 为什么四家：门槛是池内 p75，读数不足 4 个时不判（两三个读数算出来的分位数只是
 * 噪声）。三条用例互为对照：无读数提前、慢于 p75 不提前、快于 p75 照旧提前 ——
 * 门没接线时，第二条会红。
 */
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from './harness.mjs'
import type { ChatCompletionRequest } from '../../src/main/proxy/types.ts'
import type { ModelRoute } from '../../src/shared/types.ts'

const harness = await bootstrapStore({
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: {
      proxyPort: 8080,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      routes: {},
      autoRouting: {
        enabled: true,
        maxAttempts: 2,
        stickyMinutes: 30,
        prefer: 'fast',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager

const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')
const { accountRuntime } = await loadModule('main/proxy/accountRuntime.ts')

function providerFixture(id: string, displayName: string, capabilities: Record<string, unknown>) {
  return {
    id,
    name: `Latency Provider ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [displayName],
    modelMappings: { [displayName]: `${id}-upstream` },
    modelCapabilities: { [displayName]: capabilities },
  }
}

// 四家、四个模型，能力档位相同；只有 Alpha-Flash 免费（自然分领先 0.1，默认 prefer
// 下小于粘性加分 0.12 —— 这正是「谁被提前」在结果里可见的原因）。
sm.addProvider(providerFixture('pa', 'Alpha-Flash', { tier: 'fast', free: true }) as never)
sm.addProvider(providerFixture('pb', 'Beta-Lite', { tier: 'fast' }) as never)
sm.addProvider(providerFixture('pc', 'Gamma-Mini', { tier: 'fast' }) as never)
sm.addProvider(providerFixture('pd', 'Delta-Spark', { tier: 'fast' }) as never)
for (const id of ['pa', 'pb', 'pc', 'pd']) {
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

const REQUEST = {
  model: 'auto',
  messages: [{ role: 'user', content: 'one line question' }],
} as ChatCompletionRequest

const route = (() => {
  const created = sm.createRoute({
    name: 'latency-lane',
    enabled: true,
    strategy: 'round-robin',
    prefer: 'fast',
    maxAttempts: 3,
    stickyMinutes: 30,
    // 门槛是「池内 p75」，要池里同时有四个模型的读数才成立；架构 A 的缺省范围
    // `single` 会把池裁成一个模型（那时门槛退化成该模型自己的读数），所以显式要 `pool`。
    modelScope: 'pool',
  })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  return created.route as ModelRoute
})()

const select = () => autoRouter.select(REQUEST, 'round-robin', undefined, route)

/** 把上一轮成功的锚点钉到某个模型上（真写入通道：`rememberRoute`）。 */
function pinSticky(displayName: string): void {
  const fresh = select()
  const target = fresh.candidates.find(candidate => candidate.displayName === displayName)
  assert.ok(target, `锚点候选 ${displayName} 应当在池里`)
  autoRouter.rememberRoute(fresh.conversationKey, target, route)
}

/** 写 (账号, 模型) 的首字 EWMA —— 与生产同一个 `recordAttemptOutcome`。 */
function seedLatency(byProvider: Record<string, number>): void {
  const now = Date.now()
  for (const [id, firstTokenMs] of Object.entries(byProvider)) {
    accountRuntime.recordAttemptOutcome(
      `${id}-acct`,
      `${id}-upstream`,
      { success: true, firstTokenMs, totalMs: firstTokenMs * 2 },
      now,
    )
  }
}

beforeEach(() => {
  // 粘性、EWMA、目录冷却都是进程内运行时态：每条用例从干净的一份开始，
  // 结果只由本用例写入的读数决定。
  autoRouter.reset()
})

after(() => {
  autoRouter.reset()
  harness.dispose()
})

test('无首字读数时不判：硬粘性照旧把上一轮的模型提到队首', () => {
  pinSticky('Delta-Spark')

  const decision = select()

  assert.equal(decision.candidates[0].displayName, 'Delta-Spark', '缺数据不是罪：没有读数就不拿延迟挡它')
  assert.equal(decision.reason, 'sticky')
  assert.equal(decision.latencyGateMs, undefined)
  assert.equal(decision.stickyGated, undefined)
})

test('粘住的模型慢于池内 p75：不提前，退回打分首位（同一池里还有流式读数）', () => {
  // Alpha 1.0s / Beta 1.2s / Delta 1.5s / Gamma 30s → 排序后 p75 = 1.5s（第 3 个）。
  // 现网量级：直连 p50 1.9s，被锁住的那些首字 9.7–35.1s —— 30s 就是那一批的形状。
  seedLatency({ pa: 1000, pb: 1200, pd: 1500, pc: 30_000 })
  pinSticky('Gamma-Mini')

  const decision = select()

  assert.equal(decision.latencyGateMs, 1500, '门槛是池内 EWMA 的 p75，不是写死的绝对毫秒数')
  assert.equal(decision.stickyGated, true, '这一轮硬粘性被跳过这件事要能被日志读到')
  assert.equal(decision.reason, 'score', '没有提前，就不能谎称命中粘性')
  assert.equal(decision.candidates[0].displayName, 'Alpha-Flash', '首位回到打分：免费 + 首字 1s，而不是被锁在 30s 那家')
})

test('负控：粘住的模型快于池内 p75 时照旧提前（门只拦慢，不拦粘性本身）', () => {
  // Gamma 0.5s 最快，其余三家 1.5/2.0/2.5s → p75 = 2.0s。门槛只拦「慢于四分之三」。
  seedLatency({ pc: 500, pa: 1500, pb: 2000, pd: 2500 })
  pinSticky('Gamma-Mini')

  const decision = select()

  assert.equal(decision.latencyGateMs, 2000)
  assert.equal(decision.stickyGated, undefined)
  assert.equal(decision.candidates[0].displayName, 'Gamma-Mini')
  assert.equal(decision.reason, 'sticky', 'agent 会话的连续性没有被这条门顺手拿走')
})