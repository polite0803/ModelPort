import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildFirstInstallRollbackScript,
  buildFirstInstallScript,
  buildSystemdUnit,
  parseInitHostHandshake,
  parseNodeMajor,
  parseShasums,
  parseWslDistros,
  planNodeProvision,
  systemdUsable,
  decodeWslOutput,
} from '../../src/shell/wslInstallPlan.ts'

test('the WSL distro table is decoded from UTF-16LE, not UTF-8', () => {
  // `wsl.exe -l -v` is UTF-16LE. Decoding it as UTF-8 yields NUL-separated garbage, and
  // the only symptom on a machine with three distros is "no distributions found".
  const text = '  NAME            STATE           VERSION\n* Ubuntu-24.04    Running         2\n  Debian          Stopped         2\n'
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  assert.equal(decodeWslOutput(utf16), text)
  assert.equal(decodeWslOutput(Buffer.from(text, 'utf16le')), text)
  assert.equal(decodeWslOutput(Buffer.from(text, 'utf8')), text)
})

test('the distro table parses names with spaces, the default marker and state', () => {
  const distros = parseWslDistros(
    '  NAME              STATE           VERSION\n* Ubuntu-24.04      Running         2\n  My Custom Distro  Stopped         1\n',
  )
  assert.deepEqual(distros, [
    { name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true },
    { name: 'My Custom Distro', state: 'Stopped', version: 1, isDefault: false },
  ])
})

test('node version parsing and the provisioning decision', () => {
  assert.equal(parseNodeMajor('v22.14.0\n'), 22)
  assert.equal(parseNodeMajor('garbage'), null)
  assert.equal(parseNodeMajor(''), null)

  assert.equal(planNodeProvision({ nodeMajor: null, arch: 'x64' }).needed, true)
  assert.equal(planNodeProvision({ nodeMajor: 18, arch: 'x64' }).needed, true, 'an old node is as unusable as none')
  assert.equal(planNodeProvision({ nodeMajor: 20, arch: 'arm64' }).needed, false)
  const plan = planNodeProvision({ nodeMajor: null, arch: 'arm64' })
  assert.match(plan.url, /node-v[\d.]+-linux-arm64\.tar\.xz$/)
  assert.match(plan.checksumsUrl, /SHASUMS256\.txt$/)
})

test('SHASUMS256 picks the file by basename and refuses an absent entry', () => {
  const text = [
    'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111  node-v22.14.0-linux-x64.tar.xz',
    'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222  node-v22.14.0-darwin-arm64.tar.gz',
  ].join('\n')
  assert.equal(
    parseShasums(text, 'node-v22.14.0-linux-x64.tar.xz'),
    'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
  )
  assert.equal(parseShasums(text, 'node-v22.14.0-linux-arm64.tar.xz'), null)
})

test('the unit and the install script point at the same paths', () => {
  const input = {
    tarballPath: '/mnt/c/Users/x/modelport-daemon-1.8.0-x64.tar.gz',
    nodeTarballPath: '/mnt/c/Users/x/node-v22.14.0-linux-x64.tar.xz',
    existingNodePath: null,
    installDir: '/opt/modelport',
    service: 'modelport',
    port: 8080,
  }
  const script = buildFirstInstallScript(input)
  const unit = buildSystemdUnit({
    nodePath: '/opt/modelport/node/bin/node',
    installDir: input.installDir,
    service: input.service,
  })
  assert.ok(script.includes(unit), 'the script must install exactly the unit this side describes')
  assert.match(unit, /ExecStart=\/opt\/modelport\/node\/bin\/node \/opt\/modelport\/modelport-daemon\.cjs/)
  assert.match(unit, /Environment=MODELPORT_RESOURCE_ROOT=\/opt\/modelport\/resources/)
  assert.match(unit, /Environment=MODELPORT_WEB_ROOT=\/opt\/modelport\/renderer/)
  assert.match(unit, /WantedBy=multi-user\.target/, 'system scope, not --user')
})

test('the script cannot be tricked into an installation it cannot verify', () => {
  const script = buildFirstInstallScript({
    tarballPath: '/tmp/daemon.tar.gz',
    nodeTarballPath: null,
    existingNodePath: '/usr/bin/node',
    installDir: '/opt/modelport',
    service: 'modelport',
    port: 8090,
  })
  assert.match(script, /\[ -f "\$SRC" \]/, 'a missing tarball is an error, not an empty install')
  assert.match(script, /worker\.mjs/, 'the channel pack is what makes the 13 channels work')
  assert.match(script, /set -eu/)
  assert.match(script, /--init-host --port "\$PORT"/)
  assert.match(script, /systemctl enable "\$SERVICE"/)
  // init-host writes the non-loopback bind; a restart *after* it is what makes it effective.
  const initAt = script.indexOf('--init-host')
  const restartAt = script.indexOf('systemctl restart')
  assert.ok(initAt > 0 && restartAt > initAt, 'restart must come after --init-host')
  // A provisioned node runtime lives inside INSTALL and must survive the file sync.
  assert.match(script, /! -name node -exec rm -rf/)
})

test('paths and service names are rejected rather than quoted into root scripts', () => {
  assert.throws(() => buildFirstInstallScript({
    tarballPath: 'relative.tar.gz',
    nodeTarballPath: null,
    existingNodePath: '/usr/bin/node',
    installDir: '/opt/modelport',
    service: 'modelport',
    port: 8080,
  }))
  assert.throws(() => buildFirstInstallScript({
    tarballPath: '/tmp/x.tar.gz',
    nodeTarballPath: null,
    existingNodePath: '/usr/bin/node',
    installDir: '/opt/modelport',
    service: 'modelport; rm -rf /',
    port: 8080,
  }))
  assert.throws(() => buildFirstInstallRollbackScript({ installDir: '/opt/modelport', service: 'a b' }))
})

test('rollback removes the install but not the gateway data', () => {
  const script = buildFirstInstallRollbackScript({ installDir: '/opt/modelport', service: 'modelport' })
  assert.match(script, /systemctl disable --now/)
  assert.match(script, /rm -rf "\$INSTALL"/)
  assert.ok(!script.includes('.modelport'), 'a failed install must not delete ~/.modelport')
})

test('the init handshake is read from the one machine line', () => {
  const output = [
    '[Init] gateway reachable from the host machine at http://127.0.0.1:8080/ui',
    '[Init]   API key     sk-mp-abc',
    'MODELPORT_HANDSHAKE {"port":8080,"secret":"mgmt_x","apiKey":"sk-mp-abc"}',
  ].join('\n')
  assert.deepEqual(parseInitHostHandshake(output), { port: 8080, secret: 'mgmt_x', apiKey: 'sk-mp-abc' })
  assert.equal(parseInitHostHandshake('no handshake here'), null)
  assert.equal(parseInitHostHandshake('MODELPORT_HANDSHAKE {"port":8080}'), null)
})

test('systemd usability accepts degraded but not "offline"', () => {
  assert.equal(systemdUsable('running\n'), true)
  assert.equal(systemdUsable('degraded\n'), true)
  assert.equal(systemdUsable('offline\n'), false)
  assert.equal(systemdUsable('System has not been booted with systemd\n'), false)
})

test('the daemon prints the handshake line --init-host promised', () => {
  // The console parses it; a wording change in the human block must not break install.
  const daemon = readFileSync('src/main/daemon/entry.ts', 'utf8')
  assert.match(daemon, /MODELPORT_HANDSHAKE \$\{JSON\.stringify/)
})
