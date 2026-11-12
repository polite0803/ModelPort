import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const card = readFileSync(
  join(root, 'src/renderer/src/components/dashboard/ProviderStatusCard.tsx'),
  'utf8',
)
const storeSource = readFileSync(
  join(root, 'src/renderer/src/stores/dashboardStore.ts'),
  'utf8',
)

test('the provider counters come from the daily buckets, not the log window', () => {
  // The request-log window is capped at the last N rows, so a 30-day figure read
  // from it is really "the last 30 rows". The day buckets are the only
  // time-addressed source that is not row-capped.
  assert.match(storeSource, /aggregateProviderUsage\(inputs\.days, window\)/)
  // The day map is read once from the persistent stats payload and then bound,
  // so the card cannot disagree with the headline cards about the same day.
  assert.match(storeSource, /const dayBuckets = \(persistentStats\?\.dailyStats \?\? \{\}\)/)
  assert.match(storeSource, /days: dayBuckets/)
  assert.doesNotMatch(storeSource, /providerSuccessCount|providerTotalCount/,
    'the per-provider loop over request-log rows must not come back')
})

test('a window with no recorded outcomes is not a 0% success rate', () => {
  assert.match(card, /provider\.successRate === undefined \? '-'/)
  assert.match(card, /provider\.avgLatencyMs === undefined \? '-'/)
  assert.doesNotMatch(card, /successCount/,
    'a bare success count cannot express "not recorded"')
})

test('the token and cost cells render "-" when their source has no record', () => {
  // Tokens and money come from the token-day buckets, a different store key with
  // different retention than the request counters - so a provider can be counted
  // in one and absent in the other. Absence must never become 0 tokens or $0.00:
  // "$0.00" is a claim that this period was free.
  assert.match(card, /provider\.tokens === undefined \? \(\s*<p className="font-medium tabular-nums">-<\/p>/)
  assert.match(card, /provider\.tokens\?\.costUsd === undefined \? '-'/)
})

test('money never rounds a cheap day into the "free" string', () => {
  // The one output this column must not produce for a priced model is `$0.00`.
  assert.match(card, /if \(value < 0\.01\) return '<\$0\.01'/)
})

test('the two token pools stay two numbers in the cell', () => {
  // A single sum would read as measured while being mostly `chars/4`.
  assert.match(card, /formatTokens\(provider\.tokens\.upstreamTokens\)/)
  assert.match(card, /\+≈ \{formatTokens\(provider\.tokens\.estimatedTokens\)\}/)
  assert.doesNotMatch(card, /upstreamTokens \+ (provider\.)?tokens\.estimatedTokens/,
    'a merged total erases the difference between reported and estimated')
})

test('the probe latency stays labelled as the probe', () => {
  // It is a property of right now; folding it into the window would present a
  // health check as traffic statistics.
  assert.match(card, /providerWindow\.probeHint/)
  assert.match(card, /Health-check probe latency|健康检查的探测延迟/)
})

test('the token and cost numbers are re-bucketed locally, not refetched', () => {
  // Same reason as the request counters: the period control must not cost an IPC
  // round trip, so the whole day map ships once per refresh.
  assert.match(storeSource, /aggregateProviderTokenUsage\(inputs\.tokenDays, window\)/)
  assert.match(storeSource, /getTokenUsageDays\?\.\(\) \?\? Promise\.resolve\(\{\}\)/)
  // Same shape as the request counters: the whole day map lands in the store
  // once, and the provider card is re-bucketed from that stored copy.
  assert.match(storeSource, /const tokenDayBuckets = \(tokenDays \?\? \{\}\)/)
  assert.match(storeSource, /tokenDays: tokenDayBuckets/)
})

test('changing the period re-buckets without a second fetch', () => {
  assert.match(storeSource, /setProviderWindow: \(window\) => set\(\(state\) => \(\{/)
  assert.match(storeSource, /providers: providerStatsOf\(state\.providerCard, window\)/)
})

test('every window label exists in both shipped locales', () => {
  const keys = ['today', 'days', 'all', 'custom', 'from', 'to', 'invalidRange', 'outcomeFrom', 'outcomeMissing', 'probe', 'probeHint', 'tokenMissing', 'tokenFrom', 'costHint', 'costMissing']

  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(readFileSync(
      join(root, `src/renderer/src/i18n/locales/${locale}.json`),
      'utf8',
    ))

    for (const key of keys) {
      assert.ok(
        typeof messages.dashboard.providerWindow?.[key] === 'string',
        `${locale} has no dashboard.providerWindow.${key}`,
      )
    }
    assert.equal(typeof messages.dashboard.avgResponse, 'string', `${locale} has no dashboard.avgResponse`)
    for (const key of ['tokenTotal', 'cost']) {
      assert.equal(typeof messages.dashboard[key], 'string', `${locale} has no dashboard.${key}`)
    }

    // The cost tooltip is the only place a reader learns that this number is an
    // estimate over a subset of the requests, so both placeholders must survive
    // translation and it must name where the price came from.
    const costHint = messages.dashboard.providerWindow.costHint
    assert.ok(costHint.includes('{{costed}}') && costHint.includes('{{requests}}'),
      `${locale} costHint dropped its denominator`)
    assert.match(costHint, /models\.dev/, `${locale} costHint hides the price source`)
  }
})

test('the custom range editor renders in the card whose presets opened it', () => {
  // 两张卡片共用同一个窗口。以前缓存命中卡只渲染预设、不渲染日期输入，点它的
  // 「自定义」之后日期框只出现在供应商统计里：读者会当成隔壁那张卡的控件，而它
  // 改的其实是这张卡的区间。控件必须跟着它自己的预设行走。
  const readCard = (name) => readFileSync(
    join(root, `src/renderer/src/components/dashboard/${name}.tsx`),
    'utf8',
  )

  const problemsOf = (source) => {
    const problems = []
    if (!/import \{[^}]*StatsWindowRangeInputs[^}]*\} from '\.\/StatsWindowPicker'/.test(source)) {
      problems.push('the card does not import the range editor')
    }
    if (!/<StatsWindowPresets value=\{statsWindow\} onChange=\{onWindowChange\}/.test(source)) {
      problems.push('the card does not render the shared preset row')
    }
    if (!/<StatsWindowRangeInputs\s+value=\{statsWindow\}\s+onChange=\{onWindowChange\}/.test(source)) {
      problems.push('the card renders no range editor bound to its own window')
    }
    return problems
  }

  const cacheCard = readCard('ModelCacheCard')
  assert.deepEqual(problemsOf(cacheCard), [])
  assert.deepEqual(problemsOf(readCard('ProviderStatusCard')), [])

  // 负控：退回「只有预设」的事故形态必须被判红。
  const withoutRange = cacheCard.replace(/<StatsWindowRangeInputs[\s\S]*?\/>/, '')
  assert.deepEqual(problemsOf(withoutRange), ['the card renders no range editor bound to its own window'])
})
