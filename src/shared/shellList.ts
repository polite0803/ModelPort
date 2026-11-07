/**
 * The console's gateway list: what it shows, and what each row can do.
 *
 * Types live in `shared/` because three surface points need the same shape - the main
 * process that collects state, the list window that renders it, and the tests that prove
 * the row actions without Electron. Nothing here knows how a state is obtained.
 */

/** What an address-book entry's gateway is. Moved here so the list can name it. */
export type GatewayKind = 'local' | 'wsl' | 'remote'

export type GatewayPhase =
  /** The gateway answered `/` — it is up and willing to serve the console. */
  | 'running'
  /** Only local: there is a status file but its process is gone. */
  | 'stopped'
  /** Only local: the process is alive but `/health` did not answer. */
  | 'unreachable'
  /** Only local: this machine has never been provisioned. */
  | 'not-installed'
  /** WSL / remote: no answer. */
  | 'offline'
  /** The probe itself failed in a way that says nothing about the gateway. */
  | 'unknown'

export type GatewayRowAction =
  | 'connect'
  | 'edit'
  | 'remove'
  | 'start'
  | 'stop'
  | 'repair'
  | 'install'

export interface GatewayRow {
  id: string
  name: string
  url: string
  kind: GatewayKind
  /** The gateway the main window is showing right now. */
  active: boolean
  phase: GatewayPhase
  /** Version the gateway reported; null when it did not answer. */
  version: string | null
  /** One human line: kind, host, version - what the row's second line shows. */
  detail: string
  actions: GatewayRowAction[]
}

export interface GatewayListSnapshot {
  rows: GatewayRow[]
  /** Action labels travel with the snapshot so the page and the main process cannot disagree. */
  labels: Record<GatewayRowAction, string>
  /** False on platforms that cannot host the mode (WSL on macOS/Linux). */
  canAddWsl: boolean
  /** Set when the address book itself could not be read. */
  error?: string
}
