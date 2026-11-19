import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeCacheAffinity } from '../../src/main/store/cacheAffinity.ts'

const NOW = 1_800_000_000_000
const MINUTE = 60 * 1000

function entry(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'bailian_token_plan',
    displayName: 'deepseek-v4.1-flash',
    accountId: 'acc-1',
    expiresAt: NOW + 60 * MINUTE,
    ...overrides,
  }
}

test('整体形状不对时返回空表，不抛错', () => {
  assert.deepEqual(normalizeCacheAffinity(null, NOW), {})
  assert.deepEqual(normalizeCacheAffinity(undefined, NOW), {})
  assert.deepEqual(normalizeCacheAffinity([], NOW), {})
  assert.deepEqual(normalizeCacheAffinity('oops', NOW), {})
})

test('缺任何一格身份或到期时刻的记录整条丢弃', () => {
  const input = {
    'r|c1': { ...entry(), providerId: undefined },
    'r|c2': { ...entry(), displayName: '' },
    'r|c3': { ...entry(), accountId: 42 },
    'r|c4': { ...entry(), expiresAt: Number.NaN },
    'r|c5': { ...entry(), expiresAt: NOW - 1 },
    'r|c6': 'not-an-object',
    'r|c7': entry(),
  }
  const out = normalizeCacheAffinity(input, NOW)
  assert.deepEqual(Object.keys(out), ['r|c7'])
})

test('过期记录在读取侧过滤，无需调用方再判', () => {
  const input = { 'r|fresh': entry(), 'r|stale': entry({ expiresAt: NOW - MINUTE }) }
  assert.deepEqual(Object.keys(normalizeCacheAffinity(input, NOW)), ['r|fresh'])
})

test('身份字符串去空白，空白串视为缺失', () => {
  const input = { 'r|padded': entry({ providerId: '  bailian  ', accountId: '   ' }) }
  assert.deepEqual(normalizeCacheAffinity(input, NOW), {})
  const ok = normalizeCacheAffinity({ 'r|padded': entry({ providerId: '  bailian  ' }) }, NOW)
  assert.equal(ok['r|padded']?.providerId, 'bailian')
})

test('条目数封顶 500，超出的键不进入结果', () => {
  const input: Record<string, unknown> = {}
  for (let i = 0; i < 600; i++) input[`r|c${i}`] = entry()
  assert.equal(Object.keys(normalizeCacheAffinity(input, NOW)).length, 500)
})