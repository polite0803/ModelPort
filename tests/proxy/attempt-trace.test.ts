import { test } from 'node:test'
import assert from 'node:assert/strict'

import { attemptTraceOf } from '../../src/main/proxy/attemptTrace.ts'

const provider = { id: 'p1', name: 'Provider One' } as never
const account = { id: 'a1', name: 'Account One' } as never

function trace(result: Record<string, unknown>, aborted = false) {
  return attemptTraceOf({
    provider,
    account,
    model: 'upstream-model',
    retryIndex: 0,
    aborted,
    result: {
      success: false,
      latency: 12,
      ...result,
    } as never,
  })
}

test('尝试链：成功、可换家、能力不匹配、终止、客户端取消各自分类', () => {
  assert.equal(trace({ success: true, status: 200 }).outcome, 'success')
  assert.equal(trace({ status: 502 }).outcome, 'failover')
  assert.equal(trace({ status: 429 }).outcome, 'failover')
  assert.equal(trace({ status: 404 }).outcome, 'capability')
  assert.equal(trace({ status: 400, error: 'invalid role' }).outcome, 'fatal')
  assert.equal(trace({ status: undefined, error: 'canceled' }, true).outcome, 'client_abort')
})

test('尝试链：保留状态、错误码与耗时，供日志直接读取', () => {
  const row = trace({
    status: 403,
    error: 'region blocked',
    errorDetails: { message: 'region blocked', type: 'permission_error', code: 'region_denied' },
  })
  assert.equal(row.providerId, 'p1')
  assert.equal(row.providerName, 'Provider One')
  assert.equal(row.accountId, 'a1')
  assert.equal(row.model, 'upstream-model')
  assert.equal(row.status, 403)
  assert.equal(row.errorType, 'permission_error')
  assert.equal(row.errorCode, 'region_denied')
  assert.equal(row.latencyMs, 12)
  assert.equal(row.retryIndex, 0)
})
