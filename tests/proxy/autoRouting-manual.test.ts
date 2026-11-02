/**
 * 手动机修正与能力分层解析的纯函数测试。
 *
 * 这两块是「自动标注 + 手动标注」组合的核心：
 * - `applyManualModelSelection` 决定手动增删在策略之后怎么生效；
 * - `resolveCapabilityDetail` 决定手工/记录/官方/静态/兜底/第三方/启发式哪一层赢。
 *
 * 盯住三条容易破坏的规则：exclude 永远赢；include 只能从策略之前的候选里取回；
 * 没有证据的字段留 `unknown`（source 也必须是 unknown，不能假装来自某一层）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  STRATEGY_PREDICATES,
  applyManualModelSelection,
  applyPoolStrategiesWithTrace,
  capabilityOfCandidate,
  resolveCapabilityDetail,
  type PoolStrategyCandidate,
} from '../../src/main/proxy/autoRouting.ts'
import type { ModelCapabilityHint, RouteModelRef } from '../../src/shared/types.ts'

function candidate(
  displayName: string,
  hint: ModelCapabilityHint = {},
  providerId = 'demo'
): PoolStrategyCandidate {
  return {
    providerId,
    providerName: providerId,
    displayName,
    actualModelId: displayName.toLowerCase(),
    accountId: `${providerId}-account`,
    providerType: 'custom',
    manualHint: hint,
  }
}

function ref(providerId: string, displayName: string): RouteModelRef {
  return { providerId, displayName }
}

// ------------------------------------------------------------ 手动增删

test('没有手动配置时原样返回（同一个顺序，不复制成反序）', () => {
  const pool = [candidate('a'), candidate('b')]
  const result = applyManualModelSelection(pool, pool)

  assert.deepEqual(result.kept.map(c => c.displayName), ['a', 'b'])
  assert.deepEqual(result.included, [])
  assert.deepEqual(result.excluded, [])
  assert.deepEqual(result.unresolved, [])
})

test('exclude 永远赢：即使同一个模型也在 include 里', () => {
  const a = candidate('a')
  const result = applyManualModelSelection([a], [a], [ref('demo', 'a')], [ref('demo', 'a')])

  assert.deepEqual(result.kept, [])
  assert.deepEqual(result.excluded.map(c => c.displayName), ['a'])
  assert.deepEqual(result.included, [])
  assert.deepEqual(result.unresolved, [])
})

test('include 把策略筛掉的模型加回来，并按原候选顺序插入', () => {
  const a = candidate('a')
  const b = candidate('b')
  const c = candidate('c')

  const result = applyManualModelSelection(
    [a, c],
    [a, b, c],
    [ref('demo', 'b')],
    []
  )

  assert.deepEqual(result.kept.map(x => x.displayName), ['a', 'c', 'b'])
  assert.deepEqual(result.included.map(x => x.displayName), ['b'])
  assert.deepEqual(result.unresolved, [])
})

test('include 只能从策略之前的候选里取回：不在 allCandidates 里就是 unresolved', () => {
  const a = candidate('a')

  const result = applyManualModelSelection([a], [a], [ref('demo', 'ghost')], [])

  assert.deepEqual(result.kept.map(c => c.displayName), ['a'])
  assert.deepEqual(result.unresolved, [ref('demo', 'ghost')])
})

test('大小写与首尾空白不影响匹配（与归一化同一口径）', () => {
  const a = candidate('Kimi K2')

  const result = applyManualModelSelection([a], [a], [], [ref('demo', '  kimi k2 ')])

  assert.deepEqual(result.kept, [])
  assert.deepEqual(result.excluded.map(c => c.displayName), ['Kimi K2'])
})

// ------------------------------------------------------------ 策略追踪

test('策略追踪报每条策略执行后的保留数，并标出第一条把它筛掉的策略', () => {
  const sees = candidate('sees', { vision: 'yes', tools: 'yes' })
  const noVision = candidate('novision', { vision: 'no', tools: 'yes' })

  const outcome = applyPoolStrategiesWithTrace([sees, noVision], [
    { id: 'vision-capable', operator: 'and' },
    { id: 'tools-capable', operator: 'and' },
  ])

  assert.deepEqual(outcome.steps, [
    { id: 'vision-capable', kept: 1 },
    { id: 'tools-capable', kept: 1 },
  ])
  assert.deepEqual(outcome.kept.map(c => c.displayName), ['sees'])
  assert.equal(outcome.droppedBy.get(noVision), 'vision-capable')
})

test('OR 运算符取并集：被第一条筛掉的模型能靠第二条回来', () => {
  const sees = candidate('sees', { vision: 'yes', tools: 'no' })
  const toolUser = candidate('tooluser', { vision: 'no', tools: 'yes' })
  const neither = candidate('neither', { vision: 'no', tools: 'no' })

  const outcome = applyPoolStrategiesWithTrace([sees, toolUser, neither], [
    { id: 'vision-capable', operator: 'and' },
    { id: 'tools-capable', operator: 'or' },
  ])

  assert.deepEqual(outcome.kept.map(c => c.displayName), ['sees', 'tooluser'])
  assert.equal(outcome.droppedBy.get(neither), 'vision-capable')
})

test('带「或」的策略把前置筛选作废时，冲突要能读出来（人数按每条前置策略分别计）', () => {
  const sees = candidate('sees', { vision: 'yes' })
  const toolUser = candidate('tooluser', { tools: 'yes' })
  const outcome = applyPoolStrategiesWithTrace([sees, toolUser], [
    { id: 'vision-capable', operator: 'and' },
    { id: 'tools-capable', operator: 'or' },
  ])

  assert.deepEqual(outcome.conflicts, [
    { id: 'tools-capable', adds: 1, breaks: [{ strategy: 'vision-capable', count: 1 }] },
  ])
})

test('全是「且」的序列不报冲突', () => {
  const sees = candidate('sees', { vision: 'yes' })
  const toolUser = candidate('tooluser', { tools: 'yes' })
  const outcome = applyPoolStrategiesWithTrace([sees, toolUser], [
    { id: 'vision-capable', operator: 'and' },
    { id: 'tools-capable', operator: 'and' },
  ])

  assert.deepEqual(outcome.conflicts, [])
  assert.deepEqual(outcome.kept, [])
})

test('空策略序列不过滤（也不产生步骤）', () => {
  const pool = [candidate('a'), candidate('b')]
  const outcome = applyPoolStrategiesWithTrace(pool, [])

  assert.deepEqual(outcome.kept, pool)
  assert.deepEqual(outcome.steps, [])
  assert.equal(outcome.droppedBy.size, 0)
})

test('策略谓词读的是合并后的能力：手工标注覆盖第三方证据', () => {
  const candidateWithThirdParty: PoolStrategyCandidate = {
    ...candidate('m', { vision: 'no' }),
    thirdPartyHint: { vision: 'yes' },
  }
  assert.equal(STRATEGY_PREDICATES['vision-capable'](candidateWithThirdParty), false)

  const candidateWithManual: PoolStrategyCandidate = {
    ...candidate('m', { vision: 'yes' }),
    thirdPartyHint: { vision: 'no' },
  }
  assert.equal(STRATEGY_PREDICATES['vision-capable'](candidateWithManual), true)
})

test('多模态按证据强弱裁决冲突：手工 vision=no 不会被第三方模态声明推翻', () => {
  const manuallyNoVision: PoolStrategyCandidate = {
    ...candidate('m', { vision: 'no' }),
    thirdPartyHint: { modalities: ['text', 'image'] },
  }
  assert.equal(STRATEGY_PREDICATES['multimodal'](manuallyNoVision), false)

  // 反向同理：手工把模态限定为纯文本时，记录里的 vision=yes 不能把它拉回图片
  const manuallyTextOnly: PoolStrategyCandidate = {
    ...candidate('m', { modalities: ['text'] }),
    thirdPartyHint: { vision: 'yes' },
  }
  assert.equal(STRATEGY_PREDICATES['multimodal'](manuallyTextOnly), false)

  // 同一层来源时以模态为准（它比 vision 更具体）
  const thirdPartyBoth: PoolStrategyCandidate = {
    ...candidate('m', {}),
    thirdPartyHint: { vision: 'no', modalities: ['text', 'image'] },
  }
  assert.equal(STRATEGY_PREDICATES['multimodal'](thirdPartyBoth), true)
})

// ------------------------------------------------------------ 能力分层

test('分层优先级：手工 > 记录 > 官方 > 静态 > 兜底 > 第三方，逐字段独立', () => {
  const resolved = resolveCapabilityDetail('some-provider', 'Some-Model', {
    manual: { vision: 'no' },
    record: { vision: 'yes', tools: 'yes' },
    aggregateOfficial: { tools: 'no' },
    thirdParty: { contextTokens: 200_000 },
  })

  assert.equal(resolved.vision, 'no')
  assert.equal(resolved.sources.vision, 'manual')
  assert.equal(resolved.tools, 'yes')
  assert.equal(resolved.sources.tools, 'provider-record')
  assert.equal(resolved.contextTokens, 200_000)
  assert.equal(resolved.sources.contextTokens, 'third-party')
})

test('只有第三方证据时来源标记为 third-party，不会被冒认成官方', () => {
  const resolved = resolveCapabilityDetail('some-provider', 'Brand-New', {
    thirdParty: { tools: 'yes', reasoning: 'yes' },
  })

  assert.equal(resolved.tools, 'yes')
  assert.equal(resolved.sources.tools, 'third-party')
  assert.equal(resolved.reasoning, 'yes')
  assert.equal(resolved.sources.reasoning, 'third-party')
})

test('没有任何证据的字段是 unknown，来源也是 unknown', () => {
  const resolved = resolveCapabilityDetail('some-provider', 'Brand-New')

  assert.equal(resolved.vision, 'unknown')
  assert.equal(resolved.tools, 'unknown')
  assert.equal(resolved.reasoning, 'unknown')
  assert.equal(resolved.modalities, undefined)
  assert.equal(resolved.contextTokens, undefined)
  assert.equal(resolved.sources.vision, 'unknown')
  assert.equal(resolved.sources.contextTokens, 'unknown')
})

test('档位没人标注时来自名字启发式，tierEvidenced=false', () => {
  const guessed = resolveCapabilityDetail('some-provider', 'Something-Flash')
  assert.equal(guessed.tier, 'fast')
  assert.equal(guessed.sources.tier, 'heuristic')
  assert.equal(guessed.tierEvidenced, false)

  const marked = resolveCapabilityDetail('some-provider', 'Something-Flash', {
    manual: { tier: 'strong' },
  })
  assert.equal(marked.tier, 'strong')
  assert.equal(marked.sources.tier, 'manual')
  assert.equal(marked.tierEvidenced, true)
})

test('候选合并把四层都交给解析器（capabilityOfCandidate）', () => {
  const resolved = capabilityOfCandidate({
    providerId: 'some-provider',
    displayName: 'Brand-New',
    capabilityHint: { tools: 'no' },
    thirdPartyHint: { tools: 'yes', vision: 'yes' },
  })

  assert.equal(resolved.tools, 'no')
  assert.equal(resolved.sources.tools, 'provider-record')
  assert.equal(resolved.vision, 'yes')
  assert.equal(resolved.sources.vision, 'third-party')
})
