/**
 * Management API - stage a backup file the browser uploaded.
 *
 * Import has three entries and one engine. The desktop app chooses the file with a native
 * dialog; `--import-backup` takes a path on the daemon's own machine; and a page served by
 * the headless daemon has the file on the *operator's* machine, not the gateway's - so it
 * uses the browser's own picker and sends the bytes here. All three end in
 * `stageBackupFile()`, which is what keeps the format checks, the sealed-file path and the
 * one-shot token identical instead of a second importer that drifts.
 *
 * What this route deliberately does not do:
 * - take a filename or directory from the client (the path is generated here, in the
 *   gateway's own data directory, mode 0600);
 * - buffer an unbounded body (the cap is enforced while the stream arrives, so an oversized
 *   upload never lands);
 * - leave the upload behind (the staged import lives in memory behind the token, so the
 *   temp file is deleted before the response is sent).
 *
 * Auth and rate limiting come from the management prefix like every other route here.
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import type { IncomingMessage } from 'node:http'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { managementAuthMiddleware } from '../../middleware/managementAuth'
import { storeManager } from '../../../store/store'
import { MAX_BACKUP_BYTES, stageBackupFile } from '../../../backup/service'
import type { ManagementApiResponse } from '../../../../shared/types'

const router = new Router({ prefix: '/v1/management/backup' })

router.use(managementAuthMiddleware)

function fail(ctx: Context, status: number, code: string, message: string): ManagementApiResponse {
  ctx.status = status
  return { success: false, error: { code, message } }
}

/** The body, or `null` when it crosses the cap - the cap is checked as chunks arrive. */
export async function readCapped(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of request) {
    received += (chunk as Buffer).length
    if (received > limit) return null
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

router.post('/stage', async (ctx) => {
  const bytes = await readCapped(ctx.req, MAX_BACKUP_BYTES)
  if (bytes === null) {
    ctx.body = fail(ctx, 413, 'too-large', `a backup may not exceed ${MAX_BACKUP_BYTES} bytes`)
    return
  }
  if (bytes.length === 0) {
    ctx.body = fail(ctx, 400, 'invalid_request', 'the upload was empty')
    return
  }

  const tempPath = join(storeManager.getStoragePath(), `import.${randomUUID()}.json`)
  try {
    writeFileSync(tempPath, bytes, { mode: 0o600 })
    ctx.body = { success: true, data: stageBackupFile(tempPath) } satisfies ManagementApiResponse
  } finally {
    try {
      unlinkSync(tempPath)
    } catch {
      // A file that never landed is the desired end state; nothing else to clean up.
    }
  }
})

export default router
