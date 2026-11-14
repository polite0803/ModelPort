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

import type { GatewayListSnapshot } from './shellList'
import type { ClientSyncApplyResult, ClientSyncPreview } from './clientSync'
import type { RouteMenuResult } from './types'

/**
 * A tray click, on its way to the page that can actually perform it.
 *
 * The shell process never holds the management secret (it is sealed by the page's
 * transport), so the tray cannot call `routes:switch` itself. It forwards an intent and
 * the page answers with the RPC plus a fresh menu snapshot.
 */
export interface ShellRouteCommand {
  /** `reset` = 恢复自动排序（清软钉 + 持久偏好）；`switch` = 换下一个 / 点名。 */
  action: 'switch' | 'reset'
  route: string
  model?: string
  providerId?: string
}

export interface ShellTrayRoutes {
  /** The page publishes a menu snapshot after every read, switch and config change. */
  publishRouteMenu?(result: RouteMenuResult): void
  /** Shell → page: rebuild the snapshot (tray opening, or a switch just landed). */
  onRouteMenuRequest?(callback: () => void): () => void
  /** Shell → page: the user picked something in the tray's model submenu. */
  onRouteCommand?(callback: (command: ShellRouteCommand) => void): () => void
}

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

/**
 * The gateway manager as an in-page surface: the console's own `/gateways` route renders
 * the list, so switching gateways never covers the window with a second one.
 *
 * Same shape as the list window's bridge (`listPreload.ts`), because both ask the same
 * main-process functions; the difference is the gate. The list window is a `data:`
 * document this process authored and is trusted by identity, while this surface is
 * reachable from the remote page inside the main window - so the main process accepts it
 * only from the active gateway's origin, exactly like the update actions.
 *
 * Optional: the page is also served to plain browsers, where nothing injects a bridge.
 */
export interface ShellGatewayAdmin {
  snapshot(): Promise<GatewayListSnapshot>
  connect(id: string): Promise<void>
  add(): Promise<void>
  edit(id: string): Promise<void>
  remove(id: string): Promise<void>
  installWsl(id: string): Promise<void>
  localAction(id: string, action: 'start' | 'stop' | 'repair'): Promise<void>
  wslAction(id: string, action: 'start' | 'stop' | 'restart' | 'uninstall'): Promise<void>
  upgrade(id: string): Promise<void>
  deploy(id: string): Promise<void>
  /** Fires after the main process changed the address book or a gateway's state. */
  onChanged(callback: () => void): () => void
}

/**
 * Repointing the installed clients at the active gateway, as an in-page surface.
 *
 * Gated like the update actions: only the active gateway's origin may ask, because the
 * writes land in the user's own config stores and one of them is an OS environment
 * variable. The page names **client ids only** - never a path, never a key, never a
 * prepared edit. The main process re-derives everything at apply time, so a stale or
 * forged preview cannot aim a write somewhere else.
 *
 * Optional: a plain browser has no host to ask, and a console older than this feature has
 * no such surface, so the page must detect the absence rather than assume it.
 */
export interface ShellClientAdmin {
  /** What would change, per client, with the key masked. Writes nothing. */
  preview(): Promise<ClientSyncPreview>
  /** Writes the named clients after re-deriving the plan. */
  apply(clientIds: string[]): Promise<ClientSyncApplyResult>
}

export interface ShellBridge {
  openInBrowser(): Promise<void>
  reconnect(): Promise<void>
  quit(): Promise<void>

  gateways?: ShellGatewayAdmin

  /** One-click client repointing. Optional for the same reason as `gateways`. */
  clients?: ShellClientAdmin

  /**
   * Quick model switching from the tray. Optional for the same reason as `gateways`:
   * a plain browser has no tray, and an installed console older than this feature has
   * no such surface - the page must detect the absence rather than assume it.
   */
  routes?: ShellTrayRoutes

  /**
   * Navigates the console page. The main process sends this when a menu entry or the tray
   * asks for a page the console already has, so the request lands in the window the user
   * is already looking at; a page loaded from a plain browser never receives it.
   */
  onNavigate?(callback: (path: string) => void): () => void

  getGatewaySecret(origin: string): Promise<{ status: string; secret?: string }>
  setGatewaySecret(origin: string, secret: string): Promise<{ stored: boolean; result: string }>
  forgetGatewaySecret(origin: string): Promise<void>
  /**
   * Re-read the current secret of a managed gateway (local data dir / root WSL) after a
   * restore or rebuild rotated it, and re-seal it. Optional: older shells lack it, and a
   * remote origin always answers `none` - the page then keeps the connect form.
   */
  refreshGatewaySecret?(origin: string): Promise<{ status: string; secret?: string }>

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
