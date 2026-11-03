import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createHandshakeRejectionTracker,
  isCertificateRejection,
} from '../../src/main/proxy/tls.ts'

/**
 * 客户端在 TLS 握手里拒掉证书时，请求根本进不到路由：没有请求日志行、没有 X-Request-Id，
 * 用户侧只看到「连不上」。这里钉的是网关唯一能留下的那条证据 —— 记账与文案。
 */

function harness(dedupWindowMs = 30_000, selfSigned = true) {
  const lines: { level: string; message: string }[] = []
  const tracker = createHandshakeRejectionTracker({
    startedAt: 1_000,
    certPath: 'C:\\fake\\server.crt',
    selfSigned,
    log: (level, message) => lines.push({ level, message }),
    dedupWindowMs,
  })
  return { lines, tracker }
}

test('a certificate-naming code states the certificate problem and the Node path', () => {
  const { lines, tracker } = harness()
  tracker.record('DEPTH_ZERO_SELF_SIGNED_CERT', 2_000)

  assert.equal(lines.length, 1)
  assert.equal(lines[0].level, 'warn')
  assert.match(lines[0].message, /DEPTH_ZERO_SELF_SIGNED_CERT/)
  assert.match(lines[0].message, /This code names a certificate problem/)
  assert.match(lines[0].message, /NODE_EXTRA_CA_CERTS=C:\\fake\\server\.crt/)
  assert.match(lines[0].message, /no request was logged/)
  assert.equal(tracker.stats().total, 1)
  assert.deepEqual(tracker.stats().byCode, [
    { code: 'DEPTH_ZERO_SELF_SIGNED_CERT', count: 1, certificate: true },
  ])
})

/**
 * 实测：客户端因为不信任我们而发出的告警，到服务端只剩 ECONNRESET。
 * 所以这里不许把话说过——不能说「这个码证明证书被拒」，只能给「最先怀疑」的层次。
 */
test('a bare ECONNRESET on a self-signed listener hints at trust without claiming it', () => {
  const { lines, tracker } = harness()
  tracker.record('ECONNRESET', 2_000)

  assert.equal(lines.length, 1)
  assert.match(lines[0].message, /HTTPS handshake aborted before any request: ECONNRESET/)
  assert.doesNotMatch(lines[0].message, /This code names a certificate problem/)
  assert.match(lines[0].message, /first suspect is the client's own certificate verification/)
  assert.match(lines[0].message, /NODE_EXTRA_CA_CERTS=C:\\fake\\server\.crt/)
  assert.match(lines[0].message, /check the URL scheme against the port/)
  assert.equal(tracker.stats().byCode[0].certificate, false)
})

test('a CA-signed listener does not get told to suspect its own certificate', () => {
  const { lines } = harness(30_000, false)
  lines.length = 0
  const tracker = createHandshakeRejectionTracker({
    startedAt: 1_000,
    certPath: '/etc/ssl/real.crt',
    selfSigned: false,
    log: (level, message) => lines.push({ level, message }),
  })
  tracker.record('ECONNRESET', 2_000)

  assert.doesNotMatch(lines[0].message, /self-signed certificate/)
  assert.doesNotMatch(lines[0].message, /NODE_EXTRA_CA_CERTS/)
  assert.match(lines[0].message, /check the URL scheme against the port/)
})

test('a protocol rejection is never worded as a trust problem', () => {
  const { lines, tracker } = harness(30_000, false)
  tracker.record('ERR_SSL_WRONG_VERSION_NUMBER', 2_000)

  assert.equal(lines.length, 1)
  assert.doesNotMatch(lines[0].message, /NODE_EXTRA_CA_CERTS/)
  assert.match(lines[0].message, /check the URL scheme against the port/)
  assert.equal(tracker.stats().byCode[0].certificate, false)
})

test('repeats inside the dedup window are counted, not re-logged', () => {
  const { lines, tracker } = harness(10_000)
  for (let i = 0; i < 5; i += 1) tracker.record('SELF_SIGNED_CERT_IN_CHAIN', 2_000 + i * 100)

  assert.equal(lines.length, 1, 'a retrying client must not write one app-log line per attempt')
  assert.doesNotMatch(lines[0].message, /of this code since the listener started/)
  assert.equal(tracker.stats().total, 5)
  assert.equal(tracker.stats().byCode[0].count, 5)
  assert.equal(tracker.stats().lastAt, 2_400)
})

test('the window reopens for the next burst, and a different code logs on its own', () => {
  const { lines, tracker } = harness(10_000)
  tracker.record('UNKNOWN_CA', 2_000)
  tracker.record('UNKNOWN_CA', 3_000)
  tracker.record('UNKNOWN_CA', 12_001)
  tracker.record('EPROTO', 12_002)

  assert.equal(lines.length, 3)
  assert.match(lines[1].message, /3 of this code since the listener started/)
  assert.equal(tracker.stats().byCode.length, 2)
})

test('stats() hands out a fresh snapshot every call', () => {
  const { tracker } = harness()
  tracker.record('UNKNOWN_CA', 2_000)
  const first = tracker.stats()
  first.total = 999
  first.byCode.push({ code: 'FAKE', count: 1, certificate: false })
  first.byCode[0].count = 42

  const second = tracker.stats()
  assert.equal(second.total, 1)
  assert.equal(second.byCode.length, 1)
  assert.equal(second.byCode[0].count, 1)
})

test('the rejection families cover the codes Node reports for an untrusted leaf', () => {
  for (const code of [
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNKNOWN_CA',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_HAS_EXPIRED',
  ]) {
    assert.equal(isCertificateRejection(code), true, code)
  }
  assert.equal(isCertificateRejection('eproto'), false)
  assert.equal(isCertificateRejection(''), false)
})
