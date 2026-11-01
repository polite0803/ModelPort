import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'

// 托管证书落在 `homedir()/.modelport/tls`，而 `homedir()` 在模块导入时就被读成常量。
// 所以必须**先改环境变量再动态 import**，否则用例会往开发者机器的真实数据目录里写证书。
const dataDir = mkdtempSync(join(tmpdir(), 'modelport-tls-managed-'))
process.env.USERPROFILE = dataDir
process.env.HOME = dataDir
const { loadTlsMaterial, sha1Thumbprint } = await import('../../src/main/proxy/tls.ts')

after(() => rmSync(dataDir, { recursive: true, force: true }))

const MANAGED_DIR = join(dataDir, '.modelport', 'tls')

test('managed certificate carries the configured IP next to the loopback defaults', () => {
  const material = loadTlsMaterial({ httpsSanHosts: ['192.168.1.20'] })
  const x509 = new X509Certificate(material.cert)

  assert.equal(material.source, 'managed')
  assert.equal(material.certPath, join(MANAGED_DIR, 'server.crt'))
  assert.equal(x509.checkIP('192.168.1.20'), '192.168.1.20')
  assert.equal(x509.checkHost('localhost'), 'localhost')
  assert.equal(x509.checkIP('127.0.0.1'), '127.0.0.1')
  assert.equal(x509.checkIP('::1'), '::1')
  // 信任探测与移除都按这个形状比对指纹；格式一变就会「永远查不到」而不是报错。
  assert.match(sha1Thumbprint(material.cert), /^[0-9A-F]{40}$/)
})

test('an added address reissues the certificate instead of reusing the old one', () => {
  const first = new X509Certificate(loadTlsMaterial({ httpsSanHosts: ['10.0.0.8'] }).cert)
  const second = new X509Certificate(loadTlsMaterial({ httpsSanHosts: ['10.0.0.8', '10.0.0.9'] }).cert)

  assert.equal(first.checkIP('10.0.0.9'), undefined)
  assert.equal(second.checkIP('10.0.0.8'), '10.0.0.8')
  assert.equal(second.checkIP('10.0.0.9'), '10.0.0.9')
  assert.notEqual(first.fingerprint256, second.fingerprint256)

  // 名单没变时不该每次启动都重签：指纹必须稳定，否则已装好的信任会被无故作废。
  const again = new X509Certificate(loadTlsMaterial({ httpsSanHosts: ['10.0.0.9', '10.0.0.8'] }).cert)
  assert.equal(again.fingerprint256, second.fingerprint256)
})

test('junk in the address list falls back to the loopback defaults', () => {
  const material = loadTlsMaterial({ httpsSanHosts: ['https://10.0.0.1', 'not an ip', ''] })
  const x509 = new X509Certificate(material.cert)

  assert.equal(x509.checkIP('10.0.0.1'), undefined)
  assert.equal(x509.checkHost('localhost'), 'localhost')
})
