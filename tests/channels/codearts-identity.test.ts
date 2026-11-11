/**
 * 码道账号身份的解析门。
 *
 * 背景（2026-11-11 报障）：重新登录后面板出现两行 `codearts-8900729b` /
 * `codearts-626463a1`，用户无法判断「是重复登录，还是真的有两个账号」，而其中
 * 一行恰好是「无积分余额」。根因是登录时**没有落库任何身份**，昵称只能是
 * 随机 id；判重又拿了每次登录都换发的临时 `access_key_id`。
 *
 * 稳定身份只存在于 refresh_token 的 JWT 载荷 `user_profile` 里：
 * `{ account_id, account_name, … }`。本测试锁三件：
 *
 * 1. 能解出 `account_id` / `account_name`；
 * 2. 拿不到时**一律返回 undefined**（旧 ticket 凭据没有 refresh_token、令牌被
 *    截断、载荷结构变化），由调用方回退既有昵称 —— 宁可显示 id，也不能把半截
 *    字符串当名字，更不能拿空值去判重；
 * 3. 凭据里已固化的字段优先，缺失时才回退解码（升级前登录的账号无需重新登录）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const MODULE = await import('../../vendor/channel-pack/src/codearts-identity.ts')
const { readCodeArtsIdentityFromRefreshToken, codeartsIdentity, codeartsDisplayName } = MODULE

/** 造一个三段的 JWT（签名段内容无关 —— 本模块刻意不验签，见源码注释）。 */
function jwtOf(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode(payload)}.c2ln`
}

const PROFILE = {
  account_id: '01a1c71d16757dbdbc1bd1563fc6ecaa',
  account_name: 'hw086287662933786',
  principal_id: '01a1c71d16757dbdbc1bd1563fc6ecaa',
  principal_is_root_user: true,
  principal_urn: 'iam::01a1c71d16757dbdbc1bd1563fc6ecaa:user:hw086287662933786',
}

test('从 refresh_token 解出账号 ID 与账号名', () => {
  const token = jwtOf({ user_profile: JSON.stringify(PROFILE), exp: 1 })
  assert.deepEqual(readCodeArtsIdentityFromRefreshToken(token), {
    accountId: PROFILE.account_id,
    accountName: PROFILE.account_name,
  })
})

test('拿不到身份时一律返回 undefined，绝不猜', () => {
  const missingProfile = jwtOf({ exp: 1 })
  const missingName = jwtOf({ user_profile: JSON.stringify({ account_id: PROFILE.account_id }) })
  const brokenProfile = jwtOf({ user_profile: '{not json' })
  for (const token of [
    undefined,
    '',
    'not-a-jwt',
    'a.b',
    'a.b.c.d',
    missingProfile,
    missingName,
    brokenProfile,
  ]) {
    assert.equal(readCodeArtsIdentityFromRefreshToken(token), undefined, `不应从 ${String(token)} 解出身份`)
  }
})

test('凭据里已固化的字段优先，缺失时回退解码 refresh_token', () => {
  assert.deepEqual(codeartsIdentity({
    account_id: 'stored-id',
    account_name: 'stored-name',
    refresh_token: jwtOf({ user_profile: JSON.stringify(PROFILE) }),
  }), { accountId: 'stored-id', accountName: 'stored-name' })

  assert.deepEqual(codeartsIdentity({
    refresh_token: jwtOf({ user_profile: JSON.stringify(PROFILE) }),
  }), { accountId: PROFILE.account_id, accountName: PROFILE.account_name })

  assert.equal(codeartsIdentity({ account_id: 'only-id' }), undefined)
  assert.equal(codeartsIdentity(null), undefined)
  assert.equal(codeartsIdentity('not-a-credential'), undefined)
})

test('展示名取账号名，取不到时回退调用方给的默认值', () => {
  const credential = { refresh_token: jwtOf({ user_profile: JSON.stringify(PROFILE) }) }
  assert.equal(codeartsDisplayName(credential, 'codearts-8900729b'), PROFILE.account_name)
  // 旧 ticket 凭据没有 refresh_token，只有 user_name。
  assert.equal(codeartsDisplayName({ user_name: 'legacy-user' }, 'codearts-8900729b'), 'legacy-user')
  assert.equal(codeartsDisplayName({}, 'codearts-8900729b'), 'codearts-8900729b')
})