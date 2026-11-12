/**
 * The console's half of the shell tray's model menu.
 *
 * The shell process cannot call `routes:menu` by itself: the management secret is sealed
 * by this page's transport (`headless.ts`), and handing the main process a copy would put
 * a credential in a second place. So the tray sends an intent, this module performs the
 * RPC, and the fresh snapshot goes back over the same bridge for the tray to draw.
 *
 * A plain browser has no bridge - the whole module is then a no-op, not a failure.
 */
import type { ShellRouteCommand, ShellTrayRoutes } from '@shared/shellBridge'
import type { RouteMenuResult } from '@shared/types'

function traySurface(): ShellTrayRoutes | null {
  const host = window as unknown as { modelportShell?: { routes?: ShellTrayRoutes } }
  const surface = host.modelportShell?.routes
  if (surface === undefined || typeof surface.publishRouteMenu !== 'function') return null
  return surface
}

/** One read of the menu. A failure is published as `error` so the tray can say why. */
async function readMenu(): Promise<RouteMenuResult> {
  try {
    return await window.electronAPI.routes.menu()
  } catch (error) {
    return {
      routes: [],
      generatedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runCommand(command: ShellRouteCommand): Promise<void> {
  try {
    if (command.action === 'reset') {
      await window.electronAPI.routes.unpin(command.route)
      return
    }
    await window.electronAPI.routes.switchModel({
      route: command.route,
      ...(command.model === undefined ? {} : { model: command.model }),
      ...(command.providerId === undefined ? {} : { providerId: command.providerId }),
      source: 'tray',
    })
  } catch (error) {
    // The tray has no toast channel; the next snapshot is what the user sees, so log the
    // detail here and let the published error carry the reason.
    console.error('[tray] route command failed', command, error)
  }
}

/**
 * Installs the bridge and publishes a first snapshot. Returns the unsubscribe function,
 * so a re-mount cannot leave two listeners answering the same tray click.
 */
export function installTrayRouteBridge(): () => void {
  const surface = traySurface()
  if (surface === null) return () => {}

  let disposed = false
  const publish = (): void => {
    void readMenu().then(snapshot => {
      if (!disposed) surface.publishRouteMenu?.(snapshot)
    })
  }

  const offRequest = surface.onRouteMenuRequest?.(publish) ?? (() => {})
  const offCommand = surface.onRouteCommand?.(command => {
    void runCommand(command).then(publish)
  }) ?? (() => {})
  publish()

  return () => {
    disposed = true
    offRequest()
    offCommand()
  }
}