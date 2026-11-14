import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Access-path data lives on the shell entry, never derived from the gateway: the same
 * gateway is `https://<ip>:8443` reached directly but `https://<domain>` (443, a public
 * edge cert) through a proxy, and the gateway cannot tell those apart. These fences pin
 * the three places that could re-introduce the blind derivation - the entry whitelist
 * dropping the stored value, the switch asking the gateway again, and the probe result
 * being consumed anywhere but the form.
 */
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const book = read('src/shell/addressBook.ts')
const sync = read('src/shell/clientSync.ts')
const rpc = read('src/shell/clientSyncRpc.ts')
const main = read('src/shell/main.ts')
const preload = read('src/shell/promptPreload.ts')

test('readBook and upsertEntry both carry clientHttpsUrl (the whitelist drops what it does not name)', () => {
  assert.match(book, /clientHttpsUrl\?: string/)
  // readBook reconstructs entries field by field: a value absent from this map is lost
  // on the next read, so the field must appear in the reconstruction, not just the type.
  const readMap = book.slice(book.indexOf('export function readBook'), book.indexOf('export function writeBook'))
  assert.match(readMap, /clientHttpsUrl !== undefined \? \{ clientHttpsUrl \}/)
  assert.match(readMap, /readClientHttpsUrl\(entry\)/)
  // Only an https origin is a usable client endpoint; an http value is dropped, not kept.
  const reader = book.slice(book.indexOf('function readClientHttpsUrl'), book.indexOf('export function readBook'))
  assert.match(reader, /startsWith\('https:'\)/)
  // Both upsert branches: update reconstructs the entry (clearing the field removes it),
  // create starts from scratch.
  assert.match(book, /if \(clientHttpsUrl !== undefined\) next\.clientHttpsUrl = clientHttpsUrl/)
  assert.match(book, /if \(clientHttpsUrl !== undefined\) created\.clientHttpsUrl = clientHttpsUrl/)
})

test('the switch reads the entry, never asks the gateway for its https listener', () => {
  assert.doesNotMatch(sync, /readGatewayHttpsOrigin/)
  assert.match(sync, /input\.active\.clientHttpsUrl/)
  // An https entry is its own endpoint; the stored value only matters for http entries.
  assert.match(sync, /origin\.startsWith\('https:'\)/)
  assert.match(sync, /clientHttpsUrl,\n/)
})

test('readGatewayHttpsOrigin survives only as the form prober', () => {
  assert.match(rpc, /export async function readGatewayHttpsOrigin/)
  assert.match(rpc, /One-shot form prober/)
  // The only importer is the dialog wiring in main; the switch path must not reach it.
  assert.match(main, /readGatewayHttpsOrigin/)
  const probeHandler = main.slice(main.indexOf("ipcMain.handle('shell:prompt-probe-https'"), main.indexOf('void dialog.loadURL'))
  assert.ok(probeHandler.length > 0, 'the probe handler must live inside promptForGateway')
  assert.match(probeHandler, /readGatewayHttpsOrigin\(origin, found\.secret/)
  // An https entry is its own endpoint: probing it would suggest the gateway's own
  // httpsPort, wrong for a path that terminates TLS elsewhere.
  assert.match(probeHandler, /origin\.startsWith\('https:'\)/)
  assert.match(main, /ipcMain\.removeHandler\('shell:prompt-probe-https'\)/)
  assert.match(preload, /probeHttps/)
  assert.match(preload, /ipcRenderer\.invoke\('shell:prompt-probe-https', url\)/)
})

test('the dialog validates the stored endpoint as an https origin before settling', () => {
  const submit = main.slice(main.indexOf("ipcMain.once('shell:prompt-submit'"), main.indexOf("ipcMain.once('shell:prompt-cancel'"))
  assert.match(submit, /clientHttpsUrl\?: string/)
  assert.match(submit, /httpsOrigin\.startsWith\('https:'\)/)
  assert.match(submit, /clientHttpsUrl !== undefined \? \{ clientHttpsUrl \}/)
  // The edit dialog prefills the stored value, or the field would silently clear on save.
  assert.match(main, /existing\.clientHttpsUrl !== undefined \? \{ clientHttpsUrl: existing\.clientHttpsUrl \}/)
})