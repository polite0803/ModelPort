/**
 * Context compression — shared types.
 *
 * Ported subset of headroom (https://github.com/headroomlabs-ai/headroom),
 * Apache-2.0. See `docs/plan/PLAN-token-compression.md`.
 *
 * Only the pieces that need neither ML models nor Python are ported:
 * content detection, live-zone selection, statistical JSON row selection,
 * and the reversible CCR store. Code-compression (tree-sitter), prose
 * compression (Kompress), HTML extraction (trafilatura) and diff compression
 * are deliberately absent.
 */

/** Content classes the router can recognise. */
export type ContentType =
  | 'json_array'
  | 'json_document'
  | 'build_output'
  | 'search_results'
  | 'source_code'
  | 'plain_text'
  | 'html'
  | 'tabular'
  | 'structured_config'
  | 'git_diff'

/** Compression strength; multiplies the adaptive retention budget. */
import type { CompressionAggressiveness, CompressionConfig } from '../../../shared/types.ts'

/**
 * The config type and its default live in `shared/types.ts` because the renderer
 * and the store both need them; re-exported here so the compression module has a
 * single import surface and there is no second source of truth.
 */
export type { CompressionAggressiveness, CompressionConfig }
export { DEFAULT_COMPRESSION_CONFIG } from '../../../shared/types.ts'

/**
 * `bias` multiplies the adaptive retention count: a larger bias keeps more rows.
 * Values mirror headroom's `adaptive_sizer` presets.
 */
export const AGGRESSIVENESS_BIAS: Record<CompressionAggressiveness, number> = {
  conservative: 1.5,
  moderate: 1.0,
  aggressive: 0.7,
}

/** Minimum estimated-token count before a message is considered at all. */
export const MIN_MESSAGE_TOKENS = 50

/** Retained data rows for a JSON array (`max_items_after_crush`). */
export const MAX_KEPT_ITEMS = 15

/**
 * A compression must remove at least this fraction of estimated tokens.
 * Kept slightly below headroom's `lossless_min_savings_ratio` because we have
 * no lossless fallback path; a 10% win still pays for the added CPU.
 */
export const MIN_SAVINGS_RATIO = 0.1

/** Wall-clock ceiling for one request's compression work. */
export const COMPRESSION_TIMEOUT_MS = 300

/**
 * Per-content-type byte thresholds. Below these the compressor is not worth
 * running (headroom `live_zone.rs:171-199`).
 */
export const CONTENT_TYPE_MIN_BYTES: Record<ContentType, number> = {
  json_array: 512,
  // A JSON document wrapping arrays (the shape MCP tools and most HTTP APIs
  // return) is compressed by rewriting nested arrays, so it shares the array
  // floor: below 512 B there is nothing to win either way.
  json_document: 512,
  build_output: 512,
  search_results: 512,
  source_code: 2048,
  plain_text: 5120,
  html: 512,
  tabular: 512,
  structured_config: 512,
  git_diff: 512,
}

/** Why a request was left untouched. Recorded on the request log. */
export type CompressionSkipReason =
  | 'disabled'
  | 'no_messages'
  | 'no_live_zone'
  | 'multiple_choices'
  | 'below_min_tokens'
  | 'already_compressed'
  | 'below_threshold'
  | 'unsupported_type'
  | 'not_smaller'
  | 'insufficient_savings'
  | 'timeout'
  | 'error'

/** Observability record, attached to the request log row. */
export interface CompressionReport {
  /**
   * Compressors that actually rewrote something, e.g. ['json'].
   *
   * `'fold'` appears here when history deduplication ran (`fold.ts`): it is a
   * rewrite too, and its size belongs to `folded.chars` rather than to the
   * token ledger below.
   */
  applied: string[]
  tokensBefore: number
  tokensAfter: number
  saved: number
  ratio: number
  ccrHashes?: string[]
  skipped?: CompressionSkipReason
  /**
   * Every candidate that reached the accept gate, accepted or refused.
   *
   * A refused candidate leaves no trace in `tokensBefore` / `tokensAfter`
   * (those describe what was actually applied), yet its projection is the only
   * evidence of what compression would have cost. The day counters need it to
   * answer "how often would this have beaten the cache" — see
   * `docs/plan/PLAN-prompt-cache.md` §P3.
   */
  candidates?: CompressionCandidate[]
  /**
   * 跨轮重复折叠的读数（`fold.ts`）。与 `saved` 分开记：`saved` 是 live-zone 估算
   * 省下的 token，这里折掉的是**历史字节**，两者单位相同但作用面不同，合在一起
   * 会让「改写了多少历史」这个事实看不见。
   */
  folded?: {
    /** 被替换成指针的消息条数。 */
    messages: number
    /** 这些消息原本的字符数。 */
    chars: number
    /** 每条消息原文的 CCR 哈希。 */
    hashes: string[]
  }
  /**
   * 本轮注入了哪几块网关自有文本（`gatewayText.ts`）。
   *
   * 记在压缩报告里是因为这三格回答的是同一个问题：「这一轮为了让模型看懂
   * 压缩结果，网关自己多说了什么」。`suspended` 说明用户开了输出契约，但这一家
   * 的退化窗口已经熔断。
   */
  gatewayText?: {
    protocol: boolean
    outputContract: 'default' | 'injected' | 'suspended'
  }
}

/** One live-zone candidate as the accept gate saw it. */
export interface CompressionCandidate {
  contentType: ContentType
  tokensBefore: number
  tokensAfter: number
  accepted: boolean
  /** Why the gate refused. Absent when accepted. */
  reason?: CompressionSkipReason
}

/** Outcome of one field-level compression attempt. */
export interface FieldCompressionResult {
  text: string
  changed: boolean
  tokensBefore: number
  tokensAfter: number
  ccrHash?: string
  /** Compressor name for the report, e.g. 'json'. */
  strategy: string
}
