import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generate } from 'selfsigned'
import {
  installCertificateTrust,
  isCertificateTrusted,
  sha1Thumbprint,
  uninstallCertificateTrust,
  type TrustCommandResult,
  type TrustRuntime,
} from '../../src/shared/certificateTrust.ts'

/**
 * The trust commands run on two different machines now (the gateway host and the console),
 * so the only thing that may differ between them is *which* machine writes its store - the
 * arguments must be identical. That makes the argument shapes worth pinning on their own,
 * with the OS call injected: this file never touches a real certificate store.
 *
 * The Windows removal is the failure this fence was born from: `certutil -delstore` exits 0
 * on a serial that matches nothing and deletes the first entry of the store anyway, so any
 * regression back to it must be caught here rather than on a user's machine.
 */

const cert = generate([{ name: 'commonName', value: 'ModelPort Test' }], {
  days: 1,
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [{ name: 'basicConstraints', cA: true }],
}).cert

const material = { cert, certPath: '/tmp/modelport-trust-test/server.crt' }
const thumbprint = sha1Thumbprint(cert)

interface Fake {
  runtime: TrustRuntime
  calls: string[][]
}

function fakeRuntime(options: {
  platform: string
  home?: string
  respond?: (file: string, args: string[]) => TrustCommandResult
}): Fake {
  const calls: string[][] = []
  return {
    calls,
    runtime: {
      platform: options.platform,
      home: options.home ?? '/home/tester',
      async run(file: string, args: string[]): Promise<TrustCommandResult> {
        calls.push([file, ...args])
        return options.respond?.(file, args) ?? { ok: true, output: '' }
      },
    },
  }
}

test('the thumbprint is the exact shape both the probe and the removal compare against', () => {
  assert.match(thumbprint, /^[0-9A-F]{40}$/)
})

test('the Windows probe asks the current user root store for that thumbprint and reads the count', async () => {
  for (const [output, expected] of [['1', true], ['0', false]] as const) {
    const host = fakeRuntime({ platform: 'win32', respond: () => ({ ok: true, output }) })
    assert.equal(await isCertificateTrusted(material, host.runtime), expected)
    assert.equal(host.calls.length, 1)
    const [file, ...args] = host.calls[0]
    assert.equal(file, 'powershell.exe')
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
    assert.match(args[3], /Cert:\\CurrentUser\\Root/)
    assert.ok(args[3].includes(thumbprint), 'a lower-case or colon-separated thumbprint matches nothing in that store')
  }

  const broken = fakeRuntime({ platform: 'win32', respond: () => ({ ok: false, output: 'boom' }) })
  assert.equal(await isCertificateTrusted(material, broken.runtime), null, 'a failed probe is unknown, not false')
})

test('macOS probes with security verify-cert against the file on this disk', async () => {
  const host = fakeRuntime({ platform: 'darwin', respond: () => ({ ok: true, output: '' }) })
  assert.equal(await isCertificateTrusted(material, host.runtime), true)
  assert.deepEqual(host.calls[0], ['security', 'verify-cert', '-c', material.certPath, '-p', 'ssl'])
})

test('Linux has no cheap probe and returns null without calling anything', async () => {
  const host = fakeRuntime({ platform: 'linux' })
  assert.equal(await isCertificateTrusted(material, host.runtime), null)
  assert.deepEqual(host.calls, [])
})

test('installing writes the current user root store and re-reads the trust it claims', async () => {
  const host = fakeRuntime({
    platform: 'win32',
    respond: (file) => (file === 'certutil' ? { ok: true, output: 'Cert Add Success' } : { ok: true, output: '1' }),
  })
  const result = await installCertificateTrust(material, host.runtime)
  assert.equal(result.ok, true)
  assert.equal(result.trusted, true)
  assert.deepEqual(host.calls[0], ['certutil', '-user', '-addstore', 'Root', material.certPath])
  assert.equal(host.calls.length, 2, 'the claim must be backed by a fresh probe, not by the exit code')
})

test('a failed install reports the tool output instead of a generic error', async () => {
  const host = fakeRuntime({
    platform: 'win32',
    respond: () => ({ ok: false, output: 'Access is denied.' }),
  })
  const result = await installCertificateTrust(material, host.runtime)
  assert.equal(result.ok, false)
  assert.equal(result.trusted, false)
  assert.match(result.message, /Access is denied\./)
})

test('macOS install targets the login keychain of the injected home, not the machine store', async () => {
  const host = fakeRuntime({ platform: 'darwin' })
  await installCertificateTrust(material, host.runtime)
  assert.deepEqual(host.calls[0].slice(0, 4), ['security', 'add-trusted-cert', '-r', 'trustRoot'])
  assert.equal(host.calls[0][4], '-k')
  assert.equal(host.calls[0][5], 'login.keychain')
})

test('removing on Windows filters on the exact SHA-1 and never uses certutil -delstore', async () => {
  const host = fakeRuntime({ platform: 'win32', respond: () => ({ ok: true, output: 'NOT-INSTALLED' }) })
  const result = await uninstallCertificateTrust(material, host.runtime)
  assert.equal(result.ok, true)
  assert.equal(result.trusted, false)
  const command = host.calls[0][4]
  assert.match(command, new RegExp(thumbprint))
  assert.match(command, /NOT-INSTALLED/)
  assert.ok(
    !host.calls.some(call => call.includes('-delstore')),
    'certutil -delstore deletes the first store entry when the serial matches nothing',
  )

  const removed = fakeRuntime({ platform: 'win32', respond: () => ({ ok: true, output: 'REMOVED=1' }) })
  const second = await uninstallCertificateTrust(material, removed.runtime)
  assert.equal(second.ok, true)
  assert.match(second.message, /REMOVED=1/)
  assert.equal(second.trusted, false, 'the post-removal probe is what decides trusted')
  assert.equal(removed.calls.length, 2)
})

test('macOS removal deletes by SHA-1 thumbprint from the login keychain', async () => {
  const host = fakeRuntime({ platform: 'darwin' })
  const result = await uninstallCertificateTrust(material, host.runtime)
  assert.equal(result.ok, true)
  assert.deepEqual(host.calls[0], ['security', 'delete-certificate', '-Z', thumbprint, 'login.keychain'])
})

test('Linux install and removal hand over the commands instead of claiming success', async () => {
  const host = fakeRuntime({ platform: 'linux' })
  const installed = await installCertificateTrust(material, host.runtime)
  assert.equal(installed.ok, false)
  assert.equal(installed.trusted, null)
  assert.match(installed.message, /trust anchor --store/)
  assert.ok(installed.message.includes(material.certPath), 'the message must name the file on this machine')

  const removed = await uninstallCertificateTrust(material, host.runtime)
  assert.equal(removed.ok, false)
  assert.match(removed.message, /trust anchor --remove/)
  assert.deepEqual(host.calls, [], 'nothing is run without sudo, and the app never escalates')
})
