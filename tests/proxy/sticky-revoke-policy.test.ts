import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isEmptyTurnAfterStream, shouldRevokeStickyAfterStream } from '../../src/main/proxy/streamOutcomePolicy.ts'

test('内容重复退化：正常收尾也要撤锚点', () => {
  assert.equal(
    shouldRevokeStickyAfterStream({ endReason: 'done', repetition: { degraded: true } as never }),
    true,
  )
})

test('正常且未退化：不撤', () => {
  assert.equal(
    shouldRevokeStickyAfterStream({ endReason: 'done', repetition: { degraded: false } as never }),
    false,
  )
})

test('首块之后流中超时：撤（WSL 09:13/09:15/09:19 三连停摆的形状）', () => {
  assert.equal(shouldRevokeStickyAfterStream({ endReason: 'timeout' }), true)
})

test('上游流错误：撤', () => {
  assert.equal(shouldRevokeStickyAfterStream({ endReason: 'error' }), true)
})

test('客户端主动断开：不撤（既不加分也不扣分）', () => {
  assert.equal(shouldRevokeStickyAfterStream({ endReason: 'client_gone' }), false)
})

test('自然 EOF 但未判退化：不撤', () => {
  assert.equal(shouldRevokeStickyAfterStream({ endReason: 'eof' }), false)
})

test('协议完成、内容空转：撤锚点（2026-11-12 `chatcmpl-mwcghqtq-td1xm6` 的形状）', () => {
  assert.equal(
    shouldRevokeStickyAfterStream({ endReason: 'done', emptyTurn: { empty: true } as never }),
    true,
    '176 KB、[DONE] 正常收尾、正文与工具调用皆空 —— 去重率那一格只会给 notJudged: too_short',
  )
})

test('空转读数只在正常收尾时算数：被掐断的零内容不是模型没东西可给', () => {
  for (const endReason of ['done', 'eof', 'timeout', 'client_gone', 'error'] as const) {
    assert.equal(
      isEmptyTurnAfterStream({ endReason, emptyTurn: { empty: true } as never }),
      endReason === 'done',
      endReason,
    )
  }
})

test('有正文或有工具调用：不撤（本轮确实交付了东西）', () => {
  assert.equal(
    shouldRevokeStickyAfterStream({
      endReason: 'done',
      emptyTurn: { contentChars: 12, toolCallDeltas: 0, toolsOffered: true, empty: false } as never,
    }),
    false,
  )
  assert.equal(
    shouldRevokeStickyAfterStream({
      endReason: 'done',
      emptyTurn: { contentChars: 0, toolCallDeltas: 2, toolsOffered: true, empty: false } as never,
    }),
    false,
  )
})
