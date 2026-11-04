import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MANAGEMENT_RATE_LIMIT_MAX,
  MANAGEMENT_RATE_LIMIT_WINDOW_MS,
  managementRateLimiter,
} from '../../src/main/proxy/middleware/rateLimiter.ts'

/**
 * D5：管理面缺速率限制。
 *
 * 判据是「真中间件真计数」，不是「源码里 import 了 koa-ratelimit」：
 * koa-ratelimit 的 memory 驱动每请求新建 Limiter，桶只活在 `opts.db`；
 * 共享 Map 一旦丢掉，限流就静默失效（永远放行），这种回归只有打满窗口才看得见。
 */
interface FakeCtx {
  path: string
  ip: string
  status: number
  body: unknown
  state: Record<string, unknown>
  set: (name: string | Record<string, string | number>, value?: string | number) => void
}

function makeCtx(path: string, ip = '127.0.0.1'): { ctx: FakeCtx; headers: Record<string, string | number> } {
  const headers: Record<string, string | number> = {}
  const ctx: FakeCtx = {
    path,
    ip,
    status: 404,
    body: undefined,
    state: {},
    set: (name, value) => {
      if (typeof name === 'string') {
        headers[name] = value as string | number
        return
      }
      Object.assign(headers, name)
    },
  }
  return { ctx, headers }
}

test('管理路径打满窗口后返回 429 与统一错误信封', async () => {
  const middleware = managementRateLimiter({ max: 3, windowMs: 60_000 })
  const pass = async () => {
    const { ctx, headers } = makeCtx('/v1/management/config')
    await middleware(ctx as never, async () => {
      ctx.status = 200
    })
    return { ctx, headers }
  }

  for (let i = 0; i < 3; i += 1) {
    const { ctx, headers } = await pass()
    assert.equal(ctx.status, 200, `第 ${i + 1} 次请求应当放行`)
    assert.equal(headers['X-RateLimit-Limit'], 3)
  }

  const limited = await pass()
  assert.equal(limited.ctx.status, 429)
  assert.ok(limited.ctx.body, '429 必须有响应体')
  const body = limited.ctx.body as { success: boolean; error: { code: string; message: string } }
  assert.equal(body.success, false)
  assert.equal(body.error.code, 'management_rate_limited')
  assert.match(body.error.message, /too many management api requests/i)
  assert.ok('Retry-After' in limited.headers, '429 必须带 Retry-After')
})

test('非管理路径永不计数', async () => {
  const middleware = managementRateLimiter({ max: 1, windowMs: 60_000 })

  for (let i = 0; i < 50; i += 1) {
    const { ctx } = makeCtx('/v1/chat/completions')
    await middleware(ctx as never, async () => {
      ctx.status = 200
    })
    assert.equal(ctx.status, 200, '推理路径不受管理面限流影响')
  }

  // 前缀相邻但不是子路径（`/v1/managementX`）也不该被算进去
  const { ctx } = makeCtx('/v1/managementX')
  await middleware(ctx as never, async () => {
    ctx.status = 200
  })
  assert.equal(ctx.status, 200)
})

test('计数按归属键分开，且每个实例自成一个桶', async () => {
  const middleware = managementRateLimiter({ max: 1, windowMs: 60_000 })

  const first = makeCtx('/v1/management/config', '10.0.0.1')
  await middleware(first.ctx as never, async () => {
    first.ctx.status = 200
  })
  const otherIp = makeCtx('/v1/management/config', '10.0.0.2')
  await middleware(otherIp.ctx as never, async () => {
    otherIp.ctx.status = 200
  })
  assert.equal(otherIp.ctx.status, 200, '另一个 IP 有自己的额度')

  const fresh = managementRateLimiter({ max: 1, windowMs: 60_000 })
  const sameIp = makeCtx('/v1/management/config', '10.0.0.1')
  await fresh(sameIp.ctx as never, async () => {
    sameIp.ctx.status = 200
  })
  assert.equal(sameIp.ctx.status, 200, '新实例不带前一个实例的计数')
})

test('默认窗口是 60 次 / 60 秒', () => {
  assert.equal(MANAGEMENT_RATE_LIMIT_MAX, 60)
  assert.equal(MANAGEMENT_RATE_LIMIT_WINDOW_MS, 60_000)
})
