import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 批 C：编辑器「未解析」区的一键清理。供应商/模型停用或删除后，include/exclude/pin 里
 * 指向它们的引用不会再进池（`applyManualModelSelection` 只从已门控的基底捞），但配置里
 * 仍留着死引用，逐条点减号太繁琐。这里钉的是四件会悄悄退化的事：
 * 1. 清理消费的是 `preview.manual.unresolved`（与逐条减号同一份名单），不是另算一套；
 * 2. 三个手动名单（include/exclude/pin）整批剔除，且复用 `withoutRef`（大小写不敏感引用键），
 *    与逐条 `resetManual` 同口径 —— 少剔一个名单就留下「清了 include 却还在 pin 里」的死引用；
 * 3. 空名单早退、按钮只在有失效引用时渲染，不给一个点了没反应的死按钮；
 * 4. 文案两种语言各写全，且是静态标签（无插值槽）。
 */
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const read = (path) => readFileSync(join(root, path), 'utf8')

const editor = read('src/renderer/src/components/proxy/RoutePoolEditor.tsx')
const locales = ['zh-CN', 'en-US'].map(name => ({
  name,
  json: JSON.parse(read(`src/renderer/src/i18n/locales/${name}.json`)),
}))
const slots = text => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort().join(',')

test('一键清理消费同一份 unresolved 名单，三个手动名单整批剔除', () => {
  assert.match(editor, /const clearUnresolved = \(\) => \{/, '缺批量清理动作')
  assert.match(editor, /const stale = preview\?\.manual\.unresolved \?\? \[\]/,
    '必须读预览给出的失效名单，不许另算一套（否则与逐条减号口径漂移）')
  assert.match(editor, /if \(stale\.length === 0\) return/, '空名单要早退，不发一次空 onChange')
  assert.match(editor, /stale\.reduce\(\(acc, ref\) => withoutRef\(acc, ref\.providerId, ref\.displayName\), refs\)/,
    '复用 withoutRef（大小写不敏感引用键），与逐条 resetManual 同口径')
  assert.match(editor, /includeModels: strip\(values\.includeModels\)/, 'include 名单要剔')
  assert.match(editor, /excludeModels: strip\(values\.excludeModels\)/, 'exclude 名单要剔')
  assert.match(editor, /pinModels: strip\(values\.pinModels\)/, 'pin 名单要剔（少剔一个就留死引用）')
})

test('按钮挂在未解析区、只在有失效引用时渲染，文案走 i18n', () => {
  assert.match(editor, /preview && preview\.manual\.unresolved\.length > 0 &&/,
    '整块（含按钮）只在有失效引用时渲染，不留死按钮')
  assert.match(editor, /onClick=\{clearUnresolved\}/, '按钮要真的接到批量清理动作')
  assert.match(editor, /\{t\('proxy\.routePoolClearUnresolved'\)\}/, '按钮文案走 i18n，不许写死')
  assert.match(editor, /<Trash2 className="mr-1 h-3 w-3" \/>/, '清理按钮带删除图标，与逐条减号区分')
})

test('清理文案两种语言各写全，且是静态标签（无插值槽）', () => {
  for (const { name, json } of locales) {
    const label = json.proxy.routePoolClearUnresolved
    assert.equal(typeof label, 'string', `${name} 缺 proxy.routePoolClearUnresolved`)
    assert.ok(label.trim().length > 0, `${name} 的清理文案是一句空话`)
    assert.equal(slots(label), '', `${name} 的清理按钮是静态标签，不该带插值槽`)
  }
})
