/**
 * `autoStart` 必须在**每一条**配置写路径上落到操作系统。
 *
 * 这条回归的原始症状：「开关打开了，但系统里从来没有登录项」。三个成因：
 * 1. 只在 `config:update` 里写 —— `resetConfig` 也会把 `autoStart` 改回默认
 *    `false`，那条路径若不写，OS 侧就留着一条关不掉的残留登录项；
 * 2. 每次配置写入都写 —— 保存 API Key / 模型映射 / 模型同步都会碰注册表或家目录，
 *    既无用又可能被安全软件拦；
 * 3. 写了但吞掉失败 —— 用户永远不知道为什么没生效。
 *
 * 断言放在源码文本层面：`storeManager` 的初始化要真读盘、也要真写 OS，本仓库的
 * 测试也不 mock electron，因此这里钉住「调用点是否存在、是否带变更短路」，以及
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = readFileSync('src/main/store/store.ts', 'utf8')
const host = readFileSync('src/main/autostartHost.ts', 'utf8')
// The desktop wiring moved into its own role entry when the binary became a three-role
// orchestrator; the console is the shipped role now, this host is development-only.
const main = readFileSync('src/main/desktop/entry.ts', 'utf8')

test('四条配置写路径全部接上了开机自启副作用', () => {
  // setConfig / updateConfig / resetConfig / restoreConfig 各一处。
  // `restoreConfig` 是备份导入用的整份恢复（路由取备份那份），它同样会把
  // `autoStart` 改回备份里的值 —— 漏掉它，导入完成后操作系统里留着的是导入前的登录项。
  const calls = store.match(/this\.applyAutoStart\(/g) ?? []
  assert.equal(
    calls.length,
    4,
    'setConfig、updateConfig、resetConfig、restoreConfig 都必须调用 applyAutoStart',
  )
  assert.match(
    store,
    /restoreConfig\(config: unknown\): AppConfig \{[\s\S]*?this\.applyAutoStart\(previous, normalized\)/,
    'restoreConfig 需要与其它三条路径一样带 applyAutoStart（含 previous 短路）',
  )
})

test('值没变时不碰操作系统（否则每次保存设置都会写注册表）', () => {
  assert.match(
    store,
    /private applyAutoStart\(previous: AppConfig \| undefined, next: AppConfig\): void \{\s*if \(previous !== undefined && previous\.autoStart === next\.autoStart\) return/,
    'applyAutoStart 必须先做「未变更即返回」，否则无关配置写入也会触发 OS 写',
  )
})

test('写入失败只告警，绝不把一次设置保存变成错误', () => {
  // `void getHost().syncLoginItem(...).catch(...)`：不 await、不上抛。
  assert.match(store, /void getHost\(\)\.syncLoginItem\(next\.autoStart\)/)
  assert.match(store, /catch\(\(error: unknown\) => \{\s*console\.warn\(/, '失败必须留下日志')
})


test('Electron 宿主必须把 syncLoginItem 接到真正的 OS 写入', () => {
  // 存储层现在只认宿主绑定；绑定若是空实现，「开关打开了但系统里没有登录项」会原样复发。
  const electronHost = readFileSync('src/main/runtime/electronHost.ts', 'utf8')
  assert.match(electronHost, /import \{ syncAutoStart \} from '\.\.\/autostartHost'/,
    'electronHost 必须引进 autostartHost，否则 GUI 侧的登录项写入根本不存在')
  assert.match(electronHost, /syncLoginItem: \(enabled\) => syncAutoStart\(enabled\)/,
    'syncLoginItem 必须直接转调 syncAutoStart（带 enabled 参数）')
})
test('启动时对账，且判定窗口显示不读配置', () => {
  assert.match(main, /const launchHidden = detectHiddenLaunch\(\)/)
  assert.match(main, /showOnReady: !launchHidden/)
  // 对账排在 IPC 注册之后 —— 那时 store 才初始化完，读得到 autoStart。
  const registerIndex = main.indexOf('await registerIpcHandlers(mainWindow)')
  const reconcileIndex = main.indexOf('void reconcileAutoStart(readAutoStartConfig())')
  assert.ok(registerIndex > 0 && reconcileIndex > registerIndex,
    'reconcileAutoStart 必须在 registerIpcHandlers 之后（store 尚未初始化时读不到配置）')
})

test('窗口 ready-to-show 尊重 showOnReady，开机自启不抢焦点', () => {
  const windowManager = readFileSync('src/main/window/manager.ts', 'utf8')
  assert.match(windowManager, /if \(!showOnReady\) return/)
  assert.match(windowManager, /showOnReady = true/, '默认必须显示：普通启动不能被这条改动影响')
})

test('开发态不注册登录项（否则开机拉起的是裸 Electron）', () => {
  assert.match(host, /if \(!app\.isPackaged\) \{/)
  assert.match(host, /skipped: 'unpackaged'/)
  // 对账路径同样要跳过，否则每轮都会打出误导性的「校正失败」
  assert.match(host, /export async function reconcileAutoStart\(desired: boolean\): Promise<void> \{\s*\/\/[\s\S]{0,400}?if \(!app\.isPackaged\) return/)
})

test('Linux 读 OS 状态不用 getLoginItemSettings（那个 API 不覆盖 Linux）', () => {
  assert.match(host, /if \(process\.platform === 'linux'\) return existsSync\(linuxAutostartPath\(\)\)/)
})
