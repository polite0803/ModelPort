/**
 * 「本轮请求体量 vs 这一家窗口」的唯一算法（纯函数）。
 *
 * 钉住三件事：
 * 1. 没公布窗口的候选得到 `unknown`，绝不会拿到一个猜测窗口（64K 兜底那个坑）；
 * 2. 上游实测的超限优先于判定，并且带 `contextFitSource:'measured'` ——
 *    判定值不冒充实测值；
 * 3. 估算值是估算：这个函数不产生 `usage`，只产生读数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readRequestContextFit } from '../../src/shared/requestContextFit.ts'

test('有公布窗口：按估算入量判 fits / overflow', () => {
  assert.deepEqual(readRequestContextFit({ estimatedTokens: 40_000, contextWindow: 128_000 }), {
    inputTokensEstimate: 40_000,
    modelContextWindow: 128_000,
    contextFit: 'fits',
  })
  assert.deepEqual(readRequestContextFit({ estimatedTokens: 130_000, contextWindow: 128_000 }), {
    inputTokensEstimate: 130_000,
    modelContextWindow: 128_000,
    contextFit: 'overflow',
  })
})

test('没公布窗口 → unknown，且不写 modelContextWindow', () => {
  assert.deepEqual(readRequestContextFit({ estimatedTokens: 200_000 }), {
    inputTokensEstimate: 200_000,
    contextFit: 'unknown',
  })
  // 0 / 负数 / 非正数的"窗口"等同没公布
  assert.equal(readRequestContextFit({ estimatedTokens: 10, contextWindow: 0 }).contextFit, 'unknown')
  assert.equal('modelContextWindow' in readRequestContextFit({ estimatedTokens: 10, contextWindow: -1 }), false)
})

test('上游实测超限优先于判定，并带 measured 来源标记', () => {
  const fitsByEstimate = readRequestContextFit({
    estimatedTokens: 1_000,
    contextWindow: 128_000,
    measuredOverflow: true,
  })
  assert.deepEqual(fitsByEstimate, {
    inputTokensEstimate: 1_000,
    modelContextWindow: 128_000,
    contextFit: 'overflow',
    contextFitSource: 'measured',
  })

  const unknownWindow = readRequestContextFit({ estimatedTokens: 1_000, measuredOverflow: true })
  assert.equal(unknownWindow.contextFit, 'overflow')
  assert.equal(unknownWindow.contextFitSource, 'measured')
  assert.equal('modelContextWindow' in unknownWindow, false, '没有窗口证据就不要编一个')
})

test('估算值取整且不为负；读数里没有 usage 字段', () => {
  const reading = readRequestContextFit({ estimatedTokens: -5.7, contextWindow: 32_768 })
  assert.equal(reading.inputTokensEstimate, 0)
  assert.equal('usage' in reading, false)
  assert.equal('prompt_tokens' in reading, false)
})
