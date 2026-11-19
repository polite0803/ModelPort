/**
 * 裁剪预算的取值顺序：**模型自己的标注 > 分档兜底 > 按渠道/全局的旧数**。
 *
 * 证的是 2026-11-16 现网那个缺陷真正的修法。那天治的是症状（退化分支不再把最新
 * 一条砍成残句），根因是预算取错了：`maxTokensByProvider.volcengine_ark_agent_plan
 * = 65536` 对着一个声明 1,000,000 的模型，Claude Code 自己的系统提示就 65,880
 * token —— 上限永远够不到，于是每一轮都丢掉整段对话。
 *
 * 按渠道写的数在结构上就不可能对：一条路由可以指向任意模型，同一家供应商同时挂着
 * 128K 与 1M 的模型。所以这里钉三件事：
 *   1. 模型声明了窗口就用它，别的配置一律不参与（不是取 min）；
 *   2. 模型没声明才看档位；
 *   3. 档位也没选，才退回渠道/全局的旧数 —— 老配置行为一字不变。
 *
 * 纯函数层，无 store、无 electron、无网络。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTEXT_WINDOW_TIERS,
  isContextWindowTier,
  normalizeContextManagementConfig,
  resolveTrimBudget,
} from '../../src/main/proxy/services/contextManagementService.ts'
import { UNANNOTATED_CONTEXT_FALLBACK } from '../../src/shared/types.ts'

const base = { maxTokens: 65_536 }

test('模型自己声明的窗口优先于按渠道的旧数（现网那一格）', () => {
  // 火山：渠道写 65,536，模型声明 1,000,000。取 65,536 就是原缺陷。
  const budget = resolveTrimBudget(
    { ...base, maxTokensByProvider: { volcengine_ark_agent_plan: 65_536 } },
    'volcengine_ark_agent_plan',
    1_000_000
  )
  assert.equal(budget, 1_000_000, '不能用更小的渠道值把模型窗口压下来')
})

test('模型窗口比渠道值更小时也以模型为准 —— 不是取 min 的巧合', () => {
  // 渠道写 200,000，模型只有 131,072：发 200,000 会被上游 context 400。
  const budget = resolveTrimBudget(
    { ...base, maxTokensByProvider: { trae: 200_000 } },
    'trae',
    131_072
  )
  assert.equal(budget, 131_072)
})

test('模型没声明窗口时用档位兜底', () => {
  const budget = resolveTrimBudget(
    { ...base, maxTokensByProvider: { trae: 65_536 }, contextWindowTier: '400k' },
    'trae',
    undefined
  )
  assert.equal(budget, CONTEXT_WINDOW_TIERS['400k'])
  assert.equal(budget, 400_000)
})

test('档位优先于按渠道的数：显式选档就是显式覆盖', () => {
  const budget = resolveTrimBudget(
    { ...base, maxTokensByProvider: { trae: 100_000 }, contextWindowTier: '1m' },
    'trae'
  )
  assert.equal(budget, 1_000_000)
})

test('既没标注也没选档：退回渠道值；连渠道值也没有时用 200K 兜底（与广告同一个数）', () => {
  assert.equal(
    resolveTrimBudget({ ...base, maxTokensByProvider: { trae: 40_000 } }, 'trae'),
    40_000
  )
  // 2026-11-18 改：未标注时客户端按 `/v1/models` 的 200K 压缩，裁剪不能按 maxTokens
  // （65,536）砍 —— 那会砍掉客户端以为还在的中间段，模型只能重读。
  assert.equal(
    resolveTrimBudget(base, 'trae'),
    Math.max(base.maxTokens, UNANNOTATED_CONTEXT_FALLBACK)
  )
})

test('未知档位当作没选，不静默折成某个数', () => {
  // 落盘的手坏 / 旧版本写进来的字符串：既不是 200k/400k/1m 就不参与。
  const budget = resolveTrimBudget(
    { ...base, contextWindowTier: '512k' as unknown as '1m' },
    'trae'
  )
  assert.equal(budget, Math.max(base.maxTokens, UNANNOTATED_CONTEXT_FALLBACK))
})

test('非法窗口（0 / 负数 / NaN）算没有证据，不许把预算压成 0', () => {
  for (const bogus of [0, -1, Number.NaN]) {
    assert.equal(
      resolveTrimBudget({ ...base, contextWindowTier: '200k' }, 'trae', bogus),
      200_000,
      `${String(bogus)} 不该生效`
    )
  }
})

test('isContextWindowTier 只认三个合法档位', () => {
  assert.equal(isContextWindowTier('200k'), true)
  assert.equal(isContextWindowTier('400k'), true)
  assert.equal(isContextWindowTier('1m'), true)
  assert.equal(isContextWindowTier('1M'), false, '大小写敏感：落盘写的是小写')
  assert.equal(isContextWindowTier(200_000), false)
  assert.equal(isContextWindowTier(undefined), false)
})

test('归一化保留合法档位、丢掉非法档位（不让它落盘成一个脏键）', () => {
  const kept = normalizeContextManagementConfig({
    enabled: true,
    strategies: {
      slidingWindow: { enabled: true, maxMessages: 20 },
      tokenLimit: { enabled: true, maxTokens: 4000, contextWindowTier: '400k' },
    },
    executionOrder: ['slidingWindow', 'tokenLimit'],
  })
  assert.equal(kept.strategies.tokenLimit.contextWindowTier, '400k')

  const dropped = normalizeContextManagementConfig({
    enabled: true,
    strategies: {
      slidingWindow: { enabled: true, maxMessages: 20 },
      tokenLimit: {
        enabled: true,
        maxTokens: 4000,
        contextWindowTier: 'nonsense' as unknown as '1m',
      },
    },
    executionOrder: ['slidingWindow', 'tokenLimit'],
  })
  assert.equal(dropped.strategies.tokenLimit.contextWindowTier, undefined)
  assert.equal('contextWindowTier' in dropped.strategies.tokenLimit, false, '不许留一个 undefined 键')
})