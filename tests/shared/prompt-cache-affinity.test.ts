import { test } from 'node:test'
import assert from 'node:assert/strict'

import { effectiveAffinityMinutes, type PromptCacheCapability } from '../../src/shared/promptCache.ts'

const anthropic: PromptCacheCapability = {
  mode: 'explicit-breakpoints',
  maxBreakpoints: 4,
  readDiscount: 0.1,
  writeMultiplier: 0.25,
  ttlMinutes: 5,
}

const deepseek: PromptCacheCapability = {
  mode: 'implicit-prefix',
  readDiscount: 0.02,
}

test('a documented 5-minute cache caps a 60-minute affinity', () => {
  assert.equal(effectiveAffinityMinutes(60, anthropic, '5m'), 5)
})

test('the 1-hour tier raises the cap to the tier the adapter writes', () => {
  assert.equal(effectiveAffinityMinutes(60, anthropic, '1h'), 60)
})

test('an undocumented TTL leaves the configured window alone', () => {
  // DeepSeek documents "hours to days" without a number: 60 is inside the
  // documented lower bound, and inventing a cap would be a guess.
  assert.equal(effectiveAffinityMinutes(60, deepseek, '5m'), 60)
  assert.equal(effectiveAffinityMinutes(60, undefined), 60)
})

test('the configured window is still an upper bound', () => {
  assert.equal(effectiveAffinityMinutes(3, anthropic, '5m'), 3)
})

test('a disabled or malformed window stays disabled', () => {
  assert.equal(effectiveAffinityMinutes(0, anthropic, '5m'), 0)
  assert.equal(effectiveAffinityMinutes(-10, anthropic, '5m'), 0)
  assert.equal(effectiveAffinityMinutes(Number.NaN, anthropic, '5m'), 0)
})