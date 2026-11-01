import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from 'selfsigned'

import { bootstrapStore, loadModule } from './harness.mjs'

/**
 * 这一层证明的是「配置打开 HTTPS 后，代理进程真的多起了一个 TLS 监听」，
 * 且它与原 HTTP 监听共用同一套 Koa 中间件/路由 —— 不是只读了配置字段。
 * 自签证书用临时 PEM 注入，不碰用户目录里的托管证书。
 */

const dir = mkdtempSync(join(tmpdir(), 'modelport-https-listener-'))
after(() => rmSync(dir, { recursive: true, force: true }))

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

function writeCert(): { certPath: string; keyPath: string; cert: string } {
  const pair = generate([{ name: 'commonName', value: 'ModelPort HTTPS Test' }], {
    days: 30,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  })
  const certPath = join(dir, 'server.crt')
  const keyPath = join(dir, 'server.key')
  writeFileSync(certPath, pair.cert, 'utf8')
  writeFileSync(keyPath, pair.private, 'utf8')
  return { certPath, keyPath, cert: pair.cert }
}

function getJson(url: string, ca?: string, servername?: string): Promise<{ status: number; body: unknown }> {
  const parsed = new URL(url)
  const doRequest = parsed.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = doRequest(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: `${parsed.pathname}${parsed.search}`,
        ca,
        servername,
        rejectUnauthorized: true,
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

test('HTTPS listener runs beside HTTP and serves the same Koa app', async () => {
  const httpPort = await freePort()
  const httpsPort = await freePort()
  const cert = writeCert()

  const store = await bootstrapStore({
    initialData: {
      config: {
        proxyPort: httpPort,
        proxyHost: '127.0.0.1',
        httpsEnabled: true,
        httpsPort,
        httpsCertPath: cert.certPath,
        httpsKeyPath: cert.keyPath,
      },
    },
  })

  const { proxyServer } = await loadModule('main/proxy/server.ts')
  try {
    assert.equal(await proxyServer.start(httpPort, '127.0.0.1'), true)

    const tls = proxyServer.getHttpsRuntimeStatus()
    assert.equal(tls.running, true, tls.error ?? 'HTTPS listener did not start')
    assert.equal(tls.port, httpsPort)

    const overHttp = await getJson(`http://127.0.0.1:${httpPort}/health`)
    assert.equal(overHttp.status, 200)
    assert.equal((overHttp.body as { status: string }).status, 'running')

    const overHttps = await getJson(`https://127.0.0.1:${httpsPort}/health`, cert.cert, 'localhost')
    assert.equal(overHttps.status, 200)
    assert.equal((overHttps.body as { status: string }).status, 'running')
  } finally {
    await proxyServer.stop()
    store.dispose()
  }
})
