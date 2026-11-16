/**
 * 手动换钉/解钉 = 最高响应（裁定 2026-11-16）的决策层与接线判据：
 *
 * 1. **网关自己开的退避票当场让路**：用户点名的那一刻，账号故障冷却、(账号,模型)
 *    429 档、静默窗口、目标模型的熔断票、路由粘性惯性全部清掉，下一笔立刻按新钉
 *    派发 —— 不是停在「N 秒后重试」的排队态。
 * 2. **事实态不让路**：当日上限/额度标记是上游亲口说的，清了只是伪造容量；
 *    换钉后仍如实拒答（pinTransient）并保钉。
 * 3. **不伪造成功**：`clearManualOverride` 与 `recordSuccess` 的区别是不写
 *    `lastSuccessAt` —— 伪造成功会污染「近期有没有成功」这条静默判据，让死通道
 *    永远开不了窗。这里用「清完再超时两次仍能重新开窗」证明。
 * 4. **解钉 = 回算法排队**：清这条路由的粘性/缓存亲和锚点（别的 route 不共享），
 *    下一轮真按分数排序；熔断票是算法自己的质量信号，解钉不清、换钉才清。
 * 5. **接线**：`routes:switch` / `routes:unpin` 两个 handler、控制台按钮与托盘
 *    勾选态的「再点一下 = 解除」toggle、两份 locale 的 unpinHint。
 *
 * fixture：mp 家两颗模型（Pin-A/Pin-B，上游真名 mp-a/mp-b，证明 429 档的键
 * 按映射解析）+ mq 家一颗（证明换钉只清目标一家）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { bootstrapStore, loadModule } from './harness.mjs'
import { localDayKey } from '../../src/shared/localDay.ts'
import { accountRuntime } from '../../src/main/proxy/accountRuntime.ts'
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
        prefer: 'balanced',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager

const { autoRouter } = await loadModule('main/proxy/autoRouter.ts')

after(() => {
  harness.dispose()
})

sm.addProvider({
  id: 'mp',
  name: 'Manual Pin Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Pin-A', 'Pin-B'],
  modelMappings: { 'Pin-A': 'mp-a', 'Pin-B': 'mp-b' },
} as never)
sm.addAccount({
  id: 'mp-acct',
  providerId: 'mp',
  name: 'mp account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)
sm.addProvider({
  id: 'mq',
  name: 'Other Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Other-X'],
  modelMappings: { 'Other-X': 'mq-x' },
} as never)
sm.addAccount({
  id: 'mq-acct',
  providerId: 'mq',
  name: 'mq account',
  credentials: { token: 'test-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
} as never)

const REQUEST = {
  model: 'auto',
  messages: [{ role: 'user', content: 'one line question' }],
} as ChatCompletionRequest

let routeCounter = 0
function makeRoute(overrides: Record<string, unknown> = {}): ModelRoute {
  const name = `mp${routeCounter++}`
  const created = sm.createRoute({
    name,
    enabled: true,
    strategy: 'round-robin',
    prefer: 'balanced',
    maxAttempts: 3,
    stickyMinutes: 30,
    modelScope: 'pool',
    ...overrides,
  })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  return created.route as ModelRoute
}

const select = (route: ModelRoute, request: ChatCompletionRequest = REQUEST) =>
  autoRouter.select(request, 'round-robin', undefined, route)

const pinnedRoute = () => makeRoute({ preferredModel: { providerId: 'mp', displayName: 'Pin-A' } })

// ---------------- 1. 退避票让路 ----------------

test('换钉清账号故障冷却：pinCooling 拒答 → 释放后立刻按钉派发', () => {
  const route = pinnedRoute()
  autoRouter.markAccountCooldown('mp-acct', 504)

  const before = select(route)
  assert.equal(before.pinCooling?.displayName, 'Pin-A', '前置：冷却票真的挡下了这颗钉')
  assert.deepEqual(before.candidates, [])
  assert.equal(before.pinStale, undefined, '冷却不是失效')

  // routes:switch 的接线形状：clearPin 之后 releaseForManualPin（见 §5 源码断言）
  autoRouter.releaseForManualPin(route.name, 'mp', 'Pin-A')

  const after = select(route)
  assert.equal(after.reason, 'pin')
  assert.equal(after.pinMiss, undefined, '用户点名的那一刻就不该再失配')
  assert.equal(after.pinCooling, undefined)
  assert.ok(after.candidates.length > 0, '下一笔立刻派发，不停在「N 秒后重试」')
  assert.deepEqual([...new Set(after.candidates.map(c => c.displayName))], ['Pin-A'])
  assert.equal(accountRuntime.snapshot('mp-acct').consecutiveFailures, 0, '失败计数一并归零')
})

test('换钉清 (账号,模型) 429 档：键是上游真名，映射解析不能少', () => {
  const route = pinnedRoute()
  // 429 档按上游真名 'mp-a' 记键 —— 释放若拿 displayName 去清就清不掉
  autoRouter.markAccountCooldown('mp-acct', 429, 'mp-a')
  assert.equal(accountRuntime.isCooling('mp-acct', Date.now(), 'mp-a'), true)
  assert.equal(select(route).pinCooling?.displayName, 'Pin-A')

  autoRouter.releaseForManualPin(route.name, 'mp', 'Pin-A')

  assert.equal(accountRuntime.isCooling('mp-acct', Date.now(), 'mp-a'), false,
    'releaseForManualPin 必须经 getEffectiveModels 解析到 actualModelId')
  assert.equal(select(route).reason, 'pin')
})

test('换钉清静默窗口，但不伪造成功：两次新超时仍能重新开窗，AIMD 不动', () => {
  accountRuntime.reset()
  const route = pinnedRoute()

  assert.equal(accountRuntime.recordFirstBlockTimeout('mp-acct', 'mp-a'), undefined)
  assert.ok(accountRuntime.recordFirstBlockTimeout('mp-acct', 'mp-a'), '连续两次超时开窗')
  assert.ok(accountRuntime.silentChannel('mp-acct', 'mp-a'), '前置：窗口开着')
  const limitBefore = accountRuntime.snapshot('mp-acct', Date.now(), 'mp-a').modelLimit

  autoRouter.releaseForManualPin(route.name, 'mp', 'Pin-A')

  assert.equal(accountRuntime.silentChannel('mp-acct', 'mp-a'), undefined, '窗口当场让路')
  assert.equal(accountRuntime.snapshot('mp-acct', Date.now(), 'mp-a').modelLimit, limitBefore,
    '没有成功发生过，AIMD 并发档不许借机加减')

  // 关键反证：若释放伪造了 lastSuccessAt，「近期无成功」判据为假，窗口再也开不了
  assert.equal(accountRuntime.recordFirstBlockTimeout('mp-acct', 'mp-a'), undefined,
    '计数从零起：第一次超时不开窗')
  assert.ok(accountRuntime.recordFirstBlockTimeout('mp-acct', 'mp-a'),
    '第二次超时仍然开窗 —— lastSuccessAt 没被伪造')
  assert.ok(accountRuntime.silentChannel('mp-acct', 'mp-a'))
  accountRuntime.reset()
})

test('换钉清目标模型的熔断票，同池别的模型的票留着', () => {
  const route = makeRoute()
  autoRouter.tripModelCircuit(route.name, 'Pin-A', 'repetition')
  autoRouter.tripModelCircuit(route.name, 'Pin-B', 'empty-turn')

  autoRouter.releaseForManualPin(route.name, 'mp', 'Pin-A')

  assert.equal(autoRouter.modelCircuitUntil(route.name, 'Pin-A'), undefined,
    '用户点名是对这颗模型的背书，熔断票当场撕掉')
  assert.ok(autoRouter.modelCircuitUntil(route.name, 'Pin-B'), '没被点名的模型不借光')
})

test('换钉只清目标一家：别家账号的冷却票留着', () => {
  const route = pinnedRoute()
  autoRouter.markAccountCooldown('mq-acct', 504)

  autoRouter.releaseForManualPin(route.name, 'mp', 'Pin-A')

  assert.equal(accountRuntime.isCooling('mq-acct'), true, '别家的退避与这次点名无关')
  autoRouter.clearAccountCooldown('mq-acct')
})

// ---------------- 2. 事实态不让路 ----------------

test('当日打满是事实：换钉后仍 pinTransient 拒答保钉，不伪造容量', () => {
  accountRuntime.reset()
  const route = pinnedRoute()
  sm.updateAccount('mp-acct', {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })

  autoRouter.releaseForManualPin(route.name, 'mp', 'Pin-A')

  const decision = select(route)
  assert.deepEqual(decision.candidates, [], '当日用量是上游亲口说的，清了只是伪造容量')
  assert.equal(decision.pinTransient?.displayName, 'Pin-A')
  assert.equal(decision.pinTransient?.cause, 'daily_limit')
  assert.equal(decision.pinStale, undefined, '窗口复位就回来的钉不是失效')
  assert.equal(decision.pin?.displayName, 'Pin-A', '保钉')
  const stored = sm.listModelRoutes().find(candidate => candidate.name === route.name)
  assert.deepEqual(stored?.preferredModel, { providerId: 'mp', displayName: 'Pin-A' })

  sm.updateAccount('mp-acct', { todayUsedDay: '2000-01-01' })
})

// ---------------- 3. 解钉 = 回算法排队 ----------------

test('解钉清粘性惯性：下一轮真按分数排序，且只清这条路由', () => {
  const routeX = makeRoute()
  const routeY = makeRoute()

  const fresh = select(routeX)
  assert.equal(fresh.reason, 'score', '前置：无钉无粘性时按分数')
  assert.ok(fresh.conversationKey)
  const anchor = fresh.candidates[fresh.candidates.length - 1]
  assert.notEqual(anchor.displayName, fresh.candidates[0].displayName, '锚点取非队首才看得见硬钉')
  autoRouter.rememberRoute(fresh.conversationKey, anchor, routeX)
  assert.equal(select(routeX).reason, 'sticky', '前置：粘性硬钉生效')
  assert.equal(select(routeX).candidates[0].displayName, anchor.displayName)

  const freshY = select(routeY)
  const anchorY = freshY.candidates[freshY.candidates.length - 1]
  autoRouter.rememberRoute(freshY.conversationKey, anchorY, routeY)
  assert.equal(select(routeY).reason, 'sticky')

  // routes:unpin 的接线形状：clearPin 之后 clearRouteInertia
  autoRouter.clearRouteInertia(routeX.name)

  const after = select(routeX)
  assert.equal(after.reason, 'score', '解钉后不被上一段会话的锚点硬钉在刚解掉的模型上')
  assert.equal(select(routeY).reason, 'sticky', '别的 route 的锚点不共享、不误清')
})

// ---------------- 4. 不伪造成功的源码判据 ----------------

test('clearManualOverride 源码：不写 lastSuccessAt、不走 recordSuccess、不动 AIMD', () => {
  const source = readFileSync(new URL('../../src/main/proxy/accountRuntime.ts', import.meta.url), 'utf8')
  const body = source.match(/clearManualOverride\(accountId: string, model: string\): void \{([\s\S]*?)\n  \}/)?.[1]
  assert.ok(body, '方法必须存在且形状可读')
  assert.ok(!body.includes('lastSuccessAt'), '伪造成功会污染静默判据的「近期无成功」前提')
  assert.ok(!body.includes('recordSuccess'), '不许借道 recordSuccess（它写 lastSuccessAt）')
  assert.ok(!body.includes('.limit'), 'AIMD 并发档不在管辖内')
  assert.ok(body.includes('coolingUntil = undefined'))
  assert.ok(body.includes('silentUntil = undefined'))
  assert.ok(body.includes('silentTimeouts = 0'))
  assert.ok(body.includes('delete(model)'), '429 档按模型清')
})

test('clearRouteInertia 源码：粘性与缓存亲和两张表都清，键按路由前缀', () => {
  const source = readFileSync(new URL('../../src/main/proxy/autoRouter.ts', import.meta.url), 'utf8')
  const body = source.match(/clearRouteInertia\(routeName: string\): void \{([\s\S]*?)\n  \}/)?.[1]
  assert.ok(body)
  assert.ok(body.includes('this.sticky.keys()'))
  assert.ok(body.includes('this.cacheAffinity.keys()'))
  assert.ok(body.includes('`${routeName}|`'), '键前缀 = 路由名，别家不误清')
})

// ---------------- 5. 接线：handler / 控制台 / 托盘 / locale ----------------

test('routes:switch 接 releaseForManualPin，routes:unpin 接 clearRouteInertia', () => {
  const source = readFileSync(new URL('../../src/main/ipc/handlers.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('autoRouter.releaseForManualPin(result.route, result.providerId, result.model)'),
    '换钉 handler 必须在落盘后释放退避票')
  assert.ok(source.includes('autoRouter.clearRouteInertia(routeName)'),
    '解钉 handler 必须清惯性')
})

test('控制台按钮：已固定再点 = 解除；0 账号的已固定模型也能点掉', () => {
  const source = readFileSync(new URL('../../src/renderer/src/pages/Routes.tsx', import.meta.url), 'utf8')
  assert.ok(/onClick=\{\(\) => void runSwitch\(model\.pinned \? 'reset' : 'pin', model\)\}/.test(source),
    '同一颗按钮 toggle：钉住 → reset，未钉 → pin')
  assert.ok(source.includes("disabled={busy || (!model.pinned && (model.accountCount === 0 || !detail?.enabled))}"),
    '解钉不需要账号：已固定的行不因 0 账号/停用被禁点')
  assert.ok(source.includes("? t('routes.unpinHint')"), '钉住态的悬停提示是解除语义')
})

test('托盘勾选态：已固定再点 = reset；0 账号的已固定项可点', () => {
  const source = readFileSync(new URL('../../src/shell/main.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('enabled: model.pinned || model.accountCount > 0'))
  assert.ok(/click: \(\) => trayRouteCommand\(model\.pinned\s*\n\s*\? \{ action: 'reset', route: entry\.route \}/.test(source),
    '勾选态点击发 reset 意图，页面侧 runCommand 已支持 reset → unpin')
})

test('两份 locale：unpinHint 存在且非空，pinHint 写明再点一下解除', () => {
  for (const [locale, marker] of [['zh-CN', '已固定'], ['en-US', 'Pinned']] as const) {
    const json = JSON.parse(readFileSync(
      new URL(`../../src/renderer/src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
    const hint = json.routes?.unpinHint
    assert.equal(typeof hint, 'string', `${locale} 缺 routes.unpinHint`)
    assert.ok(hint.length > 0)
    assert.ok(json.routes.pinHint.includes(marker), `${locale} pinHint 要写明再点「${marker}」解除`)
  }
})