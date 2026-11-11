/**
 * 账号渠道「添加账号」去重的接线门。
 *
 * 背景：同一上游账号点两次「添加账号」曾得到两条独立条目 —— 各自参与选号、
 * 各自消耗额度，UI 上看起来像两个账号。修法有两条腿：
 *
 * 1. 登录成功后按**服务端下发的稳定标识**判重（`absorbDuplicateLogin`）；
 * 2. 启动时对存量重复账号**只停用、不删除**（`AccountPool.disableDuplicateAccounts`）。
 *
 * 本测试锁两件最容易复发的事：
 *
 * - 新增 provider 时只在 `account.create` 里加 `addAccount`、忘了接去重 ——
 *   与 `REF_PREFIX_TO_PROVIDER` 漏表同型，靠人眼已经漏过多次；
 * - 拿 `access_token` 当身份判据 —— 每次登录都会换发新令牌，去重永远不命中
 *   （与 zcode 的 `device_mid` 同型陷阱）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const RPC = readFileSync(join(SRC, 'channel-pack-rpc.ts'), 'utf8')
const POOL = readFileSync(join(SRC, 'account-pool.ts'), 'utf8')

/**
 * `account.create` 里明确豁免去重的分支：MiniMax 的凭据没有任何稳定身份值
 * （`access_token` 非 JWT、`account_id` 恒 undefined，见 `MinimaxCredential`）。
 */
const EXEMPT_PROVIDERS = new Set(['MINIMAX.id'])

test('account.create 的每个登录分支都接了 absorbDuplicateLogin', () => {
  const start = RPC.indexOf("case 'account.create':")
  const end = RPC.indexOf("case 'account.update':")
  assert.ok(start > 0 && end > start, '源码里应能找到 account.create / account.update 两个分支')

  const chunks = RPC.slice(start, end).split('await pool.addAccount({').slice(1)
  // 当前有 buddy/workbuddy、comate、codearts、lobsterai、qoder/qodercn、trae、
  // cline、loomy、raccoon、minimax、zcode、gemini 等分支（buddy 两产品共用一段）。
  assert.ok(chunks.length >= 10, `应识别到全部登录分支（实得 ${chunks.length} 个）`)

  for (const chunk of chunks) {
    const provider = /provider:\s*([^,\n]+)/.exec(chunk)?.[1]?.trim() ?? '(unknown)'
    if (EXEMPT_PROVIDERS.has(provider)) continue
    assert.match(chunk, /absorbDuplicateLogin\(/, `${provider} 分支创建了占位账号却没有接去重`)
  }
})

test('身份判据一律是服务端稳定标识，不得使用 access_token', () => {
  const table = /const LOGIN_IDENTITY_FIELDS[^{]*\{([\s\S]*?)\}/.exec(RPC)?.[1]
  assert.ok(table !== undefined, '应能找到 LOGIN_IDENTITY_FIELDS')

  for (const line of table.split('\n')) {
    const match = /^\s*([a-z]+):\s*'([^']+)'/.exec(line)
    if (match === null) continue
    assert.notEqual(match[2], 'access_token', `${match[1]} 不能用每次登录都会变的 access_token 判重`)
  }
  assert.match(table, /zcode:\s*'user_id'/, 'zcode 的判据必须是 user_id（device_mid 每次登录都会变）')
  assert.doesNotMatch(table, /minimax:/, 'MiniMax 没有稳定身份字段，不应把会漂移的值塞进表里')
})

test('存量重复账号只停用、不删除', () => {
  assert.match(RPC, /pool\.disableDuplicateAccounts\(LOGIN_IDENTITY_FIELDS\)/, '启动时必须对存量账号做一次去重')

  const body = /async disableDuplicateAccounts\([\s\S]*?\n  \}/.exec(POOL)?.[0]
  assert.ok(body !== undefined, '应能找到 disableDuplicateAccounts')
  assert.doesNotMatch(body, /removeAccount/, '存量去重不得删除账号（凭据删除不可恢复）')
  assert.match(body, /enabled: false/, '存量重复账号必须退出选号')
})