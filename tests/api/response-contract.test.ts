import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildStreamErrorFrame,
  mapUpstreamError,
  retryAfterHeader,
} from '../../src/main/proxy/errorMapping.ts'

const proxyRoot = fileURLToPath(new URL('../../src/main/proxy', import.meta.url))

function read(relativePath: string): string {
  return readFileSync(`${proxyRoot}/${relativePath}`, 'utf8')
}

test('upstream status maps to OpenAI error types', () => {
  assert.deepEqual(mapUpstreamError(401), { status: 401, type: 'authentication_error', code: 'upstream_unauthorized' })
  assert.deepEqual(mapUpstreamError(403), { status: 401, type: 'authentication_error', code: 'upstream_unauthorized' })
  assert.deepEqual(mapUpstreamError(429), { status: 429, type: 'rate_limit_error', code: 'rate_limit_exceeded' })
  assert.equal(mapUpstreamError(400).type, 'invalid_request_error')
  assert.equal(mapUpstreamError(502).type, 'api_error')
  assert.deepEqual(mapUpstreamError(undefined), { status: 500, type: 'api_error', code: null })
})

test('retry-after is only produced when upstream sent one', () => {
  assert.equal(retryAfterHeader({ 'retry-after': '7' }), '7')
  assert.equal(retryAfterHeader({ 'Retry-After': 3 }), '3')
  assert.equal(retryAfterHeader({}), undefined)
  assert.equal(retryAfterHeader(undefined), undefined)
})

test('stream failures are an SSE error frame, not assistant content', () => {
  const frame = buildStreamErrorFrame('boom')
  assert.match(frame, /^data: /)
  const payload = JSON.parse(frame.replace(/^data: /, '').trim())
  assert.equal(payload.error.message, 'boom')
  assert.equal(payload.choices, undefined)

  const source = read('routes/chat.ts')
  assert.match(source, /buildStreamErrorFrame\(err\.message\)/)
  assert.doesNotMatch(source, /\[Error: \$\{err\.message\}\]/)
})

test('rate limited upstreams penalise the account and keep Retry-After', () => {
  const source = read('routes/chat.ts')
  assert.doesNotMatch(source, /result\.status !== 429/)
  assert.match(source, /ctx\.set\('Retry-After'/)
})

test('no fabricated token usage anywhere in the proxy', () => {
  const files = (readdirSync(proxyRoot, { recursive: true }) as string[]).filter((file) => file.endsWith('.ts'))
  const offenders: string[] = []
  for (const file of files) {
    const source = readFileSync(`${proxyRoot}/${file}`, 'utf8')
    if (/prompt_tokens:\s*\d/.test(source)) offenders.push(file)
  }
  assert.deepEqual(offenders, [])
})

test('streams terminate with exactly one done sentinel', () => {
  assert.match(read('stream.ts'), /let doneSent = false/)
  assert.match(read('adapters/anthropic.ts'), /data: \[DONE\]\\n\\n/)
})

test('stop() force-closes lingering connections', () => {
  const source = read('server.ts')
  assert.match(source, /closeIdleConnections/)
  assert.match(source, /closeAllConnections/)
})
