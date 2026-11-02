import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  pickUpstreamErrorDetails,
  pickUpstreamErrorMessage,
  summarizeUpstreamErrorBody,
} from '../../src/main/proxy/upstreamErrorBody.ts'
import { mapForwardFailure, withRequestId } from '../../src/main/proxy/errorMapping.ts'

test('OpenAI 错误体：message/type/param/code/metadata 全部保留', () => {
  const details = pickUpstreamErrorDetails({
    error: {
      message: 'Invalid value for tools',
      type: 'invalid_request_error',
      param: 'tools',
      code: 'invalid_tools',
      metadata: { upstream: 'cline' },
    },
  }, 400)

  assert.deepEqual(details, {
    message: 'Invalid value for tools',
    type: 'invalid_request_error',
    param: 'tools',
    code: 'invalid_tools',
    metadata: { upstream: 'cline' },
  })
  // 旧接口仍是同一句话，不因结构化改造而改口径。
  assert.equal(pickUpstreamErrorMessage({ error: { message: 'x' } }, 400), 'x')
})

test('Claude 错误信封：内层 error.type 作为机读 type', () => {
  const details = pickUpstreamErrorDetails({
    type: 'error',
    error: { type: 'rate_limit_error', message: 'slow down' },
  }, 429)
  assert.deepEqual(details, { message: 'slow down', type: 'rate_limit_error' })
})

test('顶层 message / 纯文本 / 空体：都能给出可读文案', () => {
  assert.equal(pickUpstreamErrorMessage({ message: 'top level' }, 400), 'top level')
  assert.equal(pickUpstreamErrorMessage('plain text', 502), 'plain text')
  assert.equal(pickUpstreamErrorMessage(null, 503), 'HTTP 503')
})

test('原文摘要截断，不把整份 HTML 拖进日志', () => {
  const body = summarizeUpstreamErrorBody({ message: 'x'.repeat(10_000) })
  assert.ok(body !== undefined)
  assert.ok(body!.length <= 4_000)
})

test('403 不再被改写成 401，类型是 permission_error', () => {
  const mapped = mapForwardFailure({ status: 403, message: 'region is not allowed' })
  assert.equal(mapped.status, 403)
  assert.equal(mapped.type, 'permission_error')
  assert.equal(mapped.code, 'upstream_unauthorized')
})

test('上游给出的标准 type/code/param 原样透传', () => {
  const mapped = mapForwardFailure({
    status: 400,
    details: {
      message: 'bad param',
      type: 'invalid_request_error',
      param: 'messages[2].role',
      code: 'invalid_role',
    },
  })
  assert.equal(mapped.type, 'invalid_request_error')
  assert.equal(mapped.param, 'messages[2].role')
  assert.equal(mapped.code, 'invalid_role')
})

test('未知的上游 type 不污染客户端枚举，按状态码兜底', () => {
  const mapped = mapForwardFailure({
    status: 503,
    details: { message: 'upstream overloaded', type: 'INVALID_ARGUMENT' },
  })
  assert.equal(mapped.type, 'api_error')
  assert.equal(mapped.status, 503)
})

test('风控/凭据/限流的本仓机读 code 优先于上游 code', () => {
  assert.equal(
    mapForwardFailure({ status: 400, message: 'request illegal 请求被拦截' }).code,
    'channel_risk_control',
  )
  assert.equal(
    mapForwardFailure({ status: 502, message: 'qoder: no usable credential; log in first' }).code,
    'channel_relogin_required',
  )
  assert.equal(mapForwardFailure({ status: 429 }).code, 'rate_limit_exceeded')
})

test('request_id 只追加一次', () => {
  assert.equal(withRequestId('boom', 'req-1'), 'boom [request_id: req-1]')
  assert.equal(withRequestId('boom [request_id: req-1]', 'req-1'), 'boom [request_id: req-1]')
  assert.equal(withRequestId('boom', ''), 'boom')
})
