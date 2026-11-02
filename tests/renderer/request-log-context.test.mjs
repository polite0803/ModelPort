import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')
const locale = file => JSON.parse(read('src/renderer/src/i18n/locales', file))

/**
 * 上下文读数的呈现层门。
 *
 * 主进程写下 `inputTokensEstimate / modelContextWindow / contextFit / contextFitSource`
 * 四个键，渲染层必须同时：读得到（electron.d.ts 镜像了字段）、显示得出（组件里有分支）、
 * 三种状态各占一句（fits / overflow / unknown），并且实测值与判定值不混为一谈。
 * 缺任何一环，日志里那条读数就会退化成「看着有、其实说不出」。
 */

const REQUIRED_KEYS = [
  'inputTokensEstimate',
  'contextFit',
  'contextFitFits',
  'contextFitOverflow',
  'contextFitUnknown',
  'contextFitMeasured',
]

test('请求详情把上下文读数显示出来，三种状态分别成句', () => {
  const source = read('src/renderer/src/components/logs/RequestLogDetail.tsx')

  assert.match(source, /log\.inputTokensEstimate !== undefined/, '估算入量要有渲染分支')
  assert.match(source, /log\.modelContextWindow === undefined/, '没有窗口证据时不能拼出假的「/ 窗口」')
  assert.match(source, /log\.contextFit !== undefined/, 'fit 判定要有渲染分支')
  assert.match(source, /log\.contextFitSource === 'measured'/, '实测与判定要分开显示')
  for (const key of ['Fits', 'Overflow', 'Unknown']) {
    assert.match(source, new RegExp(`contextFit${key}|'${key}'`), `缺 ${key} 一档的分支`)
  }
})

test('两种语言都带齐上下文读数的键（缺译即红）', () => {
  for (const file of ['zh-CN.json', 'en-US.json']) {
    const logs = locale(file).logs
    const missing = REQUIRED_KEYS.filter(key => logs[key] === undefined)
    assert.deepEqual(missing, [], `${file} 缺键：${missing.join(', ')}`)
  }
})

test('渲染层类型镜像了这四个字段（半改状态即红）', () => {
  const dts = read('src/renderer/src/types/electron.d.ts')
  for (const field of [
    'inputTokensEstimate?: number',
    'modelContextWindow?: number',
    "contextFit?: 'fits' | 'overflow' | 'unknown'",
    "contextFitSource?: 'measured'",
  ]) {
    assert.ok(dts.includes(field), `electron.d.ts 缺字段声明：${field}`)
  }
})
