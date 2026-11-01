import test from 'node:test'
import assert from 'node:assert/strict'
import { redactSecretHeaders, stripRedactedHeaders, REDACTED_HEADER_VALUE } from '../../src/shared/providerExportPolicy.ts'

test('按头名剔除：Key/Token/Secret/Authorization/Cookie 形态的头不外发', () => {
  const out = redactSecretHeaders({
    'x-api-key': 'whatever',
    Authorization: 'Bearer abc.def.ghi',
    'x-goog-api-key': 'AIza-something',
    'X-Session-Token': 't',
    'Set-Cookie': 'a=b',
    'x-app-version': '3',
  })
  assert.equal(out?.['x-api-key'], REDACTED_HEADER_VALUE)
  assert.equal(out?.['Authorization'], REDACTED_HEADER_VALUE)
  assert.equal(out?.['x-goog-api-key'], REDACTED_HEADER_VALUE)
  assert.equal(out?.['X-Session-Token'], REDACTED_HEADER_VALUE)
  assert.equal(out?.['Set-Cookie'], REDACTED_HEADER_VALUE)
  assert.equal(out?.['x-app-version'], '3')
})

test('按值形态剔除：头名不敏感但值是一把裸 Key 时同样不外发', () => {
  const out = redactSecretHeaders({ 'x-note': 'auth sk-proj-abcdefghijklmnop1234 for tenant 7' })
  assert.equal(out?.['x-note'], REDACTED_HEADER_VALUE)
})

test('正常头不被误伤', () => {
  const out = redactSecretHeaders({ 'Content-Type': 'application/json', 'x-app': 'modelport', 'accept': 'text/plain' })
  assert.deepEqual(out, { 'Content-Type': 'application/json', 'x-app': 'modelport', 'accept': 'text/plain' })
})

test('导入时占位串被丢掉，不会当成真实凭据接进来', () => {
  const kept = stripRedactedHeaders({ 'Content-Type': 'application/json', 'x-api-key': REDACTED_HEADER_VALUE })
  assert.deepEqual(kept, { 'Content-Type': 'application/json' })
})

test('undefined 原样透传（可选 headers 不该被造出空对象以外的语义）', () => {
  assert.equal(redactSecretHeaders(undefined), undefined)
  assert.equal(stripRedactedHeaders(undefined), undefined)
})

test('负控：漏掉大小写与连字符变体会让凭据出门', () => {
  const out = redactSecretHeaders({ 'X-Api-Key': 'k', 'refresh_token': 't', 'proxy-authorization': 'Bearer z' })
  for (const name of ['X-Api-Key', 'refresh_token', 'proxy-authorization']) {
    assert.equal(out?.[name], REDACTED_HEADER_VALUE, `${name} 必须被替换`)
  }
})
