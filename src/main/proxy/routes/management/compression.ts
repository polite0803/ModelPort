/**
 * Management API — context compression endpoints.
 *
 * Retrieval is deliberately HTTP-only (review decision 2): no tool is injected
 * into the request, so the upstream request shape is unchanged. A client or an
 * agent that sees a `<<ccr:...>>` marker can call this endpoint with the hash to
 * get the original bytes back.
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import ConfigManager from '../../../store/config'
import { storeManager } from '../../../store/store'
import { managementAuthMiddleware } from '../../middleware/managementAuth'
import { getCcrStore } from '../../compression/ccr/store'
import { summarizeDuplication, interpretDuplication } from '../../compression/duplicationSummary.ts'
import { readSurvivorshipStats } from '../../compression/survivorship.ts'
import { COMPRESSION_AGGRESSIVENESS, type ManagementApiResponse } from '../../../../shared/types'

const router = new Router({ prefix: '/v1/management/compression' })

router.use(managementAuthMiddleware)

router.get('/status', async (ctx: Context) => {
  const config = ConfigManager.get()

  ctx.body = {
    success: true,
    data: {
      config: config.compression,
      aggressivenessOptions: COMPRESSION_AGGRESSIVENESS,
      ccr: getCcrStore().stats(),
    },
  } as ManagementApiResponse
})

/**
 * Retrieve the original bytes behind a compression marker.
 *
 * `hash` is the id embedded in the marker and is validated by the store before
 * any filesystem access, so a caller cannot probe arbitrary paths. A miss is a
 * 404 with the same OpenAI-ish error shape the rest of the API uses, never a
 * 500: an expired entry is an expected outcome, not a failure.
 */
router.get('/retrieve', async (ctx: Context) => {
  const hash = String(ctx.query.hash ?? '').trim()

  if (!hash) {
    ctx.status = 400
    ctx.body = {
      success: false,
      error: {
        message: 'Missing required query parameter: hash',
        type: 'invalid_request_error',
        code: 'missing_param',
      },
    } as ManagementApiResponse
    return
  }

  const original = getCcrStore().get(hash)
  if (original === undefined) {
    ctx.status = 404
    ctx.body = {
      success: false,
      error: {
        message: 'No stored original for this hash (unknown or expired)',
        type: 'invalid_request_error',
        code: 'ccr_miss',
      },
    } as ManagementApiResponse
    return
  }

  ctx.body = {
    success: true,
    data: { hash, content: original, bytes: Buffer.byteLength(original, 'utf8') },
  } as ManagementApiResponse
})

/**
 * Cross-turn duplication summary.
 *
 * Answers one question: is folding repeated content across turns worth building?
 * The measurement itself never rewrites a request (see `compression/duplication`),
 * so this endpoint is the only consumer of it.
 *
 * Three honesty constraints, each visible in the payload rather than buried:
 *
 * - it reports the **request-log window**, not a lifetime total; the log keeps
 *   only `maxEntries` rows, so `sampled` is small on a fresh install and the
 *   ratios are over that sample alone;
 * - `unmeasured` is reported separately from a zero — "not looked at" is not
 *   "looked and found nothing";
 * - `ratio` is `null` when nothing was scanned, never `0`.
 *
 * `duplicatedChars` is raw message-text characters, NOT tokens. Converting it
 * would need the model's tokenizer, which this app does not carry.
 */
router.get('/duplication', async (ctx: Context) => {
  const config = ConfigManager.get()
  const logConfig = config.requestLogConfig
  const entries = storeManager.getRequestLogs()
  const summary = summarizeDuplication(entries)
  const survivorship = readSurvivorshipStats()

  ctx.body = {
    success: true,
    data: {
      ...summary,
      sample: {
        entriesInWindow: entries.length,
        logRetention: logConfig?.maxEntries ?? null,
        logEnabled: logConfig?.enabled !== false,
        // The unit of every character count below.
        unit: 'chars',
      },
      /**
       * How long conversations actually last — the `expected_reads` term of the
       * gain budget, learned from requests seen so far.
       *
       * `meanRemainingTurns` is the single number a folding budget needs, and it
       * stays `null` until enough conversations have finished to mean anything.
       * Null is an answer ("not yet known"), never a zero.
       */
      survivorship,
      // Reading the number: below ~5% the rewrite cost dominates; above ~20%
      // with real multi-turn traffic, folding is worth building. The judgement
      // itself lives in `duplicationSummary.ts` because the folding gate obeys
      // the same one - a second copy here would be a second answer.
      interpretation: interpretDuplication(summary, survivorship),
    },
  } as ManagementApiResponse
})

export default router
