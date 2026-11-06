/**
 * Host bindings - the single seam between the gateway and the process it runs in.
 *
 * The gateway (proxy, providers, quota, scheduler, store) is host-agnostic: it may
 * live in the Electron main process or in a headless Node daemon (WSL). Everything
 * that genuinely differs between those two hosts is reached through this module, so
 * the closure has exactly one file that knows which host it is on.
 *
 * There is no default binding and no silent fallback: an unbound host throws. A
 * daemon that guessed its own version string or resource root would serve a wrong
 * `/v1/management` identity and load channels from a directory that is not there.
 */

/** Seals the strings that must not hit the disk as plaintext (`store.ts`). */
export interface CredentialSealer {
  isAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(sealed: Buffer): string
}

/**
 * OS surfaces a *windowless* Electron host still has: native file dialogs, the system
 * opener and a restart hook. The local gateway runs without a window but is the same
 * Electron binary, so the remote page inside the local console keeps `export backup` and
 * `save diagnostic bundle` working instead of answering `desktop-only`.
 */
export interface SystemCapabilities {
  /**
   * File dialogs. They return a path and nothing else: writing the bytes stays with the
   * caller, so the backup format, the `0600` mode and the sealed/unsealed decision are not
   * duplicated inside the shell.
   */
  pickSavePath(defaultName: string): Promise<string | null>
  pickOpenPath(): Promise<string | null>
  /** Relaunch + quit after an import that only takes effect on a fresh start. */
  restart(): void
  /** Open a local path or URL with the OS handler (folder, browser, file). */
  openWithSystemHandler(target: string): Promise<void>
}

/**
 * Things only a desktop install can do. Absent on a headless host, and every handler
 * that needs it answers with `desktop-only` instead of pretending it worked - the
 * failure the user must be able to read is "this host has no such capability", not a
 * button that spins forever.
 */
export interface DesktopCapabilities extends SystemCapabilities {
  /** Reflect the running state into the tray / notification surface. */
  notifyProxyStatus(running: boolean): void
  getAppVersion(): string
  getUpdateStatus(): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<void>
  quitAndInstall(): void
  /** Window buttons, including the hide-or-quit decision the close button makes. */
  window(action: WindowAction, theme?: string): void
}

export type WindowAction =
  | 'minimize'
  | 'maximize'
  | 'close'
  | 'hide'
  | 'show'
  | 'title-bar-theme'

export interface HostBindings {
  readonly kind: 'electron' | 'node'
  /** Version advertised by the gateway; must match the released artifact. */
  getVersion(): string
  /** Directory holding the non-bundled runtime assets (channel pack, catalog, wasm). */
  getResourceRoot(): string
  /**
   * Built renderer to serve over HTTP, when this host serves a UI at all.
   * The Electron shell loads the same files through `loadFile` instead, so it returns
   * undefined here - the static route must not exist twice in one process.
   */
  getWebRoot?(): string | undefined
  /** Hand a URL to the machine that actually has a browser. */
  openExternal(url: string): void
  /**
   * Push one event to whoever is watching: Electron windows over `webContents.send`,
   * the headless host over its SSE channel. A dropped event is allowed (no viewer), a
   * thrown one is not - push sits inside request paths.
   */
  push(channel: string, payload?: unknown): void
  /**
   * Reflect the `autoStart` setting into whatever the host calls a login item.
   * A headless daemon has none - systemd/unit files own that, so it reports
   * "not applied" instead of pretending the switch took effect.
   */
  syncLoginItem(enabled: boolean): Promise<{ applied: boolean }>
  sealer: CredentialSealer
  readonly desktop?: DesktopCapabilities
  /**
   * Present on both Electron hosts: the desktop app and the windowless local gateway.
   * A headless Node daemon has neither, which is why every consumer asks through
   * `requireSystem()` rather than reading `desktop`.
   */
  readonly system?: SystemCapabilities
}

let host: HostBindings | null = null

export function setHost(bindings: HostBindings): void {
  host = bindings
}

export function getHost(): HostBindings {
  if (!host) {
    throw new Error(
      'Host bindings are not set: the Electron entry must call bindElectronHost() ' +
        'and the daemon entry must call createNodeHost() before any gateway module runs.',
    )
  }
  return host
}

export function isHostBound(): boolean {
  return host !== null
}

/**
 * Resource root when a host is bound, `undefined` when it is not.
 *
 * Callers keep their own "asset absent" behaviour for the unbound case (unit tests
 * load these modules without any host bound): the absence must degrade the feature
 * to "not shipped", never crash a test run that is not about packaging.
 */
export function hostResourceRoot(): string | undefined {
  return host ? host.getResourceRoot() : undefined
}

/** Raised by a desktop-only action on a headless host; carried into both IPC and RPC. */
export class DesktopOnlyError extends Error {
  readonly code = 'desktop-only'

  constructor(action: string) {
    super(`"${action}" needs a desktop install: this host has no window, tray or dialog.`)
    this.name = 'DesktopOnlyError'
  }
}

export function requireDesktop(action: string): DesktopCapabilities {
  const desktop = host?.desktop
  if (!desktop) throw new DesktopOnlyError(action)
  return desktop
}

/**
 * File dialogs and the system opener: available on a windowless Electron gateway too.
 * Falls back to `desktop` so a host that predates the split keeps working.
 */
export function requireSystem(action: string): SystemCapabilities {
  const system = host?.system ?? host?.desktop
  if (!system) throw new DesktopOnlyError(action)
  return system
}

type PushSubscriber = (channel: string, payload: unknown) => void

/** Headless push sinks (the SSE route registers one per connected client). */
const headlessPushSubscribers = new Set<PushSubscriber>()

export function onHeadlessPush(subscriber: PushSubscriber): () => void {
  headlessPushSubscribers.add(subscriber)
  return () => {
    headlessPushSubscribers.delete(subscriber)
  }
}

/**
 * Deliver one event to the SSE clients. Shared by the Node daemon and the windowless
 * Electron gateway: both serve `/v1/management/events`, so both must feed the same sinks.
 */
export function pushToHeadlessSubscribers(channel: string, payload: unknown): void {
  for (const subscriber of headlessPushSubscribers) {
    try {
      subscriber(channel, payload)
    } catch {
      // A dead SSE client must not break the request path that pushed to it.
    }
  }
}

/** Keystore-less sealer: the documented `unencrypted` branch of `planKeySetup`. */
export const UNAVAILABLE_SEALER: CredentialSealer = {
  isAvailable: () => false,
  encryptString: () => {
    throw new Error('No credential sealer on this host')
  },
  decryptString: () => {
    throw new Error('No credential sealer on this host')
  },
}

/** Node (headless daemon) host: no keystore, no browser, assets next to the bundle. */
export function createNodeHost(input: { version: string; resourceRoot: string; webRoot?: string }): HostBindings {
  return {
    kind: 'node',
    getVersion: () => input.version,
    getResourceRoot: () => input.resourceRoot,
    getWebRoot: () => input.webRoot,
    openExternal: (url) => {
      // Headless has no browser of its own; the URL still has to reach a human.
      console.log(`[Host] open this login URL in a browser on the host machine: ${url}`)
    },
    syncLoginItem: async (enabled) => {
      console.log(
        `[Host] autoStart=${enabled} is not applied here: a headless daemon has no login item; ` +
          'install a systemd user unit instead.',
      )
      return { applied: false }
    },
    push: pushToHeadlessSubscribers,
    sealer: UNAVAILABLE_SEALER,
  }
}
