import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  isOpencodeUpstream,
  opencodeAffinityHeaders,
  opencodeAffinityValue,
} from '../../src/main/proxy/utils/opencodeAffinity.ts'

function readSource(path: string): string {
  return readFileSync(path, 'utf-8').replace(/\r\n/g, '\n')
}

const GO = 'https://opencode.ai/zen/go/v1'
const ZEN = 'https://opencode.ai/zen/v1'

test('只认 opencode.ai 及其子域，别的主机一个头都不加', () => {
  assert.equal(isOpencodeUpstream(GO), true)
  assert.equal(isOpencodeUpstream(ZEN), true)
  assert.equal(isOpencodeUpstream('https://api.example.com/v1'), false)
  // 假阳性检查：后缀像它、主机名不是它
  assert.equal(isOpencodeUpstream('https://notopencode.ai/zen/v1'), false)
  assert.equal(isOpencodeUpstream('https://opencode.ai.example.com/v1'), false)
  assert.equal(isOpencodeUpstream('https://opencode.ai:443/zen/v1'), true)
  assert.equal(isOpencodeUpstream(undefined), false)
  assert.equal(isOpencodeUpstream('not a url'), false)
})

test('四个亲和头同值，且不多发身份头', () => {
  const headers = opencodeAffinityHeaders({ baseUrl: GO, accountId: 'acct-1', request: {} })
  assert.ok(headers)
  const values = new Set([
    headers['x-opencode-session'],
    headers['x-opencode-session-id'],
    headers['x-session-affinity'],
    headers['x-session-id'],
  ])
  assert.equal(values.size, 1, '上游要的是四个同值头')
  assert.equal(Object.keys(headers).length, 4)

  // 探测证明 project / client / 铸造 id 都不是过闸所需；发它们等于替这台机
  // 认领 OpenCode 客户端身份。v1 专用头 x-opencode-request 在 v2 直接 403。
  for (const forbidden of [
    'x-opencode-project',
    'x-opencode-client',
    'x-opencode-request',
    'user-agent',
  ]) {
    assert.equal(forbidden in headers, false, `must not emit ${forbidden}`)
  }
})

test('非 OpenCode 上游返回 undefined（调用方原样发）', () => {
  assert.equal(
    opencodeAffinityHeaders({ baseUrl: 'https://api.deepseek.com/v1', accountId: 'a', request: {} }),
    undefined,
  )
})

test('会话标识优先，且同一会话可重复派生（无跨请求状态）', () => {
  const withCacheKey = opencodeAffinityValue({
    request: { prompt_cache_key: 'codex-thread-42' },
    accountId: 'acct-1',
  })
  const again = opencodeAffinityValue({
    request: { prompt_cache_key: 'codex-thread-42' },
    accountId: 'acct-1',
  })
  assert.equal(withCacheKey, again, '每次现算是允许的，但必须算出同一个值')
  assert.match(withCacheKey, /^mp-[0-9a-f]{24}$/)

  const otherConversation = opencodeAffinityValue({
    request: { prompt_cache_key: 'codex-thread-43' },
    accountId: 'acct-1',
  })
  assert.notEqual(withCacheKey, otherConversation, '不同会话不该被并成一个亲和键')

  // 客户端没声明会话时回落到账号级稳定值
  const accountScoped = opencodeAffinityValue({ request: {}, accountId: 'acct-1' })
  assert.equal(accountScoped, opencodeAffinityValue({ request: {}, accountId: 'acct-1' }))
  assert.notEqual(accountScoped, opencodeAffinityValue({ request: {}, accountId: 'acct-2' }))
  assert.notEqual(accountScoped, withCacheKey)
})

test('会话标识按 prompt_cache_key → user → metadata.user_id 的优先级取', () => {
  const both = opencodeAffinityValue({
    request: { prompt_cache_key: 'A', user: 'B', metadata: { user_id: 'C' } },
    accountId: 'acct-1',
  })
  assert.equal(both, opencodeAffinityValue({ request: { prompt_cache_key: 'A' }, accountId: 'acct-1' }))
  const userOnly = opencodeAffinityValue({
    request: { user: 'B', metadata: { user_id: 'C' } },
    accountId: 'acct-1',
  })
  assert.equal(userOnly, opencodeAffinityValue({ request: { user: 'B' }, accountId: 'acct-1' }))
  const metadataOnly = opencodeAffinityValue({
    request: { metadata: { user_id: 'C' } },
    accountId: 'acct-1',
  })
  assert.equal(metadataOnly, opencodeAffinityValue({
    request: { metadata: { user_id: 'C' } },
    accountId: 'acct-1',
  }))
  // 空白串不算会话标识
  assert.equal(
    opencodeAffinityValue({ request: { prompt_cache_key: '   ' }, accountId: 'acct-1' }),
    opencodeAffinityValue({ request: {}, accountId: 'acct-1' }),
  )
  // 怪异入参不抛错
  assert.match(opencodeAffinityValue({ request: null, accountId: undefined }), /^mp-[0-9a-f]{24}$/)
  assert.match(opencodeAffinityValue({ request: 'not-an-object' }), /^mp-[0-9a-f]{24}$/)
})

test('接线门：buildHeaders 的两个调用点都把 request 传进去', () => {
  const source = readSource('src/main/proxy/forwarder.ts')
  const calls = source.match(/this\.buildHeaders\([^)]*\)/g) ?? []
  assert.equal(calls.length, 2, 'chat 与 responses 两条出站都要接上')
  for (const call of calls) {
    assert.match(call, /,\s*request\)/, `${call} must pass the request so the session id stays per-conversation`)
  }
  assert.match(source, /opencodeAffinityHeaders\(\{/)
})
