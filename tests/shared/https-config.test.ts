import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildHttpsUrl,
  buildProxyUrl,
  formatHostForUrl,
  validateHttpsConfig,
} from '../../src/shared/httpsConfig.ts'

test('HTTPS port must stay inside 1-65535 and be an integer', () => {
  assert.deepEqual(validateHttpsConfig({}), [])
  assert.deepEqual(validateHttpsConfig({ httpsPort: 8443 }), [])
  assert.ok(validateHttpsConfig({ httpsPort: 0 }).length > 0)
  assert.ok(validateHttpsConfig({ httpsPort: 70000 }).length > 0)
  assert.ok(validateHttpsConfig({ httpsPort: 8443.5 }).length > 0)
})

test('enabled HTTPS cannot share the proxy port, disabled may', () => {
  assert.deepEqual(validateHttpsConfig({ httpsEnabled: true, proxyPort: 8443, httpsPort: 8443 }), [
    'HTTPS port must differ from the proxy port',
  ])
  assert.deepEqual(validateHttpsConfig({ httpsEnabled: false, proxyPort: 8443, httpsPort: 8443 }), [])
})

test('custom certificate and key are all-or-nothing', () => {
  assert.deepEqual(validateHttpsConfig({ httpsCertPath: '/tmp/a.crt' }), [
    'HTTPS certificate and key must be provided together',
  ])
  assert.deepEqual(validateHttpsConfig({ httpsKeyPath: '/tmp/a.key' }), [
    'HTTPS certificate and key must be provided together',
  ])
  assert.deepEqual(
    validateHttpsConfig({ httpsCertPath: '/tmp/a.crt', httpsKeyPath: '/tmp/a.key' }),
    [],
  )
  assert.deepEqual(
    validateHttpsConfig({ httpsCertPath: '   ', httpsKeyPath: '' }),
    [],
  )
})

test('URL helpers keep IPv6 hosts bracketed', () => {
  assert.equal(formatHostForUrl('127.0.0.1'), '127.0.0.1')
  assert.equal(formatHostForUrl('::1'), '[::1]')
  assert.equal(formatHostForUrl('[::1]'), '[::1]')
  assert.equal(buildHttpsUrl('127.0.0.1', 8443), 'https://127.0.0.1:8443')
  assert.equal(buildHttpsUrl('::1', 8443), 'https://[::1]:8443')
  assert.equal(buildProxyUrl('localhost', 8080, false), 'http://localhost:8080')
  assert.equal(buildProxyUrl('::1', 8443, true), 'https://[::1]:8443')
})
