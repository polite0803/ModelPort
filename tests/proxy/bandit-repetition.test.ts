import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregateBanditStats,
  createBanditRandom,
  isDegradedSuccess,
  sampleBanditSuccessRate,
  type BanditLogEntry,
} from '../../src/main/proxy/autoBandit.ts'

/**
 * Bandit 的第二类 degraded：协议正常（HTTP 200、`finish_reason=tool_calls`）但内容
 * 塌掉的流。2026-11-03 那次会话里，这类流被客户端掐掉后我们只记到 `client_abort`，
 * 评分上等于没发生，于是粘性一直把会话锚在同一家。
 */

const NOW = 1_800_000_000_000

function entry(patch: Partial<BanditLogEntry>): BanditLogEntry {
  return {
    timestamp: NOW,
    status: 'success',
    latency: 1000,
    providerId: 'cline',
    actualModel: 'cline/dots-studio/dots-3-note-preview:free',
    finishReason: 'tool_calls',
    ...patch,
  } as BanditLogEntry
}

const degenerate = { lines: 128, uniqueLines: 20, dedupRatio: 0.156, runChars: 4000, degraded: true }
const healthy = { lines: 128, uniqueLines: 128, dedupRatio: 1, runChars: 12, degraded: false }

test('a repetition-degraded success counts as degraded even with a normal finish reason', () => {
  assert.equal(isDegradedSuccess(entry({ repetition: degenerate })), true)
})

test('a clean success with a repetition reading is not degraded', () => {
  assert.equal(isDegradedSuccess(entry({ repetition: healthy })), false)
})

test('the existing unrequested-length rule still works, and a client cap still excuses it', () => {
  assert.equal(isDegradedSuccess(entry({ finishReason: 'length', repetition: undefined })), true)
  assert.equal(isDegradedSuccess(entry({ finishReason: 'length', maxTokens: 4096, repetition: undefined })), false)
})

test('an error row is never "degraded success", however repetitive', () => {
  assert.equal(isDegradedSuccess(entry({ status: 'error', repetition: degenerate })), false)
})

test('repetition degradations feed the streak that demotes without waiting for samples', () => {
  const stats = aggregateBanditStats(
    [
      entry({ timestamp: NOW - 5000, repetition: healthy }),
      entry({ timestamp: NOW - 4000, repetition: degenerate }),
      entry({ timestamp: NOW - 3000, repetition: degenerate }),
    ],
    NOW,
  )
  const one = stats.get('cline|cline/dots-studio/dots-3-note-preview:free')
  assert.ok(one)
  assert.equal(one.total, 3)
  assert.equal(one.degraded, 2)
  assert.equal(one.consecutiveDegraded, 2, 'two in a row is the immediate-demotion trigger')
})

test('a clean turn in between resets the streak', () => {
  const stats = aggregateBanditStats(
    [
      entry({ timestamp: NOW - 4000, repetition: degenerate }),
      entry({ timestamp: NOW - 3000, repetition: healthy }),
      entry({ timestamp: NOW - 2000, repetition: degenerate }),
    ],
    NOW,
  )
  const one = stats.get('cline|cline/dots-studio/dots-3-note-preview:free')
  assert.equal(one?.degraded, 2)
  assert.equal(one?.consecutiveDegraded, 1, 'the streak is consecutive, not cumulative')
})

// ── 生产形状：读数嵌在 streamTrace 下（2026-11-12 缺陷回归）──────────────────
// 本模块此前只读顶层 `repetition`，而 `getRequestLogs()` 交进来的请求行把它放在
// `streamTrace.repetition`。于是「重复退化」与后来加的「空转/宣布即停」两类从未进过
// 后验评分 —— 判据存在，通路不存在。

const EMPTY_TURN = { contentChars: 0, toolCallDeltas: 0, toolsOffered: true, empty: true, announcedStop: false }
const ANNOUNCED = {
  contentChars: 42, toolCallDeltas: 0, toolsOffered: true, empty: false, lastChar: '：', announcedStop: true,
}

test('生产行形状（streamTrace 嵌套）也要被认成 degraded', () => {
  assert.equal(isDegradedSuccess(entry({ streamTrace: { repetition: degenerate } })), true,
    '顶层读法在真实日志上永远拿到 undefined —— 这就是那两类失效的原因')
  assert.equal(isDegradedSuccess(entry({ streamTrace: { emptyTurn: EMPTY_TURN } })), true)
  assert.equal(isDegradedSuccess(entry({ streamTrace: { emptyTurn: ANNOUNCED } })), true)
  assert.equal(isDegradedSuccess(entry({ streamTrace: { repetition: healthy, emptyTurn: EMPTY_TURN } })), true,
    '任一类命中即算不可用成功')
})

test('正常交付的生产行不许被降权', () => {
  assert.equal(
    isDegradedSuccess(entry({ streamTrace: { repetition: healthy, emptyTurn: { ...EMPTY_TURN, empty: false } } })),
    false,
  )
  assert.equal(
    isDegradedSuccess(entry({ streamTrace: { emptyTurn: { ...ANNOUNCED, announcedStop: false, lastChar: '。' } } })),
    false,
    '正文以句号收尾的最终答复是合法答案，不是宣布即停',
  )
})

test('宣布即停累计进 degraded 并驱动连击重罚', () => {
  const stats = aggregateBanditStats(
    [
      entry({ timestamp: NOW - 3000, streamTrace: { emptyTurn: ANNOUNCED } }),
      entry({ timestamp: NOW - 2000, streamTrace: { emptyTurn: ANNOUNCED } }),
      entry({ timestamp: NOW - 1000, streamTrace: { emptyTurn: ANNOUNCED } }),
    ],
    NOW,
  )
  const one = stats.get('cline|cline/dots-studio/dots-3-note-preview:free')
  assert.equal(one?.successes, 3, 'HTTP 层面三笔都是成功')
  assert.equal(one?.degraded, 3)
  assert.equal(one?.consecutiveDegraded, 3)
})

test('会干活的免费候选排在只宣布的前面（这就是「时间一久筛出来」）', () => {
  const talker = 'cline|cline-free/talker'
  const worker = 'cline|cline-free/worker'
  const entries: BanditLogEntry[] = []
  for (let i = 0; i < 8; i++) {
    const ts = NOW - (8 - i) * 1000
    entries.push(entry({ timestamp: ts, providerId: 'cline', actualModel: 'cline-free/talker', streamTrace: { emptyTurn: ANNOUNCED } }))
    entries.push(entry({ timestamp: ts, providerId: 'cline', actualModel: 'cline-free/worker', streamTrace: { repetition: healthy, emptyTurn: { ...EMPTY_TURN, contentChars: 20, empty: false } } }))
  }
  const stats = aggregateBanditStats(entries, NOW)
  const random = createBanditRandom(42)
  const rateOf = (key: string): number => {
    const found = stats.get(key)
    assert.ok(found, `missing stats for ${key}`)
    return sampleBanditSuccessRate(found, random)
  }
  assert.ok(rateOf(worker) > rateOf(talker), `worker=${rateOf(worker)} talker=${rateOf(talker)}`)
})
