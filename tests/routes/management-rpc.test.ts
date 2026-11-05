/**
 * `/v1/management/rpc` 的四态：命中、缺席、桌面专属、安装级拒绝。
 *
 * 证明层次：真 Koa 路由 + 真注册表 + 真宿主绑定。注册表里只放这条用例需要的
 * 三个 handler（不启整张 148 通道表，那会拉起渠道 Worker 与网络取版）。
 * 四种失败形态必须互不相同：把「没这个通道」和「这台主机没这个能力」混成一条文案，
 * 界面就只能显示一个笼统的「操作失败」，正是本仓反复禁止的那种歧义。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, startProxy } from './harness.mjs'
import { registerMainHandler, setIpcTransport } from '../../src/main/ipc/registry.ts'
import { IpcChannels } from '../../src/main/ipc/channels.ts'

const PORT = 18973
const SECRET = 'mgmt_rpc_test_secret'

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

// The bridge reads the same table the shell feeds over IPC, so a synthetic channel is
// enough to prove the dispatch - and `setIpcTransport(null)` keeps the Electron wire out.
setIpcTransport(null)
registerMainHandler('test:echo', (_event, value) => ({ echoed: value }))
registerMainHandler(IpcChannels.APP_MINIMIZE, async () => {
  const { requireDesktop } = await import('../../src/main/runtime/host.ts')
  requireDesktop('minimize').window('minimize')
})

const proxy = await startProxy(PORT)

after(async () => {
  await proxy.stop()
  setIpcTransport(null)
  harness.dispose()
})

async function rpc(channel: string, args: unknown[] = [], secret = SECRET) {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/management/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Management-Secret': secret },
    body: JSON.stringify({ channel, args }),
  })
  return { status: response.status, body: await response.json() as Record<string, any> }
}

test('命中的通道把 handler 的返回值原样带回', async () => {
  const { status, body } = await rpc('test:echo', ['hello'])
  assert.equal(status, 200)
  assert.deepEqual(body.data, { echoed: 'hello' })
})

test('没登记的通道是 unknown_channel，不是假装成功', async () => {
  const { status, body } = await rpc('nope:ghost')
  assert.equal(status, 404)
  assert.equal(body.error.code, 'unknown_channel')
})

test('桌面专属在无桌面宿主上是 desktop-only，并说明缺的是什么', async () => {
  const { status, body } = await rpc(IpcChannels.APP_MINIMIZE)
  assert.equal(status, 403)
  assert.equal(body.error.code, 'desktop-only')
  assert.match(body.error.message, /no window, tray or dialog/)
})

test('安装级动作根本不对外开放（与「有没有这个 handler」无关）', async () => {
  const { status, body } = await rpc(IpcChannels.APP_INSTALL_UPDATE)
  assert.equal(status, 403)
  assert.equal(body.error.code, 'not_exposed')
})

test('缺管理口令时到不了注册表', async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/management/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'test:echo', args: ['x'] }),
  })
  assert.equal(response.status, 401)
})

test('通道清单只含可调用项，安装级被排除在外', async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/management/rpc/channels`, {
    headers: { 'X-Management-Secret': SECRET },
  })
  const body = await response.json() as { data: string[] }
  assert.ok(body.data.includes('test:echo'), 'synthetic channel must be listed')
  assert.ok(!body.data.includes(IpcChannels.APP_INSTALL_UPDATE), 'install-level channel must not be listed')
})

// The desktop shell pushes into windows; a remote client must see the same events, and
// the producers all already call `getHost().push(...)`. This pins that the Node host
// turns those pushes into frames - without it the log list would silently stop moving.
registerMainHandler('test:notify', async () => {
  const { getHost } = await import('../../src/main/runtime/host.ts')
  getHost().push(IpcChannels.CONFIG_CHANGED, { marker: 'pushed-from-rpc' })
  return { pushed: true }
})

async function readFrames(reader: ReadableStreamDefaultReader<Uint8Array>, want: string, limit = 12) {
  const decoder = new TextDecoder()
  let buffer = ''
  for (let i = 0; i < limit; i++) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    if (buffer.includes(want)) return buffer
  }
  return buffer
}

test('push 的远端形态是 SSE 帧，且帧里就是宿主推的那份载荷', async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/management/events`, {
    headers: { 'X-Management-Secret': SECRET },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
  const reader = response.body!.getReader()

  const ready = await readFrames(reader, 'events:ready')
  assert.match(ready, /event: events:ready/, 'the stream announces itself before any data event')

  await rpc('test:notify')
  const frame = await readFrames(reader, 'pushed-from-rpc')
  assert.match(frame, new RegExp(`event: ${IpcChannels.CONFIG_CHANGED}`))
  assert.match(frame, /"marker":"pushed-from-rpc"/)

  reader.cancel()
})

test('事件流也要管理口令，缺口令连不上', async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/management/events`)
  assert.equal(response.status, 401)
})
