/**
 * 备份件的口令封装（scrypt 派生 + AES-256-GCM）。
 *
 * 为什么不是「直接明文」或「用 store.key 加密」：
 * - 明文：一份含全部上游 Key 与会话 Cookie 的文件躺在下载目录里，任何拿到文件的人
 *   直接可用。导出件的风险级别与 `data.json` 不同 —— 后者在应用数据目录、有文件权限
 *   兜底，前者会被复制到 U 盘、网盘、聊天窗口。
 * - `store.key`：它由本机密钥库封装，**换台机器就解不开**，正好与「跨电脑迁移」的
 *   目的相反。
 *
 * 所以口令由用户给：同一台机器、另一台机器都只用这一个口令就能解。KDF 参数随密文
 * 一起落盘，将来调高成本不会让老备份失效。
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

import {
  BACKUP_SEALED_FORMAT,
  BACKUP_VERSION,
  type SealedBackupFile,
  type SealedBackupPayload,
} from '../../shared/backup.ts'

const KEY_LENGTH = 32
const SALT_LENGTH = 16
const IV_LENGTH = 12
const TAG_LENGTH = 16

/** scrypt 成本：N=16384 / r=8 约 16 MiB 内存、单次约几十毫秒，够挡离线爆破又不惹用户。 */
const SCRYPT_N = 1 << 14
const SCRYPT_R = 8
const SCRYPT_P = 1
/** Node 默认 maxmem 是 32 MiB，N=16384 恰好卡边；显式放宽到 64 MiB 才有余量。 */
const SCRYPT_MAXMEM = 64 * 1024 * 1024

function deriveKey(password: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: SCRYPT_MAXMEM })
}

/** 把一份明文备份封装成口令件。`plaintext` 必须已经是完整的备份 JSON。 */
export function sealBackup(plaintext: string, password: string, now = new Date()): SealedBackupFile {
  if (password === '') throw new Error('sealBackup 需要非空口令')
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  const sealed: SealedBackupPayload = {
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }

  return {
    format: BACKUP_SEALED_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    sealed,
  }
}

/**
 * 解一份口令件。
 *
 * 返回 `null` 表示**口令不对或密文被改过** —— GCM 的认证标签把这两种情况归为同一次
 * 校验失败，刻意不区分：能区分就等于给离线爆破提供「口令对了但文件坏了」的旁路。
 * 结构本身不合法（缺字段、base64 坏掉）抛异常，那是文件问题而不是口令问题。
 */
export function openSealedBackup(file: SealedBackupFile, password: string): string | null {
  const sealed = file.sealed
  const salt = Buffer.from(sealed.salt, 'base64')
  const iv = Buffer.from(sealed.iv, 'base64')
  const tag = Buffer.from(sealed.tag, 'base64')
  if (tag.length !== TAG_LENGTH) throw new Error('备份文件的认证标签长度不合法')

  const key = deriveKey(password, salt, sealed.n || SCRYPT_N, sealed.r || SCRYPT_R, sealed.p || SCRYPT_P)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ])
    return plaintext.toString('utf8')
  } catch {
    return null
  }
}
