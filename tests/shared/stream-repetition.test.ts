import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_REPETITION_GUARD,
  REPETITION_TAIL_LINES,
  extractStreamText,
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
