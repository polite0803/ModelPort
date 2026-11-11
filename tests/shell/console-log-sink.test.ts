/**
 * The console's own error log. The three things worth pinning are the ones that were missing
 * before: that error/warn reach a file at all, that the file stays bounded, and that a broken
 * profile degrades to plain console output instead of a half-installed bridge.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { loadModule } = await import('../routes/harness.mjs')

const MAX_FILE_BYTES = 2 * 1024 * 1024

function tempProfile(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'shell-console-log-'))
  t.after(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

function logFile(dir: string): string {
  return join(dir, 'logs', 'console.ndjson')
}

function readRows(dir: string): Array<{ ts: string; level: string; message: string }> {
  return readFileSync(logFile(dir), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

test('console.error / console.warn 落进控制台自己的 profile', async (t) => {
  const dir = tempProfile(t)
  const sink = await loadModule('shell/consoleLogSink.ts')

  const printed: string[] = []
  const originalError = console.error
  const originalWarn = console.warn
  const collect = (...args: unknown[]): void => {
    printed.push(args.map(String).join(' '))
  }
  console.error = collect
  console.warn = collect
  try {
    assert.equal(sink.installShellConsoleLog(dir), true)
    console.error('certificate refused for https://10.0.0.5:8443 api_key=sk-abcdef123456')
    console.warn('renderer gone', { code: 11 })
  } finally {
    // The reset must come from the same module instance that installed the bridge.
    sink.resetConsoleBridgeForTests()
    console.error = originalError
    console.warn = originalWarn
  }

  const rows = readRows(dir)
  assert.deepEqual(rows.map((row) => row.level), ['error', 'warn'])
  assert.ok(!rows[0].message.includes('sk-abcdef123456'), '凭证必须先脱敏再落盘')
  assert.match(rows[0].message, /\[REDACTED\]/)
  assert.match(rows[1].message, /renderer gone \{"code":11\}/)
  assert.ok(Date.parse(rows[0].ts) > 0, '每行必须带可读时间戳')
  // 宿主原本的 console 输出不能被桥吃掉（开发机与 --desktop 都靠它）
  assert.equal(printed.length, 2)
})

test('写满上限即轮转，活动文件重新计长', async (t) => {
  const dir = tempProfile(t)
  mkdirSync(join(dir, 'logs'), { recursive: true })
  writeFileSync(logFile(dir), 'x'.repeat(MAX_FILE_BYTES), 'utf8')

  const sink = await loadModule('shell/consoleLogSink.ts')
  const originalError = console.error
  console.error = () => {}
  try {
    assert.equal(sink.installShellConsoleLog(dir), true)
    console.error('after the cap')
  } finally {
    sink.resetConsoleBridgeForTests()
    console.error = originalError
  }

  const rotated = `${logFile(dir)}.1`
  assert.equal(statSync(rotated).size, MAX_FILE_BYTES, '旧内容轮转到 console.ndjson.1')
  assert.deepEqual(readRows(dir).map((row) => row.message), ['after the cap'])
})

test('目录建不出来时不装桥：返回 false、报 stderr、console 原样', async (t) => {
  const dir = tempProfile(t)
  // `logs` 存在但是普通文件：mkdir(recursive) 必然失败
  writeFileSync(join(dir, 'logs'), 'not a directory', 'utf8')

  const sink = await loadModule('shell/consoleLogSink.ts')

  const printed: string[] = []
  const stderrLines: string[] = []
  const originalError = console.error
  const originalStderr = process.stderr.write
  console.error = ((...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }) as typeof console.error
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrLines.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    assert.equal(sink.installShellConsoleLog(dir), false)
    console.error('still reaches the host console')
  } finally {
    process.stderr.write = originalStderr
    console.error = originalError
  }

  assert.deepEqual(printed, ['still reaches the host console'], '失败降级不得吞掉输出')
  assert.match(stderrLines.join(''), /\[Shell\] console log dir unavailable/, '失败要有一行可读的去处')
})
