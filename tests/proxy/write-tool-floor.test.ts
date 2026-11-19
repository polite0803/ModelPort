/**
 * 写入型请求的档位托底：请求结构里出现写入类工具时，在路由能力下限之上再抬一档。
 * 这里锁住三件事：名字表只认精确名、非写入请求一律不动、抬空必须回落并记降级。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyRequestTierFloor,
  requestUsesWriteTools,
  requestWriteToolFloor,
} from '../../src/main/proxy/writeToolFloor.ts'
import type { PoolStrategyCandidate } from '../../src/main/proxy/autoRouting.ts'
import type { AutoModelTier } from '../../src/shared/types.ts'
import type { ChatCompletionRequest } from '../../src/main/proxy/types.ts'

function tool(name: string): ChatCompletionRequest['tools'] extends (infer T)[] | undefined ? T : never {
  return { type: 'function', function: { name } }
}

function candidate(tier: AutoModelTier, name = `m-${tier}`): PoolStrategyCandidate {
  return {
    providerId: 'prov',
    providerName: 'Prov',
    displayName: name,
    actualModelId: `actual-${name}`,
    accountId: 'acct',
    providerType: 'builtin',
    manualHint: { tier },
  }
}

test('写入工具识别：大小写不敏感，只读工具不算', () => {
  assert.equal(requestUsesWriteTools({ model: 'x', tools: [tool('apply_patch')] }), true)
  assert.equal(requestUsesWriteTools({ model: 'x', tools: [tool('Write')] }), true)
  assert.equal(requestUsesWriteTools({ model: 'x', tools: [tool('str_replace_editor')] }), true)
  assert.equal(requestUsesWriteTools({ model: 'x', tools: [tool('read_file')] }), false)
  assert.equal(requestUsesWriteTools({ model: 'x', tools: [tool('grep')] }), false)
  assert.equal(requestUsesWriteTools({ model: 'x' }), false)
  assert.equal(requestUsesWriteTools(undefined), false)
})

test('写入工具识别看历史调用：这一轮精简了工具列表也认得出来', () => {
  const request: ChatCompletionRequest = {
    model: 'x',
    messages: [
      { role: 'user', content: 'fix it' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Edit', arguments: '{}' } }],
      },
    ],
  }
  assert.equal(requestUsesWriteTools(request), true)
})

test('档位选择：缺省 balanced，可关，可抬到 strong', () => {
  const write = { model: 'x', tools: [tool('apply_patch')] } as ChatCompletionRequest
  const read = { model: 'x', tools: [tool('read_file')] } as ChatCompletionRequest

  assert.equal(requestWriteToolFloor(undefined, write), 'balanced')
  assert.equal(requestWriteToolFloor('off', write), undefined)
  assert.equal(requestWriteToolFloor('strong', write), 'strong')
  assert.equal(requestWriteToolFloor('strong', read), undefined)
})

test('抬档只留够档候选，入参数组不被改写', () => {
  const pool = [candidate('fast'), candidate('balanced'), candidate('strong')]
  const outcome = applyRequestTierFloor(pool, 'balanced')

  assert.equal(outcome.relaxed, false)
  assert.deepEqual(outcome.inputs.map(item => item.displayName), ['m-balanced', 'm-strong'])
  assert.equal(pool.length, 3)
})

test('池里全是低档：回落并标记 relaxed，绝不筛成空池', () => {
  const pool = [candidate('fast')]
  const outcome = applyRequestTierFloor(pool, 'balanced')

  assert.equal(outcome.relaxed, true)
  assert.deepEqual(outcome.inputs.map(item => item.displayName), ['m-fast'])
})

test('本来就是空池：不算「抬档放宽」', () => {
  const outcome = applyRequestTierFloor([], 'balanced')
  assert.equal(outcome.relaxed, false)
  assert.equal(outcome.inputs.length, 0)
})

test('不施加下限时原样返回', () => {
  const pool = [candidate('fast')]
  const outcome = applyRequestTierFloor(pool, undefined)
  assert.equal(outcome.relaxed, false)
  assert.deepEqual(outcome.inputs.map(item => item.displayName), ['m-fast'])
})