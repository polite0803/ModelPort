import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * "压缩节省 0" has two completely different causes, and on a real install they
 * were indistinguishable for weeks (2026-11-01: the dashboard showed `0` while
 * compression was switched off, and the number never changed no matter what
 * traffic ran).
 *
 * The chain that decides which cause it is, in order:
 *
 * 1. with the switch off, `applyCompression` exits WITHOUT a report at all, so
 *    nothing is recorded for the request (this is what the request log shows:
 *    `compression` absent, while the sibling observables are present);
 * 2. the day bucket therefore gets no `savedTokens`, and stays at 0;
 * 3. a bare `savedTokens` on screen therefore cannot answer "did compression
 *    save nothing, or was it never allowed to save anything?".
 *
 * The answer is the flag the store attaches at the boundary, so these fences
 * keep each link honest rather than letting the UI guess.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const compressor = read('../../src/main/proxy/compression/index.ts')
const forwarder = read('../../src/main/proxy/forwarder.ts')
const chatRoute = read('../../src/main/proxy/routes/chat.ts')
const store = read('../../src/main/store/store.ts')
const card = read('../../src/renderer/src/components/dashboard/TokenUsageCard.tsx')
const settings = read('../../src/renderer/src/components/proxy/CompressionSettings.tsx')

const { summarizeDay, normalizeDayBucket } = await import(
  '../../src/shared/tokenAccounting.ts'
)

test('a disabled compressor records nothing at all, which is why the flag is needed', () => {
  // The single exit that returns no report. `skipReport` would still produce
  // `applied: []` plus a reason and land in the log; this one produces silence.
  assert.match(compressor, /if \(!config\.enabled\) return \{ messages \}/)
  assert.doesNotMatch(
    compressor,
    /if \(!config\.enabled\) return skipReport/,
    'turning the skip into a report would make "off" look like a measurement of "nothing qualified"'
  )

  // …so the forwarder can only record a report when one exists.
  assert.match(forwarder, /if \(compression\.report && request\.requestId\) \{\s*\n\s*recordCompressionReport/)
})

test('savings reach the day bucket only from a report that applied something', () => {
  assert.match(chatRoute, /compressionReport && compressionReport\.applied\.length > 0/)
  assert.match(chatRoute, /\?\s*compressionReport\.saved/)
  // Never the counterfactual: `tokensBefore` is what the request WOULD have cost,
  // and crediting it as saved is the mistake this row was built to avoid.
  assert.doesNotMatch(chatRoute, /\?\s*compressionReport\.tokensBefore/)
  // Three metering exits (non-stream, and both stream branches) must all pass it,
  // or a streaming day silently reports 0 savings while the headers say otherwise.
  const savingsPassed = chatRoute.match(/\?\s*compressionReport\.saved/g) ?? []
  assert.equal(savingsPassed.length, 3, 'every meterQuota exit needs the same savings gate')
})

test('the store attaches the enablement flag from the config it already normalises', () => {
  assert.match(
    store,
    /const compressionEnabled = this\.getConfig\(\)\.compression\?\.enabled === true/
  )
  assert.match(store, /\.\.\.summarizeDay\(day, normalizeDayBucket\(stored\[day\]\)\), compressionEnabled/)
})

test('the pure projection does not invent the flag', () => {
  // `summarizeDay` knows only stored counters. If it ever defaulted the flag to
  // `false`, every historical day would render as "not enabled" - the exact
  // disguise this change removes.
  const summary = summarizeDay('2026-11-01', normalizeDayBucket(undefined))
  assert.equal(summary.compressionEnabled, undefined)
  assert.equal(summary.savedTokens, 0)
})

test('the card consults the flag before showing a savings number', () => {
  const gate = card.indexOf('usage?.compressionEnabled === false')
  assert.ok(gate > 0, 'the savings row must ask whether compression is enabled at all')

  const disabledBranch = card.slice(gate, card.indexOf(') : (', gate))
  assert.doesNotMatch(
    disabledBranch,
    /savedTokens/,
    'the disabled branch must render "-" - a number there claims a measurement happened'
  )
  // The reason is in the row, not only in the tooltip.
  assert.match(disabledBranch, /t\('dashboard\.tokenUsage\.savedDisabled'\)/)
  // The enabled branch keeps the real figure.
  assert.match(card, /formatTokens\(usage\?\.savedTokens \?\? 0\)/)
})

test('the settings panel holds no second copy of the compression default', () => {
  // `updateConfig` merges the WHOLE config onto every save, so a UI-side default
  // gets persisted the first time anyone presses Save - and
  // `normalizeCompressionConfig` then honours that explicit false forever. This
  // is how a shipped default of "on" ended up looking like a permanent "off".
  assert.doesNotMatch(settings, /const DEFAULT_CONFIG/)
  assert.doesNotMatch(
    settings,
    /useState<CompressionConfig>\(/,
    'a non-nullable state must be seeded from somewhere, and that somewhere is a second default'
  )
  assert.match(settings, /useState<CompressionConfig \| null>\(null\)/)
  assert.match(settings, /config === null \?/)

  // Both write paths are gated on the value actually having been read.
  const gated = settings.match(/if \(config === null\) return/g) ?? []
  assert.equal(gated.length, 2, 'handleChange and saveConfig must both refuse to write an unread config')
})

test('both shipped locales can say why the row is a dash', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(read(`../../src/renderer/src/i18n/locales/${locale}.json`))

    for (const key of ['savedDisabled', 'savedDisabledHint']) {
      assert.equal(
        typeof messages.dashboard?.tokenUsage?.[key],
        'string',
        `${locale} has no dashboard.tokenUsage.${key}`
      )
    }
    assert.equal(
      typeof messages.compression?.loading,
      'string',
      `${locale} has no compression.loading`
    )

    // The dash is only honest if it names the cause; a hint that still reads as
    // "nothing was saved" would reintroduce the original bug in prose.
    assert.match(
      messages.dashboard.tokenUsage.savedDisabledHint,
      /没有测量|never measured|not a measurement/i,
      `${locale} savedDisabledHint must distinguish "never measured" from "saved nothing"`
    )
  }
})
