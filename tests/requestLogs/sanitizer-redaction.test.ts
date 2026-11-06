import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeRequestLogEntry, sanitizeRequestLogUpdates } from '../../src/main/requestLogs/sanitizer.ts'
import type { RequestLogConfig } from '../../src/main/store/types.ts'

const CONFIG: RequestLogConfig = {
  enabled: true,
  maxEntries: 200,
  includeBodies: false,
  maxBodyChars: 200_000,
  redactSensitiveData: true,
}

const BASE = {
  timestamp: 1_700_000_000_000,
  status: 'error' as const,
  statusCode: 401,
  method: 'POST',
  url: '/v1/chat/completions',
  model: 'gpt-x',
}

test('上游 401 的 errorMessage 里那把裸 Key 不留明文', () => {
  const out = sanitizeRequestLogEntry(
    { ...BASE, errorMessage: 'Incorrect API key provided: sk-proj-ABCDEF1234567890abcdef' },
    CONFIG,
  )
  assert.equal((out.errorMessage ?? '').includes('sk-proj-ABCDEF1234567890abcdef'), false)
  assert.match(out.errorMessage ?? '', /\[REDACTED\]/)
})

test('独立成串的 Bearer 值不留明文', () => {
  const out = sanitizeRequestLogEntry({ ...BASE, errorMessage: 'rejected Authorization Bearer abcdefghijklmnop1234' }, CONFIG)
  assert.equal((out.errorMessage ?? '').includes('abcdefghijklmnop1234'), false)
})

test('错误文案里的 "API key is required" 不被当成键值对脱敏', () => {
  const out = sanitizeRequestLogEntry(
    { ...BASE, errorMessage: 'missing_api_key: API key is required' },
    CONFIG,
  )
  assert.equal(out.errorMessage, 'missing_api_key: API key is required')
})

test('URL 查询串里的凭据不留明文', () => {
  const out = sanitizeRequestLogEntry({ ...BASE, errorMessage: 'GET https://api.example.com/v1?api_key=supersecretvalue1' }, CONFIG)
  assert.equal((out.errorMessage ?? '').includes('supersecretvalue1'), false)
})

test('用户提示词里粘贴的 Key 同样被脱敏（不是只截断）', () => {
  const out = sanitizeRequestLogEntry({ ...BASE, userInput: '帮我调一下 sk-ant-ABCDEFGHIJKLMNOP1234' }, CONFIG)
  assert.equal((out.userInput ?? '').includes('sk-ANT'.toLowerCase()), false)
  assert.equal((out.userInput ?? '').includes('ABCDEFGHIJKLMNOP1234'), false)
})

test('responsePreview 里带出的凭据值不留明文', () => {
  const out = sanitizeRequestLogEntry(
    { ...BASE, responsePreview: '{"error":{"type":"authentication_error","message":"invalid x-api-key sk-ant-api03-ABCDEFGHIJKLMNOP1234"}}' },
    CONFIG,
  )
  assert.equal((out.responsePreview ?? '').includes('ABCDEFGHIJKLMNOP1234'), false)
})

test('脱敏发生在截断之前：越界处的 Key 不会被截成认不出的片段', () => {
  const padding = 'x'.repeat(900)
  const out = sanitizeRequestLogEntry({ ...BASE, errorMessage: `${padding} sk-live-aaaaaaaaaaaaaaaaaaaa end` }, CONFIG)
  assert.equal((out.errorMessage ?? '').includes('sk-live-aaaaaaaaaaaaaaaaaaaa'), false)
  assert.match(out.errorMessage ?? '', /\[REDACTED\]/)
})

test('增量更新路径与整条路径同口径', () => {
  const patch = sanitizeRequestLogUpdates({ errorMessage: 'boom sk-orv-AAAAAAAAAAAAAAAAAAAA' }, CONFIG)
  assert.equal((patch.errorMessage ?? '').includes('AAAAAAAAAAAAAAAAAAAA'), false)
})

test('增量更新只动带来的键，其它字段不被抹掉', () => {
  const patch = sanitizeRequestLogUpdates({ errorMessage: 'plain failure text' }, CONFIG)
  assert.equal('userInput' in patch, false)
  assert.equal('requestBody' in patch, false)
  assert.equal(patch.errorMessage, 'plain failure text')
})

test('用户显式关掉脱敏时保留原文（这是自选，不是默认）', () => {
  const off = { ...CONFIG, redactSensitiveData: false }
  const out = sanitizeRequestLogEntry({ ...BASE, errorMessage: 'Incorrect API key provided: sk-proj-ABCDEF1234567890abcdef' }, off)
  assert.match(out.errorMessage ?? '', /sk-proj-ABCDEF1234567890abcdef/)
})
