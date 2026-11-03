/**
 * 摘要压缩策略已于 2026-11-03 退役（裁定：网关不往对话里写字）。
 *
 * 它当时的形状是：另起一次模型调用（自带一句网关写的 system 提示词），把产物包成
 * `[Conversation Summary]\n…` 的 **system** 消息插回历史，并丢掉被摘要取代的用户消息。
 * 退役之后上下文管理只剩两个「只做删除」的策略，所以这一组判据钉的是两件事：
 * 1. 老 `data.json` 里那一格不能活回运行态（否则面板与管理 API 会报一个没人读的策略）；
 * 2. 出站历史里不能出现网关写的摘要块 —— 这是反向门，谁把它接回来就红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createContextManagementService,
  normalizeContextManagementConfig,
  DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
} from '../../src/main/proxy/services/contextManagementService.ts'
import type { ChatMessage } from '../../src/main/proxy/types.ts'

const msg = (role: ChatMessage['role'], content: string): ChatMessage =>
  ({ role, content }) as ChatMessage

/** 退役前会写进 `data.json` 的那份配置，逐字照旧形状播种。 */
const LEGACY_CONFIG = {
  enabled: true,
  strategies: {
    slidingWindow: { enabled: false, maxMessages: 20 },
    tokenLimit: { enabled: false, maxTokens: 4000 },
    summary: { enabled: true, keepRecentMessages: 2, summaryPrompt: 'custom prose' },
  },
  executionOrder: ['slidingWindow', 'tokenLimit', 'summary'],
}

test('出厂默认里没有摘要这一格', () => {
  assert.equal(
    'summary' in (DEFAULT_CONTEXT_MANAGEMENT_CONFIG.strategies as Record<string, unknown>),
    false,
  )
  assert.deepEqual(DEFAULT_CONTEXT_MANAGEMENT_CONFIG.executionOrder, ['slidingWindow', 'tokenLimit'])
})

test('老配置里的 summary 进不了运行态', () => {
  const normalized = normalizeContextManagementConfig(LEGACY_CONFIG as never)

  assert.equal('summary' in (normalized.strategies as Record<string, unknown>), false,
    'strategies.summary 必须被摘掉，否则管理 API 会把它报成可写的存在策略')
  assert.deepEqual(normalized.executionOrder, ['slidingWindow', 'tokenLimit'],
    'executionOrder 里的 summary 必须被过滤，否则每次请求都会走一遍「Unknown strategy」')

  // 同一次归一不许把有效格改掉：enabled 与两个留存策略照原值。
  assert.equal(normalized.enabled, true)
  assert.equal(normalized.strategies.slidingWindow.enabled, false)
  assert.equal(normalized.strategies.tokenLimit.enabled, false)
})

test('跑满历史也只做删除：不插入任何网关写的 system 消息', async () => {
  const service = createContextManagementService(LEGACY_CONFIG as never)
  const history = [
    msg('system', 'client system prompt'),
    ...Array.from({ length: 8 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`)),
  ]

  const result = await service.process(history)

  assert.ok(result.finalCount <= history.length, '裁剪只许减少条数，不许增补')
  assert.equal(
    result.messages.some(message => String(message.content).includes('[Conversation Summary]')),
    false,
    '历史里出现网关写的摘要块 = 退役的策略被接回来了',
  )
  assert.equal(
    result.messages.filter(message => message.role === 'system').length,
    1,
    'system 消息只能是客户自己那一条',
  )
  assert.deepEqual(result.strategyResults.map(r => r.strategyName).filter(n => n === 'summary'), [],
    '结果里不得再有 summary 这一步的执行记录')
})

test('判据本身有电：把 summary 塞回默认配置就会留下痕迹', () => {
  // 负控：这条断的是「过滤真的在起作用」，不是「夹具里恰好没有 summary」。
  const withoutFilter = {
    ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
    strategies: { ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG.strategies, summary: { enabled: true } },
  } as never
  assert.equal('summary' in (withoutFilter as { strategies: Record<string, unknown> }).strategies, true)
  assert.equal('summary' in (normalizeContextManagementConfig(withoutFilter).strategies as Record<string, unknown>), false)
})
