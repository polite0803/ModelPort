import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One binary, three roles - and the fence is that the roles stay separate in the artifact.
 *
 * The failure this prevents is the one `shell-entries.test.ts` was written for, inverted:
 * once the same bundle can also serve the gateway, a static import between the roles would
 * put the gateway store into the console process (two `data.json` writers, two tray icons)
 * and a window into the gateway process. Dynamic imports are what keeps a single build
 * emitting three entry files with no shared evaluation.
 */
const mainDir = join('out', 'main')
const orchestrator = join(mainDir, 'index.js')

test('the build emits the orchestrator plus one entry per role', () => {
  for (const artifact of [orchestrator, join(mainDir, 'shell.js'), join(mainDir, 'gateway.js')]) {
    assert.ok(existsSync(artifact), `${artifact} missing: npm run build must emit all three roles`)
  }
})

test('the orchestrator switches on argv and loads each role dynamically', () => {
  const source = readFileSync(orchestrator, 'utf8')
  for (const flag of ['--gateway', '--init-local', '--desktop']) {
    assert.ok(source.includes(flag), `argv flag ${flag} must select a role`)
  }
  // A static require here would evaluate both roles in every process.
  for (const target of ['"./gateway.js"', '"./shell.js"']) {
    const index = source.indexOf(target)
    assert.ok(index > 0, `${target} must be reachable`)
    assert.match(
      source.slice(Math.max(0, index - 60), index),
      /then\(\(\) => require\(/,
      `${target} must be loaded lazily, not with a top-level require`,
    )
  }
  // The orchestrator is a switch, not a place where either role can regrow.
  assert.ok(statSync(orchestrator).size < 4096, 'the orchestrator must stay a thin switch')
  assert.ok(!source.includes('require("electron")'), 'the role switch itself needs no Electron API')
})

test('the gateway role opens no window and no tray', () => {
  const source = readFileSync(join(mainDir, 'gateway.js'), 'utf8')
  for (const forbidden of ['new BrowserWindow', 'new Tray(', 'Menu.buildFromTemplate']) {
    assert.ok(!source.includes(forbidden), `the gateway role must not create ${forbidden}`)
  }
})

test('the gateway role keeps the OS keystore and the gateway profile', () => {
  const source = readFileSync(join(mainDir, 'gateway.js'), 'utf8')
  // safeStorage is the whole reason the local gateway is Electron instead of Node:
  // store.key is sealed against the `<appData>/modelport` profile.
  assert.match(source, /safeStorage/, 'the local gateway must seal credentials with the OS keystore')
  assert.ok(source.includes('modelport'), 'the gateway must pin the existing profile')
  assert.ok(
    !source.includes('modelport-shell'),
    'the gateway must not take the console profile: that profile is what keeps the two processes apart',
  )
  assert.ok(source.includes('GATEWAY_RESTART_EXIT_CODE'), 'the restart handshake exit code must be present')
})
