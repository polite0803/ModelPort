import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RequestLogEntry } from '../../src/main/store/types.ts'
import type { RequestLogConfig } from '../../src/main/requestLogs/types.ts'
import { normalizeRequestLogConfig } from '../../src/main/requestLogs/types.ts'
import { isBodySampleSelected } from '../../src/main/requestLogs/sampling.ts'
import { RequestLogManager } from '../../src/main/requestLogs/manager.ts'

const DAY_MS = 24 * 60 * 60 * 1000

function createConfig(overrides: Partial<RequestLogConfig> = {}): RequestLogConfig {
  return {
    enabled: true,
    maxEntries: 500,
    includeBodies: false,
    maxBodyChars: 200_000,
    redactSensitiveData: true,
    bodySampleRate: 0,
    bodyRetentionDays: 7,
    ...overrides,
  }
}

function createEntry(overrides: Partial<Omit<RequestLogEntry, 'id'>> = {}): Omit<RequestLogEntry, 'id'> {
  return {
    timestamp: Date.now(),
    status: 'success',
    statusCode: 200,
    method: 'POST',
    url: '/v1/chat/completions',
    model: 'gpt-test',
    responseStatus: 200,
    latency: 100,
    isStream: false,
    requestId: 'req-test',
    requestBody: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    responseBody: '{"choices":[]}',
    ...overrides,
  }
}

async function withManager(
  t: test.TestContext,
  config: RequestLogConfig,
  run: (manager: RequestLogManager, dir: string) => void,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mp-body-basis-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const manager = new RequestLogManager({ storageDir: dir, config })
  await manager.initialize()
  run(manager, dir)
}

test('sample rate 0 keeps the old behaviour: no bodies unless full logging is on', async (t) => {
  await withManager(t, createConfig(), (manager) => {
    const row = manager.addRequestLog(createEntry())
    assert.equal(row.captureBodies, undefined)
    assert.equal(row.requestBody, undefined)
    assert.equal(row.responseBody, undefined)
  })
})

test('sample rate 1 stores the body and records why it was kept', async (t) => {
  await withManager(t, createConfig({ bodySampleRate: 1 }), (manager) => {
    const row = manager.addRequestLog(createEntry())
    assert.equal(row.captureBodies, true)
    assert.match(row.requestBody ?? '', /hello/)
  })
})

test('an explicitly traced request is kept even when the sample rate is 0', async (t) => {
  await withManager(t, createConfig({ bodySampleRate: 0 }), (manager) => {
    const row = manager.addRequestLog(createEntry({ captureBodies: true }))
    assert.equal(row.captureBodies, true)
    assert.match(row.requestBody ?? '', /hello/)
  })
})

test('a row without a request id is never sampled: there is no stable key to draw on', async (t) => {
  await withManager(t, createConfig({ bodySampleRate: 1 }), (manager) => {
    const { requestId: _requestId, ...entry } = createEntry()
    const row = manager.addRequestLog(entry)
    assert.equal(row.captureBodies, undefined)
    assert.equal(row.requestBody, undefined)
  })
})

test('the draw is a function of the request id, so it cannot flip between writes', () => {
  const rate = 0.5
  const first = isBodySampleSelected('req-abc', rate)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(isBodySampleSelected('req-abc', rate), first)
  }
  // 同一个请求 id 在另一份配置对象里也必须给同一个答案。
  assert.equal(isBodySampleSelected('req-abc', 0.5), first)
})

test('sampling at 50% selects roughly half of a thousand ids', () => {
  let selected = 0
  for (let index = 0; index < 1000; index += 1) {
    if (isBodySampleSelected(`req-${index}`, 0.5)) selected += 1
  }
  assert.ok(selected > 400 && selected < 600, `selected ${selected} of 1000`)
})

test('bodies past the retention window are stripped while the row survives', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-body-retention-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const older = new RequestLogManager({ storageDir: dir, config: createConfig({ bodySampleRate: 1 }) })
  await older.initialize()
  older.addRequestLog(createEntry({ timestamp: Date.now() - 10 * DAY_MS, requestId: 'old' }))
  older.flushSync()

  const reloaded = new RequestLogManager({ storageDir: dir, config: createConfig({ bodySampleRate: 1 }) })
  await reloaded.initialize()
  const rows = reloaded.getRequestLogs()
  assert.equal(rows.length, 1, 'the row itself must survive')
  assert.equal(rows[0].requestBody, undefined)
  assert.equal(rows[0].responseBody, undefined)
  assert.equal(rows[0].captureBodies, undefined, 'the flag goes with the body it described')

  reloaded.flushSync()
  const persisted = readFileSync(join(dir, 'request-logs.ndjson'), 'utf8')
  assert.doesNotMatch(persisted, /hello/)
})

test('a row inside the window keeps its body, and 0 days disables the sweep', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-body-retention-keep-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const manager = new RequestLogManager({ storageDir: dir, config: createConfig({ bodySampleRate: 1 }) })
  await manager.initialize()
  manager.addRequestLog(createEntry({ timestamp: Date.now() - 2 * DAY_MS, requestId: 'fresh' }))
  manager.setConfig(createConfig({ bodySampleRate: 1 }))
  assert.match(manager.getRequestLogs()[0].requestBody ?? '', /hello/)
  manager.flushSync()

  const forever = new RequestLogManager({
    storageDir: dir,
    config: createConfig({ bodySampleRate: 1, bodyRetentionDays: 0 }),
  })
  await forever.initialize()
  assert.match(forever.getRequestLogs()[0].requestBody ?? '', /hello/)
})

test('normalize clamps out-of-range sampling and retention values', () => {
  assert.equal(normalizeRequestLogConfig({ bodySampleRate: -1 }).bodySampleRate, 0)
  assert.equal(normalizeRequestLogConfig({ bodySampleRate: 7 }).bodySampleRate, 1)
  assert.equal(normalizeRequestLogConfig({ bodySampleRate: Number.NaN }).bodySampleRate, 0)
  assert.equal(normalizeRequestLogConfig({ bodyRetentionDays: -3 }).bodyRetentionDays, 0)
  assert.equal(normalizeRequestLogConfig({ bodyRetentionDays: 9999 }).bodyRetentionDays, 365)
  // 未给出时不改变默认：升级不能让用户开始落盘请求体。
  assert.equal(normalizeRequestLogConfig({}).bodySampleRate, 0)
  assert.equal(normalizeRequestLogConfig({}).bodyRetentionDays, 7)
})