/**
 * 无头导出：没有对话框的宿主上，备份内容经管理面原样返回，由浏览器下载。
 *
 * 证明层次：真 Koa RPC 路由 + 真 storeManager + 真导出引擎（采集/封装）。
 * 这条路径的存在理由是「导出不能退化成一句 desktop-only」，所以用例真的把返回
 * 内容喂回同一个解析器与解封函数，而不是只看它回了一个字符串。
 * 三种状态必须互不混用：没鉴权 / 没声明 payload 仍报宿主事实 / payload 返回。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'

import { bootstrapStore, startProxy } from './harness.mjs'
import { BACKUP_FORMAT, parseBackupDocument } from '../../src/shared/backup.ts'

const PORT = 18963
const SECRET = 'mgmt_export_test_secret'

const harness = await bootstrapStore({
  initialData: {
    providers: [
      {
        id: 'mp-export-test',
        name: '无头导出验证',
        type: 'custom',
        authType: 'token',
        apiEndpoint: 'http://127.0.0.1:1/unused',
        headers: {},
        enabled: true,
      },
    ],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: {
      proxyPort: PORT,
      proxyHost: '127.0.0.1',
      routes: {},
      managementApi: { enableManagementApi: true, managementApiSecret: SECRET },
    },
  },
})

const proxy = await startProxy(PORT)

// RPC 半段需要注册表，与两个真实宿主的装配方式一致；setIpcTransport(null) 把
// Electron wire 挡在测试进程外。
const { setIpcTransport } = await import('../../src/main/ipc/registry.ts')
const { registerBackupHandlers } = await import('../../src/main/backup/ipc.ts')
setIpcTransport(null)
registerBackupHandlers()

// 导出的渠道快照会顺手拉起渠道包 worker；不收掉它，测试进程在用例结束后
// 仍被 worker 挂着不退（node --test 等事件排空）。
const { accountChannelManager } = await import('../../src/main/providers/accountChannels/manager.ts')

after(async () => {
  await accountChannelManager.shutdown()
  await proxy.stop()
  harness.dispose()
})

async function rpc(args: unknown[], secret = SECRET) {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/management/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Management-Secret': secret },
    body: JSON.stringify({ channel: 'backup:export', args }),
  })
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as Record<string, any> | null,
  }
}

test('没口令就是 401，不是一次导出', async () => {
  const { status } = await rpc([{ delivery: 'payload' }], '')
  assert.equal(status, 401)
})

test('不声明 payload 时无头宿主仍报 desktop-only，不是假装成功', async () => {
  const { status, body } = await rpc([{}])
  assert.equal(status, 403)
  assert.equal(body!.success, false)
  assert.equal(body!.error.code, 'desktop-only')
})

test('payload 模式回同一解析器可解析的明文备份，且不写盘', async () => {
  const before = readdirSync(harness.storagePath).filter(name => name.startsWith('modelport-backup'))
  const { status, body } = await rpc([{ delivery: 'payload' }])
  assert.equal(status, 200)
  assert.equal(body!.success, true)
  const data = body!.data
  assert.equal(data.canceled, false)
  assert.equal(data.encrypted, false)
  assert.equal(data.filePath, undefined)
  assert.match(data.fileName, /^modelport-backup-.+\.json$/)
  assert.equal(data.bytes, Buffer.byteLength(data.payload, 'utf8'))

  const parsed = parseBackupDocument(data.payload)
  assert.equal(parsed.kind, 'bundle')
  if (parsed.kind !== 'bundle') return
  assert.equal(parsed.bundle.format, BACKUP_FORMAT)
  assert.equal(parsed.bundle.scope.includeStatistics, true)
  assert.equal(parsed.bundle.scope.includeLogs, false)
  const providers = parsed.bundle.data.providers as Array<{ id: string }>
  assert.ok(providers.some(provider => provider.id === 'mp-export-test'))
  assert.equal(data.preview.counts.providers, providers.length)

  const after = readdirSync(harness.storagePath).filter(name => name.startsWith('modelport-backup'))
  assert.deepEqual(after, before)
})

test('口令封装态走同一封装：正确口令解开、错误口令解不开', async () => {
  const { body } = await rpc([{ delivery: 'payload', password: 'export-test-password' }])
  const data = body!.data
  assert.equal(data.encrypted, true)
  const parsed = parseBackupDocument(data.payload)
  assert.equal(parsed.kind, 'sealed')
  if (parsed.kind !== 'sealed') return

  const { openSealedBackup } = await import('../../src/main/backup/crypto.ts')
  const plaintext = openSealedBackup(parsed.file, 'export-test-password')
  assert.equal(typeof plaintext, 'string')
  const inner = parseBackupDocument(plaintext!)
  assert.equal(inner.kind, 'bundle')
  assert.equal(openSealedBackup(parsed.file, 'wrong-password'), null)
})