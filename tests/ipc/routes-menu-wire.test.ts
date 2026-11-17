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
 * 3. **恢复自动排序要清两份**。只清内存残留钉的话，重启后 `preferredModel` 又把它钉回来，
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
  assert.equal(IpcChannels.ROUTES_RATE, 'routes:rate')

  for (const channel of ['ROUTES_MENU', 'ROUTES_SWITCH', 'ROUTES_UNPIN', 'ROUTES_RATE']) {
    assert.ok(handlers.includes(`IpcChannels.${channel}`), `handlers 少了 ${channel}`)
    assert.ok(api.includes(`IpcChannels.${channel}`), `api.ts 少了 ${channel}`)
  }
  // 页面只认命名方法：这三件事不能以「通用 invoke + 字符串」的形式再开放一次。
  assert.match(api, /menu: \(request\?: RouteMenuRequest\): Promise<RouteMenuResult> =>\s*\n\s*wire\.invoke\(IpcChannels\.ROUTES_MENU, request\)/)
  assert.match(api, /unpin: \(route: string\): Promise<RouteSwitchResult> =>\s*\n\s*wire\.invoke\(IpcChannels\.ROUTES_UNPIN, route\)/)
  assert.match(api, /rate: \(request: RouteRateRequest\): Promise<RouteRateResult> =>\s*\n\s*wire\.invoke\(IpcChannels\.ROUTES_RATE, request\)/)
})

test('菜单读失败带回原因：托盘才能把「读不到」与「没有路由」分开说', () => {
  const block = handlerBlock('ROUTES_MENU')
  assert.match(block, /catch \(error\)/, '存储没起来必须走这一支')
  assert.match(block, /routes: \[\], generatedAt, error: routeStorageError\(error\)\.message/,
    '空表 + error 才是「读取失败」；空表不带 error 会被读成「配置被清了」')
  assert.match(block, /storeManager\.listModelRoutes\(\)/, '菜单内容来自存储里的路由')
  assert.match(block, /\.map\(route => autoRouter\.routeMenu\(/,
    '每条路由的模型都来自选路器同一份快照，不是处理器自己算一遍')
})

/**
 * 渠道行的「账号：N」必须来自 Worker 池：宿主侧每家渠道只有一条空凭据占位账号，
 * 照本机表数永远是 1（池里可能挂了两个号）。Worker 读不到时退回占位计数而不是 0
 * —— 与供应商卡片同一条原则。
 */
test('账号渠道行改读 Worker 池计数：读不到退回占位账号数，不是 0', () => {
  assert.match(handlers, /async function channelAccountCounts\(\): Promise<ChannelAccountCounts \| undefined>/)
  assert.match(handlers, /await accountChannelManager\.accountCounts\(\)/)
  assert.match(handlers, /catch \{\s*\n\s*return undefined/, 'Worker 未起 = 保留占位计数')

  const menuBlock = handlerBlock('ROUTES_MENU')
  assert.match(menuBlock, /const channelAccounts = await channelAccountCounts\(\)/)
  assert.match(
    menuBlock,
    /autoRouter\.routeMenu\([\s\S]{0,200}?channelAccounts,/,
    '菜单每一行都要拿到池计数，否则渠道行又退回占位 1',
  )
  assert.match(handlerBlock('ROUTES_SWITCH'), /channelAccounts,/, '切换回灌的菜单同样要带池计数')
  assert.match(handlerBlock('ROUTES_UNPIN'), /channelAccounts/, '撤销后的菜单同样要带池计数')
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
  assert.match(
    block,
    /autoRouter\.switchModel\(\s*\n\s*request,\s*\n\s*storeManager\.listModelRoutes\(\),/,
  )
})

test('恢复自动排序清两份：内存残留钉 + 持久 preferredModel', () => {
  const block = handlerBlock('ROUTES_UNPIN')
  assert.match(block, /autoRouter\.clearPin\(routeName\)/)
  assert.match(block, /updateRoute\(routeName, \{ preferredModel: undefined \}\)/,
    '只清内存的话，重启后持久钉又把模型钉回来')
  assert.match(block, /broadcastConfigChanged\(/, '持久那一份改了要广播，页面才不会显示旧值')
})

/**
 * 「固定」是切换的唯一语义（裁定 2026-11-15）：控制台与托盘写同一颗持久硬钉，
 * 统一落盘成路由的 `preferredModel`，没有软钉/长期两档。三处容易写错：
 * 1. 不落盘 —— 重启后钉没了，两个表面各持一颗钉；
 * 2. 先清钉再落盘 —— 写失败时用户看到的是「点了没反应」；
 * 3. 落盘后不清内存残留 —— 请求头钉会盖住配置钉。
 */
test('固定 = 落盘：先写配置再清内存残留，写完广播', () => {
  const block = handlerBlock('ROUTES_SWITCH')
  assert.doesNotMatch(block, /request\.persist/, 'persist 档已退役：切换即落盘，没有第二种语义')
  assert.match(
    block,
    /preferredModel: \{ providerId: result\.providerId, displayName: result\.model \}/,
    '写的是这次解析出来的供应商与模型，不是请求里那两个可能缺席的字段',
  )

  const writeAt = block.indexOf('updateRoute(result.route')
  const clearAt = block.indexOf('autoRouter.clearPin(result.route)')
  assert.ok(writeAt >= 0, '切换必须写路由配置')
  assert.ok(clearAt > writeAt, '先落盘再清内存残留：写失败时界面显示的还是用户刚点的结果')
  assert.match(block, /broadcastConfigChanged\(/, '配置改了要广播，路由页/托盘才会看到新钉')
  assert.match(block, /written\.ok/, '落盘失败要原样报错，不能回一个成功')
})

/**
 * 星级推荐是第四条线，与切换刻意分开：
 * 1. 先验形状与星级范围（0–5 整数，0 = 清除），坏请求不进存储；
 * 2. 覆盖按大小写不敏感引用键（与归一去重同口径），重复点击是覆盖不是追加；
 * 3. 不置钉、不撤钉、不要求模型此刻在池里 —— 评分是纯标注，冷却/配额是瞬时状态；
 * 4. 写盘失败原样报错，成功广播配置。
 */
test('星级推荐：形状与范围先验，覆盖不追加，纯标注不碰钉子', () => {
  const block = handlerBlock('ROUTES_RATE')
  assert.match(block, /typeof request\.route !== 'string'/, '非字符串的路由名不许进存储')
  assert.match(block, /typeof request\.providerId !== 'string'/)
  assert.match(block, /typeof request\.model !== 'string'/)
  assert.match(block, /评分请求缺少路由名、供应商或模型名/)
  assert.match(block, /Number\.isInteger\(stars\)/, '小数/NaN 不许落盘')
  assert.match(block, /stars < 0 \|\| stars > ROUTE_RATING_MAX_STARS/, '范围与界面星数共用同一个常量')

  assert.match(block, /entry\.providerId\.toLowerCase\(\)/, '覆盖匹配与归一去重同口径（大小写不敏感）')
  assert.match(block, /stars === 0 \? kept : \[\.\.\.kept, \{ providerId, displayName, stars \}\]/,
    '0 = 删条目；其余 = 先滤掉旧条目再追加，重复点击是覆盖')
  assert.match(block, /storeManager\.updateRoute\(routeName, \{ modelRatings: next \}\)/)
  assert.match(block, /written\.ok/, '写盘失败要原样报错')
  assert.match(block, /broadcastConfigChanged\(/, '评分改了配置要广播')

  assert.doesNotMatch(block, /setPin|clearPin/, '评分不置钉也不撤钉：与「下一轮用谁」无关')
  assert.doesNotMatch(block, /selectableModels|switchModel/,
    '不要求模型此刻在可派池里：冷却/配额是瞬时状态，不该拒写用户的推荐')
})