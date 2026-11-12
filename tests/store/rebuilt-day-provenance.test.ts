import { test } from 'node:test'
import assert from 'node:assert/strict'

import { localDayKey } from '../../src/shared/localDay.ts'

const { bootstrapStore } = await import('../routes/harness.mjs')

const DAY = '2026-10-30'
const TODAY = localDayKey(Date.now())

/**
 * 清空日志把统计连带抹掉之后，那两天的总数只能取自按日用量桶（`tokenUsage`）：
 * 它记的是带回用量回执的请求，在 13 个完整天上恒 ≤ 统计的成功数，所以是下限。
 * 成功数按本账本自身的构造（`success + failed == total`）由总数减去已记失败得出。
 * 取证与失真量：`docs/audit/2026-11-13-clear-logs-statistics-loss.md`。
 */
function rebuiltStatistics() {
  return {
    totalRequests: 5041,
    successRequests: 5031 - 125 + 10,
    failedRequests: 125,
    totalLatency: 9_999,
    lastUpdated: 1_794_336_000_000,
    modelUsage: { 'gpt-test': 879 },
    providerUsage: { 'fixture-provider': 879 },
    accountUsage: { 'fixture-account': 879 },
    dailyStats: {
      [DAY]: {
        date: DAY,
        totalRequests: 5031,
        successRequests: 5031 - 125,
        failedRequests: 125,
        totalLatency: 100,
        modelUsage: { 'gpt-test': 879 },
        providerUsage: { 'fixture-provider': 5031 },
        totalRequestsSource: 'tokenLedger' as const,
      },
      [TODAY]: {
        date: TODAY,
        totalRequests: 10,
        successRequests: 10,
        failedRequests: 0,
        totalLatency: 10,
        modelUsage: { 'gpt-test': 10 },
        providerUsage: { 'fixture-provider': 10 },
      },
    },
  }
}

test('重建日行带来源标记，并守住 success+fail==total 的构造', async (t) => {
  const harness = await bootstrapStore({
    initialData: {
      requestLogs: [],
      logs: [],
      statistics: rebuiltStatistics(),
      tokenUsage: { [DAY]: { requests: 5031, upstreamPrompt: 1000, upstreamCompletion: 10, estimatedPrompt: 0, estimatedCompletion: 0, savedTokens: 0, upstreamCacheRead: 0, upstreamRequests: 5031 } },
    },
  })
  t.after(() => harness.dispose())
  const sm = harness.storeManager

  const row = sm.getStatistics().dailyStats[DAY]
  assert.equal(row.totalRequestsSource, 'tokenLedger')
  assert.equal(row.successRequests + row.failedRequests, row.totalRequests,
    '重建行必须仍满足本账本的构造，否则趋势图的成功率会读成一个凭空的数')
  assert.equal(harness.dataFile().statistics.dailyStats[DAY].totalRequestsSource, 'tokenLedger',
    '标记要落盘：重启之后还得能说出这一行是重建的')

  // 新流量落在今天，不许顺手抹掉历史那一行的标记，也不许改动它已重建的总数。
  sm.recordRequestInStats(false, 12, 'gpt-test', 'fixture-provider', 'fixture-account')
  const after = sm.getStatistics()
  assert.equal(after.dailyStats[DAY].totalRequestsSource, 'tokenLedger')
  assert.equal(after.dailyStats[DAY].totalRequests, 5031)
  assert.equal(after.dailyStats[TODAY].failedRequests, 1)
})
