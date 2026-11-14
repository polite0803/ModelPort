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
  exposedPortsFor,
  recreateConfig,
  selfContainerId,
  swapHelperBody,
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
  Image: 'sha256:runningimageid',
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
  // The published port must be exposed even though the source Config has no ExposedPorts.
  assert.deepEqual(body.ExposedPorts, { '8080/tcp': {} })
})

test('exposedPortsFor unions source ports with every PortBindings key', () => {
  assert.deepEqual(
    exposedPortsFor({ '8080/tcp': {} }, { '18080/tcp': [{ HostPort: '18080' }] }),
    { '8080/tcp': {}, '18080/tcp': {} },
  )
  assert.deepEqual(exposedPortsFor(undefined, {}), {})
  // An existing exposed entry is preserved as-is, not overwritten.
  const marker = { '18080/tcp': { keep: true } }
  assert.equal(exposedPortsFor(marker, { '18080/tcp': [{}] })['18080/tcp'], marker['18080/tcp'])
})

test('recreateConfig exposes a published port the image does not EXPOSE', () => {
  // The real bug: the deployment publishes 18080 but the image only EXPOSEs 8080/8443.
  // The Docker API silently drops a PortBindings entry whose port is not in ExposedPorts,
  // so a recreate that copies PortBindings alone loses the host binding (container runs,
  // bridge IP answers, host port dead). Every bound port must end up exposed.
  const deployed: ContainerInspect = {
    ...inspect,
    Config: { ...inspect.Config, ExposedPorts: { '8080/tcp': {}, '8443/tcp': {} } },
    HostConfig: {
      ...inspect.HostConfig,
      PortBindings: {
        '18080/tcp': [{ HostIp: '', HostPort: '18080' }],
        '8443/tcp': [{ HostIp: '', HostPort: '8443' }],
      },
    },
  }
  const body = recreateConfig(deployed, 'modelport-daemon:1.8.15')
  assert.ok(body.ExposedPorts['18080/tcp'], 'published 18080 must be exposed though the image does not EXPOSE it')
  assert.ok(body.ExposedPorts['8443/tcp'], 'published 8443 stays exposed')
  assert.ok(body.ExposedPorts['8080/tcp'], 'source ExposedPorts are preserved')
})

test('recreateConfig defaults missing host config instead of dropping it', () => {
  const bare: ContainerInspect = { Name: '/x', Image: 'sha256:bare', Config: { Image: 'old' }, HostConfig: {} }
  const body = recreateConfig(bare, 'new')
  assert.deepEqual(body.Env, [])
  assert.deepEqual(body.HostConfig.Binds, [])
  assert.deepEqual(body.HostConfig.PortBindings, {})
  assert.deepEqual(body.HostConfig.RestartPolicy, { Name: 'no' })
  assert.equal(body.HostConfig.NetworkMode, 'bridge')
  assert.deepEqual(body.HostConfig.GroupAdd, [])
  assert.deepEqual(body.ExposedPorts, {})
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

test('the swap helper runs from the running image id, never the target tag', () => {
  const body = swapHelperBody({
    selfImageId: inspect.Image,
    env: swapHelperEnv({ oldName: 'modelport-prev', newName: 'modelport', port: 18080, scheme: 'http', probeHost: '', timeoutMs: 60000, graceMs: 3000 }),
    socketPath: '/var/run/docker.sock',
    socketGid: '123',
    networkMode: 'bridge',
  })
  // The target tag may predate this feature (no update-swap.cjs) or be retagged over
  // the running image by a same-tag load; only the stable running id is safe.
  assert.equal(body.Image, 'sha256:runningimageid')
  assert.notEqual(body.Image, 'modelport-daemon:1.8.15')
  assert.notEqual(body.Image, inspect.Config.Image)
  assert.deepEqual(body.Entrypoint, ['node', '/app/update-swap.cjs'])
  assert.deepEqual(body.Cmd, [])
  assert.equal(body.HostConfig.AutoRemove, false)
  assert.deepEqual(body.HostConfig.Binds, ['/var/run/docker.sock:/var/run/docker.sock'])
  assert.deepEqual(body.HostConfig.GroupAdd, ['123'])
  assert.equal(body.HostConfig.NetworkMode, 'bridge')
})

test('the swap helper is syntactically valid CJS', () => {
  execFileSync(process.execPath, ['--check', join(root, 'docker', 'update-swap.cjs')], { stdio: 'pipe' })
})

test('the swap helper verifies the host port actually bound, not just the bridge IP', () => {
  const helper = readFileSync(join(root, 'docker', 'update-swap.cjs'), 'utf8')
  // The host binding was silently dropped because the recreate copied PortBindings but
  // not ExposedPorts: the API ignores a published port the image does not EXPOSE. The
  // helper's recreate must preserve ExposedPorts, and must confirm the port really bound
  // via the authoritative NetworkSettings.Ports (not the PortBindings request).
  assert.match(helper, /ExposedPorts/, 'helper recreate must preserve ExposedPorts or the API drops the published port')
  assert.match(helper, /NetworkSettings\.Ports/, 'must inspect actual bound ports, not the PortBindings request')
  assert.match(helper, /ensurePublished/, 'must gate success on the host port being published')
  assert.match(helper, /recreateNew/, 'must re-create (not merely restart) to re-allocate the port')
  // The docker-proxy lingers seconds after `docker stop`/`rm` returns; starting the new
  // container too soon fails with "port is already allocated". The helper must actively
  // wait for the host port to refuse connections before starting the new container.
  assert.match(helper, /waitForPortFree/, 'must wait for the host port to be free before starting new')
  assert.match(helper, /tcpOpen/, 'must probe the host port via TCP to detect docker-proxy release')
  // Rollback re-creates the old container under the NEW name and starts that name;
  // starting OLD after it was removed 404s and leaves the gateway down.
  assert.doesNotMatch(helper, /encodeURIComponent\(OLD\)\}\/start/, 'rollback must start the new name, not the removed old name')
})

test('the helper container is created under its documented name', () => {
  const orchestrator = readFileSync(join(root, 'src', 'main', 'gateway', 'dockerUpdate.ts'), 'utf8')
  // Without ?name= Docker assigns a random name: `docker logs modelport-update-swap`
  // then 404s and removeContainerIfExists(HELPER_NAME) never cleans the prior helper.
  assert.match(
    orchestrator,
    /containers\/create\?name=\$\{encodeURIComponent\(HELPER_NAME\)\}/,
    'helper create must pin HELPER_NAME so logs and cleanup resolve',
  )
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