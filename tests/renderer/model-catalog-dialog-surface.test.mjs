import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 2026-11-04 用户实测：「标准库补全」弹窗内容比视口高，底部候选与字段被截断且无法滚动；
// 同时字段无值时只显示一个破折号，用户读完不知道「推理 / 输入模态」为什么永远补不上。
// 这里钉两件事：弹窗必须有滚动区，结构性缺席必须在弹窗里说清来源。
//
// 2026-11-05：标准库那一段随「逐模型标注对话框」搬到 `ModelAnnotationDialog.tsx`
// （聚合渠道 / 账号渠道 / 元数据面板共用同一份实现）。以下判据一条都没放宽，
// 只是把被钉的文件换成搬移后的那个 —— 弹窗正文 = 从 `AnnotationBody` 到文件结尾，
// 对话框外壳（header / footer / DialogContent）也在同一文件里，所以整份文本就是范围。
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const panelPath = 'src/renderer/src/components/models/ModelMetadataPanel.tsx'
const panel = readFileSync(join(root, panelPath), 'utf8')
const dialogPath = 'src/renderer/src/components/models/ModelAnnotationDialog.tsx'
const dialog = readFileSync(join(root, dialogPath), 'utf8')
const batchButtonPath = 'src/renderer/src/components/models/CatalogScopeBatchButton.tsx'
const batchButton = readFileSync(join(root, batchButtonPath), 'utf8')
// 保留旧变量名的语义：这四条判据钉的是标准库那一段的排版，不是文件名。
const catalogDialog = dialog
const locales = ['zh-CN', 'en-US'].map((name) => ({
  name,
  metadata: JSON.parse(
    readFileSync(join(root, `src/renderer/src/i18n/locales/${name}.json`), 'utf8'),
  ).models.metadata,
}))

test('标准库补全弹窗有独立滚动区，头部与底部按钮不随内容滚走', () => {
  assert.match(
    catalogDialog,
    /<DialogContent className="flex[^"]*max-h-\[85vh\][^"]*overflow-hidden"/,
    'the dialog box must cap its height and clip, so the body can scroll inside it',
  )
  assert.match(
    catalogDialog,
    /className="min-h-0 flex-1[^"]*overflow-y-auto[^"]*"/,
    'the body must be the scrolling element (min-h-0 + flex-1 + overflow-y-auto)',
  )
  assert.match(catalogDialog, /<DialogHeader className="shrink-0">/, 'header stays pinned')
  assert.match(catalogDialog, /<DialogFooter className="shrink-0">/, 'footer stays pinned')
})

test('同一批弹窗都不会截断：只有短确认框可以不封顶', () => {
  const dialogs = [panel, dialog, batchButton].flatMap((source) =>
    [...source.matchAll(/<DialogContent className="([^"]+)"/g)].map((m) => m[1]),
  )
  const unbounded = dialogs.filter((c) => !/max-h-\[85vh\]|h-\[85vh\]/.test(c))
  // 每条判据照旧：允许不封顶的只有短确认框（面板的补齐确认框 + 范围补全的确认框）。
  assert.deepEqual(unbounded.sort(), ['max-w-md', 'max-w-md'],
    'only the short confirm dialogs may stay unbounded; every other DialogContent must cap height')
})

test('字段无值时说明「这一项没有值、无法采用」，不再只留一个破折号', () => {
  assert.match(
    catalogDialog,
    /\{value === undefined && \(\s*<span className="text-\[11px\] text-muted-foreground">\s*\{t\('models\.metadata\.catalogFieldAbsent'\)/,
    'the absent-value sentence must render on the same branch that disables the adopt button',
  )
  assert.match(catalogDialog, /disabled=\{value === undefined \|\| busy !== null\}/,
    'the adopt button is still gated on the value, so the sentence and the gate cannot drift')
})

test('未抓取的来源由 statuses 与 CATALOG_SOURCES 对拍得出，不写死名单', () => {
  assert.match(
    catalogDialog,
    /const unfetchedSources = data\s*\?\s*CATALOG_SOURCES\.filter\(\s*\(source\) => !data\.statuses\.some\(\(status\) => status\.source === source\),?\s*\)/,
    'the note must list exactly the sources with no snapshot status',
  )
  assert.match(catalogDialog, /t\('models\.metadata\.catalogSourcesNotFetched',\s*\{\s*sources: unfetchedSources\.map/,
    'the sentence must interpolate the missing source labels')
})

test('两个语言各写全两条缺席文案，插值槽只有 sources', () => {
  for (const { name, metadata } of locales) {
    for (const key of ['catalogFieldAbsent', 'catalogSourcesNotFetched']) {
      assert.equal(typeof metadata[key], 'string', `${name} 缺 models.metadata.${key}`)
      assert.ok(metadata[key].length > 12, `${name} 的 ${key} 是一句空话`)
    }
    const slots = (text) => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort().join(',')
    assert.equal(slots(metadata.catalogSourcesNotFetched), '{{sources}}',
      `${name} 的缺席句只能带 sources 一个槽`)
    assert.equal(slots(metadata.catalogFieldAbsent), '',
      `${name} 的无值句不该带槽`)
  }
  const zh = locales[0].metadata.catalogSourcesNotFetched
  assert.ok(/LiteLLM/.test(zh) && /推理/.test(zh),
    '缺席句要指名是哪一份台账缺哪一项，不能只说「没有数据」')
})

// 2026-11-04：「关键属性待补」一个数字混了四种完全不同的缺口，用户据此以为「还能补」。
test('「关键属性待补」按四种缺口分开渲染，队列行也标出库里没有/非对话', () => {
  assert.match(panel, /report\.totals\.routingIncompleteByKind \?\?/,
    '主进程老版本缺字段时要有全零兜底，否则整页打不开')
  for (const key of ['gapKindAdoptable', 'gapKindMissingField', 'gapKindNoCandidate', 'gapKindNotChat']) {
    assert.match(
      panel,
      new RegExp(`t\\('models\\.metadata\\.${key}', \\{ count: gapKinds`),
      `${key} 必须带计数渲染，不能只写死一个总数`,
    )
    for (const { name, metadata } of locales) {
      assert.equal(typeof metadata[key], 'string', `${name} 缺 models.metadata.${key}`)
    }
  }
  assert.match(panel, /row\.gapKind === 'not-chat'/, '队列行要标出非对话模型')
  assert.match(panel, /row\.gapKind === 'no-candidate'/, '队列行要标出标准库里没有')
})
