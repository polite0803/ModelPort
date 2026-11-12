import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isEmptyTurnAfterStream,
  isAnnouncedStopAfterStream,
  isProseOnlyStopAfterStream,
  isSlowTurnAfterStream,
  shouldRevokeStickyAfterStream,
} from '../../src/main/proxy/streamOutcomePolicy.ts'

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

test('客户端没点上限、上游按自己默认值截断：撤锚点（Codex 读到 response.incomplete 就地结束任务）', () => {
  const clean = { contentChars: 77, toolCallDeltas: 0, toolsOffered: true, empty: false, lastChar: '。', announcedStop: false }
  assert.equal(shouldRevokeStickyAfterStream({ endReason: 'done', emptyTurn: clean as never }, true), true)
  // 反证：同一份健康读数、没有截断信号时不能撤 —— 判据是截断，不是这一行正文。
  assert.equal(shouldRevokeStickyAfterStream({ endReason: 'done', emptyTurn: clean as never }, false), false)
})

test('首字慢于池内 p75：撤锚点（用户反馈「走路由慢一个数量级」的那条通路）', () => {
  assert.equal(
    shouldRevokeStickyAfterStream({ endReason: 'done', firstTokenMs: 15_300 }, false, 3_000),
    true,
    '现网实测路由 p50 15.3s vs 直连 1.9s —— 完成流但首字慢于池内门槛，不该继续钉住这一家',
  )
})

test('首字慢只在 done 上判：主动断开/被掐断的流不因等待时长降权', () => {
  for (const endReason of ['eof', 'client_gone'] as const) {
    assert.equal(isSlowTurnAfterStream({ endReason, firstTokenMs: 60_000 }, 3_000), false, endReason)
  }
})

test('首字判据的三种缺席：没有门槛、没有读数、刚好等于门槛都不撤', () => {
  assert.equal(isSlowTurnAfterStream({ endReason: 'done', firstTokenMs: 60_000 }, undefined), false,
    '池内读数不足时算不出门槛，不拿绝对毫秒数替它')
  assert.equal(isSlowTurnAfterStream({ endReason: 'done' }, 3_000), false,
    '非流式没有首字读数')
  assert.equal(isSlowTurnAfterStream({ endReason: 'done', firstTokenMs: 3_000 }, 3_000), false,
    '判据是「慢于」，不是「不早于」')
  assert.equal(
    shouldRevokeStickyAfterStream({ endReason: 'done', firstTokenMs: 2_000 }, false, 3_000),
    false,
    '正常速度的完成流不撤锚点',
  )
})

test('换家来的替补只说话不做事：撤锚点（2026-11-13 chatcmpl-mwdt3j2s-d8em3q）', () => {
  // 现网形状：粘性选 minimax，20s 首块切片内零字节（504）→ 换到 loomy/spark-x2.6；
  // 替补 29s 首字、35 字正文、零工具调用、句号收尾 —— 客户端读到一句计划就结束回合。
  const proseOnly = {
    endReason: 'done',
    emptyTurn: { contentChars: 35, toolCallDeltas: 0, toolsOffered: true, empty: false, lastChar: '。', announcedStop: false },
  } as never
  assert.equal(isProseOnlyStopAfterStream(proseOnly), true)
  assert.equal(shouldRevokeStickyAfterStream(proseOnly, false, undefined, true), true)
  // 负控：同一份读数但服务者是首选本身 —— 单轮里它与「任务正常收尾」无法区分，
  // 判退化会罚到每一次成功的收尾，所以不撤。
  assert.equal(shouldRevokeStickyAfterStream(proseOnly, false, undefined, false), false)
})

test('第七类只认「有正文、零调用、带工具、正常收尾」四件同时成立', () => {
  const reading = (patch: Record<string, unknown>) => ({
    endReason: 'done',
    emptyTurn: { contentChars: 35, toolCallDeltas: 0, toolsOffered: true, empty: false, announcedStop: false, ...patch },
  }) as never
  assert.equal(isProseOnlyStopAfterStream(reading({ contentChars: 0 })), false, '零正文属第三类，不在这里判')
  assert.equal(isProseOnlyStopAfterStream(reading({ toolCallDeltas: 3 })), false, '真的调了工具就不算')
  assert.equal(isProseOnlyStopAfterStream(reading({ toolsOffered: false })), false, '客户端没带工具时「只说不做」是合法答案')
  assert.equal(isProseOnlyStopAfterStream({ endReason: 'client_gone', emptyTurn: { contentChars: 35, toolCallDeltas: 0, toolsOffered: true, empty: false, announcedStop: false } } as never), false,
    '被掐断的流不判')
  assert.equal(isProseOnlyStopAfterStream({ endReason: 'done' } as never), false, '没有读数就不判')
})
