/**
 * L1 具名车道的会话级账号亲和。
 *
 * 层：真 store（真落盘）+ 真 `loadBalancer` + 真亲和账本；不涉及 HTTP 与上游。
 * 证三件事：
 * 1. 亲和命中时优先于策略（同一段会话不会一轮落 A、下一轮落 B）；
 * 2. 用户静态点名仍然最高（点名的语义还压掉跨家链，不能被亲和挤掉）；
 * 3. 亲和账号进入失败冷却后自然让路 —— 裸 429/慢不换号的另一半由「失败计数」
 *    决定，这里钉的是「不可用就回落策略」，不是「一条错就换」。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const PROVIDER = {
  id: 'aff',
  name: 'Affinity Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Aff-A'],
  modelMappings: { 'Aff-A': 'aff-a' },
}
const ACCOUNT_1 = {
  id: 'aff-acct-1',
  providerId: 'aff',
  name: 'account one',
  credentials: { token: 't1' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}
const ACCOUNT_2 = {
  id: 'aff-acct-2',
  providerId: 'aff',
  name: 'account two',
  credentials: { token: 't2' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}

const harness = await bootstrapStore({
  initialData: { providers: [PROVIDER], accounts: [ACCOUNT_1, ACCOUNT_2] },
})
const { loadBalancer } = await loadModule('main/proxy/loadbalancer.ts')
const { accountAffinity, accountAffinityKey } = await loadModule('main/proxy/accountAffinity.ts')

after(() => {
  accountAffinity.reset()
  harness.dispose()
})

test('亲和命中时优先于策略：同一会话的请求落在同一个账号', () => {
  const picked = loadBalancer.selectAccount('Aff-A', 'round-robin', undefined, undefined, ACCOUNT_2.id)
  assert.equal(picked?.account.id, ACCOUNT_2.id)
  // 连续三次都该是同一个：策略索引照常推进，但亲和挡在前面。
  for (let index = 0; index < 3; index += 1) {
    const again = loadBalancer.selectAccount('Aff-A', 'round-robin', undefined, undefined, ACCOUNT_2.id)
    assert.equal(again?.account.id, ACCOUNT_2.id)
  }
})

test('用户静态点名仍然最高：点名与亲和冲突时听点名的', () => {
  const picked = loadBalancer.selectAccount('Aff-A', 'round-robin', undefined, ACCOUNT_1.id, ACCOUNT_2.id)
  assert.equal(picked?.account.id, ACCOUNT_1.id)
})

test('亲和账号进入失败冷却后回落策略：不让一个坏号把会话拖死', () => {
  for (let index = 0; index < 3; index += 1) loadBalancer.markAccountFailed(ACCOUNT_1.id)
  try {
    // failover 策略会把失败账号从候选里剔掉：亲和找不到它就自然回落。
    const picked = loadBalancer.selectAccount('Aff-A', 'failover', undefined, undefined, ACCOUNT_1.id)
    assert.ok(picked)
    assert.equal(picked.account.id, ACCOUNT_2.id)
  } finally {
    loadBalancer.clearAccountFailure(ACCOUNT_1.id)
  }
})

test('两条具名车道都接线：选号前读亲和、成功后写亲和', () => {
  for (const file of ['chat.ts', 'completions.ts']) {
    const source = readFileSync(new URL(`../../src/main/proxy/routes/${file}`, import.meta.url), 'utf8')
    assert.match(source, /namedAccountAffinity\(/, `${file} 选号前必须读会话亲和`)
    assert.match(source, /rememberNamedAccountAffinity\(/, `${file} 成功后必须记住账号`)
  }
})

test('亲和账本按 TTL 过期，过期后不返回旧锚点', () => {
  accountAffinity.reset()
  const now = 1_800_000_000_000
  const key = accountAffinityKey('session:abc', 'Aff-A')
  accountAffinity.remember(key, ACCOUNT_1.id, 10, now)
  assert.equal(accountAffinity.get(key, now + 1_000), ACCOUNT_1.id)
  assert.equal(accountAffinity.get(key, now + 10 * 60_000 + 1), undefined, '过期必须自净')
  assert.equal(accountAffinity.get(accountAffinityKey(undefined, 'Aff-A'), now), undefined)
  assert.equal(accountAffinity.get(accountAffinityKey('session:abc', 'Aff-A'), now), undefined)
})