import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_REPETITION_GUARD,
  REPETITION_TAIL_LINES,
  extractStreamText,
  measureStreamEmptyTurn,
  measureStreamRepetition,
  normalizeStreamRepetitionGuard,
} from '../../src/shared/streamRepetition.ts'

/** 把若干行文本编成上游 SSE 帧（每行一个 chunk，换行按真实输出放在 delta 内部）。 */
function sse(lines: string[]): string {
  return lines
    .map((line) => `data: ${JSON.stringify({ choices: [{ delta: { content: line + '\n' } }] })}\n\n`)
    .join('')
}

function reasoningSse(lines: string[]): string {
  return lines
    .map((line) => `data: ${JSON.stringify({ choices: [{ delta: { reasoning: line + '\n' } }] })}\n\n`)
    .join('')
}

const CLEAN = Array.from({ length: 60 }, (_, i) => `distinct sentence number ${i} carrying its own information`)
// 结构照 2026-11-03 那段 dedup=0.456：同一句反复出现，中间夹少量别的行。
const LOOPING = Array.from({ length: 60 }, (_, i) =>
  i % 4 === 3 ? `aside ${i}` : 'The user wants me to continue. The full test is still running.',
)

test('a clean streamed answer is not judged degenerate', () => {
  const reading = measureStreamRepetition(sse(CLEAN))
  assert.ok(reading)
  assert.equal(reading.degraded, false)
  assert.ok(reading.dedupRatio > 0.9)
  assert.equal(reading.notJudged, undefined)
})

test('a collapsed tail is judged, and reasoning-only text counts', () => {
  const reading = measureStreamRepetition(sse(LOOPING))
  assert.ok(reading)
  assert.equal(reading.degraded, true, JSON.stringify(reading))
  assert.ok(reading.dedupRatio <= DEFAULT_REPETITION_GUARD.maxDedupRatio)
  // runChars 只是证据读数，不参与判定（标定显示长连续重复多出现在健康段）。
  assert.ok(reading.runChars > 0)

  const viaReasoning = measureStreamRepetition(reasoningSse(LOOPING))
  assert.equal(viaReasoning?.degraded, true, 'reasoning deltas must be visible to the guard')
})

test('short answers with legitimately repeated lines are never judged', () => {
  // 代码块里成对的 `}` 是正常重复，但行数不到 minLines ⇒ 不判，而不是判成健康。
  const reading = measureStreamRepetition(sse(['function a() {', '}', '}', '}', 'return', '}']))
  assert.ok(reading)
  assert.equal(reading.degraded, false)
  assert.equal(reading.notJudged, 'too_short')
})

test('the guard produces no reading at all when disabled', () => {
  assert.equal(
    measureStreamRepetition(sse(LOOPING), { ...DEFAULT_REPETITION_GUARD, enabled: false }),
    null,
    'disabled must not leave a row that reads like a clean verdict',
  )
})

/** 「可设置变量」这条必须自证：同一份文本，阈值不同结论不同。 */
test('the thresholds are real settings, not decoration', () => {
  const moderate = sse(
    Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 'same line over and over' : `other line ${i}`)),
  )
  const strict = measureStreamRepetition(moderate, { ...DEFAULT_REPETITION_GUARD, maxDedupRatio: 0.25 })
  const shipped = measureStreamRepetition(moderate)
  assert.ok(strict && shipped)
  assert.equal(strict.degraded, false, `dedup ${shipped.dedupRatio} must pass a 0.25 threshold`)
  assert.equal(shipped.degraded, true, 'the shipped 0.8 threshold must flag the same text')
  assert.equal(strict.dedupRatio, shipped.dedupRatio, 'only the verdict may differ, not the measurement')

  const raisedFloor = measureStreamRepetition(sse(LOOPING), { ...DEFAULT_REPETITION_GUARD, minLines: 500 })
  assert.equal(raisedFloor?.degraded, false)
  assert.equal(raisedFloor?.notJudged, 'too_short')
})

test('a hand-edited or legacy config value cannot disable the guard by accident', () => {
  const dirty = [
    { maxDedupRatio: 'abc' },
    { maxDedupRatio: 50 },
    { maxDedupRatio: -3 },
    { minLines: 0 },
    { minLines: null },
    {},
  ]
  for (const patch of dirty) {
    const normalized = normalizeStreamRepetitionGuard(patch)
    assert.equal(normalized.maxDedupRatio, DEFAULT_REPETITION_GUARD.maxDedupRatio, JSON.stringify(patch))
    assert.equal(normalized.minLines, DEFAULT_REPETITION_GUARD.minLines, JSON.stringify(patch))
    assert.equal(normalized.enabled, true, 'absent must not mean off')
  }
  assert.deepEqual(normalizeStreamRepetitionGuard({ enabled: false }), {
    enabled: false,
    minLines: DEFAULT_REPETITION_GUARD.minLines,
    maxDedupRatio: DEFAULT_REPETITION_GUARD.maxDedupRatio,
  })
  assert.deepEqual(
    normalizeStreamRepetitionGuard({ enabled: true, minLines: 60, maxDedupRatio: 0.5 }),
    { enabled: true, minLines: 60, maxDedupRatio: 0.5 },
  )
})

test('only SSE data frames contribute text', () => {
  const mixed = [
    ': PING',
    'data: [DONE]',
    'data: {not json',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'real text here' } }] }),
    'event: something',
  ].join('\n')
  assert.equal(extractStreamText(mixed), 'real text here')
})

test('the verdict is taken over the tail, so a late collapse is not diluted', () => {
  const long = [...CLEAN, ...CLEAN.map((line) => `${line} tail`), ...LOOPING]
  const reading = measureStreamRepetition(sse(long))
  assert.ok(reading)
  assert.equal(reading.lines, REPETITION_TAIL_LINES)
  assert.equal(reading.degraded, true, JSON.stringify(reading))
})

// ── 空转读数（第三类退化）───────────────────────────────────────────────────

function frames(payloads: unknown[]): string {
  return payloads.map(p => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n'
}

test('思考走 reasoning_details 数组时：正文与工具调用都是空，判空转', () => {
  // 2026-11-12 现网 `chatcmpl-mwcghqtq-td1xm6` 的形状：176 KB 全在 reasoning_details 里，
  // 而 extractStreamText 只认三个字符串字段 —— 去重率那一格得到 notJudged: too_short。
  const sseText = frames([
    { choices: [{ delta: { role: 'assistant' } }] },
    { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'thinking…' }] } }] },
    { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'more thinking…' }] } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ])
  const reading = measureStreamEmptyTurn(sseText, true)
  assert.equal(reading.contentChars, 0)
  assert.equal(reading.toolCallDeltas, 0)
  assert.equal(reading.empty, true, JSON.stringify(reading))
  assert.equal(measureStreamRepetition(sseText)?.degraded, false, '去重率判据对这一发是瞎的，所以才要这一格')
})

test('有正文或有工具调用就不算空转', () => {
  assert.equal(measureStreamEmptyTurn(frames([{ choices: [{ delta: { content: 'hi' } }] }]), true).empty, false)
  assert.equal(
    measureStreamEmptyTurn(frames([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'exec' } }] } }] }]), true).empty,
    false,
  )
  const parts = measureStreamEmptyTurn(frames([{ choices: [{ delta: { content: [{ type: 'text', text: 'segmented' }] } }] }]), true)
  assert.equal(parts.contentChars, 'segmented'.length, '内容段数组也是正文，不能读成空')
  assert.equal(parts.empty, false)
})

test('客户端没带工具时不判空转（只说话是合法答案）', () => {
  const reading = measureStreamEmptyTurn(frames([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]), false)
  assert.equal(reading.toolsOffered, false)
  assert.equal(reading.empty, false)
})

test('[DONE]、PING 注释与坏帧不贡献任何计数', () => {
  const reading = measureStreamEmptyTurn(
    [': PING', 'data: [DONE]', 'data: {not json', frames([]).trim(), 'event: foo'].join('\n'),
    true,
  )
  assert.equal(reading.contentChars, 0)
  assert.equal(reading.toolCallDeltas, 0)
  assert.equal(reading.empty, true)
})

// ── 「宣布要做」读数（第四类退化）────────────────────────────────────────────

test('有正文、零工具调用、正文以冒号收尾：判宣布即停', () => {
  // 2026-11-12 05:24 现网 `chatcmpl-mwcmniyx-797qi1` 的形状
  // （cline/nemotron-3.5-lightning-free：「首先，让我看一下 appearanceSections() 的当前结构：」）
  const sseText = frames([
    { choices: [{ delta: { role: 'assistant' } }] },
    { choices: [{ delta: { content: '# 第三步：修改 SettingsNavigator.kt' } }] },
    { choices: [{ delta: { content: '\n\n首先，让我看一下 appearanceSections() 的当前结构：' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ])
  const reading = measureStreamEmptyTurn(sseText, true)
  assert.equal(reading.empty, false, '有正文，所以不是空转那一格')
  assert.equal(reading.lastChar, '：')
  assert.equal(reading.announcedStop, true, JSON.stringify(reading))
  assert.equal(measureStreamRepetition(sseText)?.notJudged, 'too_short', '去重率对这一发同样是瞎的')
})

test('半角冒号同样判；结尾空白不算', () => {
  assert.equal(
    measureStreamEmptyTurn(frames([{ choices: [{ delta: { content: 'now let me read the file:' } }] }]), true).announcedStop,
    true,
  )
  assert.equal(
    measureStreamEmptyTurn(frames([{ choices: [{ delta: { content: 'now let me read the file:  \n\n' } }] }]), true).announcedStop,
    true,
    '尾部空白与换行不该影响收尾字符',
  )
})

test('内容段数组以冒号收尾也判；正文非冒号收尾不判', () => {
  assert.equal(
    measureStreamEmptyTurn(frames([{ choices: [{ delta: { content: [{ type: 'text', text: '下一步：' }] } }] }]), true).announcedStop,
    true,
  )
  const done = measureStreamEmptyTurn(frames([{ choices: [{ delta: { content: '改完了，构建通过。' } }] }]), true)
  assert.equal(done.lastChar, '。')
  assert.equal(done.announcedStop, false, '这是合法的最终答复，不能降权')
})

test('有工具调用、没给工具、或正文为空时都不判宣布即停', () => {
  assert.equal(
    measureStreamEmptyTurn(frames([{ choices: [{ delta: { content: '先看这个：' } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'exec' } }] } }] }]), true).announcedStop,
    false,
    '真发了工具调用就不是「只说不做」',
  )
  assert.equal(
    measureStreamEmptyTurn(frames([{ choices: [{ delta: { content: '先看这个：' } }] }]), false).announcedStop,
    false,
    '客户端没带工具时说话是合法答案',
  )
  const empty = measureStreamEmptyTurn(frames([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]), true)
  assert.equal(empty.empty, true)
  assert.equal(empty.announcedStop, false, '零正文归 empty 那一格')
  assert.equal('lastChar' in empty, false, '没有正文时不该造出收尾字符')
})
