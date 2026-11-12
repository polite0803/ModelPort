/**
 * 端点模板的「按 Key 展开」门。
 *
 * 目录里只有少数上游把账号写进 URL（Cloudflare 的 `{account_id}`）：模板原样落盘，
 * 请求时才用该账号的凭据展开。这里钉住四件事：
 * 1. 展开是纯函数：填值、编码、缺值原样保留（不静默变成空串）；
 * 2. 目录的每个占位符都必须有声明 —— 否则 `save()` 会拒掉自己的默认值；
 * 3. 有 Key 却没给变量时拒绝保存，不落一把永远发不出去的 Key；
 * 4. 真正出网的那一步用的是展开后的地址（探测与模型测试各自一条）。
 *
 * `src/main/**` 一律经 harness 的 resolve 钩子动态加载：它们用的是 bundler 风格的
 * 无扩展名相对导入，Node 原生 ESM 解不了（见 `tests/routes/loader-hooks.mjs`）。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'
import {
  aggregatePathVarNames,
  expandAggregatePathVars,
  missingAggregatePathVars,
} from '../../src/shared/aggregate.ts'

const CLOUDFLARE = 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1'

const { AGGREGATE_REGISTRY, getAggregateEntry } = await loadModule('main/providers/aggregate/registry.ts')
const { resolveAggregateEndpoint } = await loadModule('main/providers/aggregate/endpoint.ts')

test('expansion fills every known placeholder and leaves the rest untouched', () => {
  assert.equal(
    expandAggregatePathVars(CLOUDFLARE, { account_id: 'abc123' }),
    'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1',
  )
  // 路径段必须编码：账号 id 里出现 `/` 时不能把地址改道。
  assert.equal(
    expandAggregatePathVars('/v1/{tenant}/chat', { tenant: 'a/b c' }),
    '/v1/a%2Fb%20c/chat',
  )
  // 没给值 = 原样保留，由调用方判定缺失，而不是变成 `accounts//ai`。
  assert.equal(expandAggregatePathVars(CLOUDFLARE, {}), CLOUDFLARE)
  assert.equal(expandAggregatePathVars(CLOUDFLARE, { account_id: '   ' }), CLOUDFLARE)
})

test('missing names are reported, and names dedupe', () => {
  assert.deepEqual(missingAggregatePathVars(CLOUDFLARE, {}), ['account_id'])
  assert.deepEqual(missingAggregatePathVars(CLOUDFLARE, { account_id: 'x' }), [])
  assert.deepEqual(aggregatePathVarNames('/{a}/{b}/{a}'), ['a', 'b'])
  assert.deepEqual(aggregatePathVarNames('https://api.example.com/v1'), [])
})

test('resolveAggregateEndpoint keeps the template when a value is missing', () => {
  const resolved = resolveAggregateEndpoint({ apiEndpoint: CLOUDFLARE })
  assert.equal(resolved.url, CLOUDFLARE)
  assert.deepEqual(resolved.missing, ['account_id'])

  const filled = resolveAggregateEndpoint(
    { apiEndpoint: CLOUDFLARE },
    { apiKey: 'sk-test', account_id: 'acct-123' },
  )
  assert.equal(filled.url, 'https://api.cloudflare.com/client/v4/accounts/acct-123/ai/v1')
  assert.deepEqual(filled.missing, [])
})

test('every catalogue placeholder is declared, and every declaration is used', () => {
  // save() 只放行声明过的变量；目录自己的默认地址必须过得了这道门。
  // `unsupported` 条目例外：save() 先按 `unsupported_auth` 拒绝，永远走不到占位符判定
  // （Vertex 的 `{project_id}/{location}` 是 ADC 组合出来的，本应用发不出那种凭据）。
  for (const entry of AGGREGATE_REGISTRY) {
    if (entry.authKind === 'unsupported') continue
    const declared = new Set((entry.pathVars ?? []).map(variable => variable.name))
    for (const name of aggregatePathVarNames(entry.baseUrl)) {
      assert.ok(declared.has(name), `${entry.id} uses {${name}} without declaring it`)
    }
    for (const name of declared) {
      assert.equal(
        aggregatePathVarNames(entry.baseUrl).includes(name),
        true,
        `${entry.id} declares ${name} but its baseUrl never uses it`,
      )
    }
  }

  const cloudflare = getAggregateEntry('cloudflare')
  assert.ok(cloudflare)
  assert.equal(cloudflare!.baseUrl, CLOUDFLARE)
  assert.deepEqual(cloudflare!.pathVars?.map(variable => variable.name), ['account_id'])
})

/* ------------------------------------------------------------------ */
/* 管理器层：真 store + 回环替身，证明变量在出网那一刻被用上             */
/* ------------------------------------------------------------------ */

interface SeenRequest {
  method: string
  url: string
}

let server: Server
let port = 0
let seen: SeenRequest[] = []

const harness = await bootstrapStore({})
const { aggregateProviderManager } = await loadModule('main/providers/aggregate/manager.ts')

before(async () => {
  server = createServer((req, res) => {
    seen.push({ method: req.method ?? 'GET', url: req.url ?? '' })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(req.method === 'POST' ? '{"id":"cmpl-1","choices":[]}' : '{"result":[]}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

after(() => {
  server?.close()
  harness.dispose()
})

const firstName = getAggregateEntry('cloudflare')!.models[0].id
const baseAt = (suffix: string) => `http://127.0.0.1:${port}${suffix}`

test('a key saved without the declared variable is rejected, not stored', () => {
  assert.throws(
    () => aggregateProviderManager.save({
      id: 'cloudflare',
      baseUrl: baseAt('/client/v4/accounts/{account_id}/ai/v1'),
      apiKeys: ['sk-test-1'],
      models: [firstName],
    }),
    /missing_endpoint_var/,
  )
  // 一个目录没声明的花括号 = 手改地址留下的残渣，仍旧直接拒。
  assert.throws(
    () => aggregateProviderManager.save({
      id: 'cloudflare',
      baseUrl: baseAt('/client/v4/accounts/{tenant_id}/ai/v1'),
      apiKeys: ['sk-test-1'],
      pathVars: { tenant_id: 'x' },
      models: [firstName],
    }),
    /placeholder_base_url/,
  )
})

test('the variable is persisted with the key and expanded for real requests', async () => {
  aggregateProviderManager.save({
    id: 'cloudflare',
    baseUrl: baseAt('/client/v4/accounts/{account_id}/ai/v1'),
    apiKeys: ['sk-test-1'],
    pathVars: { account_id: 'acct-123' },
    models: [firstName],
  })

  const stored = harness.storeManager.getAccountsByProviderId('cloudflare', true)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].credentials.apiKey, 'sk-test-1')
  assert.equal(stored[0].credentials.account_id, 'acct-123')

  seen = []
  const tested = await aggregateProviderManager.testModel('cloudflare', firstName)
  assert.equal(tested.success, true)
  assert.deepEqual(seen, [
    { method: 'POST', url: '/client/v4/accounts/acct-123/ai/v1/chat/completions' },
  ])
})

test('a second key carries its own account id; a keyless variable is refused', async () => {
  const missing = await aggregateProviderManager.addKey('cloudflare', 'sk-test-2', {})
  assert.equal(missing.success, false)
  assert.equal(missing.reason, 'missing_endpoint_var')

  seen = []
  const added = await aggregateProviderManager.addKey('cloudflare', 'sk-test-2', { account_id: 'acct-999' })
  assert.equal(added.success, true, added.message)
  // 探测走的是这把 Key 自己的账号段，而不是第一把的。
  assert.deepEqual(
    seen.filter(row => row.method === 'GET'),
    [{ method: 'GET', url: '/client/v4/accounts/acct-999/ai/v1/models' }],
  )

  const stored = harness.storeManager.getAccountsByProviderId('cloudflare', true)
  const byKey = new Map(stored.map(account => [account.credentials.apiKey, account.credentials.account_id]))
  assert.equal(byKey.get('sk-test-1'), 'acct-123')
  assert.equal(byKey.get('sk-test-2'), 'acct-999')
})