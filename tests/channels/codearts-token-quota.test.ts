/**
 * CodeArts（华为云码道）**两种计量并存**的回归测试。
 *
 * 现网取证（2026-11-11，用已登录的两个账号各取一次 `statistics/plugin` 全字段）：
 *
 * | 账号 | 套餐 | 积分项 | token 项 |
 * |---|---|---|---|
 * | hw086287662933786 | `codearts.agent.individual.trial` | `show:true` 剩 4428.19（总 4600 / 已用 171.81） | **同样 `show:true`**，已用 4,774,418、配额位 `1` |
 * | GT-weixin_51024015 | `codearts.agent.trial`(Free) | 整个响应里没有 | `show:true` 配额 5,000,000 / 已用 454,035 |
 *
 * ⇒ 码道**同时有积分与 token 两种免费计量**，同一账号可以两项都有；判据是上游每项自带的
 * `show`，不是「账户类型二选一」。原实现先判 `is_credit_package` 再取数，于是：
 * 老 token 版账号被压成「Token 计费账户，无积分余额」（面板 1/2 有读数），
 * 积分版账号的 token 用量则整个看不见。
 *
 * 契约：
 * 1. 主数字只放一个口径，另一口径作为**并列说明**（`note`），跨口径绝不相加；
 * 2. `package_token_amount` 为占位值 `1` 时只报用量、不报剩余（否则造出负数）；
 * 3. `show: false` 的项不读（`usageDataChatMessages` 两账号都是 false）；
 * 4. 签到/领取资格仍按 `is_credit_package` 判，不因这次改动放宽。
 *
 * ⚠️ vendor 源码不能直接 import（`.js`→`.ts` 解析 + `undici` 垫片），这里按
 * `scripts/build-channel-pack.mjs` 的同一套别名打成临时 bundle 再加载。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

async function loadCredits(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'codearts-quota-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export { fetchCodeArtsAccountInfoDetailed } from ${JSON.stringify(join(VENDOR_SRC, 'codearts-credits.ts'))}`,
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    plugins: [{
      name: 'channel-pack-compat',
      setup(build) {
        build.onResolve({ filter: /^undici$/ }, (args) => {
          if (!args.importer.startsWith(VENDOR_SRC)) return undefined
          return { path: join(COMPAT, 'undici.ts') }
        })
      },
    }],
  })
  return await import(pathToFileURL(outfile).href)
}

const CREDENTIAL = {
  access_key_id: 'AK-test',
  secret_access_key: 'SK-test',
  security_token: 'ST-test',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
}

/** 积分版账号的真实响应（含 `show` 与顶层结构，数值取自现网）。 */
const CREDIT_BODY = {
  start_date: '2026-11-11',
  end_date: '2026-12-12',
  show: { metrics: true, package: true },
  is_teadmin: true,
  is_white_list: false,
  package: {
    spec_code: 'codearts.agent.individual.trial',
    status: 'normal',
    package_name_en: 'Trial',
    package_name_cn: '体验版',
    features: [{ name: 'PromptCenter', enable: false }],
    is_token_package: false,
    is_credit_package: true,
  },
  metrics: [
    { name: 'usageDataChatMessages', value: -1, usage_token_num: 0, package_token_amount: 0, show: false },
    // 上游自己也展示这一项，但配额位是占值 1（用量 477 万是真实的）。
    { name: 'usageTokenChatMessages', value: 0, usage_token_num: 4774418, package_token_amount: 1, show: true },
    {
      name: 'usageTotalPackageCredit', value: 3, usage_token_num: 0, package_token_amount: 0,
      package_credit_amount: 4600, package_credit_used: 171.81, package_credit_remain: 4428.19,
      package_credit_expiring_amount: 89.91, show: true,
    },
    {
      name: 'usageBasicPackageCredit', value: 0, usage_token_num: 0, package_token_amount: 0,
      package_credit_amount: 500, package_credit_used: 0, package_credit_remain: 500, show: true,
    },
    {
      name: 'usageOnDemandPackageCredit', value: 0, usage_token_num: 0, package_token_amount: 0,
      package_credit_amount: 0, package_credit_used: 0, package_credit_remain: 0, show: true,
    },
    {
      name: 'usageBonusPackageCredit', value: 4, usage_token_num: 0, package_token_amount: 0,
      package_credit_amount: 4100, package_credit_used: 171.81, package_credit_remain: 3928.19,
      package_credit_expiring_amount: 89.91, show: true,
    },
  ],
}

/** 老 token 版账号的真实响应：没有任何积分项。 */
const TOKEN_BODY = {
  start_date: '2026-10-13',
  end_date: '2026-11-14',
  show: { metrics: true, package: true },
  package: {
    spec_code: 'codearts.agent.trial',
    status: 'normal',
    package_name_en: 'Free',
    package_name_cn: '体验版',
    features: [{ name: 'PromptCenter', enable: false }],
    is_token_package: true,
    is_credit_package: false,
  },
  metrics: [
    { name: 'usageDataChatMessages', value: -1, usage_token_num: 0, package_token_amount: 0, show: false },
    { name: 'usageTokenChatMessages', value: 0, usage_token_num: 454035, package_token_amount: 5000000, show: true },
  ],
}

function fetcherFor(body) {
  return async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function readInfo(t, body) {
  const pack = await loadCredits(t)
  const result = await pack.fetchCodeArtsAccountInfoDetailed(CREDENTIAL, fetcherFor(body))
  assert.equal(result.ok, true, result.message)
  return result.info
}

test('积分版账号：主读数是积分，token 用量作为并列读数（不是二选一）', async (t) => {
  const info = await readInfo(t, CREDIT_BODY)
  assert.equal(info.isCreditPackage, true)
  assert.equal(info.credit.total, 4428.19)
  assert.notEqual(info.credit.unit, 'token', '主数字仍是积分口径')
  assert.equal(info.credit.packages.length, 3, '额度为 0 的按需包不列')
  assert.ok(info.credit.packages.every(pkg => pkg.unit !== 'token'), 'token 项不得混进积分包')
  // 关键：这个号同时在按 token 消耗，上游 `show: true`，必须带出来
  assert.equal(info.tokenMeter.used, 4774418)
  assert.equal(info.tokenMeter.quota, undefined, '配额位 1 是占值，不能当配额')
})

test('老 token 版账号：报 token 配额余额，而不是「无积分余额」', async (t) => {
  const info = await readInfo(t, TOKEN_BODY)
  assert.equal(info.isCreditPackage, false, '签到/领取资格判据不变：仍不在积分活动范围')
  assert.equal(info.credit.unit, 'token', '余额必须自带口径，宿主才不会把它与积分相加')
  assert.equal(info.credit.total, 4545965, '剩 = 5000000 − 454035')
  assert.equal(info.credit.packages[0].unit, 'token')
  assert.equal(info.credit.packages[0].total, 5000000)
  assert.equal(info.tokenMeter.quota, 5000000)
})

test('套餐失效的 token 账号：读数照给，但标记为失效', async (t) => {
  const info = await readInfo(t, { ...TOKEN_BODY, package: { ...TOKEN_BODY.package, status: 'expired' } })
  assert.equal(info.credit.packages[0].active, false, '非 normal 套餐不能当可用额度显示')
})

test('show:false 的项不读；只有占位配额时不臆造 token 余额', async (t) => {
  const info = await readInfo(t, {
    ...TOKEN_BODY,
    metrics: [
      { name: 'usageDataChatMessages', value: -1, usage_token_num: 999, package_token_amount: 999, show: false },
      { name: 'usageTokenChatMessages', value: 0, usage_token_num: 123, package_token_amount: 1, show: true },
    ],
  })
  assert.equal(info.credit, undefined, '配额位 1 不能折成「总额 1、已用 123」的负剩余')
  assert.equal(info.tokenMeter.used, 123, '用量照实带出，作为说明行')
  assert.equal(info.tokenMeter.quota, undefined)
})

test('token 项被上游隐藏时不产生说明行', async (t) => {
  const info = await readInfo(t, {
    ...CREDIT_BODY,
    metrics: CREDIT_BODY.metrics.map(item =>
      item.name === 'usageTokenChatMessages' ? { ...item, show: false } : item),
  })
  assert.equal(info.credit.total, 4428.19, '积分读数不受影响')
  assert.equal(info.tokenMeter, undefined, '上游 show:false 就不读，界面上也不该冒出一行')
})

test('RPC 分支：主数字一个口径 + 另一口径走 note，且读数判定早于类型判定', () => {
  const rpc = readFileSync(join(VENDOR_SRC, 'channel-pack-rpc.ts'), 'utf8')
  const start = rpc.indexOf("if (req.provider === 'codearts') {\n          // 余额来自")
  assert.ok(start > 0, '找不到 codearts 余额分支')
  const branch = rpc.slice(start, start + 2600)
  assert.match(branch, /if \(info\.credit !== undefined\) \{/, '有读数必须先返回读数')
  assert.match(branch, /meter\.quota === undefined/, '占位配额与真配额必须走不同说明文案')
  assert.match(branch, /\{ balance: info\.credit, \.\.\.secondary === undefined \? \{\} : \{ note: secondary \} \}/,
    '另一口径必须走并列 note，而不是折进主数字')
  assert.ok(branch.indexOf('info.credit !== undefined') < branch.indexOf('info.isCreditPackage'),
    '读数判定必须早于账户类型判定')
})

test('宿主侧：note 一路带到界面，且 token 行不进积分总额', () => {
  const shared = readFileSync(join(ROOT, 'src', 'shared', 'channels.ts'), 'utf8')
  assert.match(shared, /const unit: 'token' \| 'credit' = row\.balance\?\.unit === 'token'/)
  assert.match(shared, /\.\.\.typeof row\.note === 'string' && row\.note\.length > 0 \? \{ note: row\.note \} : \{\}/,
    '说明行必须转发给界面')
  assert.match(shared, /creditCount > 0 \|\| tokenCount > 0/, '两个口径分桶，各自才可能进总额')
})