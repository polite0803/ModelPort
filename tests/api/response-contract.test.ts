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

test('upstream status maps to OpenAI error types without rewriting 403 to 401', () => {
  assert.deepEqual(mapUpstreamError(401), { status: 401, type: 'authentication_error', code: 'upstream_unauthorized' })
  // 403 是「没权限/地区/套餐」，不是「凭据不对」；改成 401 会让客户端轮换自己的 Key。
  assert.deepEqual(mapUpstreamError(403), { status: 403, type: 'permission_error', code: 'upstream_unauthorized' })
  assert.deepEqual(mapUpstreamError(429), { status: 429, type: 'rate_limit_error', code: 'rate_limit_exceeded' })
  assert.equal(mapUpstreamError(400).type, 'invalid_request_error')
  assert.equal(mapUpstreamError(502).type, 'api_error')
  assert.deepEqual(mapUpstreamError(undefined), { status: 500, type: 'api_error', code: null })
})

/**
 * 渠道凭据类失败单独给 `code`，但**不**改状态码与 type
 * （2026-11-01 192.168.85.131：qoder 凭据失效 6 笔、MiniMax 未配置 6 笔、
 * opencode 无可用通道 10 笔，客户端原先只看到一句裸 502）。
 *
 * 关键的一条是**负样本方向**：报成 401 会指挥客户端去轮换它自己那把
 * ModelPort Key，而真正要做的动作在应用里重新登录 —— 那是两个相反的动作。
 */
test('credential-class channel failures get a machine-readable code, not a 401', () => {
  assert.deepEqual(mapUpstreamError(502, 'qoder: no usable credential; log in first'), {
    status: 502,
    type: 'api_error',
    code: 'channel_relogin_required',
  })
  assert.equal(mapUpstreamError(502, 'opencode: 没有可用通道').code, 'channel_relogin_required')
  assert.equal(mapUpstreamError(503, '凭据未配置，请先登录').code, 'channel_relogin_required')

  // 同一家渠道的普通 5xx 不带这个 code（没有凭据字样就没有「要人去登录」这层含义）。
  assert.equal(mapUpstreamError(502, 'Internal Server Error').code, null)
  // 4xx 也不因文案而改变分类。
  assert.equal(mapUpstreamError(404, '模型不存在或已停用').code, null)
  assert.deepEqual(mapUpstreamError(401, 'qoder: no usable credential; log in first'), {
    status: 401,
    type: 'authentication_error',
    code: 'upstream_unauthorized',
  })
  // 只给状态码不给文案时保持旧行为（第二个参数是可选的）。
  assert.deepEqual(mapUpstreamError(502), { status: 502, type: 'api_error', code: null })
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
  assert.match(source, /buildStreamErrorFrame\(err\.message, \{/)
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

/**
 * 上游风控拦截的 `code`（2026-11-01 真流量 9 笔）。判据的关键是**分类顺序**：
 * 风控的状态码两边都见过（400 / 502，上游也有 403），若先按状态码分，
 * 403 会被报成「调用方的 Key 不对」——而渠道包逐账号实测证明它按**账号**生效
 * （同一请求体 7 个账号：2 通、4 拦、1 限流），与客户端凭据毫无关系。
 */
test('risk-control rejections get their own code and never masquerade as an auth failure', () => {
  const illegal = 'workbuddy: 请求被拦截，请重新发送 request illegal'
  assert.deepEqual(mapUpstreamError(400, illegal), {
    status: 400,
    type: 'invalid_request_error',
    code: 'channel_risk_control',
  })
  assert.equal(mapUpstreamError(502, illegal).code, 'channel_risk_control')
  assert.equal(mapUpstreamError(502, illegal).type, 'api_error')
  // 同一条文案配 403 时必须**不**落到 authentication_error；403 本身保留。
  assert.deepEqual(mapUpstreamError(403, illegal), {
    status: 403,
    type: 'permission_error',
    code: 'channel_risk_control',
  })

  // 负样本：真认证失败（无风控文案）保留 403，类型是 permission_error。
  assert.deepEqual(mapUpstreamError(403, 'upstream rejected the token'), {
    status: 403,
    type: 'permission_error',
    code: 'upstream_unauthorized',
  })
  // 429 也不被文案劫持。
  assert.equal(mapUpstreamError(429, 'Raccoon: 模型 sn-x 的可用账号均在限流中，将于 20:00 解禁').code, 'rate_limit_exceeded')
  // 无文案时行为不变。
  assert.equal(mapUpstreamError(400).code, null)
})
