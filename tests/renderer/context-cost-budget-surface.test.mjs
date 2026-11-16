import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 成本目标（`costBudgetByProvider`）在控制台上的接线。
 *
 * 钉的是「会静默坏掉」的那一类：键名打错或漏翻译时界面不报错，只把键名原样印出来，
 * 类型系统看不见、locale-parity 也看不见（它只比中英两侧对齐，不比对代码用了哪些键）。
 *
 * 另有一条本仓硬约束：成本目标**只能收紧窗口**。所以这里同时钉住输入框不会去动
 * `maxTokens`（窗口）—— 一个把两者混在一起的编辑框，就是把 2026-11-16 那个
 * 「按渠道写死窗口」的缺陷请回来。
 */

const root = process.cwd()
const componentPath = 'src/renderer/src/components/proxy/ContextManagement.tsx'
const source = readFileSync(join(root, componentPath), 'utf8')

function locale(name) {
  return JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n/locales', `${name}.json`), 'utf8'))
}

/** 组件里用到的 `contextManagement.tokenLimit.*` 键。 */
function tokenLimitKeys() {
  const keys = new Set()
  for (const match of source.matchAll(/contextManagement\.tokenLimit\.([A-Za-z]+)/g)) {
    keys.add(match[1])
  }
  return [...keys]
}

test('成本目标的标签在两种语言里都有，不是把键名印到界面上', () => {
  const keys = tokenLimitKeys()
  assert.ok(keys.includes('costBudget'), `expected the cost-budget label, got: ${keys.join(', ')}`)
  assert.ok(keys.includes('costBudgetHint'), '提示语也要在源码里被引用')
  for (const name of ['zh-CN', 'en-US']) {
    const block = locale(name).contextManagement?.tokenLimit ?? {}
    const missing = keys.filter(key => typeof block[key] !== 'string' || block[key].length === 0)
    assert.deepEqual(missing, [], `${name} 缺 contextManagement.tokenLimit.${missing.join(', ')}`)
  }
})

test('提示语说清三件事：只收紧、装不下会退回、按渠道', () => {
  const zh = locale('zh-CN').contextManagement.tokenLimit.costBudgetHint
  const en = locale('en-US').contextManagement.tokenLimit.costBudgetHint
  // 「只能收紧不能放大」是这条设计的核心不变量，界面必须说出来。
  assert.match(zh, /只能收紧/)
  assert.match(en, /only tighten/i)
  // 「装不下会退回窗口」—— 用户否则会以为填了就一定生效。
  assert.match(zh, /退回窗口/)
  assert.match(en, /window wins/i)
})

test('编辑器写的是 costBudgetByProvider，不是 maxTokens（窗口）', () => {
  // 成本目标是开销上限，窗口是上游事实；一个输入框同时改两者就是回到旧缺陷。
  assert.match(source, /costBudgetByProvider: parseCostBudget\(/)
  const budgetBlock = source.slice(
    source.indexOf('id="context-cost-budget"') - 200,
    source.indexOf('id="context-cost-budget"') + 1600,
  )
  assert.doesNotMatch(budgetBlock, /maxTokens\s*:/, '成本目标的输入不许改写窗口预算')
})

test('坏行整条丢弃：0 / 负数 / 非数字都不落盘', () => {
  const body = source.slice(
    source.indexOf('function parseCostBudget'),
    source.indexOf('function formatCostBudget'),
  )
  assert.match(body, /tokens <= 0/, '0 或负数丢弃 —— 0 会把历史裁到只剩最新一条')
  assert.match(body, /Number\.isFinite/, '非数字丢弃，不是折成 NaN 落盘')
})