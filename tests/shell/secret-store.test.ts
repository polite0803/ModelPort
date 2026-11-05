import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The shell's keystore-backed secret store.
 *
 * The accident this fences is a silent downgrade: an Electron host without a keystore
 * (Linux without a secret service, a locked-down profile) must not start writing the
 * management secret next to the address book in plaintext. The correct behaviour is to
 * refuse and keep asking, which is what these tests pin - plus that what does land on disk
 * is only ever the sealed blob.
 */
import { dropSecret, getSecret, putSecret, type SecretSealer } from '../../src/shell/secretStore.ts'

const ORIGIN = 'http://127.0.0.1:8080'

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'mp-secrets-')), 'secrets.json')
}

/** base64 of the text with a marker: recognisable, and not the OS keystore. */
const fakeSealer: SecretSealer = {
  available: true,
  encrypt: (text) => `sealed:${Buffer.from(text, 'utf8').toString('base64')}`,
  decrypt: (sealed) => (sealed.startsWith('sealed:') ? Buffer.from(sealed.slice(7), 'base64').toString('utf8') : null),
}

const lockedOutSealer: SecretSealer = { available: false, encrypt: () => '', decrypt: () => null }

test('没有密钥库时拒绝写入，连文件都不创建', () => {
  const path = tempPath()
  assert.equal(putSecret(path, lockedOutSealer, ORIGIN, 'mgmt_x'), 'keystore-unavailable')
  assert.equal(existsSync(path), false, 'refusing must not leave a plaintext file behind')
  assert.deepEqual(getSecret(path, lockedOutSealer, ORIGIN), { status: 'keystore-unavailable' })
})

test('存进去的是封装串，盘上找不到明文', () => {
  const path = tempPath()
  assert.equal(putSecret(path, fakeSealer, ORIGIN, 'mgmt_secret_1'), 'stored')
  const raw = readFileSync(path, 'utf8')
  assert.equal(raw.includes('mgmt_secret_1'), false, 'the secret may never appear in the file')
  assert.deepEqual(getSecret(path, fakeSealer, ORIGIN), { status: 'found', secret: 'mgmt_secret_1' })
})

test('按 origin 分条，换网关不会串口令', () => {
  const path = tempPath()
  putSecret(path, fakeSealer, ORIGIN, 'mgmt_a')
  putSecret(path, fakeSealer, 'https://box:8443', 'mgmt_b')
  assert.equal(getSecret(path, fakeSealer, ORIGIN).secret, 'mgmt_a')
  assert.equal(getSecret(path, fakeSealer, 'https://box:8443').secret, 'mgmt_b')
  assert.deepEqual(getSecret(path, fakeSealer, 'http://other:8080'), { status: 'none' })
})

test('别的用户或机器解不开时报 unreadable，不假装没有', () => {
  const path = tempPath()
  putSecret(path, fakeSealer, ORIGIN, 'mgmt_secret_1')
  const foreign: SecretSealer = { available: true, encrypt: (t) => t, decrypt: () => null }
  assert.deepEqual(getSecret(path, foreign, ORIGIN), { status: 'unreadable' })
})

test('401 之后忘掉，空口令等于忘掉', () => {
  const path = tempPath()
  putSecret(path, fakeSealer, ORIGIN, 'mgmt_secret_1')
  dropSecret(path, ORIGIN)
  assert.deepEqual(getSecret(path, fakeSealer, ORIGIN), { status: 'none' })

  putSecret(path, fakeSealer, ORIGIN, 'mgmt_secret_2')
  assert.equal(putSecret(path, fakeSealer, ORIGIN, '   '), 'stored')
  assert.deepEqual(getSecret(path, fakeSealer, ORIGIN), { status: 'none' })
})

test('口令文件坏了不炸壳，只是没有可取的', () => {
  const path = tempPath()
  writeFileSync(path, '{not json', 'utf8')
  assert.deepEqual(getSecret(path, fakeSealer, ORIGIN), { status: 'none' })
  // and it is still rewritable
  assert.equal(putSecret(path, fakeSealer, ORIGIN, 'mgmt_after'), 'stored')
  assert.deepEqual(getSecret(path, fakeSealer, ORIGIN), { status: 'found', secret: 'mgmt_after' })
})
