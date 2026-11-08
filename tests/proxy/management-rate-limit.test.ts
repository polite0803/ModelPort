import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MANAGEMENT_RATE_LIMIT_GLOBAL_MAX,
  MANAGEMENT_RATE_LIMIT_MAX,
  MANAGEMENT_RATE_LIMIT_WINDOW_MS,
  managementBucketKey,
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
  method: string
  status: number
  body: unknown
  state: Record<string, unknown>
  request: { body?: unknown }
  set: (name: string | Record<string, string | number>, value?: string | number) => void
}

function makeCtx(
  path: string,
  ip = '127.0.0.1',
  rpcBody?: unknown,
): { ctx: FakeCtx; headers: Record<string, string | number> } {
  const headers: Record<string, string | number> = {}
  const ctx: FakeCtx = {
    path,
    ip,
    method: 'POST',
    status: 404,
    body: undefined,
    state: {},
    request: rpcBody === undefined ? {} : { body: rpcBody },
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
  const body = limited.ctx.body as {
    success: boolean
    error: { code: string; message: string; retryAfterMs?: number }
  }
  assert.equal(body.success, false)
  assert.equal(body.error.code, 'management_rate_limited')
  assert.match(body.error.message, /too many management api requests/i)
  assert.ok('Retry-After' in limited.headers, '429 必须带 Retry-After')
  // 远程 UI 靠这个字段自动退避一次，不能只靠解析英文文案。
  assert.ok(typeof body.error.retryAfterMs === 'number' && body.error.retryAfterMs > 0)
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

test('默认窗口是 240 次 / 60 秒', () => {
  // 60/分钟会让远程 UI 自己把自己限流：一次 Channels 刷新就有十几个 RPC，
  // 再叠加状态轮询。240 仍然拦得住死循环脚本。
  assert.equal(MANAGEMENT_RATE_LIMIT_MAX, 240)
  assert.equal(MANAGEMENT_RATE_LIMIT_WINDOW_MS, 60_000)
})

test('RPC 按 (channel, args) 分桶：一家渠道打满不拖累另一家', async () => {
  const middleware = managementRateLimiter({ max: 1, windowMs: 60_000 })
  const call = async (args: unknown[]) => {
    const { ctx } = makeCtx('/v1/management/rpc', '10.0.0.9', { channel: 'channels:models', args })
    await middleware(ctx as never, async () => {
      ctx.status = 200
    })
    return ctx
  }

  assert.equal((await call(['trae'])).status, 200)
  const limited = await call(['trae'])
  assert.equal(limited.status, 429, '同一 channel+args 的第二次必须被限')
  const body = limited.body as { error: { channel?: string } }
  assert.equal(body.error.channel, 'channels:models', '429 信封要指明被限的调用')

  // 参数不同 = 另一个逻辑调用 = 另一个桶。
  assert.equal((await call(['qoder'])).status, 200, '另一家渠道的目录读取不该被上一家的桶连坐')
  // 完全不同的入口同样独立。
  const list = makeCtx('/v1/management/rpc', '10.0.0.9', { channel: 'channels:list', args: [] })
  await middleware(list.ctx as never, async () => {
    list.ctx.status = 200
  })
  assert.equal(list.ctx.status, 200, 'list 不该被 channels:models 的桶连坐')
})

test('每 IP 全局上限跨桶生效：分桶不等于放宽总量', async () => {
  const middleware = managementRateLimiter({ max: 100, globalMax: 2, windowMs: 60_000 })
  const call = async (path: string, body?: unknown) => {
    const { ctx } = makeCtx(path, '10.0.0.10', body)
    await middleware(ctx as never, async () => {
      ctx.status = 200
    })
    return ctx.status
  }

  assert.equal(await call('/v1/management/rpc', { channel: 'a', args: [] }), 200)
  assert.equal(await call('/v1/management/rpc', { channel: 'b', args: [] }), 200)
  assert.equal(await call('/v1/management/rpc', { channel: 'c', args: [] }), 429, '换桶不能绕过每 IP 总上限')
})

test('非 RPC 路径按 方法+路径 分桶，RPC 参数摘要稳定', () => {
  const a = makeCtx('/v1/management/config').ctx
  const b = makeCtx('/v1/management/config').ctx
  assert.equal(managementBucketKey(a as never), managementBucketKey(b as never))

  const withBody = (args: unknown[]) =>
    managementBucketKey(makeCtx('/v1/management/rpc', '127.0.0.1', { channel: 'channels:rpc', args }).ctx as never)
  assert.equal(withBody(['identity.snapshot', {}]), withBody(['identity.snapshot', {}]))
  assert.notEqual(withBody(['identity.snapshot', {}]), withBody(['usage.autoCheckin', {}]))
  assert.equal(MANAGEMENT_RATE_LIMIT_GLOBAL_MAX, 1200)
})
