/**
 * 「重点」名单的边界契约。
 *
 * 它独立于能力标注：归一层只回答「这份表合法吗」，不解释模型能力；派发侧用
 * `isKeyModel` 精确查表。路由比例由 `tests/routes/key-model-strict-weight.test.ts` 证明。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isKeyModel, normalizeKeyModels } from '../../src/main/store/keyModels.ts'

test('重点名单归一：trim、去重、丢掉非字符串与非数组', () => {
  assert.deepEqual(
    normalizeKeyModels({
      ' pa ': [' Alpha ', 'Alpha', 42, '', 'Beta'],
      pb: 'not-an-array',
      pc: [],
    }),
    { pa: ['Alpha', 'Beta'] },
  )
})

test('坏输入安全落空；空名单不是 undefined', () => {
  assert.deepEqual(normalizeKeyModels(null), {})
  assert.deepEqual(normalizeKeyModels([]), {})
  assert.deepEqual(normalizeKeyModels({}), {})
})

test('查表按展示名原文精确匹配，打错就是没标', () => {
  const table = normalizeKeyModels({ pa: ['Alpha'] })
  assert.equal(isKeyModel(table, 'pa', 'Alpha'), true)
  assert.equal(isKeyModel(table, 'pa', 'alpha'), false)
  assert.equal(isKeyModel(table, 'pb', 'Alpha'), false)
})
