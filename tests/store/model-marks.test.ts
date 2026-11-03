/**
 * 手工能力标注的归一测试（`store/modelMarks.ts`）。
 *
 * 手工标注是用户在 UI 上逐字段覆盖自动结果的入口，写入侧必须只保留**有效且显式**
 * 的字段：`unknown` 不是可存的值（它表示"没有证据"，只能靠删除标注表达），空对象
 * 必须归一成 undefined 以便调用方删除整条，而不是存一个空壳遮住自动标注。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeModelMark } from '../../src/main/store/modelMarks.ts'

test('只保留有效的显式字段，unknown / 非法值一律丢弃', () => {
  assert.deepEqual(
    normalizeModelMark({
      tier: 'strong',
      vision: 'yes',
      tools: 'unknown',
      reasoning: 'maybe',
      contextTokens: 128000,
      weight: 0.5,
      free: false,
    }),
    {
      tier: 'strong',
      vision: 'yes',
      contextTokens: 128000,
      weight: 0.5,
      free: false,
    }
  )
})

test('值全是无效字段 / unknown 时归一成 undefined（调用方据此清除整条）', () => {
  assert.equal(normalizeModelMark({ vision: 'unknown' }), undefined)
  assert.equal(normalizeModelMark({ tier: 'godlike' }), undefined)
  assert.equal(normalizeModelMark({}), undefined)
  assert.equal(normalizeModelMark(null), undefined)
  assert.equal(normalizeModelMark('yes'), undefined)
  assert.equal(normalizeModelMark([]), undefined)
})

test('模态去重并丢弃未声明值；全空则整个字段缺失', () => {
  assert.deepEqual(
    normalizeModelMark({ modalities: ['image', 'image', 'hologram', 'text'] }),
    { modalities: ['image', 'text'] }
  )
  assert.equal(normalizeModelMark({ modalities: ['hologram'] }), undefined)
})

test('上下文必须是正整数的有限值，0/负数/小数/超上界都不存', () => {
  assert.equal(normalizeModelMark({ contextTokens: 0 }), undefined)
  assert.equal(normalizeModelMark({ contextTokens: -1 }), undefined)
  assert.equal(normalizeModelMark({ contextTokens: 1.5 }), undefined)
  assert.equal(normalizeModelMark({ contextTokens: Number.POSITIVE_INFINITY }), undefined)
  assert.equal(normalizeModelMark({ contextTokens: 1_000_000_000 }), undefined)
  assert.deepEqual(normalizeModelMark({ contextTokens: 64000 }), { contextTokens: 64000 })
})

test('输出上限：留空不写 0，只存正整数，非法值一律不存', () => {
  // 留空 = 未标注：既不产生字段，也不会被当成 0 写入
  assert.equal(normalizeModelMark({ maxOutputTokens: undefined }), undefined)
  assert.equal(normalizeModelMark({ maxOutputTokens: '' }), undefined)
  assert.equal(normalizeModelMark({ maxOutputTokens: 0 }), undefined)
  assert.equal(normalizeModelMark({ maxOutputTokens: -1 }), undefined)
  assert.equal(normalizeModelMark({ maxOutputTokens: 1.5 }), undefined)
  assert.equal(normalizeModelMark({ maxOutputTokens: '8192' }), undefined)
  assert.equal(normalizeModelMark({ maxOutputTokens: 1_000_001 }), undefined)
  assert.deepEqual(normalizeModelMark({ maxOutputTokens: 1_000_000 }), { maxOutputTokens: 1_000_000 })
  assert.deepEqual(normalizeModelMark({ maxOutputTokens: 8192 }), { maxOutputTokens: 8192 })
})

test('倍率允许 0（免费）但不接受负数或非数值', () => {
  assert.deepEqual(normalizeModelMark({ weight: 0 }), { weight: 0 })
  assert.equal(normalizeModelMark({ weight: -1 }), undefined)
  assert.equal(normalizeModelMark({ weight: '0.5' }), undefined)
})
