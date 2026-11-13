import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 托盘的模型子菜单画得下前几个模型，剩下的只有一行「另有 N 个」。那一行以前是死字：
 * 托盘点不动，控制台也没有任何地方能**选**池子中间的模型（路由编辑页改的是 include /
 * exclude 配置，模型管理页既不按路由看、也不能切换）。结果是「池子里的模型只能撞运气」。
 *
 * 页内 `?route=` 是对应那条通路：带路由名的深链 → 该路由的**全量**列表 + 搜索 + 固定。
 * 这里钉的是四件会悄悄退化的事：
 * 1. 页面必须走 **同一个** `routes:menu` 快照，并且显式要满额（默认是托盘的 8 个）；
 * 2. 搜索必须过滤满额结果，而不是把托盘那 8 个再过一遍；
 * 3. 点「固定」必须走 `routes:switch`、点「恢复自动排序」必须走 `routes:unpin`，
 *    与托盘同一条通道 —— 页面自己改 `preferredModel` 就是第二套选路；
 * 4. 四种缺席要各说一句（接口不可用 / 读失败 / 没有路由 / 没有可切换模型 / 搜不到）。
 */
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const read = (path) => readFileSync(join(root, path), 'utf8')

const page = read('src/renderer/src/pages/Routes.tsx')
const app = read('src/renderer/src/App.tsx')
const sidebar = read('src/renderer/src/components/layout/Sidebar.tsx')

const locales = ['zh-CN', 'en-US'].map(name => ({
  name,
  json: JSON.parse(read(`src/renderer/src/i18n/locales/${name}.json`)),
}))

const slots = text => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort().join(',')

test('路由页是页内一等入口：侧边栏有、路由表注册、懒加载', () => {
  assert.match(sidebar, /titleKey: 'nav\.routes', href: '\/routes'/,
    '入口只在托盘里不算交付：页内导航要有它')
  assert.match(app, /<Route path="\/routes" element=/)
  assert.match(app, /lazy\(\(\) => import\('@\/pages\/Routes'\)/,
    '按页分包：路由页不该被塞进首屏包')
})

test('页面读的是托盘同一份快照，并且显式要满额', () => {
  assert.match(page, /window\.electronAPI\?\.routes/)
  assert.match(page, /await api\.menu\(\{ route, limit: FULL_LIST_LIMIT \}\)/,
    '不带 limit 只会拿到托盘默认的 8 个 —— 那正是「选不到」的原样')
  assert.match(page, /const FULL_LIST_LIMIT = 2000/,
    '页面的上限由主进程钳，这里只声明「要全部」，不写第二个默认值')
  // 快照字段是唯一事实：不许页面自己按 include/exclude 重算池子。
  assert.doesNotMatch(page, /includeModels|excludeModels/,
    '模型列表必须来自选路器快照，页面重算会与真实选路长期不一致')
})

test('搜索作用在满额结果上，按三列匹配', () => {
  assert.match(page, /const visibleModels = useMemo\(/)
  assert.match(page, /detail\.models\.filter\(model =>/)
  for (const field of ['displayName', 'providerName', 'providerId']) {
    assert.match(page, new RegExp(`model\\.${field}\\.toLowerCase\\(\\)\\.includes\\(needle\\)`),
      `搜索要能按 ${field} 命中`)
  }
  assert.match(page, /visibleModels\.map\(model =>/, '渲染的是过滤后的结果，不是原始前 N 个')
  assert.match(page, /t\('routes\.noMatch'\)/, '搜不到要有自己的说法，不能显示成「这条路由没有模型」')
})

test('切换与撤钉走管理面：软钉与落盘都走 routes:switch，页面从不自己写配置', () => {
  assert.match(page, /await api\.switchModel\(\{[\s\S]{0,320}?source: 'console'/,
    '固定必须是 routes:switch，不是页面自己拼一份配置')
  assert.match(page, /providerId: model\.providerId/, '同名模型可能来自不同供应商，必须带上 providerId')
  // 「长期」是同一个通道的 persist 档：落盘发生在主进程（updateRoute + 广播），
  // 页面只表达意图。页面要是自己写 routes，就又长出第二套选路。
  assert.match(page, /action === 'persist' \? \{ persist: true \} : \{\}/,
    '长期固定 = 同一次选择 + persist，不是另一条通道')
  assert.doesNotMatch(page, /routes\.update\(|storeManager|saveAppConfig/,
    '页面不碰路由配置：写盘只有主进程那一处')
  assert.match(page, /await api\.unpin\(detail\.route\)/,
    '「恢复自动排序」是另一条通道：它还要清持久 preferredModel')
  assert.match(page, /result\.reason \?\? t\('routes\.actionFailedHint'\)/,
    '选路器给了原因就显示原因，别吞掉')
})

test('软钉与持久钉在列表里长得不一样', () => {
  assert.match(page, /detail\.pin\.until === 0/, 'until 0 = 持久偏好，其余是 30 分钟软钉')
  assert.match(page, /const persistentPin = /)
  assert.match(page, /model\.displayName === persistentPin[\s\S]{0,120}?routes\.persistentBadge/,
    '点了「长期」之后 badge 必须变成「长期固定」，否则用户以为没生效')
  assert.match(page, /model\.displayName !== persistentPin && \(/, '已经长期固定那一行不再显示「长期」按钮')
})

test('托盘的溢出提示与深链对得上：带路由名才落到那一条', () => {
  const shell = read('src/shell/main.ts')
  assert.match(shell, /`\/routes\?\$\{new URLSearchParams\(\{ route \}\)\.toString\(\)\}`/,
    '深链不带路由名，用户还得在控制台里再找一遍')
  assert.match(page, /searchParams\.get\('route'\)/, '页面必须认这个参数')
  assert.match(page, /setSearchParams\(\{ route: fallback\.route \}, \{ replace: true \}\)/,
    '没带参数时选中第一条启用的路由；空右栏与「路由不存在」长得一样，用户分不出')
})

test('四种缺席各说一句，不合并成一个空页面', () => {
  assert.match(page, /t\('routes\.unavailable'\)/, '没有桥（纯浏览器）与读失败不是一回事')
  assert.match(page, /t\('routes\.loadFailed', \{ error \}\)/, '读失败要带原因')
  assert.match(page, /t\('routes\.noRoutes'\)/, '确实没有启用的路由也要单独说')
  assert.match(page, /t\('routes\.noModels'\)/, '这条路由当前没有可切换模型')
})

test('两种语言写全，插值槽一致', () => {
  const expected = {
    title: '',
    description: '',
    loadFailed: '{{error}}',
    listPinned: '{{model}}',
    listModelCount: '{{n}}',
    current: '{{model}}',
    currentWithLatency: '{{model}},{{ms}}',
    pinPersistent: '{{model}}',
    pinUntil: '{{minutes}},{{model}}',
    showing: '{{shown}},{{total}}',
    circuit: '{{minutes}}',
    accountCount: '{{n}}',
    firstToken: '{{ms}}',
    switched: '{{model}}',
    resetDone: '{{route}}',
    persist: '',
    persistHint: '',
    persistDone: '{{model}}',
    persistentBadge: ''
  }
  for (const { name, json } of locales) {
    assert.equal(typeof json.nav.routes, 'string', `${name} 缺 nav.routes`)
    for (const [key, slot] of Object.entries(expected)) {
      const value = json.routes?.[key]
      assert.equal(typeof value, 'string', `${name} 缺 routes.${key}`)
      assert.ok(value.trim().length > 0, `${name} 的 routes.${key} 是空串`)
      assert.equal(slots(value), slot, `${name} 的 routes.${key} 插值槽不对`)
    }
    // 计数变量刻意叫 n 不叫 count：i18next 见到 count 会去查 `_one`/`_other`，
    // 而这里没有单复数变体，缺键会落到原键上显示成「1 models」。
    for (const key of ['listModelCount', 'accountCount', 'showing']) {
      assert.doesNotMatch(json.routes[key], /{{\s*count\s*}}/, `${name} 的 routes.${key} 用了 count 槽`)
    }
  }
})