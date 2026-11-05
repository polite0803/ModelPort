import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 聚合渠道与账号渠道的模型界面都要有「模型标注」入口，且三处入口共用一份实现。
// 这里钉的是会真出事的四条边：
// 1. 键的口径 —— providerId 必须是供应商记录 id、displayName 必须由 `channelModelDisplayName` 现算，
//    拼错一侧的后果是每次点击都吃「模型不属于该供应商」（store 与采用两侧都校验这个名字）。
// 2. 渠道里停用/失效的模型不在目录里，入口必须关掉，而不是放了按钮再报错。
// 3. 批量补全会按账户真发探测请求，所以必须「先估算 → 再确认」，没有跳过确认的旁路，
//    且范围（providerId）要同时进估算和启动两端，否则确认弹窗里的数字与实跑的不是同一批。
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const read = (path) => readFileSync(join(root, path), 'utf8')

const aggregate = read('src/renderer/src/components/aggregate/AggregateDetail.tsx')
const channels = read('src/renderer/src/pages/Channels.tsx')
const dialog = read('src/renderer/src/components/models/ModelAnnotationDialog.tsx')
const batchButton = read('src/renderer/src/components/models/CatalogScopeBatchButton.tsx')
const channelManager = read('src/main/providers/accountChannels/manager.ts')
const runner = read('src/main/providers/modelCatalogBatchRunner.ts')
const metadataService = read('src/main/providers/modelMetadataService.ts')

const locales = ['zh-CN', 'en-US'].map((name) => ({
  name,
  json: JSON.parse(read(`src/renderer/src/i18n/locales/${name}.json`)),
}))

const slots = (text) => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort().join(',')

test('两个模型界面都挂上共用的标注对话框', () => {
  for (const [label, source] of [['聚合渠道', aggregate], ['账号渠道', channels]]) {
    assert.match(source, /<ModelAnnotationDialog/, `${label} 缺少标注对话框挂载`)
    assert.match(source, /from '@\/components\/models\/ModelAnnotationDialog'/,
      `${label} 未从共用组件引入对话框`)
  }
  // providerId 用各自目录里的那把 id：聚合 = 条目 id，渠道 = 渠道 id（两处与供应商记录 id 同名）。
  assert.match(aggregate, /providerId=\{entry\.id\}/, '聚合侧 providerId 必须是条目 id')
  assert.match(channels, /providerId=\{annotateTarget\.channel\.id\}/, '渠道侧 providerId 必须是渠道 id')

  // 三处入口同一个名字：元数据面板的队列按钮以前叫「标准库补全」，对话框现在含三段，
  // 留着旧名就等于同一件事在三个界面上叫法不同。
  const panel = read('src/renderer/src/components/models/ModelMetadataPanel.tsx')
  assert.match(panel, /t\('models\.metadata\.annotate'\)/, '队列行的按钮也要叫「标注」')
  assert.doesNotMatch([aggregate, channels, panel].join('\n'), /catalogComplete/,
    '旧标签已失效，两处语言里都不该再留引用')
})

test('聚合侧用目录返回的 displayName，渠道侧由共用函数现算', () => {
  assert.match(aggregate, /displayName=\{annotateModel\.displayName\}/,
    '聚合行已带目录展示名，界面不许再拼一次')
  assert.match(channels, /displayName=\{channelModelDisplayName\(\s*annotateTarget\.channel\.name/,
    '渠道展示名必须由 channelModelDisplayName 现算')

  // 单一权威：主进程写目录与界面查名字必须是同一个函数，字符串不许在别处再出现一份。
  assert.match(channelManager, /const displayName = channelModelDisplayName\(/,
    'syncProviders 必须改用共用函数写目录键')
  assert.doesNotMatch(channelManager, /`\$\{channel\.name\} \/ \$\{baseName\}`/,
    '主进程里再留一份拼接就等于两处口径可以各写各的')
  assert.doesNotMatch(channels, /channel\.name\s*\+\s*' \/ '|`\$\{channel\.name\} \/ /,
    '渠道界面不许自己拼展示名')
})

test('停用 / 失效的渠道模型不给标注入口，并说明原因', () => {
  assert.match(channels, /disabled=\{model\.disabled \|\| model\.dead\}/,
    '这两类模型不在供应商目录里，按钮必须禁用')
  assert.match(channels, /t\('channels\.models\.annotateBlocked'\)/,
    '禁用态的 title 要说清为什么不能标，而不是留一个点不动的图标')
})

test('共用对话框三段齐全，且手工标注与路由池编辑器同一份实现', () => {
  for (const key of ['factsSection', 'catalogSection', 'markSection']) {
    assert.match(dialog, new RegExp(`models\\.annotation\\.${key}`), `对话框缺这一段：${key}`)
  }
  assert.match(dialog, /getModelMetadataOne\(/, '参数段必须走单模型解析，不许为一次点击重算整张报表')
  const routeEditor = read('src/renderer/src/components/proxy/RoutePoolEditor.tsx')
  assert.match(routeEditor, /import \{ ModelMarkEditor \} from/,
    '路由池编辑器要复用同一个标注表单，两处校验判据不能各写一份')
  assert.doesNotMatch(routeEditor, /function ModelMarkDialog\(\{ open, target, mark, onClose, onSaved \}[\s\S]*?const \[draft/,
    '表单的第二个实现必须删干净')
})

test('批量入口只能「估算 → 确认 → 启动」，范围两端一致', () => {
  assert.match(batchButton, /const result = await api\.estimateCatalogBatch\(providerId\)/,
    '启动前必须先按本范围估算')
  assert.match(batchButton, /if \(result\.models === 0\)/,
    '估出来没活可干必须说明原因并停在这里，不许启动空任务')
  assert.match(batchButton, /startCatalogBatch\(\{ probe: probing, providerId \}\)/,
    '启动必须带同一个范围')
  assert.match(batchButton, /onClick=\{\(\) => void begin\(\)\}/,
    '按钮只能进估算路径；确认框里的 start 才是唯一的启动入口')
  // 探测默认不勾：勾选才会按账户真发请求。
  assert.match(batchButton, /setProbing\(false\)/, '探测开关默认必须关闭')
  assert.match(batchButton, /const \[probing, setProbing\] = useState\(false\)/,
    '初始值也必须是不探测')
})

test('主进程把范围同时收到报表、过滤与快照三处', () => {
  assert.match(runner, /export async function estimateCatalogBatch\(providerId\?: string\)/,
    '估算必须接范围')
  assert.match(runner, /getModelMetadataReport\(Date\.now\(\), providerId\)/,
    '估算的报表必须按范围构建，否则全目录遍历的代价与确认数字都对不上')
  assert.match(runner, /filterBatchTargets\(report\.queue, input\.providerId\)/,
    '启动的过滤必须用同一个范围')
  assert.match(runner, /estimate = input\.probe \? await estimateCatalogBatch\(input\.providerId\)/,
    '请求预算也必须按范围估')
  assert.match(runner, /providerScope: input\.providerId/,
    '进度快照要带上范围，界面才能只认领本范围的推送')
  assert.match(metadataService, /providerId !== undefined && provider\.id !== providerId/,
    '报表的范围过滤必须真的落在供应商循环上')
})

test('新文案两种语言各写全，插值槽不多不少', () => {
  for (const { name, json } of locales) {
    const annotation = json.models.annotation
    for (const key of ['title', 'factsSection', 'catalogSection', 'markSection', 'unavailable']) {
      assert.equal(typeof annotation[key], 'string', `${name} 缺 models.annotation.${key}`)
      assert.ok(annotation[key].length > 4, `${name} 的 models.annotation.${key} 是一句空话`)
    }
    assert.equal(slots(annotation.title), '{{model}}', `${name} 的标注标题只该带 model 一个槽`)

    const metadata = json.models.metadata
    for (const key of ['batchScopeButton', 'batchScopeTitle', 'batchScopeDesc', 'batchScopeNone',
      'batchScopeProgressTitle', 'batchScopeDone', 'batchScopeCancelled', 'batchScopeFailedStart']) {
      assert.equal(typeof metadata[key], 'string', `${name} 缺 models.metadata.${key}`)
    }
    assert.equal(slots(metadata.batchScopeTitle), '{{scope}}', `${name} 的范围标题只该带 scope 一个槽`)

    // 范围说法必须中性：同一个按钮既挂在账号渠道上也挂在聚合条目上。
    for (const key of ['batchScopeButton', 'batchScopeProgressTitle', 'batchScopeDone']) {
      assert.doesNotMatch(metadata[key], /渠道|channel/i, `${name} 的 ${key} 把范围说死成渠道了`)
    }

    assert.equal(typeof json.aggregate.manage.models.annotate, 'string', `${name} 缺聚合侧入口标题`)
    assert.equal(typeof json.aggregate.manage.models.annotateHint, 'string', `${name} 缺聚合侧入口说明`)
    for (const key of ['annotate', 'annotateHint', 'annotateBlocked']) {
      assert.equal(typeof json.channels.models[key], 'string', `${name} 缺 channels.models.${key}`)
    }
    // 禁用说明只该出现在渠道侧：聚合目录里没有「失效但仍列出」的模型。
    assert.equal(json.aggregate.manage.models.annotateBlocked, undefined,
      `${name} 不该给聚合侧一条它用不上的禁用说明`)
  }
})
