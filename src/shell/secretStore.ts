/**
 * The shell's copy of the management secrets, one per gateway origin.
 *
 * Why this exists at all: the page keeps the secret in `sessionStorage`, which is correct for
 * a browser tab and wrong for a desktop client whose entire job is to connect back to a
 * gateway. Re-pasting a 40-character secret every launch is not a security win - it is friction
 * that trains the operator to keep the secret in a text file instead.
 *
 * What this file guarantees, independent of Electron:
 * - nothing is ever written in plaintext. Without a keystore (`sealer.available === false`) the
 *   answer is `keystore-unavailable` and the file is untouched; the UI then keeps asking each
 *   start, which is the honest failure, not a silent downgrade;
 * - the blob is sealed by the OS for the current user, so a copy of this file on another
 *   machine or another Windows account decrypts to nothing and reports `unreadable`;
 * - secrets live here, not in the address book: `gateways.json` stays free of credentials, and
 *   the fence that says so keeps its teeth.
 *
 * The file itself is mode 0600 and holds only sealed base64.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** The OS-bound half, injected so this layer is testable without Electron. */
export interface SecretSealer {
  available: boolean
  encrypt(text: string): string
  /** `null` when the blob was sealed for a different user or machine. */
  decrypt(sealed: string): string | null
}

export type SecretLookup =
  | { status: 'found'; secret: string }
  | { status: 'none' }
  | { status: 'unreadable' }
  | { status: 'keystore-unavailable' }

export type SecretWrite = 'stored' | 'keystore-unavailable'

type SecretFile = Record<string, string>

function readSecretFile(filePath: string): SecretFile {
  if (!existsSync(filePath)) return {}
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const entries = Object.entries(raw as Record<string, unknown>)
    const sealed: SecretFile = {}
    for (const [origin, value] of entries) {
      if (typeof value === 'string') sealed[origin] = value
    }
    return sealed
  } catch {
    // A corrupt secret file must not brick the shell: start empty, the operator re-enters.
    return {}
  }
}

function writeSecretFile(filePath: string, file: SecretFile): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 })
}

export function getSecret(filePath: string, sealer: SecretSealer, origin: string): SecretLookup {
  if (!sealer.available) return { status: 'keystore-unavailable' }
  const sealed = readSecretFile(filePath)[origin]
  if (sealed === undefined) return { status: 'none' }
  const secret = sealer.decrypt(sealed)
  if (secret === null) return { status: 'unreadable' }
  return { status: 'found', secret }
}

export function putSecret(
  filePath: string,
  sealer: SecretSealer,
  origin: string,
  secret: string,
): SecretWrite {
  if (!sealer.available) return 'keystore-unavailable'
  const trimmed = secret.trim()
  if (trimmed === '') {
    // An empty secret is "nothing to remember": drop the row rather than sealing a blank.
    dropSecret(filePath, origin)
    return 'stored'
  }
  const file = readSecretFile(filePath)
  file[origin] = sealer.encrypt(trimmed)
  writeSecretFile(filePath, file)
  return 'stored'
}

export function dropSecret(filePath: string, origin: string): void {
  const file = readSecretFile(filePath)
  if (!(origin in file)) return
  delete file[origin]
  writeSecretFile(filePath, file)
}
