/**
 * 备份口令封装（`main/backup/crypto.ts`）。
 *
 * 这里钉的是三件事：
 * 1. 同一个口令在**任何机器**都能解开（KDF 参数随密文走，不依赖本机密钥库）；
 * 2. 口令错了返回 `null` 而不是抛异常，调用方据此提示「口令错误」；
 * 3. 密文被改过同样解不开（GCM 认证标签），不会把半份明文喂给导入流程。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { openSealedBackup, sealBackup } from '../../src/main/backup/crypto.ts'
import { BACKUP_SEALED_FORMAT, parseBackupDocument } from '../../src/shared/backup.ts'

const PLAINTEXT = JSON.stringify({ format: 'modelport-backup', version: 1, data: { providers: [] } })

test('封装后是合法备份文档，且不再含明文内容', () => {
  const sealed = sealBackup(PLAINTEXT, 'correct horse battery staple')
  assert.equal(sealed.format, BACKUP_SEALED_FORMAT)

  const serialized = JSON.stringify(sealed)
  // 外层 `format` 是 `modelport-backup-sealed`，所以只检查明文载荷本身没有泄漏：
  // `data` 键与 `providers` 数组都不该出现在密文文件里。
  assert.ok(!serialized.includes('"data"'))
  assert.ok(!serialized.includes('providers'))

  const parsed = parseBackupDocument(serialized)
  assert.equal(parsed.kind, 'sealed')
})

test('同一口令解开得到逐字节相同的原文', () => {
  const sealed = sealBackup(PLAINTEXT, 'hunter2-hunter2')
  assert.equal(openSealedBackup(sealed, 'hunter2-hunter2'), PLAINTEXT)
})

test('口令错误返回 null（不是抛异常，也不返回半份明文）', () => {
  const sealed = sealBackup(PLAINTEXT, 'right-password')
  assert.equal(openSealedBackup(sealed, 'wrong-password'), null)
})

test('密文被篡改后解不开', () => {
  const sealed = sealBackup(PLAINTEXT, 'pw-12345678')
  const bytes = Buffer.from(sealed.sealed.ciphertext, 'base64')
  bytes[0] ^= 0xff
  const tampered = { ...sealed, sealed: { ...sealed.sealed, ciphertext: bytes.toString('base64') } }
  assert.equal(openSealedBackup(tampered, 'pw-12345678'), null)
})

test('每次封装的盐与 IV 都不同（同内容不会产生同一份密文）', () => {
  const first = sealBackup(PLAINTEXT, 'same-password')
  const second = sealBackup(PLAINTEXT, 'same-password')
  assert.notEqual(first.sealed.salt, second.sealed.salt)
  assert.notEqual(first.sealed.iv, second.sealed.iv)
  assert.notEqual(first.sealed.ciphertext, second.sealed.ciphertext)
})

test('空口令直接拒绝封装', () => {
  assert.throws(() => sealBackup(PLAINTEXT, ''))
})
