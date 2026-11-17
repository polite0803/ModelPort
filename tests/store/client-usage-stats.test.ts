import { test } from 'node:test'
import assert from 'node:assert/strict'

import { localDayKey } from '../../src/shared/localDay.ts'

const { bootstrapStore } = await import('../routes/harness.mjs')

const TODAY = localDayKey(Date.now())

/**
 * 客户端维度要活过请求日志的保留窗：日志只留最近 200 行（实测今天 7039 笔只留
 * 300 行 ≈ 2.5 小时），而「哪个客户端发了多少」要按天可查。
 *
 * `storeManager` 是单例（`initialize()` 只跑一次），所以这些断言共用同一个账本 ——
 * 拆成多个 `test()` 会让前一个用例的计数漏进后一个。
 */
test('按天统计记下每个客户端的笔数与成功数', async (t) => {
  const harness = await bootstrapStore({
    initialData: {
      requestLogs: [],
      logs: [],
      statistics: {
        totalRequests: 10,
        successRequests: 10,
        failedRequests: 0,
        totalLatency: 0,
        lastUpdated: 1,
        modelUsage: {},
        providerUsage: {},
        accountUsage: {},
        // 这一行是「旧构建」记的：没有客户端维度，但有当天的总账。
        dailyStats: {
          [TODAY]: {
            date: TODAY,
            totalRequests: 10,
            successRequests: 10,
            failedRequests: 0,
            totalLatency: 0,
            modelUsage: {},
            providerUsage: {},
          },
        },
      },
    },
  })
  t.after(() => harness.dispose())
  const sm = harness.storeManager

  const before = sm.getStatistics().dailyStats[TODAY]?.totalRequests ?? 0

  sm.recordRequestInStats(true, 100, 'auto', 'provider-a', 'account-a', 'Qoder')
  sm.recordRequestInStats(true, 200, 'daily', 'provider-b', 'account-b', 'Qoder')
  sm.recordRequestInStats(false, 50, 'auto', 'provider-a', 'account-a', 'Claude')
  sm.recordRequestInStats(true, 30, 'auto', 'provider-a', 'account-a', 'Claude')
  // 没带客户端名的请求：进总账，但不进客户端维度 —— 那是「没记」，不是 0。
  sm.recordRequestInStats(true, 10, 'auto', 'provider-a', 'account-a')

  const day = sm.getStatistics().dailyStats[TODAY]
  assert.equal(day.clientUsage?.Qoder, 2)
  assert.equal(day.clientSuccess?.Qoder, 2)
  assert.equal(day.clientUsage?.Claude, 2)
  assert.equal(day.clientSuccess?.Claude, 1)
  // 客户端维度的笔数必须与当天的总账对上，否则界面上的占比会凭空多出一截。
  assert.equal(day.totalRequests, before + 5)
  assert.equal(day.failedRequests, 1)

  // 桶建起来了：客户端自己的成功率用它自己的笔数做分母，所以「从第一笔归属
  // 请求开始」不算口径错误 —— 归属之前那些请求不落进任何客户端。
  // 起点必须记下来：那 10 笔旧请求没人认领，读数时得知道覆盖从哪开始。
  assert.equal(typeof day.clientUsageSince, 'number')

  // 按客户端取数：按天给出，没归属的那天不出现。
  const byDay = sm.getClientUsageByDay()
  assert.equal(byDay[TODAY]?.Qoder, 2)
  assert.equal(byDay[TODAY]?.Claude, 2)

  // 换一天：那一行没有客户端维度，就整天空着，而不是给一个 0 桶。
  const stats = sm.getStatistics()
  stats.dailyStats['2020-01-01'] = {
    date: '2020-01-01',
    totalRequests: 5,
    successRequests: 5,
    failedRequests: 0,
    totalLatency: 0,
    modelUsage: {},
    providerUsage: {},
  }
  sm.updateStatistics({ dailyStats: stats.dailyStats })
  assert.equal(sm.getClientUsageByDay()['2020-01-01'], undefined)
})
