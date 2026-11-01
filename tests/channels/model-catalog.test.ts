import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  capabilityHintOf,
  qualifyChannelModel,
  readModelList,
  splitModelLabel,
} from '../../src/main/providers/accountChannels/modelCatalog.ts'

test('the multiplier is split out of the display name', () => {
  assert.deepEqual(splitModelLabel('MiniMax M3 · x4.0'), { name: 'MiniMax M3', free: false, weight: 4 })
  assert.deepEqual(splitModelLabel('Kimi-K3 · x1'), { name: 'Kimi-K3', free: false, weight: 1 })
  assert.deepEqual(splitModelLabel('Spark X2.5 · x0.1'), { name: 'Spark X2.5', free: false, weight: 0.1 })
})

test('a promo window keeps the original rate next to the effective one', () => {
  assert.deepEqual(splitModelLabel('GLM-5-3-Flash · x0.2→x0.1'), {
    name: 'GLM-5-3-Flash',
    free: false,
    weight: 0.1,
    baseWeight: 0.2,
  })
})

test('免费 means weight 0, and a zero rate is free too', () => {
  assert.deepEqual(splitModelLabel('Qwen3.8-Flash · 免费'), { name: 'Qwen3.8-Flash', free: true, weight: 0 })
  assert.deepEqual(splitModelLabel('Zero · x0'), { name: 'Zero', free: true, weight: 0 })
})

test('a label without a rate keeps an unknown weight, never 0', () => {
  // trae/minimax 这类渠道根本不报倍率：把「未知」当成免费会让用户按免费额度
  // 选一个按量计费的模型。
  assert.deepEqual(splitModelLabel('Trae Pro'), { name: 'Trae Pro', free: false })
  assert.equal(splitModelLabel('').weight, undefined)
})

test('model.list payloads are normalised, malformed entries dropped', () => {
  const models = readModelList({
    models: [
      { id: 'MiniMax-M3', name: 'MiniMax M3 · x4.0', disabled: false, dead: false },
      { id: 'Qwen3.8-Flash', name: 'Qwen3.8-Flash · 免费', isFree: true },
      { id: 'paid', name: 'Paid · x2', isFree: true },
      { name: 'no id' },
      'garbage',
      null,
    ],
  })
  assert.deepEqual(models, [
    { id: 'MiniMax-M3', name: 'MiniMax M3', free: false, disabled: false, dead: false, weight: 4 },
    { id: 'Qwen3.8-Flash', name: 'Qwen3.8-Flash', free: true, disabled: false, dead: false, weight: 0 },
    // 免费的唯一判据是权重 0：展示名写了 `x2`，即使上游标了 `isFree` 也不算免费。
    { id: 'paid', name: 'Paid', free: false, disabled: false, dead: false, weight: 2 },
  ])

  assert.deepEqual(readModelList(undefined), [])
  assert.deepEqual(readModelList({ models: 'nope' }), [])
})

test('image support is carried through only when the channel declares it', () => {
  const models = readModelList({
    models: [
      { id: 'vision', name: 'Vision', supportsImage: true },
      { id: 'text-only', name: 'Text', supportsImage: false },
      // 上游没写 / 类型不对时保持「未知」，不能当成「不支持」。
      { id: 'silent', name: 'Silent' },
      { id: 'weird', name: 'Weird', supportsImage: 'yes' },
    ],
  })
  assert.deepEqual(
    models.map((model) => [model.id, model.supportsImage]),
    [
      ['vision', true],
      ['text-only', false],
      ['silent', undefined],
      ['weird', undefined],
    ],
  )
})

test('capability hints carry only what the catalogue actually declares', () => {
  const models = readModelList({
    models: [
      { id: 'vision-free', name: 'Vision Free · 免费', supportsImage: true },
      { id: 'text-paid', name: 'Text Paid · x2', supportsImage: false },
      // 没有任何已知字段：返回 undefined，调用方据此保持「未知」
      { id: 'silent', name: 'Silent' },
    ],
  })

  assert.deepEqual(capabilityHintOf(models[0]), { vision: 'yes', weight: 0, free: true })
  assert.deepEqual(capabilityHintOf(models[1]), { vision: 'no', weight: 2 })
  assert.equal(capabilityHintOf(models[2]), undefined)
})

/**
 * 裸 id 补回渠道前缀（2026-11-01 192.168.85.131 实测 8 笔 400「模型 ID 无效：big-pickle」）。
 *
 * 钉三条方向：已带前缀的**一个字节都不动**（绝大多数请求走这格）；裸名补上
 * **本**渠道 id；带的是**别家**前缀时不擅自改目标 —— 那是用户自己写的映射。
 */
test('qualifyChannelModel keeps an already-qualified id untouched', () => {
  assert.equal(qualifyChannelModel('opencode', 'opencode/big-pickle'), 'opencode/big-pickle')
  // 模型 id 自己带斜杠时，只按第一个斜杠切分，不能切成三段。
  assert.equal(qualifyChannelModel('cline', 'cline/nvidia/beam-free'), 'cline/nvidia/beam-free')
})

test('qualifyChannelModel prefixes a bare id with the provider the host already knows', () => {
  assert.equal(qualifyChannelModel('opencode', 'big-pickle'), 'opencode/big-pickle')
  assert.equal(qualifyChannelModel('qodercn', 'qfmodel'), 'qodercn/qfmodel')
  assert.equal(qualifyChannelModel('opencode', '  big-pickle  '), 'opencode/big-pickle')
})

test('qualifyChannelModel never rewrites another channel as the prefix', () => {
  // 跨渠道的映射值是用户/旧数据写的意图，改它等于替他换供应商；真要出错也该
  // 由那条映射的归属来解释，不在这里悄悄换掉目标。
  assert.equal(qualifyChannelModel('opencode', 'qoder/qfmodel'), 'qoder/qfmodel')
})

test('qualifyChannelModel leaves an empty name empty instead of inventing one', () => {
  assert.equal(qualifyChannelModel('opencode', '   '), '')
})
