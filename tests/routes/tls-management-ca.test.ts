import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateParseablePair } from '../fixtures/selfsigned.ts'

import { bootstrapStore, loadModule } from './harness.mjs'

/**
 * 远程机器上的 Node 系客户端不读系统信任库，它要的是证书本身，加上「我的握手有没有被拒」这条读数。
 * 这里走真 HTTP 与真 TLS：管理端点返回的就是监听器实际出示的那张 PEM，握手被拒真的进了账。
 *
 * `storeManager` 是单例，所以整个文件只播种一次、只起一次代理。
 */

const dir = mkdtempSync(join(tmpdir(), 'modelport-tls-mgmt-'))
after(() => rmSync(dir, { recursive: true, force: true }))

function writePair(name: string, commonName: string): { certPath: string; keyPath: string } {
  const pair = generateParseablePair([{ name: 'commonName', value: commonName }], {
    days: 30,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }],
      },
    ],
  })
  const certPath = join(dir, `${name}.crt`)
  const keyPath = join(dir, `${name}.key`)
  writeFileSync(certPath, pair.cert, 'utf8')
  writeFileSync(keyPath, pair.private, 'utf8')
  return { certPath, keyPath }
}

const presented = writePair('presented', 'ModelPort TLS Management Test')
const foreign = writePair('foreign', 'ModelPort Foreign CA')
const MANAGEMENT_SECRET = 'mgmt-tls-test-secret'

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

function httpJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  const parsed = new URL(url)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: `${parsed.pathname}${parsed.search}`,
        headers,
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** 一次拿另一张证书当信任根的 TLS 尝试：应当被客户端自己拒掉。 */
function rejectedHandshake(port: number, ca: string): Promise<string> {
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        ca,
        servername: 'localhost',
        rejectUnauthorized: true,
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(`succeeded with status ${res.statusCode}`))
      },
    )
    req.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message))
    req.end()
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return predicate()
}

test('a remote Node client can fetch the CA and see its own refused handshakes', async () => {
  const httpPort = await freePort()
  const httpsPort = await freePort()
  const store = await bootstrapStore({
    initialData: {
      config: {
        proxyPort: httpPort,
        proxyHost: '127.0.0.1',
        httpsEnabled: true,
        httpsPort,
        httpsCertPath: presented.certPath,
        httpsKeyPath: presented.keyPath,
        managementApi: {
          enableManagementApi: true,
          managementApiSecret: MANAGEMENT_SECRET,
        },
      },
    },
  })
  const { proxyServer } = await loadModule('main/proxy/server.ts')

  try {
    assert.equal(await proxyServer.start(httpPort, '127.0.0.1'), true)
    const before = proxyServer.getHttpsRuntimeStatus()
    assert.equal(before.running, true, before.error ?? 'HTTPS listener did not start')
    assert.equal(before.handshakes?.total, 0, 'counting must begin at the listener start')

    // 1. 端点在管理 Key 后面：匿名与错 Key 都不给证书。
    const anonymous = await httpJson(`http://127.0.0.1:${httpPort}/v1/management/tls/ca`, {})
    assert.equal(anonymous.status, 401)
    assert.equal(anonymous.body.error.code, 'missing_authentication')
    const wrongSecret = await httpJson(`http://127.0.0.1:${httpPort}/v1/management/tls/ca`, {
      'X-Management-Secret': 'mgmt-not-mine',
    })
    assert.equal(wrongSecret.status, 401)

    // 2. 带 Key 取到的就是监听器出示的那张，逐字一致且不带私钥。
    const ca = await httpJson(`http://127.0.0.1:${httpPort}/v1/management/tls/ca`, {
      'X-Management-Secret': MANAGEMENT_SECRET,
    })
    assert.equal(ca.status, 200)
    assert.equal(ca.body.success, true)
    assert.equal(ca.body.data.certPath, presented.certPath)
    assert.equal(ca.body.data.source, 'custom')
    assert.equal(ca.body.data.selfSigned, true)
    assert.equal(ca.body.data.pem, readFileSync(presented.certPath, 'utf8'))
    assert.doesNotMatch(ca.body.data.pem, /PRIVATE KEY/)
    assert.equal(ca.body.data.keyPath, undefined)

    // 3. 客户端拒掉证书 ⇒ 计数与分类。
    const clientOutcome = await rejectedHandshake(httpsPort, readFileSync(foreign.certPath, 'utf8'))
    assert.doesNotMatch(clientOutcome, /succeeded with status/, `handshake unexpectedly passed: ${clientOutcome}`)
    assert.equal(
      await waitFor(() => (proxyServer.getHttpsRuntimeStatus().handshakes?.total ?? 0) >= 1),
      true,
      'the refused handshake never reached the counter',
    )

    const stats = proxyServer.getHttpsRuntimeStatus().handshakes
    assert.ok(stats)
    assert.ok(stats.byCode.length >= 1)
    // 服务端只收到 ECONNRESET 这一族：客户端的 DEPTH_ZERO_SELF_SIGNED_CERT 不会传过来，
    // 所以分类必须是「这个码不证明证书问题」，否则界面和日志就在替我们编造结论。
    assert.equal(
      stats.byCode.every((entry) => entry.certificate === false),
      true,
      `expected no certificate-naming code server-side, got ${JSON.stringify(stats.byCode)}`,
    )
    assert.ok(stats.sinceAt <= (stats.lastAt ?? 0))

    // 4. 状态端点把同一个读数交给远程排障的人。
    const status = await httpJson(`http://127.0.0.1:${httpPort}/v1/management/tls/status`, {
      'X-Management-Secret': MANAGEMENT_SECRET,
    })
    assert.equal(status.status, 200)
    assert.equal(status.body.data.handshakeRejections.total, stats.total)
    assert.equal(status.body.data.certificate.source, 'custom')

    // 5. 应用日志那一行点名变量与文件，界面上那句「网络错误」才有解释。
    assert.equal(
      await waitFor(() =>
        store.storeManager
          .getLogs({ level: 'warn' })
          .some((entry: { message: string }) => entry.message.includes('NODE_EXTRA_CA_CERTS')),
      ),
      true,
      'no app-log row explains the refused handshake',
    )
    const explanation = store.storeManager
      .getLogs({ level: 'warn' })
      .find((entry: { message: string }) => entry.message.includes('NODE_EXTRA_CA_CERTS'))
    assert.ok(explanation, 'the explaining row disappeared between the poll and the read')
    assert.match(explanation.message, /HTTPS handshake aborted before any request/)
    assert.doesNotMatch(explanation.message, /This code names a certificate problem/)

    // 6. 停服后计数作废：不留一个「还在拒」的假读数。
    await proxyServer.stop()
    assert.equal(proxyServer.getHttpsRuntimeStatus().handshakes, null)
    assert.equal(proxyServer.getHttpsRuntimeStatus().running, false)
  } finally {
    // 断言中途失败时也要停掉真监听器，否则测试进程被 keep-alive 拖住（实测会挂住整轮）。
    try {
      const { proxyServer } = await loadModule('main/proxy/server.ts')
      await proxyServer.stop()
    } catch {
      // 收尾失败不改变结论
    }
    store.dispose()
  }
})
