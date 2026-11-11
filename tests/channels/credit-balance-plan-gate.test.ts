/**
 * 余额门控的「计费感知」判据（2026-11-11）。
 *
 * 起因：codex 路由一笔请求的换家链在第 3 家收手，客户端读到 429 后终止；链上最后一笔是
 * 渠道包的池空门控「账号池中的账号当前均不可用（余额为 0…）」。而「余额为 0」有两种语义：
 * 计划本来不发积分（免费档 / 没有配额窗口），和发过又烧光。前者不能拦号 —— 拦掉的是仍能
 * 服务免费模型的账号。qoder 在 2026-11-09 已按这条修好（`qoder-credit-balance-free-plan`），
 * 本批把同一条判据收进 `credits.ts` 成唯一权威，并接到 TRAE / Gemini 两个有真实包数据的渠道。
 *
 * ⚠️ cline / raccoon / lobsterai / minimax 不在本批判据覆盖内：它们的余额响应只有一个汇总
 *    数字，包里的 `total`/`used` 是汇总值伪造的，套用判据会让「0 一律放行」——那是关掉门控。
 *    装配处（`index.ts` 的注册段）写了这条边界，本文件最后一例把这个边界钉住。
 *
 * ⚠️ 被测模块 import 了 vendor 里的兄弟模块，`node --test` 解析不了 `.js` → `.ts`，
 *    故按 `scripts/build-channel-pack.mjs` 的口径用 esbuild 打成临时 bundle 再 import。
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
const COMPAT_LLM = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'dshLlm.ts')

async function loadVendorBundle(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-plan-gate-'))
  t?.after?.(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { planGrantsCredits, creditTotalIfPlanGrants } from ${JSON.stringify(join(VENDOR_SRC, 'credits.ts'))}`,
        `export { toGeminiCreditBalance } from ${JSON.stringify(join(VENDOR_SRC, 'gemini-credits.ts'))}`,
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
    alias: { '@deepseek-ai/dsh-llm': COMPAT_LLM },
  })
  return await import(pathToFileURL(outfile).href)
}

/** 造一个资源包：键按 `credits.ts::CreditPackage` 的真实形状，值随用例。 */
const pack = over => ({
  name: '测试包',
  unit: 'credits',
  remaining: 0,
  total: 0,
  used: 0,
  active: true,
  cycleStartTime: '',
  cycleEndTime: '',
  expiredTime: '',
  ...over,
})

test('判据算术：只有响应里留下「发放过」的痕迹才算发过积分', async t => {
  const { planGrantsCredits } = await loadVendorBundle(t)

  // 没有包 / 包全 0 —— 计划不发积分，不是「烧光」
  assert.equal(planGrantsCredits([]), false)
  assert.equal(planGrantsCredits([pack({})]), false)
  // 领过又用光：`used>0` 或 `total>0` 任一成立即算发过
  assert.equal(planGrantsCredits([pack({ total: 0, used: 100 })]), true)
  assert.equal(planGrantsCredits([pack({ total: 500, used: 500 })]), true)
  // 混合池里只要有一包发过，整个号就是「确凿 0」
  assert.equal(planGrantsCredits([pack({}), pack({ total: 10, used: 10 })]), true)
})

test('归一：免费档拿「未知」放行，烧光拿确凿 0 拦截', async t => {
  const { creditTotalIfPlanGrants } = await loadVendorBundle(t)

  assert.equal(creditTotalIfPlanGrants(null), null, '查不到仍是未知')
  assert.equal(creditTotalIfPlanGrants(undefined), null, '没返回余额对象也是未知')
  // 免费档：展示层拿到 0，门控侧必须拿到 null（放行）
  assert.equal(creditTotalIfPlanGrants({ total: 0, packages: [] }), null)
  assert.equal(creditTotalIfPlanGrants({ total: 0, packages: [pack({})] }), null)
  // 发过又烧光：0 是真读数（拦）
  assert.equal(creditTotalIfPlanGrants({ total: 0, packages: [pack({ total: 100, used: 100 })] }), 0)
  // 有余额照常报数，判据不改变放行侧行为
  assert.equal(creditTotalIfPlanGrants({ total: 50, packages: [pack({ total: 50, used: 0, remaining: 50 })] }), 50)
})

test('Gemini：没有配额窗口 ≠ 余额 0；窗口烧光仍是确凿 0', async t => {
  const { toGeminiCreditBalance, creditTotalIfPlanGrants } = await loadVendorBundle(t)

  // 两个窗口都没下发 → 归一化成 `{total:0, packages:[]}`，门控原先读成 0 拦号
  const noWindows = toGeminiCreditBalance(undefined, undefined)
  assert.equal(noWindows.total, 0)
  assert.equal(noWindows.packages.length, 0)
  assert.equal(creditTotalIfPlanGrants(noWindows), null, '无配额概念 → 未知 → 放行')

  // 有窗口（百分比口径，total 恒 100）且剩余 0 → 确凿用尽，照旧拦
  const burned = toGeminiCreditBalance(
    { bucketId: 'b1', window: '5h', resetTime: '2026-11-11T12:00:00Z', remainingFraction: 0 },
    undefined,
  )
  assert.equal(creditTotalIfPlanGrants(burned), 0, '窗口烧光 → 确凿 0 → 拦截')

  // 有窗口且还有剩余 → 报真实读数（放行）
  const funded = toGeminiCreditBalance(
    { bucketId: 'b2', window: '5h', resetTime: '2026-11-11T12:00:00Z', remainingFraction: 0.4 },
    undefined,
  )
  assert.ok(creditTotalIfPlanGrants(funded) > 0, `应剩百分比余额，实际 ${creditTotalIfPlanGrants(funded)}`)
})

test('门控接线：未知放行、确凿 0 跳过（与装配层同一组合）', async t => {
  const { AccountBalanceGate } = await loadVendorBundle(t)
  // 装配层的探针是 `credential => creditTotalIfPlanGrants(fetch…(credential))`，
  // 这里用同一形状：把归一后的读数直接喂进门控。
  const gateFor = total => new AccountBalanceGate({ probe: async () => total })

  assert.equal(await gateFor(null).usable('gemini-no-windows', {}), undefined, '免费档 → 未知 → 放行')
  assert.equal(await gateFor(0).usable('trae-burned', {}), false, '确凿 0 → 跳过')
  assert.equal(await gateFor(100).usable('trae-funded', {}), true, '有余额 → 放行')
})
