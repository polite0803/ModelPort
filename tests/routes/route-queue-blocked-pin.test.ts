/**
 * 推荐队列的地基（裁定：队列选路只由用户「固定」决定）。
 *
 * 这里证明的是三件**只能靠行为看出**的事，读源码文本证不了：
 *
 * 1. **被挡下的模型仍在列表里**：`preview` 的 `models` 带上 `blocked`（原因 + 解禁时刻），
 *    但它们的候选**绝不进 `rankInputs`** —— 展示与排序是两个口径，混一次就会把
 *    「额度满了」的模型派出去，或者把「池里还有 51 个模型一次都没被派过」的原因藏起来。
 * 2. **被挡下 ≠ 不可选**：`switchModel` 仍能把它「固定」下来（裁定 2026-11-16：
 *    手动固定是最高响应）。用户明确点名一颗正在限流的模型，网关不许替他改主意。
 * 3. **固定之后仍然拒答保钉**：派不出去时给 `pinTransient`（429 + Retry-After），
 *    而不是静默换成别的模型 —— 那正是队列想避免的事。
 *
 * 不在本层证明：renderer 渲染、托盘菜单的 IPC 往返、真上游。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from './harness.mjs'
import type { ChatCompletionRequest } from '../../src/main/proxy/types.ts'
import type { ModelRoute } from '../../src/shared/types.ts'
import { localDayKey } from '../../src/shared/localDay.ts'

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

const REQUEST = { model: 'auto', messages: [{ role: 'user', content: 'queue' }] } as ChatCompletionRequest

let seq = 0
/** 一家、一把账号、两颗模型（`Full-<id>` / `Room-<id>`），声明额度是账号级的。 */
function seedProvider(options: { declaredLimit: number; spent: number }) {
  const id = `q${seq++}`
  sm.addProvider({
    id,
    name: `Queue ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    // 显示名带家前缀：跨家同名会让 `.find(displayName)` 取到别家的行，
    // 断言就变成在证明另一家的事。
    supportedModels: [`Full-${id}`, `Room-${id}`],
    modelMappings: { [`Full-${id}`]: `${id}-full`, [`Room-${id}`]: `${id}-room` },
  } as never)
  const accountId = `${id}-acct`
  sm.addAccount({
    id: accountId,
    providerId: id,
    name: `${id} key`,
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    // 声明额度是**账号级**的（套餐级），所以它会同时挡住这家所有模型。
    declaredQuota: [{ window: 'day', unit: 'requests', limit: options.declaredLimit }],
  } as never)
  const ledger = sm.getQuotaLedger()
  for (let i = 0; i < options.spent; i += 1) {
    ledger.record(id, accountId, `${id}-full`, { promptTokens: 1, completionTokens: 1, totalTokens: 2 })
  }
  return { id, accountId, full: `Full-${id}`, room: `Room-${id}` }
}

let routeSeq = 0
function makeRoute(overrides: Record<string, unknown> = {}): ModelRoute {
  const name = `queue${routeSeq++}`
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

// —— 1. 被挡下的模型仍在 rows 里，带原因，但不在可派候选里。
test('a blocked model is listed with its reason and never joins the dispatchable candidates', () => {
  const { id, accountId, full: fullName, room: roomName } = seedProvider({ declaredLimit: 2, spent: 2 })
  const route = makeRoute()

  const preview = autoRouter.preview(route, {}, { fresh: true })
  const full = preview.models.find(model => model.displayName === fullName)
  const room = preview.models.find(model => model.displayName === roomName)

  assert.ok(full !== undefined, 'a model blocked by its own quota must not vanish from the preview')
  assert.equal(full?.status, 'kept', 'the config layer still has it in the pool — that is a different question')
  assert.equal(full?.blocked?.reason, 'declared-exhausted')
  assert.ok((full?.blocked?.until ?? 0) > Date.now(), 'and it says when it comes back')
  assert.equal(full?.blocked?.untilSource, 'estimated', 'a rolling window reset is an estimate, so the UI writes 「约」')
  assert.equal(full?.actualModelId, `${id}-full`, 'the row carries the upstream name, which is what the ledger is keyed by')

  // 同一家、同一账号，`Room-B` 也被同一条账号级声明挡住 —— 声明是套餐级的。
  assert.equal(room?.blocked?.reason, 'declared-exhausted')

  // 但两颗都**不在**可派候选里（预览只报事实，排序另算）。这里按家数而不是全局
  // `counts.candidates`：同一个测试进程里别的用例也种了供应商，全局数不是本用例的结论。
  const dispatchable = preview.models.filter(model =>
    model.providerId === id
    && (model.status === 'kept' || model.status === 'included')
    && model.blocked === undefined)
  assert.deepEqual(dispatchable, [], 'the whole account is out of quota, so none of its models can be dispatched')
  assert.ok(preview.skipped.some(entry => entry.includes('declared-exhausted')), 'and the skip list names the cause')
  void accountId
})

test('the dispatchable model next to a blocked one keeps its own row untarnished', () => {
  // 这家不声明额度；另一家的账号打满。列表要能同时说清两颗模型各自的处境。
  const blocked = seedProvider({ declaredLimit: 1, spent: 1 })
  const open = seedProvider({ declaredLimit: 100, spent: 0 })
  const route = makeRoute()

  const preview = autoRouter.preview(route, {}, { fresh: true })
  const byProvider = (providerId: string) => preview.models.filter(model => model.providerId === providerId)

  assert.equal(byProvider(blocked.id).every(model => model.blocked?.reason === 'declared-exhausted'), true)
  assert.equal(byProvider(open.id).every(model => model.blocked === undefined), true,
    'a model that can be dispatched carries no block record at all')
  assert.equal(byProvider(open.id).every(model => model.status === 'kept'), true,
    'and both of its models are in the pool')
  assert.equal(preview.skipped.some(entry => entry.startsWith(`${open.id}/`)), false,
    'nothing from the open provider was skipped')
})

// —— 2. 被挡下也能「固定」（手动固定是最高响应）。
test('a blocked model is still selectable, and pinning it is accepted', () => {
  const { id, full: fullName } = seedProvider({ declaredLimit: 1, spent: 1 })
  const route = makeRoute()
  const routes = sm.listModelRoutes()

  const result = autoRouter.switchModel(
    { route: route.name, model: fullName, providerId: id, scope: 'route' },
    routes,
    Date.now(),
  )
  assert.equal(result.ok, true, `pinning a blocked model must be allowed: ${result.reason ?? ''}`)
  assert.equal(result.model, fullName)
  assert.equal(result.providerId, id)

  // 落盘由 `routes:switch` 统一做（`switchModel` 只做命中校验），这里照同一条接线写一次。
  const written = sm.updateRoute(route.name, {
    preferredModel: { providerId: id, displayName: fullName },
  })
  assert.equal(written.ok, true, JSON.stringify(written.ok ? undefined : written.error))
  const reloaded = sm.listModelRoutes().find(candidate => candidate.name === route.name) as ModelRoute

  // 菜单里那一行同时带着「被固定」与「被挡下」：两个正交的口径，谁也不该抹掉谁。
  const menu = autoRouter.routeMenu(reloaded, 8, Date.now())
  const row = menu.models.find(model => model.displayName === fullName)
  assert.equal(row?.blocked?.reason, 'declared-exhausted')
  assert.equal(menu.pin?.displayName, fullName, 'the pin is the routing decision the user made')
})

// —— 3. 固定之后仍然拒答保钉，绝不静默换模型。
test('selecting a pinned-but-blocked model refuses in place instead of switching away', () => {
  const { id, full: fullName } = seedProvider({ declaredLimit: 1, spent: 1 })
  const route = makeRoute({ preferredModel: { providerId: id, displayName: fullName } })

  const decision = autoRouter.select(REQUEST, 'round-robin', undefined, route)
  assert.deepEqual(decision.candidates, [], 'nothing is dispatched this turn')
  assert.equal(decision.pinTransient?.displayName, fullName)
  assert.equal(decision.pinTransient?.cause, 'quota', 'the cause is the quota window, not a generic failure')
  assert.ok((decision.pinTransient?.retryAfterSeconds ?? 0) > 0, 'and it says how long to wait')
  assert.equal(decision.pinStale, undefined, 'a transient block is not a stale pin — the pin is kept')
  assert.notEqual(decision.reason, 'pin', 'reason describes the candidates that were served; none were')
  assert.equal(decision.pin?.displayName, fullName, 'the pin itself is still in force')

  const stored = sm.listModelRoutes().find(candidate => candidate.name === route.name)
  assert.deepEqual(stored?.preferredModel, { providerId: id, displayName: fullName },
    'the pin survives the refusal: no algorithm may switch it away')
})

// —— 4. 每日上限也进同一个队列口径（采集阶段的瞬时剔除）。
test('a daily-limit hit surfaces as blocked with a local-midnight recovery', () => {
  const { accountId, full: fullName } = seedProvider({ declaredLimit: 100, spent: 0 })
  sm.updateAccount(accountId, {
    dailyLimit: 1,
    todayUsed: 1,
    todayUsedDay: localDayKey(Date.now()),
  })
  const route = makeRoute()

  const preview = autoRouter.preview(route, {}, { fresh: true })
  const row = preview.models.find(model => model.displayName === fullName)
  assert.equal(row?.blocked?.reason, 'daily_limit')
  assert.equal(row?.blocked?.untilSource, 'local', 'our own bookkeeping rule, not an upstream statement')
  const midnight = new Date(row?.blocked?.until ?? 0)
  assert.equal(midnight.getHours(), 0, 'the instant is local midnight')
  assert.equal(midnight.getMinutes(), 0)
  assert.equal(row?.status, 'kept', 'still in the pool by configuration')
})

// —— 5. 被池策略筛掉的模型不因为「额度满了」重新冒出来。
test('a model the pool strategy dropped never reappears just because its quota ran out', () => {
  const { id, full: fullName } = seedProvider({ declaredLimit: 1, spent: 1 })
  // 手动排除 `Full-<id>`：配置层的结论先于临时状态。
  const route = makeRoute({ excludeModels: [{ providerId: id, displayName: fullName }] })

  const preview = autoRouter.preview(route, {}, { fresh: true })
  const rows = preview.models.filter(model => model.providerId === id && model.displayName === fullName)
  assert.equal(rows.length, 1, 'the row still exists — it has to explain why it is out')
  assert.equal(rows[0].status, 'excluded', 'excluded by configuration, which is the reason that matters')
  assert.equal(rows[0].blocked, undefined, 'a configuration exclusion is not a temporary block')
  const dispatchable = preview.models.filter(model =>
    model.providerId === id && (model.status === 'kept' || model.status === 'included') && model.blocked === undefined)
  assert.deepEqual(dispatchable.map(model => model.displayName), [],
    'nothing of this provider is dispatchable: one model is excluded, the other is out of quota')
  assert.equal(autoRouter.routeMenu(route, 8, Date.now()).models.some(model => model.displayName === fullName), false,
    'a configuration exclusion must not be selectable, whatever its quota says')
})