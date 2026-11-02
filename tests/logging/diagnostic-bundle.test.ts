import { test } from 'node:test'
import assert from 'node:assert/strict'

const { bootstrapStore, loadModule } = await import('../routes/harness.mjs')

test('诊断包：按请求行聚合 app log 与脱敏配置快照', async (t) => {
  const harness = await bootstrapStore({ initialData: { requestLogs: [] } })
  t.after(() => harness.dispose())
  const sm = harness.storeManager

  const row = sm.addRequestLog({
    timestamp: Date.now(),
    status: 'error',
    statusCode: 502,
    method: 'POST',
    url: '/v1/chat/completions',
    requestId: 'req-bundle-1',
    model: 'gpt-test',
    responseStatus: 502,
    latency: 12,
    isStream: false,
    errorMessage: 'upstream failed',
    errorType: 'api_error',
    errorCode: 'boom',
  })
  sm.addLog('error', 'related-line', { requestId: 'req-bundle-1' })

  const { buildRequestDiagnosticBundle } = await loadModule('main/logging/diagnosticBundle.ts')
  const bundle = buildRequestDiagnosticBundle(row.id)

  assert.equal(bundle.request?.id, row.id)
  assert.equal(bundle.request?.requestId, 'req-bundle-1')
  assert.ok(bundle.relatedLogs.some((entry: Record<string, any>) => entry.message === 'related-line'))
  assert.equal(bundle.app.version, '0.0.0-test')

  const text = JSON.stringify(bundle)
  assert.equal(text.includes('apiKeys'), false, '诊断包不得带 API Key 列表')
  assert.equal(text.includes('managementApiSecret'), false, '诊断包不得带管理密钥')
})
