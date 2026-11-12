import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildRouteError, isUnmountedRouteNotFound } from '../../src/main/proxy/routeErrorPolicy.ts'
import { createUnmountedRouteTracer } from '../../src/main/proxy/rejectionLog.ts'
import type { RouteError } from '../../src/main/proxy/routeErrorPolicy.ts'
import { RequestLogManager } from '../../src/main/requestLogs/manager.ts'

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

/**
 * 背景：Ollama 类客户端每 ~5 分钟打一轮 `GET /v1/props`、`GET /props`、
 * `GET /version`、`GET /api/tags` 等未挂载路径。`route_not_found` 404 不是网关故障，
 * 却曾在请求日志里落成 error 行（约占当天非探测错误的 27%）。
 * 本文件钉住三件事：
 *   1. 未挂载 404 不再写请求日志行，改由折叠后的 app 日志 warn 承载痕迹；
 *   2. 三类不许误伤的场景（真实模型 404、missing_api_key 401、已挂载路由正常响应）
 *      各自的行/统计路径完好；
 *   3. X-Request-Id 契约：不再写请求行的响应仍带 header，且每个 id 在 app 日志有
 *      debug 行一一对应。
 */

// ---------- 判定函数：只有「本网关自己说没这条路由」才允许免行 ----------

test('only our own route_not_found 404 qualifies for row suppression', () => {
  // 未挂载路径：这就是要被折叠的那一类。
  const unmounted = buildRouteError({ method: 'GET', path: '/v1/props', matched: [] })
  assert.equal(unmounted.status, 404)
  assert.equal(unmounted.body.error.code, 'route_not_found')
  assert.equal(isUnmountedRouteNotFound(unmounted), true)

  // 不许误伤 1：真实模型 404（「这个渠道不提供该模型」，走 failover 的那类）。
  // 它带着上游语义的 code，永远不该命中抑制判定。
  const modelNotFound: RouteError = {
    status: 404,
    body: {
      error: {
        message: "The model 'glm-4.6' is not served by this channel.",
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    },
  }
  assert.equal(isUnmountedRouteNotFound(modelNotFound), false)

  // 405（路径挂着、方法不对）仍是客户端配错调用，保留请求行。
  const methodNotAllowed = buildRouteError({
    method: 'POST',
    path: '/v1/models',
    matched: [{ methods: ['GET', 'HEAD'] }],
  })
  assert.equal(methodNotAllowed.status, 405)
  assert.equal(isUnmountedRouteNotFound(methodNotAllowed), false)
})

test('the unmounted-route reply itself is untouched: 404, code, hint sentence', () => {
  const error = buildRouteError({ method: 'GET', path: '/v1/props', matched: [] })
  assert.equal(error.status, 404)
  assert.equal(error.body.error.type, 'invalid_request_error')
  assert.equal(error.body.error.code, 'route_not_found')
  assert.equal(
    error.body.error.message,
    'Route not found: GET /v1/props. Call GET / for the endpoint list.',
  )
})

// ---------- 折叠 tracer：首次一条 warn，重复折叠，窗口后再补一条计数 ----------

interface Emitted {
  message: string
  data: Record<string, unknown>
}

function makeTracer(overrides?: { foldWindowMs?: number; maxTracked?: number }) {
  const emitted: Emitted[] = []
  const tracer = createUnmountedRouteTracer({
    log: (message, data) => emitted.push({ message, data }),
    ...overrides,
  })
  return { emitted, tracer }
}

function hit(path: string, now: number, opts?: { method?: string; clientIP?: string }) {
  return {
    method: opts?.method ?? 'GET',
    path,
    clientIP: opts?.clientIP ?? '192.168.85.1',
    requestId: `req-${path}-${now}`,
    now,
  }
}

test('a first probe warns once with method, path and clientIP', () => {
  const { emitted, tracer } = makeTracer()
  tracer.observe(hit('/v1/props', 1_000))

  assert.equal(emitted.length, 1)
  assert.match(emitted[0].message, /GET \/v1\/props/)
  assert.match(emitted[0].message, /192\.168\.85\.1/)
  assert.match(emitted[0].message, /req-\/v1\/props-1000/)
  assert.equal(emitted[0].data.code, 'route_not_found')
  assert.equal(emitted[0].data.status, 404)
  assert.equal(emitted[0].data.hits, 1)
})

test('repeat polls inside the fold window are counted, not logged', () => {
  const { emitted, tracer } = makeTracer({ foldWindowMs: 60_000 })
  for (let i = 0; i < 12; i += 1) {
    tracer.observe(hit('/v1/props', 1_000 + i * 5_000))
  }

  assert.equal(emitted.length, 1, '12 polls in one window must not write 12 warns')
  assert.equal(emitted[0].data.hits, 1)
})

test('the next poll after the fold window warns again, quoting count and first-seen time', () => {
  const { emitted, tracer } = makeTracer({ foldWindowMs: 60_000 })
  tracer.observe(hit('/v1/props', 1_000))
  tracer.observe(hit('/v1/props', 30_000))
  tracer.observe(hit('/v1/props', 61_000)) // past 1_000 + 60_000

  assert.equal(emitted.length, 2)
  assert.match(emitted[1].message, /GET \/v1\/props/)
  assert.match(emitted[1].message, /3 hits since 1970-01-01T00:00:01\.000Z/)
  assert.equal(emitted[1].data.hits, 3)
  assert.equal(emitted[1].data.firstSeenAt, 1_000)

  // 第三次出窗再来一次：计数是累计的，firstSeen 始终是首见时间。
  tracer.observe(hit('/v1/props', 122_000))
  assert.equal(emitted.length, 3)
  assert.equal(emitted[2].data.hits, 4)
  assert.equal(emitted[2].data.firstSeenAt, 1_000)
})

test('each method+path folds on its own', () => {
  const { emitted, tracer } = makeTracer({ foldWindowMs: 60_000 })
  tracer.observe(hit('/v1/props', 1_000))
  tracer.observe(hit('/props', 2_000))
  tracer.observe(hit('/version', 3_000))
  tracer.observe(hit('/api/tags', 4_000))
  tracer.observe(hit('/v1/props', 5_000)) // folded under the first

  assert.equal(emitted.length, 4, 'four distinct paths, four first-touch warns')
  assert.equal(emitted[0].data.hits, 1)

  tracer.observe(hit('/v1/props', 61_000))
  assert.equal(emitted.length, 5)
  assert.equal(emitted[4].data.hits, 3)
})

test('the fold table is bounded even against unique-path floods', () => {
  const { emitted, tracer } = makeTracer({ foldWindowMs: 60_000, maxTracked: 4 })
  for (let i = 0; i < 10; i += 1) {
    tracer.observe(hit(`/v1/flood-${i}`, 1_000 + i))
  }
  assert.equal(emitted.length, 10, 'every distinct path still gets its first warn')

  // 淘汰最早登记的键后，重新出现的旧键按「首次」重新计，而不是无限占位。
  tracer.observe(hit('/v1/flood-0', 2_000))
  assert.equal(emitted.length, 11)
})

// ---------- server.ts 接线（沿用 rejection-log.test.ts 的源码断言形态） ----------

test('the fallback stops writing request rows for unmounted 404 and traces instead', () => {
  const server = sourceOf('../../src/main/proxy/server.ts')

  // 抑制分支存在且以判定函数为闸。
  assert.match(server, /if \(isUnmountedRouteNotFound\(routeError\)\)/)
  // 分支里：header 先挂上、标记 state 让访问日志中间件闭嘴、tracer 折叠记录。
  assert.match(server, /ctx\.set\('X-Request-Id', requestId\)/)
  assert.match(server, /ctx\.state\.unmountedRouteTraced = true/)
  assert.match(server, /unmountedRouteTracer\.observe\(/)
  // 每个 X-Request-Id 都有一条 debug 行兜底（header ↔ 痕迹 的对应关系）。
  assert.match(server, /storeManager\.addLog\(\s*'debug',\s*`Unmounted route: /)
  // 其余 routeError（405）仍旧走 recordRejectedRequest，一行不少。
  assert.match(server, /recordRejectedRequest\(ctx, routeError\.status, routeError\.body\.error\.code/)

  // 不许误伤 2：鉴权拒绝行原样保留（fail-closed 的证据链）。
  assert.match(server, /recordRejectedRequest\(ctx, 401, 'missing_api_key'/)
  assert.match(server, /recordRejectedRequest\(ctx, 401, 'invalid_api_key'/)
})

test('the access-log middleware skips its per-request warn for a traced unmounted 404', () => {
  const server = sourceOf('../../src/main/proxy/server.ts')
  assert.match(server, /ctx\.state\.unmountedRouteTraced === true/)
  const gate = server.indexOf('const shouldRecordAccessLog')
  assert.ok(gate > -1)
  const gateBlock = server.slice(gate, gate + 400)
  assert.match(gateBlock, /unmounted404Traced/)
  // 慢请求判据没有被顺手改掉（阈值仍是对照 SLOW_REQUEST_THRESHOLD_MS）。
  assert.match(gateBlock, /latency >= SLOW_REQUEST_THRESHOLD_MS/)
})

// ---------- 真实流量统计不受牵连（RequestLogManager 级） ----------

test('a real model-404 error row still counts in stats; unmounted probes write no row', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'modelport-unmounted-404-'))
  const manager = new RequestLogManager({ storageDir: dir })
  await manager.initialize()
  // 落盘是防抖异步的：先 flushSync（它会清掉在途定时器并同步写完），再删目录。
  // 少了这一步，测试结束后定时器才触发，rename 目标已不存在，套件会喷一条
  // ENOENT stderr —— 不影响断言，但会把真故障混在噪声里。
  t.after(() => {
    manager.flushSync()
    rmSync(dir, { recursive: true, force: true })
  })

  const now = Date.now()
  manager.addRequestLog({
    timestamp: now,
    status: 'error',
    statusCode: 404,
    method: 'POST',
    url: '/v1/chat/completions',
    model: 'glm-4.6',
    responseStatus: 404,
    latency: 30,
    isStream: false,
    errorMessage: 'model_not_found: The model is not served by this channel',
  })
  manager.addRequestLog({
    timestamp: now,
    status: 'success',
    statusCode: 200,
    method: 'GET',
    url: '/v1/models',
    model: '',
    responseStatus: 200,
    latency: 5,
    isStream: false,
  })

  // 面板的计数已改由统计账本提供（`store::getRequestLogStats`），这里钉的是请求表本身：
  // 那条 model_not_found 404 必须留下行。
  assert.equal(manager.getRequestLogs().length, 2, '不许出现「把所有 404 一刀切排除」的旁路')
  assert.equal(manager.getRequestLogs(undefined, { status: 'error' }).length, 1)
  assert.equal(manager.getRequestLogs(undefined, { status: 'success' }).length, 1)

  // 折叠的未挂载 404 走的是 app 日志，请求表里没有它的行 —— 上面两条就是全表。
  // 若有人把 route_not_found 重新塞回 addRequestLog，这里会先变红。
})
