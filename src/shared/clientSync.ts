/**
 * One-click client repointing: what the console can write on *this* machine.
 *
 * The problem this solves is not "the shell cannot serve API" - it is that every client
 * keeps its own base URL and key, so changing gateway means editing six config stores by
 * hand. The shell already knows every gateway (address book) and holds each one's
 * management secret, so it can do the editing instead.
 *
 * Types live in `shared/` for the same reason as `shellBridge.ts`: the main process plans
 * the writes, the preload carries them, and the page renders them - three copies of one
 * shape is how a preview drifts from what actually gets written.
 *
 * Two rules are encoded in the shape rather than left to the caller:
 * - **No plaintext secret ever crosses the bridge.** Plans carry `KEY_PLACEHOLDER` where
 *   the key belongs and a masked `keyPreview` for display; `apply` substitutes the real
 *   value in the main process. A remote page therefore cannot read the key by asking for
 *   a preview, and cannot aim a write at a path of its choosing either - it names client
 *   ids, and the main process re-derives every path itself.
 * - **Three absences stay distinct.** "not installed", "installed but has no entry of
 *   ours to update in place" and "installed but the app is running so a write would be
 *   clobbered" are different states with different next steps, so they are different
 *   values - never one greyed-out row.
 */

/** The client families the console knows how to repoint. */
export type ClientId =
  | 'codex'
  | 'claude'
  | 'qoder'
  | 'qoder-cn'
  | 'workbuddy'
  | 'codebuddy-cn'
  | 'trae-cn'

export type ClientSyncState =
  /** Installed, our entry found, edits planned. */
  | 'ready'
  /** Installed and already pointing at the target with the canonical key. */
  | 'unchanged'
  /** No config store for this client on this machine. */
  | 'not-installed'
  /**
   * Installed, but nothing of ours to update in place. Creating a provider entry is a
   * different act from repointing one (it needs a uuid, a display name and a model list
   * the user has not chosen), so this state asks for one manual step instead.
   */
  | 'no-entry'
  /** The client holds its state in memory and flushes on exit: writing now loses it. */
  | 'app-running'
  /** A prerequisite is missing - no canonical key, or the gateway did not answer. */
  | 'blocked'
  /** The config store exists but could not be read or parsed. */
  | 'error'

/** One field's before/after, already masked. `before: null` = the field is being added. */
export interface ClientChange {
  label: string
  before: string | null
  after: string
}

export interface ClientSyncRow {
  id: ClientId
  /** Display name, resolved by the main process so the page cannot invent one. */
  label: string
  state: ClientSyncState
  /** Config files / databases this row would touch, on this machine. */
  paths: string[]
  changes: ClientChange[]
  /** Why this row is not `ready`, or a caveat on one that is (Codex without a catalog). */
  reason: string | null
  /**
   * One thing only the user can do (enter the canonical key in TRAE's own UI, add the
   * first custom model in Qoder). Null when the console can finish the job alone.
   */
  manualStep: string | null
  /**
   * Model names this client currently offers that the target does not serve. Reported,
   * never renamed: a name change alters what the client sends and, in TRAE, is coupled
   * to `custom_model_id`. Empty means the switch is complete.
   */
  unservedModels: string[]
}

/** What happened to one gateway while distributing the canonical key. */
export interface KeyDistributionRow {
  origin: string
  name: string
  state: 'already' | 'added' | 'failed' | 'no-secret'
  detail?: string
}

export interface ClientSyncModel {
  /** The name the client will send as `model` - a gateway route name. */
  name: string
  displayName: string
  /**
   * Null when the gateway does not advertise one. Never filled from a catalogue or a
   * family rule: an invented window is worse than an absent one.
   */
  contextWindow: number | null
}

export interface ClientSyncPreview {
  /** Normalized origin of the gateway every client would be pointed at. */
  origin: string
  gatewayName: string
  /** Masked, e.g. `sk-e5b…7efc8ed4ce87`. Null when no key could be established. */
  keyPreview: string | null
  models: ClientSyncModel[]
  rows: ClientSyncRow[]
  keyDistribution: KeyDistributionRow[]
  /** Set when the preview itself could not be produced (no active gateway, offline). */
  error?: string
}

export interface ClientApplyResult {
  id: ClientId
  ok: boolean
  message: string
  /** Backup files written before the change, kept for rollback. */
  backups: string[]
}

export interface ClientSyncApplyResult {
  ok: boolean
  results: ClientApplyResult[]
  error?: string
}

/**
 * Where the canonical key goes in a planned edit. `apply` replaces every occurrence
 * before writing, and refuses to write a file that still contains it - a placeholder
 * reaching disk would look like a configured client and fail every request.
 */
export const KEY_PLACEHOLDER = '__MODELPORT_CANONICAL_KEY__'

/** The Windows User environment variable Codex reads its key from (`env_key` in TOML). */
export const CODEX_ENV_KEY = 'MODELPORT_CODEX_API_KEY'