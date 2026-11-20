/**
 * 第八类退化：撞满输出上限的残文。
 *
 * 依据（2026-11-20 09:54:44 现网 `chatcmpl-mwobthji-kpo7nq`）：83,358 字、
 * 65,536 token 撞满 `max_tokens`、`finish_reason=length`、零工具调用，客户端
 * 收到一整轮车轱辘话；当时这一行记的是 `success`。
 *
 * 判据只认两点：客户端**没有**指定输出上限，且这一轮带了工具却零调用 ——
 * 正常写长文的回合不会同时具备这两点。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isTruncatedAgentTurn,
  modelQualityDegradation,
} from '../../src/main/proxy/streamOutcomePolicy.ts'
import type { StreamEmptyTurnReading } from '../../src/shared/streamRepetition.ts'

const agentTurn = (overrides: Partial<StreamEmptyTurnReading> = {}): StreamEmptyTurnReading => ({
  contentChars: 83358,
  toolCallDeltas: 0,
  toolsOffered: true,
  empty: false,
  ...overrides,
})

test('现网那一轮：length + 零调用 + 客户端没点上限 ⇒ 判退化', () => {
  const trace = {
    endReason: 'done' as const,
    finishReason: 'length',
    emptyTurn: agentTurn(),
  }
  assert.equal(isTruncatedAgentTurn(trace, false), true)
  assert.equal(modelQualityDegradation(trace, false, null, false), 'output-cap-cutoff')
})

test('客户端自己指定了上限：截断是预期，不判', () => {
  const trace = {
    endReason: 'done' as const,
    finishReason: 'length',
    emptyTurn: agentTurn(),
  }
  assert.equal(isTruncatedAgentTurn(trace, true), false)
  assert.equal(modelQualityDegradation(trace, false, null, true), undefined)
})

test('正常写长文（有工具调用）不判：那不是空转', () => {
  const trace = {
    endReason: 'done' as const,
    finishReason: 'length',
    emptyTurn: agentTurn({ toolCallDeltas: 12 }),
  }
  assert.equal(isTruncatedAgentTurn(trace, false), false)
})

test('没带工具的纯写作客户端不判：长度与正文都是合法的', () => {
  const trace = {
    endReason: 'done' as const,
    finishReason: 'length',
    emptyTurn: agentTurn({ toolsOffered: false }),
  }
  assert.equal(isTruncatedAgentTurn(trace, false), false)
})

test('finish=stop 的零调用回合不由这条判（那是别的判据的事）', () => {
  const trace = {
    endReason: 'done' as const,
    finishReason: 'stop',
    emptyTurn: agentTurn(),
  }
  assert.equal(isTruncatedAgentTurn(trace, false), false)
})

test('没有 emptyTurn 读数时不造结论', () => {
  const trace = { endReason: 'done' as const, finishReason: 'length' }
  assert.equal(isTruncatedAgentTurn(trace, false), false)
})

test('已有的重复判据优先级更高：两条都命中时报 repetition', () => {
  const trace = {
    endReason: 'done' as const,
    finishReason: 'length',
    emptyTurn: agentTurn(),
    repetition: { lines: 8, uniqueLines: 7, dedupRatio: 0.875, runChars: 81892, degraded: true },
  }
  assert.equal(modelQualityDegradation(trace, false, null, false), 'repetition')
})