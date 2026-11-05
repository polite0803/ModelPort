import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * One method -> channel table, two wires.
 *
 * The whole point of moving the API object out of `preload/index.ts` is that a browser
 * client against a headless daemon cannot grow a second list of channels. Two lists drift,
 * and the drift always shows up as "the switch is on the screen but nothing reads it".
 * These fences are the price of keeping that promise without re-reading 1,000 lines twice.
 */
const api = readFileSync('src/shared/api.ts', 'utf8')
const preload = readFileSync('src/preload/index.ts', 'utf8')
const mainEntry = readFileSync('src/renderer/src/main.tsx', 'utf8')

/** Doc prose may name `ipcRenderer` (it explains what the wire replaced); the code may not. */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter(line => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

test('the API object is built over an injected wire and knows nothing about electron', () => {
  const invocations = api.match(/wire\.invoke\(/g) ?? []
  assert.ok(invocations.length >= 140, `expected the whole method table over the wire, got ${invocations.length}`)
  const code = codeOnly(api)
  assert.doesNotMatch(code, /ipcRenderer/, 'api.ts must not call ipcRenderer in code')
  assert.doesNotMatch(code, /from ['"]electron['"]/, 'api.ts is shared with the browser bundle')
  assert.match(api, /export function createElectronAPI\(wire: ApiWire\)/)
})

test('no generic invoke / send / on is exposed to the UI', () => {
  // The rule that used to live in a preload comment: only named methods cross the bridge.
  // A passthrough would hand every channel - including `accounts:get-all(true)` - to
  // anything running in the page, which cancels out context isolation.
  assert.doesNotMatch(api, /^\s{2}invoke:\s*\(/m, 'a generic invoke passthrough came back')
  assert.doesNotMatch(api, /^\s{2}send:\s*\(/m, 'a generic send passthrough came back')
})

test('preload is the electron wire only, not a second table', () => {
  assert.ok(preload.split('\n').length < 40, 'preload grew a method table again')
  assert.equal((preload.match(/ipcRenderer\.invoke\(/g) ?? []).length, 1, 'exactly one invoke site')
  assert.match(preload, /createElectronAPI\(\{/)
  assert.match(preload, /contextBridge\.exposeInMainWorld\('electronAPI', electronAPI\)/)
})

test('a browser against a daemon installs the headless API and the connect screen', () => {
  assert.match(mainEntry, /const isRemoteGateway = installHeadlessApi\(\)/,
    'the headless API must be installed before React renders')
  assert.match(mainEntry, /<ConnectGate remote=\{isRemoteGateway\}>/)
})
