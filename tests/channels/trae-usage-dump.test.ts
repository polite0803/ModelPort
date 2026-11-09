/**
 * TRAE 原始用量帧取证（2026-11-09）：钉住「默认关、开了原样落、写坏不炸请求」。
 *
 * 取证的目的：SOLO 的 token_usage 原帧逐字段落盘，区分「上游不报缓存」与
 * 「报了但字段名不认识」。因此测试的重点是**原样**（未知键一个不丢）与
 * **安全**（关闭值/未解析标志不写盘，写失败不抛）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendTraeUsageDump } from '../../vendor/channel-pack/src/trae-usage-dump.ts'
import { resolveDumpTarget } from '../../src/main/channelPack/outboundDump.ts'

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'trae-usage-dump-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('关闭值与未解析的标志值一律不写盘（绝不猜相对路径）', (t) => {
  const dir = tempDir(t)
  const cwdFile = join(process.cwd(), '1')
  for (const value of [undefined, '', '  ', '0', '1', 'true', 'ON', 'yes']) {
    appendTraeUsageDump(value, { ts: 1, model: 'trae/x', usage: { prompt_tokens: 1 } })
  }
  assert.equal(existsSync(cwdFile), false, '标志值不得被当成相对路径写进 cwd')
  assert.equal(existsSync(join(dir, '1')), false)
})

test('具体路径：原样落盘，未知键一个不丢，逐行可解析', (t) => {
  const dir = tempDir(t)
  const path = join(dir, 'nested', 'trae-usage-dump.ndjson')
  // 刻意带上我们没读过的键与嵌套结构 —— 取证就是要看见这些。
  const usage = { prompt_tokens: 100, completion_tokens: 5, cache_hit_foo: 123, nested: { x: 1 } }
  appendTraeUsageDump(path, { ts: 1000, model: 'trae/test-model', usage })
  appendTraeUsageDump(path, { ts: 1001, model: 'trae/test-model', usage: null })

  const lines = readFileSync(path, 'utf-8').trim().split('\n')
  assert.equal(lines.length, 2, '一次调用一行，追加不覆盖')
  const first = JSON.parse(lines[0])
  assert.deepEqual(first, { ts: 1000, model: 'trae/test-model', usage }, '原帧必须逐字段原样，不得重塑')
  assert.deepEqual(JSON.parse(lines[1]).usage, null, '帧到了但没 usage 记 null，不是缺省')
})

test('写失败不抛：取证开关不许把正常聊天变成 500', (t) => {
  const dir = tempDir(t)
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'I am a file, not a directory')
  // 父路径是文件 → mkdir 必失败。
  assert.doesNotThrow(() => {
    appendTraeUsageDump(join(blocker, 'dump.ndjson'), { ts: 1, model: 'trae/x', usage: null })
  })
})

test('宿主解析器：标志值落到 channel-pack 子目录，文件名参数不改变既有默认', () => {
  const traePath = resolveDumpTarget('1', '/data', 'trae-usage-dump.ndjson')
  assert.ok(traePath && traePath.endsWith(join('channel-pack', 'trae-usage-dump.ndjson')))
  assert.ok(resolveDumpTarget('1', '/data')?.endsWith('outbound-dump.ndjson'), '缺省仍是出站取证文件名')
  assert.equal(resolveDumpTarget('/tmp/pin.ndjson', '/data', 'trae-usage-dump.ndjson'), '/tmp/pin.ndjson')
  assert.equal(resolveDumpTarget('0', '/data', 'trae-usage-dump.ndjson'), null)
})

test('接线钉：worker 归一化 env，适配器在读取之前落原帧', () => {
  const worker = readFileSync('src/main/channelPack/worker.ts', 'utf-8')
  assert.ok(worker.includes("resolveDumpTarget(process.env.MODELPORT_TRAE_USAGE_DUMP, dataDir, 'trae-usage-dump.ndjson')"), 'worker 必须用 dataDir 解析标志值')
  assert.ok(worker.includes('process.env.MODELPORT_TRAE_USAGE_DUMP = traeUsageDumpPath'), '解析结果必须写回 env，vendor 侧才读得到路径')

  const adapter = readFileSync('vendor/channel-pack/src/trae-adapter.ts', 'utf-8')
  const caseStart = adapter.indexOf("case 'token_usage'")
  assert.ok(caseStart >= 0)
  const caseBody = adapter.slice(caseStart, adapter.indexOf("case 'done'", caseStart))
  const dumpAt = caseBody.indexOf('appendTraeUsageDump(')
  const readAt = caseBody.indexOf('readCachedInput(')
  assert.ok(dumpAt >= 0, 'token_usage 分支必须挂取证钩子')
  assert.ok(dumpAt < readAt, '取证必须在口径读取之前 —— 读过的形状不是原帧证据')
})