import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildGatewayRows,
  buildSnapshot,
  GATEWAY_ACTION_LABELS,
  type GatewayListEntry,
} from '../../src/shell/gatewayListPlan.ts'

function entry(overrides: Partial<GatewayListEntry> = {}): GatewayListEntry {
  return {
    id: 'g1',
    name: '本机网关',
    url: 'http://127.0.0.1:8080',
    kind: 'local',
    active: false,
    ...overrides,
  }
}

function actionsOf(row: ReturnType<typeof buildGatewayRows>[number]): string[] {
  return [...row.actions].sort()
}

test('a running local gateway offers stop and repair, never install', () => {
  const [row] = buildGatewayRows([entry()], { g1: { phase: 'running', version: '1.7.6' } })
  assert.equal(row.phase, 'running')
  assert.equal(row.version, '1.7.6')
  assert.deepEqual(actionsOf(row), ['connect', 'edit', 'remove', 'repair', 'stop', 'upgrade'])
})

test('a stopped local gateway offers start instead of stop', () => {
  const [row] = buildGatewayRows([entry()], { g1: { phase: 'stopped', version: '1.7.6' } })
  assert.deepEqual(actionsOf(row), ['connect', 'edit', 'remove', 'repair', 'start', 'upgrade'])
})

test('a never-provisioned machine offers install, not start', () => {
  const [row] = buildGatewayRows([entry()], { g1: { phase: 'not-installed', version: null } })
  assert.deepEqual(actionsOf(row), ['connect', 'edit', 'install', 'remove'])
  assert.equal(row.detail.includes('未安装'), true)
})

test('the active gateway carries no connect action', () => {
  // Re-clicking the row that is already open must not reload the page and drop its state.
  const [row] = buildGatewayRows(
    [entry({ active: true })],
    { g1: { phase: 'running', version: '1.7.6' } },
  )
  assert.equal(row.actions.includes('connect'), false)
  assert.equal(row.active, true)
})

test('WSL without a reachable service offers install; remote offers the deployment guide', () => {
  const rows = buildGatewayRows(
    [
      entry({ id: 'w', kind: 'wsl', url: 'http://127.0.0.1:8090' }),
      entry({ id: 'r', kind: 'remote', url: 'https://gw.example.com' }),
    ],
    {
      w: { phase: 'offline', version: null },
      r: { phase: 'running', version: '1.7.5' },
    },
  )
  const wsl = rows.find(row => row.id === 'w')!
  assert.ok(wsl.actions.includes('install'))
  assert.equal(wsl.actions.includes('start') || wsl.actions.includes('stop'), false)

  const remote = rows.find(row => row.id === 'r')!
  assert.deepEqual(actionsOf(remote), ['connect', 'deploy', 'edit', 'remove'])
})

test('an installed WSL gateway gets the lifecycle its state allows, not install', () => {
  const rows = buildGatewayRows(
    [
      entry({ id: 'run', kind: 'wsl' }),
      entry({ id: 'stop', kind: 'wsl' }),
      entry({ id: 'sick', kind: 'wsl' }),
      entry({ id: 'new', kind: 'wsl' }),
    ],
    {
      run: { phase: 'running', version: '1.7.6' },
      stop: { phase: 'stopped', version: null },
      sick: { phase: 'unreachable', version: null },
      new: { phase: 'not-installed', version: null },
    },
  )
  const of = (id: string): string[] => actionsOf(rows.find(row => row.id === id)!)
  assert.deepEqual(of('run'), ['connect', 'edit', 'remove', 'restart', 'stop', 'uninstall', 'upgrade'])
  assert.deepEqual(of('stop'), ['connect', 'edit', 'remove', 'start', 'uninstall', 'upgrade'])
  assert.deepEqual(of('sick'), ['connect', 'edit', 'remove', 'restart', 'uninstall', 'upgrade'])
  assert.deepEqual(of('new'), ['connect', 'edit', 'install', 'remove'])
})

test('the detail line names the mode, the host and the version', () => {
  const rows = buildGatewayRows(
    [
      entry({ kind: 'local', url: 'http://127.0.0.1:8080' }),
      entry({ id: 'r', kind: 'remote', url: 'https://gw.example.com' }),
    ],
    {
      g1: { phase: 'running', version: '1.7.6' },
      r: { phase: 'offline', version: null },
    },
  )
  assert.equal(rows[0].detail, '本机 · 127.0.0.1:8080 · v1.7.6')
  assert.equal(rows[1].detail, '远程 · gw.example.com · 连不上')
})

test('a missing probe reads as unknown rather than as a healthy gateway', () => {
  const [row] = buildGatewayRows([entry()], {})
  assert.equal(row.phase, 'unknown')
  assert.equal(row.version, null)
  assert.equal(row.detail.includes('未知'), true)
})

test('the snapshot carries the label table the page renders', () => {
  const snapshot = buildSnapshot([entry()], { g1: { phase: 'running', version: '1.7.6' } }, {
    canAddWsl: true,
  })
  assert.deepEqual(snapshot.labels, GATEWAY_ACTION_LABELS)
  assert.equal(snapshot.canAddWsl, true)
  assert.equal(snapshot.rows.length, 1)
  // Every action a row can carry must have a label; a row with an unlabeled button is a
  // button with no text on screen.
  for (const row of snapshot.rows) {
    for (const action of row.actions) assert.ok(snapshot.labels[action], `missing label: ${action}`)
  }
})

test('the snapshot reports a read error without dropping the rows it did read', () => {
  const snapshot = buildSnapshot([entry()], { g1: { phase: 'running', version: '1.7.6' } }, {
    canAddWsl: false,
    error: 'gateways.json is unreadable',
  })
  assert.equal(snapshot.error, 'gateways.json is unreadable')
  assert.equal(snapshot.rows.length, 1)
})
