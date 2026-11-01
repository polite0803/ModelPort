import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from 'selfsigned'
import { X509Certificate } from 'node:crypto'
import { createServer, request } from 'node:https'

import { loadTlsMaterial } from '../../src/main/proxy/tls.ts'

const dir = mkdtempSync(join(tmpdir(), 'modelport-tls-'))
after(() => rmSync(dir, { recursive: true, force: true }))

function writePair(name: string): { certPath: string; keyPath: string } {
  const pair = generate([{ name: 'commonName', value: 'ModelPort Test' }], {
    days: 30,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] },
    ],
  })
  const certPath = join(dir, `${name}.crt`)
  const keyPath = join(dir, `${name}.key`)
  writeFileSync(certPath, pair.cert, 'utf8')
  writeFileSync(keyPath, pair.private, 'utf8')
  return { certPath, keyPath }
}

test('custom PEM pair is loaded with its SAN and self-signed marker', () => {
  const { certPath, keyPath } = writePair('good')
  const material = loadTlsMaterial({ httpsCertPath: certPath, httpsKeyPath: keyPath })

  assert.equal(material.source, 'custom')
  assert.equal(material.selfSigned, true)
  assert.match(material.subject, /ModelPort Test/)
  assert.match(material.subjectAltName ?? '', /localhost/)
  assert.match(material.subjectAltName ?? '', /127\.0\.0\.1/)
  assert.equal(material.certPath, certPath)
  assert.equal(material.keyPath, keyPath)
  assert.ok(material.key.includes('PRIVATE KEY'))
  assert.equal(new X509Certificate(material.cert).fingerprint256, material.fingerprint256)
})

test('a key from another pair is rejected', () => {
  const first = writePair('first')
  const second = writePair('second')

  assert.throws(
    () => loadTlsMaterial({ httpsCertPath: first.certPath, httpsKeyPath: second.keyPath }),
    /does not match/,
  )
})

test('missing files and half a pair fail with readable messages', () => {
  const { certPath } = writePair('partial')

  assert.throws(
    () => loadTlsMaterial({ httpsCertPath: certPath, httpsKeyPath: join(dir, 'absent.key') }),
    /Private key file not found/,
  )
  assert.throws(
    () => loadTlsMaterial({ httpsCertPath: join(dir, 'absent.crt'), httpsKeyPath: join(dir, 'absent.key') }),
    /Certificate file not found/,
  )
  assert.throws(
    () => loadTlsMaterial({ httpsCertPath: certPath }),
    /must be provided together/,
  )
})

test('the loaded material serves TLS under the localhost name', async () => {
  const { certPath, keyPath } = writePair('serving')
  const material = loadTlsMaterial({ httpsCertPath: certPath, httpsKeyPath: keyPath })

  const server = createServer({ key: material.key, cert: material.cert }, (_req, res) => {
    res.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  try {
    const body = await new Promise<string>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/',
          ca: material.cert,
          servername: 'localhost',
        },
        (res) => {
          let data = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => resolve(data))
        },
      )
      req.on('error', reject)
      req.end()
    })
    assert.equal(body, 'ok')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
