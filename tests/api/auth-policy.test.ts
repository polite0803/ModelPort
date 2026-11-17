import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  checkStartupSecurity,
  evaluateApiKeyAuth,
  extractApiKey,
  isLoopbackOrigin,
  requiresApiKey,
  resolveCorsOrigin,
  safeKeyEquals,
} from '../../src/main/proxy/authPolicy.ts'

const keys = [{ key: 'sk-live-1', enabled: true }]

test('auth is fail-open only when no key is configured', () => {
  assert.equal(evaluateApiKeyAuth({ apiKeys: [], providedKey: null }).outcome, 'allow')
  assert.equal(evaluateApiKeyAuth({ apiKeys: undefined, providedKey: null }).outcome, 'allow')
})

test('configured keys always require authentication', () => {
  assert.equal(evaluateApiKeyAuth({ apiKeys: keys, providedKey: null }).outcome, 'missing_key')
  assert.equal(evaluateApiKeyAuth({ apiKeys: keys, providedKey: '' }).outcome, 'missing_key')
  assert.equal(evaluateApiKeyAuth({ apiKeys: keys, providedKey: 'wrong' }).outcome, 'invalid_key')
  assert.equal(evaluateApiKeyAuth({ apiKeys: keys, providedKey: 'sk-live-1' }).outcome, 'allow')
})

test('disabled or empty keys do not count as configured', () => {
  assert.equal(requiresApiKey([{ key: 'sk-off', enabled: false }]), false)
  assert.equal(evaluateApiKeyAuth({ apiKeys: [{ key: 'sk-off', enabled: false }], providedKey: null }).outcome, 'allow')
  assert.equal(evaluateApiKeyAuth({ apiKeys: [{ key: '', enabled: true }], providedKey: null }).outcome, 'allow')
})

test('the matched key name is the client attribution anchor', () => {
  // Node 系客户端不发 UA，纯 UA 口径下 Qoder 与 Claude Desktop 都是 `undici`。
  // 命名 key 是唯一不依赖客户端配合的归属依据。
  const named = [{ key: 'sk-qoder', enabled: true, name: 'Qoder' }]
  assert.equal(evaluateApiKeyAuth({ apiKeys: named, providedKey: 'sk-qoder' }).matchedKeyName, 'Qoder')
  // 未命中的 key 不带名字：那是「没配名」，不是「叫 unknown」。
  assert.equal(evaluateApiKeyAuth({ apiKeys: named, providedKey: 'sk-other' }).matchedKeyName, undefined)
  // 没起名的 key 同样没有归属名，回落到 UA 口径。
  assert.equal(evaluateApiKeyAuth({ apiKeys: keys, providedKey: 'sk-live-1' }).matchedKeyName, undefined)
  // 起名但只有空白，等同于没起名。
  const blank = [{ key: 'sk-x', enabled: true, name: '   ' }]
  assert.equal(evaluateApiKeyAuth({ apiKeys: blank, providedKey: 'sk-x' }).matchedKeyName, undefined)
})

test('key comparison is constant-time and length independent', () => {
  assert.equal(safeKeyEquals('abc', 'abc'), true)
  assert.equal(safeKeyEquals('abc', 'abd'), false)
  assert.equal(safeKeyEquals('abc', 'abcdefghijklmnop'), false)
})

test('provided key parsing accepts any auth scheme casing and wraps', () => {
  assert.equal(extractApiKey({ authorization: 'Bearer sk-1' }), 'sk-1')
  assert.equal(extractApiKey({ authorization: 'bearer sk-1' }), 'sk-1')
  assert.equal(extractApiKey({ authorization: 'BEARER  sk-1 ' }), 'sk-1')
  assert.equal(extractApiKey({ authorization: 'Bearer "sk-1"' }), 'sk-1')
  assert.equal(extractApiKey({ authorization: "Bearer 'sk-1'" }), 'sk-1')
  assert.equal(extractApiKey({ authorization: 'Bearer ' }), null)
  assert.equal(extractApiKey({ authorization: 'Basic abc' }), null)
  assert.equal(extractApiKey({ xApiKey: ' sk-1 ' }), 'sk-1')
  assert.equal(extractApiKey({ xApiKey: '"sk-1"' }), 'sk-1')
  assert.equal(extractApiKey({}), null)
})

test('non-loopback listen without keys is refused at startup', () => {
  assert.deepEqual(checkStartupSecurity({ apiKeys: [], host: '127.0.0.1' }), { ok: true })
  assert.deepEqual(checkStartupSecurity({ apiKeys: [], host: '::1' }), { ok: true })
  const refused = checkStartupSecurity({ apiKeys: [], host: '0.0.0.0' })
  assert.equal(refused.ok, false)
  assert.equal(refused.reason, 'api_key_required_for_non_loopback_listen')
  assert.equal(checkStartupSecurity({ apiKeys: keys, host: '0.0.0.0' }).ok, true)
})

test('CORS echoes loopback origins only — the wildcard-without-keys branch is gone', () => {
  // 出厂默认没有 Key，旧行为此时回 `*`：任意网页都能读走响应，把用户机器当免费网关。
  // 现在只剩「回环来源原样回显」这一条，本机 Web 客户端照旧可用。
  assert.equal(resolveCorsOrigin({ origin: 'https://evil.example' }), null)
  assert.equal(resolveCorsOrigin({}), null)
  assert.equal(resolveCorsOrigin({ origin: 'http://localhost:5173' }), 'http://localhost:5173')
  assert.equal(resolveCorsOrigin({ origin: 'http://127.0.0.1:3000' }), 'http://127.0.0.1:3000')
  assert.equal(isLoopbackOrigin('http://[::1]:8080'), true)
  assert.equal(isLoopbackOrigin('not-a-url'), false)
})

test('server middleware evaluates auth before body parsing and drops query keys', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/main/proxy/server.ts', import.meta.url)),
    'utf8'
  )
  assert.doesNotMatch(source, /ctx\.query\.api_key/)
  assert.doesNotMatch(source, /enableApiKey &&/)
  const authIndex = source.indexOf('evaluateApiKeyAuth(')
  const bodyParserIndex = source.indexOf('this.app.use(bodyParser(')
  assert.ok(authIndex > -1, 'auth middleware must call evaluateApiKeyAuth')
  assert.ok(bodyParserIndex > authIndex, 'body parser must be registered after the auth middleware')
  // 命中的 key 名要挂到 ctx.state —— 路由据此给客户端定名。
  assert.match(source, /ctx\.state\.clientKeyName\s*=/)
})

test('proxy control API rejects non-loopback hosts', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/main/proxy/routes/management/proxy.ts', import.meta.url)),
    'utf8'
  )
  assert.match(source, /isLoopbackHost\(host\)/)
  assert.match(source, /invalid_host/)
})

test('status manager default host is loopback', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/main/proxy/status.ts', import.meta.url)),
    'utf8'
  )
  assert.match(source, /host: '127\.0\.0\.1'/)
  assert.doesNotMatch(source, /host: '0\.0\.0\.0'/)
})
