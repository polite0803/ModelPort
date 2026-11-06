import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  clearCatalogMissCooldowns,
  isCatalogMissCoolingDown,
  recordCatalogMiss,
} from '../../src/main/proxy/modelCatalogCooldown.ts'

beforeEach(() => clearCatalogMissCooldowns())

test('命中后进入冷却，到期自动解除', () => {
  const now = 1_800_000_000_000
  recordCatalogMiss('modelscope', 'Tencent-Hunyuan/Hy3', now)
  assert.equal(isCatalogMissCoolingDown('modelscope', 'Tencent-Hunyuan/Hy3', now + 1), true)
  assert.equal(
    isCatalogMissCoolingDown('modelscope', 'Tencent-Hunyuan/Hy3', now + 6 * 60 * 60 * 1000 - 1),
    true,
  )
  assert.equal(
    isCatalogMissCoolingDown('modelscope', 'Tencent-Hunyuan/Hy3', now + 6 * 60 * 60 * 1000),
    false,
  )
})

test('冷却按 (provider, model) 分开：同家的别的模型不受影响', () => {
  const now = 1_800_000_000_000
  recordCatalogMiss('modelscope', 'Tencent-Hunyuan/Hy3', now)
  assert.equal(isCatalogMissCoolingDown('modelscope', 'Qwen/Qwen3.5-27B', now), false)
  assert.equal(isCatalogMissCoolingDown('bazaarlink', 'Tencent-Hunyuan/Hy3', now), false)
})

test('空 id 不记：适配器没填模型时不能变成全域冷却', () => {
  recordCatalogMiss('', 'm', 1)
  recordCatalogMiss('p', '', 1)
  assert.equal(isCatalogMissCoolingDown('', 'm', 2), false)
  assert.equal(isCatalogMissCoolingDown('p', '', 2), false)
})
