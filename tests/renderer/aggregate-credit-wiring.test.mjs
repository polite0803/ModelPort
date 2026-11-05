/**
 * 「查询实时额度」这条链路的接线门。
 *
 * 这几个文件都吃 Electron 或 JSX，`node --test` 里 import 不进来，所以按本仓对
 * 不可 import 文件的惯例读源码文本断言。要防的是那种"每一环都写了、就是没接上"的
 * 半改状态：按钮存在但通道名拼错、通道接了但界面还在调旧的、快照落盘了但 gate 不读。
 *
 * 四环各断一处：界面按钮 → IPC 通道 → manager 方法 → gate 读取，外加两份 locale
 * 的键集合必须一模一样（缺译在这一屏是静默的）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')

const detailComponent = read('src/renderer/src/components/aggregate/AggregateDetail.tsx')
const channels = read('src/main/ipc/channels.ts')
const handlers = read('src/main/ipc/handlers.ts')
// 环 3 的载体从 `src/preload/index.ts` 搬进了 `src/shared/api.ts`（同一个方法表，
// 桌面装配 ipcRenderer 线、浏览器装配 HTTP 线），所以这里读的是那张表本身。
const preload = read('src/shared/api.ts')
const manager = read('src/main/providers/aggregate/manager.ts')
const gate = read('src/main/proxy/quota/gate.ts')
const store = read('src/main/store/store.ts')
const locales = {
  'en-US': JSON.parse(read('src/renderer/src/i18n/locales/en-US.json')),
  'zh-CN': JSON.parse(read('src/renderer/src/i18n/locales/zh-CN.json')),
}

// —— 环 1：界面。按钮 → preload 的 queryCredits，且没配 Key 时禁用、不发请求。
test('the panel renders one button that calls the preload queryCredits and is disabled without a key', () => {
  assert.match(
    detailComponent,
    /window\.electronAPI\.aggregate\.queryCredits\(entry\.id\)/,
    'the button must call the bridge, not a local stub'
  )
  assert.match(detailComponent, /disabled=\{!hasApiKey \|\| probing\}/, 'no key means no request left the app')
  assert.match(detailComponent, /t\('aggregate\.manage\.credit\.needsKey'\)/, 'and the reason is spelled out')
  assert.match(detailComponent, /probeDeclaration \&\&/, 'the block only renders for entries declaring an endpoint')
  assert.match(detailComponent, /skippedKeys/, 'unqueried keys beyond the cap are shown')
})

// —— 环 1 的另一半：五态徽章一个字都没改，实时余量是旁边独立一行。
test('the five-state badge is untouched and the live row never feeds quotaViewOf', () => {
  assert.match(detailComponent, /t\(`aggregate\.quota\.\$\{view\.state\}`\)/, 'the badge still renders from view.state')
  assert.match(
    detailComponent,
    /const view = quotaViewOf\(entry, \{ hasApiKey, usage \}\)/,
    'quotaViewOf still receives exactly the two inputs it had before - no money folded into the five states'
  )
  assert.doesNotMatch(detailComponent, /quotaViewOf\([^)]*credit/, 'the live row is not an input to the badge')
  // 五态本身不许长出新状态、也不许少一个：两份 locale 的键集合就是它的契约。
  const fiveStates = ['absent', 'documented', 'exhausted', 'needs-key', 'undocumented']
  assert.deepEqual(Object.keys(locales['en-US'].aggregate.quota).sort(), fiveStates)
  assert.deepEqual(Object.keys(locales['zh-CN'].aggregate.quota).sort(), fiveStates)
})

// —— 环 2：IPC 通道名在三个地方拼得完全一样。
test('the channel name is one string across the declaration, the handler and the bridge', () => {
  assert.match(channels, /AGGREGATE_QUERY_CREDITS: 'aggregate:queryCredits'/)
  assert.match(handlers, /registerMainHandler\(IpcChannels\.AGGREGATE_QUERY_CREDITS, async \(_, id: string\)/)
  assert.match(handlers, /aggregateProviderManager\.queryCredits\(id\)/, 'the handler forwards to the manager')
  assert.match(preload, /queryCredits: \(id: string\): Promise<AggregateCreditQueryResult>/)
  assert.match(preload, /wire\.invoke\(IpcChannels\.AGGREGATE_QUERY_CREDITS, id\)/)
})

// —— 环 3：manager 复用了既有鉴权通路，URL 跟着用户配的 base 走。
test('the fetch reuses the stored credential path and the configured base, never a transcribed host', () => {
  const body = manager.slice(manager.indexOf('async queryCredits('), manager.indexOf('private async readCreditAt('))
  assert.ok(body.length > 100, 'queryCredits exists')
  assert.match(body, /trimmed\(provider\.apiEndpoint\)\}\$\{path\}/, 'URL = provider record + declared path')
  assert.match(manager, /axios\.get\(url, \{\s*headers: this\.buildProbeHeaders\(entry, provider, apiKey\)/)
  assert.doesNotMatch(manager, /openrouter\.ai|siliconflow\.(com|cn)/, 'no vendor host is hardcoded in the fetch layer')
  assert.doesNotMatch(body, /console\.(log|warn|error)\([^)]*apiKey/, 'the key is never logged')
  assert.match(manager, /if \(snapshot\.ok\) storeManager\.setAggregateCreditSnapshot\(id, snapshot\)/,
    'a half-answered query writes nothing at all')
})

// —— 环 4：落盘的这一行真的被排序读到。
test('the gate reads the stored row and turns it into the exhausted slot, not into a token ratio', () => {
  assert.match(gate, /storeManager\.getAggregateCreditSnapshot\(entryId\)/,
    'without a shared context the gate still reads the stored row')
  assert.match(gate, /context\.snapshots\(\)\[entryId\]/,
    'with a selection-scoped context the same row comes from the shared snapshot table')
  assert.match(gate, /creditSnapshotExhausted\(snapshot\)/)
  assert.match(gate, /if \(creditExhausted\(provider\.id, context\)\) return 'no-credit'/)
  assert.match(gate, /if \(creditExhausted\(entryId, context\)\) return -1/)
  assert.doesNotMatch(gate, /remaining\s*[*/+-]/, 'a USD/CNY balance is never arithmetically mixed into headroom')
  assert.match(store, /set\('aggregateCreditSnapshots'/)
})

// —— 两份 locale 的键集合一致，且界面用到的每个键都在两份里存在。
test('both shipped locales carry the same credit keys the panel uses', () => {
  const used = [...detailComponent.matchAll(/t\('aggregate\.manage\.credit\.([A-Za-z]+)'/g)].map((m) => m[1])
  assert.ok(used.length >= 10, `expected the panel to use its own copy, got ${used.length}`)

  const en = locales['en-US'].aggregate.manage.credit
  const zh = locales['zh-CN'].aggregate.manage.credit
  assert.ok(en && zh, 'both locales must define aggregate.manage.credit')

  for (const key of used) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en-US is missing aggregate.manage.credit.${key}`)
    assert.ok(typeof zh[key] === 'string' && zh[key].length > 0, `zh-CN is missing aggregate.manage.credit.${key}`)
  }

  // 键集合本身也要一模一样：面板以后加一行，两份一起漏一份就是静默缺译。
  const flat = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]
    )
  assert.deepEqual(flat(zh).sort(), flat(en).sort(), 'en and zh expose the same credit key set')

  // 中文文案必须能逐字核对：不许把中文写成英文占位。
  assert.match(zh.query, /查询/, 'the Chinese label is Chinese')
  assert.match(zh.orderingOff, /过期/, 'the expired marker says 过期, not nothing')
  assert.match(zh.orderingOff, /分钟/, 'the TTL is spelled out so the number can be checked')
})

// —— 失败分类必须有各自的文案，不能统一渲染成"额度为 0"。
test('each failure class has its own copy, and no failure copy reads as a zero balance', () => {
  const en = locales['en-US'].aggregate.manage.credit
  for (const key of ['failHttpStatus', 'failNotJson', 'failShape', 'failNetwork']) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `missing copy for ${key}`)
  }
  assert.equal(en.failShape.includes('0'), false, 'an unrecognised shape must not read as "0 left"')
  assert.deepEqual(Object.keys(en.failure).sort(), ['missing_api_key', 'no_probe', 'not_configured', 'unknown_entry'])
  assert.deepEqual(Object.keys(en.reason).sort(), ['http-status', 'network', 'not-json', 'unexpected-shape'])
})
