import test from 'node:test'
import assert from 'node:assert/strict'

import type { RequestLogEntry } from '../../src/main/store/types.ts'
import type { RequestLogConfig } from '../../src/main/requestLogs/types.ts'
import { normalizeRequestLogConfig } from '../../src/main/requestLogs/types.ts'
import {
  sanitizeRequestLogEntry,
  sanitizeRequestLogUpdates,
  trimRequestLogsToMaxEntries,
} from '../../src/main/requestLogs/sanitizer.ts'

function createEntry(overrides: Partial<RequestLogEntry> = {}): Omit<RequestLogEntry, 'id'> {
  return {
    timestamp: 1_746_000_000_000,
    status: 'success',
    statusCode: 200,
    method: 'POST',
    url: '/v1/chat/completions',
    model: 'gpt-test',
    responseStatus: 200,
    latency: 123,
    isStream: false,
    requestBody: JSON.stringify({
      authorization: 'Bearer secret-token',
      nested: { api_key: 'super-secret' },
    }),
    responseBody: 'x'.repeat(128),
    responsePreview: 'y'.repeat(64),
    userInput: 'z'.repeat(600),
    errorMessage: 'e'.repeat(80),
    errorStack: 'very long stack trace',
    ...overrides,
  }
}

function createConfig(overrides: Partial<RequestLogConfig> = {}): RequestLogConfig {
  return {
    enabled: true,
    maxEntries: 2,
    includeBodies: true,
    maxBodyChars: 32,
    redactSensitiveData: true,
    bodySampleRate: 0,
    bodyRetentionDays: 7,
    ...overrides,
  }
}

test('sanitizeRequestLogEntry redacts and truncates persisted fields', () => {
  const sanitized = sanitizeRequestLogEntry(createEntry(), createConfig())

  // 栈现在必须保留（只对错误行有用），但仍要脱敏/截断。
  assert.equal(sanitized.errorStack, 'very long stack trace')
  assert.ok(sanitized.userInput?.includes('[truncated'))
  assert.ok(sanitized.requestBody?.includes('[REDACTED]'))
  assert.ok(sanitized.requestBody?.includes('[truncated'))
  assert.ok(sanitized.responseBody?.includes('[truncated'))
})

test('sanitizeRequestLogEntry drops request and response bodies when disabled', () => {
  const sanitized = sanitizeRequestLogEntry(
    createEntry(),
    createConfig({ includeBodies: false }),
  )

  assert.equal(sanitized.requestBody, undefined)
  assert.equal(sanitized.responseBody, undefined)
  // 栈是排障证据，和正文开关无关；只有正文被关掉。
  assert.equal(sanitized.errorStack, 'very long stack trace')
})

test('sanitizeRequestLogUpdates applies the same persistence rules to updates', () => {
  const sanitized = sanitizeRequestLogUpdates(
    {
      requestBody: JSON.stringify({ token: 'secret-token' }),
      responseBody: 'x'.repeat(128),
      errorStack: 'stack',
    },
    createConfig(),
  )

  assert.equal(sanitized.errorStack, 'stack')
  assert.ok(sanitized.requestBody?.includes('[REDACTED]'))
  assert.ok(sanitized.responseBody?.includes('[truncated'))
})

test('sanitizeRequestLogUpdates only touches the fields the patch carries', () => {
  const sanitized = sanitizeRequestLogUpdates(
    { responseBody: 'x'.repeat(128) },
    createConfig({ includeBodies: false }),
  )

  assert.equal('userInput' in sanitized, false)
  assert.equal('errorMessage' in sanitized, false)
  assert.equal('responsePreview' in sanitized, false)
  assert.equal(sanitized.responseBody, undefined)
})

test('trimRequestLogsToMaxEntries keeps the newest entries only', () => {
  const trimmed = trimRequestLogsToMaxEntries(
    [
      { id: '1', ...createEntry({ timestamp: 1 }) },
      { id: '2', ...createEntry({ timestamp: 2 }) },
      { id: '3', ...createEntry({ timestamp: 3 }) },
    ],
    createConfig({ maxEntries: 2 }),
  )

  assert.deepEqual(
    trimmed.map((entry) => entry.id),
    ['2', '3'],
  )
})

test('错误行保底保留：成功行再多也不挤掉最近 100 条错误', () => {
  const entries = [
    { id: 'err-1', ...createEntry({ timestamp: 1, status: 'error' }) },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `ok-${index}`,
      ...createEntry({ timestamp: index + 2, status: 'success' }),
    })),
  ]
  const trimmed = trimRequestLogsToMaxEntries(entries, createConfig({ maxEntries: 2 }))
  assert.ok(trimmed.some((entry) => entry.id === 'err-1'), '错误行不能被成功流量挤掉')
  assert.ok(trimmed.some((entry) => entry.id === 'ok-4'), '仍然保留最新的成功行')
})

test('normalizeRequestLogConfig：默认 maxBodyChars 抬到 200000，存量旧默认随升级迁移', () => {
  // 全新配置：直接拿新默认（用户要求 2026-10-30，8000 排查 1.8MB 请求体时不够用）
  assert.equal(normalizeRequestLogConfig().maxBodyChars, 200_000)
  // 升级迁移：store 里停留在旧默认值 8000 的视为「从未自定义」，提到新默认 ——
  // 否则改默认值对老用户永远不生效（store 里早已落盘 8000）
  assert.equal(normalizeRequestLogConfig({ maxBodyChars: 8000 }).maxBodyChars, 200_000)
  // 用户主动改过的值不得被吞掉
  assert.equal(normalizeRequestLogConfig({ maxBodyChars: 4096 }).maxBodyChars, 4096)
  assert.equal(normalizeRequestLogConfig({ maxBodyChars: 500_000 }).maxBodyChars, 500_000)
})
