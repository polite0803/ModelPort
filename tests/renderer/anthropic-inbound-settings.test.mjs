import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const panel = () =>
  readFileSync(join(root, 'src/renderer/src/components/proxy/AnthropicInboundSettings.tsx'), 'utf8')

const page = () =>
  readFileSync(join(root, 'src/renderer/src/pages/ProxySettings.tsx'), 'utf8')

const channels = () => readFileSync(join(root, 'src/main/ipc/channels.ts'), 'utf8')

const handlers = () => readFileSync(join(root, 'src/main/ipc/handlers.ts'), 'utf8')

const preload = () => readFileSync(join(root, 'src/preload/index.ts'), 'utf8')

const locale = (name) =>
  JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n/locales', `${name}.json`), 'utf8'))

/** 把一棵命名空间摊成 `a.b` 形式的叶子路径，缺一条就报具体那条。 */
function leaves(tree, prefix = '') {
  return Object.entries(tree).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' ? leaves(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  )
}

const KEYS = [
  'title',
  'loading',
  'documentPassThrough',
  'documentPassThroughHint',
  'defaultModel',
  'defaultModelHint',
  'mappings',
  'mappingsHint',
  'noMappings',
  'clientName',
  'gatewayModel',
  'addMapping',
  'remove',
  'duplicateNames',
  'discoveryNote',
  'configSaved',
  'configSaveFailed',
]

test('面板写的就是路由读的那个键，且留空不写键', () => {
  const source = panel()

  assert.match(source, /config\.update\(\{ anthropicInbound: next \}\)/)
  // 留空 = 不写这一格：渲染层抄一份 `auto` 进库，等于把后端的落点规则搬到 UI 里再存一遍，
  // 后端改了默认值时这份安装会一直顶着旧值（与 output-cap 同一裁定）。
  assert.match(source, /defaultModel: draft\.defaultModel\?\.trim\(\) === '' \? undefined/)
  assert.match(source, /modelMap: rowsToMap\(rows\)/)
  assert.doesNotMatch(source, /defaultModel\s*\?\?\s*['"]auto['"]/, 'renderer must not re-declare the fallback')
})

test('面板挂在设置页上，不是建好就没接的文件', () => {
  const mounted = page()

  assert.match(mounted, /import \{ AnthropicInboundSettings \} from '@\/components\/proxy\/AnthropicInboundSettings'/)
  assert.match(mounted, /<AnthropicInboundSettings \/>/)
})

test('「还没读到」与「读到但没配」是两种状态，不都渲染成空输入框', () => {
  const source = panel()

  assert.match(source, /inbound === undefined/)
  assert.match(source, /useState<AnthropicInboundConfig \| null>\(null\)/)
  assert.match(source, /\{t\('anthropicInbound\.loading'\)\}/)
})

test('重复的客户端名要报出来，不能折成记录后静默少一条', () => {
  assert.match(panel(), /duplicateNames/)
  assert.match(panel(), /text-destructive/)
})

test('两种语言都有全部标签，且插值槽完整', () => {
  const discoveryKeys = [
    'discoveryTitle',
    'discoveryHint',
    'discoveryPreview',
    'discoveryApply',
    'discoveryError',
    'discoveryCreate',
    'discoveryAlready',
    'discoverySkipped',
    'discoveryApplied',
    'discoveryNothingNew',
    'discoveryAlsoServedBy',
    // 五个跳过原因各一条：少一条，UI 就渲染成 `discoveryReason.xxx` 原文。
    'discoveryReason.no-active-account',
    'discoveryReason.already-visible',
    'discoveryReason.mapping-exists',
    'discoveryReason.route-name-taken',
    'discoveryReason.name-not-routable',
    'discoveryFailed',
  ]

  for (const name of ['zh-CN', 'en-US']) {
    const tree = locale(name).anthropicInbound
    for (const key of KEYS) {
      assert.equal(typeof tree?.[key], 'string', `${name} is missing anthropicInbound.${key}`)
    }
    for (const key of discoveryKeys) {
      assert.equal(typeof key.split('.').reduce((node, part) => node?.[part], tree), 'string',
        `${name} is missing anthropicInbound.${key}`)
    }
    // 槽位必须两侧都在：半截 `{{total` 这类残缺既不会被缺译门也不会被 parity 门查出。
    assert.match(tree.duplicateNames, /\{\{names\}\}/, `${name} lost the interpolation slot`)
    for (const key of ['discoveryCreate', 'discoveryAlready', 'discoverySkipped', 'discoveryApplied']) {
      assert.match(tree[key], /\{\{total\}\}/, `${name}.${key} must interpolate {{total}}`)
    }
    assert.match(tree.discoveryError, /\{\{message\}\}/, `${name}.discoveryError must interpolate {{message}}`)
    assert.match(tree.discoveryNote, /\/v1\/models/, `${name} dropped the endpoint this note is about`)
  }

  assert.deepEqual(
    leaves(locale('zh-CN').anthropicInbound).sort(),
    leaves(locale('en-US').anthropicInbound).sort(),
    'the two locale trees must carry the same leaf paths',
  )
})

test('附件开关两态都接得上：面板写这个键、路由读这个键', () => {
  const source = panel()
  assert.match(source, /documentPassThrough: draft\.documentPassThrough/)
  // 默认开的写法必须是「只有显式 false 才关」，写反了会变成默认丢附件。
  assert.match(source, /checked=\{draft\.documentPassThrough !== false\}/)
  // 拨动要置脏，否则开关按下去没有保存按钮 = 假开关。
  assert.match(source, /documentPassThrough: !checked[\s\S]{0,80}setHasChanges\(true\)/)

  const route = readFileSync(join(root, 'src/main/proxy/routes/messages.ts'), 'utf8')
  assert.match(route, /documentsAsFileParts: config\.anthropicInbound\?\.documentPassThrough !== false/)
})

test('可发现名这条链四环都在：通道常量 → handler → preload → 面板调用', () => {
  // 少任何一环，面板上那个按钮就是一个不动的装饰 —— 「加了开关但没人读」的老坑。
  const wires = channels()
  assert.match(wires, /ANTHROPIC_DISCOVERY_PLAN: 'anthropic:discovery-plan'/)
  assert.match(wires, /ANTHROPIC_DISCOVERY_APPLY: 'anthropic:discovery-apply'/)

  const main = handlers()
  assert.match(main, /IpcChannels\.ANTHROPIC_DISCOVERY_PLAN[\s\S]{0,240}planAnthropicRoutes\(\)/)
  assert.match(main, /IpcChannels\.ANTHROPIC_DISCOVERY_APPLY[\s\S]{0,320}applyAnthropicRoutes\(\)/)
  // 写入后要广播：别名进的是 config.modelMappings，模型映射面板与代理都在读它。
  assert.match(main, /IpcChannels\.ANTHROPIC_DISCOVERY_APPLY[\s\S]{0,600}broadcastConfigChanged/)

  const bridge = preload()
  assert.match(bridge, /plan: \(\): Promise<AnthropicDiscoveryResult> =>\s*\n?\s*ipcRenderer\.invoke\(IpcChannels\.ANTHROPIC_DISCOVERY_PLAN\)/)
  assert.match(bridge, /apply: \(\): Promise<AnthropicRouteApplyResult> =>\s*\n?\s*ipcRenderer\.invoke\(IpcChannels\.ANTHROPIC_DISCOVERY_APPLY\)/)
  assert.match(bridge, /anthropicDiscovery: anthropicDiscoveryAPI,/)

  const source = panel()
  assert.match(source, /window\.electronAPI\.anthropicDiscovery\.plan\(\)/)
  assert.match(source, /window\.electronAPI\.anthropicDiscovery\.apply\(\)/)
  // 三类结果各占一句：并成一个数字就看不出「少了的那些去了哪」。
  for (const key of ['discoveryCreate', 'discoveryAlready', 'discoverySkipped']) {
    assert.match(source, new RegExp(`t\\('anthropicInbound\\.${key}'`))
  }
  assert.match(source, /discoveryReason\.\$\{entry\.reason\}/, '跳过原因必须按 code 取文案，不能拼英文')
})

test('钉池这条链的每一环都在：类型 → 归一 → 写校验 → 折叠 → 编辑器', () => {
  const shared = readFileSync(join(root, 'src/shared/types.ts'), 'utf8')
  assert.match(shared, /pinModels: RouteModelRef\[\]/)

  const normalize = readFileSync(join(root, 'src/main/store/modelRoutes.ts'), 'utf8')
  // 读侧同形：旧数据没有这一格也要补成空数组，否则消费方要区分「没配」与「配了空」。
  assert.match(normalize, /pinModels: normalizeRouteModelRefs\(entry\.pinModels\)/)
  assert.match(normalize, /\['pinModels', 'includeModels', 'excludeModels'\]/)

  const store = readFileSync(join(root, 'src/main/store/store.ts'), 'utf8')
  assert.match(store, /checkRouteModelRefs\('pinModels', input\.pinModels\)/)

  const routing = readFileSync(join(root, 'src/main/proxy/autoRouting.ts'), 'utf8')
  assert.match(routing, /export function applyModelNamePin/)

  // 折叠有三处消费（选路、广告下界、预览）。规则只写一遍，但三处都必须折到 ——
  // 少一处就会出现「预览说没有、实际却发得出去」或「广告了一个池里根本没有的窗口」。
  const router = readFileSync(join(root, 'src/main/proxy/autoRouter.ts'), 'utf8')
  const folded = router.match(/applyModelNamePin\(/g) ?? []
  assert.equal(folded.length, 3, `钉池应在三处被折叠，实际 ${folded.length} 处`)

  const fields = readFileSync(join(root, 'src/renderer/src/components/proxy/ModelRouteFields.tsx'), 'utf8')
  assert.match(fields, /pinModels: RouteModelRef\[\]/)
  assert.match(fields, /pinModels: \[\]/)
  assert.match(fields, /pinModels: route\.pinModels\.map/)

  const editor = readFileSync(join(root, 'src/renderer/src/components/proxy/RoutePoolEditor.tsx'), 'utf8')
  assert.match(editor, /pinModels: values\.pinModels/)
  assert.match(editor, /const togglePin = \(model: RoutePreviewModel\)/)
  assert.match(editor, /proxy\.routePoolPin/)

  const list = readFileSync(join(root, 'src/renderer/src/components/proxy/LoadBalanceConfig.tsx'), 'utf8')
  assert.match(list, /route\.pinModels\.length > 0/)
})

test('生成器只从数据取名字，UI 不许自己列一份 claude 名单', () => {
  const source = panel()
  assert.doesNotMatch(source, /const CLAUDE_MODELS/, '客户端可发现名的唯一真值源是 shared/anthropicDiscovery.ts')
  assert.doesNotMatch(source, /claude-sonnet-4-6', 'claude-opus/, '面板里抄一份 Anthropic 名单会随上游模型表漂移')
  // 生成逻辑自己声明的来源约束（同一份判据不许有两处实现）。
  const planner = readFileSync(join(root, 'src/shared/anthropicDiscovery.ts'), 'utf8')
  assert.match(planner, /const ANTHROPIC_DISCOVERABLE_PREFIXES|export const ANTHROPIC_DISCOVERABLE_PREFIXES/)
  assert.match(planner, /startsWith\(prefix\)/)
})

test('「发现了但选不中」这一格接得上：判据在 shared 一份、面板按 code 取文案、两种语言都有', () => {
  const source = panel()
  // 判据只该有一份实现：面板自己抄一份词表就会随客户端版本漂移。
  assert.match(source, /import \{[^}]*routesAbsentFromClaudePicker[^}]*\} from '@shared\/anthropicWire'/)
  // 按编辑态算，不是按已落库的那份算 —— 用户选完档位就该看到，不必保存后再去客户端猜。
  assert.match(source, /routesAbsentFromClaudePicker\(\{[\s\S]{0,200}routeTiers: tierDraft[\s\S]{0,120}modelMap: rowsToMap\(rows\)/)
  // 原因按 code 取文案，拼英文就等于把判据写进 UI。
  assert.match(source, /pickerGapReason\.\$\{gap\.shape\}/)
  assert.match(source, /t\('anthropicInbound\.pickerGapTitle'/)
  assert.match(source, /t\('anthropicInbound\.pickerGapFix'\)/)
  assert.match(source, /text-destructive/, '选不中不是提示，是不能让用户以为已接通')

  for (const name of ['zh-CN', 'en-US']) {
    const tree = locale(name).anthropicInbound
    for (const key of ['pickerGapTitle', 'pickerGapFix']) {
      assert.equal(typeof tree?.[key], 'string', `${name} is missing anthropicInbound.${key}`)
    }
    for (const shape of ['missing-anthropic-name', 'other-vendor-name']) {
      assert.equal(typeof tree?.pickerGapReason?.[shape], 'string',
        `${name} is missing anthropicInbound.pickerGapReason.${shape}`)
    }
    assert.match(tree.pickerGapTitle, /\{\{names\}\}/, `${name} lost the {{names}} slot`)
    // 档位那一节的口径也要一起改：只说「标档位就能广告」会被读成「用户能选中」。
    // 两种语言各按自己的词查，别把中文断言套到 en-US 上。
    assert.match(tree.tierHint, name === 'zh-CN' ? /发现/ : /discovery/i,
      `${name} tierHint must separate discovery from the picker`)
  }
})

test('说明文案里没有 markdown 粗体：这些串是纯文本渲染的', () => {
  // `**或**` 这类从文档里抄来的写法，在界面上会原样露出星号（1.5.1 的档位那一节就是这样），
  // 用户读到的是「文案坏了」，不是强调。
  for (const name of ['zh-CN', 'en-US']) {
    const raw = readFileSync(join(root, 'src/renderer/src/i18n/locales', `${name}.json`), 'utf8')
    assert.ok(!raw.includes('**'), `${name}.json leaks markdown bold into a plain-text label`)
  }
})

test('补客户端名随保存自动做掉，不留按钮也不留手工步骤', () => {
  const source = panel()
  assert.match(source, /import \{ clientNamesForTieredRoutes[^}]*\} from '@shared\/anthropicWire'/)
  // 保存时把「按档位补出来的名字」折进同一份 modelMap：用户只点一次保存。
  assert.match(source, /modelMap: mergeClientNames\(manualMap, clientNamePlan\.add\)/)
  assert.match(source, /if \(generated\.length === 0\) return manual/)
  // 面板上那句「会补成什么」与真正写库的那份是同一个 plan，说的和写的不会两套。
  assert.match(source, /t\('anthropicInbound\.pickerGapAuto'/)
  assert.match(source, /clientNamePlan\.add\.map\(entry => `\$\{entry\.from\} → \$\{entry\.to\}`\)\.join\('、'\)/)
  // 按钮那一版被退回过（「自动化个鬼」）：这里不许再长出 applyClientNames。
  assert.doesNotMatch(source, /applyClientNames/, '补名字不该是一次额外的手工点击')
  // 名字是 shared 算的：面板里再拼一份 `claude-${...}` 就会与判据分叉。
  assert.doesNotMatch(source, /`claude-\$\{/, '客户端名的构造只该有一处')

  for (const name of ['zh-CN', 'en-US']) {
    const tree = locale(name).anthropicInbound
    assert.equal(tree.pickerGapApply, undefined, `${name} keeps a label for a retired button`)
    assert.match(tree.pickerGapAuto, /\{\{pairs\}\}/, `${name} lost the {{pairs}} slot`)
    assert.match(tree.pickerGapAuto, /claude/, `${name} pickerGapAuto must say what gets generated`)
    assert.match(tree.pickerGapBlocked, /\{\{names\}\}/, `${name} lost the {{names}} slot`)
  }
})
test('「生成路由」那一节只在目录里有候选时出现，且挂载即读预览', () => {
  const source = panel()
  // 挂载就调 plan（只读）：不读就不知道该不该出现，等于留给用户一个只会出 0 的按钮。
  assert.match(source, /useEffect\(\(\) => \{\s*\n\s*void readPlan\(\)\s*\n\s*\}, \[\]\)/)
  assert.match(source, /const discoveryRelevant =[\s\S]{0,320}plan\.create\.length > 0 \|\| plan\.alreadyVisible\.length > 0 \|\| plan\.skipped\.length > 0/)
  assert.match(source, /\{discoveryRelevant && \(/)
  // 出错与「建了一半失败」都算有内容：那种时候必须看得见，不能整节消失成「没这功能」。
  assert.match(source, /planError !== null[\s\S]{0,60}failed\.length > 0/)
  // 三堆全 0 的那句解释已退役：那一节根本不再出现，留着就是没人渲染的死文案。
  assert.doesNotMatch(source, /discoveryNothingFound/)
  for (const name of ['zh-CN', 'en-US']) {
    assert.equal(locale(name).anthropicInbound.discoveryNothingFound, undefined,
      `${name} keeps a string nothing renders`)
  }
})

test('档位那张表有表头，且三列宽度与数据行一一对应', () => {
  const source = panel()
  // 中间那格看着像「填模型名」，实际只改显示文字：没有表头就会被填错（实测被填错过）。
  assert.match(source, /t\('anthropicInbound\.routeColumn'\)/)
  assert.match(source, /t\('anthropicInbound\.displayNameColumn'\)[\s\S]{0,80}t\('anthropicInbound\.tierColumn'\)/)
  // 表头三列的宽度类必须与下面数据行的 code / Input / SelectTrigger 一致，否则错位。
  const header = source.match(/<div className="flex items-center gap-2 text-xs[\s\S]*?<\/div>/)[0]
  assert.deepEqual(header.match(/flex-1/g)?.length, 2, '表头前两列要与数据行同为 flex-1')
  assert.match(header, /w-\[200px\]/, '表头第三列要与档位下拉同宽')
  assert.match(source, /<code className="flex-1 font-mono text-sm truncate">/)
  assert.match(source, /<SelectTrigger className="w-\[200px\]"/)

  for (const name of ['zh-CN', 'en-US']) {
    const tree = locale(name).anthropicInbound
    assert.equal(typeof tree.routeColumn, 'string', `${name} is missing routeColumn`)
    // 显示名那一格的标签要自己说清「只是文字」，不靠用户猜。
    assert.match(tree.displayNameColumn, /显示|label/i, `${name} displayNameColumn must say it is a label only`)
  }
})
