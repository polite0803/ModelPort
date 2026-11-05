/**
 * Store-key setup decisions and post-migration checks.
 * Pure helpers: the Electron/safeStorage IO lives in store.ts, these do not touch it.
 */

export type KeyPlan = 'unencrypted' | 'reuse' | 'migrate' | 'create' | 'sealed-unreadable'

export interface KeyPlanInput {
  keystoreAvailable: boolean
  keyFileExists: boolean
  dataFileExists: boolean
}

/**
 * - `unencrypted`: no OS keystore, so there is no key to bind to the machine
 * - `sealed-unreadable`: `store.key` proves the data file was written under a
 *   machine-bound key, but this host has no keystore to open it with
 * - `reuse`: a key file already exists for this install
 * - `migrate`: a data file exists but predates the key file (fixed-key era)
 * - `create`: fresh install
 */
export function planKeySetup(input: KeyPlanInput): KeyPlan {
  if (!input.keystoreAvailable) {
    // Reading a sealed file without its keystore yields a parse error, which the
    // caller would otherwise classify as "corrupted data" and back up - leaving an
    // empty store where someone's credentials were. Refuse instead.
    return input.keyFileExists ? 'sealed-unreadable' : 'unencrypted'
  }
  if (input.keyFileExists) return 'reuse'
  return input.dataFileExists ? 'migrate' : 'create'
}

const COUNTED_KEYS = ['providers', 'accounts', 'sessions'] as const

/**
 * Checks a rewrite carried the whole payload over: every top-level key survives
 * and the counted collections keep their size.
 */
export function compareStoreSnapshot(
  before: unknown,
  after: unknown,
): { ok: boolean; detail: string } {
  if (!isRecord(before) || !isRecord(after)) {
    return { ok: false, detail: 'snapshot is not a plain object' }
  }

  const missing = Object.keys(before).filter((key) => !(key in after))
  if (missing.length > 0) {
    return { ok: false, detail: `missing after rewrite: ${missing.join(', ')}` }
  }

  for (const key of COUNTED_KEYS) {
    const beforeValue = before[key]
    const afterValue = after[key]
    if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
      const beforeCount = Array.isArray(beforeValue) ? beforeValue.length : 0
      const afterCount = Array.isArray(afterValue) ? afterValue.length : 0
      if (beforeCount !== afterCount) {
        return { ok: false, detail: `${key} count ${beforeCount} -> ${afterCount}` }
      }
    }
  }

  return { ok: true, detail: 'ok' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const LEGACY_BACKUP = /^data\.json\.pre-key-migration\.bak(?:\.(\d+))?$/
const CORRUPTED_BACKUP = /^data\.corrupted\.(\d+)\.json$/

/**
 * Copies of the store that earlier runs left behind, newest first. Used when
 * data.json itself has gone missing: a downgrade renames it to
 * `data.corrupted.<ts>.json`, and a migration keeps `.pre-key-migration.bak`.
 */
export function legacyBackupCandidates(fileNames: string[]): string[] {
  return fileNames
    .map((name) => {
      const match = LEGACY_BACKUP.exec(name) ?? CORRUPTED_BACKUP.exec(name)
      if (!match) return null
      return { name, stamp: match[1] ? Number(match[1]) : 0 }
    })
    .filter((entry): entry is { name: string; stamp: number } => entry !== null)
    .sort((a, b) => b.stamp - a.stamp)
    .map((entry) => entry.name)
}

/**
 * Serialises prompts left behind by the removed prompt library so they can be
 * moved out of data.json instead of being dropped. Returns null when there is
 * nothing worth keeping.
 */
export function orphanedPromptPayload(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null
  return JSON.stringify(value, null, 2)
}

