import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { buildRejectionLogEntry, requestedModelOf } from '../../src/main/proxy/rejectionLog.ts'
import { currentLocalDay } from '../../src/shared/localDay.ts'

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

test('a refused request is logged as an error row that says why', () => {
  const today = currentLocalDay()

  const entry = buildRejectionLogEntry({
    method: 'POST',
    path: '/v1/models',
    statusCode: 405,
    code: 'method_not_allowed',
    message: 'Method Not Allowed: POST /v1/models.',
    startedAt: today.start + 1000,
    now: today.start + 1260,
    model: 'Qwen3.8-Flash',
  })

  assert.equal(entry.status, 'error')
  assert.equal(entry.statusCode, 405)
  assert.equal(entry.responseStatus, 405)
  assert.equal(entry.method, 'POST')
  assert.equal(entry.url, '/v1/models')
  assert.equal(entry.model, 'Qwen3.8-Flash')
  assert.equal(entry.timestamp, today.start + 1000)
  assert.equal(entry.latency, 260)
  assert.equal(entry.isStream, false)
  assert.match(entry.errorMessage ?? '', /^method_not_allowed: Method Not Allowed/)
  assert.equal(
    buildRejectionLogEntry({
      method: 'GET',
      path: '/v1/models',
      statusCode: 401,
      code: 'missing_api_key',
      message: 'API key is required',
      startedAt: today.start + 1000,
      now: today.start + 1005,
      model: '',
      userAgent: 'some-client/1.2.3',
    }).userAgent,
    'some-client/1.2.3',
    'a refused caller must be identifiable by UA',
  )

  assert.equal(
    buildRejectionLogEntry({
      method: 'GET',
      path: '/v1/models',
      statusCode: 404,
      code: 'route_not_found',
      message: 'Route not found',
      startedAt: today.start + 1000,
      now: today.start + 900,
      model: '',
    }).latency,
    0,
    'a clock that runs backwards must not log a negative latency',
  )
})

test('the model stays empty when the body was never parsed', () => {
  assert.equal(requestedModelOf(undefined), '')
  assert.equal(requestedModelOf(null), '')
  assert.equal(requestedModelOf('not-an-object'), '')
  assert.equal(requestedModelOf({ model: 42 }), '')
  assert.equal(requestedModelOf({ model: 'glm-4.6' }), 'glm-4.6')
})

test('every refusal path records the request, and only the model API does', () => {
  const server = sourceOf('../../src/main/proxy/server.ts')

  assert.match(server, /recordRejectedRequest\(ctx, 401, 'missing_api_key'/)
  assert.match(server, /userAgent: ctx\.get\('user-agent'\)/, 'refused rows must carry the caller UA')
  assert.match(server, /recordRejectedRequest\(ctx, 401, 'invalid_api_key'/)
  assert.match(server, /recordRejectedRequest\(ctx, routeError\.status, routeError\.body\.error\.code/)
  assert.match(server, /if \(!isModelApiPath\(ctx\.path\)\)/, 'management refusals must not join the model traffic counts')
  assert.match(server, /storeManager\.recordRequestInStats\(false, entry\.latency/, 'the cards must count the same set as the chart')
})

test('the route reply carries its own status so koa cannot rewrite it', () => {
  const server = sourceOf('../../src/main/proxy/server.ts')
  const statusIndex = server.indexOf('ctx.status = routeError.status')
  const bodyIndex = server.indexOf('ctx.body = routeError.body')

  assert.ok(statusIndex > -1, 'the catch-all must answer 405 itself')
  assert.ok(bodyIndex > statusIndex, 'status must be set before the body so allowedMethods() leaves it alone')
})

test('no live day aggregate derives its day from a UTC string', () => {
  const files = [
    '../../src/main/requestLogs/manager.ts',
    '../../src/main/appLogs/manager.ts',
    '../../src/main/store/store.ts',
    '../../src/renderer/src/stores/dashboardStore.ts',
    '../../src/renderer/src/stores/proxyStore.ts',
  ]

  for (const file of files) {
    assert.doesNotMatch(
      sourceOf(file),
      /toISOString\(\)\.split\('T'\)\[0\]/,
      `${file} still buckets by UTC day`,
    )
  }
})

test('the new absence strings exist in both shipped locales', () => {
  const keys = ['trendUnavailable', 'chartRetentionGap', 'chartDayNotRetained']

  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(sourceOf(`../../src/renderer/src/i18n/locales/${locale}.json`))
    for (const key of keys) {
      assert.equal(typeof messages.dashboard?.[key], 'string', `${locale} is missing dashboard.${key}`)
    }
  }

  const zh = JSON.parse(sourceOf('../../src/renderer/src/i18n/locales/zh-CN.json'))
  assert.match(zh.dashboard.chartRetentionGap, /\{\{days\}\}/, 'the half-written placeholder passes every parity gate')
})

test('the retired log manager and the app-log event wire stay retired', () => {
  assert.equal(
    existsSync(fileURLToPath(new URL('../../src/main/logger/manager.ts', import.meta.url))),
    false,
    'src/main/logger bucketed its trend by UTC day and nothing imported it',
  )

  // logs:newLog had its only emitter in that deleted file and still has no
  // subscriber, so the channel, its preload listener and its type stay gone.
  for (const file of [
    '../../src/main/ipc/channels.ts',
    '../../src/preload/index.ts',
    '../../src/renderer/src/types/electron.d.ts',
  ]) {
    assert.doesNotMatch(sourceOf(file), /LOGS_NEW_LOG|logs:newLog/, `${file} still names the retired app-log channel`)
  }
  assert.doesNotMatch(
    sourceOf('../../src/renderer/src/types/electron.d.ts'),
    /onNewLog: \(callback: \(log: LogEntry\)/,
  )
})

test('the request-log push keeps both an emitter and a subscriber', () => {
  assert.match(sourceOf('../../src/main/ipc/channels.ts'), /REQUEST_LOGS_NEW: 'requestLogs:new'/)
  assert.match(
    sourceOf('../../src/main/store/store.ts'),
    /\r?\n\s+sendRequestLog\(this\.mainWindow, newEntry\)\r?\n/,
    'the store must push the row it just persisted, as a statement of its own',
  )
  assert.match(
    sourceOf('../../src/main/store/store.ts'),
    /logConfig\.enabled && logConfig\.maxEntries > 0/,
    'a row the disk does not keep must not be pushed to the list either',
  )

  const logList = sourceOf('../../src/renderer/src/components/logs/RequestLogList.tsx')
  assert.match(
    logList,
    /requestLogs\?\.onNewLog\?\./,
    'the log list is the only subscriber; without it the channel is dead again',
  )
  assert.match(
    logList,
    /logsRef\.current = \[log, \.\.\./,
    'subscribing without prepending the row leaves the list as stale as no subscription',
  )
})
