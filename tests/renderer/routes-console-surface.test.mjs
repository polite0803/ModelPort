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
const trayRoutes = read('src/renderer/src/api/trayRoutes.ts')
const sharedApi = read('src/shared/api.ts')
const channels = read('src/main/ipc/channels.ts')

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
  assert.match(
    page,
    /await api\.menu\(\{[\s\S]{0,160}?route,[\s\S]{0,160}?limit: FULL_LIST_LIMIT,[\s\S]{0,160}?includeDropped: true,[\s\S]{0,160}?includeCapability: true,[\s\S]{0,80}?\}\)/,
    '不带 limit 只会拿到托盘默认的 8 个；不带 includeDropped 则看不到被池策略筛掉的模型，'
    + '而这一页要能就地做排除/加回；不带 includeCapability 则行上画不出能力标注',
  )
  assert.match(page, /const FULL_LIST_LIMIT = 2000/,
    '页面的上限由主进程钳，这里只声明「要全部」，不写第二个默认值')
  // 快照字段是唯一事实：不许页面自己按手动名单重算池子（读写都走主进程）。
  // 「列哪些模型、每行 status 是三态里的哪一个」全部来自同一次 preview 结论。
  assert.doesNotMatch(page, /includeModels|excludeModels/,
    '模型列表必须来自选路器快照，页面重算会与真实选路长期不一致')
})

test('能力标注在行上显示，并从行上开共用标注入口', () => {
  // 显示：值与出处来自选路快照的同一份 capability（vision 未知就接不了图，
  // 所以这一行写的必须是真的判据，不能是页面自己按名字猜的）。
  assert.match(page, /import \{ CapabilityBadges \} from '@\/components\/models\/CapabilityBadges'/,
    '徽标要与路由池编辑器共用一份实现，两处判据不许分叉')
  assert.match(page, /<CapabilityBadges capability=\{model\.capability\} \/>/,
    '每行渲染选路快照带来的能力解析')
  assert.match(page, /model\.capability !== undefined/, '能力解析缺席时不画空白行')

  // 入口：与聚合/账号渠道共用同一个三段式对话框，键必须带上供应商 ——
  // 同名模型多家服务，标注落在「这一家的这个模型」上。
  assert.match(page, /import \{ ModelAnnotationDialog \} from '@\/components\/models\/ModelAnnotationDialog'/,
    '入口要用共用对话框，不是在页面里拼第二套表单')
  assert.match(page, /t\('routes\.annotate'\)/, '行上的按钮要有一个叫得出来的名字')
  assert.match(page, /t\('routes\.annotateHint'\)/, '按钮要说明点开能做什么')
  assert.match(
    page,
    /<ModelAnnotationDialog[\s\S]{0,400}?providerId=\{annotateTarget\.providerId\}[\s\S]{0,200}?displayName=\{annotateTarget\.displayName\}/,
    'providerId 与 displayName 必须取自被点的那一行',
  )
  assert.match(page, /onChanged=\{\(\) => \{ void refresh\(\) \}\}/,
    '保存标注后要重取快照，否则行上的徽标停在旧值')
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

test('切换与撤钉走管理面：固定走 routes:switch，页面从不自己写配置', () => {
  assert.match(page, /await api\.switchModel\(\{[\s\S]{0,320}?source: 'console'/,
    '固定必须是 routes:switch，不是页面自己拼一份配置')
  assert.match(page, /providerId: model\.providerId/, '同名模型可能来自不同供应商，必须带上 providerId')
  // 固定是切换的唯一语义（裁定 2026-11-15）：落盘发生在主进程（updateRoute + 广播），
  // 页面只表达意图，没有软钉/长期第二档。页面要是自己写 routes，就又长出第二套选路。
  assert.doesNotMatch(page, /persist/, 'persist 档已退役：切换即固定，页面不带第二种语义')
  assert.doesNotMatch(page, /routes\.update\(|storeManager|saveAppConfig/,
    '页面不碰路由配置：写盘只有主进程那一处')
  // 手动例外也只表达意图：页面调用 routes:exclude，由主进程改两个手动名单。
  assert.match(page, /await api\.excludeModel\(\{/,
    '排除/加回/恢复自动必须是 routes:exclude，不是页面自己拼配置')
  assert.match(page, /await api\.unpin\(detail\.route\)/,
    '「恢复自动排序」是另一条通道：它还要清持久 preferredModel')
  assert.match(page, /result\.reason \?\? t\('routes\.actionFailedHint'\)/,
    '选路器给了原因就显示原因，别吞掉')
})

test('钉只有一种：持久 badge，没有倒计时、没有长期档', () => {
  assert.match(page, /detail\.pin\.stale[\s\S]{0,160}?routes\.pinStale[\s\S]{0,160}?routes\.pinPersistent/,
    '头部 badge 只分两态：已固定（持久）/ 钉已不在池内；没有倒计时态')
  assert.match(page, /model\.pinned && \([\s\S]{0,120}?routes\.pinnedBadge/,
    '被钉的行要有「已固定」badge，否则用户以为没生效')
  assert.match(page, /model\.pinned \? t\('routes\.pinnedBadge'\) : t\('routes\.pin'\)/,
    '被钉行的按钮读作「已固定」，再点是替换，不是第二档')
  assert.doesNotMatch(page, /pinUntil|persistentPin|setTick/,
    '倒计时与长期档已退役：钉住即持久（裁定 2026-11-15）')
})

test('星级推荐走 routes:rate：纯标注控件，星数共用常量，排序只改显示顺序', () => {
  assert.match(page, /function StarRating\(/, '每行一个可点的星级控件')
  assert.match(page, /ROUTE_RATING_MAX_STARS/, '星数与主进程读写校验共用同一个常量，不在页面再写一个 5')
  assert.match(page, /await api\.rate\(\{/, '评分必须是命名方法 routes:rate，不是页面自己拼配置')
  assert.match(page, /providerId: model\.providerId/, '同名模型多家服务，评分落在「这一家的这个模型」')
  assert.match(page, /onChange=\{stars => void runRate\(model, stars\)\}/)
  assert.match(page, /value=\{model\.rating \?\? model\.recommendedStars\}/, '默认显示系统推荐星，手动评分优先')
  assert.match(page, /manual=\{model\.rating !== undefined\}/, '区分手动（金色）与系统推荐（灰色实心）')
  assert.match(page, /t\('routes\.recommendedHint', \{ n: current \}\)/, '系统推荐态要说明依据与可覆盖')
  assert.match(page, /stars === 0 \? undefined : stars/, '清除 = 行上不再带 rating（乐观更新）')
  assert.match(page, /isClear \? 0 : star/, '再点同一颗手动星清除；系统推荐态点同星是确认覆盖，不是清除')
  // 「星级优先」只改显示顺序：真实选路仍按快照原序；排序读显示值（手动优先、回落系统推荐），
  // 并且**先分「能不能派」两段**再比星（推荐队列，2026-11-16）。
  assert.match(page, /const rank = \(model: RouteMenuModel\): number => model\.rating \?\? model\.recommendedStars \?\? 0/,
    '同星保持快照原序（稳定排序）')
  // 三段：能派 → 被挡 → 不在池里（手动排除/被策略筛掉）。配置事实排在临时状态之后，
  // 否则一个被策略筛掉的模型会混在「等额度回来」的行里，读起来像它马上就能用。
  assert.match(page, /const seg = \(model: RouteMenuModel\): number =>[\s\S]{0,200}?model\.excluded === true \? 2/,
    '队列先按「能不能派」分段，不在池里的排最后')
  assert.match(page, /if \(delta !== 0\) return delta[\s\S]{0,80}?return rank\(b\) - rank\(a\)/,
    '段内按星级降序')
  assert.match(page, /sortByRating \? t\('routes\.sortByRating'\) : t\('routes\.sortByRouting'\)/)
  assert.match(page, /t\('routes\.sortHint'\)/, '排序按钮要说明「只改显示、不改选路」')
  // 写失败要回读真相，不能让乐观更新的星星停在屏幕上骗人。
  assert.match(page, /if \(!result\.ok\) \{[\s\S]{0,260}?await refresh\(\)/)
})

test('池结构变更订阅：供应商/模型启停后路由页与托盘自动重取（批 B）', () => {
  // 专用事件，不复用 config:changed —— 评分也写 config 但不改池，混在一起会让每次
  // 点星都整池重读。常量、命名方法、两处订阅各钉一处，少一处就退回「停了还列着」。
  assert.match(channels, /ROUTES_POOL_CHANGED: 'routes:pool-changed'/)
  assert.match(sharedApi, /onPoolChanged: \(callback: \(payload: \{ at: number \}\) => void\) => \{/)
  assert.match(sharedApi, /wire\.on\(IpcChannels\.ROUTES_POOL_CHANGED, handler\)/)
  assert.match(sharedApi, /return \(\) => wire\.off\(IpcChannels\.ROUTES_POOL_CHANGED, handler\)/,
    '订阅要能取消：重挂载不能留两个监听器')

  // 路由页（挂载时）重取本页视图。
  assert.match(page, /api\.onPoolChanged\(\(\) => \{ void refresh\(\) \}\)/,
    '路由页订阅池变更并重取，否则停在旧快照')

  // 托盘桥（App 顶层常驻）重发快照：不依赖路由页是否挂载。
  assert.match(trayRoutes, /window\.electronAPI\?\.routes\?\.onPoolChanged\?\.\(\(\) => publish\(\)\)/,
    '托盘缓存只有这一处能更新，池变了就要重发')
  assert.match(trayRoutes, /offPool\(\)/, '清理要连同池变更订阅一起取消')
  assert.match(app, /installTrayRouteBridge\(\)/, '桥在 App 顶层常驻，任意页启停供应商都能刷新托盘')
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

test('额度「不知道」与「复位时刻算不出来」都要说出来，不许留白', () => {
  // 留白会被读成「额度充裕」，而这两种情形恰恰相反 —— 一个说「没有数字」，
  // 一个说「数字有、但什么时候松口我们推不出来」。
  // 断言按「三分支在同一处」写，不钉注释与换行：中间可以有一段解释为什么不能沉默。
  const resetBranch = page.slice(page.indexOf('{row.resetAt !== undefined ? ('))
  const elseAt = resetBranch.indexOf(') : (')
  assert.ok(elseAt > 0, 'resetAt 必须有 else 分支：缺席时不能什么都不画')
  assert.match(
    resetBranch.slice(0, elseAt),
    /routes\.quotaResetApprox[\s\S]{0,200}?routes\.quotaResetExact/,
    '有复位时刻时区分「约」与「确定」',
  )
  assert.match(
    resetBranch.slice(elseAt, elseAt + 400),
    /<>\{' · '\}\{t\('routes\.quotaResetUnknown'\)\}<\/>/,
    '算不出复位时刻的行必须写「未知」，不能静默省略 —— 省略等于宣称它不会复位',
  )
  assert.match(
    page,
    /const undocumentedCount = useMemo\([\s\S]{0,300}?model\.quota === undefined \|\| model\.quota\.band === 'undocumented'/,
    '「没有任何额度数字」的模型要单独计数',
  )
  assert.match(page, /t\('routes\.quotaUndocumented', \{ n: undocumentedCount \}\)/,
    '而且要在表头说一次（逐行说会把列表变成噪声）')
  assert.match(page, /model\.blocked === undefined\s*\n\s*&& \(model\.quota === undefined/,
    '被挡下的行不参与这个计数：它已经由 blockLabel 说过原因了，再说一句会自相矛盾')
  assert.match(page, /t\('routes\.quotaMoreWindows', \{ n: model\.quota\.windows - model\.quota\.rows\.length \}\)/,
    '折叠掉的窗口要报数，不能只显示前三条就假装那是全部')
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
    pinStale: '{{model}}',
    listPinnedStale: '{{model}}',
    pinnedBadge: '',
    pinHint: '',
    annotate: '',
    annotateHint: '',
    showing: '{{shown}},{{total}}',
    circuit: '{{minutes}}',
    accountCount: '{{n}}',
    firstToken: '{{ms}}',
    switched: '{{model}}',
    resetDone: '{{route}}',
    ratingGroup: '{{model}}',
    rateAria: '{{n}}',
    rateClearAria: '{{model}},{{n}}',
    rateDone: '{{model}},{{n}}',
    rateCleared: '{{model}}',
    sortByRating: '',
    sortByRouting: '',
    sortHint: '',
    ratedCount: '{{n}}',
    recommendedHint: '{{n}}',
    blockedBadge: '',
    blockedUntilApprox: '{{when}}',
    blockedUntil: '{{when}}',
    blockedHint: '',
    queueHint: '',
    queueBlockedCount: '{{n}}',
    pinBlockedHint: '',
    delay_minutes: '{{n}}',
    delay_hours: '{{n}}',
    delay_days: '{{n}}',
    quotaWindowRow: '{{limit}},{{unit}},{{used}},{{window}}',
    quotaResetApprox: '{{when}}',
    quotaResetExact: '{{when}}',
    quotaResetUnknown: '',
    quotaMoreWindows: '{{n}}',
    quotaUndocumented: '{{n}}',
    quotaUnit_requests: '',
    quotaUnit_tokens: '',
    quotaSource_documented: '',
    quotaSource_learned: '',
    quotaSource_declared: '',
    window_minute: '',
    window_day: '',
    window_fiveHour: '',
    window_week: '',
    window_month: '',
    expiringSoon: '{{model}},{{remaining}},{{unit}},{{when}},{{window}}',
    // 十条原因各一句：界面按 `routes.block_<reason>` 拼键，少一条就露出原键。
    'block_no-credit': '',
    'block_quota-exhausted': '',
    'block_declared-exhausted': '',
    'block_monthly_exhausted': '',
    'block_rpd_exhausted': '',
    'block_tpd_exhausted': '',
    'block_rpm_exhausted': '',
    'block_tpm_exhausted': '',
    'block_daily_limit': '',
    'block_rate_limited': ''
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
    for (const key of ['listModelCount', 'accountCount', 'showing', 'ratedCount']) {
      assert.doesNotMatch(json.routes[key], /{{\s*count\s*}}/, `${name} 的 routes.${key} 用了 count 槽`)
    }
    // 退役键不许残留：留着它们，旧文案就还能被拼出来（裁定 2026-11-15）。
    for (const key of ['pinUntil', 'persist', 'persistHint', 'persistDone', 'persistentBadge']) {
      assert.equal(json.routes?.[key], undefined, `${name} 还留着退役键 routes.${key}`)
    }
  }
})