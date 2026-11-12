/**
 * CCR retrieval over the ordinary API key.
 *
 * `GET /v1/ccr/:hash` returns the bytes behind a `<<ccr:hash>>` marker.
 *
 * Why this lives here instead of under `/v1/management/compression/retrieve`:
 * that endpoint is behind `managementAuthMiddleware` and the management API is
 * **off by default**. A model (or the agent driving it) holds the client's API
 * key, never the management secret, so the retrieval path a marker points at was
 * unreachable in the shipped configuration - the pointer existed and nobody
 * could follow it. This route needs no new credential: it is a normal `/v1/*`
 * path, so the existing API-key middleware covers it.
 *
 * The lookup itself carries no risk: `CcrStore.get()` validates the id against
 * `/^[a-f0-9]{12,64}$/` before touching the filesystem, so a caller cannot probe
 * paths outside the store directory.
 */

import { randomUUID } from 'node:crypto'
import Router from '@koa/router'
import type { Context } from 'koa'
import { getCcrStore } from '../compression/ccr/store.ts'

const router = new Router({ prefix: '/v1/ccr' })

const HASH_PATTERN = /^[a-f0-9]{12,64}$/

router.get('/:hash', async (ctx: Context) => {
  // Every `/v1/*` response carries an id; this read has no request-log row of
  // its own (same shape as `GET /v1/api-definition/providers`).
  ctx.set('X-Request-Id', randomUUID())
  ctx.set('Cache-Control', 'no-store')

  const hash = String((ctx.params as { hash?: string }).hash ?? '').trim()

  if (!HASH_PATTERN.test(hash)) {
    ctx.status = 400
    ctx.body = {
      error: {
        message: 'hash must be 12 to 64 lowercase hex characters',
        type: 'invalid_request_error',
        code: 'invalid_hash',
      },
    }
    return
  }

  const content = getCcrStore().get(hash)
  if (content === undefined) {
    // Unknown and expired are the same answer on purpose: telling them apart
    // would leak whether a given payload was ever compressed by this gateway.
    ctx.status = 404
    ctx.body = {
      error: {
        message: 'No stored original for this hash (unknown or expired)',
        type: 'invalid_request_error',
        code: 'ccr_miss',
      },
    }
    return
  }

  ctx.body = { hash, content, bytes: Buffer.byteLength(content, 'utf8') }
})

export default router