import { test } from 'node:test'
import assert from 'node:assert/strict'

const { bootstrapStore } = await import('../routes/harness.mjs')

test('代理监听地址 / HTTPS / SAN 主机真的写进 data.json，不只在内存里', async (t) => {
  const harness = await bootstrapStore({ initialData: { requestLogs: [] } })
  t.after(() => harness.dispose())
  const sm = harness.storeManager

  sm.updateConfig({
    proxyHost: '192.168.85.131',
    httpsEnabled: true,
    httpsPort: 8443,
    httpsSanHosts: ['192.168.85.131', 'gateway.lan'],
  })
  sm.flushPendingWrites()

  const onDisk = harness.dataFile()
  assert.equal(onDisk.config.proxyHost, '192.168.85.131')
  assert.equal(onDisk.config.httpsEnabled, true)
  assert.equal(onDisk.config.httpsPort, 8443)
  assert.deepEqual(onDisk.config.httpsSanHosts, ['192.168.85.131', 'gateway.lan'])

  // 读取侧也必须同形：升级重启后走的是这条路径。
  const readBack = sm.getConfig()
  assert.equal(readBack.proxyHost, '192.168.85.131')
  assert.equal(readBack.httpsEnabled, true)
  assert.equal(readBack.httpsPort, 8443)
  assert.deepEqual(readBack.httpsSanHosts, ['192.168.85.131', 'gateway.lan'])
})
