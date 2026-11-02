/**
 * 回环请求头的会话标识透传（纯函数，不起服务）。
 *
 * `/v1/responses` 与 `/v1/messages` 把客户端会话标识经这两条头交给 `/v1/chat/completions`，
 * 粘性才有一段跨协议的稳定键。这里钉「给了就带、没给就不带」——带出一个空值头会让
 * chat 侧把空串当标识使，不带则整段会话退回内容指纹。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { loopbackRequestHeaders } from '../../src/main/proxy/utils/inboundLoopback.ts'

test('给了会话标识就带上两条头，值与来源标签逐字一致', () => {
  const headers = loopbackRequestHeaders({ sessionId: 'sess-1', sessionSource: 'prompt_cache_key' })
  assert.equal(headers['X-ModelPort-Session-Id'], 'sess-1')
  assert.equal(headers['X-ModelPort-Session-Source'], 'prompt_cache_key')
})

test('没给会话标识时两条头都不出现（不写空值头）', () => {
  const withBlank = loopbackRequestHeaders({ sessionId: '  ', sessionSource: '' })
  assert.ok(!('X-ModelPort-Session-Id' in withBlank))
  assert.ok(!('X-ModelPort-Session-Source' in withBlank))
  const none = loopbackRequestHeaders({})
  assert.ok(!('X-ModelPort-Session-Id' in none))
})

test('会话标识里的非 ASCII 过 toHeaderValue，不会把一个成功请求变成 ERR_INVALID_CHAR 500', () => {
  const headers = loopbackRequestHeaders({ sessionId: '会话-1' })
  assert.equal(headers['X-ModelPort-Session-Id'], encodeURIComponent('会话-1'))
})
