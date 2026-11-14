import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  dockerArchFromNodeArch,
  dockerDaemonAssetName,
  dockerUpdateCapability,
  recreateConfig,
  selfContainerId,
  swapHelperEnv,
  type ContainerInspect,
} from '../../src/main/gateway/dockerUpdatePlan.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('capability keeps the three absences distinct', () => {
  assert.equal(dockerUpdateCapability({ inDocker: false, socketPresent: false, socketAccessible: false }), 'not-docker')
  assert.equal(dockerUpdateCapability({ inDocker: true, socketPresent: false, socketAccessible: false }), 'no-socket')
  assert.equal(dockerUpdateCapability({ inDocker: true, socketPresent: true, socketAccessible: false }), 'socket-denied')
  assert.equal(dockerUpdateCapability({ inDocker: true, socketPresent: true, socketAccessible: true }), 'ok')
  // not-docker wins even if a socket happens to exist (a desktop with docker installed).
  assert.equal(dockerUpdateCapability({ inDocker: false, socketPresent: true, socketAccessible: true }), 'not-docker')
})

test('docker asset name matches the release workflow shape', () => {
  assert.equal(dockerDaemonAssetName('1.8.15', 'x64'), 'modelport-daemon-1.8.15-docker-x64.tar.gz')
  assert.equal(dockerDaemonAssetName('1.8.15', 'arm64'), 'modelport-daemon-1.8.15-docker-arm64.tar.gz')
})

test('arch mapping refuses anything it cannot name an asset for', () => {
  assert.equal(dockerArchFromNodeArch('x64'), 'x64')
  assert.equal(dockerArchFromNodeArch('arm64'), 'arm64')
  assert.equal(dockerArchFromNodeArch('ia32'), null)
  assert.equal(dockerArchFromNodeArch('riscv64'), null)
})

test('selfContainerId reads cgroup v1, falls back to hostname, refuses custom names', () => {
  const id = 'a'.repeat(64)
  assert.equal(selfContainerId(`12:devices:/docker/${id}\n`, 'whatever'), id)
  assert.equal(selfContainerId(`0::/system.slice/docker-${id}.scope\n`, 'whatever'), id)
  // cgroup v2 often shows only 0::/ - the short-id hostname is the fallback.
  assert.equal(selfContainerId('0::/\n', 'abcdef123456'), 'abcdef123456')
  assert.equal(selfContainerId('0::/\n', id), id)
  // A custom hostname is not a container id: refuse rather than guess.
  assert.equal(selfContainerId('0::/\n', 'modelport'), null)
  assert.equal(selfContainerId('', ''), null)
})

const inspect: ContainerInspect = {
  Name: '/modelport',
  Config: { Image: 'modelport-daemon:1.8.14', Env: ['HOME=/data', 'PATH=/usr/bin'] },
  HostConfig: {
    Binds: ['modelport-data:/data', '/var/run/docker.sock:/var/run/docker.sock'],
    PortBindings: { '8080/tcp': [{ HostIp: '', HostPort: '18080' }] },
    RestartPolicy: { Name: 'unless-stopped' },
    NetworkMode: 'bridge',
    GroupAdd: ['999'],
  },
}

test('recreateConfig copies the deployment identity, not the old image', () => {
  const body = recreateConfig(inspect, 'modelport-daemon:1.8.15')
  assert.equal(body.Image, 'modelport-daemon:1.8.15')
  assert.deepEqual(body.Env, ['HOME=/data', 'PATH=/usr/bin'])
  assert.deepEqual(body.HostConfig.Binds, inspect.HostConfig.Binds)
  assert.deepEqual(body.HostConfig.PortBindings, inspect.HostConfig.PortBindings)
  assert.deepEqual(body.HostConfig.RestartPolicy, { Name: 'unless-stopped' })
  assert.equal(body.HostConfig.NetworkMode, 'bridge')
  // Dropping GroupAdd would revoke docker.sock access and break the next update.
  assert.deepEqual(body.HostConfig.GroupAdd, ['999'])
})

test('recreateConfig defaults missing host config instead of dropping it', () => {
  const bare: ContainerInspect = { Name: '/x', Config: { Image: 'old' }, HostConfig: {} }
  const body = recreateConfig(bare, 'new')
  assert.deepEqual(body.Env, [])
  assert.deepEqual(body.HostConfig.Binds, [])
  assert.deepEqual(body.HostConfig.PortBindings, {})
  assert.deepEqual(body.HostConfig.RestartPolicy, { Name: 'no' })
  assert.equal(body.HostConfig.NetworkMode, 'bridge')
  assert.deepEqual(body.HostConfig.GroupAdd, [])
})

test('swapHelperEnv carries every knob the helper reads', () => {
  const env = swapHelperEnv({
    oldName: 'modelport-prev',
    newName: 'modelport',
    port: 18080,
    scheme: 'http',
    probeHost: '',
    timeoutMs: 60000,
    graceMs: 3000,
  })
  assert.deepEqual(env, [
    'MP_OLD=modelport-prev',
    'MP_NEW=modelport',
    'MP_PORT=18080',
    'MP_SCHEME=http',
    'MP_PROBE_HOST=',
    'MP_TIMEOUT_MS=60000',
    'MP_GRACE_MS=3000',
  ])
})

test('the swap helper is syntactically valid CJS', () => {
  execFileSync(process.execPath, ['--check', join(root, 'docker', 'update-swap.cjs')], { stdio: 'pipe' })
})

test('the helper ships in the image and the staged tree', () => {
  const dockerfile = readFileSync(join(root, 'docker', 'Dockerfile'), 'utf8')
  assert.match(dockerfile, /COPY update-swap\.cjs/)
  const buildDaemon = readFileSync(join(root, 'scripts', 'build-daemon.mjs'), 'utf8')
  assert.match(buildDaemon, /update-swap\.cjs/)
  const buildDocker = readFileSync(join(root, 'scripts', 'build-docker.mjs'), 'utf8')
  assert.match(buildDocker, /'update-swap\.cjs'/)
})

test('the three gateway update channels are registered and exposed over RPC', () => {
  const channels = readFileSync(join(root, 'src', 'main', 'ipc', 'channels.ts'), 'utf8')
  for (const name of ['GATEWAY_CHECK_UPDATE', 'GATEWAY_APPLY_UPDATE', 'GATEWAY_UPDATE_STATUS']) {
    assert.ok(channels.includes(name), `${name} missing from channels.ts`)
  }
  const handlers = readFileSync(join(root, 'src', 'main', 'ipc', 'handlers.ts'), 'utf8')
  for (const name of ['GATEWAY_CHECK_UPDATE', 'GATEWAY_APPLY_UPDATE', 'GATEWAY_UPDATE_STATUS']) {
    assert.ok(handlers.includes(`IpcChannels.${name}`), `${name} handler not registered`)
  }
  // They must NOT be in the install-level exclusion list: the whole point is that a
  // browser operator can trigger them.
  const rpc = readFileSync(join(root, 'src', 'main', 'proxy', 'routes', 'management', 'rpc.ts'), 'utf8')
  const notExposed = rpc.slice(rpc.indexOf('NOT_EXPOSED'), rpc.indexOf('function fail'))
  assert.ok(!notExposed.includes('GATEWAY_'), 'gateway update channels must stay RPC-exposed')
})