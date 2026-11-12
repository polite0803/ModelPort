import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const detail = readFileSync(
  join(root, 'src/renderer/src/components/logs/RequestLogDetail.tsx'),
  'utf8',
)
const locales = ['zh-CN', 'en-US'].map((name) => {
  const json = JSON.parse(
    readFileSync(join(root, `src/renderer/src/i18n/locales/${name}.json`), 'utf8'),
  )
  return { name, logs: json.logs, settings: json.settings }
})

test('「没开正文记录」和「这次没有正文」是两句，不共用“暂无数据”', () => {
  assert.match(detail, /includeBodies === false/, 'detail must read the body-logging switch')
  assert.match(detail, /t\('logs\.bodiesNotRecorded'\)/, 'the disabled state needs its own sentence')
  assert.match(detail, /t\('logs\.bodiesNotRecordedHint'\)/, 'and a hint on how to turn it on')
  assert.match(detail, /t\('logs\.noRequestData'\)/, 'a recorded-but-empty body keeps the generic line')
})

test('采样开着时「没抽中」是第三种缺席，不能说成「开关关了」', () => {
  assert.match(detail, /bodySampleRate/, 'detail must read the sample rate')
  assert.match(detail, /t\('logs\.bodyNotSampled'\)/, 'the sampled-out state needs its own sentence')
  assert.match(detail, /t\('logs\.bodyNotSampledHint'\)/, 'and a hint naming the knob that changes it')
})

test('两种语言都写全缺席文案，且提示点名设置里那个开关', () => {
  for (const { name, logs, settings } of locales) {
    assert.equal(typeof logs.bodiesNotRecorded, 'string', `${name} 缺 logs.bodiesNotRecorded`)
    assert.equal(typeof logs.bodiesNotRecordedHint, 'string', `${name} 缺 logs.bodiesNotRecordedHint`)
    assert.ok(logs.bodiesNotRecordedHint.length > 10, `${name} 的提示是一句空话`)
    assert.ok(
      logs.bodiesNotRecordedHint.includes(settings.requestLogIncludeBodies),
      `${name} 的提示没有点名「${settings.requestLogIncludeBodies}」开关`,
    )
    assert.equal(typeof logs.bodyNotSampled, 'string', `${name} 缺 logs.bodyNotSampled`)
    assert.equal(typeof logs.bodyNotSampledHint, 'string', `${name} 缺 logs.bodyNotSampledHint`)
    assert.ok(
      logs.bodyNotSampledHint.includes(settings.requestLogBodySampleRate),
      `${name} 的提示没有点名「${settings.requestLogBodySampleRate}」`,
    )
  }
})
