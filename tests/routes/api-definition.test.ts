/**
 * `GET /v1/api-definition/providers` 的网关自定义发现面。
 *
 * 证明层次：真 `storeManager` + 真 `ProxyServer` → 路由启用位、池解析、
 * 广告下界与 HTTP 头。这里不读源码文本，所有响应字段都来自真请求。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore, startProxy } from './harness.mjs'

const PORT = 18955

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
      proxyPort: PORT,
      proxyHost: '127.0.0.1',
      loadBalanceStrategy: 'round-robin',
      // 显式空表：不会迁移出默认 `auto`，第一个用例才能证明真正的空清单。
      routes: {},
    },
  },
})
const sm = harness.storeManager
const proxy = await startProxy(PORT)

after(async () => {
  await proxy.stop()
  harness.dispose()
})

function providerFixture(id: string, displayName: string, contextTokens?: number) {
  return {
    id,
    name: `Definition Provider ${id}`,
    type: 'custom',
    authType: 'token',
    apiEndpoint: 'http://127.0.0.1:1/v1',
    chatPath: '/chat/completions',
    headers: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    supportedModels: [displayName],
    modelMappings: { [displayName]: `${id}-upstream` },
    ...(contextTokens === undefined
      ? {}
      : { modelCapabilities: { [displayName]: { contextTokens } } }),
  }
}

test('空路由表返回 200 空清单和请求 ID', async () => {
  const response = await proxy.request('GET', '/v1/api-definition/providers')

  assert.equal(response.status, 200)
  assert.match(String(response.headers['x-request-id']), /^[0-9a-f-]{36}$/i)
  assert.deepEqual(response.json, { object: 'list', data: [] })
})

test('只广告已启用且池可解析的路由，并带同源下界', async () => {
  sm.addProvider(providerFixture('wide', 'Wide-Model', 128_000) as never)
  sm.addAccount({
    id: 'wide-acct',
    providerId: 'wide',
    name: 'wide account',
    credentials: { token: 'test-token' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  } as never)

  const created = sm.createRoute({ name: 'wide' })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  const paused = sm.createRoute({ name: 'paused', enabled: false })
  assert.equal(paused.ok, true, JSON.stringify(paused.error))

  const response = await proxy.request('GET', '/v1/api-definition/providers')

  assert.equal(response.status, 200)
  assert.deepEqual(response.json, {
    object: 'list',
    data: [{ name: 'wide', context_window: 128_000 }],
  })
})

test('Anthropic 版本头不改变网关自定义形状', async () => {
  const response = await proxy.request('GET', '/v1/api-definition/providers', {
    headers: { 'anthropic-version': '2023-06-01' },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(response.json, {
    object: 'list',
    data: [{ name: 'wide', context_window: 128_000 }],
  })
  const rows = (response.json as { data: Array<Record<string, unknown>> }).data
  assert.equal('type' in rows[0], false)
  assert.equal('has_more' in (response.json as Record<string, unknown>), false)
})

test('未广告的子路径落到通用 404', async () => {
  const response = await proxy.request('GET', '/v1/api-definition/providers/nope')

  assert.equal(response.status, 404)
})
