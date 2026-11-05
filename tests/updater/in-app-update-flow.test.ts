import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('app check update delegates to UpdaterManager instead of GitHub REST version check', () => {
  const handlers = readFileSync('src/main/ipc/handlers.ts', 'utf8')
  const checkHandler = handlers.slice(
    handlers.indexOf('registerMainHandler(IpcChannels.APP_CHECK_UPDATE'),
    handlers.indexOf('registerMainHandler(IpcChannels.APP_DOWNLOAD_UPDATE'),
  )

  // The channel now reaches the installer through the host bag (a headless daemon has no
  // updater at all), so the delegation must be checked on both ends of that seam: the
  // handler may only ask the host, and the Electron host must hand it to UpdaterManager.
  assert.match(checkHandler, /requireDesktop\('check-for-updates'\)/, 'handler must go through the host capability')
  assert.match(checkHandler, /desktop\.checkForUpdates\(\)/)
  assert.match(checkHandler, /desktop\.getUpdateStatus\(\)/)

  const electronHost = readFileSync('src/main/runtime/electronHost.ts', 'utf8')
  assert.match(electronHost, /checkForUpdates: async \(\) => \{[\s\S]{0,200}?updaterManager\.checkForUpdates\(\)/,
    'the Electron host is where UpdaterManager is actually called')
  assert.match(electronHost, /getUpdateStatus: \(\) => updaterManager\.getStatus\(\)/)

  for (const source of [checkHandler, electronHost]) {
    assert.doesNotMatch(source, /api\.github\.com\/repos/)
    assert.doesNotMatch(source, /compareVersions/)
    assert.doesNotMatch(source, /releaseUrl/)
  }
})

test('preload and renderer types expose updater status for checkUpdate', () => {
  // 方法表（含返回类型标注）在 `src/shared/api.ts`；preload 只剩装线。
  const preload = readFileSync('src/shared/api.ts', 'utf8')
  const electronTypes = readFileSync('src/renderer/src/types/electron.d.ts', 'utf8')

  assert.match(preload, /checkUpdate:\s*\(\): Promise<UpdateStatus>/)
  assert.match(electronTypes, /checkUpdate:\s*\(\) => Promise<UpdateStatus>/)
  assert.doesNotMatch(preload, /hasUpdate: boolean; currentVersion: string; latestVersion: string; releaseUrl/)
  assert.doesNotMatch(electronTypes, /hasUpdate: boolean; currentVersion: string; latestVersion: string; releaseUrl/)
})

test('about page state is driven by updater events, not manual release URLs', () => {
  const about = readFileSync('src/renderer/src/pages/About.tsx', 'utf8')

  assert.match(about, /onUpdateChecking/)
  assert.match(about, /onUpdateAvailable/)
  assert.match(about, /onUpdateNotAvailable/)
  assert.match(about, /onUpdateProgress/)
  assert.match(about, /onUpdateDownloaded/)
  assert.match(about, /onUpdateError/)
  assert.match(about, /latestVersion: info\?\.version/)
  assert.doesNotMatch(about, /releaseUrl/)
  assert.doesNotMatch(about, /hasUpdate/)
})

test('about page does not hard-code the app version fallback', () => {
  const about = readFileSync('src/renderer/src/pages/About.tsx', 'utf8')

  assert.match(about, /getVersion\(\)\.then/)
  assert.match(about, /const displayAppVersion = appVersion \|\| '\.\.\.'/)
  assert.doesNotMatch(about, /useState<string>\('1\.3\.0'\)/)
})
