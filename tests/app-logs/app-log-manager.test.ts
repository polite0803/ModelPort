import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LogEntry } from '../../src/main/store/types.ts'
import { currentLocalDay } from '../../src/shared/localDay.ts'
import { AppLogManager } from '../../src/main/appLogs/manager.ts'

function createLog(id: string, timestamp: number, level: LogEntry['level'] = 'info'): LogEntry {
  return {
    id,
    timestamp,
    level,
    message: `message-${id}`,
  }
}

test('AppLogManager migrates legacy data.json logs into standalone storage and clears duplicates', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'app-log-manager-migrate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const manager = new AppLogManager({ storageDir: root, maxEntries: 2 })
  await manager.initialize()

  const migrated = await manager.migrateLegacyLogs([
    createLog('1', 1),
    createLog('2', 2),
    createLog('2', 2),
    createLog('3', 3),
  ])
  manager.flushSync()

  assert.equal(migrated, true)
  assert.deepEqual(
    manager.getLogs().map((entry) => entry.id),
    ['3', '2'],
  )

  const persisted = readFileSync(join(root, 'app-logs.ndjson'), 'utf-8')
  assert.match(persisted, /"id":"2"/)
  assert.match(persisted, /"id":"3"/)
  assert.doesNotMatch(persisted, /"id":"1"/)
})

test('AppLogManager buffers app log writes until flush', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'app-log-manager-buffered-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const manager = new AppLogManager({ storageDir: root, maxEntries: 5 })
  await manager.initialize()

  manager.addLog(createLog('1', 1))
  manager.addLog(createLog('2', 2, 'warn'))

  assert.equal(existsSync(join(root, 'app-logs.ndjson')), false)

  manager.flushSync()

  const persisted = readFileSync(join(root, 'app-logs.ndjson'), 'utf-8')
  assert.match(persisted, /"id":"1"/)
  assert.match(persisted, /"level":"warn"/)
})

test('AppLogManager applies filters, pagination, stats, and trend data', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'app-log-manager-query-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const manager = new AppLogManager({ storageDir: root, maxEntries: 10 })
  await manager.initialize()

  const todayStart = currentLocalDay().start
  manager.addLog({
    ...createLog('1', todayStart + 1000, 'info'),
    accountId: 'account-1',
    requestId: 'request-1',
  })
  manager.addLog(createLog('2', todayStart + 2000, 'warn'))
  manager.addLog(createLog('3', todayStart + 3000, 'error'))

  assert.deepEqual(
    manager.getLogs({ level: 'warn' }).map((entry) => entry.id),
    ['2'],
  )
  assert.deepEqual(
    manager.getLogs({ limit: 1, offset: 1 }).map((entry) => entry.id),
    ['2'],
  )
  assert.equal(manager.getStats().error, 1)
  assert.equal(manager.getTrend(1)[0].total, 3)
  assert.equal(manager.getAccountTrend('account-1', 1)[0].total, 1)

  manager.flushSync()
})

test('错误行保底：info 洪峰不能把最近错误挤出保留窗口', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'app-log-manager-error-floor-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const manager = new AppLogManager({ storageDir: root, maxEntries: 2 })
  await manager.initialize()
  manager.addLog(createLog('err-1', 1, 'error'))
  for (let index = 0; index < 5; index++) {
    manager.addLog(createLog(`info-${index}`, index + 2, 'info'))
  }
  manager.flushSync()

  const ids = manager.getLogs().map((entry) => entry.id)
  assert.ok(ids.includes('err-1'), '错误行必须留在日志里')
  assert.ok(ids.includes('info-4'), '最新行仍然保留')
})
