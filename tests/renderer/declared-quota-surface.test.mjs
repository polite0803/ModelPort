/**
 * 声明额度展示面的接线门（渲染层文本断言）。
 *
 * 钉三件会静默退化的事：
 * 1. 账号列表与详情都真的挂了只读声明行 —— 只在编辑弹窗能写、页面上永远看不到等于没做；
 * 2. renderer 只用 shared 的纯函数算自然窗口复位，且滚动窗口明确写「复位时刻未知」——
 *    renderer 没有账本 oldestAt，猜一个「约」就是编造；
 * 3. 两份 locale 都有用到的键，中文文案不落英文占位。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const list = read('src/renderer/src/components/providers/AccountList.tsx')
const detail = read('src/renderer/src/components/providers/AccountDetail.tsx')
const rows = read('src/renderer/src/components/providers/DeclaredQuotaRows.tsx')
const barrel = read('src/renderer/src/components/providers/index.ts')
const locales = ['zh-CN', 'en-US'].map(name => ({
  name,
  data: JSON.parse(read(`src/renderer/src/i18n/locales/${name}.json`)),
}))

test('both account surfaces mount the read-only declared-quota row', () => {
  assert.match(barrel, /export \{ DeclaredQuotaRows \} from '\.\/DeclaredQuotaRows'/)
  for (const [name, source] of [['AccountList', list], ['AccountDetail', detail]]) {
    assert.match(source, /import \{ DeclaredQuotaRows \} from '\.\/DeclaredQuotaRows'/,
      `${name} must import the shared row`)
    assert.match(source, /<DeclaredQuotaRows quota=\{account\.declaredQuota\}/,
      `${name} must pass the account's declarations through`)
  }
})

test('natural windows use the shared pure function; rolling windows do not guess', () => {
  assert.match(rows, /from '@shared\/declaredQuota'/, 'only the shared pure functions are available in renderer')
  assert.doesNotMatch(rows, /proxy\/quota\/gate/, 'renderer must not reach into main-process quota logic')
  assert.match(rows, /anchoredWindow\(row\.window, now\)\.resetAt/, 'week/month get the exact UTC boundary')
  assert.match(rows, /t\('routes\.quotaResetExact'/, 'and it is labelled as an exact reset')
  assert.match(rows, /t\('routes\.quotaResetUnknown'/, 'fiveHour/day say the reset is unknown')
  assert.doesNotMatch(rows, /quotaResetApprox/, 'no guessed "about" without the ledger input')
})

test('every label the row asks for exists in both locales', () => {
  const used = [...rows.matchAll(/t\('(providers\.declared[A-Za-z_]+|routes\.quotaReset[A-Za-z]+)'/g)]
    .map(m => m[1])
  assert.ok(used.includes('providers.declaredQuotaRow'))
  assert.ok(used.includes('routes.quotaResetExact'))
  assert.ok(used.includes('routes.quotaResetUnknown'))
  for (const { name, data } of locales) {
    for (const key of used) {
      const [ns, ...rest] = key.split('.')
      const leaf = rest.reduce((obj, part) => obj?.[part], data[ns])
      assert.equal(typeof leaf, 'string', `${name} is missing ${key}`)
      assert.ok(leaf.length > 0)
    }
  }
  assert.match(locales[0].data.providers.declaredQuotaRow, /上限/, 'the Chinese label is Chinese')
})
