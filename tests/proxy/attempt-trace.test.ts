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

test('尝试链：会话亲和头缺失的 400 记成 capability，不是 fatal', () => {
  // 2026-11-11 报障：opencode_go 的 `missing x-opencode-session` 原先落进 fatal，
  // 日志里只剩一条失败行，看不出「换一家就能成」。
  assert.equal(trace({
    status: 400,
    error: 'Request is missing x-opencode-session and cannot be routed efficiently. '
      + 'Please see https://opencode.ai/v2/docs/console/go/#where-can-i-use-it',
    errorDetails: { message: 'missing session', type: 'MissingSessionID' },
  }).outcome, 'capability')
  // 普通 400 仍然是终止（客户端自己写坏了请求，换家也救不了）
  assert.equal(trace({ status: 400, error: "Invalid value: 'session_id' must be a string" }).outcome, 'fatal')
})

test('尝试链：账号欠费的 400 记成 capability，不是 fatal', () => {
  // 2026-11-12 05:24 实测：百炼 `Arrearage` 原先落进 fatal，一家欠费把整条链打死，
  // 日志里只有这一条失败行，看不出「换下一家就能成」。
  assert.equal(trace({
    status: 400,
    error: 'Access denied, please make sure your account is in good standing. '
      + 'For details, see: https://help.aliyun.com/zh/model-studio/error-code#overdue-payment',
    errorDetails: { message: 'arrears', code: 'Arrearage' },
  }).outcome, 'capability')
  // 客户端自己写坏的 400 仍然是终止
  assert.equal(trace({ status: 400, error: 'messages: must be a non-empty array' }).outcome, 'fatal')
})
