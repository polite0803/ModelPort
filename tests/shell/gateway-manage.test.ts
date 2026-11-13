import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The panel's deploy/manage surface crosses the same trust boundary as the update path:
 * a local data: page asks, the main process validates the id against the address book,
 * and only then runs `wsl.exe` as root. These artifact-level checks pin the wiring that
 * keeps one path per action - tray and panel share functions, not copies.
 */
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const main = read('src/shell/main.ts')
const listPreload = read('src/shell/listPreload.ts')
const page = read('src/shell/gatewayListPage.ts')
const wslService = read('src/shell/wslService.ts')

test('the list bridge names the lifecycle methods and exposes no generic invoke', () => {
  for (const method of ['wslAction:', 'upgrade:', 'deploy:']) {
    assert.ok(listPreload.includes(method), `missing bridge method ${method}`)
  }
  const bridge = listPreload.slice(listPreload.indexOf('const bridge'))
  assert.equal(/invoke:|send:/.test(bridge), false, 'no generic invoke/send passthrough')
  for (const channel of ['shell:gateway-wsl', 'shell:gateway-upgrade', 'shell:gateway-deploy']) {
    assert.ok(listPreload.includes(`'${channel}'`), `bridge missing ${channel}`)
    assert.ok(main.includes(`ipcMain.handle('${channel}'`), `main missing ${channel}`)
  }
})

test('WSL actions are validated by kind and platform before touching systemd', () => {
  const handler = main.slice(
    main.indexOf("ipcMain.handle('shell:gateway-wsl'"),
    main.indexOf("ipcMain.handle('shell:gateway-upgrade'"),
  )
  assert.match(handler, /entry\.kind !== 'wsl' \|\| process\.platform !== 'win32'/)
  assert.match(handler, /action === 'start' \|\| action === 'stop' \|\| action === 'restart'/)
  assert.match(handler, /action === 'uninstall'/)
})

test('uninstall confirms the real directory before removing anything, and keeps the data', () => {
  const uninstall = main.slice(
    main.indexOf('async function uninstallWslForEntry'),
    main.indexOf('function openDeployGuide'),
  )
  assert.match(uninstall, /installDir = await wslInstallDir\(entry\.wslDistro\)/)
  assert.match(uninstall, /保留 ~\/\.modelport/)
  assert.match(uninstall, /choice\.response !== 0/)
  assert.ok(
    uninstall.indexOf('dialog.showMessageBox') < uninstall.indexOf('removeWslInstall'),
    'the confirmation must come before the removal',
  )
  assert.match(wslService, /buildFirstInstallRollbackScript/)
  assert.match(wslService, /readServiceUnit\(distro\)\)\.installDir/)
})

test('the WSL probe is one parallel leg and a live HTTP answer outranks the unit', () => {
  assert.match(main, /Promise\.all\(\[\s*probeHttpOrigin\(entry\.url\),\s*probeWslService/)
  assert.match(main, /if \(http\.phase === 'running'\) return http/)
  assert.match(main, /service\.active \? 'unreachable' : 'stopped'/)
  assert.match(wslService, /buildServiceProbeScript\(SERVICE\)/)
})

test('tray and panel share one upgrade path and one WSL control path', () => {
  assert.match(main, /async function checkForUpdatesForEntry\(entry: GatewayEntry\)/)
  const calls = main.match(/await checkForUpdatesForEntry\(entry\)/g) ?? []
  assert.ok(calls.length >= 2, 'both the tray wrapper and the row handler must call it')
  assert.match(main, /同一个安装包/)
  assert.match(main, /未标记为 WSL 托管/)
  for (const label of ['启动 WSL 网关', '停止 WSL 网关', '重启 WSL 网关']) {
    assert.ok(main.includes(label), `tray missing ${label}`)
  }
  assert.match(main, /runWslServiceAction\(active, 'start'\)/)
  assert.match(main, /controlWslService\(entry\.wslDistro, action\)/)
})

test('upgrade is refused for remote rows; deploy is refused for managed rows', () => {
  const upgradeHandler = main.slice(
    main.indexOf("ipcMain.handle('shell:gateway-upgrade'"),
    main.indexOf("ipcMain.handle('shell:gateway-deploy'"),
  )
  assert.match(upgradeHandler, /entry\.kind !== 'local' && entry\.kind !== 'wsl'/)
  const deployHandler = main.slice(
    main.indexOf("ipcMain.handle('shell:gateway-deploy'"),
    main.indexOf("ipcMain.handle('shell:gateway-list-close'"),
  )
  assert.match(deployHandler, /entry\.kind !== 'remote'/)
  assert.match(deployHandler, /release = await fetchLatestRelease\(\)/)
})

test('the page dispatches every new action to its named method', () => {
  assert.match(page, /api\.upgrade\(row\.id\)/)
  assert.match(page, /api\.deploy\(row\.id\)/)
  assert.match(page, /api\.wslAction\(row\.id, action\)/)
  assert.match(page, /action === 'uninstall'/)
})

test('the deploy guide keeps navigation and downloads outside the console document', () => {
  assert.match(main, /guideWindow\.webContents\.on\('will-navigate'/)
  assert.match(main, /shell\.openExternal\(target\)/)
})

test('the sidebar offers the panel only where a console window exists', () => {
  // The page is also served to plain browsers (remote gateways) and to shells older than
  // the panel: the entry must hang off the bridge, not off the page.
  const sidebar = read('src/renderer/src/components/layout/Sidebar.tsx')
  const bridgeType = read('src/shared/shellBridge.ts')
  const preload = read('src/shell/preload.ts')
  assert.match(bridgeType, /gateways\?: ShellGatewayAdmin/, 'the surface is optional by contract')
  assert.match(preload, /gateways: \{/, 'named bridge surface only')
  assert.match(preload, /'shell:gateways'/, 'the snapshot channel must be in the bridge')
  assert.match(sidebar, /modelportShell/, 'the entry must be gated on the bridge')
  assert.match(sidebar, /gateways\?\.snapshot/, 'the entry must be gated on the surface, not the page')
  assert.match(sidebar, /href: '\/gateways'/, 'the entry is a route now')
  assert.match(sidebar, /nav\.gatewayManager/)
  for (const locale of ['en-US', 'zh-CN']) {
    const pack = read(`src/renderer/src/i18n/locales/${locale}.json`)
    assert.ok(pack.includes('"gatewayManager"'), `${locale} is missing nav.gatewayManager`)
    assert.ok(pack.includes('"gateways"'), `${locale} is missing the gateways namespace`)
  }
})

test('the console page and the list window ask the same main-process functions', () => {
  const app = read('src/renderer/src/App.tsx')
  const consolePage = read('src/renderer/src/pages/Gateways.tsx')
  assert.match(app, /path="\/gateways"/, 'the route must exist in the console')
  assert.match(app, /onNavigate/, 'the menu entry navigates instead of opening a window')
  assert.match(consolePage, /gateways\.snapshot\(\)/)
  assert.match(consolePage, /gateways\?\.onChanged/, 'the page must follow main-process changes')
  assert.match(main, /window\.webContents\.send\('shell:gateways-changed'\)/)
  // In the console the surface is remote: every handler must check the sender, and the
  // check must compare it with the active gateway exactly like the update actions do.
  assert.match(main, /function assertGatewayAdminSender\(event: IpcMainInvokeEvent\)/)
  assert.match(main, /event\.sender === window\.webContents\) activeGatewayForSender\(event\)/)
  const channels = [
    'shell:gateways',
    'shell:gateway-connect',
    'shell:gateway-add',
    'shell:gateway-edit',
    'shell:gateway-remove',
    'shell:gateway-local',
    'shell:gateway-install-wsl',
    'shell:gateway-wsl',
    'shell:gateway-upgrade',
    'shell:gateway-deploy',
  ]
  for (const channel of channels) {
    const start = main.indexOf(`ipcMain.handle('${channel}',`)
    assert.ok(start > 0, `${channel} must be registered in main`)
    const next = main.indexOf('ipcMain.handle(', start + 1)
    const handler = main.slice(start, next > 0 ? next : undefined)
    assert.match(handler, /assertGatewayAdminSender\(event\)/, `${channel} must check its sender`)
  }
})