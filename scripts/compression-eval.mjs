#!/usr/bin/env node
/**
 * Token-compression corpus and fidelity readout — the prerequisite for D.
 *
 * D means changes that rewrite meaning, not just shorten it: a second model
 * writing summaries, or tool schemas reshaped before they reach the upstream.
 * Those cannot be judged by a unit test, because "still correct" is a property
 * of a real conversation. So D opens only after two things exist:
 *
 *   1. a corpus built from *actual* traffic (a summariser tested on invented
 *      logs says nothing about the traffic this install sees);
 *   2. a fidelity metric that needs no model call, so it can run on every
 *      candidate change without spending anything.
 *
 * The judgements live in `src/main/proxy/compression/evalCorpus.ts` (type-checked
 * by the gate, tested by `tests/compression/evalCorpus.test.ts`); this file is
 * the file I/O around them.
 *
 *   # 1. capture — pull real request bodies out of a gateway's logs
 *   node scripts/compression-eval.mjs capture \
 *     --from-data ~/.modelport/data.json --out /tmp/mp-corpus.jsonl
 *   node scripts/compression-eval.mjs capture \
 *     --from-logs ~/.modelport/request-logs/request-logs.ndjson --out /tmp/mp-corpus.jsonl
 *
 *   # 2. replay — run the shipped pipeline over that corpus, twice
 *   node scripts/compression-eval.mjs replay --corpus /tmp/mp-corpus.jsonl
 *   node scripts/compression-eval.mjs replay --corpus /tmp/mp-corpus.jsonl --fold
 *
 * `capture` needs bodies to have been stored: `requestLogConfig.includeBodies`,
 * a per-request `X-ModelPort-Trace: 1`, or the sampling knob
 * `requestLogConfig.bodySampleRate`. Rows without a `requestBody` are counted
 * and reported, never silently skipped. Note that `data.json` usually carries no
 * rows at all — the manager migrated them to `request-logs/request-logs.ndjson`
 * — so `--from-data` falls back to that sibling file when it finds an empty
 * list, and says so. The log stores the **client's** body as the route saw it,
 * which is pre-compression, so replaying the pipeline over it is a real
 * measurement rather than a no-op on already-rewritten text.
 *
 * What this script does NOT measure is whether the model still does the work.
 * That needs an A/B on live traffic read through the existing degraded-success
 * classes (`streamTrace.repetition` / `.emptyTurn`); the criterion is in
 * `docs/design/PLAN-token-compression.md` §D.
 *
 * Exit code is non-zero when a pointer cannot be followed, bytes are lost, or
 * tool pairing broke — so this can sit in a loop over candidate changes.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  captureFromLogRows,
  describeCorpus,
  evaluateCorpus,
} from '../src/main/proxy/compression/evalCorpus.ts'
import { CcrStore, setCcrStore } from '../src/main/proxy/compression/ccr/store.ts'

const args = process.argv.slice(2)
const command = args[0]
const opt = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const flag = name => args.includes(name)

function usage(message) {
  if (message) console.error(`${message}\n`)
  console.error('usage:')
  console.error('  node scripts/compression-eval.mjs capture --from-data <data.json> [--out <corpus.jsonl>]')
  console.error('  node scripts/compression-eval.mjs capture --from-logs <request-logs.ndjson> [--out <corpus.jsonl>]')
  console.error('  node scripts/compression-eval.mjs replay --corpus <corpus.jsonl> [--fold] ' +
    '[--aggressiveness conservative|moderate|aggressive] [--verbose]')
  process.exit(message ? 1 : 0)
}

/**
 * Where the rows actually live.
 *
 * `data.json` names a `requestLogs` key, but the manager migrates those rows into
 * `request-logs/request-logs.ndjson` and empties the key — so reading the conf
 * file alone reports "0 rows" on a gateway with weeks of traffic. The fallback
 * follows the sibling file and says so, because a corpus that silently came from
 * a different file than the one named on the command line is a misleading
 * provenance line.
 */
function loadLogRows(fromData, fromLogs) {
  if (fromLogs) {
    const text = readFileSync(fromLogs, 'utf8').trim()
    const rows = text
      ? text.split('\n').filter(Boolean).map(line => JSON.parse(line))
      : []
    return { logRows: rows, source: fromLogs, note: null, logConfig: null }
  }

  const raw = JSON.parse(readFileSync(fromData, 'utf8'))
  const logRows = Array.isArray(raw) ? raw : Array.isArray(raw?.requestLogs) ? raw.requestLogs : null
  if (!logRows) usage(`${fromData} is neither a request-log array nor a ModelPort data.json (no requestLogs key)`)
  const logConfig = raw?.config?.requestLogConfig ?? null
  if (logRows.length > 0) return { logRows, source: fromData, note: null, logConfig }

  const sibling = join(dirname(fromData), 'request-logs', 'request-logs.ndjson')
  if (!existsSync(sibling)) return { logRows, source: fromData, note: null, logConfig }
  const text = readFileSync(sibling, 'utf8').trim()
  if (!text) return { logRows, source: fromData, note: `no rows here; ${sibling} is empty too`, logConfig }
  return {
    logRows: text.split('\n').filter(Boolean).map(line => JSON.parse(line)),
    source: sibling,
    note: `${fromData} carries no rows (they were migrated); read ${sibling}`,
    logConfig,
  }
}

function capture() {
  const fromData = opt('--from-data')
  const fromLogs = opt('--from-logs')
  const out = opt('--out', join(tmpdir(), 'mp-corpus.jsonl'))
  if (!fromData && !fromLogs) usage('capture needs --from-data <data.json> or --from-logs <request-logs.ndjson>')

  const { logRows, source, note, logConfig } = loadLogRows(fromData, fromLogs)

  const { rows, stats } = captureFromLogRows(logRows)
  writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''), 'utf8')

  const description = describeCorpus(rows)
  const buckets = [0, 4 * 1024, 32 * 1024, 256 * 1024, Infinity]
  const labels = ['<4 KB', '4-32 KB', '32-256 KB', '>256 KB']

  console.log(`corpus written: ${out}`)
  console.log(`  log source          ${source}`)
  if (note) console.log(`  source note         ${note}`)
  // The corpus has to state its own selection: a 5% sample and a full capture
  // support different claims about coverage.
  if (logConfig) {
    const basis = logConfig.includeBodies === true
      ? 'every request (includeBodies)'
      : `sampled ${Math.round((logConfig.bodySampleRate ?? 0) * 100)}% of requests, bodies kept ${logConfig.bodyRetentionDays ?? 7}d`
    console.log(`  capture basis       ${basis}`)
  }
  console.log(`  log rows            ${stats.scanned}`)
  console.log(`  carried a body      ${stats.withBody}`)
  console.log(`  unparsable          ${stats.unparsable}`)
  console.log(`  single-turn (skip)  ${stats.tooShort}`)
  console.log(`  kept                ${rows.length}`)
  console.log(`  with tools          ${description.withTools}`)
  // Which content classes the corpus actually covers: a summariser judged on a
  // corpus with no source_code or build_output sample is judged on the easy half.
  console.log('  request size        ' + labels.map((label, index) => {
    const count = description.sizes.filter(size => size >= buckets[index] && size < buckets[index + 1]).length
    return `${label}: ${count}`
  }).join('  '))
  console.log('  content mix         ' + description.mix.map(entry => `${entry.type}: ${entry.rows}`).join('  '))

  if (rows.length === 0) {
    console.error('\n0 usable rows: give the gateway bodies to keep first — ' +
      '`requestLogConfig.includeBodies`, a per-request `X-ModelPort-Trace: 1`, or ' +
      '`requestLogConfig.bodySampleRate` (e.g. 0.1) — then retry.')
    process.exit(1)
  }
}

function replay() {
  const corpusPath = opt('--corpus')
  if (!corpusPath) usage('replay needs --corpus <path to corpus.jsonl>')
  const aggressiveness = opt('--aggressiveness', 'moderate')
  const fold = flag('--fold')
  const verbose = flag('--verbose')

  const rows = readFileSync(corpusPath, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line))

  const dir = mkdtempSync(join(tmpdir(), 'mp-eval-ccr-'))
  const store = new CcrStore({ dir })
  setCcrStore(store)

  let report
  try {
    report = evaluateCorpus(rows, {
      config: {
        enabled: true,
        aggressiveness,
        // The question is what the pipeline can do; the per-provider cache
        // economics are a separate gate and would hide the measurement here.
        cacheFirst: false,
      },
      fold,
      stash: (original, idLength) => store.put(original, idLength),
      resolve: hash => store.get(hash),
    })
  } finally {
    setCcrStore(undefined)
    rmSync(dir, { recursive: true, force: true })
  }

  const { totals } = report
  const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : 'n/a')

  if (verbose) {
    for (const row of report.rows) {
      const applied = row.applied.join(',') || 'untouched'
      console.log(`  ${String(row.id ?? '?').slice(0, 12).padEnd(12)} ${applied.padEnd(18)} ` +
        `${row.bytesIn} B → ${row.bytesOut} B  markers ${row.markers}/${row.resolvable} resolvable`)
    }
    console.log('')
  }

  console.log(`corpus: ${corpusPath}  (${totals.rows} rows)`)
  console.log(`aggressiveness: ${aggressiveness}   fold: ${fold ? 'on' : 'off'}   cacheFirst: off`)
  console.log('')
  console.log(`rows rewritten        ${totals.rewritten} / ${totals.rows}  (${pct(totals.rewritten, totals.rows)})`)
  if (totals.tokensBefore > 0) {
    const saved = totals.tokensBefore - totals.tokensAfter
    console.log(`tokens before/after   ${totals.tokensBefore} → ${totals.tokensAfter}  ` +
      `(saved ${saved}, ${pct(saved, totals.tokensBefore)})`)
  } else {
    // Fold-only runs never touch the live zone, so the token ledger stays empty.
    // Printing "0 → 0" there would read as "compression did nothing".
    console.log('tokens before/after   n/a (no live-zone rewrite in this corpus)')
  }
  console.log(`bytes in/out          ${totals.bytesIn} → ${totals.bytesOut}  ` +
    `(${pct(totals.bytesIn - totals.bytesOut, totals.bytesIn)} smaller)`)
  console.log(`markers emitted       ${totals.markers}`)
  console.log(`markers resolvable    ${totals.resolvable} / ${totals.markers}` +
    (totals.resolvable === totals.markers ? '  (every pointer follows)' : '  UNREACHABLE POINTERS'))
  console.log(`unrecoverable bytes   ${totals.unrecoverable}` +
    (totals.unrecoverable === 0 ? '  (in prompt + behind markers = original)' : '  TEXT LOST'))
  console.log(`tool pairing breaks   ${totals.pairingBreaks}` +
    (totals.pairingBreaks === 0 ? '  (every tool_call_id still matched)' : '  SCHEMA BROKEN'))
  if (fold) {
    console.log(`folded                ${totals.foldedMessages} messages / ${totals.foldedChars} chars`)
  }
  if (report.byType.length > 0) {
    console.log('')
    console.log('per content type      rows  tokens before → after   saved')
    for (const entry of report.byType) {
      console.log(`  ${entry.type.padEnd(20)} ${String(entry.rows).padStart(4)}  ` +
        `${String(entry.tokensBefore).padStart(9)} → ${String(entry.tokensAfter).padStart(8)}   ` +
        pct(entry.tokensBefore - entry.tokensAfter, entry.tokensBefore))
    }
  }

  if (totals.resolvable !== totals.markers || totals.unrecoverable > 0 || totals.pairingBreaks > 0) {
    process.exitCode = 1
  }
}

if (command === 'capture') capture()
else if (command === 'replay') replay()
else usage('expected a subcommand')