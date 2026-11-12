import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The tray's model submenu crosses a trust boundary in an unusual direction.
 *
 * The shell process cannot read the route menu itself: `routes:menu` is authenticated by
 * the management secret, and that secret lives only in the page's transport. So the tray
 * asks the page (`shell:route-menu-request`), the page answers with a snapshot
 * (`shell:route-menu`), and every click travels back as an intent (`shell:route-command`).
 *
 * These are artifact-level checks (there is no Electron in `node --test`), and they pin
 * exactly the wiring that would silently rot: the three channel names on both sides of the
 * bridge, the shape of each command, the three *different* absences the menu must not
 * collapse into one ("no snapshot yet" / "read failed" / "no enabled routes"), and the fact
 * that the click handlers send intents rather than calling anything directly.
 *
 * What is proven elsewhere: the snapshot's content (`tests/routes/model-scope-pin-circuit.test.ts`
 * drives `routeMenu` / `switchModel` against the real router), the RPC methods
 * (`src/renderer/src/api/trayRoutes.ts` over `electronAPI.routes`), and the gate on the
 * inbound channel (asserted below).
 */
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

/** 文档里可以点名管理面通道（它解释为什么不能直接调）；代码里不许出现。 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter(line => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

const main = read('src/shell/main.ts')
const preload = read('src/shell/preload.ts')
const bridge = read('src/renderer/src/api/trayRoutes.ts')

test('托盘顶层是「模型 + 网关」两格：模型菜单来自页面快照，网关收成一项+子菜单', () => {
  assert.match(main, /\{ label: '模型', submenu: modelMenuItems\(\) \}/,
    '模型必须是顶层一格：托盘图标没有文字，快捷切换不能埋在二级菜单里')
  assert.match(main, /\{ label: '网关', submenu: gatewayMenu \}/,
    '网关收成一项+子菜单，顶层腾出的位置留给模型切换')
  assert.match(main, /tray\.setContextMenu\(Menu\.buildFromTemplate\(items\)\)/)
})

test('托盘提示行回答「现在跑的是谁」：路由 + 模型名', () => {
  assert.match(main, /tray\.setToolTip\([\s\S]*?ModelPort · \$\{primary\.route\} · \$\{running\}/,
    '没有文字图标的托盘只能靠 tooltip 回答当前模型')
  assert.match(main, /primary\?\.pin\?\.displayName \?\? primary\?\.current\?\.displayName/,
    '显示的是「生效中的选择」，没有才退回「当前服务的模型」')
})

test('三个通道在两侧同名：请求 / 快照 / 命令', () => {
  for (const channel of ['shell:route-menu-request', 'shell:route-menu', 'shell:route-command']) {
    assert.ok(main.includes(`'${channel}'`), `main 少了 ${channel}`)
    assert.ok(preload.includes(`'${channel}'`), `preload 少了 ${channel}`)
  }
  assert.match(preload, /publishRouteMenu: \(result\): void => ipcRenderer\.send\('shell:route-menu', result\)/)
  assert.match(main, /ipcMain\.on\('shell:route-menu', \(event, payload: unknown\) => \{[\s\S]*?event\.sender !== window\.webContents/)
})

test('托盘只发意图，不自己执行：每个菜单项都是一条 ShellRouteCommand', () => {
  assert.match(main, /action: 'switch',\s*\n\s*route: entry\.route,\s*\n\s*model: model\.displayName,/,
    '点名切换带 route + model + providerId')
  assert.match(main, /trayAction\('换下一个', \(\) => trayRouteCommand\(\{ action: 'switch', route: entry\.route \}\)\)/,
    '「换下一个」不带 model：由选路侧按当前模型取下一项')
  assert.match(main, /trayAction\('恢复到自动排序', \(\) => trayRouteCommand\(\{ action: 'reset', route: entry\.route \}\)\)/)
  assert.doesNotMatch(codeOnly(main), /routes:(menu|switch|unpin)/, 'shell 进程不持有管理密钥，不许直接调管理面')
})

test('模型行把四类读数写在一行里：当前 / 已固定 / 账号数 / 首字 / 熔断', () => {
  for (const marker of ["'当前'", "'已固定'", '账号`', '首字 ', "'免费'", '熔断中 ']) {
    assert.ok(main.includes(marker), `模型行少了 ${marker}`)
  }
  assert.match(main, /type: 'checkbox',\s*\n\s*checked: model\.pinned,/, '已固定那个模型要打勾')
  assert.match(main, /enabled: model\.accountCount > 0,/, '没有可派账号的模型不可点（不是点了没反应）')
})

test('三种缺席各说一句：还没读到 / 读失败 / 没有启用的路由', () => {
  assert.match(main, /if \(snapshot === null\) \{\s*\n\s*return \[\{ label: '读取模型列表…（打开控制台后可用）', enabled: false \}\]/)
  assert.match(main, /snapshot\.error !== undefined[\s\S]*?读取失败：\$\{snapshot\.error\}/,
    '读失败要带原因，不能显示成「没有路由」')
  assert.match(main, /routes\.length === 0[\s\S]*?'没有启用的路由'/,
    '确实没有启用的路由是第三种情况')
  assert.match(main, /另有 \$\{entry\.totalModels - entry\.models\.length\} 个模型在控制台/,
    '截断要如实说还有几个，不能让人以为池子就这么大')
})

test('快照是坏的就不换菜单：形状不合整份丢弃', () => {
  assert.match(main, /const snapshot = sanitizeRouteMenu\(payload\)\s*\n\s*if \(snapshot === null\) return/,
    '坏数据不该让托盘崩掉，也不该把好快照覆盖成空')
})

test('页面侧做的是 RPC，不是另一份判定：menu / switchModel / unpin 三个方法', () => {
  assert.match(bridge, /await window\.electronAPI\.routes\.menu\(\)/, '菜单快照由页面自己读')
  assert.match(bridge, /window\.electronAPI\.routes\.switchModel\(\{[\s\S]*?source: 'tray'/)
  assert.match(bridge, /command\.action === 'reset'[\s\S]*?routes\.unpin\(command\.route\)/,
    '「恢复到自动排序」是撤钉，不是再点一个模型')
  assert.match(bridge, /if \(surface === null\) return \(\) => \{\}/, '纯浏览器没有桥：整块是 no-op，不是失败')
})