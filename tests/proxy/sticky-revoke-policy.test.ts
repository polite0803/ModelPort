import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isEmptyTurnAfterStream, isAnnouncedStopAfterStream, shouldRevokeStickyAfterStream } from '../../src/main/proxy/streamOutcomePolicy.ts'

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

test('宣布要做却零调用：撤锚点（2026-11-12 `chatcmpl-mwcmniyx-797qi1` 的形状）', () => {
  // 那一轮有 84 个 output token 的正文（所以不是空转）、零工具调用、正文以「：」收尾。
  // 前两类判据都算它健康，锚点不撤 → 会话永久钉在同一台免费模型上，用户连着问三次
  // 「为什么停下来」都还是停。这一格补的就是那一下。
  const announced = {
    endReason: 'done',
    emptyTurn: { contentChars: 120, toolCallDeltas: 0, toolsOffered: true, empty: false, lastChar: '：', announcedStop: true },
  } as never
  assert.equal(isAnnouncedStopAfterStream(announced as never), true)
  assert.equal(shouldRevokeStickyAfterStream(announced as never), true)
})

test('宣布即停只在 done 上判；被掐断的流不因此降权', () => {
  const reading = { contentChars: 120, toolCallDeltas: 0, toolsOffered: true, empty: false, announcedStop: true } as never
  assert.equal(isAnnouncedStopAfterStream({ endReason: 'client_gone', emptyTurn: reading }), false)
  assert.equal(isAnnouncedStopAfterStream({ endReason: 'eof', emptyTurn: reading }), false)
  assert.equal(isAnnouncedStopAfterStream({ endReason: 'done', emptyTurn: undefined }), false)
})

test('正常答复不撤（正文非冒号收尾）', () => {
  assert.equal(
    shouldRevokeStickyAfterStream({
      endReason: 'done',
      emptyTurn: { contentChars: 200, toolCallDeltas: 0, toolsOffered: true, empty: false, lastChar: '。', announcedStop: false } as never,
    }),
    false,
  )
})
