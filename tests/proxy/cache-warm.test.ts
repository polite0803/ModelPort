/**
 * 压缩后前缀预热：判定与请求构造。
 *
 * 真实读数（2026-11-20，`opencode_go/deepseek-v4.1-flash` 同一会话）：
 * 压缩那次请求全价（18.6 万 tok、命中 0），之后四轮命中率 15.5% → 65.3% →
 * 91.3% → 80.4%，新前缀每轮被重读。预热就是把这份前缀提前写进上游缓存。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  COMPACTION_SHRINK_RATIO,
  isPostCompactionTurn,
  shouldWarmAfterCompaction,
  warmRequestOf,
} from '../../src/main/proxy/cacheWarm.ts'

test('输入骤降一半以上判为压缩后首轮（真实读数）', () => {
  assert.equal(COMPACTION_SHRINK_RATIO, 0.5)
  // turn 88 → 89：18.6 万跌到 2.9 万
  assert.equal(isPostCompactionTurn({ previousPromptTokens: 185789, currentPromptTokens: 28910 }), true)
  // turn 106 → 107 不是压缩（输入还在涨）
  assert.equal(isPostCompactionTurn({ previousPromptTokens: 164612, currentPromptTokens: 174176 }), false)
})

test('正常增长与小幅回落都不算压缩', () => {
  assert.equal(isPostCompactionTurn({ previousPromptTokens: 140000, currentPromptTokens: 148000 }), false)
  // 只降 30%：可能是裁剪或工具结果变短，不足以判压缩
  assert.equal(isPostCompactionTurn({ previousPromptTokens: 140000, currentPromptTokens: 98000 }), false)
  // 上一轮本来就小，跌了也不算
  assert.equal(isPostCompactionTurn({ previousPromptTokens: 5000, currentPromptTokens: 1000 }), false)
})

test('缓存能力未知时不预热：发了也证明不了缓存被写入', () => {
  const reading = { previousPromptTokens: 180000, currentPromptTokens: 30000 }
  assert.deepEqual(
    shouldWarmAfterCompaction(reading, { cacheMode: 'unknown', enabled: true }),
    { warm: false, reason: 'unsupported_cache' },
  )
})

test('关停开关优先于一切判定', () => {
  const reading = { previousPromptTokens: 180000, currentPromptTokens: 30000 }
  assert.equal(shouldWarmAfterCompaction(reading, { cacheMode: 'implicit-prefix', enabled: false }).reason, 'disabled')
})

test('压缩后前缀太小不值得预热', () => {
  const reading = { previousPromptTokens: 180000, currentPromptTokens: 3000 }
  assert.equal(shouldWarmAfterCompaction(reading, { cacheMode: 'implicit-prefix', enabled: true }).reason, 'too_small')
})

test('冷却窗口内不重复预热', () => {
  const reading = { previousPromptTokens: 180000, currentPromptTokens: 30000 }
  const now = 1_000_000
  assert.equal(
    shouldWarmAfterCompaction(reading, { cacheMode: 'implicit-prefix', enabled: true, lastWarmAt: now - 1000, now }).reason,
    'cooldown',
  )
  assert.equal(
    shouldWarmAfterCompaction(reading, { cacheMode: 'implicit-prefix', enabled: true, lastWarmAt: now - 6 * 60 * 1000, now }).warm,
    true,
  )
})

test('预热请求原样复用前缀，只压输出并去掉工具三件套', () => {
  const body = {
    model: 'deepseek-v4.1-flash',
    messages: [{ role: 'user', content: '前缀' }],
    stream: true,
    max_tokens: 4096,
    tools: [{ type: 'function', function: { name: 'x' } }],
    tool_choice: 'auto',
    parallel_tool_calls: true,
    prompt_cache_key: 'sess-1',
  }
  const warm = warmRequestOf(body)
  assert.deepEqual(warm.messages, body.messages, '前缀必须逐字一致，否则缓存对不上')
  assert.equal(warm.prompt_cache_key, 'sess-1', '会话键要保留，与真实请求同一缓存域')
  assert.equal(warm.max_tokens, 1)
  assert.equal(warm.stream, false)
  assert.equal('tools' in warm, false)
  assert.equal('tool_choice' in warm, false)
  assert.equal('parallel_tool_calls' in warm, false)
})