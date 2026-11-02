/**
 * 客户端会话标识的取值口径（纯函数，无 store、无 electron）。
 *
 * 粘性按会话而不是按内容，前提是**取到的是会话粒度的标识**。这里钉三件事：优先级
 * 顺序、更粗的标识不会被误收、以及「客户端没给」时返回 undefined（调用方回落到
 * 内容指纹，与旧行为逐字一致）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { clientSessionKey } from '../../src/shared/clientSessionKey.ts'

test('按 prompt_cache_key → user → metadata.user_id → session_id 头的顺序取第一个非空', () => {
  assert.deepEqual(
    clientSessionKey({ body: { prompt_cache_key: 'cache-1', user: 'user-1' } }),
    { value: 'cache-1', source: 'prompt_cache_key' }
  )
  assert.deepEqual(
    clientSessionKey({ body: { user: 'user-1', metadata: { user_id: 'meta-1' } } }),
    { value: 'user-1', source: 'user' }
  )
  assert.deepEqual(
    clientSessionKey({ body: { metadata: { user_id: 'meta-1' } } }),
    { value: 'meta-1', source: 'metadata_user_id' }
  )
  assert.deepEqual(
    clientSessionKey({ body: {}, headers: { session_id: 'sess-1' } }),
    { value: 'sess-1', source: 'session_id_header' }
  )
})

test('空白 / 非字符串 / 数组形态的值都不算标识：宁可回落到内容指纹', () => {
  assert.equal(clientSessionKey({ body: { prompt_cache_key: '   ', user: '' } }), undefined)
  assert.equal(clientSessionKey({ body: { user: 42, metadata: { user_id: {} } } }), undefined)
  assert.equal(clientSessionKey({ body: [], headers: { session_id: [] } }), undefined)
  assert.equal(clientSessionKey({}), undefined)
})

test('只收会话粒度的标识：比会话更粗的字段（installation-id / window-id）不参与', () => {
  assert.deepEqual(
    clientSessionKey({
      body: { installation_id: 'install-1' },
      headers: { 'x-claude-code-session-id': 'window-1', 'session-id': 'sess-2' }
    }),
    { value: 'sess-2', source: 'session_id_header' }
  )
})

test('头名下划线与连字符两种拼法都认（带下划线的头会被中间代理丢掉），值两侧空白被去掉', () => {
  assert.deepEqual(
    clientSessionKey({ body: {}, headers: { 'session-id': '  sess-3  ' } }),
    { value: 'sess-3', source: 'session_id_header' }
  )
  assert.deepEqual(
    clientSessionKey({ body: {}, headers: { session_id: 'sess-4' } }),
    { value: 'sess-4', source: 'session_id_header' }
  )
})

// 入向协议那条链上 chat 侧拿到的是回环头，不是原始 body：`/v1/responses` 已经解析过
// 一次。这里钉「头优先」，两处判断才会漂向同一份而不是各说各话。
test('回环头压过 body：入向协议解析过一次的结果不再重算', () => {
  assert.deepEqual(
    clientSessionKey({
      body: { prompt_cache_key: 'body-value-not-used' },
      headers: {
        'x-modelport-session-id': 'inbound-value',
        'x-modelport-session-source': 'prompt_cache_key'
      }
    }),
    { value: 'inbound-value', source: 'prompt_cache_key' }
  )
})

// 回环头是外部可伪造的：来源标签只接受已知值，认不出的降级成「头来的」，
// 免得伪造一个 `prompt_cache_key` 标签就冒充 body 字段的来源。
test('来源标签只认已知值，空白 / 伪造标签都降级为 session_id_header', () => {
  assert.deepEqual(
    clientSessionKey({ headers: { 'x-modelport-session-id': 'x-1', 'x-modelport-session-source': 'user_id_from_metadata' } }),
    { value: 'x-1', source: 'session_id_header' }
  )
  assert.deepEqual(
    clientSessionKey({ headers: { 'x-modelport-session-id': 'x-2' } }),
    { value: 'x-2', source: 'session_id_header' }
  )
})

test('回环头只有空白值时不算标识：继续按 body 的优先级取', () => {
  assert.deepEqual(
    clientSessionKey({ body: { user: 'user-2' }, headers: { 'x-modelport-session-id': '   ' } }),
    { value: 'user-2', source: 'user' }
  )
})
