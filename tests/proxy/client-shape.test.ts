/**
 * 聚合线出站的「客户端形状」头（`utils/clientShape.ts`）。
 *
 * 背景：聚合线出站此前从不带 User-Agent，线上是 axios 的缺省值（`axios/<ver>`），
 * 与「客户端直连」的形状完全不同。修法是把入站客户端自己发来的 UA 原样转发。
 * 这里锁住转发口径：只转发真实值、净化控制字符、截断超长、没发就不发。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { clientShapeHeaders } from '../../src/main/proxy/utils/clientShape.ts'

test('客户端 UA 原样转发（键为小写 user-agent）', () => {
  assert.deepEqual(
    clientShapeHeaders('claude-cli/2.1.4 (external, cli)'),
    { 'user-agent': 'claude-cli/2.1.4 (external, cli)' },
  )
})

test('数组取第一个值（Koa 头类型可能是 string[]）', () => {
  assert.deepEqual(
    clientShapeHeaders(['codex_cli_rs/0.9.0', 'evil']),
    { 'user-agent': 'codex_cli_rs/0.9.0' },
  )
})

test('控制字符被剥掉（CRLF 注入面）', () => {
  assert.deepEqual(
    clientShapeHeaders('trae/1.0\r\nX-Evil: 1'),
    { 'user-agent': 'trae/1.0X-Evil: 1' },
  )
})

test('超长 UA 截断到 256', () => {
  const out = clientShapeHeaders('x'.repeat(400))
  assert.equal(out['user-agent']?.length, 256)
})

test('客户端没发 UA（空串/纯空白/undefined）就不发——不伪造', () => {
  assert.deepEqual(clientShapeHeaders(undefined), {})
  assert.deepEqual(clientShapeHeaders(''), {})
  assert.deepEqual(clientShapeHeaders('   '), {})
  assert.deepEqual(clientShapeHeaders([]), {})
})

test('控制字符剥干净后为空同样不发', () => {
  assert.deepEqual(clientShapeHeaders('\u0000\u001f'), {})
})
