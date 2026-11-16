/**
 * 存储读缓存（`installStoreReadCache`）。
 *
 * 背景：conf 14 的 `get store()` 每次取值都整份读盘 + 解密 + JSON.parse，自己没有缓存。
 * 2026-11-15 现网 12s CPU 采样里 `_deserialize` 41.2% + `readFileSync` 39.6% +
 * `readFileUtf8` 7.7% —— 89% 的一个整核全花在这上面，主线程被占满后回环转发饿死成
 * `read ECONNRESET`（半小时 12–16 笔 502 `internal_relay_failed`）。
 *
 * 证明的层次：真 `storeManager` 的公开读接口 → conf 实例上被包装的 `store` getter /
 * `_write`。判据是**对象引用**与**修订号**，不是读源码文本：
 * - 文件没变时两次读必须是同一个对象（坏样本自证：去掉缓存后 conf 每次重新 parse，
 *   引用必然不同，第一条断言即红）；
 * - 本进程写（经 `_write`）与外部进程改文件（经 mtime/size）都必须让下一次读看到新值。
 *
 * 缓存把「每次新对象」换成「同一个对象」，由此引出两个必须钉住的连带面：
 * ① 结构写拦截的快照若存原值引用，就会跟着就地改写一起变，真的启停被判成「没变」；
 * ② 带凭据的读接口必须交出新对象，否则解密后的明文会留在缓存里被后续读拿到。
 *
 * 不在本层证明：AES 解密本身的开销（无头宿主没有钥匙串，走的是文档写明的明文降级分支）、
 * 现网 CPU 占用与 502 率（那两项是部署后的实测读数）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore } from '../routes/harness.mjs'

const harness = await bootstrapStore({
  initialData: {
    providers: [],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: {
      proxyPort: 8080,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      routes: {},
      autoRouting: {
        enabled: true,
        maxAttempts: 2,
        stickyMinutes: 30,
        prefer: 'fast',
        poolStrategies: [],
      },
    },
  },
})
const sm = harness.storeManager
after(() => harness.dispose())

sm.addProvider({
  id: 'cache-p1',
  name: 'Read Cache Provider',
  type: 'custom',
  authType: 'token',
  apiEndpoint: 'http://127.0.0.1:1/v1',
  chatPath: '/chat/completions',
  headers: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Model-One'],
  modelMappings: { 'Model-One': 'cache-upstream' },
  modelCapabilities: { 'Model-One': { tier: 'fast' } },
} as never)
sm.addAccount({
  id: 'cache-acct1',
  providerId: 'cache-p1',
  name: 'cache account',
  credentials: { token: 'cache-token' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
  supportedModels: ['Model-One'],
} as never)

test('文件没变：连续读交出同一个对象（零重读重解析）', () => {
  const first = sm.getProviders()
  const second = sm.getProviders()
  assert.equal(first, second, 'conf 原本每次重新 parse ⇒ 引用不同；这条红就说明缓存没生效')
  assert.equal(sm.getAccounts(false), sm.getAccounts(false))
})

test('本进程写：经 _write 立刻作废缓存，下一次读看到新值', () => {
  const before = sm.getAccounts(false)
  sm.updateAccount('cache-acct1', { lastUsed: 1_700_000_000_000, requestCount: 7 })
  const after = sm.getAccounts(false)
  assert.notEqual(before, after, '写后必须重新读盘，不能把旧对象继续交出去')
  const row = after.find(a => a.id === 'cache-acct1')
  assert.equal(row?.requestCount, 7)
  assert.equal(harness.dataFile().accounts.find((a: { id: string }) => a.id === 'cache-acct1').requestCount, 7)
})

test('外部进程改文件：mtime/size 兜住，不靠本进程的写通知', () => {
  const onDisk = harness.dataFile()
  onDisk.providers = [...onDisk.providers, {
    id: 'cache-p2',
    name: 'Written By Another Process',
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:2/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 3,
    updatedAt: 4,
    supportedModels: ['Model-Two'],
    modelMappings: {},
    modelCapabilities: {},
  }]
  harness.writeDataFile(onDisk)
  const providers = sm.getProviders()
  assert.ok(providers.some(p => p.id === 'cache-p2'), '外部写改了文件，缓存必须失效')
})

test('带凭据的读交出新对象：明文不进缓存', () => {
  const plain = sm.getAccounts(false)
  const withCredentials = sm.getAccounts(true)
  assert.notEqual(plain[0], withCredentials[0], '解密结果必须是新对象，否则明文会留在缓存里')
  assert.equal(sm.getAccounts(false)[0], plain[0], '普通读仍然命中缓存')
  assert.equal(sm.getAccounts(false), plain, '带凭据的读不许把缓存整份换掉')
})

test('快照存深拷贝：就地改写后真的启停仍然 bump 修订号', () => {
  // updateAccount 是 `accounts[index] = …` 就地改 + 整份 set。缓存让被写的数组与快照
  // 同引用，快照若存原值就会跟着变，status 改动被判成「没变」⇒ 路由页永远看不到启停。
  const before = sm.getStructuralRevision()
  sm.updateAccount('cache-acct1', { status: 'inactive' })
  assert.ok(sm.getStructuralRevision() > before, '停用账号改池成员，必须 bump')

  const mid = sm.getStructuralRevision()
  sm.updateAccount('cache-acct1', { lastUsed: Date.now(), requestCount: 99 })
  assert.equal(sm.getStructuralRevision(), mid, '纯记账写不改池成员，不许 bump')

  const last = sm.getStructuralRevision()
  sm.updateAccount('cache-acct1', { status: 'active' })
  assert.ok(sm.getStructuralRevision() > last, '恢复启用同样必须 bump')
})