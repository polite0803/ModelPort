import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isClientDisconnectError } from '../../src/main/proxy/clientAbort.ts'

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
