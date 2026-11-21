/**
 * 聚合详情页的「声明额度」接线（渲染层文本断言）。
 *
 * 钉四件会静默退化的事：
 * 1. `KeysCard` 每个 Key 行真的挂了 `<DeclaredQuotaRows>` —— 只在编辑框能写、页面上
 *    永远看不到，等于还要去别的页面才知道自己声明了什么；
 * 2. 编辑入口调的是 `aggregate.setKeyQuota`，不是 `accounts.update` 之类的另一条路；
 * 3. 模板库由 `useDeclaredQuotaTemplates` 提供，且模板**只填表单**（不直接落盘成账号声明）；
 * 4. 两份 locale 都有用到的键，中文文案不落英文。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const detail = read('src/renderer/src/components/aggregate/AggregateDetail.tsx')
const editor = read('src/renderer/src/components/providers/DeclaredQuotaEditor.tsx')
const hook = read('src/renderer/src/components/providers/useDeclaredQuotaTemplates.ts')
const rows = read('src/renderer/src/components/providers/DeclaredQuotaRows.tsx')
const barrel = read('src/renderer/src/components/providers/index.ts')
const locales = ['zh-CN', 'en-US'].map(name => ({
  name,
  data: JSON.parse(read(`src/renderer/src/i18n/locales/${name}.json`)),
}))

test('the aggregate key card renders the read-only declared-quota row per key', () => {
  assert.match(detail, /import \{[^}]*DeclaredQuotaRows[^}]*\} from '\.\.\/providers'/)
  assert.match(detail, /<DeclaredQuotaRows quota=\{key\.declaredQuota\}/,
    'each key row must show what the user declared for that key')
})

test('editing a key quota goes through aggregate.setKeyQuota, not the generic accounts channel', () => {
  assert.match(detail, /window\.electronAPI\.aggregate\.setKeyQuota\(key\.id, quotaDraft\)/,
    'the write path is the aggregate channel')
  assert.doesNotMatch(detail.slice(detail.indexOf('handleSaveQuota')), /accounts\.update/,
    'never route it through the generic account update from this panel')
})

test('the editor is shared, and the aggregate panel mounts it with templates wired', () => {
  assert.match(barrel, /export \{ DeclaredQuotaEditor \} from '\.\/DeclaredQuotaEditor'/)
  assert.match(barrel, /export \{ useDeclaredQuotaTemplates \} from '\.\/useDeclaredQuotaTemplates'/)
  const mount = detail.slice(detail.indexOf('<DeclaredQuotaEditor'))
  assert.match(mount, /templates=\{templateApi\.templates\}/, 'templates come from the shared hook')
  assert.match(mount, /onSaveTemplate=/, 'the user can save the current form as a template')
})

test('a template only fills the form; it never writes an account declaration by itself', () => {
  // 选中模板 → 只调 onChange（受控表单），不得出现 "选中即写库" 的调用
  const apply = editor.slice(editor.indexOf('const applyTemplate'), editor.indexOf('const saveTemplate'))
  assert.match(apply, /onChange\(normalizeDeclaredQuota\(template\.limits\)\)/, 'fills the form')
  assert.doesNotMatch(apply, /electronAPI/, 'selection must not hit any IPC')
  // 删模板同样不碰账号：hook 里的删除只写配置
  const del = hook.slice(hook.indexOf('const deleteTemplate'))
  assert.doesNotMatch(del, /accounts\./, 'deleting a template must not touch account records')
  assert.match(hook, /config\.update\(\{ declaredQuotaTemplates/, 'templates live in config')
})

test('natural windows carry an explicit UTC-boundary caveat', () => {
  assert.match(rows, /isNatural &&/, 'week/month get the caveat, rolling windows do not')
  assert.match(rows, /t\('routes\.quotaUtcShort'\)/)
})

test('every label these surfaces ask for exists in both locales', () => {
  const used = new Set()
  for (const source of [detail, editor, rows]) {
    for (const match of source.matchAll(/t\('(providers\.declared[A-Za-z_]+|aggregate\.manage\.keys\.quota|routes\.quotaUtcShort)'/g)) {
      used.add(match[1])
    }
  }
  assert.ok(used.size >= 8, `expected the declared-quota label set, found ${used.size}`)
  for (const { name, data } of locales) {
    for (const key of used) {
      const [ns, ...rest] = key.split('.')
      const leaf = rest.reduce((obj, part) => obj?.[part], data[ns])
      assert.equal(typeof leaf, 'string', `${name} is missing ${key}`)
      assert.ok(leaf.length > 0, `${name} has an empty value for ${key}`)
    }
  }
  assert.match(locales[0].data.providers.declaredTemplateHint, /模板|套餐/, 'the Chinese hint stays Chinese')
})
