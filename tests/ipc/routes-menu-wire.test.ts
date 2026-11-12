import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { IpcChannels } from '../../src/main/ipc/channels.ts'

/**
 * 快捷切换模型的**管理面接线**（架构 A 的 A3）。
 *
 * `ipcMain.handle` 在 `node --test` 里是空实现，主进程处理器没法被调用，所以这里证明的
 * 是「接了什么线」，不是「返回值长什么样」。返回值由另一半证明：
 * `tests/routes/model-scope-pin-circuit.test.ts` 直接驱动真 `autoRouter` 的
 * `routeMenu` / `switchModel` / `pinFor`，托盘那一侧由 `tests/shell/tray-model-menu.test.ts` 钉住。
 *
 * 三条线各有一处容易悄悄失效：
 * 1. **读失败 ≠ 没有路由**。托盘把 `error` 画成一行灰字，把「存储没起来」画成「没有启用的
 *    路由」，用户会以为自己的配置被清了 —— 所以 catch 分支必须带回 `error`。
 * 2. **切换前先验形状**。一个坏请求不该让 `switchModel` 去猜 `request.route`。
 * 3. **恢复自动排序要清两份**。只清内存软钉的话，重启后 `preferredModel` 又把它钉回来，
 *    用户会认为这个按钮时灵时不灵。
 */
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const handlers = read('src/main/ipc/handlers.ts')
const api = read('src/shared/api.ts')

/** 取出某条 `registerMainHandler(<channel>, …)` 之后的一整段（到下一个注册为止）。 */
function handlerBlock(channel: string): string {
  const start = handlers.indexOf(`IpcChannels.${channel}`)
  assert.ok(start >= 0, `handlers.ts 里没有 ${channel}`)
  const next = handlers.indexOf('registerMainHandler(', start + 1)
  return handlers.slice(start, next === -1 ? undefined : next)
}

test('三个通道各有一条字符串定义，主进程与页面都只引用常量', () => {
  assert.equal(IpcChannels.ROUTES_MENU, 'routes:menu')
  assert.equal(IpcChannels.ROUTES_SWITCH, 'routes:switch')
  assert.equal(IpcChannels.ROUTES_UNPIN, 'routes:unpin')

  for (const channel of ['ROUTES_MENU', 'ROUTES_SWITCH', 'ROUTES_UNPIN']) {
    assert.ok(handlers.includes(`IpcChannels.${channel}`), `handlers 少了 ${channel}`)
    assert.ok(api.includes(`IpcChannels.${channel}`), `api.ts 少了 ${channel}`)
  }
  // 页面只认命名方法：这三件事不能以「通用 invoke + 字符串」的形式再开放一次。
  assert.match(api, /menu: \(request\?: RouteMenuRequest\): Promise<RouteMenuResult> =>\s*\n\s*wire\.invoke\(IpcChannels\.ROUTES_MENU, request\)/)
  assert.match(api, /unpin: \(route: string\): Promise<RouteSwitchResult> =>\s*\n\s*wire\.invoke\(IpcChannels\.ROUTES_UNPIN, route\)/)
})

test('菜单读失败带回原因：托盘才能把「读不到」与「没有路由」分开说', () => {
  const block = handlerBlock('ROUTES_MENU')
  assert.match(block, /catch \(error\)/, '存储没起来必须走这一支')
  assert.match(block, /routes: \[\], generatedAt, error: routeStorageError\(error\)\.message/,
    '空表 + error 才是「读取失败」；空表不带 error 会被读成「配置被清了」')
  assert.match(block, /storeManager\.listModelRoutes\(\)/, '菜单内容来自存储里的路由')
  assert.match(block, /\.map\(route => autoRouter\.routeMenu\(route, /,
    '每条路由的模型都来自选路器同一份快照，不是处理器自己算一遍')
})

/**
 * 托盘只画得下前几个模型，剩下的必须能在控制台里点 —— 那条通路就是同一个通道的
 * 范围参数（`{ route, limit }`）。它只能**收窄**取数，不许长出第二套取数逻辑：
 * 一旦过滤器自己算模型列表，托盘与页面就会长期显示不同的事实。
 */
test('范围参数只收窄取数：一条路由 + 钳过的条数，仍走同一个 routeMenu', () => {
  const block = handlerBlock('ROUTES_MENU')
  assert.match(block, /\.filter\(route => only === undefined \|\| route\.name === only\)/,
    '按名字过滤只发生在路由这一层，模型列表不重算')
  assert.match(block, /Math\.min\(ROUTE_MENU_MODELS_MAX, Math\.max\(1, Math\.trunc\(request\.limit\)\)\)/,
    '条数要同时有上下限：0/负数会让页面变空，无上限则把整池塞进一次 IPC')
  assert.match(block, /limit \?\? ROUTE_MENU_MODELS_DEFAULT/,
    '不传条数 = 托盘默认；页面要「全部」就自己传满，不再写第二个默认值')
})

test('切换请求先验形状：缺路由名直接给可读原因', () => {
  const block = handlerBlock('ROUTES_SWITCH')
  assert.match(block, /typeof request\.route !== 'string'/, '非字符串的路由名不许进选路器')
  assert.match(block, /切换请求缺少路由名/)
  assert.match(block, /autoRouter\.switchModel\(request, storeManager\.listModelRoutes\(\)\)/)
})

test('恢复自动排序清两份：内存软钉 + 持久 preferredModel', () => {
  const block = handlerBlock('ROUTES_UNPIN')
  assert.match(block, /autoRouter\.clearPin\(routeName\)/)
  assert.match(block, /updateRoute\(routeName, \{ preferredModel: undefined \}\)/,
    '只清内存的话，重启后持久偏好又把模型钉回来')
  assert.match(block, /broadcastConfigChanged\(/, '持久那一份改了要广播，页面才不会显示旧值')
})