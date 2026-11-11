/**
 * 余额门控的「降级为最后手段」行为门（2026-11-11）。
 *
 * 起因：codex 路由一笔请求的换家链在第 3 家收手，最后一笔是渠道包的
 * 「账号池中的账号当前均不可用（余额为 0…）」——门控把**只有汇总数字**的 0
 * 当成确凿读数，直接剔号，把候选踢空，客户端因此读到额度类错误并终止会话。
 *
 * 本文件锁死新的处置语义（`AccountPool.getAvailableAccount`）：
 *
 * 1. 确凿 0 的账号**排到最后**，不再被剔除：只要池里还有「有余额」或「未知」的号，
 *    就绝不返回 0 号；
 * 2. 全是 0 号时才动用降级桶，返回手动顺序里第一个，并留下「降级使用」的 warn；
 * 3. 降级不产生「余额门控跳过」这条剔除记录（那条文案一旦回到 failures，
 *    池空假象就回来了）；
 * 4. 健康路径不多探：循环里只读 TTL 缓存（`usableFromCache`），不做内联探针。
 *
 * ⚠️ 与 `credit-balance-plan-gate.test.ts` 的分工：那边管「这个 0 是不是确凿 0」
 *    （判据），这边管「确凿 0 之后怎么处理」（处置）。两条轴各自一个权威。
 *
 * ⚠️ 被测模块 import 了 vendor 兄弟模块与 `@deepseek-ai/*`，按
 *    `scripts/build-channel-pack.mjs` 的 alias 口径打成临时 bundle 再 import；
 *    状态后端用 `DSH_CHANNEL_PACK_STATE_DIR` 指到临时目录，绝不落真实 home。
 *    在禁 esbuild 子进程的沙箱里本文件会以 `spawn EPERM` 红，属环境问题。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

const ALIAS = {
  '@deepseek-ai/dsh-llm': join(COMPAT, 'dshLlm.ts'),
  '@deepseek-ai/dsh-credentials': join(COMPAT, 'dshCredentials.ts'),
  '@deepseek-ai/cordis': join(COMPAT, 'cordis.ts'),
  '@deepseek-ai/schemastery': join(COMPAT, 'schemastery.ts'),
  '@deepseek-ai/dsh-agent': join(COMPAT, 'dshAgent.ts'),
}

async function loadPoolBundle(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-pool-demote-'))
  t?.after?.(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(stateDir, { recursive: true, force: true })
  })
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { AccountPool } from ${JSON.stringify(join(VENDOR_SRC, 'account-pool.ts'))}`,
        `export { AccountBalanceGate } from ${JSON.stringify(join(VENDOR_SRC, 'account-balance-gate.ts'))}`,
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    alias: ALIAS,
  })
  return await import(pathToFileURL(outfile).href)
}

const stateDir = mkdtempSync(join(tmpdir(), 'channel-pack-pool-state-'))
process.env.DSH_CHANNEL_PACK_STATE_DIR = stateDir

const PROVIDER = 'demote-test'

/** 探针按凭据里的名字片段读数：`empty` ⇒ 确凿 0，`unknown` ⇒ 查不到，其余 ⇒ 有余额。 */
function probeFor(cred) {
  const token = String(cred?.token ?? '')
  if (token.includes('empty')) return 0
  if (token.includes('unknown')) return null
  return 100
}

function makeCtx(logs) {
  return {
    logger: {
      warn: message => logs.push(['warn', String(message)]),
      info: message => logs.push(['info', String(message)]),
      error: message => logs.push(['error', String(message)]),
    },
    credentials: {
      resolve: async ref => ({ value: JSON.stringify({ token: String(ref) }) }),
      describe: async ref => ({ ref: String(ref) }),
      set: async () => {},
      unset: async () => {},
    },
  }
}

const entry = (id, order) => ({
  id,
  provider: PROVIDER,
  nickname: id,
  enabled: true,
  credentialRef: id,
  createdAt: order,
  refreshable: false,
})

/** 先把门控缓存焐热：`usableFromCache` 冷缓存只会返回 undefined（后台刷新）。 */
async function warmGate(gate, ids) {
  for (const id of ids) await gate.usable(id, { token: id })
}

test('confirmed-0 accounts are demoted, never returned while an unknown one exists', async t => {
  const { AccountPool, AccountBalanceGate } = await loadPoolBundle(t)
  const logs = []
  const pool = new AccountPool(makeCtx(logs))
  // 手动顺序：确凿 0 → 未知 → 有余额
  for (const id of ['acct-empty-1', 'acct-unknown-1', 'acct-funded-1']) {
    await pool.addAccount(entry(id, 0))
  }
  const gate = new AccountBalanceGate({ probe: async cred => probeFor(cred) })
  pool.setBalanceGate(PROVIDER, gate)
  await warmGate(gate, ['acct-empty-1', 'acct-unknown-1', 'acct-funded-1'])

  const picked = await pool.getAvailableAccount(PROVIDER, '')
  assert.ok(picked !== null, '池里有账号就必须选出账号，门控无权把候选踢空')
  assert.equal(picked.entry.id, 'acct-unknown-1', '未知排在确凿 0 之前：降级号不得插队')

  const text = logs.map(l => l[1]).join('\n')
  assert.ok(!text.includes('余额门控跳过'), '不得再产生「余额门控跳过」这条剔除记录')
  assert.ok(!text.includes('降级使用'), '有非降级号时不该走降级桶')
})

test('an all-zero pool falls back to the first demoted account with a loud warning', async t => {
  const { AccountPool, AccountBalanceGate } = await loadPoolBundle(t)
  const logs = []
  const pool = new AccountPool(makeCtx(logs))
  for (const id of ['acct-empty-1', 'acct-empty-2']) await pool.addAccount(entry(id, 0))
  const gate = new AccountBalanceGate({ probe: async cred => probeFor(cred) })
  pool.setBalanceGate(PROVIDER, gate)
  await warmGate(gate, ['acct-empty-1', 'acct-empty-2'])

  const picked = await pool.getAvailableAccount(PROVIDER, '')
  assert.ok(picked !== null, '全是 0 号也要返回一个候选 —— 让请求真打一次，而不是合成「池空」')
  assert.equal(picked.entry.id, 'acct-empty-1', '降级桶内保持手动顺序')

  const warn = logs.filter(l => l[0] === 'warn').map(l => l[1]).join('\n')
  assert.match(warn, /降级使用余额为 0 的 acct-empty-1/, '降级必须留痕，不能静默')
  assert.match(warn, /被降级候选 2 个/, 'warn 必须带降级候选数')
})

test('funded accounts win over demoted ones regardless of manual order', async t => {
  const { AccountPool, AccountBalanceGate } = await loadPoolBundle(t)
  const logs = []
  const pool = new AccountPool(makeCtx(logs))
  // 确凿 0 排在手动顺序首位（这正是门控 2026-10-30 要治的场景）
  for (const id of ['acct-empty-1', 'acct-funded-1']) await pool.addAccount(entry(id, 0))
  const gate = new AccountBalanceGate({ probe: async cred => probeFor(cred) })
  pool.setBalanceGate(PROVIDER, gate)
  await warmGate(gate, ['acct-empty-1', 'acct-funded-1'])

  const picked = await pool.getAvailableAccount(PROVIDER, '')
  assert.equal(picked?.entry.id, 'acct-funded-1', '有余额的号必须赢过 0 号，门控的原意保留')

  // 同一池再选一次，仍是 funded（降级不会变成粘性优先）
  const again = await pool.getAvailableAccount(PROVIDER, '')
  assert.equal(again?.entry.id, 'acct-funded-1')
})
