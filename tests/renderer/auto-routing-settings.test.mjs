import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

// 路由面板不再是一个文件：列表容器（LoadBalanceConfig.tsx）+ 每条路由与新建表单共用的
// 字段子组件（ModelRouteFields.tsx）。钉点从「单文件」平移到「组件集」，
// 下面每一条断言的语义都保持原样，只是检查范围变宽（更严），没有放宽任何一项。
const ROUTE_PANEL_FILES = [
  'src/renderer/src/components/proxy/LoadBalanceConfig.tsx',
  'src/renderer/src/components/proxy/ModelRouteFields.tsx',
]

function readRoutePanel(relative) {
  return readFileSync(join(root, relative), 'utf8')
}

// 组件集拼起来的文本：原来钉「面板」的那几条断言现在钉这一段
const routePanel = ROUTE_PANEL_FILES.map(readRoutePanel).join('\n')

test('the settings panel reuses the shared auto-routing defaults instead of its own copy', () => {
  // 两处各自维护默认值就会漂移：渲染层必须取共享常量
  assert.match(routePanel, /DEFAULT_AUTO_ROUTING_CONFIG/)
  // 整个组件集都不许出现手抄的默认值（原断言只查一个文件，现在两个文件都查）
  assert.doesNotMatch(routePanel, /stickyMinutes:\s*30\b/)
  assert.doesNotMatch(routePanel, /(?:maxAttempts|stickyMinutes):\s*\d/)
  // 偏好选择器要列出全部共享枚举，而不是手写一份选项数组
  assert.match(routePanel, /AUTO_PREFERENCES\.map/)

  // prefer 下拉的 id 随路由动态化（同一张卡片里有多份控件组，静态 id 会撞车）。
  // 等价迁移：仍然要求存在这个 id 前缀，并且 label 用 htmlFor 指向同一个模板值 ——
  // 比原来的 /id="auto-prefer"/ 更严：光有 id 不够，还必须与 label 关联。
  const preferLabelFor = routePanel.match(/htmlFor=\{`auto-prefer-\$\{([^}]+)\}`\}/)
  const preferTriggerId = routePanel.match(/id=\{`auto-prefer-\$\{([^}]+)\}`\}/)
  assert.ok(preferLabelFor, 'the preference select must carry a per-route auto-prefer id')
  assert.ok(
    preferTriggerId,
    'the preference label must be linked to that control with htmlFor'
  )
  assert.equal(
    preferLabelFor[1],
    preferTriggerId[1],
    'htmlFor and the control id must be built from the same per-route value'
  )
})

test('every preference has a translation in both locales', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(
      readFileSync(join(root, 'src/renderer/src/i18n/locales', `${locale}.json`), 'utf8'),
    )
    for (const key of [
      'autoRoutingPrefer',
      'autoRoutingPreferHelp',
      'autoRoutingPrefer_balanced',
      'autoRoutingPrefer_fast',
      'autoRoutingPrefer_strong',
      'autoRoutingPrefer_cheap',
    ]) {
      assert.equal(typeof messages.proxy?.[key], 'string', `${locale} is missing proxy.${key}`)
    }
  }
})

// 新增覆盖：新建路由的表单与已有路由的编辑区必须复用同一份字段实现与同一份共享默认值，
// 否则「加一个路由字段要改两处」的漂移又会回来。
test('the create form and the per-route editor share one field component on the shared defaults', () => {
  const container = readRoutePanel(ROUTE_PANEL_FILES[0])
  const fields = readRoutePanel(ROUTE_PANEL_FILES[1])

  // 初始值逐项来自共享常量，而不是子组件自己抄一份
  for (const field of ['prefer', 'maxAttempts', 'stickyMinutes', 'poolStrategies']) {
    assert.match(
      fields,
      new RegExp(`DEFAULT_AUTO_ROUTING_CONFIG\\.${field}\\b`),
      `the route field defaults must read DEFAULT_AUTO_ROUTING_CONFIG.${field}`,
    )
  }

  // 17 条策略 + 5 个预设的选择 UI 只存在于子组件里：容器再写一份就是重复实现
  assert.match(fields, /AUTO_POOL_STRATEGIES\.filter/)
  assert.match(fields, /AUTO_POOL_PRESETS\.map/)
  assert.doesNotMatch(container, /AUTO_POOL_STRATEGIES|AUTO_POOL_PRESETS|AUTO_PREFERENCES/)

  // 两处消费同一个子组件：新建表单一份、已有路由的编辑区一份
  const usages = container.match(/<ModelRouteFields\b/g) ?? []
  assert.equal(
    usages.length,
    2,
    'the create form and the per-route editor must both render ModelRouteFields',
  )
})

// 新增覆盖：路由面板的文案在双语里成对存在（与上面 prefer 四项的检查同形）。
test('route copy exists in both locales', () => {
  const keys = [
    'modelRoutes',
    'modelRoutesDesc',
    'modelRoutesNew',
    'modelRoutesEmpty',
    'modelRoutesEmptyHelp',
    'routesUnavailable',
    'routesLoadFailed',
    'routeNameLabel',
    'routeNamePlaceholder',
    'routeNameHelp',
    'routeNameRequired',
    'routeCreate',
    'routeSaveChanges',
    'routeEnabledSwitch',
    'routeStrategy',
    'routeStrategyHelp',
    'routeRename',
    'routeRenameHelp',
    'routeDeleteConfirmTitle',
    'routeDeleteWarning_auto',
    'routeDeleteWarning_other',
    'routeCreatedToast',
    'routeSavedToast',
    'routeUpdatedToast',
    'routeDeletedToast',
    'routeImmediateHelp',
    'routeAttemptsSummary',
    'routeStickySummary',
  ]

  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(
      readFileSync(join(root, 'src/renderer/src/i18n/locales', `${locale}.json`), 'utf8'),
    )
    for (const key of keys) {
      assert.equal(typeof messages.proxy?.[key], 'string', `${locale} is missing proxy.${key}`)
    }
  }

  // 删除提示必须真的指出「不再广告 + 退回普通模型名解析」，两条语言都要
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(
      readFileSync(join(root, 'src/renderer/src/i18n/locales', `${locale}.json`), 'utf8'),
    )
    assert.match(messages.proxy.routeDeleteWarning_auto, /\/v1\/models/)
    assert.match(messages.proxy.routeDeleteWarning_auto, /auto/)
    assert.match(messages.proxy.routeDeleteWarning_other, /\{\{name\}\}/)
  }
})

// 粘性硬优先开关（2026-11-03 裁定：路由级开关，默认硬钉）。面板加开关的同一批必须
// 写出「哪段代码读它」，所以这里钉的是一条完整的线：控件 → 归一化落盘 → autoRouter 读取。
test('the sticky hard-pin switch is rendered, persisted and read by the router', () => {
  const fields = readRoutePanel('src/renderer/src/components/proxy/ModelRouteFields.tsx')

  const pinInputId = fields.match(/id=\{`auto-sticky-hard-pin-\$\{([^}]+)\}`\}/)
  const pinLabelFor = fields.match(/htmlFor=\{`auto-sticky-hard-pin-\$\{([^}]+)\}`\}/)
  assert.ok(pinInputId, 'the control must carry a per-route id (two field groups share one card)')
  assert.ok(pinLabelFor, 'the label must point at that control with htmlFor')
  assert.equal(pinInputId[1], pinLabelFor[1], 'id and htmlFor come from the same per-route value')
  assert.match(fields, /checked=\{values\.stickyHardPin\}/)

  // 落盘侧只在建键为显式 false 时写这一格：缺省即开，老 data.json 不需要迁移。
  const modelRoutes = readFileSync(join(root, 'src/main/store/modelRoutes.ts'), 'utf8')
  assert.match(
    modelRoutes,
    /entry\.stickyHardPin === false \? \{ stickyHardPin: false \}/,
    'normalisation must persist only an explicit off',
  )

  // 读取侧只有这一处，且判据是「显式 false 才不硬钉」。
  const router = readFileSync(join(root, 'src/main/proxy/autoRouter.ts'), 'utf8')
  assert.match(
    router,
    /route\?\.stickyHardPin === false \? ranked : promoteSticky/,
    'autoRouter must skip the queue-head promotion only when the route opted out',
  )
  assert.equal(
    (router.match(/promoteSticky\(ranked, sticky\)/g) ?? []).length,
    1,
    'one promotion call site: a second place deciding the head would split the semantics',
  )
})

test('both locales explain what turning the hard pin off means', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(
      readFileSync(join(root, 'src/renderer/src/i18n/locales', `${locale}.json`), 'utf8'),
    )
    for (const key of [
      'autoRoutingStickyHardPin',
      'autoRoutingStickyHardPinHelp',
      'autoRoutingStickyHardPinIdle',
    ]) {
      assert.equal(typeof messages.proxy?.[key], 'string', `${locale} is missing proxy.${key}`)
    }
    // 关掉之后剩下的是加分，文案必须把那两个数值说出来，否则「关掉会怎样」无法预期。
    assert.match(messages.proxy.autoRoutingStickyHardPinHelp, /0\.12/)
    assert.match(messages.proxy.autoRoutingStickyHardPinHelp, /0\.06/)
    // 「粘性时长为 0 时这一格不起作用」必须单独成句，不许和主说明混在一行。
    assert.doesNotMatch(messages.proxy.autoRoutingStickyHardPinIdle, /0\.12/)
  }
})
