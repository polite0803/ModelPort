import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Wiring assertions for the request path.
 *
 * Every other compression test drives a pure function, so none of them can see
 * whether the function is actually CALLED, or in what order. Those two facts are
 * the load-bearing part of this feature:
 *
 * - the duplication measurement must run BEFORE compression, because it answers
 *   "how much does the client's own request repeat itself" — measuring after a
 *   rewrite would report our edits instead of the client's behaviour;
 * - compression must run BEFORE the managed tool layer, because that layer
 *   appends protocol markup which must never pass through a content compressor;
 * - the verbosity block must run AFTER compression and BEFORE the tool layer,
 *   because it edits the same system message the tool layer appends to, and a
 *   style hint must never outrank the tool contract.
 *
 * This is a source-structure test, the same technique `tests/api/parameter-policy`
 * already uses for ordering rules that a unit test cannot observe.
 */

const forwarder = readFileSync(
  fileURLToPath(new URL('../../src/main/proxy/forwarder.ts', import.meta.url)),
  'utf8'
)

/** Index of the first CALL of a pattern, failing loudly when absent. */
function positionOf(pattern: RegExp, label: string): number {
  const match = pattern.exec(forwarder)
  assert.ok(match, `expected to find ${label} in forwarder.ts`)
  return match.index
}

test('the duplication measurement is called on the forwarder path', () => {
  assert.match(
    forwarder,
    /recordDuplication\(\s*request\.requestId,\s*measureCrossTurnDuplication\(request\.messages\)\s*\)/,
    'the duplication measurement must feed request.requestId into the report registry'
  )
})

test('duplication is measured BEFORE compression rewrites anything', () => {
  const measure = positionOf(
    /measureCrossTurnDuplication\(request\.messages\)/,
    'the measurement call'
  )
  const compress = positionOf(/applyCompression\(\{/, 'the compression call')

  assert.ok(
    measure < compress,
    'the duplication measurement must run before applyCompression: it reports what the CLIENT sent, ' +
      'so a live-zone rewrite must not be able to contaminate it'
  )
})

test('conversation survivorship is observed BEFORE compression too', () => {
  const observe = positionOf(
    /recordConversationTurn\(request\.messages\)/,
    'the survivorship call'
  )
  const compress = positionOf(/applyCompression\(\{/, 'the compression call')

  assert.ok(
    observe < compress,
    'survivorship must be attributed from the client-sent messages, for the same reason as ' +
      'duplication: the turn ordinal describes the conversation, not our edits'
  )
})

test('survivorship cannot fail a request', () => {
  // Both observations share one try/catch, so a survivorship bug that throws is
  // swallowed exactly like a duplication bug.
  assert.match(
    forwarder,
    /try\s*\{[\s\S]*?recordConversationTurn[\s\S]*?\}\s*catch[\s\S]*?console\.error/,
    'the survivorship observation must sit inside the fail-open try/catch'
  )
})

test('compression is the last thing that rewrites the outbound messages', () => {
  const compress = positionOf(/applyCompression\(\{/, 'the compression call')
  // 2026-11-03 两处改写退役（托管工具层、verbosity 引导）之后，压缩产出的那份消息就是
  // 出站装配读到的那一份。这里钉的是顺序，钉的更是「后面没有第二个往消息里写字的环节」。
  const build = positionOf(
    /const body = this\.buildRequestBody\(request, actualModel, account\)/,
    'the outbound body build'
  )

  assert.ok(compress < build, 'compression must precede the outbound body build')
  for (const dead of ['applyVerbositySteering', 'transformRequestForPromptToolUse']) {
    assert.equal(forwarder.includes(dead), false, `已退役的改写环节又出现在转发器里：${dead}`)
  }
})

test('the duplication measurement is independent of the compression switch', () => {
  // It must be reachable even with compression disabled — that is its whole
  // purpose: gather evidence before deciding whether to build deduplication.
  const measure = positionOf(/measureCrossTurnDuplication\(request\.messages\)/, 'the measurement call')

  // Search the code between the start of the method and the measurement for a
  // compression-enabled guard that would gate it.
  const prefix = forwarder.slice(0, measure)
  const lastGuard = Math.max(
    prefix.lastIndexOf('config.compression?.enabled'),
    prefix.lastIndexOf('config.compression.enabled'),
    prefix.lastIndexOf('compression.enabled')
  )
  const compressCall = lastIndexOfPattern(prefix, /applyCompression\(\{/)

  assert.ok(
    lastGuard === -1 || lastGuard < compressCall,
    'the duplication measurement must not be gated on the compression switch'
  )
})

test('a measurement failure cannot fail the request', () => {
  // Fail-open is an invariant of this whole feature: an observation bug must
  // never turn a request into a 500.
  assert.match(
    forwarder,
    /try\s*\{[\s\S]*?recordDuplication[\s\S]*?\}\s*catch[\s\S]*?console\.error/,
    'the duplication measurement must be wrapped in a try/catch that only logs'
  )
})

/** Last index of a pattern, or -1. */
function lastIndexOfPattern(haystack: string, pattern: RegExp): number {
  const matches = [...haystack.matchAll(new RegExp(pattern.source, 'g'))]
  const last = matches[matches.length - 1]
  return last && last.index !== undefined ? last.index : -1
}
