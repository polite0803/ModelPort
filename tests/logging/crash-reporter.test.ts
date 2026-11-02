import { test } from 'node:test'
import assert from 'node:assert/strict'

const { loadModule } = await import('../routes/harness.mjs')

test('进程级崩溃落盘：带栈/版本/内存上下文，并对重复栈去重', async () => {
  const crash = await loadModule('main/logging/crashReporter.ts')
  crash.resetCrashReporterForTests()

  const entries: Array<Record<string, any>> = []
  crash.setCrashLogWriter((entry: Record<string, any>) => entries.push(entry))

  const sameCrash = new Error('boom')
  crash.recordProcessCrash('uncaughtException', sameCrash)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].level, 'error')
  assert.match(entries[0].message, /boom/)
  assert.equal(entries[0].data.kind, 'uncaughtException')
  assert.ok(String(entries[0].data.stack).includes('Error: boom'))
  assert.equal(entries[0].data.appVersion, '0.0.0-test')
  assert.ok(typeof entries[0].data.memoryMb === 'number')

  // 同一栈一分钟内只写一次，避免崩溃循环刷满日志。
  crash.recordProcessCrash('uncaughtException', sameCrash)
  assert.equal(entries.length, 1)

  crash.recordProcessCrash('unhandledRejection', 'plain rejection')
  assert.equal(entries.length, 2)
  assert.match(entries[1].message, /plain rejection/)
})
