import { test } from 'node:test'
import assert from 'node:assert/strict'

import { aggregateBanditStats, isDegradedSuccess, type BanditLogEntry } from '../../src/main/proxy/autoBandit.ts'

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
