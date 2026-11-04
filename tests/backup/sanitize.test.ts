/**
 * 备份落库前的形状清洗（`main/backup/sanitize.ts`）。
 *
 * 备份文件是外部输入：可能是老版本写的、可能被手改过、可能被别的工具重排过。
 * 供应商与账号是**逐字段直读**的（界面读 `p.headers`、转发读 `a.credentials`），
 * 所以这里的选择是「整条丢弃并计数」而不是「尽量拼一个看起来能用的对象」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  sanitizeAccounts,
  sanitizeAppLogRows,
  sanitizeProviders,
  sanitizeRecord,
  sanitizeRequestLogRows,
} from '../../src/main/backup/sanitize.ts'

test('供应商：缺 id 的整条丢弃，其余必填标量补成安全缺省', () => {
  const result = sanitizeProviders([
    { name: '没有 id' },
    'not-an-object',
    { id: 'p1' },
  ])

  assert.equal(result.dropped, 2)
  assert.equal(result.items.length, 1)
  const [provider] = result.items
  assert.equal(provider.id, 'p1')
  assert.equal(provider.name, 'p1')
  assert.equal(provider.type, 'custom')
  assert.deepEqual(provider.headers, {})
  assert.equal(provider.enabled, true)
})

test('供应商：未知 type 收敛为 custom，合法的 aggregate 保持不变', () => {
  const result = sanitizeProviders([
    { id: 'a', type: 'nonsense' },
    { id: 'b', type: 'aggregate' },
  ])
  assert.equal(result.items[0].type, 'custom')
  assert.equal(result.items[1].type, 'aggregate')
})

test('账号：缺 providerId 丢弃，凭据里非字符串的值被剔除', () => {
  const result = sanitizeAccounts([
    { id: 'a1', credentials: { apiKey: 'sk-x' } },
    { id: 'a2', providerId: 'p1', credentials: { apiKey: 'sk-y' } },
    { id: 'a3', providerId: 'p1', credentials: { apiKey: 'sk-z', nested: { bad: true }, count: 3 } },
  ])

  assert.equal(result.dropped, 1)
  assert.deepEqual(
    result.items.map((account) => account.id),
    ['a2', 'a3'],
  )
  // 明文在这里原样保留：加密是调用方（备份服务）落库前的事，本模块不碰 safeStorage。
  assert.deepEqual(result.items[1].credentials, { apiKey: 'sk-z' })
  assert.equal(result.items[1].status, 'active')
})

test('账号：非法 status 收敛为 active', () => {
  const result = sanitizeAccounts([{ id: 'a', providerId: 'p', status: 'weird' }])
  assert.equal(result.items[0].status, 'active')
})

test('记录块：非对象一律换成空表，不让 undefined 流进 store', () => {
  assert.deepEqual(sanitizeRecord(undefined), {})
  assert.deepEqual(sanitizeRecord(['a']), {})
  assert.deepEqual(sanitizeRecord({ keep: 1 }), { keep: 1 })
})

test('日志行：缺 id / timestamp / level / message 的行被丢弃', () => {
  const requestRows = sanitizeRequestLogRows([
    { id: 'r1', timestamp: 1 },
    { id: 'r2' },
    { timestamp: 2 },
    'x',
  ])
  assert.deepEqual(requestRows.map((row) => row.id), ['r1'])

  const appRows = sanitizeAppLogRows([
    { timestamp: 1, level: 'info', message: 'ok' },
    { timestamp: 1, level: 'info' },
  ])
  assert.equal(appRows.length, 1)
})
