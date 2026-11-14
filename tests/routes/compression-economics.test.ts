import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, startProxy } from './harness.mjs'

const PORT = 18979
const SECRET = 'compression_economics_secret'

const harness = await bootstrapStore({
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    tokenUsage: {
      // DeepSeek: one compressed turn (1,000 prompt / 400 cached / 250 saved) and
      // one refused turn (2,000 prompt / 1,500 cached).
      '2026-11-10': {
        upstreamPrompt: 3000,
        requests: 2,
        upstreamRequests: 2,
        byProvider: {
          deepseek: {
            upstreamPrompt: 3000,
            requests: 2,
            upstreamRequests: 2,
            compression: {
              applied: {
                requests: 1,
                promptTokens: 1000,
                cacheReportedRequests: 1,
                promptTokensWithCache: 1000,
                cacheReadTokens: 400,
                savedTokens: 250,
              },
              refused: {
                requests: 1,
                promptTokens: 2000,
                cacheReportedRequests: 1,
                promptTokensWithCache: 2000,
                cacheReadTokens: 1500,
                savedTokens: 0,
              },
            },
          },
        },
      },
      // A custom endpoint has no documented cache: its break-even must be null.
      '2026-11-11': {
        upstreamPrompt: 500,
        requests: 1,
        upstreamRequests: 1,
        byProvider: {
          'my-endpoint': {
            upstreamPrompt: 500,
            requests: 1,
            upstreamRequests: 1,
            compression: {
              applied: {
                requests: 1,
                promptTokens: 500,
                cacheReportedRequests: 0,
                promptTokensWithCache: 0,
                cacheReadTokens: 0,
                savedTokens: 50,
              },
              refused: {
                requests: 0,
                promptTokens: 0,
                cacheReportedRequests: 0,
                promptTokensWithCache: 0,
                cacheReadTokens: 0,
                savedTokens: 0,
              },
            },
          },
        },
      },
    },
    config: {
      proxyPort: PORT,
      proxyHost: '127.0.0.1',
      routes: {},
      managementApi: { enableManagementApi: true, managementApiSecret: SECRET },
    },
  },
})

const proxy = await startProxy(PORT)

after(async () => {
  await proxy.stop()
  harness.dispose()
})

async function economics(query = 'days=7') {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/management/compression/economics?${query}`, {
    headers: { 'X-Management-Secret': SECRET },
  })
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

test('economics reports the two arms per provider over the retained days', async () => {
  const { status, body } = await economics()
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.equal(body.data.window.days, 7)
  assert.equal(body.data.window.firstDay, '2026-11-10')
  assert.equal(body.data.window.lastDay, '2026-11-11')

  const deepseek = body.data.providers.find((row: any) => row.providerId === 'deepseek')
  assert.ok(deepseek, 'the provider with day buckets must be reported')
  assert.equal(deepseek.applied.requests, 1)
  assert.equal(deepseek.refused.requests, 1)
  assert.equal(deepseek.appliedCacheShare, 0.4)
  assert.equal(deepseek.refusedCacheShare, 0.75)
  // 250 / (1000 + 250) = 0.2 against DeepSeek's 0.98 break-even.
  assert.ok(Math.abs(deepseek.realizedSavingRatio - 0.2) < 1e-9)
  assert.ok(Math.abs(deepseek.breakEvenSavingRatio - 0.98) < 1e-9)
  assert.equal(deepseek.clearsBreakEven, false)
})

test('an undocumented cache reports null break-even, not zero', async () => {
  const { body } = await economics()
  const custom = body.data.providers.find((row: any) => row.providerId === 'my-endpoint')
  assert.ok(custom)
  assert.equal(custom.breakEvenSavingRatio, null)
  assert.equal(custom.clearsBreakEven, null)
  assert.equal(custom.appliedCacheShare, null, '未报缓存 ≠ 0% 命中')
})

test('the window is bounded and an empty window names itself', async () => {
  const { status, body } = await economics('days=1')
  assert.equal(status, 200)
  assert.equal(body.data.window.days, 1)
  assert.equal(body.data.window.firstDay, '2026-11-11')
  assert.deepEqual(body.data.providers.map((row: any) => row.providerId), ['my-endpoint'])
})