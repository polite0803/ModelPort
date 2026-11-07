/**
 * The contract between the Windows shell's preload and the remote page it hosts.
 *
 * The page is served by the gateway (`/ui/`) and is therefore not trusted with a generic
 * IPC handle: every method below is a named capability, and the shell's main process
 * answers only the active gateway's origin for the update actions. Types live in
 * `@shared` so the preload and the renderer cannot drift into two method lists - the same
 * rule as `shared/api.ts` for the desktop surface.
 *
 * The update methods are optional: an older installed shell has only the secret-store
 * methods, and the About page must be able to detect that absence instead of calling
 * `undefined`.
 */

export type ShellUpdateStage =
  | 'checking'
  | 'downloading-daemon'
  | 'verifying-daemon'
  | 'installing-daemon'
  | 'restarting-daemon'
  | 'downloading-shell'
  | 'verifying-shell'
  | 'installing-shell'
  | 'done'
  | 'error'

export interface ShellUpdateProgress {
  stage: ShellUpdateStage
  message: string
  /** 0-100 for downloads; absent for stages that have no meaningful byte count. */
  percent?: number
}

export interface ShellUpdateAsset {
  name: string
  url: string
  checksumName: string
  checksumUrl: string
  size?: number
}

export interface ShellUpdateComponent {
  current: string | null
  latest: string | null
  updateAvailable: boolean
  /** Null when the release has no asset for this platform/arch, or its checksum is missing. */
  asset: ShellUpdateAsset | null
}

export interface ShellUpdateCheck {
  release: { version: string; pageUrl: string } | null
  shell: ShellUpdateComponent
  daemon: ShellUpdateComponent & {
    /** True only when the active gateway entry opted into WSL management. */
    managed: boolean
    /** Present when the gateway version could not be read (offline/HTTPS trust). */
    error?: string
  }
  /** Asset names that exist in the release but have no `.sha256`; installation refuses them. */
  missing: string[]
  error?: string
}

export interface ShellUpgradeResult {
  ok: boolean
  daemonUpdated: boolean
  shellUpdated: boolean
  /** The WSL backup directory kept for rollback, when the daemon was updated. */
  backup?: string
  error?: string
}

export interface ShellBridge {
  openInBrowser(): Promise<void>
  reconnect(): Promise<void>
  quit(): Promise<void>

  /**
   * Opens the console's gateway manager window. Optional: the page is also served to
   * plain browsers and to shells older than the panel, and both must hide the entry
   * instead of rendering a button that calls `undefined`.
   */
  openGatewayManager?(): Promise<void>

  getGatewaySecret(origin: string): Promise<{ status: string; secret?: string }>
  setGatewaySecret(origin: string, secret: string): Promise<{ stored: boolean; result: string }>
  forgetGatewaySecret(origin: string): Promise<void>

  getVersion?(): Promise<string>
  checkForUpdates?(): Promise<ShellUpdateCheck>
  startUpgrade?(): Promise<ShellUpgradeResult>
  onUpdateProgress?(callback: (progress: ShellUpdateProgress) => void): () => void
}
