import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 费用权重（倍率）这条线的接线自证。三类坏法都在这里钉住：
// 1. 「能看见缺口、补不上」——存储层早就接受 weight/free，表单却没有输入；
// 2. 「标了也不显示」——路由按 manual > record 打分，模型管理页却只读渠道目录，
//    于是标完倍率、界面仍写「未标注倍率」；
// 3. 「不适用被算成缺失」——聚合/别名/自定义供应商没有倍率这个概念，沿用
//    「未标注」文案会把一个真答案说成待办。
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const read = (path) => readFileSync(join(root, path), 'utf8')

const dialog = read('src/renderer/src/components/models/ModelAnnotationDialog.tsx')
const modelList = read('src/renderer/src/components/models/ModelList.tsx')
const catalogParser = read('src/main/providers/accountChannels/modelCatalog.ts')

const locales = ['zh-CN', 'en-US'].map((name) => ({
  name,
  json: JSON.parse(read(`src/renderer/src/i18n/locales/${name}.json`)),
}))
const slots = (text) => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort().join(',')

test('标注表单能录入倍率与免费，非法输入原地拒绝', () => {
  assert.match(dialog, /function parseMarkWeight\(raw: string\)/,
    '倍率必须有自己的解析判据（允许 0.03 这类小数，不接受负数）')
  assert.match(dialog, /const weightError = validateMarkWeight\(weightDraft, t\)/)
  assert.match(dialog, /contextError !== null \|\| outputError !== null \|\| weightError !== null/,
    '倍率非法也必须拦住保存，不能等主进程静默丢掉')
  assert.match(dialog, /setWeightDraft\(saved\?\.weight/, '保存后要用归一值回填，避免「保存成功却回退」')
  assert.match(dialog, /patch\(\{ free: value === 'inherit' \? undefined : value === 'yes' \}\)/,
    '免费是三态（继承/免费/收费），不是默认值')
  assert.match(dialog, /t\('proxy\.routePoolMarkWeight'\)/, '倍率输入必须有可见标签')
  assert.match(dialog, /t\('proxy\.routePoolMarkFreeHelp'\)/, '免费与倍率的关系要写清（免费优先）')
  assert.doesNotMatch(dialog, /type="number"/, '数值字段一律用文本草稿，非法输入才不会被吞掉')
})

test('模型管理页按路由顺序合并标注：manual > 渠道目录', () => {
  assert.match(modelList, /getModelMarks\(\)/, '页面必须读手工标注表')
  assert.match(modelList, /const manual = modelMarks\[provider\.id\]\?\.\[model\.displayName\]/)
  assert.match(modelList, /const weight = manual\?\.weight \?\? channelWeight/,
    '手工倍率必须盖住渠道目录（与 mergedHintOf 同序）')
  assert.match(modelList, /const free = manual\?\.free \?\? channelFree/)
  assert.match(modelList, /weightManual: manual\?\.weight !== undefined/, '行上要能说清倍率来自手工标注')
})

test('费用筛选与路由同口径：聚合走成本分类，未知自成一档', () => {
  assert.match(modelList, /costBucketOfAggregateClass\(costClass\)/,
    '聚合行不能因为「没有倍率」就落进未知档，那与路由打分的输入不一致')
  assert.match(modelList, /filtered\.filter\(m => m\.costBucket === costFilter\)/,
    '筛选器必须用算好的档位，而不是从倍率现算一份')
  assert.match(modelList, /AGGREGATE_COST_LABELS\[model\.costClass\]/,
    '聚合行按聚合页同一套成本分类显示')
  assert.match(modelList, /t\('models\.weightNotApplicable'\)/,
    '没有倍率概念的行要显示「不适用」，不能冒充「未标注」')
})

test('上游已报但被变体标记带走的倍率照样拆出来', () => {
  assert.match(catalogParser, /LABEL_SUFFIX_WITH_VARIANT/,
    'buddy 的 `… · x0.03 SG` 形态必须有显式分支')
  assert.match(catalogParser, /return parseRate\(label, withVariant\[2\]\)/,
    '变体形态要把倍率交给同一个归一函数，两处口径不能各写一份')
})

test('新文案两种语言齐全，插值槽一致', () => {
  for (const { name, json } of locales) {
    const proxy = json.proxy
    for (const key of ['routePoolMarkWeight', 'routePoolMarkWeightPlaceholder',
      'routePoolMarkWeightHelp', 'routePoolMarkWeightInvalid', 'routePoolMarkWeightTooLarge',
      'routePoolMarkFree', 'routePoolMarkFreeYes', 'routePoolMarkFreeNo', 'routePoolMarkFreeHelp']) {
      assert.equal(typeof proxy[key], 'string', `${name} 缺 proxy.${key}`)
    }
    assert.equal(slots(proxy.routePoolMarkWeightHelp), '{{max}}', `${name} 的倍率说明只该带 max 一个槽`)
    assert.equal(slots(proxy.routePoolMarkWeightTooLarge), '{{max}}',
      `${name} 的倍率超界提示只该带 max 一个槽`)

    const models = json.models
    for (const key of ['weightNotApplicable', 'weightManualHint']) {
      assert.equal(typeof models[key], 'string', `${name} 缺 models.${key}`)
    }
  }
})
