import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The Windows-native shell is a *client*, and these fences are what keeps it one.
 *
 * The failure mode being prevented is concrete: a shell that imports gateway modules
 * becomes a second gateway process - two `data.json` writers on one file, two tray
 * icons, two single-instance locks fighting, and the `chat2api -> modelport` profile
 * migration running twice on the same machine. Artifact-level checks are used where
 * possible because that is what actually ships.
 */
const shellMain = readFileSync('src/shell/main.ts', 'utf8')
const shellBundle = join('out', 'main', 'shell.js')

test('the build emits the shell and both of its preloads', () => {
  for (const artifact of [
    shellBundle,
    join('out', 'preload', 'shell-preload.js'),
    join('out', 'preload', 'shell-prompt-preload.js'),
  ]) {
    assert.ok(existsSync(artifact), `${artifact} missing: npm run build must emit the shell entries`)
  }
})

test('the shell bundle carries its own identity and none of the gateway', () => {
  const built = readFileSync(shellBundle, 'utf8')
  assert.match(built, /modelport-shell/, 'userData must be pinned away from the main app profile')
  assert.match(built, /com\.modelport\.shell/, 'a distinct AppUserModelID, or Windows treats the two as one app')
  // Gateway storage markers: if any of these appear, the shell reached into the gateway.
  for (const marker of ['Storage not initialized', 'resolveEncryptionKey', 'planKeySetup', '.modelport/data.json']) {
    assert.ok(!built.includes(marker), `the shell bundle pulled in gateway storage code (${marker})`)
  }
})

test('the shell imports no gateway module tree', () => {
  const shellSources = [
    'src/shell/main.ts',
    'src/shell/addressBook.ts',
    'src/shell/preload.ts',
    'src/shell/promptPreload.ts',
    'src/shell/secretStore.ts',
    // The console supervises a local gateway process; it still never becomes one.
    'src/shell/localGateway.ts',
    'src/shell/localGatewayPlan.ts',
    // The updater is still a client: it reads a release and starts installers, but it
    // must not pull the gateway store into the shell bundle (the test above catches it
    // in the built file; this list makes the failure name the source file).
    'src/shell/updatePlan.ts',
    'src/shell/updater.ts',
  ]
  for (const file of shellSources) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /from ['"]\.\.\/main\//, `${file} must not import from src/main`)
    assert.doesNotMatch(source, /store\/store/, `${file} must not touch the gateway store`)
  }
})

test('closing the shell window never quits the shell', () => {
  // The requirement in one line: the gateway runs in WSL, so losing the view must not
  // look like losing the service - and must not take the tray (and the address book) down.
  // Electron quits on all-closed only when no listener is registered for the event, and the
  // event carries no object (there is no preventDefault to call), so registering one is the
  // whole fix; the fence is that the listener exists and never quits.
  const index = shellMain.indexOf("app.on('window-all-closed'")
  assert.ok(index > 0, 'a window-all-closed listener is what keeps the tray alive')
  assert.doesNotMatch(shellMain.slice(index, index + 220), /app\.quit\(\)/)
  // And the window's own close button hides rather than destroys, while the tray is alive.
  assert.match(shellMain, /if \(!app\.isQuitting && tray\) \{[\s\S]{0,80}event\.preventDefault\(\)[\s\S]{0,60}window\?\.hide\(\)/)
})

test('the prompt dialog prefills with HTML escaping and always settles', () => {
  // Two bugs this line of code actually had:
  // - the value was percent-encoded, but the whole document is *also* encoded for its `data:`
  //   URL, so the address box read back `http%3A%2F%2F127.0.0.1%3A8080` and `normalizeOrigin`
  //   rejected the save - editing a gateway was impossible;
  // - the window's own X button fires no IPC, so the promise stayed pending and its two
  //   `ipcMain.once` listeners stayed behind to swallow the *next* dialog's submit.
  for (const call of shellMain.matchAll(/encodeURIComponent\((\w+)\)/g)) {
    assert.equal(call[1], 'html', 'only a whole document may be percent-encoded, never a value')
  }
  assert.match(shellMain, /escapeHtml\(existing\.url\)/)
  assert.match(shellMain, /escapeHtml\(existing\.name\)/)
  assert.match(shellMain, /escapeHtml\(entry\.name\)/, 'a gateway name is user-typed and lands in page text')
  assert.match(shellMain, /dialog\.on\('closed', \(\) => settle\(null\)\)/)
})

test('the shell forwards renderer failures instead of showing a dark rectangle', () => {
  // Both of the S3 findings were invisible in the log: a page that never mounts, and a
  // renderer process that goes away. The shell writes no app log, so stderr is the channel.
  assert.match(shellMain, /webContents\.on\('console-message'/)
  assert.match(shellMain, /webContents\.on\('render-process-gone'/)
})

test('the address book carries the mode and migrates files written before it', () => {
  const book = readFileSync('src/shell/addressBook.ts', 'utf8')
  for (const kind of ["'local'", "'wsl'", "'remote'"]) {
    assert.ok(book.includes(kind), `the kind union must include ${kind}`)
  }
  // A pre-three-mode file has no `kind`; WSL management was the only opt-in, so it is the
  // only thing recoverable. Anything else is a remote gateway.
  assert.match(book, /manageWsl === true \? 'wsl' : 'remote'/, 'old entries must migrate')
})

test('the console adopts the handshake but never writes the gateway files', () => {
  // Ownership is one-way: the gateway writes status/handshake, the console reads the
  // status and deletes the handshake. A console that wrote them would be a second writer
  // on gateway state - the exact fence this file exists for.
  const client = readFileSync('src/shell/localGateway.ts', 'utf8')
  assert.doesNotMatch(client, /writeFileSync|renameSync/, 'the console must not write gateway files')
  assert.match(client, /rmSync\(handshake/, 'the one-time secret is deleted after adoption')
  assert.doesNotMatch(client, /from ['"]\.\.\/main\//, 'the console must not import gateway modules')
})

test('the secret store keeps only sealed bytes and refuses without a keystore', () => {
  const store = readFileSync('src/shell/secretStore.ts', 'utf8')
  const preload = readFileSync('src/shell/preload.ts', 'utf8')
  assert.match(store, /mode: 0o600/, 'secrets.json holds sealed credentials; the file is still not world-readable')
  assert.equal(
    (store.match(/!sealer\.available/g) ?? []).length,
    2,
    'both read and write must refuse - a missing keystore is never a licence to store plaintext',
  )
  // Named methods only, checked on the bridged object rather than the file: the import line
  // legitimately mentions `ipcRenderer`, while exposing it (or a generic `invoke`) would hand
  // the remote page every shell channel.
  const bridge = preload.slice(preload.indexOf("exposeInMainWorld('modelportShell'"))
  assert.equal(/ipcRenderer\s*[,}]/.test(bridge), false, 'the raw ipcRenderer may not cross the bridge')
  assert.equal(/invoke:|send:/.test(bridge), false, 'no generic invoke/send passthrough')
  assert.match(preload, /getGatewaySecret/)
})

test('the address book refuses non-http origins and never stores a secret', () => {
  const book = readFileSync('src/shell/addressBook.ts', 'utf8')
  assert.match(book, /parsed\.protocol !== 'http:' && parsed\.protocol !== 'https:'/,
    'file://, smb:// and ms-msdt: would hand credentials to a protocol handler')
  assert.doesNotMatch(book, /safeStorage|managementApiSecret/,
    'the management secret belongs to the page in sessionStorage, not to the shell on disk')
})
