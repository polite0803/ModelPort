import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 映射键与路由名撞车时，那一行**永远不会生效**：请求解析先认路由名
 * （`modelRoutes::findModelRoute`），命中了就整段跳过映射读取（`chat.ts` 的
 * `!autoDecision` 分支）。停用的路由也一样 —— 名字仍然挡住映射键，请求得到的是
 * 404 `route_disabled`，而不是映射指向的模型。
 *
 * 这一页以前两种情形都不说：用户存下一条「别名 + 供应商 + 账号」的规则，界面显示
 * 它存在，实际跑的却是那条路由 —— 「看着钉住了其实没钉」正是不可预知的来源。
 */
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const read = (path) => readFileSync(join(root, path), 'utf8')

const panel = read('src/renderer/src/components/proxy/ModelMappingConfig.tsx')
const locales = ['zh-CN', 'en-US'].map(name => ({
  name,
  json: JSON.parse(read(`src/renderer/src/i18n/locales/${name}.json`)),
}))

test('判据与主进程同源：只认 canonicalRouteName，不自己写一套大小写规则', () => {
  assert.match(panel, /import \{ canonicalRouteName \} from '@shared\/modelRouteName'/,
    '路由名的规范化只有一份（trim + 小写）；面板再写一遍就会两处口径分叉')
  assert.match(panel, /routeNames\.find\(name => canonicalRouteName\(name\) === target\)/,
    '比较必须是规范化之后的名字')
})

test('路由名从管理面读，读不到只降级成「不提示」，不把面板变成错误态', () => {
  assert.match(panel, /await window\.electronAPI\.routes\.list\(\)/)
  assert.match(panel, /result\.ok \? result\.routes\.map\(route => route\.name\) : \[\]/,
    '读失败按「不知道有哪些路由」处理：这层只是提示，拦不拦得住写入由主进程的名字校验兜底')
})

test('新建同名的映射键直接拒绝，并指向真正能用的地方', () => {
  assert.match(panel, /const routeConflict = editingMapping === null \? routeNameConflict\(formData\.requestModel\) : undefined/,
    '只拦新建：存量撞名的行拦编辑只会让对话框变成死胡同')
  assert.match(panel, /t\('proxy\.aliasRouteCollision', \{ name: routeConflict \}\)/,
    '提示要指出撞了哪条路由')
  assert.match(panel, /t\('proxy\.validationFailed'\)[\s\S]{0,200}?aliasRouteCollision/,
    '走既有的校验失败样式，不发明新的错误通道')
})

test('存量撞名行在表里标出来，与通配键同一套处理', () => {
  assert.match(panel, /const routeConflict = routeNameConflict\(mapping\.requestModel\)/)
  assert.match(panel, /routeConflict !== undefined && \([\s\S]{0,300}?AlertTriangle/,
    '已有的死行也必须看得见，否则用户会继续往上面加规则')
  assert.match(panel, /isWildcardMapping && \([\s\S]{0,300}?AlertTriangle/,
    '对照组：通配键的存量标记用同一个图标，两种死法长得一致')
})

test('两种语言都有这条提示，插值槽一致', () => {
  for (const { name, json } of locales) {
    const value = json.proxy?.aliasRouteCollision
    assert.equal(typeof value, 'string', `${name} 缺 proxy.aliasRouteCollision`)
    assert.ok(value.trim().length > 0, `${name} 的提示是空串`)
    assert.equal((value.match(/{{\s*name\s*}}/g) ?? []).length, 1, `${name} 必须且只能插一个 {{name}}`)
  }
})