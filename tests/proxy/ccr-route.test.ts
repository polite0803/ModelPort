/**
 * `/v1/ccr/:hash` — the retrieval path a compression marker points at.
 *
 * The point of this route is *reachability*: the same API key the client
 * already uses must be enough, because the model (or the agent driving it) never
 * holds the management secret. These tests drive the router directly, so they
 * assert the route's own contract; the API-key gate is covered by the server
 * middleware and applies here because this path is a normal `/v1/*` path.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ccrRouter from '../../src/main/proxy/routes/ccr.ts'
import { CcrStore, setCcrStore } from '../../src/main/proxy/compression/ccr/store.ts'

interface FakeContext {
  method: string
  path: string
  params: Record<string, string>
  request: { path: string; params: Record<string, string> }
  status: number
  body: unknown
  headers: Record<string, string>
  set(key: string, value: string): void
}

async function request(path: string): Promise<FakeContext> {
  const ctx: FakeContext = {
    method: 'GET',
    path,
    params: {},
    // @koa/router writes the captured path params into `ctx.request.params`,
    // so the fake has to carry the same shape koa itself would.
    request: { path, params: {} },
    status: 404,
    body: undefined,
    headers: {},
    set(key: string, value: string) {
      this.headers[key] = value
    },
  }
  await ccrRouter.routes()(ctx as never, (async () => {}) as never)
  return ctx
}

function withStore<T>(fn: (store: CcrStore) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'modelport-ccr-route-'))
  const store = new CcrStore({ dir })
  setCcrStore(store)
  return fn(store).finally(() => {
    setCcrStore(undefined)
    rmSync(dir, { recursive: true, force: true })
  })
}

test('a stored hash returns the byte-identical original', async () => {
  await withStore(async store => {
    const content = 'line one\nline two 🚀\n'
    const id = store.put(content, 24) as string

    const ctx = await request(`/v1/ccr/${id}`)
    const body = ctx.body as { hash: string; content: string; bytes: number }

    assert.equal(ctx.status, 404, 'the router leaves status alone on a hit')
    assert.equal(body.hash, id)
    assert.equal(body.content, content)
    assert.equal(body.bytes, Buffer.byteLength(content, 'utf8'))
    assert.ok(ctx.headers['X-Request-Id'], 'every /v1/* response carries an id')
    assert.equal(ctx.headers['Cache-Control'], 'no-store')
  })
})

test('an unknown hash is a 404 with a stable code, not a 500', async () => {
  await withStore(async () => {
    const ctx = await request(`/v1/ccr/${'a'.repeat(24)}`)
    assert.equal(ctx.status, 404)
    const body = ctx.body as { error: { code: string } }
    assert.equal(body.error.code, 'ccr_miss')
  })
})

test('a malformed hash is rejected before any filesystem access', async () => {
  await withStore(async store => {
    const ctx = await request('/v1/ccr/ABCDEF123456')
    assert.equal(ctx.status, 400)
    const body = ctx.body as { error: { code: string } }
    assert.equal(body.error.code, 'invalid_hash')

    // A rejected id must not be counted as a store miss: nothing was looked up.
    assert.equal(store.stats().misses, 0)
  })
})