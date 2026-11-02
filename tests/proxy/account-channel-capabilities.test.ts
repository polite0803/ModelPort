/**
 * 账号渠道的默认工具能力。
 *
 * 2026-11-02 Codex 观察：路由候选里账户渠道长期被聚合免费池压过。根因之一是
 * 账户渠道的 `modelCapabilities` 只有 vision/weight/contextTokens，没有 tools；
 * 工具请求会对每个账户渠道模型扣 0.15 的「工具未知」分，而有 tools/reasoning
 * 标注的聚合免费模型长期占优。渠道适配器本身都支持原生工具调用，补默认层即可。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { providerDefaultCapability } from '../../src/main/proxy/modelCapabilities.ts'
import { resolveCapabilityDetail } from '../../src/main/proxy/autoRouting.ts'

test('账号渠道默认 tools=yes，避免 Codex 工具请求按未知扣分', () => {
  for (const providerId of [
    'opencode', 'lobsterai', 'qoder', 'qodercn', 'trae', 'cline',
    'loomy', 'raccoon', 'zcode', 'buddy', 'workbuddy', 'gemini', 'minimax',
  ]) {
    assert.equal(providerDefaultCapability(providerId)?.tools, 'yes', providerId)
  }
})

test('供应商记录里的 tools=no 仍然压过渠道默认层', () => {
  const capability = resolveCapabilityDetail('cline', 'Cline / Model', {
    record: { tools: 'no' },
  })
  assert.equal(capability.tools, 'no')
  assert.equal(capability.sources.tools, 'provider-record')
})
