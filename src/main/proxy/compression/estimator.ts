/**
 * Content-aware token estimation.
 *
 * The proxy already has a crude `chars / 4` estimator (`quota/usage.ts`) used
 * for the quota ledger. That number is fine for metering but it under-counts
 * compact machine-generated JSON badly: with no spaces the payload has almost
 * no "words", so a whitespace-based estimate reports a ratio near 1.0 and the
 * savings gate silently rejects real compression.
 *
 * This module prices content by class instead, following headroom's
 * `tokenizers/estimator.py` calibration. It is an ESTIMATE and every figure
 * derived from it must be reported as such — never written into the response
 * body's `usage` field.
 */

import type { ContentType } from './types.ts'

/** Characters per token, calibrated against cl100k_base. */
const CHARS_PER_TOKEN_TEXT = 4.0
const CHARS_PER_TOKEN_CODE = 3.5
const CHARS_PER_TOKEN_JSON = 3.2
/**
 * Dense scripts tokenize at roughly 0.6-1.7 tokens per character versus ~0.25
 * for English. A flat 4.0 ratio under-counts them 4-6x, so they are priced
 * separately (1.5 chars/token keeps the estimate conservative).
 */
const CHARS_PER_TOKEN_CJK = 1.5

/**
 * CJK symbols/punctuation, Hiragana/Katakana, CJK Unified Ideographs (+ Ext A),
 * Hangul, CJK compatibility ideographs, fullwidth forms, and astral CJK
 * extensions B-G.
 */
const CJK_PATTERN = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]|[\u{20000}-\u{3ffff}]/gu

function charsPerTokenFor(contentType: ContentType | undefined): number {
  switch (contentType) {
    case 'json_array':
      return CHARS_PER_TOKEN_JSON
    case 'source_code':
    case 'build_output':
      return CHARS_PER_TOKEN_CODE
    default:
      return CHARS_PER_TOKEN_TEXT
  }
}

/**
 * Count CJK codepoints in `text`.
 *
 * Exported because this module owns the one calibrated ratio table, and history
 * trimming prices message sizes with its own (deliberately conservative) ASCII
 * divisor. It must still price dense scripts by THIS table: a flat 3 chars/token
 * under-counts Chinese 2x, and a budget computed from an under-count does not
 * bind — 2026-11-16 a request reached 1.9x its configured cap while the trimmer
 * logged `Trimmed from 4 to 4`.
 */
export function countCjkChars(text: string): number {
  if (!text) return 0
  let cjk = 0
  // `String.length` counts UTF-16 code units; CJK BMP chars are 1 unit and the
  // astral range is 2, which the ratio difference absorbs.
  for (const match of text.matchAll(CJK_PATTERN)) {
    cjk += match[0].length
  }
  return cjk
}

/**
 * Estimate the token count of `text`, pricing CJK codepoints separately from
 * the bulk of the payload.
 */
export function estimateTokens(text: string, contentType?: ContentType): number {
  if (!text) return 0

  const cjk = countCjkChars(text)
  const rest = text.length - cjk
  const ratio = charsPerTokenFor(contentType)
  return Math.max(1, Math.ceil(rest / ratio + cjk / CHARS_PER_TOKEN_CJK))
}
