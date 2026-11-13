import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

/**
 * The CONFIG_CHANGED mirror must be subscribed on remote pages too.
 *
 * `window.electronAPI` on a headless-served page is installed by installHeadlessApi()
 * in main.tsx, which runs *after* the store modules evaluate - a module-top-level
 * subscription is silently skipped there, leaving every appConfig-derived surface
 * (the proxy form above all) frozen at its mount value while polled surfaces keep
 * moving. The subscription is therefore a re-entrant function called both at module
 * top (desktop preload exists by then) and right after the install (remote).
 */
const store = () => readFileSync(join(root, 'src/renderer/src/stores/proxyStore.ts'), 'utf8')

const main = () => readFileSync(join(root, 'src/renderer/src/main.tsx'), 'utf8')

test('the mirror subscription is re-entrant and writes both mirrors', () => {
  const source = store()
  const start = source.indexOf('export function subscribeConfigMirror')
  assert.ok(start >= 0, 'the subscription must be a callable, not module-top-only')
  const block = source.slice(start, source.indexOf('\nsubscribeConfigMirror()'))
  assert.match(block, /configMirrorSubscribed/, 'a second call must not double-subscribe')
  assert.match(block, /appConfig: config/)
  assert.match(block, /proxyConfig: proxyConfigFromAppConfig\(config\)/)
  assert.match(source, /\nsubscribeConfigMirror\(\)/, 'desktop keeps the module-top call')
})

test('main.tsx re-subscribes after the headless install', () => {
  const source = main()
  const install = source.indexOf('installHeadlessApi()')
  const subscribe = source.indexOf('subscribeConfigMirror()')
  assert.ok(install >= 0 && subscribe > install, 'the remote page must gain the mirror post-install')
})