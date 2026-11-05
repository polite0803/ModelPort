/**
 * 账号级终态（上游「停止为这个账号服务」）的共享判据与接线回归。
 *
 * 背景：13 条账号渠道全部按「用消费者账号直连官方接口」的方式工作。上游一旦
 * 判定这是非官方用法，回的是**账号级**处置文案（龙虾实测：
 * `账号已停止提供服务。请通过官方渠道使用有道龙虾…`）。修之前这段文案在任何
 * 渠道里都只是普通失败：继续换号（同一段对话正文再打给别的账号）、不留下任何
 * 标记（被判的号仍是池里第一）、第二天继续自动签到。
 *
 * 本测试钉三件事：
 *
 * 1. 判据只认账号级文案，**不认**额度/限流/普通 403 —— 误判会停掉还在工作的号；
 * 2. 停车写入是 `enabled: false` + `serviceStopped{at,text}`，且写入失败不能把
 *    上游错误替换成本地错误；
 * 3. **接线齐备**：每条带账号池的适配器都必须调用共享判据（源文扫描）。新增
 *    渠道时漏接，这条会红。
 *
 * ⚠️ 被测模块 `account-stop.ts` 零 import，可直接以 TS 源加载。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')

async function loadAccountStop() {
  return await import(pathToFileURL(join(VENDOR_SRC, 'account-stop.ts')).href)
}

test('账号级停止文案命中（中英文两种载体）', async () => {
  const { isAccountStoppedMessage } = await loadAccountStop()
  const samples = [
    '账号已停止提供服务。请通过官方渠道使用有道龙虾；如有异议，请联',
    '{"code":-1,"message":"该账号已被封禁"}',
    'Your account suspended due to violation of the terms',
    'please use the official client',
  ]
  for (const sample of samples) {
    assert.equal(isAccountStoppedMessage(sample), true, `应命中: ${sample}`)
  }
})

test('负控：额度、限流、普通 403 都不算账号被停', async () => {
  const { isAccountStoppedMessage } = await loadAccountStop()
  const samples = [
    '免费额度已用完，请升级套餐',
    '{"message":"insufficient credit"}',
    'too many requests',
    'invalid token',
    'HTTP 403 Forbidden',
    // 腾讯 11140 是**按请求**的内容拦截，适配器刻意换号+30 分钟冷却；
    // 判成账号被停用会误伤一个正常登录。
    '{"code":11140,"msg":"请求被安全审核拦截"}',
    'request violates the content policy',
    '',
  ]
  for (const sample of samples) {
    assert.equal(isAccountStoppedMessage(sample), false, `不得命中: ${sample}`)
  }
  assert.equal(isAccountStoppedMessage(undefined), false)
})

test('停车写入 enabled:false 并保留上游原文', async () => {
  const { parkStoppedAccount } = await loadAccountStop()
  const writes: Array<{ id: string; patch: Record<string, unknown> }> = []
  const pool = {
    async updateAccount(id: string, patch: Record<string, unknown>) { writes.push({ id, patch }) },
  }
  await parkStoppedAccount(pool, 'acct-1', '账号已停止提供服务')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].id, 'acct-1')
  assert.equal(writes[0].patch.enabled, false)
  const stopped = writes[0].patch.serviceStopped as { at: number; text: string }
  assert.equal(stopped.text, '账号已停止提供服务')
  assert.ok(Number.isFinite(stopped.at))
})

test('没有账号 id 或没有池时不做任何写入', async () => {
  const { parkStoppedAccount } = await loadAccountStop()
  let calls = 0
  const pool = { async updateAccount() { calls += 1 } }
  await parkStoppedAccount(pool, undefined, 'x')
  await parkStoppedAccount(pool, '', 'x')
  await parkStoppedAccount(undefined, 'acct-1', 'x')
  assert.equal(calls, 0)
})

test('落库失败不能把上游错误替换成本地错误', async () => {
  const { parkStoppedAccount } = await loadAccountStop()
  const pool = { async updateAccount() { throw new Error('disk full') } }
  await parkStoppedAccount(pool, 'acct-1', '账号已停止提供服务')
})

test('接线齐备：每条带账号池的适配器都调用了共享判据', async () => {
  const adapters = [
    'buddy-adapter.ts', 'cline-adapter.ts', 'gemini-adapter.ts', 'loomy-adapter.ts',
    'minimax-adapter.ts', 'opencode-adapter.ts', 'qoder-adapter.ts', 'raccoon-adapter.ts',
    'trae-adapter.ts', 'zcode-adapter.ts',
  ]
  for (const file of adapters) {
    const source = readFileSync(join(VENDOR_SRC, file), 'utf8')
    assert.match(source, /isAccountStoppedMessage\(/, `${file} 必须接入账号级终态判据`)
  }
})

test('无上限换号已收口', async () => {
  const buddy = readFileSync(join(VENDOR_SRC, 'buddy-adapter.ts'), 'utf8')
  assert.match(buddy, /round < BUDDY_MAX_ROTATE/, 'buddy/workbuddy 的配额换号必须有上限')
  const qoder = readFileSync(join(VENDOR_SRC, 'qoder-adapter.ts'), 'utf8')
  assert.match(qoder, /tried\.size >= QODER_MAX_ROTATE/, 'qoder 的换号必须有上限')
})
