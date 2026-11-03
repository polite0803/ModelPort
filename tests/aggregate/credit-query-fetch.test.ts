/**
 * 抓取层（`manager.ts::queryCredits`）的真 HTTP 台。
 *
 * 只在 127.0.0.1 上起替身服务，**绝不打 openrouter.ai / siliconflow 的真实域名**：
 * 这一层要证的是"请求到底发去了哪、带了什么头、回来的东西有没有把 Key 漏出去"，
 * 这三件事都不需要真上游，而真上游会把一个没核对过的字段名变成一次真实计费询问。
 *
 * 三条最要紧的：
 * - URL = **记录里的 `apiEndpoint`** + 目录声明的相对 path。用户把 base 改成自家转发地址时，
 *   额度查询跟着走，不会分家去查转录来的那个 host。
 * - 鉴权走既有的 `buildProbeHeaders`（`Authorization: Bearer <该账号的 Key>`），没有第二条凭据通路。
 * - Key 不出现在返回值、报文摘要与任何一条 console 输出里。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { bootstrapStore, loadModule } from '../routes/harness.mjs'

const KEY_A = 'sk-or-v1-alpha-0000000000000000'
const KEY_B = 'sk-or-v1-bravo-0000000000000000'

interface Seen {
  method: string
  url: string
  authorization?: string
  host: string
}

let server: Server
let port = 0
let seen: Seen[] = []
let responder: (req: Seen) => { status: number, body: string, contentType?: string }

const harness = await bootstrapStore({
  initialData: {
    providers: [
      {
        id: 'open_router',
        name: 'OpenRouter',
        type: 'aggregate',
        authType: 'token',
        // 用户自己配的转发地址：目录里转录的是 openrouter.ai，这里必须一个字符都不出现。
        apiEndpoint: 'http://127.0.0.1:1/proxy/openrouter',
        chatPath: '/chat/completions',
        headers: {},
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        supportedModels: ['open_router/openrouter/free'],
        modelMappings: { 'open_router/openrouter/free': 'openrouter/free' },
      },
    ],
    accounts: [
      {
        id: 'acct-a',
        providerId: 'open_router',
        name: 'alpha key',
        credentials: { apiKey: KEY_A },
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'acct-b',
        providerId: 'open_router',
        name: 'bravo key',
        credentials: { apiKey: KEY_B },
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  },
})

const { aggregateProviderManager } = await loadModule('main/providers/aggregate/manager.ts')

/** 控制台间谍：Key 若从任何一条日志里漏出去，这条测试就得红。 */
const logged: string[] = []
const realConsole = { log: console.log, warn: console.warn, error: console.error }
const spyLogs = () => {
  logged.length = 0
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  console.warn = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
}
const unspyLogs = () => {
  console.log = realConsole.log
  console.warn = realConsole.warn
  console.error = realConsole.error
}

before(async () => {
  server = createServer((req, res) => {
    const record: Seen = {
      method: req.method ?? 'GET',
      url: req.url ?? '',
      authorization: req.headers.authorization as string | undefined,
      host: req.headers.host ?? '',
    }
    seen.push(record)
    const answer = responder(record)
    res.writeHead(answer.status, { 'Content-Type': answer.contentType ?? 'application/json' })
    res.end(answer.body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  // 记录里的端口只有起台之后才知道：把 base 指到这台替身上。
  harness.storeManager.updateProvider('open_router', { apiEndpoint: `http://127.0.0.1:${port}/proxy/openrouter` })
})

after(() => {
  server?.close()
  harness.dispose()
})

const jsonOk = (remaining: number | null, limit: number | null) => ({
  status: 200,
  body: JSON.stringify({ data: { limit, limit_remaining: remaining } }),
})

test('the request goes to the configured base + the declared path, over the shared auth path, and the key never comes back out', async () => {
  seen = []
  responder = () => jsonOk(12.5, 50)
  spyLogs()
  try {
    const result = await aggregateProviderManager.queryCredits('open_router')
    unspyLogs()

    assert.equal(result.ok, true)
    assert.deepEqual(
      seen.map(row => ({ method: row.method, url: row.url })),
      [
        { method: 'GET', url: '/proxy/openrouter/key' },
        { method: 'GET', url: '/proxy/openrouter/key' },
      ],
      'URL is provider.apiEndpoint + quotaProbe.path, one request per stored key'
    )
    assert.deepEqual(
      seen.map(row => row.authorization),
      [`Bearer ${KEY_A}`, `Bearer ${KEY_B}`],
      'the header comes from buildProbeHeaders over each account credentials.apiKey'
    )
    assert.ok(seen.every(row => row.host === `127.0.0.1:${port}`), 'nothing was sent to a transcribed vendor host')

    assert.equal(result.rows.length, 2)
    assert.deepEqual(result.rows.map(row => row.reading.ok && row.reading.remaining), [12.5, 12.5])
    assert.equal(result.rows[0].maskedKey.includes(KEY_A), false)
    assert.ok(!JSON.stringify(result).includes(KEY_A), 'the key must not ride along in the IPC payload')
    assert.ok(!JSON.stringify(result).includes(KEY_B))
    assert.ok(!logged.some(line => line.includes(KEY_A) || line.includes(KEY_B)), 'nor into the log')

    assert.equal(result.snapshot?.ok, true)
    assert.equal(result.snapshot?.unit, 'USD')
    assert.equal(result.snapshot?.remaining, 12.5)
    assert.equal(result.snapshot?.accounts, 2)
    const onDisk = harness.dataFile().aggregateCreditSnapshots.open_router
    assert.equal(onDisk.remaining, 12.5, 'the row is persisted for the router to read')
    assert.ok(!JSON.stringify(onDisk).includes(KEY_A))
  } finally {
    unspyLogs()
  }
})

test('an http 401 is reported as a refused query, never as a zero balance, and keeps the old row', async () => {
  // 先放一行新鲜的好读数，证明失败不会把它抹成 0、也不会把它当现值刷新。
  const earlier = Date.now() - 60_000
  harness.storeManager.setAggregateCreditSnapshot('open_router', {
    asOf: new Date(earlier).toISOString(),
    unit: 'USD',
    unlimited: false,
    remaining: 42,
    ok: true,
    accounts: 2,
    skipped: 0,
  })

  seen = []
  responder = () => ({ status: 401, body: JSON.stringify({ error: 'nope' }) })
  const result = await aggregateProviderManager.queryCredits('open_router')

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'http-status')
  assert.deepEqual(result.rows.map(row => (!row.reading.ok ? row.reading.detail : '')), ['HTTP 401', 'HTTP 401'])
  assert.deepEqual(seen.map(row => row.url), ['/proxy/openrouter/key', '/proxy/openrouter/key'])
  assert.equal(result.snapshot, undefined, 'a failed query writes nothing')
  const onDisk = harness.dataFile().aggregateCreditSnapshots.open_router
  assert.equal(onDisk.remaining, 42, 'the previous row keeps its own asOf instead of being zeroed')
  assert.equal(onDisk.asOf, new Date(earlier).toISOString())
})

test('an html body is "not JSON", and a JSON body with other field names is "unexpected shape"', async () => {
  seen = []
  responder = () => ({ status: 200, body: '<html>Cloudflare</html>', contentType: 'text/html' })
  const html = await aggregateProviderManager.queryCredits('open_router')
  assert.equal(html.ok, false)
  assert.equal(html.reason, 'not-json')
  assert.ok(!html.rows.some(row => row.reading.ok), 'a HTML page never becomes a number')

  responder = () => ({ status: 200, body: JSON.stringify({ data: { monthly_spend: 1, credits: 2 } }) })
  const shape = await aggregateProviderManager.queryCredits('open_router')
  assert.equal(shape.reason, 'unexpected-shape')
  assert.equal(shape.rows.every(row => !row.reading.ok), true)
  assert.ok(
    shape.rows.every(row => (!row.reading.ok ? row.reading.detail.includes('monthly_spend') : false)),
    'the unknown shape must be visible in the panel, not swallowed - which is exactly what the real-machine checklist needs'
  )
})

test('a dead endpoint is a network failure, with no key in the message', async () => {
  seen = []
  harness.storeManager.updateProvider('open_router', { apiEndpoint: 'http://127.0.0.1:1/nowhere' })
  spyLogs()
  try {
    const result = await aggregateProviderManager.queryCredits('open_router')
    unspyLogs()
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'network')
    assert.ok(result.rows.every(row => !row.reading.ok))
    assert.ok(!JSON.stringify(result).includes(KEY_A))
    assert.ok(!logged.some(line => line.includes(KEY_A) || line.includes(KEY_B)))
  } finally {
    unspyLogs()
    harness.storeManager.updateProvider('open_router', { apiEndpoint: `http://127.0.0.1:${port}/proxy/openrouter` })
  }
})

test('beyond the cap only the first ten keys are asked, and the rest are counted as unqueried', async () => {
  for (let i = 0; i < 10; i += 1) {
    harness.storeManager.addAccount({
      id: `acct-filler-${i}`,
      providerId: 'open_router',
      name: `filler ${i}`,
      credentials: { apiKey: `sk-or-v1-filler-${i}-000000000000` },
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    })
  }
  seen = []
  responder = () => jsonOk(1, 10)
  const result = await aggregateProviderManager.queryCredits('open_router')

  assert.equal(seen.length, 10, 'a pool of 12 keys asks 10, never 12')
  assert.equal(result.rows.length, 10)
  assert.equal(result.accounts, 10)
  assert.equal(result.skipped, 2, 'and says out loud that two were not queried')

  // 没问全的那两把也归这家所有账号一起被挡，所以这一行不能落盘（fail-open）。
  assert.equal(result.ok, false, 'a partial sweep is not entry-level evidence')
  assert.equal(result.snapshot, undefined)
  assert.equal(harness.dataFile().aggregateCreditSnapshots.open_router.remaining, 42, 'the earlier row is left alone')
})

test('an entry without a declared probe endpoint, and an entry with no key, ask nothing at all', async () => {
  seen = []
  responder = () => jsonOk(1, 10)

  const unknown = await aggregateProviderManager.queryCredits('no_such_entry')
  assert.equal(unknown.failure, 'unknown_entry')
  assert.equal(unknown.rows.length, 0)

  const noProbe = await aggregateProviderManager.queryCredits('mistral')
  assert.equal(noProbe.failure, 'no_probe', 'the catalogue says this one has no credit endpoint')

  const notConfigured = await aggregateProviderManager.queryCredits('siliconflow')
  assert.equal(notConfigured.failure, 'not_configured')

  // 删掉两家已存的 Key 之后：有端点、有记录，但没有凭据 —— 不发请求，界面得给出原因。
  for (const account of harness.storeManager.getAccountsByProviderId('open_router')) {
    harness.storeManager.deleteAccount(account.id)
  }
  const missingKey = await aggregateProviderManager.queryCredits('open_router')
  assert.equal(missingKey.failure, 'missing_api_key')
  assert.equal(seen.length, 0, 'nothing left the process')
})
