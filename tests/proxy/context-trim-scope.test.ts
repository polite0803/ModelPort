/**
 * 裁剪作用域门：`trimAppliesToProvider` + `channelIds` 归一化。
 *
 * 回归背景（2026-11-10，PLAN-prompt-cache §9.12）：裁剪曾是全局门，slidingWindow
 * 每轮移动切点 ⇒ DeepSeek 系隐式前缀缓存全灭，loomy/bailian/raccoon 当日命中
 * 88–98% → 59–60%，未命中 token 每请求涨 9 倍。修复形状：点名谁可以被裁，
 * 缺省 = 不裁任何人——「enabled 但没点名」绝不能退回全局裁剪。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeContextManagementConfig,
  trimAppliesToProvider,
} from '../../src/main/proxy/services/contextManagementService.ts'

const base = { enabled: true, strategies: {}, executionOrder: [] as never[] }

test('点名渠道裁、未点名渠道不裁', () => {
  const config = normalizeContextManagementConfig({ ...base, channelIds: ['trae'] })
  assert.equal(trimAppliesToProvider(config, 'trae'), true)
  assert.equal(trimAppliesToProvider(config, 'loomy'), false)
  assert.equal(trimAppliesToProvider(config, 'bailian'), false)
})

test('channelIds 缺省/空数组 = 不裁任何人（enabled:true 也不行）', () => {
  const absent = normalizeContextManagementConfig({ ...base })
  assert.deepEqual(absent.channelIds, [])
  assert.equal(trimAppliesToProvider(absent, 'trae'), false)

  const empty = normalizeContextManagementConfig({ ...base, channelIds: [] })
  assert.equal(trimAppliesToProvider(empty, 'trae'), false)
})

test('enabled:false 时永不裁剪，即使点了名', () => {
  const config = normalizeContextManagementConfig({ ...base, enabled: false, channelIds: ['trae'] })
  assert.equal(trimAppliesToProvider(config, 'trae'), false)
})

test('归一化：去空白、去重、丢空项；畸形输入归一为不裁剪', () => {
  const config = normalizeContextManagementConfig({ ...base, channelIds: [' trae ', 'trae', '', '  ', 'qoder'] })
  assert.deepEqual(config.channelIds, ['trae', 'qoder'])

  const malformed = normalizeContextManagementConfig({ ...base, channelIds: 'trae' as never })
  assert.deepEqual(malformed.channelIds, [])
})

test('大小写敏感：渠道 ID 按字面匹配，不做大小写归一', () => {
  // 渠道 id 是小写惯例（trae/bailian）；字面匹配避免误伤大小写不同的渠道名。
  const config = normalizeContextManagementConfig({ ...base, channelIds: ['trae'] })
  assert.equal(trimAppliesToProvider(config, 'TRAE'), false)
})
