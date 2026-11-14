import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  changeGatewayTrust,
  gatewayTrustStatus,
  type HandshakeProbe,
  type ProbeOutcome,
  type TrustTarget,
} from '../../src/shell/gatewayTrust.ts'
import { sha1Thumbprint, type TrustRuntime } from '../../src/shared/certificateTrust.ts'
import { generateParseablePair } from '../fixtures/selfsigned.ts'

/**
 * Trust follows the certificate the CLIENT handshakes with on the entry's access path:
 * a domain behind a proxy presents a public edge cert (nothing to install), the same
 * gateway reached by IP presents its self-signed cert (offer it), and a reissued cert
 * whose thumbprint differs from the installed one must surface as "not trusted" again.
 * The probe and the OS store are injected; no real handshake or store is touched.
 */

function selfSignedPem(commonName: string): string {
  return generateParseablePair([{ name: 'commonName', value: commonName }], { days: 365, keySize: 2048 }).cert
}

function fakeProbe(outcome: ProbeOutcome, leaf: string | null): HandshakeProbe {
  return {
    handshake: async () => outcome,
    presentedLeaf: async () => leaf,
  }
}

/** A win32-shaped store: the powershell probe answers 1 only for thumbprints it holds. */
function fakeRuntime(store: string[] = []): { runtime: TrustRuntime; calls: Array<{ file: string; args: string[] }> } {
  const calls: Array<{ file: string; args: string[] }> = []
  const runtime: TrustRuntime = {
    platform: 'win32',
    home: tmpdir(),
    run: async (file, args) => {
      calls.push({ file, args })
      if (file === 'powershell.exe') {
        const command = args[args.length - 1] ?? ''
        return { ok: true, output: store.some(thumbprint => command.includes(thumbprint)) ? '1' : '0' }
      }
      if (file === 'certutil') return { ok: true, output: 'CertUtil: -addstore command completed successfully.' }
      return { ok: false, output: `unexpected command ${file}` }
    },
  }
  return { runtime, calls }
}

let seq = 0
function target(overrides: Partial<TrustTarget> = {}): TrustTarget {
  seq += 1
  const dir = mkdtempSync(join(tmpdir(), `mp-trust-${seq}-`))
  return {
    origin: `https://gw-${seq}.example.test`,
    clientOrigin: `https://gw-${seq}.example.test`,
    cachePath: join(dir, 'gateway-ca.pem'),
    captured: null,
    ...overrides,
  }
}

test('a public-cert path (domain behind a proxy) is trusted with nothing to install', async () => {
  const { runtime, calls } = fakeRuntime()
  const t = target({ origin: 'https://modelport.bgnone.cn', clientOrigin: 'https://modelport.bgnone.cn' })
  const probe = fakeProbe('trusted', null)

  const status = await gatewayTrustStatus(t, runtime, probe)
  assert.equal(status.trusted, true)
  assert.equal(status.certPath, null, 'no PEM to offer means no install button')
  assert.equal(status.error, undefined)

  const result = await changeGatewayTrust(t, 'install', runtime, probe)
  assert.equal(result.ok, true)
  assert.equal(result.trusted, true)
  assert.equal(result.certPath, null)
  assert.equal(calls.length, 0, 'a successful handshake must not touch the trust store')
})

test('a refused self-signed handshake offers exactly the certificate the path presents', async () => {
  const pem = selfSignedPem('ModelPort')
  const { runtime, calls } = fakeRuntime()
  const t = target({ origin: 'https://192.168.0.235:8443', clientOrigin: 'https://192.168.0.235:8443' })
  const probe = fakeProbe({ certError: 'net::ERR_CERT_AUTHORITY_INVALID' }, pem)

  const status = await gatewayTrustStatus(t, runtime, probe)
  assert.equal(status.trusted, false)
  assert.equal(status.source, 'handshake')
  assert.equal(status.sha1, sha1Thumbprint(pem))
  assert.ok(status.certPath, 'the refused cert must land on disk for the install button')
  assert.match(status.error ?? '', /握手被拒/)

  const result = await changeGatewayTrust(t, 'install', runtime, probe)
  assert.equal(result.ok, true)
  const install = calls.find(call => call.file === 'certutil')
  assert.ok(install, 'install runs the shared certutil command')
  assert.deepEqual(install.args.slice(0, 3), ['-user', '-addstore', 'Root'])
  assert.equal(install.args[3], status.certPath)
})

test('a reissued cert whose thumbprint differs from the installed one reads untrusted again', async () => {
  const oldPem = selfSignedPem('ModelPort')
  const newPem = selfSignedPem('ModelPort')
  assert.notEqual(sha1Thumbprint(oldPem), sha1Thumbprint(newPem))
  // The store holds the OLD cert; the path now presents the new one.
  const { runtime } = fakeRuntime([sha1Thumbprint(oldPem)])
  const t = target()
  const probe = fakeProbe({ certError: 'net::ERR_CERT_AUTHORITY_INVALID' }, newPem)

  const status = await gatewayTrustStatus(t, runtime, probe)
  assert.equal(status.trusted, false, 'the installed thumbprint is not the presented one')
  assert.equal(status.sha1, sha1Thumbprint(newPem), 'the panel shows what the client sees now, prompting a reinstall')
})

test('an entry with no client https path says so instead of guessing the gateway CA', async () => {
  const { runtime, calls } = fakeRuntime()
  const t = target({ origin: 'http://192.168.0.235:18080', clientOrigin: null })
  const probe = fakeProbe('trusted', null)

  const status = await gatewayTrustStatus(t, runtime, probe)
  assert.equal(status.trusted, null)
  assert.match(status.error ?? '', /客户端 HTTPS 地址/)

  const result = await changeGatewayTrust(t, 'install', runtime, probe)
  assert.equal(result.ok, false)
  assert.equal(calls.length, 0)
})

test('the captured handshake cert remains the bootstrap when the leaf read fails', async () => {
  const pem = selfSignedPem('ModelPort')
  const { runtime } = fakeRuntime()
  const t = target({ captured: pem })
  const probe = fakeProbe({ unreachable: 'net::ERR_CONNECTION_TIMED_OUT' }, null)

  const status = await gatewayTrustStatus(t, runtime, probe)
  assert.equal(status.trusted, false)
  assert.equal(status.source, 'handshake')
  assert.equal(status.sha1, sha1Thumbprint(pem), 'the window-captured copy is the fallback evidence')
})