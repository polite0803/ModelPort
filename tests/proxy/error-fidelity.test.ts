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

/**
 * 渠道包的机读码必须走到客户端。旧路径只搬 message/status，宿主拿到的 details.code
 * 永远是 undefined —— 于是「模型额度用完 / 全部账号在限流」只能以 502 中文散文出现，
 * 客户端读成服务端故障，对同一个模型反复重试，而包的原话恰恰是「可改用其它模型」。
 */
test('渠道包的额度/限流码：翻译成客户端契约并按 429 交出去', () => {
  const quota = mapForwardFailure({
    status: 502,
    details: {
      message: 'Raccoon (商汤)：模型 sn-x 的可用账号均在限流中，最近一个将于 20:00 解禁（无需重新登录）。',
      code: 'QUOTA_EXCEEDED',
    },
    retryAfter: '600',
  })
  assert.equal(quota.status, 429, '包在发请求前判定的限流不是服务端故障')
  assert.equal(quota.type, 'rate_limit_error')
  assert.equal(quota.code, 'insufficient_quota')
  assert.equal(quota.retryAfter, '600', '解禁时刻必须随 429 一起交给客户端')

  const rate = mapForwardFailure({
    status: 502,
    details: { message: 'raccoon: 您的模型请求频率超限，请稍后重试', code: 'RATE_LIMIT' },
  })
  assert.equal(rate.status, 429)
  assert.equal(rate.code, 'rate_limit_exceeded')

  // 上游真给的 4xx 保持原状态与类型：403 额度耗尽仍然是权限问题，不被上调。
  const upstream403 = mapForwardFailure({
    status: 403,
    details: { message: 'quota exhausted', code: 'QUOTA_EXCEEDED' },
  })
  assert.equal(upstream403.status, 403)
  assert.equal(upstream403.type, 'permission_error')
  assert.equal(upstream403.code, 'insufficient_quota')
})

test('图片内容审核 400 原样透传：上游 code 与原文不得被改写成别的信号', () => {
  // 2026-11-07 实测（bailian_token_plan/deepseek-v4.1-flash，6 笔）：
  // 上游对请求里的图片做了内容审核并拒收。这是**供应商策略判定**，不是网关故障、
  // 也不是账号故障 —— 客户端要能读到它自己的 code 与原文，否则用户只会看到一句
  // 「网关异常」，既改不了请求也不知道该换模型。自动换一家等于替客户端绕过上游审核，
  // 所以这里既不改写、也不作为换家理由。
  const message = 'An error occurred in model serving, error message is: '
    + '[Input image [0] data may contain inappropriate content.]'
  const mapped = mapForwardFailure({
    status: 400,
    details: { message, type: 'invalid_request_error', code: 'data_inspection_failed' },
  })
  assert.equal(mapped.status, 400)
  assert.equal(mapped.type, 'invalid_request_error')
  assert.equal(mapped.code, 'data_inspection_failed')
  assert.equal(mapped.message, message)
})

test('request_id 只追加一次', () => {
  assert.equal(withRequestId('boom', 'req-1'), 'boom [request_id: req-1]')
  assert.equal(withRequestId('boom [request_id: req-1]', 'req-1'), 'boom [request_id: req-1]')
  assert.equal(withRequestId('boom', ''), 'boom')
})
