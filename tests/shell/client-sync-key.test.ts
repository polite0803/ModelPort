import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The canonical key is the one decision that makes a switch work: a key the target does
 * not accept looks configured in the panel and 401 on the first request. These fences pin
 * the three ways that could happen - an unnormalized address losing the target, a key
 * borrowed from a gateway the target never heard of, and a row that stays silent about
 * the key it could not write.
 */
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const rpc = read('src/shell/clientSyncRpc.ts')
const sync = read('src/shell/clientSync.ts')
const appFiles = [read('src/shell/clientApps.ts'), read('src/shell/clientAppsTools.ts')]

test('every address-book url is normalized before it is requested or compared', () => {
  assert.match(rpc, /import \{ normalizeOrigin \} from '\.\/addressBook\.ts'/)
  assert.match(rpc, /const origin = normalizeOrigin\(entry\.url\) \?\? entry\.url/)
  assert.match(rpc, /keys: await readGatewayKeys\(origin, secret\)/)
  assert.match(rpc, /reachable\.find\(item => item\.origin === activeOrigin\)/)
  assert.match(rpc, /distribution\.find\(item => item\.origin === activeOrigin\)/)
  assert.doesNotMatch(rpc, /readGatewayKeys\(entry\.url/)
  assert.doesNotMatch(rpc, /managementCall\(entry\.url/)
  assert.doesNotMatch(rpc, /entry\.url === activeOrigin/)
})

test('an unreachable target yields no key rather than one borrowed from another gateway', () => {
  const guard = rpc.slice(rpc.indexOf('const active = reachable.find'), rpc.indexOf('const donor ='))
  assert.ok(guard.length > 0, 'the target lookup must precede the donor choice')
  assert.match(guard, /if \(!active\)/)
  assert.match(guard, /key: null/)
  assert.match(guard, /管理面不可用/)
})

test('a key the target refused to accept is not handed to the clients', () => {
  const tail = rpc.slice(rpc.indexOf('const target = distribution.find'))
  assert.ok(tail.length > 0, 'the target write is checked after distribution')
  assert.match(tail, /target\?\.state === 'failed'/)
  assert.match(tail, /key: null/)
})

test('distribution appends and is idempotent, so a second sync grows no key list', () => {
  assert.match(rpc, /keys\.some\(item => item\.key === key\)/)
  assert.match(rpc, /state: 'already'/)
  assert.match(rpc, /const next = \[\.\.\.keys,/)
  assert.match(rpc, /'config:update', \[\{ apiKeys: next \}\]/)
})

test('a row whose key could not be established says so instead of looking finished', () => {
  assert.match(sync, /const NO_KEY_MANUAL_STEP = '没有规范 key/)
  assert.equal(
    sync.split('plan.row.manualStep = NO_KEY_MANUAL_STEP').length - 1,
    2,
    'Qoder/Qoder CN and WorkBuddy share the caveat',
  )
  const codex = sync.slice(sync.indexOf('// --- Codex'), sync.indexOf('// --- Claude Code'))
  assert.match(codex, /if \(key === null &&/)
  // Codex has no key field in its own UI: the caveat must name the field it reads.
  assert.match(codex, /manualStep = '没有规范 key[^']*experimental_bearer_token/)
})

test('every ported writer that writes a key says so on the path where there is none', () => {
  // The invariant is per planner, not per file: a writer that puts KEY_PLACEHOLDER in a
  // config must also explain the case where no canonical key could be established, or the
  // row reads as switched while the client keeps a key the target never issued.
  let checked = 0
  for (const source of appFiles) {
    for (const block of source.split('\nexport function plan').slice(1)) {
      const name = `plan${block.slice(0, block.indexOf('('))}`
      if (!block.includes('KEY_PLACEHOLDER')) continue
      checked += 1
      assert.match(block, /没有规范 key/, `${name} writes a key but is silent when there is none`)
    }
  }
  assert.ok(checked >= 10, `expected the ported writers to be checked, saw ${checked}`)
})

test('a manual step never names a canonical key that may not exist', () => {
  // Trae, CodeBuddy and the ported writers always need a manual key entry when no
  // canonical key exists. Their wording has to be true in both cases.
  for (const line of [...sync.split('\n'), ...appFiles.flatMap(source => source.split('\n'))]) {
    if (!line.includes('规范 key')) continue
    assert.match(line, /没有规范 key/, `wording names a key unconditionally: ${line.trim()}`)
  }
})

test('apply refuses only when there is nothing to write, and never writes the placeholder', () => {
  const apply = sync.slice(sync.indexOf('export async function applySync'))
  assert.match(apply, /if \(plans\.length === 0\) return \{ ok: false/)
  assert.doesNotMatch(apply, /preview\.error && key === null/)
  assert.match(sync, /if \(content\.includes\(KEY_PLACEHOLDER\)\) throw new Error/)
  assert.match(sync, /if \(written\.includes\(KEY_PLACEHOLDER\)\) throw new Error/)
})