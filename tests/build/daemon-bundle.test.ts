import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The headless daemon (WSL and friends) is a second, independent artifact, so it
 * needs its own fence with the same teeth as `main-bundle-deps.test.ts`:
 *
 * 1. no `electron` may be reachable in the bundle. esbuild happily inlines
 *    `node_modules/electron/index.js` (a launcher stub that only exports a binary
 *    path under Node), so a stray `import { app } from 'electron'` would still
 *    **build** and then die at runtime with `app.getVersion is not a function`.
 *    The only durable check is against the built bundle plus the sources' imports.
 * 2. every runtime dependency must be inlined. The daemon tarball carries no
 *    `node_modules` either - that is the 1.4.5 `electron-store` failure mode, and
 *    it applies unchanged to a non-Electron host.
 * 3. the resources next to the bundle must actually be there: an empty resource
 *    root means "13 account channels missing", not "feature degraded".
 *
 * `npm run gate` builds this artifact, so a missing bundle is a hard failure here
 * rather than a skip.
 */
const BUNDLE = join('out', 'daemon', 'modelport-daemon.cjs')

/** Drops doc/line comments so the fences below judge call forms, not prose. */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

test('the daemon bundle exists (npm run gate builds it)', () => {
  assert.ok(
    existsSync(BUNDLE),
    'out/daemon/modelport-daemon.cjs is missing: run `npm run build:daemon`',
  )
})

test('the daemon bundle cannot reach electron', () => {
  const bundle = readFileSync(BUNDLE, 'utf8')
  const refs = [
    ...bundle.matchAll(/require\(\s*["']electron["']\s*\)/g),
    ...bundle.matchAll(/__require\(\s*["']electron["']\s*\)/g),
  ]
  assert.equal(refs.length, 0, 'a bundled require("electron") only crashes at runtime on WSL')
  assert.ok(
    !/__MODELPORT_VERSION__/.test(bundle),
    'the version define was not applied: the daemon would report a dangling identifier',
  )
})

test('the gateway closure imports no electron (host bindings are the only seam)', () => {
  // These five files were the whole closure's electron surface. Any new import here
  // means the daemon has to be rebuilt against a mock, which is what S1 removed.
  //
  // Matched against code, not prose: a comment may legitimately describe where
  // electron-builder puts `channel-pack` in a packaged app, and a *call form* is the
  // judgement here - scanning prose only manufactures false reds.
  const closure = [
    'src/main/proxy/server.ts',
    'src/main/store/store.ts',
    'src/main/channelPack/bridge.ts',
    'src/main/providers/accountChannels/manager.ts',
    'src/main/providers/modelCatalogStore.ts',
    'src/main/runtime/host.ts',
    'src/main/daemon/entry.ts',
    // The whole IPC surface is host-neutral now, which is what lets the daemon serve
    // `/v1/management/rpc` off the same table the shell feeds over IPC.
    'src/main/ipc/handlers.ts',
    'src/main/ipc/registry.ts',
    'src/main/proxy/routes/management/rpc.ts',
    'src/main/logging/diagnosticBundle.ts',
    'src/main/oauth/manager.ts',
    'src/main/oauth/adapters/base.ts',
  ]
  for (const file of closure) {
    const source = codeOnly(readFileSync(file, 'utf8'))
    assert.doesNotMatch(
      source,
      /from ['"]electron['"]/,
      `${file} must not import electron: route it through src/main/runtime/host.ts`,
    )
    assert.doesNotMatch(
      source,
      /\bsafeStorage\./,
      `${file} must not call safeStorage directly: use getHost().sealer`,
    )
    assert.doesNotMatch(
      source,
      /process\.resourcesPath/,
      `${file} must not read process.resourcesPath: use hostResourceRoot()`,
    )
  }
})

test('the daemon keeps the storage dependency inlined and electron-store retired', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  assert.ok(pkg.dependencies?.conf, 'conf must stay a runtime dependency (store.ts loads it)')
  assert.equal(
    pkg.dependencies?.['electron-store'],
    undefined,
    'electron-store must stay retired: its top-level electron destructure breaks a headless host',
  )
  assert.match(
    pkg.scripts?.gate ?? '',
    /build:daemon/,
    'the gate must build the daemon, otherwise these fences go stale silently',
  )
})

test('the desktop-only set is exactly these files', () => {
  // A creep in this list is only acceptable when the file is genuinely window / tray /
  // installer work: anything reachable from the gateway closure also fails the bundle
  // assertion above, which is harder to read than this one, so the two gates point at
  // each other. Scanned with fs (not `git grep`) because untracked new files must count.
  const walk = (dir: string, into: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, into)
      else if (entry.name.endsWith('.ts') && /from ['"]electron['"]/.test(readFileSync(path, 'utf8'))) {
        into.push(path.replace(/\\/g, '/'))
      }
    }
    return into
  }
  const found = walk('src/main').sort()
  const expected = [
    'src/main/autostartHost.ts',
    // `backup/ipc.ts` left this set when its six channels moved from `ipcMain.handle` to the
    // handler registry: it no longer imports electron, and the headless host registers them.
    //
    // The three role entries joined in the three-mode change: the orchestrator
    // (`index.ts`) is a pure argv switch and no longer imports electron itself, while the
    // gateway entry, its windowless host and the retired desktop host do.
    'src/main/desktop/entry.ts',
    'src/main/gateway/entry.ts',
    'src/main/ipc/trustedSender.ts',
    'src/main/logging/crashReporter.ts',
    'src/main/runtime/electronGatewayHost.ts',
    'src/main/runtime/electronHost.ts',
    'src/main/tray/TrayManager.ts',
    'src/main/tray/TrayWindow.ts',
    'src/main/updater/UpdaterManager.ts',
    'src/main/window/manager.ts',
  ]
  assert.deepEqual(found, expected, 'electron importers changed: route new gateway work through runtime/host.ts')
})

test('the runtime assets ship next to the daemon bundle', () => {
  for (const rel of [
    join('out', 'daemon', 'resources', 'channel-pack', 'worker.mjs'),
    join('out', 'daemon', 'resources', 'catalog'),
  ]) {
    assert.ok(existsSync(rel), `${rel} is missing: npm run build:channel-pack must precede build:daemon`)
  }
})
