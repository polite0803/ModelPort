import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Silent re-adoption after a restore/rebuild rotated the gateway secret: only hosts the
 * console manages have a trusted channel, and it is always a sanctioned handoff (handshake
 * file / idempotent --init-host), never a read of the gateway's data.json. Remote gateways
 * keep the fail-closed form.
 */
import { buildWslInitHostCommand, refreshChannelFor } from '../../src/shell/secretRefreshPlan.ts'

test('local 网关走握手文件通道', () => {
  assert.equal(refreshChannelFor({ kind: 'local' }), 'local-handshake')
})

test('壳安装并管理的 WSL 网关走 init-host 通道', () => {
  assert.equal(refreshChannelFor({ kind: 'wsl', manageWsl: true }), 'wsl-init-host')
})

test('WSL 条目但未托管：不静默重读', () => {
  assert.equal(refreshChannelFor({ kind: 'wsl' }), null)
  assert.equal(refreshChannelFor({ kind: 'wsl', manageWsl: false }), null)
})

test('remote 网关没有可信通道：保持询问', () => {
  assert.equal(refreshChannelFor({ kind: 'remote' }), null)
})

test('没有条目：不重读', () => {
  assert.equal(refreshChannelFor(null), null)
})

test('init-host 命令用单元里的 node 与 bundle，且是幂等重握手', () => {
  const command = buildWslInitHostCommand({ installDir: '/opt/modelport/', nodePath: '/usr/bin/node' })
  assert.deepEqual(command, ['/usr/bin/node', '/opt/modelport/modelport-daemon.cjs', '--init-host'])
})

test('没有独立 node 路径时直接执行 bundle', () => {
  const command = buildWslInitHostCommand({ installDir: '/opt/modelport', nodePath: null })
  assert.deepEqual(command, ['/opt/modelport/modelport-daemon.cjs', '--init-host'])
})

test('重握手命令不引用网关数据文件（壳保持客户端身份）', () => {
  const command = buildWslInitHostCommand({ installDir: '/opt/modelport', nodePath: '/usr/bin/node' })
  assert.ok(!command.join(' ').includes('.modelport/data.json'))
  assert.ok(!command.join(' ').includes('grep'))
})