import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shouldRevokeStickyAfterStream } from '../../src/main/proxy/streamOutcomePolicy.ts'

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
