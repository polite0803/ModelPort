import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DAY_MS,
  DEFAULT_MODEL_REFRESH,
  WEEK_MS,
  normalizeModelListRefresh,
} from '../../src/shared/types.ts'

test('default is 1 week for account channels and 2 weeks for aggregate', () => {
  assert.equal(DEFAULT_MODEL_REFRESH.enabled, true)
  assert.equal(DEFAULT_MODEL_REFRESH.accountIntervalMs, WEEK_MS)
  assert.equal(DEFAULT_MODEL_REFRESH.aggregateIntervalMs, 2 * WEEK_MS)
  assert.equal(DEFAULT_MODEL_REFRESH.accountChannels, true)
  assert.equal(DEFAULT_MODEL_REFRESH.aggregate, true)
  assert.equal(DEFAULT_MODEL_REFRESH.builtin, true)
})

test('missing / malformed input falls back to defaults', () => {
  for (const input of [undefined, null, 42, 'x', []]) {
    assert.deepEqual(normalizeModelListRefresh(input), DEFAULT_MODEL_REFRESH)
  }
})

test('accepts day/week/month intervals and keeps them as-is', () => {
  const normalized = normalizeModelListRefresh({
    enabled: true,
    accountIntervalMs: DAY_MS,
    aggregateIntervalMs: 30 * DAY_MS,
    accountChannels: true,
    aggregate: false,
    builtin: false,
  })
  assert.equal(normalized.accountIntervalMs, DAY_MS)
  assert.equal(normalized.aggregateIntervalMs, 30 * DAY_MS)
  assert.equal(normalized.aggregate, false)
  assert.equal(normalized.builtin, false)
})

test('sub-minute or non-numeric intervals are rejected back to defaults', () => {
  const normalized = normalizeModelListRefresh({
    enabled: true,
    // 30s / NaN / 负数 / 字符串 —— 一律回落默认，UI 也不会给出这些档位。
    accountIntervalMs: 30_000,
    aggregateIntervalMs: Number.NaN,
  })
  assert.equal(normalized.accountIntervalMs, DEFAULT_MODEL_REFRESH.accountIntervalMs)
  assert.equal(normalized.aggregateIntervalMs, DEFAULT_MODEL_REFRESH.aggregateIntervalMs)
})

test('enabled follows strict truthiness; toggles default to on unless explicitly false', () => {
  const off = normalizeModelListRefresh({ enabled: false })
  assert.equal(off.enabled, false)
  // 三个类别开关：只有显式 false 才关，缺省即开。
  assert.equal(off.accountChannels, true)
  assert.equal(off.aggregate, true)
  assert.equal(off.builtin, true)

  const partial = normalizeModelListRefresh({ enabled: true, aggregate: false })
  assert.equal(partial.aggregate, false)
  assert.equal(partial.accountChannels, true)
})
