import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { QuotaLedger } from '../../src/main/proxy/quota/ledger.ts'

const T0 = Date.UTC(2026, 9, 29, 12, 0, 0)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'modelport-quota-'))
}

function usage(total: number) {
  return { promptTokens: Math.floor(total / 2), completionTokens: Math.ceil(total / 2), totalTokens: total }
}

/** 账本的保留与窗口全靠时刻，测试必须自带时钟，否则 flushSync 会按真实墙钟把记录剪掉。 */
function fixedLedger(nowMs: number, dir = tempDir()) {
  return { dir, ledger: new QuotaLedger(dir, () => nowMs) }
}

test('minute and day windows count requests and tokens separately', () => {
  const { ledger } = fixedLedger(T0 + 25 * HOUR + 2 * MINUTE)

  ledger.record('groq', 'a1', 'llama', usage(100), T0)
  ledger.record('groq', 'a1', 'llama', usage(50), T0 + 30_000)
  ledger.record('groq', 'a1', 'llama', usage(25), T0 + 25 * HOUR)

  const later = ledger.snapshot('groq', 'a1', 'llama')
  assert.equal(later.rpm, 0, 'nothing falls inside the last minute')
  assert.equal(later.tpm, 0)
  assert.equal(later.rpd, 1, 'the two records older than 24h have left the rolling day')
  assert.equal(later.tpd, 25)
  assert.equal(later.monthlyTokens, 175, 'the month total is not a 24h window')

  const insideMinute = ledger.snapshot('groq', 'a1', 'llama', T0 + 30_000)
  assert.equal(insideMinute.rpm, 2)
  assert.equal(insideMinute.tpm, 150)
})

test('the provider window sums every model of one account', () => {
  const { ledger } = fixedLedger(T0)

  ledger.record('open_router', 'a1', 'glm-5.2', usage(10), T0)
  ledger.record('open_router', 'a1', 'kimi-k2.6', usage(20), T0)
  ledger.record('open_router', 'a2', 'glm-5.2', usage(99), T0)

  const provider = ledger.providerSnapshot('open_router', 'a1')
  assert.equal(provider.rpm, 2)
  assert.equal(provider.tpm, 30, 'a second account must not leak into this one')
})

test('the month bucket follows the UTC calendar month', () => {
  const { ledger } = fixedLedger(T0)
  ledger.record('groq', 'a1', 'llama', usage(400), T0)
  ledger.record('groq', 'a1', 'llama', usage(600), T0 + 33 * DAY)

  assert.equal(ledger.snapshot('groq', 'a1', 'llama').monthlyTokens, 400)
  assert.equal(ledger.snapshot('groq', 'a1', 'llama', T0 + 33 * DAY).monthlyTokens, 600)
})

test('the ledger survives a restart', () => {
  const { dir, ledger } = fixedLedger(T0)
  ledger.record('cerebras', 'a1', 'qwen3', usage(77), T0)
  ledger.flushSync()

  const reopened = new QuotaLedger(dir, () => T0 + MINUTE)
  const snapshot = reopened.snapshot('cerebras', 'a1', 'qwen3')
  assert.equal(snapshot.rpm, 1)
  assert.equal(snapshot.tpm, 77)
  assert.equal(snapshot.monthlyTokens, 77)
})

test('a corrupted ledger is set aside instead of silently trusted or destroyed', () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'quota-ledger.json'), '{ this is not json', 'utf-8')

  const { ledger } = fixedLedger(T0, dir)
  assert.equal(ledger.snapshot('x', 'a', 'm').rpm, 0, 'startup continues on an empty ledger')

  const files = readdirSync(dir)
  assert.ok(
    files.some(name => name.startsWith('quota-ledger.corrupted.') && name.endsWith('.json')),
    `the unreadable file must be kept for proof, got ${files.join(', ')}`
  )
  assert.ok(!files.includes('quota-ledger.json'), 'the live path must not stay pointed at garbage')
})

test('pruning drops buckets and months that can no longer be in any window', () => {
  const now = T0 + 30 * DAY
  const { dir, ledger } = fixedLedger(now)
  ledger.record('groq', 'a1', 'llama', usage(5), T0)
  ledger.record('groq', 'a1', 'llama', usage(5), now)
  ledger.prune(now)
  ledger.flushSync()

  const persisted = JSON.parse(readFileSync(join(dir, 'quota-ledger.json'), 'utf-8')) as {
    minutes: Record<string, unknown>
    months: Record<string, unknown>
  }
  assert.equal(Object.keys(persisted.minutes).length, 1, 'the 30-day-old minute bucket must be gone')
  assert.deepEqual(Object.keys(persisted.months).sort(), ['2026-10', '2026-11'],
    'the current and the previous UTC month survive; anything older is dropped')
})

test('a month beyond the previous one no longer counts toward monthlyTokens', () => {
  const now = T0 + 90 * DAY
  const { ledger } = fixedLedger(now)
  ledger.record('groq', 'a1', 'llama', usage(500), T0)

  ledger.prune(now)
  assert.equal(ledger.snapshot('groq', 'a1', 'llama').monthlyTokens, 0)
})

test('repeated window reads reuse parsed bucket stamps instead of re-parsing them', () => {
  const now = T0 + 399 * MINUTE + 30_000
  const { ledger } = fixedLedger(now)
  for (let i = 0; i < 400; i++) {
    ledger.record('groq', 'a1', 'llama', usage(10), T0 + i * MINUTE)
  }
  // 先读一遍把缓存焐热，再数 Date.parse：热路径上每个候选都要读这些窗口，
  // 现网 1000+ 个分钟桶时重复解析曾把一次全池选路拖成几秒的事件循环独占。
  ledger.snapshot('groq', 'a1', 'llama')
  ledger.providerSnapshot('groq', 'a1')
  ledger.declaredWindow('groq', 'a1', 'fiveHour')
  ledger.declaredWindow('groq', 'a1', 'week')

  const originalParse = Date.parse
  let parses = 0
  Date.parse = ((value: string) => {
    parses += 1
    return originalParse(value)
  }) as typeof Date.parse
  try {
    for (let i = 0; i < 20; i++) {
      ledger.snapshot('groq', 'a1', 'llama')
      ledger.providerSnapshot('groq', 'a1')
      ledger.declaredWindow('groq', 'a1', 'fiveHour')
      ledger.declaredWindow('groq', 'a1', 'week')
    }
    assert.equal(parses, 0, 'warm window reads must not re-parse bucket stamps')
  } finally {
    Date.parse = originalParse
  }

  const snap = ledger.snapshot('groq', 'a1', 'llama')
  assert.equal(snap.rpm, 1, 'only the newest record is inside the last minute')
  assert.equal(snap.tpm, 10)
  assert.equal(snap.rpd, 400, 'every record is inside the rolling day')
  assert.equal(snap.tpd, 4000)
  assert.equal(ledger.declaredWindow('groq', 'a1', 'fiveHour').requests, 300,
    'the five-hour window keeps the newest 300 of the 400 records')
})

test('the minute window boundary follows at >= now-60s && at <= now exactly', () => {
  // 原口径逐字是 `at < from || at > nowMs` 跳过：起点恰好压在分钟格上时那个桶
  // **计数**。直接按键取桶的实现必须在格点两侧一毫秒都不差。
  const now = T0 + 2 * MINUTE
  const { ledger } = fixedLedger(now)
  ledger.record('groq', 'a1', 'llama', usage(10), T0)
  ledger.record('groq', 'a1', 'llama', usage(20), T0 + MINUTE)
  ledger.record('groq', 'a1', 'llama', usage(40), T0 + 2 * MINUTE)

  const snap = ledger.snapshot('groq', 'a1', 'llama')
  assert.equal(snap.rpm, 2, 'buckets at now-60s and now both count; now-120s does not')
  assert.equal(snap.tpm, 60)

  const offGrid = ledger.snapshot('groq', 'a1', 'llama', now + 1)
  assert.equal(offGrid.rpm, 1, 'one ms past the mark: now-60s+1ms excludes the middle bucket')
  assert.equal(offGrid.tpm, 40)

  const earlier = ledger.snapshot('groq', 'a1', 'llama', now - 1)
  assert.equal(earlier.rpm, 1, 'one ms before the mark: the bucket at now is already in the future')
  assert.equal(earlier.tpm, 20)
})
