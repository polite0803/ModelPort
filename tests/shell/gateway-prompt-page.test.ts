import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gatewayPromptPageUrl } from '../../src/shell/gatewayPromptPage.ts'

function decodePage(url: string): string {
  const comma = url.indexOf(',')
  assert.ok(comma > 0, 'the page must be a data: URL with a body')
  return decodeURIComponent(url.slice(comma + 1))
}

test('the cancel button is wired to a function, never called at load', () => {
  // The regression: `onclick = send('cancel')` calls the bridge while parsing and assigns
  // `undefined`, so the dialog cancels itself the moment it opens - "添加网关" looked dead.
  const page = decodePage(gatewayPromptPageUrl({ canUseWsl: true }))
  assert.match(page, /document\.getElementById\('cancel'\)\.onclick = cancel/)
  assert.doesNotMatch(page, /onclick = send\(/)
  assert.match(page, /const cancel = function \(\) \{ send\('cancel'\) \}/)
})

test('save is a click handler that forwards the form values', () => {
  const page = decodePage(gatewayPromptPageUrl({ canUseWsl: true }))
  assert.match(page, /document\.getElementById\('ok'\)\.onclick = function \(\)/)
  assert.match(page, /send\('submit', \{/)
  for (const field of ['name', 'url', 'wslDistro']) {
    assert.ok(page.includes(`${field}: document.getElementById`), `form must submit ${field}`)
  }
  // The mode comes from the select, not from an input's value.
  assert.ok(page.includes('kind: mode.value'))
})

test('prefills are HTML-escaped exactly once', () => {
  const page = decodePage(gatewayPromptPageUrl({
    existing: { name: 'A"<b>&', url: 'http://127.0.0.1:8080', kind: 'remote' },
    canUseWsl: true,
  }))
  assert.ok(page.includes('value="A&quot;&lt;b&gt;&amp;"'), 'name must be attribute-escaped')
  // The address must read back as a real origin: a second URL-encode makes it invalid and
  // saving then fails the origin check.
  assert.ok(page.includes('value="http://127.0.0.1:8080"'))
  assert.ok(!page.includes('http%3A%2F%2F'), 'a prefilled URL must not be percent-encoded')
})

test('the WSL option exists only where the mode can work', () => {
  const win = decodePage(gatewayPromptPageUrl({ canUseWsl: true }))
  assert.match(win, /value="wsl"/)

  const other = decodePage(gatewayPromptPageUrl({ canUseWsl: false }))
  assert.doesNotMatch(other, /value="wsl"/)
})

test('an existing WSL entry falls back to remote where WSL cannot run', () => {
  const page = decodePage(gatewayPromptPageUrl({
    existing: { name: 'w', url: 'http://127.0.0.1:8090', kind: 'wsl', wslDistro: 'Ubuntu-24.04' },
    canUseWsl: false,
  }))
  assert.match(page, /value="remote" selected/)
  assert.doesNotMatch(page, /value="wsl"/)
})

test('the selected mode is the stored one, and the rows follow it', () => {
  const local = decodePage(gatewayPromptPageUrl({ canUseWsl: true }))
  assert.match(local, /value="local" selected/)
  assert.match(local, /id="urlRow"/)
  assert.match(local, /mode\.value === 'local' \? 'none' : 'block'/)
  assert.match(local, /mode\.value === 'wsl' \? 'block' : 'none'/)
})

test('the client https field submits, prefills escaped, and follows the mode', () => {
  const page = decodePage(gatewayPromptPageUrl({
    existing: { name: 'nas', url: 'http://192.168.0.235:18080', kind: 'remote', clientHttpsUrl: 'https://192.168.0.235:8443' },
    canUseWsl: true,
  }))
  assert.ok(page.includes('clientHttpsUrl: document.getElementById'), 'form must submit clientHttpsUrl')
  assert.ok(page.includes('value="https://192.168.0.235:8443"'), 'the stored endpoint must prefill as a real origin')
  assert.match(page, /id="clientHttpsRow"/)
  // Local gateways are loopback: the field hides with the address row, never shown alone.
  const rowToggles = page.match(/mode\.value === 'local' \? 'none' : 'block'/g) ?? []
  assert.ok(rowToggles.length >= 2, 'both urlRow and clientHttpsRow must hide for local')
})

test('the probe button is a click handler, never called at load', () => {
  const page = decodePage(gatewayPromptPageUrl({ canUseWsl: true }))
  assert.match(page, /document\.getElementById\('probeHttps'\)\.onclick = function \(\)/)
  assert.match(page, /window\.promptHost\.probeHttps\(/)
  assert.doesNotMatch(page, /onclick = window\.promptHost/)
})
