import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 声明额度编辑器（`components/providers/DeclaredQuotaEditor.tsx`）的接线。
 *
 * 2026-11-20 从 `AddAccountDialog` 里提成独立组件：账号弹窗与聚合详情页的 Key 行
 * 共用同一份表单，两处各写一份就会在窗口白名单与「无换算字段」上分叉。测试跟着
 * 指向组件本体（而不是它的某个挂载点），谁挂它都不影响这一层判据。
 *
 * 这里钉的是**会静默坏掉**的那一类：`t('providers.declaredQuota')` 打错或漏翻译时，
 * 界面不会报错，只会把键名原样印出来 —— 类型系统看不见，locale-parity 也看不见
 * （它只比中英两侧是否对齐，不比对代码用了哪些键）。所以这一层直接从组件源码里
 * 抓出用到的键，逐个在两种语言里查。
 *
 * 同时钉住本仓的一条硬约束：编辑器只收「窗口 / 单位 / 上限」，**没有**任何把金额
 * 折成 token 的字段。钱与 token 互不可比，加一个换算输入框就是把这条约束拆了。
 */

const root = process.cwd()
const source = readFileSync(
  join(root, 'src/renderer/src/components/providers/DeclaredQuotaEditor.tsx'),
  'utf8',
)

function locale(name) {
  return JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n/locales', `${name}.json`), 'utf8'))
}

/** 组件里出现的 `providers.declared*` 字面键（模板键末尾带 `_`，四档窗口各查一遍）。 */
function declaredKeys() {
  const keys = new Set()
  for (const match of source.matchAll(/providers\.(declared[A-Za-z_]*)/g)) {
    const key = match[1]
    if (key.endsWith('_')) {
      for (const window of ['fiveHour', 'day', 'week', 'month']) keys.add(`${key}${window}`)
      continue
    }
    keys.add(key)
  }
  return [...keys]
}

test('every declared-quota label the editor asks for exists in both locales', () => {
  const keys = declaredKeys()
  assert.ok(keys.length >= 8, `expected the editor's label set, found ${keys.length}: ${keys.join(', ')}`)
  for (const name of ['zh-CN', 'en-US']) {
    const providers = locale(name).providers ?? {}
    const missing = keys.filter(key => typeof providers[key] !== 'string' || providers[key].length === 0)
    assert.deepEqual(missing, [], `${name} is missing providers.${missing.join(', providers.')}`)
  }
})

test('the editor offers exactly the four windows and two units, and no money field', () => {
  // 窗口与单位来自 shared 的白名单，不是组件里另写一份字面量。
  assert.match(source, /DECLARED_QUOTA_WINDOWS\.map\(/)
  assert.match(source, /declaredUnit_requests/)
  assert.match(source, /declaredUnit_tokens/)
  // 币种 / 换算：只在注释里被明确否定（「这里没有折合多少额度这种字段」），
  // 编辑器本体一个都不许出现 —— 钱与 token 互不可比，加一个换算输入框就拆了这条约束。
  const editor = source.slice(source.indexOf('function DeclaredQuotaEditor'))
  assert.doesNotMatch(editor, /currency|exchangeRate|convertTo|折合|换算率/i)
  // 唯一的数字输入是「上限」；两个下拉是窗口与单位。
  const numericInputs = editor.match(/type="number"/g) ?? []
  assert.equal(numericInputs.length, 1, 'the editor takes one number (the limit) and nothing else')
})

test('the editor says the declaration actually blocks requests, in both languages', () => {
  // 「只展示不执行等于把声明当注释」：提示语必须写清楚它会挡发车。
  assert.match(locale('zh-CN').providers.declaredQuotaHint, /挡住请求|挡发车/)
  assert.match(locale('en-US').providers.declaredQuotaHint, /blocks requests/i)
})