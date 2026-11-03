import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeCompressionConfig } from '../../src/main/store/compressionConfig.ts'
import { DEFAULT_COMPRESSION_CONFIG } from '../../src/shared/types.ts'

test('an install from before the feature inherits the shipped default', () => {
  // `data.json` written by a release that had no `compression` key at all.
  // It reads as the shipped default, whatever that is; an explicit
  // `enabled: false` below stays off regardless of the default.
  assert.deepEqual(normalizeCompressionConfig(undefined), { ...DEFAULT_COMPRESSION_CONFIG })
  assert.equal(normalizeCompressionConfig(null).enabled, DEFAULT_COMPRESSION_CONFIG.enabled)
})

test('only an explicit true enables compression', () => {
  assert.equal(normalizeCompressionConfig({ enabled: true }).enabled, true)
  assert.equal(normalizeCompressionConfig({ enabled: false }).enabled, false)
  // Defensive: a hand-edited truthy non-boolean must not switch it on.
  assert.equal(normalizeCompressionConfig({ enabled: 'yes' as never }).enabled, false)
})

test('an unrecognised strength falls back to the default', () => {
  assert.equal(
    normalizeCompressionConfig({ aggressiveness: 'turbo' as never }).aggressiveness,
    DEFAULT_COMPRESSION_CONFIG.aggressiveness
  )
  assert.equal(normalizeCompressionConfig({ aggressiveness: 'aggressive' }).aggressiveness, 'aggressive')
  assert.equal(normalizeCompressionConfig({ aggressiveness: 'conservative' }).aggressiveness, 'conservative')
})

test('normalisation returns a fresh object and never mutates the input', () => {
  const input = { enabled: true, aggressiveness: 'moderate' as const }
  const normalized = normalizeCompressionConfig(input)
  assert.notEqual(normalized, input)
  normalized.enabled = false
  assert.equal(input.enabled, true)
})
