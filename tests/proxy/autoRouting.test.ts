import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyContractFilter,
  applyPoolStrategies,
  contractNeeds,
  conversationKey,
  explainMissing,
  profileRequest,
  providerMeetsContract,
  rankCandidates,
  resolveCapability,
  STRATEGY_PREDICATES,
  UNANNOTATED_CONTEXT_FLOOR,
  type PoolStrategyCandidate,
  type RankCandidate,
} from '../../src/main/proxy/autoRouting.ts'
import {
  AUTO_POOL_STRATEGY_IDS,
  DEFAULT_AUTO_ROUTING_CONFIG,
  type AutoPoolStrategy,
  type AutoPoolStrategyId,
} from '../../src/shared/types.ts'
import { normalizeAutoRoutingConfig } from '../../src/main/store/autoRoutingConfig.ts'

const NOW = 1_800_000_000_000

function textRequest(text: string, extra: Record<string, unknown> = {}) {
  return {
    model: 'auto',
    messages: [{ role: 'user' as const, content: text }],
    ...extra,
  }
}

function candidate(overrides: Partial<RankCandidate>): RankCandidate {
  return {
    providerId: 'qwen',
    providerName: 'Qwen',
    displayName: 'Qwen3.7-Max',
    actualModelId: 'qwen3.7-max',
    accountId: 'account-a',
    ...overrides,
  }
}

test('profileRequest marks simple short text as simple', () => {
  const profile = profileRequest(textRequest('帮我把这句话翻译成英文'))

  assert.equal(profile.needsVision, false)
  assert.equal(profile.needsTools, false)
  assert.equal(profile.complexity, 'simple')
  assert.ok(profile.estimatedTokens > 0)
})

test('profileRequest detects vision parts and counts image tokens', () => {
  const profile = profileRequest({
    model: 'auto',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '这张图里是什么' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ],
  })

  assert.equal(profile.needsVision, true)
  assert.ok(profile.estimatedTokens >= 1024)
})

test('profileRequest treats files as vision input', () => {
  const profile = profileRequest({
    model: 'auto',
    messages: [
      {
        role: 'user',
        content: [{ type: 'file', file: { name: 'a.pdf' } } as never],
      },
    ],
  })

  assert.equal(profile.needsVision, true)
})

test('profileRequest escalates long text with tools and high reasoning effort', () => {
  const profile = profileRequest(textRequest('x'.repeat(1500), {
    tools: [{ type: 'function', function: { name: 'read_file' } }],
    reasoning_effort: 'high',
  }))

  assert.equal(profile.needsTools, true)
  assert.equal(profile.complexity, 'complex')
})

test('profileRequest counts a large system prompt toward complexity', () => {
  const profile = profileRequest({
    model: 'auto',
    messages: [
      { role: 'system', content: 's'.repeat(16000) },
      { role: 'user', content: 'read the file' },
    ],
    tools: [{ type: 'function', function: { name: 'read_file' } }],
  })

  assert.equal(profile.needsTools, true)
  assert.ok(profile.estimatedTokens >= 4000)
  assert.equal(profile.complexity, 'standard')
})

test('profileRequest accepts camelCase reasoningEffort', () => {
  const profile = profileRequest(textRequest('x'.repeat(1500), {
    tools: [{ type: 'function', function: { name: 'read_file' } }],
    reasoningEffort: 'high',
  }))

  assert.equal(profile.complexity, 'complex')
})

test('profileRequest counts tool schemas in the token estimate', () => {
  const withoutTools = profileRequest(textRequest('hi'))
  const withTools = profileRequest(textRequest('hi', {
    tools: [{
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取文件内容',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    }],
  }))

  // agent 客户端每轮重发完整 tools schema；漏算会让 auto 把请求路由到窗口不够的模型
  assert.equal(withTools.needsTools, true)
  assert.ok(
    withTools.estimatedTokens > withoutTools.estimatedTokens,
    'tools schema 必须计入 estimatedTokens'
  )
})

test('profileRequest counts assistant tool-call arguments in the token estimate', () => {
  const withoutArgs = profileRequest({
    model: 'auto',
    messages: [{ role: 'user', content: '改一下这个文件' }],
  })
  const withArgs = profileRequest({
    model: 'auto',
    messages: [
      { role: 'user', content: '改一下这个文件' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ content: 'x'.repeat(40_000) }) },
        }],
      } as never,
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    ],
  })

  // tool_calls 的 arguments 不在 content 里；IDE 客户端把整段文件写在这里
  assert.ok(
    withArgs.estimatedTokens > withoutArgs.estimatedTokens + 5_000,
    `工具参数必须计入估算，实际 ${withArgs.estimatedTokens}`
  )
})

test('resolveCapability knows shipped models and falls back to name heuristics', () => {
  assert.deepEqual(
    { tier: resolveCapability('qwen', 'Qwen3.5-Flash').tier, vision: resolveCapability('qwen', 'Qwen3.5-Flash').vision },
    { tier: 'fast', vision: 'unknown' }
  )
  assert.equal(resolveCapability('glm', 'GLM-5.3').vision, 'yes')
  assert.equal(resolveCapability('kimi', 'K3').tier, 'strong')
  assert.equal(resolveCapability('kimi', 'K2.8').tier, 'strong')
  assert.equal(resolveCapability('kimi', 'Instant').tier, 'fast')
  assert.equal(resolveCapability('kimi', 'Instant').vision, 'no')
  // legacy display name still resolves to the same tier
  assert.equal(resolveCapability('kimi', 'Kimi-K2.6').tier, 'strong')
  assert.equal(resolveCapability('kimi', 'some-unlisted-flash').tier, 'fast')
  assert.equal(resolveCapability('kimi', 'some-unlisted-pro').tier, 'strong')
  // 未登记的模型保持未知，既不当作支持也不当作不支持
  assert.equal(resolveCapability('unknown-provider', 'brand-new-model').vision, 'unknown')
})

test('resolveCapability reads aggregate display names past the entry prefix', () => {
  // 聚合供应商的展示名是 `<entryId>/<modelId>`，静态表按模型名登记
  assert.equal(resolveCapability('glm', 'glm/glm-5.3').tier, 'strong')
  assert.equal(resolveCapability('glm', 'glm/glm-5.3').contextTokens, 128000)
  // 账号渠道的展示名是 `<渠道名> / <模型名>`，同样要能命中
  assert.equal(resolveCapability('kimi', 'Kimi / Instant').tier, 'fast')
})

test('a provider-record hint wins over the static table', () => {
  const hinted = resolveCapability('glm', 'glm/glm-5.3', { vision: 'no', contextTokens: 32000 })
  assert.equal(hinted.vision, 'no')
  assert.equal(hinted.contextTokens, 32000)
  // tier 没被覆盖时仍取静态表
  assert.equal(hinted.tier, 'strong')
})

test('rankCandidates prefers the strong model for complex requests', () => {
  const profile = profileRequest(textRequest('x'.repeat(1500), { reasoning_effort: 'high' }))

  const ranked = rankCandidates(profile, [
    candidate({ displayName: 'Qwen3.5-Flash', actualModelId: 'qwen3.5-flash', accountId: 'fast-account' }),
    candidate({ displayName: 'Qwen3.7-Max', actualModelId: 'qwen3.7-max', accountId: 'strong-account' }),
  ], { now: NOW })

  assert.equal(ranked[0].displayName, 'Qwen3.7-Max')
})

test('rankCandidates never routes images to a text-only model', () => {
  const profile = profileRequest({
    model: 'auto',
    messages: [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
      },
    ],
  })

  const ranked = rankCandidates(profile, [
    candidate({ providerId: 'deepseek', providerName: 'DeepSeek', displayName: 'deepseek-default', actualModelId: 'default', accountId: 'ds' }),
    candidate({ providerId: 'glm', providerName: 'GLM', displayName: 'GLM-5.3', actualModelId: 'glm-5.3', accountId: 'glm' }),
  ], { now: NOW })

  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].providerId, 'glm')
})

test('rankCandidates never routes images to a model whose vision support is unknown', () => {
  const profile = profileRequest({
    model: 'auto',
    messages: [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
      },
    ],
  })

  const ranked = rankCandidates(profile, [
    // 未标注且无从推断：不知道能不能收图片，就不能拿它当答案
    candidate({ providerId: 'custom-x', providerName: 'Custom', displayName: 'mystery-model', accountId: 'unknown' }),
    candidate({ providerId: 'glm', providerName: 'GLM', displayName: 'GLM-5.3', actualModelId: 'glm-5.3', accountId: 'glm' }),
  ], { now: NOW })

  assert.deepEqual(ranked.map(item => item.accountId), ['glm'])
})

test('a capability hint can veto a statically supported model', () => {
  const profile = profileRequest({
    model: 'auto',
    messages: [
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    ],
  })

  const ranked = rankCandidates(profile, [
    candidate({
      providerId: 'glm',
      displayName: 'glm/glm-5.3',
      actualModelId: 'glm-5.3',
      accountId: 'vetoed',
      capabilityHint: { vision: 'no' },
    }),
  ], { now: NOW })

  assert.deepEqual(ranked, [])
})

test('a known context window filters long requests before the fallback floor', () => {
  const profile = {
    ...profileRequest(textRequest('short')),
    estimatedTokens: 40_000,
  }
  assert.ok(profile.estimatedTokens < UNANNOTATED_CONTEXT_FLOOR)

  const ranked = rankCandidates(profile, [
    candidate({ accountId: 'small', capabilityHint: { contextTokens: 32000 } }),
    candidate({ accountId: 'big', capabilityHint: { contextTokens: 128000 } }),
  ], { now: NOW })

  assert.deepEqual(ranked.map(item => item.accountId), ['big'])
})

test('未公布窗口的候选不因上下文被淘汰，已公布且装不下的才淘汰', () => {
  const profile = { ...profileRequest(textRequest('short')), estimatedTokens: 70_000 }

  const ranked = rankCandidates(profile, [
    candidate({ accountId: 'unannotated' }),
    candidate({ accountId: 'small-window', capabilityHint: { contextTokens: 32_768 } }),
  ], { now: NOW })

  // 过去这里靠「放宽一次上下文」的兜底把未标注的候选捞回来（64K 那个猜数先把它筛掉
  // 再放行，两步都是同一枚硬币的两面）。现在没有那一步：没公布上限不是超限的证据。
  assert.deepEqual(ranked.map(item => item.accountId), ['unannotated'],
    '已公布 32768 的那条才是真装不下 70K 的那一家')
})

test('contractNeeds only flags requirements that change the response shape', () => {
  assert.deepEqual(contractNeeds(textRequest('hi')), { multiChoice: false, structuredOutput: false })
  assert.equal(contractNeeds(textRequest('hi', { n: 2 })).multiChoice, true)
  assert.equal(
    contractNeeds(textRequest('hi', { response_format: { type: 'json_schema' } })).structuredOutput,
    true,
  )
  assert.equal(
    contractNeeds(textRequest('hi', { response_format: { type: 'text' } })).structuredOutput,
    false,
  )
})

test('only builtin providers fail a structured-output or multi-choice contract', () => {
  const structured = { multiChoice: false, structuredOutput: true }
  assert.equal(providerMeetsContract('builtin', structured), false)
  assert.equal(providerMeetsContract('aggregate', structured), true)
  assert.equal(providerMeetsContract('custom', structured), true)
  assert.equal(providerMeetsContract('account', structured), true)
  assert.equal(providerMeetsContract('builtin', { multiChoice: false, structuredOutput: false }), true)
})

test('applyContractFilter prefers capable candidates and reports what it gave up', () => {
  const builtinOnly = [candidate({ accountId: 'builtin', contractCapable: false })]
  const mixed = [
    candidate({ accountId: 'builtin', contractCapable: false }),
    candidate({ accountId: 'aggregate', contractCapable: true }),
  ]

  // 有能满足的候选：只在它们里面挑，不降级
  assert.deepEqual(
    applyContractFilter(mixed, { multiChoice: true, structuredOutput: false }),
    { pool: [mixed[1]], degraded: [], missing: [] },
  )

  // n > 1 且只有内置：必须拒绝，不能悄悄返回一个 choice
  assert.deepEqual(
    applyContractFilter(builtinOnly, { multiChoice: true, structuredOutput: false }),
    { pool: [], degraded: [], missing: ['n'] },
  )

  // 结构化输出且只有内置：照常路由，但必须报告降级
  assert.deepEqual(
    applyContractFilter(builtinOnly, { multiChoice: false, structuredOutput: true }),
    { pool: builtinOnly, degraded: ['response_format'], missing: [] },
  )

  // 没有契约要求时原样返回
  assert.deepEqual(
    applyContractFilter(builtinOnly, { multiChoice: false, structuredOutput: false }),
    { pool: builtinOnly, degraded: [], missing: [] },
  )
})

test('balanced lets a free model break a near tie, cheap makes it win outright', () => {
  const profile = profileRequest(textRequest('hi'))
  const pool = [
    // 免费的均衡档 vs 付费的快档：balanced 还要速度为先，cheap 才愿意为免费让步
    candidate({ accountId: 'free', displayName: 'Qwen3.6', costBucket: 'free' }),
    candidate({ accountId: 'paid', displayName: 'Qwen3.5-Flash', costBucket: 'above-base' }),
  ]

  const balanced = rankCandidates(profile, pool, { now: NOW, prefer: 'balanced' })
  const cheap = rankCandidates(profile, pool, { now: NOW, prefer: 'cheap' })

  assert.equal(balanced[0].accountId, 'paid')
  assert.equal(cheap[0].accountId, 'free')
})

test('an unreported cost is neutral, so it neither wins nor loses on price', () => {
  const profile = profileRequest(textRequest('hi'))
  const ranked = rankCandidates(profile, [
    candidate({ accountId: 'unknown-cost', costBucket: 'unknown' }),
    candidate({ accountId: 'free-cost', costBucket: 'free' }),
  ], { now: NOW, prefer: 'cheap' })

  // 未知成本不是免费：cheap 下免费模型仍然排在它前面
  assert.equal(ranked[0].accountId, 'free-cost')
})

test('the preference overrides the target tier for every complexity', () => {
  const profile = { ...profileRequest(textRequest('hi')), complexity: 'complex' as const }
  const pool = [
    candidate({ accountId: 'fast', displayName: 'Qwen3.5-Flash' }),
    candidate({ accountId: 'strong', displayName: 'Qwen3.7-Max' }),
  ]

  assert.equal(rankCandidates(profile, pool, { now: NOW })[0].accountId, 'strong')
  assert.equal(rankCandidates(profile, pool, { now: NOW, prefer: 'fast' })[0].accountId, 'fast')
  assert.equal(rankCandidates(profile, pool, { now: NOW, prefer: 'strong' })[0].accountId, 'strong')
})

test('tool-using requests prefer a strong model even when cost is the preference', () => {
  const profile = {
    ...profileRequest(textRequest('hi', {
      tools: [{ type: 'function', function: { name: 'read_file' } }],
    })),
    complexity: 'standard' as const,
  }
  const pool = [
    candidate({ accountId: 'free-balanced', displayName: 'Qwen3.6', costBucket: 'free' }),
    candidate({ accountId: 'paid-strong', displayName: 'Qwen3.7-Max', costBucket: 'base' }),
  ]

  // 旧逻辑下 cheap 会把免费的 balanced 模型顶到第一；工具请求应为稳定性
  // 上浮档位并压低成本权重，避免 agent 跑到容易思考循环的快模型上。
  const ranked = rankCandidates(profile, pool, { now: NOW, prefer: 'cheap' })
  assert.equal(ranked[0].accountId, 'paid-strong')
})

test('a sticky hint promotes the previous candidate but never hard-pins it', () => {
  const profile = profileRequest(textRequest('hi'))
  const pool = [
    candidate({ accountId: 'a', displayName: 'Qwen3.6' }),
    candidate({ accountId: 'b', displayName: 'Qwen3.6' }),
  ]

  const sticky = { providerId: 'qwen', displayName: 'Qwen3.6', accountId: 'b' }
  assert.equal(rankCandidates(profile, pool, { now: NOW, sticky })[0].accountId, 'b')

  // 首选不可用（冷却）时它连候选都不是，路由自然让位，不需要额外清理
  const cooling = [
    candidate({ accountId: 'sticky-cooling', displayName: 'Qwen3.6', coolingUntil: NOW + 30_000 }),
    candidate({ accountId: 'healthy', displayName: 'Qwen3.6' }),
  ]
  const ranked = rankCandidates(profile, cooling, {
    now: NOW,
    sticky: { providerId: 'qwen', displayName: 'Qwen3.6', accountId: 'sticky-cooling' },
  })
  assert.deepEqual(ranked.map(item => item.accountId), ['healthy'])
})

test('explainMissing names the capability that emptied the pool', () => {
  const visionProfile = profileRequest({
    model: 'auto',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
  })
  const textOnly = [candidate({ providerId: 'custom-x', displayName: 'mystery-model' })]
  assert.deepEqual(explainMissing(visionProfile, textOnly), ['vision'])

  const longProfile = { ...profileRequest(textRequest('hi')), estimatedTokens: 90_000 }
  assert.deepEqual(
    explainMissing(longProfile, [candidate({ capabilityHint: { contextTokens: 32000 } })]),
    ['context'],
  )

  const toolsProfile = { ...profileRequest(textRequest('hi')), needsTools: true }
  assert.deepEqual(
    explainMissing(toolsProfile, [candidate({ capabilityHint: { tools: 'no' } })]),
    ['tools'],
  )
})

test('rankCandidates keeps one candidate per account', () => {
  const profile = profileRequest(textRequest('hi'))

  const ranked = rankCandidates(profile, [
    candidate({ displayName: 'Qwen3.7-Max', actualModelId: 'qwen3.7-max', accountId: 'same-account' }),
    candidate({ displayName: 'Qwen3.5-Flash', actualModelId: 'qwen3.5-flash', accountId: 'same-account' }),
  ], { now: NOW })

  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].accountId, 'same-account')
})

test('rankCandidates drops accounts in cooldown', () => {
  const profile = profileRequest(textRequest('hi'))

  const ranked = rankCandidates(profile, [
    candidate({ accountId: 'cooling', coolingUntil: NOW + 30_000 }),
    candidate({ accountId: 'healthy' }),
  ], { now: NOW })

  assert.deepEqual(ranked.map(item => item.accountId), ['healthy'])
})

test('rankCandidates prefers accounts with remaining quota', () => {
  const profile = profileRequest(textRequest('hi'))

  const ranked = rankCandidates(profile, [
    candidate({ accountId: 'exhausted', dailyLimit: 10, todayUsed: 10, lastUsed: NOW - 60_000 }),
    candidate({ accountId: 'fresh', dailyLimit: 10, todayUsed: 0, lastUsed: NOW - 60_000 }),
  ], { now: NOW })

  assert.equal(ranked[0].accountId, 'fresh')
})

test('rankCandidates relaxes long-context filtering before giving up', () => {
  const profile = profileRequest(textRequest('x'.repeat(5000)))
  assert.ok(profile.estimatedTokens < 64000)

  // 直接构造一个超长上下文画像：上下文过滤先失效，但仍应返回候选
  const longProfile = {
    ...profile,
    estimatedTokens: 200_000,
  }

  const ranked = rankCandidates(longProfile, [
    candidate({ accountId: 'only-one', displayName: 'Kimi-K2.6', actualModelId: 'kimi-k2.6', providerId: 'kimi', providerName: 'Kimi' }),
  ], { now: NOW })

  assert.equal(ranked.length, 1)
})

test('rankCandidates returns nothing when no model can satisfy the request', () => {
  const profile = profileRequest({
    model: 'auto',
    messages: [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'text', text: '看图' }],
      },
    ],
  })

  const ranked = rankCandidates(profile, [
    candidate({ providerId: 'qwen', displayName: 'Qwen3.7-Max', accountId: 'text-only' }),
  ], { now: NOW })

  assert.deepEqual(ranked, [])
})

test('rankCandidates steers away from accounts with requests in flight', () => {
  const profile = profileRequest(textRequest('hi'))

  const ranked = rankCandidates(profile, [
    candidate({ accountId: 'busy', inFlight: 6, rpmUsed: 30 }),
    candidate({ accountId: 'idle', inFlight: 0, rpmUsed: 0 }),
  ], { now: NOW, strategy: 'round-robin' })

  assert.equal(ranked[0].accountId, 'idle')
})

test('rankCandidates honors an explicit rpmLimit over relative load', () => {
  const profile = profileRequest(textRequest('hi'))

  const ranked = rankCandidates(profile, [
    candidate({ accountId: 'throttled', rpmLimit: 10, rpmUsed: 10 }),
    candidate({ accountId: 'has-headroom', rpmLimit: 10, rpmUsed: 0 }),
  ], { now: NOW, strategy: 'round-robin' })

  assert.equal(ranked[0].accountId, 'has-headroom')
})

test('fill-first prefers an already used account while round-robin prefers the fresh one', () => {
  const profile = profileRequest(textRequest('hi'))
  const candidates = [
    candidate({ accountId: 'used', dailyLimit: 100, todayUsed: 90 }),
    candidate({ accountId: 'fresh', dailyLimit: 100, todayUsed: 0 }),
  ]

  const fillFirst = rankCandidates(profile, candidates, { now: NOW, strategy: 'fill-first' })
  const roundRobin = rankCandidates(profile, candidates, { now: NOW, strategy: 'round-robin' })

  assert.equal(fillFirst[0].accountId, 'used')
  assert.equal(roundRobin[0].accountId, 'fresh')
})

test('failover ranking is stable and ignores the dispersion seed', () => {
  const profile = profileRequest(textRequest('hi'))
  const candidates = [
    candidate({ accountId: 'a', providerId: 'qwen' }),
    candidate({ accountId: 'b', providerId: 'qwen' }),
  ]

  const first = rankCandidates(profile, candidates, { now: NOW, strategy: 'failover', seed: 1 })
  const second = rankCandidates(profile, candidates, { now: NOW, strategy: 'failover', seed: 7 })

  assert.deepEqual(first.map(item => item.accountId), second.map(item => item.accountId))
})

test('conversationKey is stable across later turns of the same conversation', () => {
  const opening = {
    model: 'auto',
    messages: [
      { role: 'system' as const, content: '你是助手' },
      { role: 'user' as const, content: '介绍一下 Koa' },
    ],
  }
  const laterTurn = {
    model: 'auto',
    messages: [
      { role: 'system' as const, content: '你是助手' },
      { role: 'user' as const, content: '介绍一下 Koa' },
      { role: 'assistant' as const, content: 'Koa 是一个 Node 框架' },
      { role: 'user' as const, content: '它和 Express 有什么区别' },
    ],
  }

  assert.equal(conversationKey(opening), conversationKey(laterTurn))
})

test('conversationKey separates different conversations and different system prompts', () => {
  const base = {
    model: 'auto',
    messages: [{ role: 'user' as const, content: '介绍一下 Koa' }],
  }
  const otherUser = {
    model: 'auto',
    messages: [{ role: 'user' as const, content: '介绍一下 Fastify' }],
  }
  const otherSystem = {
    model: 'auto',
    messages: [
      { role: 'system' as const, content: '你是代码审查员' },
      { role: 'user' as const, content: '介绍一下 Koa' },
    ],
  }

  assert.notEqual(conversationKey(base), conversationKey(otherUser))
  assert.notEqual(conversationKey(base), conversationKey(otherSystem))
})

test('conversationKey returns undefined without a user message', () => {
  assert.equal(conversationKey({ model: 'auto', messages: [] }), undefined)
  assert.equal(
    conversationKey({
      model: 'auto',
      messages: [{ role: 'system' as const, content: '你是助手' }],
    }),
    undefined
  )
})

// ── 候选池策略筛选 ─────────────────────────────────────────────────────────

/**
 * 构造一个策略候选。providerType 是策略筛选区别于硬过滤的关键字段：
 * 渠道类策略要按供应商类型过滤。
 */
function poolCandidate(overrides: Partial<PoolStrategyCandidate>): PoolStrategyCandidate {
  return {
    providerId: 'qwen',
    providerName: 'Qwen',
    displayName: 'Qwen3.7-Max',
    actualModelId: 'qwen3.7-max',
    accountId: 'account-a',
    providerType: 'aggregate',
    ...overrides,
  }
}

/** 策略筛选测试用的常量阈值 */
const LONG_CONTEXT = 128000
const STANDARD_CONTEXT = 32000

test('STRATEGY_PREDICATES covers all 17 strategy ids exactly once', () => {
  assert.deepEqual(Object.keys(STRATEGY_PREDICATES).sort(), [...AUTO_POOL_STRATEGY_IDS].sort())
  for (const id of AUTO_POOL_STRATEGY_IDS) {
    assert.equal(typeof STRATEGY_PREDICATES[id], 'function')
  }
})

test('capability predicates read resolved capability, unknown stays unknown', () => {
  const visionYes = poolCandidate({ providerId: 'glm', displayName: 'GLM-5.3', capabilityHint: { vision: 'yes' } })
  const visionNo = poolCandidate({ providerId: 'kimi', displayName: 'Kimi / Instant', capabilityHint: { vision: 'no' } })
  const visionUnknown = poolCandidate({ providerId: 'custom', displayName: 'mystery', capabilityHint: {} })

  assert.equal(STRATEGY_PREDICATES['vision-capable'](visionYes), true)
  assert.equal(STRATEGY_PREDICATES['vision-capable'](visionNo), false)
  assert.equal(STRATEGY_PREDICATES['vision-capable'](visionUnknown), false)

  const toolsYes = poolCandidate({ capabilityHint: { tools: 'yes' } })
  const toolsNo = poolCandidate({ capabilityHint: { tools: 'no' } })
  assert.equal(STRATEGY_PREDICATES['tools-capable'](toolsYes), true)
  assert.equal(STRATEGY_PREDICATES['tools-capable'](toolsNo), false)
})

test('multimodal is approximated by vision=yes until a dedicated field exists', () => {
  const visionYes = poolCandidate({ capabilityHint: { vision: 'yes' } })
  const visionNo = poolCandidate({ capabilityHint: { vision: 'no' } })
  assert.equal(STRATEGY_PREDICATES['multimodal'](visionYes), true)
  assert.equal(STRATEGY_PREDICATES['multimodal'](visionNo), false)
})

test('reasoning requires strong tier AND a reason/thinking name (case-insensitive)', () => {
  const strongReason = poolCandidate({ displayName: 'GPT-Reason', capabilityHint: { tier: 'strong' } })
  const strongThinking = poolCandidate({ displayName: 'o3-Thinking', capabilityHint: { tier: 'strong' } })
  const strongNoReason = poolCandidate({ displayName: 'GPT-4o', capabilityHint: { tier: 'strong' } })
  const weakReason = poolCandidate({ displayName: 'GPT-Reason', capabilityHint: { tier: 'fast' } })

  assert.equal(STRATEGY_PREDICATES['reasoning'](strongReason), true)
  assert.equal(STRATEGY_PREDICATES['reasoning'](strongThinking), true)
  assert.equal(STRATEGY_PREDICATES['reasoning'](strongNoReason), false)
  // tier strong 是必要条件：名字命中但档位不够也算 false
  assert.equal(STRATEGY_PREDICATES['reasoning'](weakReason), false)
})

test('annotated-only passes when any of vision/tools/contextTokens is defined', () => {
  const visionOnly = poolCandidate({ capabilityHint: { vision: 'yes' } })
  const toolsOnly = poolCandidate({ capabilityHint: { tools: 'no' } })
  const contextOnly = poolCandidate({ capabilityHint: { contextTokens: 32000 } })
  const allUnknown = poolCandidate({ capabilityHint: {} })

  assert.equal(STRATEGY_PREDICATES['annotated-only'](visionOnly), true)
  assert.equal(STRATEGY_PREDICATES['annotated-only'](toolsOnly), true)
  assert.equal(STRATEGY_PREDICATES['annotated-only'](contextOnly), true)
  assert.equal(STRATEGY_PREDICATES['annotated-only'](allUnknown), false)
})

test('cost predicates distinguish free, included, known and unknown', () => {
  const free = poolCandidate({ costBucket: 'free' })
  const included = poolCandidate({ costBucket: 'free', costClass: 'included' })
  const aboveBase = poolCandidate({ costBucket: 'above-base' })
  const unknown = poolCandidate({ costBucket: 'unknown' })
  const missing = poolCandidate({})

  assert.equal(STRATEGY_PREDICATES['free-only'](free), true)
  assert.equal(STRATEGY_PREDICATES['free-only'](included), true) // costBucket 仍是 free
  assert.equal(STRATEGY_PREDICATES['free-only'](aboveBase), false)

  assert.equal(STRATEGY_PREDICATES['included-plan'](included), true)
  assert.equal(STRATEGY_PREDICATES['included-plan'](free), false) // 完全免费不是套餐内
  assert.equal(STRATEGY_PREDICATES['included-plan'](unknown), false)

  assert.equal(STRATEGY_PREDICATES['cost-known'](free), true)
  assert.equal(STRATEGY_PREDICATES['cost-known'](aboveBase), true)
  assert.equal(STRATEGY_PREDICATES['cost-known'](unknown), false)
  assert.equal(STRATEGY_PREDICATES['cost-known'](missing), false) // 缺失不等于已知
})

test('low-weight requires an annotated weight ≤ 1, never treats missing as 0', () => {
  const low = poolCandidate({ capabilityHint: { weight: 0.5 } })
  const exactlyOne = poolCandidate({ capabilityHint: { weight: 1 } })
  const high = poolCandidate({ capabilityHint: { weight: 4 } })
  const missing = poolCandidate({ capabilityHint: {} })

  assert.equal(STRATEGY_PREDICATES['low-weight'](low), true)
  assert.equal(STRATEGY_PREDICATES['low-weight'](exactlyOne), true)
  assert.equal(STRATEGY_PREDICATES['low-weight'](high), false)
  // weight 缺失就是缺失，不能当 0（0 会通过，但缺失必须不通过）
  assert.equal(STRATEGY_PREDICATES['low-weight'](missing), false)
})

test('context predicates use explicit thresholds and never default a missing window', () => {
  const long = poolCandidate({ capabilityHint: { contextTokens: LONG_CONTEXT } })
  const standard = poolCandidate({ capabilityHint: { contextTokens: STANDARD_CONTEXT } })
  const between = poolCandidate({ capabilityHint: { contextTokens: 64000 } })
  const missing = poolCandidate({ capabilityHint: {} })

  assert.equal(STRATEGY_PREDICATES['long-context'](long), true)
  assert.equal(STRATEGY_PREDICATES['long-context'](standard), false)
  assert.equal(STRATEGY_PREDICATES['standard-context'](long), true)
  assert.equal(STRATEGY_PREDICATES['standard-context'](standard), true)
  assert.equal(STRATEGY_PREDICATES['standard-context'](between), true)
  // contextTokens 缺失就是 undefined，不能填默认值
  assert.equal(STRATEGY_PREDICATES['long-context'](missing), false)
  assert.equal(STRATEGY_PREDICATES['standard-context'](missing), false)
})

test('tier predicates match the resolved tier exactly', () => {
  const fast = poolCandidate({ capabilityHint: { tier: 'fast' } })
  const strong = poolCandidate({ capabilityHint: { tier: 'strong' } })
  const balanced = poolCandidate({ capabilityHint: { tier: 'balanced' } })

  assert.equal(STRATEGY_PREDICATES['fast-tier'](fast), true)
  assert.equal(STRATEGY_PREDICATES['fast-tier'](strong), false)
  assert.equal(STRATEGY_PREDICATES['strong-tier'](strong), true)
  assert.equal(STRATEGY_PREDICATES['strong-tier'](balanced), false)
  assert.equal(STRATEGY_PREDICATES['balanced-tier'](balanced), true)
  assert.equal(STRATEGY_PREDICATES['balanced-tier'](fast), false)
})

test('channel predicates filter by provider type', () => {
  const aggregate = poolCandidate({ providerType: 'aggregate' })
  const account = poolCandidate({ providerType: 'account' })
  const builtin = poolCandidate({ providerType: 'builtin' })
  const custom = poolCandidate({ providerType: 'custom' })

  assert.equal(STRATEGY_PREDICATES['aggregate-only'](aggregate), true)
  assert.equal(STRATEGY_PREDICATES['aggregate-only'](account), false)
  assert.equal(STRATEGY_PREDICATES['channel-only'](account), true)
  assert.equal(STRATEGY_PREDICATES['channel-only'](aggregate), false)
  assert.equal(STRATEGY_PREDICATES['builtin-only'](builtin), true)
  assert.equal(STRATEGY_PREDICATES['builtin-only'](custom), false)
})

test('applyPoolStrategies returns candidates untouched when no strategies are set', () => {
  const candidates = [
    poolCandidate({ accountId: 'a' }),
    poolCandidate({ accountId: 'b' }),
  ]
  const result = applyPoolStrategies(candidates, [])
  assert.deepEqual(result, candidates)
  // 不改动传入的数组
  assert.equal(candidates.length, 2)
})

test('applyPoolStrategies combines and/or strictly left to right', () => {
  // A: vision=yes ; B: tools=yes ; C: neither ; D: both
  const a = poolCandidate({ accountId: 'a', capabilityHint: { vision: 'yes' } })
  const b = poolCandidate({ accountId: 'b', capabilityHint: { tools: 'yes' } })
  const c = poolCandidate({ accountId: 'c', capabilityHint: {} })
  const d = poolCandidate({ accountId: 'd', capabilityHint: { vision: 'yes', tools: 'yes' } })
  const candidates = [a, b, c, d]

  // 第一个策略无条件生效，其 operator 被忽略
  const firstOnly = applyPoolStrategies(candidates, [{ id: 'vision-capable', operator: 'or' as const }])
  assert.deepEqual(firstOnly.map(c => c.accountId), ['a', 'd'])

  // 且（交集）：vision 且 tools → 只有 d
  const andCase = applyPoolStrategies(candidates, [
    { id: 'vision-capable', operator: 'and' },
    { id: 'tools-capable', operator: 'and' },
  ])
  assert.deepEqual(andCase.map(c => c.accountId), ['d'])

  // 或（并集）：vision 或 tools → a、b、d（c 两个都不满足）
  const orCase = applyPoolStrategies(candidates, [
    { id: 'vision-capable', operator: 'and' },
    { id: 'tools-capable', operator: 'or' },
  ])
  assert.deepEqual(orCase.map(c => c.accountId), ['a', 'b', 'd'])
})

test('applyPoolStrategies preserves candidate order and does not mutate input', () => {
  const a = poolCandidate({ accountId: 'a', capabilityHint: { vision: 'yes' } })
  const b = poolCandidate({ accountId: 'b', capabilityHint: { tools: 'yes' } })
  const c = poolCandidate({ accountId: 'c', capabilityHint: {} })
  const snapshot = [a, b, c]

  const result = applyPoolStrategies(snapshot, [
    { id: 'vision-capable', operator: 'and' },
    { id: 'tools-capable', operator: 'or' },
  ])

  // 结果按原序重建：a、b（c 被两个都不满足）
  assert.deepEqual(result.map(x => x.accountId), ['a', 'b'])
  // 输入数组与对象引用未变
  assert.deepEqual(snapshot, [a, b, c])
  assert.equal(snapshot[0], a)
  assert.equal(snapshot[2], c)
})

test('applyPoolStrategies skips unknown strategy ids without dropping candidates', () => {
  const a = poolCandidate({ accountId: 'a' })
  const b = poolCandidate({ accountId: 'b' })
  // 未知 id 被跳过（fail-open），已知 id 正常过滤
  const result = applyPoolStrategies([a, b], [
    { id: 'not-a-real-id' as AutoPoolStrategyId, operator: 'and' },
    { id: 'builtin-only', operator: 'and' },
  ])
  // builtin-only 过滤掉 aggregate 类型的候选，未知 id 不影响
  assert.deepEqual(result, [])
})

test('normalizeAutoRoutingConfig drops invalid ids, keeps valid ones, falls back operator', () => {
  const normalized = normalizeAutoRoutingConfig({
    poolStrategies: [
      { id: 'free-only', operator: 'and' },
      { id: 'not-real', operator: 'and' }, // 非法 id → 剔除
      { id: 'long-context', operator: 'bogus' as AutoPoolStrategy['operator'] }, // 非法 operator → and
    ],
  })
  assert.deepEqual(normalized.poolStrategies, [
    { id: 'free-only', operator: 'and' },
    { id: 'long-context', operator: 'and' },
  ])
})

test('normalizeAutoRoutingConfig keeps a valid or operator and first-entry operator verbatim', () => {
  const normalized = normalizeAutoRoutingConfig({
    poolStrategies: [
      { id: 'vision-capable', operator: 'or' }, // 第一个 operator 保留原值（求值时被忽略）
      { id: 'multimodal', operator: 'or' },
    ],
  })
  assert.deepEqual(normalized.poolStrategies, [
    { id: 'vision-capable', operator: 'or' },
    { id: 'multimodal', operator: 'or' },
  ])
})

test('normalizeAutoRoutingConfig returns empty poolStrategies when none are supplied', () => {
  const normalized = normalizeAutoRoutingConfig({})
  assert.deepEqual(normalized.poolStrategies, [])
  assert.deepEqual(normalized, {
    ...DEFAULT_AUTO_ROUTING_CONFIG,
    poolStrategies: [],
  })
})
