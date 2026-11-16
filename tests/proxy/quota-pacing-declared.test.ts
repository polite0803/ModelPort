/**
 * `smart` / `pace` 的第五层证据：用户声明的额度窗口。
 *
 * 这两条策略原本只认官方帽与实测帽（`resolveCaps`），而那两层只对聚合目录的家成立。
 * 20 个订阅套餐条目全是 `undocumented` —— 于是「先把快过期的额度用掉」这条策略恰好
 * 在用户最关心的那几家上退回 fill-first。`declaredQuota.ts` 的存在就是为了补这一格，
 * 这里钉住的是**接线**（纯函数的排序规则见 `tests/shared/quota-pacing.test.ts`）：
 *
 * 1. 只有声明、没有官方帽的账号，现在真的会改变选号结果 —— 而且改变方向与
 *    fill-first 相反（否则测试会在策略根本没生效时也通过）。
 * 2. 声明里的**复位时刻**参与排序：余量相同时，窗口更早结束的那家先被 `smart` 选中。
 * 3. 一点证据都没有的家不参与，策略整体退回既有顺序 —— 不因为"算不出来"把候选判死。
 *
 * 层：真 store（真落盘）+ 真账本 + 真 `loadBalancer`。不涉及上游。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const HOUR = 3_600_000
const MINUTE = 60_000

let seq = 0
/** 一家 + 一把账号，`declaredLimit` 是账号级声明（`undefined` = 什么都不声明）。 */
function seed(model: string, declaredLimit: number | undefined) {
  const id = `pacing${seq++}`
  return { id, model, declaredLimit }
}

const seeded = [
  // 测试 1（pace）：同一颗模型两把 Key，余量差很多。
  seed('Pace-A', 100),
  seed('Pace-A', 100),
  // 测试 2（smart）：余量相同，只有窗口何时松口不同。
  seed('Smart-A', 100),
  seed('Smart-A', 100),
  // 测试 3（没有证据）：完全不声明。
  seed('Plain-A', undefined),
  seed('Plain-A', undefined),
]

const harness = await bootstrapStore({
  initialData: {
    providers: seeded.map(entry => ({
      id: entry.id,
      name: `Pacing ${entry.id}`,
      type: 'custom',
      authType: 'token',
      apiEndpoint: 'http://127.0.0.1:1/v1',
      chatPath: '/chat/completions',
      headers: {},
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      supportedModels: [entry.model],
      modelMappings: { [entry.model]: `${entry.id}-actual` },
    })),
    accounts: seeded.map(entry => ({
      id: `${entry.id}-acct`,
      providerId: entry.id,
      name: `${entry.id} key`,
      credentials: { token: 'test-token' },
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
      // 声明是**账号级**的套餐额度，与官方帽并列而不换算。
      ...(entry.declaredLimit === undefined
        ? {}
        : { declaredQuota: [{ window: 'day', unit: 'requests', limit: entry.declaredLimit }] }),
    })),
  },
})
const sm = harness.storeManager
const { loadBalancer } = await loadModule('main/proxy/loadbalancer.ts')

after(() => harness.dispose())

/**
 * 账本里种下 `count` 笔用量，最老那笔落在 `oldestAgoMs` 之前 —— 滚动窗口的
 * 松口时刻由**最老那一笔**决定，所以这个参数就是「还有多久复位」。
 *
 * `spacingMs` 决定这 `count` 笔挤在多长的跨度里；不填即全部落在同一分钟（最紧的窗口）。
 * 注意账本按分钟取整，且 `at <= now` 才算数 —— 别把记录种到未来。
 */
function spend(
  entry: ReturnType<typeof seed>,
  count: number,
  oldestAgoMs: number,
  spacingMs = 0,
): void {
  const ledger = sm.getQuotaLedger()
  const base = Date.now() - oldestAgoMs
  for (let i = 0; i < count; i += 1) {
    ledger.record(entry.id, `${entry.id}-acct`, `${entry.id}-actual`,
      { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, base + i * spacingMs)
  }
}

test('a declared quota alone gives pace a real opinion', () => {
  const [busy, roomy] = seeded.slice(0, 2)
  // 两家都跨 21 小时：busy 只剩 10 次、roomy 还剩 95 次，两家都还在窗口里没打满。
  spend(busy, 90, 21 * HOUR, MINUTE)
  spend(roomy, 5, 21 * HOUR, MINUTE)

  // 负控：fill-first 按配置顺序取第一家，所以下面若也取到它，说明策略根本没生效。
  assert.equal(loadBalancer.selectAccount('Pace-A', 'fill-first')?.account.id, `${busy.id}-acct`)

  assert.equal(loadBalancer.selectAccount('Pace-A', 'pace')?.account.id, `${roomy.id}-acct`,
    'pace spreads the declared allowance: the roomy account wins despite being configured second')
})

test('the declared reset instant decides smart between two equally used accounts', () => {
  // 配置顺序把"该输"的放在前面：fill-first 取 later。
  const [later, soon] = seeded.slice(2, 4)
  // 余量相同（各 50/100），区别只在窗口何时松口：soon 的最老用量在 23 小时前
  // （约 1 小时后复位），later 的就在刚才（要等将近 24 小时）。
  spend(later, 50, 0)
  spend(soon, 50, 23 * HOUR, MINUTE)

  assert.equal(loadBalancer.selectAccount('Smart-A', 'fill-first')?.account.id, `${later.id}-acct`)

  assert.equal(loadBalancer.selectAccount('Smart-A', 'smart')?.account.id, `${soon.id}-acct`,
    'smart prefers the window that frees soonest, which is what "use it before it expires" means')
})

test('accounts with no evidence at all fall back to the existing order', () => {
  const [first] = seeded.slice(4)
  const fillFirst = loadBalancer.selectAccount('Plain-A', 'fill-first')?.account.id
  assert.equal(fillFirst, `${first.id}-acct`)

  // 没有官方帽、也没有声明 = 没有意见，退回既有顺序；绝不许因为"算不出来"把候选判死。
  assert.equal(loadBalancer.selectAccount('Plain-A', 'smart')?.account.id, fillFirst)
  assert.equal(loadBalancer.selectAccount('Plain-A', 'pace')?.account.id, fillFirst)
})