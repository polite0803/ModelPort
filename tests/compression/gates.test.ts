import { test } from 'node:test'
import assert from 'node:assert/strict'

import { acceptCompression } from '../../src/main/proxy/compression/policy.ts'
import { detectContentType } from '../../src/main/proxy/compression/detector.ts'
import { hasErrorKeyword } from '../../src/main/proxy/compression/signals/errorKeywords.ts'
import { computeOptimalK } from '../../src/main/proxy/compression/signals/adaptiveSizer.ts'
import {
  isCcrSentinel,
  stripCcrSentinels,
  makeRowSentinel,
  makeItemSentinel,
  isAlreadyCompressed,
} from '../../src/main/proxy/compression/ccr/markers.ts'

test('content detection separates the classes that matter', () => {
  assert.equal(detectContentType('[{"a":1},{"a":2}]').type, 'json_array')
  assert.equal(detectContentType('not json at all').type, 'plain_text')

  // Truncated JSON must NOT claim the array class.
  assert.notEqual(detectContentType('[{"a":1},{"a":').type, 'json_array')

  const diff = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '+b'].join('\n')
  assert.equal(detectContentType(diff).type, 'git_diff')

  const html = '<!doctype html><html><head></head><body><p>hi</p></body></html>'
  assert.equal(detectContentType(html).type, 'html')

  const search = ['src/a.ts:12:const x = 1', 'src/b.ts:44:function y() {}', 'src/c.ts:9:export z'].join('\n')
  assert.equal(detectContentType(search).type, 'search_results')

  const log = [
    'ERROR failed to connect to db',
    'WARN retrying in 5s',
    'ERROR failed again',
    '===== 3 failed, 12 passed =====',
  ].join('\n')
  assert.equal(detectContentType(log).type, 'build_output')
})

test('Windows paths and dashed filenames still parse as search results', () => {
  const lines = [
    'C:\\Users\\dev\\app.ts:42:const value = 1',
    'pre-commit-config.yaml-17-repos:',
    'C:\\Users\\dev\\b.ts:10:export const y = 2',
  ].join('\n')

  assert.equal(detectContentType(lines).type, 'search_results')
})

test('error keywords are matched case-insensitively and include the full set', () => {
  for (const keyword of ['ERROR', 'Fatal', 'panic', 'TIMEOUT', 'denied', 'rejected', 'abort', 'crash']) {
    assert.equal(hasErrorKeyword(`some output with ${keyword} inside`), true, keyword)
  }
  assert.equal(hasErrorKeyword('everything went fine'), false)
})

test('the acceptance gate rejects rewrites that do not shrink', () => {  const same = acceptCompression({
    before: 'x'.repeat(1000),
    after: 'x'.repeat(1000),
    contentType: 'json_array',
    changed: true,
  })
  assert.equal(same.accept, false)
  assert.equal(same.reason, 'not_smaller')

  const claimsNoChange = acceptCompression({
    before: 'x'.repeat(1000),
    after: 'y'.repeat(100),
    contentType: 'json_array',
    changed: false,
  })
  assert.equal(claimsNoChange.accept, false)

  const real = acceptCompression({
    before: 'x'.repeat(1000),
    after: 'x'.repeat(200),
    contentType: 'json_array',
    changed: true,
  })
  assert.equal(real.accept, true)
  assert.ok(real.ratio > 0.5)
})

test('a rewrite that saves less than the minimum ratio is rejected', () => {
  const before = 'abcdefghij'.repeat(100)
  const after = 'abcdefghij'.repeat(98)
  const outcome = acceptCompression({ before, after, contentType: 'plain_text', changed: true })
  assert.equal(outcome.accept, false)
  assert.equal(outcome.reason, 'insufficient_savings')
})

test('adaptive sizing keeps everything for tiny payloads', () => {
  const items = ['a', 'b', 'c', 'd', 'e']
  assert.equal(computeOptimalK(items), items.length)
})

test('adaptive sizing collapses near-total redundancy to the distinct items', () => {
  const items = Array.from({ length: 100 }, () => 'identical line of text')
  const k = computeOptimalK(items, { minK: 3, maxK: 15 })
  assert.ok(k <= 3, `expected a tiny retention, got ${k}`)
})

test('adaptive sizing never exceeds its ceiling', () => {
  const items = Array.from({ length: 300 }, (_, index) => `distinct wording number ${index * 13}`)
  const k = computeOptimalK(items, { minK: 3, maxK: 15 })
  assert.ok(k <= 15, `expected <= 15, got ${k}`)
  assert.ok(k >= 3)
})

test('sentinel helpers round-trip both marker shapes', () => {
  const rowSentinel = makeRowSentinel('abcdef123456', 12)
  assert.equal(isCcrSentinel(rowSentinel), true)

  const itemSentinel = makeItemSentinel('abcdef123456', 5)
  assert.equal(isCcrSentinel(itemSentinel), true)

  const data = [{ id: 1 }, { id: 2 }]
  assert.deepEqual(stripCcrSentinels([...data, rowSentinel]), data)
  assert.deepEqual(stripCcrSentinels([...data, itemSentinel]), data)

  assert.equal(isCcrSentinel({ id: 1 }), false)
  assert.equal(isCcrSentinel('plain string'), false)
})

test('already-compressed text is recognised in every marker form', () => {
  assert.equal(isAlreadyCompressed('… 3 more items <<ccr:abc123 3_items_offloaded>>'), true)
  assert.equal(isAlreadyCompressed('{"_ccr_dropped":"<<ccr:abc123 4_rows_offloaded>>"}'), true)
  assert.equal(isAlreadyCompressed('[12 lines compressed to 3. Retrieve more: hash=abc]'), true)
  assert.equal(isAlreadyCompressed('[Read content stale: Retrieve original: hash=abc]'), true)
  assert.equal(isAlreadyCompressed('ordinary tool output'), false)
})

test('the cache-aware gate demands more than the flat 10% floor', () => {
  const before = 'x'.repeat(1000)

  const ordinary = acceptCompression({
    before,
    after: 'x'.repeat(200),
    contentType: 'json_array',
    changed: true,
  })
  assert.equal(ordinary.accept, true, '无缓存证据时 80% 仍然足够')

  const deepseek = acceptCompression({
    before,
    after: 'x'.repeat(200),
    contentType: 'json_array',
    changed: true,
    cachePolicy: { readDiscount: 0.02, writeMultiplier: 0 },
  })
  assert.equal(deepseek.accept, false)
  assert.equal(deepseek.reason, 'insufficient_savings')

  const extreme = acceptCompression({
    before,
    after: 'x'.repeat(5),
    contentType: 'json_array',
    changed: true,
    cachePolicy: { readDiscount: 0.02, writeMultiplier: 0 },
  })
  assert.equal(extreme.accept, true, '省到 98% 以上才值得丢掉缓存读')
})
