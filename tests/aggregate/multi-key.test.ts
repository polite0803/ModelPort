import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeAggregateKeys,
  normalizeAggregateModelParams,
  mergeAggregateModelIds,
  AGGREGATE_RESERVED_PARAM_KEYS,
} from '../../src/shared/aggregate.ts'

test('key list normalization trims, dedupes and drops empty lines', () => {
  const keys = normalizeAggregateKeys({ apiKeys: ['  k1 ', '', 'k2', 'k1', '\tk3\t'] })
  assert.deepEqual(keys, ['k1', 'k2', 'k3'])
})

test('key list normalization returns undefined when neither field is provided', () => {
  assert.equal(normalizeAggregateKeys(undefined), undefined)
  assert.equal(normalizeAggregateKeys({}), undefined)
  assert.equal(normalizeAggregateKeys({ apiKeys: undefined, apiKey: undefined }), undefined)
})

test('key list normalization keeps a provided-but-empty list as empty', () => {
  // 空列表 = 调用方明确说了"换成这组"；管理器再决定它是报错还是沿用
  assert.deepEqual(normalizeAggregateKeys({ apiKeys: [] }), [])
  assert.deepEqual(normalizeAggregateKeys({ apiKeys: ['   ', ''] }), [])
})

test('key list normalization merges the legacy single key into the list', () => {
  assert.deepEqual(normalizeAggregateKeys({ apiKey: ' solo ' }), ['solo'])
  assert.deepEqual(
    normalizeAggregateKeys({ apiKeys: ['a'], apiKey: ' b ' }),
    ['a', 'b'],
  )
  // 同一把 Key 两种写法只留一份
  assert.deepEqual(normalizeAggregateKeys({ apiKeys: ['a'], apiKey: 'a' }), ['a'])
})

test('param normalization drops reserved keys and empty values', () => {
  assert.deepEqual(
    normalizeAggregateModelParams({
      'glm-5.2': {
        temperature: 0.6,
        max_tokens: 4096,
        // 保留字段与空值一律不进结果
        model: 'should-not-pass',
        messages: 'nope',
        stream: true,
        seed: null,
        top_k: '',
        presence_penalty: undefined,
      },
    } as never),
    { 'glm-5.2': { temperature: 0.6, max_tokens: 4096 } },
  )
  assert.ok(AGGREGATE_RESERVED_PARAM_KEYS.includes('model'))
})

test('param normalization drops a model whose only values are empty', () => {
  assert.deepEqual(
    normalizeAggregateModelParams({ m: { temperature: '' } }),
    {},
  )
})

test('param normalization prunes models outside the allowed set', () => {
  const allowed = new Set(['m1'])
  assert.deepEqual(
    normalizeAggregateModelParams({ m1: { temperature: 1 }, orphan: { seed: 1 } }, allowed),
    { m1: { temperature: 1 } },
  )
  // 未给允许集合时不裁剪（发现模型重写清单前沿用旧参数）
  assert.deepEqual(
    normalizeAggregateModelParams({ m1: { temperature: 1 }, orphan: { seed: 1 } }),
    { m1: { temperature: 1 }, orphan: { seed: 1 } },
  )
})

test('param normalization rejects malformed entries and tolerates undefined input', () => {
  assert.deepEqual(normalizeAggregateModelParams(undefined), {})
  assert.deepEqual(
    normalizeAggregateModelParams({ broken: null, alsoBroken: [1, 2] } as never),
    {},
  )
})

test('online sync merges: current list keeps its order, new upstream ids are appended', () => {
  assert.deepEqual(
    mergeAggregateModelIds(['glm-4.6', 'glm-4.5'], ['glm-4.5', 'glm-5', 'glm-4.6-plus']),
    ['glm-4.6', 'glm-4.5', 'glm-5', 'glm-4.6-plus'],
  )
})

test('add-only sync (models.dev fallback) keeps every current id when upstream answers nothing', () => {
  assert.deepEqual(mergeAggregateModelIds(['kept'], []), ['kept'])
})

test('true sync drops ids the upstream no longer reports, keeping survivors in order', () => {
  assert.deepEqual(
    mergeAggregateModelIds(['glm-4.6', 'glm-4.5'], ['glm-4.5', 'glm-5'], { removeMissing: true }),
    ['glm-4.5', 'glm-5'],
  )
})

test('true sync appends new ids after the survivors instead of taking upstream order', () => {
  assert.deepEqual(
    mergeAggregateModelIds(['a', 'b', 'c'], ['c', 'a', 'd'], { removeMissing: true }),
    ['a', 'c', 'd'],
  )
})

test('true sync with an empty upstream answer removes everything it cannot confirm', () => {
  assert.deepEqual(mergeAggregateModelIds(['a', 'b'], [], { removeMissing: true }), [])
})

test('online sync trims, dedupes and drops blank ids from both sides', () => {
  assert.deepEqual(
    mergeAggregateModelIds([' a ', '', 'b'], [' b ', 'c', '\t', ' a ']),
    ['a', 'b', 'c'],
  )
})

test('online sync into an empty record yields the upstream order', () => {
  assert.deepEqual(mergeAggregateModelIds([], ['x', 'y']), ['x', 'y'])
})
