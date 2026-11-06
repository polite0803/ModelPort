import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The update path crosses three trust boundaries: a remote page asks the shell, the
 * shell runs `wsl.exe` as root, and the resulting process quits to let an installer
 * replace it. These are artifact-level checks - they fail on the exact mutation that
 * removes a guard, without needing Electron or WSL.
 */
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const main = read('src/shell/main.ts')
const preload = read('src/shell/preload.ts')
const addressBook = read('src/shell/addressBook.ts')
const updater = read('src/shell/updater.ts')
const wslExec = read('src/shell/wslExec.ts')
const plan = read('src/shell/updatePlan.ts')
const release = read('.github/workflows/release.yml')

test('preload exposes named update methods and no generic invoke passthrough', () => {
  for (const method of ['getVersion', 'checkForUpdates', 'startUpgrade', 'onUpdateProgress']) {
    assert.match(preload, new RegExp(`${method}:`), `missing bridge method ${method}`)
  }
  const bridge = preload.slice(preload.indexOf("exposeInMainWorld('modelportShell'"))
  assert.equal(/ipcRenderer\s*[,}]/.test(bridge), false, 'raw ipcRenderer must not cross the bridge')
  assert.equal(/invoke:|send:/.test(bridge), false, 'no generic invoke/send passthrough')
})

test('main registers the update channels and gates them on the active gateway origin', () => {
  for (const channel of ['shell:version', 'shell:update-check', 'shell:update-start']) {
    assert.ok(main.includes(`'${channel}'`), `missing IPC channel ${channel}`)
  }
  assert.match(main, /function activeGatewayForSender/)
  assert.match(main, /event\.senderFrame\?\.url/)
  assert.match(main, /origin !== normalizeOrigin\(entry\.url\)/)
  assert.match(main, /checkForUpdates\(activeGatewayForSender\(event\)\)/)
  assert.match(main, /runUpgrade\(entry,/)
})

test('tray has its own check-update entry and reports the daemon management state', () => {
  assert.ok(main.includes('检查更新（控制台 + 可管理的网关）'), 'tray must offer the update check')
  assert.match(main, /check\.daemon\.managed/)
  assert.match(main, /未标记为 WSL 托管/)
})

test('address book stores the mode and derives WSL management from it', () => {
  // The three modes replaced the old "manage this WSL gateway" checkbox: WSL management
  // is a consequence of the mode, not a separate switch that can disagree with it.
  assert.match(addressBook, /export type GatewayKind = 'local' \| 'wsl' \| 'remote'/)
  assert.match(addressBook, /wslDistro\?: string/)
  assert.match(addressBook, /if \(kind === 'wsl'\) next\.manageWsl = true/)
  assert.match(addressBook, /entry\.manageWsl === true \? 'wsl' : 'remote'/)
})

test('the runner refuses a missing checksum and runs the daemon only for managed entries', () => {
  assert.match(wslExec, /parseSha256\(readFileSync\(checksumPath/)
  assert.match(wslExec, /SHA-256 不匹配/)
  assert.match(updater, /const daemonWanted = check\.daemon\.managed/)
  assert.match(updater, /升级包缺少校验文件或安装资源/)
  assert.match(updater, /buildWslRollbackScript/)
  assert.match(updater, /shellQuote|buildWslInstallScript/)
})

test('the silent shell installer is configured to relaunch the app', () => {
  // `/S` skips the finish page (and its run checkbox). The relaunch must therefore come
  // from the installer itself; a detached helper spawned by the shell is killed with the
  // shell's process group on Windows.
  const builder = read('package.json')
  const nsisInclude = read('build/installer.nsh')
  assert.match(builder, /"include": "build\/installer\.nsh"/)
  assert.match(nsisInclude, /!macro customInstall/)
  assert.match(nsisInclude, /\$\{if\} \$\{Silent\}/)
  assert.match(nsisInclude, /StdUtils\.ExecShellAsUser/)
  assert.match(nsisInclude, /\$launchLink/)
  assert.match(updater, /spawn\(installer, \['\/S'\]/)
})

test('plan requires a checksum pair before exposing an installable asset', () => {
  assert.match(plan, /const checksumName = `\$\{name\}\.sha256`/)
  assert.match(plan, /missing\.push\(checksumName\)/)
  assert.match(plan, /return null/)
})

test('release workflow publishes checksums for the console and the daemon', () => {
  assert.match(release, /gh release upload/)
  assert.match(release, /sha256sum/)
  assert.match(release, /gh release upload.*sha256/)
})
