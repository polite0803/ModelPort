import test from 'node:test'
import assert from 'node:assert/strict'
import { FORBIDDEN_PROVIDER_HEADER_NAMES, isForbiddenProviderHeader } from '../../src/shared/providerHeaders.ts'

test('逐跳头与 Host 一律判为禁止，大小写与空白都不影响', () => {
  for (const name of ['Host', 'host', '  CONTENT-LENGTH  ', 'Transfer-Encoding', 'connection', 'Upgrade', 'TE', 'Trailer', 'Proxy-Authorization']) {
    assert.equal(isForbiddenProviderHeader(name), true, `${name} 应被拒绝`)
  }
})

test('正常厂商头照常放行（不能把鉴权头也一起误杀）', () => {
  for (const name of ['Authorization', 'x-api-key', 'anthropic-version', 'OpenAI-Organization', 'Accept']) {
    assert.equal(isForbiddenProviderHeader(name), false, `${name} 不该被拒绝`)
  }
})

test('清单是封闭的：只有连接级与请求长度类，鉴权头 Authorization 不在其中', () => {
  assert.deepEqual(
    [...FORBIDDEN_PROVIDER_HEADER_NAMES].sort(),
    ['connection', 'content-length', 'host', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'].sort(),
  )
  // `proxy-authorization` 在清单里是因为它是逐跳（hop-by-hop）认证头，由代理层负责；
  // 而 `Authorization` 是厂商鉴权头，必须由配置带过去，所以下面这条必须为 false。
  assert.equal(isForbiddenProviderHeader('proxy-authorization'), true)
  assert.equal(isForbiddenProviderHeader('Authorization'), false)
})
