import { test } from 'node:test'
import assert from 'node:assert/strict'

import { localDayKey } from '../../src/shared/localDay.ts'

const { bootstrapStore } = await import('../routes/harness.mjs')

const DAY = '2026-10-30'
const TODAY = localDayKey(Date.now())

/** 一份「用了几周」的最小账本：累计量 + 逐模型 + 逐日，外加一天的 token 桶。 */
function statistics() {
  return {
    totalRequests: 43117,
    successRequests: 41526,
    failedRequests: 1591,
    totalLatency: 9_999_999,
    lastUpdated: 1_794_336_000_000,
    modelUsage: { 'gpt-test': 4310 },
    providerUsage: { 'fixture-provider': 4310 },
    accountUsage: { 'fixture-account': 4310 },
    dailyStats: {
      [DAY]: {
        date: DAY,
        totalRequests: 1631,
        successRequests: 1627,
        failedRequests: 4,
        totalLatency: 100,
        modelUsage: { 'gpt-test': 1631 },
        providerUsage: { 'fixture-provider': 1631 },
      },
      [TODAY]: {
        date: TODAY,
        totalRequests: 886,
        successRequests: 860,
        failedRequests: 26,
        totalLatency: 50,
        modelUsage: { 'gpt-test': 886 },
        providerUsage: { 'fixture-provider': 886 },
      },
    },
  }
}

function tokenUsage() {
  return {
    [DAY]: {
      upstreamPrompt: 1_000_000,
      upstreamCompletion: 20_000,
      estimatedPrompt: 0,
      estimatedCompletion: 0,
      savedTokens: 0,
      upstreamCacheRead: 500_000,
      requests: 1620,
      upstreamRequests: 1600,
    },
  }
}

function requestRow(timestamp: number, status: 'success' | 'error' = 'success') {
  return {
    timestamp,
    status,
    statusCode: status === 'success' ? 200 : 500,
    method: 'POST',
    url: '/v1/chat/completions',
    model: 'gpt-test',
    responseStatus: status === 'success' ? 200 : 500,
    latency: 10,
    isStream: false,
  }
}

function harnessOptions() {
  return {
    initialData: {
      requestLogs: [],
      logs: [],
      statistics: statistics(),
      tokenUsage: tokenUsage(),
    },
  }
}

test('清空请求日志只删日志行，使用统计与 token 台账一律不动', async (t) => {
  const harness = await bootstrapStore(harnessOptions())
  t.after(() => harness.dispose())
  const sm = harness.storeManager

  sm.addRequestLog(requestRow(Date.now()))
  sm.addRequestLog(requestRow(Date.now(), 'error'))
  assert.ok(sm.getRequestLogs().length > 0, '夹具得先有行')

  sm.clearRequestLogs()

  assert.equal(sm.getRequestLogs().length, 0, '清空日志本身要生效')
  const restored = sm.getStatistics()
  assert.equal(restored.totalRequests, 43117)
  assert.equal(restored.successRequests, 41526)
  assert.equal(restored.failedRequests, 1591)
  assert.deepEqual(Object.keys(restored.dailyStats).sort(), [DAY, TODAY].sort())
  assert.equal(restored.modelUsage['gpt-test'], 4310)

  // 落盘也得是这样：内存对了盘上被写回默认值，是这次事故真正丢掉数据的方式。
  const onDisk = harness.dataFile()
  assert.equal(onDisk.statistics.totalRequests, 43117)
  assert.equal(onDisk.statistics.failedRequests, 1591)
  assert.equal(onDisk.tokenUsage[DAY].requests, 1620)

  // 面板四张卡片同样不许因为清空日志而归零：它们读的是这块账本。
  const stats = sm.getRequestLogStats()
  assert.equal(stats.todayTotal, 886)
  assert.equal(stats.todayError, 26)
  assert.equal(stats.total, 43117)
})

test('清空应用日志不碰使用统计', async (t) => {
  const harness = await bootstrapStore(harnessOptions())
  t.after(() => harness.dispose())
  const sm = harness.storeManager

  sm.addLog('error', 'fixture failure')
  sm.clearLogs()

  assert.equal(sm.getLogs().length, 0)
  assert.equal(sm.getStatistics().totalRequests, 43117)
  assert.equal(harness.dataFile().statistics.totalRequests, 43117)
})

test('日志面板的计数取自统计账本，不是保留窗里数出来的行数', async (t) => {
  const harness = await bootstrapStore(harnessOptions())
  t.after(() => harness.dispose())
  const sm = harness.storeManager

  // 保留窗压到 2 行：真实当天有 886 次请求（账本），只数行会把它读成 2。
  sm.updateConfig({ requestLogConfig: { enabled: true, maxEntries: 2 } })
  sm.addRequestLog(requestRow(Date.now()))
  sm.addRequestLog(requestRow(Date.now()))
  sm.addRequestLog(requestRow(Date.now(), 'error'))
  assert.equal(sm.getRequestLogs().length, 2, '夹具得先证明保留窗确实截断了')

  const stats = sm.getRequestLogStats()
  assert.equal(stats.todayTotal, 886)
  assert.equal(stats.todaySuccess, 860)
  assert.equal(stats.todayError, 26)
})
