import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isClientDisconnectError } from '../../src/main/proxy/clientAbort.ts'
import { readStreamOutcome } from '../../src/main/proxy/utils/streamOutcome.ts'

test('客户端断开的 socket 错误被识别，真实服务端错误不被误判', () => {
  assert.equal(isClientDisconnectError(Object.assign(new Error('write ECONNRESET'), { code: 'ECONNRESET' })), true)
  assert.equal(isClientDisconnectError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })), true)
  assert.equal(
    isClientDisconnectError(Object.assign(new Error('premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })),
    true,
  )

  assert.equal(isClientDisconnectError(new Error('boom')), false)
  assert.equal(isClientDisconnectError(Object.assign(new Error('read ECONNRESET'), { code: 'EACCES' })), false)
  assert.equal(isClientDisconnectError(undefined), false)
})

// 直接调用生产判据（`utils/streamOutcome.ts`）：客户端断开时写进请求日志的那几个
// 字段就是它算出来的，用一份手写副本测等于测副本。
test('流式响应收集器能正确提取 finish_reason', () => {
  // 只有正文，没有结束帧
  const noEnd = [
    'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
  ].join('')
  assert.deepStrictEqual(readStreamOutcome(noEnd), { finishReason: undefined, sawFinish: false })

  // 有 finish_reason=stop 但没有 [DONE]
  const withStop = [
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  ].join('')
  // `sawFinish` 看的是「上游宣布过结束」而不是 `[DONE]`：补发的 `[DONE]` 不算。
  assert.deepStrictEqual(readStreamOutcome(withStop), { finishReason: 'stop', sawFinish: true })

  // 完整流：正文 + 结束原因+[DONE]
  const complete = [
    'data: {"choices":[{"delta":{"content":"complete"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  assert.deepStrictEqual(readStreamOutcome(complete), { finishReason: 'tool_calls', sawFinish: true })
})
