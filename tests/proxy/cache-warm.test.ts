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
  compactionTurnOf,
  isPostCompactionTurn,
  shouldPauseWarmAfterFailures,
  shouldWarmAfterCompaction,
  warmErrorSummaryOf,
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

test('预热请求逐字保留前缀，含工具三件套，只压输出与流式', () => {
  const body = {
    model: 'deepseek-v4.1-flash',
    messages: [{ role: 'user', content: '前缀' }],
    stream: true,
    stream_options: { include_usage: true },
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
  // 2026-11-21 部署后的 400 根因：流式专属字段留在非流式预热里，上游整条拒收。
  assert.equal('stream_options' in warm, false, '关掉 stream 必须同时删掉 stream_options')
  // tools / tool_choice / parallel_tool_calls 都渲染进提示词前缀，剥掉就写错缓存，
  // 还会让「有 tool 消息、无 tools 声明」被严格上游 400（2026-11-20 百炼实测）。
  assert.deepEqual(warm.tools, body.tools, 'tools 是前缀的一部分，必须保留')
  assert.equal(warm.tool_choice, 'auto', 'tool_choice 保留，与真实请求前缀一致')
  assert.equal(warm.parallel_tool_calls, true, 'parallel_tool_calls 保留')
})

test('连续失败后短暂停止预热，超过冷却窗口再允许重试', () => {
  const now = 1_800_000_000_000
  assert.equal(shouldPauseWarmAfterFailures({ consecutiveFailures: 0, now }), false)
  assert.equal(shouldPauseWarmAfterFailures({ consecutiveFailures: 1, lastFailureAt: now, now }), false)
  assert.equal(shouldPauseWarmAfterFailures({ consecutiveFailures: 2, lastFailureAt: now, now }), true)
  assert.equal(
    shouldPauseWarmAfterFailures({ consecutiveFailures: 2, lastFailureAt: now, now: now + 5 * 60_000 - 1 }),
    true,
    '窗口内不重试：每笔失败仍按全价买了整份前缀',
  )
  assert.equal(
    shouldPauseWarmAfterFailures({ consecutiveFailures: 2, lastFailureAt: now, now: now + 5 * 60_000 }),
    false,
  )
})

test('失败日志只留单行短摘要，不把提示词或错误体整段写进日志', () => {
  assert.equal(warmErrorSummaryOf(undefined), undefined)
  assert.equal(warmErrorSummaryOf(''), undefined)
  assert.equal(warmErrorSummaryOf('  \r\n '), undefined)
  assert.equal(warmErrorSummaryOf('bad\nrequest\r\nbody'), 'bad request body')
  assert.equal(warmErrorSummaryOf('x'.repeat(500))?.length, 200)
})

test('识别压缩写摘要与摘要后重建会话，只认本轮 user 文本', () => {
  assert.equal(compactionTurnOf([
    { role: 'user', content: 'CONTEXT CHECKPOINT COMPACTION: write a handoff summary' },
  ]), 'summarize')
  assert.equal(compactionTurnOf([
    { role: 'user', content: 'Another language model started to solve this problem and produced a summary of its thinking process.' },
  ]), 'resume')
  assert.equal(compactionTurnOf([
    { role: 'user', content: [{ type: 'text', text: 'Handoff summary for continuation' }] },
  ]), 'summarize')
  assert.equal(compactionTurnOf([
    { role: 'assistant', content: 'CONTEXT CHECKPOINT COMPACTION' },
    { role: 'user', content: '继续刚才的问题' },
  ]), 'none')
  assert.equal(compactionTurnOf([
    { role: 'tool', content: 'Another language model started to solve this problem' },
    { role: 'user', content: '继续刚才的问题' },
  ]), 'none')
  assert.equal(compactionTurnOf([{ role: 'user', content: '普通问题' }]), 'none')
  assert.equal(compactionTurnOf(undefined), 'none')
  assert.equal(compactionTurnOf('CONTEXT CHECKPOINT COMPACTION'), 'none')
  assert.equal(compactionTurnOf([{ role: 'user', content: 123 }]), 'none')
})