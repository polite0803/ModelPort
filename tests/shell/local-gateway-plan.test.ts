import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyLocalGateway, localGatewayArgs } from '../../src/shell/localGatewayPlan.ts'
import type { LocalGatewayStatus } from '../../src/shared/localGateway.ts'

const STATUS: LocalGatewayStatus = {
  version: '1.8.0',
  pid: 777,
  host: '127.0.0.1',
  port: 8099,
  startedAt: 1770000000000,
}

test('no status file is "not installed", not "stopped"', () => {
  // Only "not installed" may offer the one-click install; drawing the two the same is how
  // a repair button ends up reinstalling over a healthy gateway.
  const view = classifyLocalGateway({ status: null, pidAlive: false, healthOk: false })
  assert.equal(view.phase, 'not-installed')
  assert.equal(view.origin, null)
})

test('a status file whose process is gone is "stopped"', () => {
  const view = classifyLocalGateway({ status: STATUS, pidAlive: false, healthOk: false })
  assert.equal(view.phase, 'stopped')
  assert.equal(view.origin, 'http://127.0.0.1:8099')
  assert.equal(view.version, '1.8.0')
})

test('a live process that does not answer is "unreachable"', () => {
  const view = classifyLocalGateway({ status: STATUS, pidAlive: true, healthOk: false })
  assert.equal(view.phase, 'unreachable')
  assert.equal(view.origin, 'http://127.0.0.1:8099')
})

test('a live process that answers is "running"', () => {
  const view = classifyLocalGateway({ status: STATUS, pidAlive: true, healthOk: true })
  assert.equal(view.phase, 'running')
  assert.equal(view.origin, 'http://127.0.0.1:8099')
})

test('install and serve argv differ only by the init flags', () => {
  const serve = localGatewayArgs({
    mode: 'serve',
    statusFile: 'S',
    handshakeFile: 'H',
    appPath: null,
  })
  assert.deepEqual(serve, ['--gateway', '--status-file', 'S'])

  const init = localGatewayArgs({
    mode: 'init',
    statusFile: 'S',
    handshakeFile: 'H',
    appPath: null,
  })
  assert.deepEqual(init, ['--init-local', '--status-file', 'S', '--handshake-file', 'H'])
})

test('in development the app path precedes the role flags', () => {
  // `electron <appPath>` - without repeating the path the child would launch the default
  // Electron app instead of this product.
  const args = localGatewayArgs({
    mode: 'serve',
    statusFile: 'S',
    handshakeFile: 'H',
    appPath: 'C:/app',
  })
  assert.deepEqual(args, ['C:/app', '--gateway', '--status-file', 'S'])
})
