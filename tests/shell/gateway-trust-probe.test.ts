import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

test('the TLS trust probe asks the public health endpoint, not the keyed model list', () => {
  const trust = sourceOf('../../src/shell/gatewayTrust.ts')
  const body = trust.slice(trust.indexOf('export function defaultHandshakeProbe'), trust.indexOf('presentedLeaf(clientOrigin)'))

  assert.match(body, /new URL\('\/health', clientOrigin\)/)
  assert.doesNotMatch(body, /\/v1\/models/, 'a keyless /v1/models probe writes a 401 error row on every panel open')
})
