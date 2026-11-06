import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateLocalManagementSecret, planLocalInit } from '../../src/main/gateway/localInit.ts'
import {
  localGatewayOrigin,
  parseLocalGatewayHandshake,
  parseLocalGatewayStatus,
  serializeLocalGatewayHandshake,
  serializeLocalGatewayStatus,
  type LocalGatewayStatus,
} from '../../src/shared/localGateway.ts'

const STATUS: LocalGatewayStatus = {
  version: '1.8.0',
  pid: 4242,
  host: '127.0.0.1',
  port: 8080,
  startedAt: 1770000000000,
}

test('first run enables the management API and generates a secret', () => {
  const plan = planLocalInit({}, () => 'mgmt_test_secret')
  assert.equal(plan.generated, true)
  assert.equal(plan.secret, 'mgmt_test_secret')
  assert.deepEqual(plan.updates.managementApi, {
    enableManagementApi: true,
    managementApiSecret: 'mgmt_test_secret',
  })
})

test('an existing secret is kept and the switch is turned on', () => {
  const plan = planLocalInit(
    { managementApi: { enableManagementApi: false, managementApiSecret: 'mgmt_existing' } },
    () => 'mgmt_new',
  )
  assert.equal(plan.generated, false)
  assert.equal(plan.secret, 'mgmt_existing')
  assert.equal(plan.updates.managementApi.enableManagementApi, true)
})

test('the local plan never rewrites the bind address', () => {
  // An install that already serves LAN clients must not be narrowed to loopback by an
  // upgrade; a fresh install already defaults to 127.0.0.1.
  const plan = planLocalInit({})
  assert.deepEqual(Object.keys(plan.updates), ['managementApi'])
})

test('a blank secret counts as absent', () => {
  const plan = planLocalInit({ managementApi: { managementApiSecret: '   ' } }, () => 'mgmt_fresh')
  assert.equal(plan.secret, 'mgmt_fresh')
  assert.equal(plan.generated, true)
})

test('the generated secret is long enough to be a credential', () => {
  assert.ok(generateLocalManagementSecret().length >= 32)
})

test('the status file round-trips and carries no secret', () => {
  const text = serializeLocalGatewayStatus(STATUS)
  assert.deepEqual(parseLocalGatewayStatus(text), STATUS)
  assert.ok(!text.includes('secret'), 'the status file is not where the secret lives')
})

test('a malformed status reads as unknown, never as defaults', () => {
  for (const text of [
    '',
    'not json',
    '{}',
    JSON.stringify({ ...STATUS, port: 0 }),
    JSON.stringify({ ...STATUS, port: 70000 }),
    JSON.stringify({ ...STATUS, pid: -1 }),
    JSON.stringify({ ...STATUS, pid: 1.5 }),
    JSON.stringify({ ...STATUS, host: '' }),
    JSON.stringify({ ...STATUS, version: '  ' }),
    JSON.stringify({ ...STATUS, startedAt: 'yesterday' }),
  ]) {
    assert.equal(parseLocalGatewayStatus(text), null, `must reject: ${text}`)
  }
})

test('the handshake round-trips and requires a secret', () => {
  assert.deepEqual(parseLocalGatewayHandshake(serializeLocalGatewayHandshake({ secret: 'mgmt_once' })), {
    secret: 'mgmt_once',
  })
  assert.equal(parseLocalGatewayHandshake(serializeLocalGatewayHandshake({ secret: '' })), null)
  assert.equal(parseLocalGatewayHandshake('{"apiKey":"sk-mp-x"}'), null)
})

test('the local origin is always loopback, whatever the bind address says', () => {
  // The console runs on the same machine; a gateway bound to 0.0.0.0 is still reached at
  // 127.0.0.1, and a status file claiming another host must not redirect the window.
  assert.equal(localGatewayOrigin({ port: 8080 }), 'http://127.0.0.1:8080')
})
