import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The About page is served by the gateway and rendered inside the shell. It must not
 * keep showing the desktop-only update button in that host: the daemon has no updater,
 * so the button's only outcome is `desktop-only`. In the shell it uses the preload
 * bridge; in a plain browser it says "manual upgrade" instead of pretending.
 */
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const about = read('src/renderer/src/pages/About.tsx')
const headless = read('src/renderer/src/api/headless.ts')

const zh = JSON.parse(read('src/renderer/src/i18n/locales/zh-CN.json'))
const en = JSON.parse(read('src/renderer/src/i18n/locales/en-US.json'))

const KEYS = [
  'shellUpdateTitle',
  'shellUpdateDesc',
  'gatewayRemoteTitle',
  'gatewayRemoteDesc',
  'shellVersion',
  'gatewayVersion',
  'gatewayUnmanaged',
  'daemonReadFailed',
  'updateAvailable',
  'missingAssets',
  'upgradeAll',
  'upgradeDone',
  'upgradeFailed',
  'openReleasePage',
]

const STAGES = ['checking', 'downloading-daemon', 'verifying-daemon', 'installing-daemon', 'restarting-daemon', 'downloading-shell', 'verifying-shell', 'installing-shell', 'done', 'error']

function checkAbout(source) {
  const problems = []
  if (!/modelportShell/.test(source)) problems.push('About does not detect the shell bridge')
  if (!/checkForUpdates/.test(source)) problems.push('About does not call the shell update check')
  if (!/startUpgrade/.test(source)) problems.push('About does not start the combined upgrade')
  if (!/onUpdateProgress/.test(source)) problems.push('About does not subscribe to upgrade progress')
  if (!/isDesktopApp \? '' : ' hidden'/.test(source)) {
    problems.push('the desktop update card is not hidden outside the desktop host')
  }
  if (!/gatewayRemoteTitle/.test(source)) problems.push('remote/browser mode has no manual-upgrade card')
  if (!/settings\.checkUpdates/.test(source)) problems.push('the shell card has no check button')
  return problems
}

test('About renders the shell bridge, the combined upgrade and the remote fallback', () => {
  assert.deepEqual(checkAbout(about), [])
  assert.match(headless, /__MODELPORT_REMOTE__ = true/, 'the browser transport must mark itself remote')
})

test('both locales carry every shell-update string and stage label', () => {
  for (const [name, locale] of [['zh-CN', zh], ['en-US', en]]) {
    for (const key of KEYS) {
      assert.equal(typeof locale.about?.[key], 'string', `${name} is missing about.${key}`)
    }
    for (const stage of STAGES) {
      assert.equal(typeof locale.about?.stages?.[stage], 'string', `${name} is missing about.stages.${stage}`)
    }
  }
})

test('each check fails on the mutation it is meant to catch', () => {
  assert.match(
    checkAbout(about.replaceAll('modelportShell', 'nothing')).join('\n'),
    /does not detect the shell bridge/,
  )
  assert.match(
    checkAbout(about.replace("isDesktopApp ? '' : ' hidden'", "''")).join('\n'),
    /not hidden outside the desktop host/,
  )
  assert.match(
    checkAbout(about.replaceAll('onUpdateProgress', 'nothing')).join('\n'),
    /does not subscribe to upgrade progress/,
  )
})
