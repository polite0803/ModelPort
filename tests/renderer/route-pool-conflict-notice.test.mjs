import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function locale(file) {
  return JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n/locales', file), 'utf8'))
}

test('路由池编辑器把「或」作废前置筛选的冲突说出来，而不是让人对着空池猜', () => {
  const source = readFileSync(
    join(root, 'src/renderer/src/components/proxy/RoutePoolEditor.tsx'),
    'utf8',
  )

  // 消费的是 preview.conflicts（预览层的真返回值），不是自己再算一遍
  assert.match(source, /preview && preview\.conflicts\.length > 0/)
  assert.match(source, /\{t\('proxy\.routePoolConflict',/)
  assert.match(source, /strategy: t\(`proxy\.autoRoutingPoolStrategy_\$\{conflict\.id\}`\)/)
  assert.match(source, /count: conflict\.adds/)
  assert.match(
    source,
    /broken: conflict\.breaks[\s\S]{0,200}?entry\.strategy/,
    '每条被作废的策略要单独计数显示，不能只报一个总数',
  )
})

test('两种语言的 routePoolConflict 都带齐三个插值槽', () => {
  for (const file of ['zh-CN.json', 'en-US.json']) {
    const value = locale(file).proxy.routePoolConflict
    assert.ok(typeof value === 'string' && value.length > 0, `${file} 缺 routePoolConflict`)
    for (const slot of ['{{strategy}}', '{{count}}', '{{broken}}']) {
      assert.ok(value.includes(slot), `${file} 的 routePoolConflict 缺插值槽 ${slot}`)
    }
  }
})
