/**
 * 上传导入：界面里选中的文件怎么进到跑网关的那台机器上。
 *
 * 证明层次：真 Koa 路由 + 真 storeManager + 真备份引擎（`stageBackupFile` / `applyBackup`）。
 * 这条路由的存在理由就是「导入不能退化成一句命令行」，所以最后一条用例真的把数据导进去，
 * 而不是只看它回一个 token。三种失败必须互不混用：没鉴权 / 没内容 / 超上限。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'

import { bootstrapStore, startProxy } from './harness.mjs'
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupBundle } from '../../src/shared/backup.ts'

const PORT = 18962
const SECRET = 'mgmt_upload_test_secret'

const harness = await bootstrapStore({
  initialData: {
    providers: [],
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

// `src/main/**` has to be imported *after* the harness registered its loader hooks: as a
// static import, `../runtime/host` inside the backup service resolves before the hooks exist
// and dies with ERR_MODULE_NOT_FOUND.
const { applyBackup, MAX_BACKUP_BYTES } = await import('../../src/main/backup/service.ts')
const { readCapped } = await import('../../src/main/proxy/routes/management/backup.ts')

// The RPC half of the flow needs the registry, exactly as both hosts populate it:
// `setIpcTransport(null)` keeps the Electron wire out of the test process.
const { setIpcTransport } = await import('../../src/main/ipc/registry.ts')
const { registerBackupHandlers } = await import('../../src/main/backup/ipc.ts')
setIpcTransport(null)
registerBackupHandlers()

after(async () => {
  await proxy.stop()
  harness.dispose()
})

function bundleWithProvider(): BackupBundle {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: '1.7.3',
    createdAt: '2026-11-06T02:00:00.000Z',
    platform: 'linux',
    scope: { includeStatistics: false, includeLogs: false },
    data: {
      // `replace` requires both tables to be present (`providers` and `config`); a bundle
      // missing one is a format error, not a partial import. The config carries this test's
      // own management surface on purpose: `restoreConfig` makes the backup's config win, so
      // an empty one would switch off the API the next test is calling.
      config: {
        proxyPort: PORT,
        proxyHost: '127.0.0.1',
        routes: {},
        managementApi: { enableManagementApi: true, managementApiSecret: SECRET },
      },
      providers: [
        {
          id: 'mp-upload-test',
          name: '上传导入验证',
          type: 'custom',
          authType: 'token',
          apiEndpoint: 'http://127.0.0.1:1/unused',
          headers: {},
          enabled: true,
        },
      ],
    },
  }
}

async function stage(body: BodyInit, secret = SECRET) {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/management/backup/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Management-Secret': secret },
    body,
  })
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as Record<string, any> | null,
  }
}

test('没口令就是 401，不是一次假装成功的导入', async () => {
  const { status } = await stage(JSON.stringify(bundleWithProvider()), '')
  assert.equal(status, 401)
})

test('空请求体是 invalid_request，不是 read-failed', async () => {
  const { status, body } = await stage(new Blob([]))
  assert.equal(status, 400)
  assert.equal(body!.error.code, 'invalid_request')
})

test('备份件被同一个引擎接收：token + 摘要，且临时文件不留在数据目录里', async () => {
  const { status, body } = await stage(JSON.stringify(bundleWithProvider()))
  assert.equal(status, 200)
  assert.equal(body!.success, true)
  const data = body!.data
  assert.equal(data.canceled, false)
  assert.equal(typeof data.token, 'string')
  assert.equal(data.encrypted, false)
  assert.equal(data.preview.counts.providers, 1)

  // The upload is staged into memory; a leftover copy would be every credential in the
  // backup sitting on disk after the operator closed the dialog.
  const leftovers = readdirSync(harness.storagePath).filter(name => name.startsWith('import.'))
  assert.deepEqual(leftovers, [])
})

test('别家的 JSON 由同一个解析器拒绝，不是路由自己造的判定', async () => {
  const { status, body } = await stage(JSON.stringify({ format: 'something-else', version: 1, data: {} }))
  assert.equal(status, 200)
  assert.equal(body!.data.error, 'wrong-format')
  assert.equal(body!.data.token, undefined)
})

test('导入真的把数据装进来（不是只回一个句柄）', async () => {
  const { body } = await stage(JSON.stringify(bundleWithProvider()))
  const applied = await applyBackup(body!.data.token, 'replace')
  assert.equal(applied.ok, true, JSON.stringify(applied))

  const providers = harness.storeManager.getStore()!.get('providers') as Array<{ id: string }>
  assert.ok(
    providers.some(provider => provider.id === 'mp-upload-test'),
    'the uploaded provider must be the one the gateway now serves',
  )
})

test('导入的后半段在网络面上可达：六条备份通道都在注册表里', async () => {
  // The accident this fences: `backup/ipc.ts` registered with `ipcMain.handle` instead of the
  // shared registry, so a headless host had no `backup:apply` at all. The upload returned 200
  // (and a 200 is never logged), and the operator was left with a bare 404 naming nothing.
  const listed = (await (
    await fetch(`http://127.0.0.1:${PORT}/v1/management/rpc/channels`, {
      headers: { 'X-Management-Secret': SECRET },
    })
  ).json()) as { data?: string[] }

  for (const channel of [
    'backup:export',
    'backup:pick',
    'backup:unlock',
    'backup:apply',
    'backup:cancel',
    'backup:restart',
  ]) {
    assert.ok((listed.data ?? []).includes(channel), `${channel} is not callable over RPC`)
  }

  const staged = await stage(JSON.stringify(bundleWithProvider()))
  const applied = await fetch(`http://127.0.0.1:${PORT}/v1/management/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Management-Secret': SECRET },
    body: JSON.stringify({ channel: 'backup:apply', args: [staged.body!.data.token, 'replace'] }),
  })
  assert.equal(applied.status, 200)
  const outcome = (await applied.json()) as { data?: { ok?: boolean }; error?: unknown }
  assert.equal(outcome.data?.ok, true, JSON.stringify(outcome))
})

test('超上限的流提前断开，不把整份读进内存', async () => {
  const chunk = Buffer.alloc(1024 * 1024, 0x61)
  let pulled = 0
  const source = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (pulled >= 8) return { done: true as const, value: undefined as never }
          pulled += 1
          return { done: false as const, value: chunk }
        },
      }
    },
  } as never

  assert.equal(await readCapped(source, 4 * 1024 * 1024), null)
  // Reading stopped at the cap rather than draining the stream.
  assert.equal(pulled, 5)
  // And the production cap is the one the engine already used for the dialog path.
  assert.ok(MAX_BACKUP_BYTES > 4 * 1024 * 1024)
})
