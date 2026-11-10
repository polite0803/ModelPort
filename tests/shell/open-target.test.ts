import test from 'node:test'
import assert from 'node:assert/strict'

import { decideWindowOpen } from '../../src/shell/openTarget.ts'

const PAGE = 'http://127.0.0.1:8080/ui/#/channels'

test('an in-app route opened from the page stays in the window', () => {
  // The router writes `#/...`; asking for a new window must not leave the app.
  assert.deepEqual(
    decideWindowOpen(PAGE, 'http://127.0.0.1:8080/ui/#/logs'),
    { kind: 'navigate', path: '/logs' },
  )
  assert.deepEqual(
    decideWindowOpen(PAGE, 'http://127.0.0.1:8080/ui/#/logs?range=7'),
    { kind: 'navigate', path: '/logs?range=7' },
  )
})

test('a path-style link to the same page is the same route', () => {
  assert.deepEqual(
    decideWindowOpen(PAGE, 'http://127.0.0.1:8080/ui/providers'),
    { kind: 'navigate', path: '/providers' },
  )
  assert.deepEqual(
    decideWindowOpen(PAGE, 'http://127.0.0.1:8080/ui/'),
    { kind: 'navigate', path: '/' },
  )
})

test('another origin still goes to the real browser', () => {
  assert.deepEqual(
    decideWindowOpen(PAGE, 'https://github.com/polite0803/ModelPort'),
    { kind: 'external', url: 'https://github.com/polite0803/ModelPort' },
  )
  // Same host, different port is a different origin, hence a different gateway.
  assert.equal(
    decideWindowOpen(PAGE, 'http://127.0.0.1:9090/ui/#/logs').kind,
    'external',
  )
})

test('the same origin but not a page of the UI is not loaded into the window', () => {
  // `/health` in the window would replace the app with JSON.
  assert.equal(decideWindowOpen(PAGE, 'http://127.0.0.1:8080/health').kind, 'external')
  // A protocol-relative URL wearing a route's clothes.
  assert.equal(decideWindowOpen(PAGE, 'http://127.0.0.1:8080/ui/#//evil.example/x').kind, 'external')
})

test('a data: failure page has no origin, so its own retry link loads in place', () => {
  const failure = 'data:text/html;charset=utf-8,%3Ch2%3Egateway%20down%3C%2Fh2%3E'
  assert.deepEqual(
    decideWindowOpen(failure, 'http://127.0.0.1:8080/ui/'),
    { kind: 'load', url: 'http://127.0.0.1:8080/ui/' },
  )
  assert.equal(decideWindowOpen(failure, 'https://github.com/x').kind, 'external')
})

test('anything that is not http(s) never reaches the shell', () => {
  for (const target of ['file:///c:/Windows/System32/calc.exe', 'smb://host/share', 'ms-msdt:/id', 'not a url']) {
    assert.deepEqual(decideWindowOpen(PAGE, target), { kind: 'ignore' }, target)
  }
})