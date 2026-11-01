import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyServed,
  buildModelCatalogue,
  isModelRoutable,
  matchesCatalogueName,
  namespaceModelOverrides,
} from '../../src/main/store/modelServing.ts'

test('the catalogue keeps a stopped model and marks it unserved', () => {
  const catalogue = buildModelCatalogue(
    ['a', 'b'],
    { a: 'upstream-a' },
    { addedModels: [], excludedModels: ['b'] }
  )

  assert.deepEqual(catalogue, [
    { displayName: 'a', actualModelId: 'upstream-a', isCustom: false, source: 'builtin', served: true },
    { displayName: 'b', actualModelId: 'b', isCustom: false, source: 'builtin', served: false },
  ])
})

test('a hand-added model is stopped by the same ledger as a shipped one', () => {
  const catalogue = buildModelCatalogue([], {}, {
    addedModels: [{ displayName: 'mine', actualModelId: 'mine-upstream' }],
    excludedModels: ['mine'],
    fetchedModels: [{ displayName: 'synced', actualModelId: 'synced' }],
  })

  assert.deepEqual(catalogue.map(m => [m.displayName, m.source, m.served]), [
    ['mine', 'custom', false],
    ['synced', 'fetched', true],
  ])
})

test('a synced name already carried by the shipped list is never duplicated', () => {
  const catalogue = buildModelCatalogue(['dup'], {}, {
    addedModels: [],
    excludedModels: [],
    fetchedModels: [{ displayName: 'dup', actualModelId: 'other' }],
  })

  assert.equal(catalogue.length, 1)
  assert.equal(catalogue[0].actualModelId, 'dup')
})

test('applyServed returns a new array and only touches the named models', () => {
  const before = ['x', 'y']
  const stopped = applyServed(before, ['z'], false)

  assert.deepEqual(stopped, ['x', 'y', 'z'])
  assert.deepEqual(before, ['x', 'y'], 'the caller array must not be mutated')
  assert.deepEqual(applyServed(stopped, ['x'], true), ['y', 'z'])
})

test('stopping every model empties the served slice while the catalogue stays listed', () => {
  const shipped = ['a', 'b']
  const stopped = applyServed([], shipped, false)
  const catalogue = buildModelCatalogue(shipped, {}, { addedModels: [], excludedModels: stopped })

  assert.equal(catalogue.filter(m => m.served).length, 0)
  assert.equal(catalogue.length, 2, 'a stopped model must stay on the page so it can be started again')
})

test('a served name routes', () => {
  assert.equal(
    isModelRoutable({ model: 'kilo/gpt-4o', servedNames: ['kilo/gpt-4o'], hasCatalogue: true }),
    true
  )
})

test('a stopped name never routes, not even through its own mapping', () => {
  const mapping = { actualModel: 'gpt-4o', preferredProviderId: 'kilo' }
  const stopped = isModelRoutable({ model: 'kilo/gpt-4o', servedNames: [], hasCatalogue: true, mapping })

  assert.equal(stopped, false)
})

test('a provider with no catalogue is the only wildcard case', () => {
  assert.equal(isModelRoutable({ model: 'anything', servedNames: [], hasCatalogue: false }), true)
  assert.equal(isModelRoutable({ model: 'anything', servedNames: [], hasCatalogue: true }), false)
})

test('a user alias routes through its target only while that target is served', () => {
  const mapping = { actualModel: 'kilo/gpt-4o' }
  assert.equal(
    isModelRoutable({ model: 'my-alias', servedNames: ['kilo/gpt-4o'], hasCatalogue: true, mapping }),
    true
  )
  assert.equal(
    isModelRoutable({ model: 'my-alias', servedNames: [], hasCatalogue: true, mapping }),
    false
  )
})

test('a disabled alias never routes, and its stop does not touch the catalogue row', () => {
  const disabled = { actualModel: 'kilo/gpt-4o', disabled: true }
  assert.equal(
    isModelRoutable({ model: 'my-alias', servedNames: ['kilo/gpt-4o'], hasCatalogue: true, mapping: disabled }),
    false,
    '别名停用后，即使目标模型正在服务，这个名字也不再被认识'
  )
  assert.equal(
    isModelRoutable({ model: 'kilo/gpt-4o', servedNames: ['kilo/gpt-4o'], hasCatalogue: true, mapping: disabled }),
    true,
    '同一张映射表里的记录被停用，不牵连目录里那一行 —— 两本账各记各的'
  )
})

test('catalogue matching is case-insensitive and honours a trailing wildcard', () => {
  assert.equal(matchesCatalogueName('Kilo-GPT-4o', 'kilo-gpt-4o'), true)
  assert.equal(matchesCatalogueName('gpt-4o-mini', 'gpt-4o*'), true)
  assert.equal(matchesCatalogueName('glm-4', 'gpt-4o*'), false)
  assert.equal(matchesCatalogueName('gpt-4o', 'gpt-4o'), true)
  assert.equal(matchesCatalogueName('gpt-4o-mini', 'gpt-4o'), false)
})

test('an old bare-name opencode sync moves into the provider namespace instead of duplicating the shipped rows', () => {
  const overrides = {
    addedModels: [],
    excludedModels: ['big-pickle', 'DeepSeek V4.1 Flash Free'],
    fetchedModels: [
      { displayName: 'big-pickle', actualModelId: 'big-pickle' },
      { displayName: 'DeepSeek V4.1 Flash Free', actualModelId: 'deepseek-v4.1-flash-free' },
    ],
  }
  const { next, changed } = namespaceModelOverrides(overrides, 'opencode')

  assert.equal(changed, true)
  // 展示名一律按 actualModelId（上游权威的裸 id）改名
  assert.deepEqual(next.fetchedModels, [
    { displayName: 'opencode/big-pickle', actualModelId: 'big-pickle' },
    { displayName: 'opencode/deepseek-v4.1-flash-free', actualModelId: 'deepseek-v4.1-flash-free' },
  ])
  // 停用名单两个都要跟上：裸 id 直接加前缀，旧展示名按旧→新对照表翻
  assert.deepEqual(next.excludedModels, ['opencode/big-pickle', 'opencode/deepseek-v4.1-flash-free'])
})

test('the namespace rename is idempotent and never touches hand-added models', () => {
  const overrides = {
    addedModels: [{ displayName: 'my-model', actualModelId: 'bare-upstream' }],
    excludedModels: ['opencode/big-pickle'],
    fetchedModels: [{ displayName: 'opencode/big-pickle', actualModelId: 'big-pickle' }],
  }
  const first = namespaceModelOverrides(overrides, 'opencode')

  assert.equal(first.changed, false)
  assert.equal(first.next, overrides, 'nothing to do must return the caller object untouched')

  const second = namespaceModelOverrides(first.next, 'opencode')
  assert.equal(second.changed, false)
  assert.deepEqual(second.next.fetchedModels, [{ displayName: 'opencode/big-pickle', actualModelId: 'big-pickle' }])
})

test('migrated overrides merge into the namespaced shipped list without duplicate rows', () => {
  const shipped = ['opencode/big-pickle', 'opencode/deepseek-v4.1-flash-free']
  const mappings = Object.fromEntries(shipped.map(name => [name, name.slice('opencode/'.length)]))
  const overrides = {
    addedModels: [],
    excludedModels: [],
    fetchedModels: [{ displayName: 'deepseek-v4.1-flash-free', actualModelId: 'deepseek-v4.1-flash-free' }],
  }
  const migrated = namespaceModelOverrides(overrides, 'opencode')
  const catalogue = buildModelCatalogue(shipped, mappings, migrated.next)

  assert.deepEqual(
    catalogue.map(model => [model.displayName, model.actualModelId, model.source, model.served]),
    [
      ['opencode/big-pickle', 'big-pickle', 'builtin', true],
      ['opencode/deepseek-v4.1-flash-free', 'deepseek-v4.1-flash-free', 'builtin', true],
    ]
  )
})
