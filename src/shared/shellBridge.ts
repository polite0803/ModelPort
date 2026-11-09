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

/**
 * What the OS trust store of **the machine running the console** says about the active
 * gateway's certificate.
 *
 * The page cannot answer this by itself: it is served by the gateway, so `tls:status`
 * describes the machine hosting the listener - under WSL or a remote deployment that is a
 * different computer from the one whose browser is refusing the certificate. `source`
 * names how the console got the PEM: `gateway` from `GET /v1/management/tls/ca`,
 * `handshake` from the certificate the TLS layer refused while loading this very page
 * (the bootstrap case, where the management endpoint is unreachable precisely because the
 * certificate is not trusted).
 */
export interface ShellCertificateTrustStatus {
  /** False when this platform has no trust command the console can run (Linux). */
  supported: boolean
  /** null = no cheap probe on this platform, or no certificate to probe. */
  trusted: boolean | null
  fingerprint256: string | null
  sha1: string | null
  subject: string | null
  issuer: string | null
  validTo: string | null
  subjectAltName: string | null
  selfSigned: boolean | null
  /** Where the PEM was read from. */
  source: 'gateway' | 'handshake' | null
  /**
   * Path on this machine. `NODE_EXTRA_CA_CERTS` on the console machine must point here,
   * not at the gateway's `~/.modelport/tls/server.crt`.
   */
  certPath: string | null
  /** Why there is no certificate (offline, no management secret, none generated yet). */
  error?: string
}

export interface ShellCertificateTrustResult {
  ok: boolean
  message: string
  trusted: boolean | null
  fingerprint256: string | null
  certPath: string | null
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

  /**
   * Certificate trust for the console machine. Optional - a page in a plain browser has
   * no host to ask, and a shell older than this feature has none either, so the panel
   * must fall back to "trust it yourself with this PEM".
   *
   * None of these take a PEM or a path: the console fetches the certificate itself, and
   * the remote page must not be able to aim `certutil` at a file of its choosing.
   */
  getGatewayCertificate?(): Promise<ShellCertificateTrustStatus>
  installGatewayCertificateTrust?(): Promise<ShellCertificateTrustResult>
  uninstallGatewayCertificateTrust?(): Promise<ShellCertificateTrustResult>

  getVersion?(): Promise<string>
  checkForUpdates?(): Promise<ShellUpdateCheck>
  startUpgrade?(): Promise<ShellUpgradeResult>
  onUpdateProgress?(callback: (progress: ShellUpdateProgress) => void): () => void
}
